import type { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageParam, text } from '../common/api';
import { AipddKeyService } from '../account/aipdd-key.service';
import { aipddBaseUrl } from '../content/content-shared';
import type { PointsService } from '../points/points.service';
import type { PointsSettingsService } from '../points/points-settings.service';
import {
  effectivePrice,
  PLAZA_BILLING_UNITS,
  toAmount,
} from './model-plaza.pricing';
import type { PlazaBillingUnit } from './model-plaza.pricing';
import { categoryOf } from './model-plaza.category';
import { ensurePlazaSeed } from './model-plaza.seed';
import { ModelUpstreamService } from './upstream.service';
import type { CurrentUser } from '../auth/current-user';

type CatalogRow = {
  id: number;
  upstreamId: number;
  provider: string;
  modelKey: string;
  upstreamModelKey: string;
  displayName: string;
  vendor: string;
  description: string;
  quotaType: string;
  billingUnit: string;
  category: string;
  inputRmbPrice: unknown;
  outputRmbPrice: unknown;
  callRmbPrice: unknown;
  cacheReadRmbPrice: unknown;
  cacheWriteRmbPrice: unknown;
  minimumRmb: unknown;
  tiers: unknown;
  components: unknown;
  discountRate: unknown;
  contextWindow: number;
  maxOutputTokens: number;
  modalities: unknown;
  endpoints: unknown;
  tags: unknown;
  enabled: boolean;
  sort: number;
  remark: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

const DAY_MS = 86_400_000;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function modalitiesOf(value: unknown): { input: string[]; output: string[] } {
  const raw = (value || {}) as Record<string, unknown>;
  return { input: strings(raw.input), output: strings(raw.output) };
}

/** 各端点支持的请求参数：静态口径，和 OpenAI 兼容网关实际透传的字段对齐。 */
const ENDPOINT_PARAMS: Record<string, string[]> = {
  '/chat/completions': [
    'model',
    'messages',
    'temperature',
    'top_p',
    'max_tokens',
    'stream',
    'stop',
    'presence_penalty',
    'frequency_penalty',
    'seed',
    'response_format',
    'tools',
    'tool_choice',
  ],
  '/embeddings': ['model', 'input', 'encoding_format', 'dimensions', 'user'],
  '/images/generations': [
    'model',
    'prompt',
    'n',
    'size',
    'quality',
    'style',
    'response_format',
    'user',
  ],
  '/images/edits': [
    'model',
    'image',
    'prompt',
    'mask',
    'n',
    'size',
    'response_format',
    'user',
  ],
  '/audio/speech': ['model', 'input', 'voice', 'response_format', 'speed'],
  '/audio/transcriptions': [
    'model',
    'file',
    'language',
    'prompt',
    'response_format',
    'temperature',
  ],
  '/videos': ['model', 'prompt', 'image', 'duration', 'size', 'seed'],
};

/** 按模型声明的端点合并参数清单（去重，保持端点顺序）。 */
function paramsOf(endpoints: string[]) {
  const merged = new Set<string>();
  for (const endpoint of endpoints) {
    for (const param of ENDPOINT_PARAMS[endpoint] || []) merged.add(param);
  }
  return [...merged];
}

/** 速率限制：网关按 Key 与自然日计数，全模型合计；0＝不限。 */
function rateLimitView() {
  const raw = Number(process.env.MODEL_PLAZA_DAILY_LIMIT || 2000);
  const dailyCalls = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return {
    dailyCalls,
    note: dailyCalls
      ? `每个 API Key 每日 ${dailyCalls} 次（全模型合计；Key 上单独设置的限额优先，0 表示不限）`
      : '每个 API Key 不限次数（仍受积分余额与安全闸门约束）',
  };
}

/**
 * 模型广场目录：用户侧只读视图（双价 + 能力 + 我的用量），管理端 CRUD、
 * 从 baseURL 拉取差异预览与批量入库。价格换算口径收口在 model-plaza.pricing。
 */
export class ModelCatalogService {
  private readonly aipdd: AipddKeyService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly settings: PointsSettingsService,
    private readonly upstreams: ModelUpstreamService,
  ) {
    this.aipdd = new AipddKeyService(prisma);
  }

  private async rate() {
    const view = await this.settings.view();
    return view.rate > 0 ? view.rate : 0;
  }

  /** 哪些上游当前可用：AIPDD 看平台 Key，自定义看启停 + 是否存了 Key。 */
  private async availability() {
    const [aipdd, rows] = await Promise.all([
      this.aipdd.platformKeyView(),
      this.prisma.modelUpstream.findMany({
        select: { id: true, enabled: true, keyCipher: true, name: true },
      }),
    ]);
    const map = new Map<
      number,
      { ok: boolean; reason: string; name: string }
    >();
    map.set(0, {
      ok: aipdd.configured,
      reason: aipdd.configured ? '' : '平台未配置 AIPDD API Key',
      name: 'AIPDD',
    });
    for (const row of rows) {
      const ok = row.enabled && Boolean(row.keyCipher);
      map.set(row.id, {
        ok,
        reason: ok
          ? ''
          : row.enabled
            ? '上游渠道未配置 API Key'
            : '上游渠道已停用',
        name: row.name,
      });
    }
    return map;
  }

  private view(
    row: CatalogRow,
    rate: number,
    availability: Map<number, { ok: boolean; reason: string; name: string }>,
  ) {
    const upstream = availability.get(row.upstreamId);
    const price = effectivePrice(row, rate);
    return {
      id: row.id,
      provider: row.provider,
      modelKey: row.modelKey,
      displayName: row.displayName || row.modelKey,
      vendor: row.vendor,
      description: row.description,
      billingUnit: price.billingUnit,
      category: categoryOf(strings(row.endpoints), row.category),
      price,
      contextWindow: row.contextWindow,
      maxOutputTokens: row.maxOutputTokens,
      modalities: modalitiesOf(row.modalities),
      endpoints: strings(row.endpoints),
      params: paramsOf(strings(row.endpoints)),
      rateLimit: rateLimitView(),
      tags: strings(row.tags),
      upstreamName: upstream?.name ?? '',
      available: Boolean(row.enabled && upstream?.ok),
      unavailableReason: !row.enabled ? '该模型已下架' : upstream?.reason || '',
      myUsage7d: { calls: 0, totalTokens: 0, pointsCost: 0 },
    };
  }

  private adminView(
    row: CatalogRow,
    rate: number,
    availability: Map<number, { ok: boolean; reason: string; name: string }>,
    usage: Map<
      number,
      { calls: number; totalTokens: number; pointsCost: number }
    >,
  ) {
    return {
      ...this.view(row, rate, availability),
      upstreamId: row.upstreamId,
      upstreamModelKey: row.upstreamModelKey || row.modelKey,
      enabled: row.enabled,
      sort: row.sort,
      remark: row.remark,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      usage7d: usage.get(row.id) ?? { calls: 0, totalTokens: 0, pointsCost: 0 },
    };
  }

  /** 用户侧目录：只出已上架模型 + 我的近 7 天用量 + 汇率与余额。 */
  async userCatalog(user: CurrentUser) {
    await ensurePlazaSeed(this.prisma);
    const [rate, rows, summary] = await Promise.all([
      this.rate(),
      this.prisma.modelCatalog.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'desc' }, { id: 'asc' }],
      }),
      this.points.summary(user.userId),
    ]);
    const availability = await this.availability();
    const since = new Date(Date.now() - 7 * DAY_MS);
    const usageRows = await this.prisma.modelUsageLog.groupBy({
      by: ['catalogId'],
      where: {
        userId: user.userId,
        catalogId: { not: null },
        createdAt: { gte: since },
      },
      _count: { _all: true },
      _sum: { totalTokens: true, pointsCost: true },
    });
    const usage = new Map(
      usageRows
        .filter((row) => row.catalogId !== null)
        .map((row) => [
          row.catalogId as number,
          {
            calls: row._count._all,
            totalTokens: Number(row._sum.totalTokens ?? 0),
            pointsCost: toAmount(row._sum.pointsCost),
          },
        ]),
    );
    const list = rows.map((row) => {
      const view = this.view(row, rate, availability);
      view.myUsage7d = usage.get(row.id) ?? view.myUsage7d;
      return view;
    });
    const providerCount = new Map<string, number>();
    for (const item of list) {
      providerCount.set(
        item.provider,
        (providerCount.get(item.provider) ?? 0) + 1,
      );
    }
    return {
      rate,
      balance: summary.balance,
      list,
      total: list.length,
      providers: Array.from(providerCount, ([name, count]) => ({
        name,
        count,
      })),
      vendors: Array.from(
        new Set(list.map((item) => item.vendor).filter(Boolean)),
      ).sort(),
      tags: Array.from(new Set(list.flatMap((item) => item.tags))).sort(),
    };
  }

  async detail(user: CurrentUser, id: number) {
    const row = await this.prisma.modelCatalog.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '模型不存在');
    const [rate, availability, agg] = await Promise.all([
      this.rate(),
      this.availability(),
      this.prisma.modelUsageLog.aggregate({
        where: { userId: user.userId, catalogId: id },
        _count: { _all: true },
        _sum: { totalTokens: true, pointsCost: true },
      }),
    ]);
    const view = this.view(row, rate, availability);
    return {
      ...view,
      upstreamId: row.upstreamId,
      upstreamModelKey: row.upstreamModelKey || row.modelKey,
      remark: row.remark,
      myUsageTotal: {
        calls: agg._count._all,
        totalTokens: Number(agg._sum.totalTokens ?? 0),
        pointsCost: toAmount(agg._sum.pointsCost),
      },
    };
  }

  async overview() {
    await ensurePlazaSeed(this.prisma);
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [rate, upstreams, total, enabled, aipdd, agg, users] =
      await Promise.all([
        this.rate(),
        this.prisma.modelUpstream.count(),
        this.prisma.modelCatalog.count(),
        this.prisma.modelCatalog.count({ where: { enabled: true } }),
        this.aipdd.platformKeyView(),
        this.prisma.modelUsageLog.aggregate({
          where: { createdAt: { gte: since } },
          _count: { _all: true },
          _sum: { pointsCost: true },
        }),
        this.prisma.modelUsageLog.groupBy({
          by: ['userId'],
          where: { createdAt: { gte: since } },
        }),
      ]);
    return {
      rate,
      upstreamCount: upstreams,
      catalogTotal: total,
      catalogEnabled: enabled,
      aipdd: {
        baseUrl: aipddBaseUrl(),
        configured: aipdd.configured,
        masked: aipdd.masked,
        source: aipdd.source,
      },
      calls7d: agg._count._all,
      points7d: toAmount(agg._sum.pointsCost),
      activeUsers7d: users.length,
    };
  }

  async adminList(query: {
    page: number;
    pageSize: number;
    keyword: string;
    provider: string;
    category: string;
    enabled: 'ALL' | 'ON' | 'OFF';
  }) {
    await ensurePlazaSeed(this.prisma);
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize);
    const keyword = query.keyword.trim();
    const provider = query.provider === 'ALL' ? '' : query.provider;
    const where = {
      ...(provider ? { provider } : {}),
      ...(query.category && query.category !== 'ALL'
        ? { category: query.category }
        : {}),
      ...(query.enabled === 'ON'
        ? { enabled: true }
        : query.enabled === 'OFF'
          ? { enabled: false }
          : {}),
      ...(keyword
        ? {
            OR: [
              { modelKey: { contains: keyword } },
              { displayName: { contains: keyword } },
              { vendor: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [rows, total, rate, availability, providers, upstreamRows, aipdd] =
      await Promise.all([
        this.prisma.modelCatalog.findMany({
          where,
          orderBy: [{ sort: 'desc' }, { id: 'asc' }],
          skip: offset,
          take: pageSize,
        }),
        this.prisma.modelCatalog.count({ where }),
        this.rate(),
        this.availability(),
        this.prisma.modelCatalog.groupBy({ by: ['provider'] }),
        this.prisma.modelUpstream.findMany({
          select: { id: true, name: true, provider: true },
          orderBy: { id: 'asc' },
        }),
        this.aipdd.platformKeyView(),
      ]);
    const since = new Date(Date.now() - 7 * DAY_MS);
    const usageRows = await this.prisma.modelUsageLog.groupBy({
      by: ['catalogId'],
      where: {
        catalogId: { in: rows.map((row) => row.id) },
        createdAt: { gte: since },
      },
      _count: { _all: true },
      _sum: { totalTokens: true, pointsCost: true },
    });
    const usage = new Map(
      usageRows
        .filter((row) => row.catalogId !== null)
        .map((row) => [
          row.catalogId as number,
          {
            calls: row._count._all,
            totalTokens: Number(row._sum.totalTokens ?? 0),
            pointsCost: toAmount(row._sum.pointsCost),
          },
        ]),
    );
    return {
      list: rows.map((row) =>
        this.adminView(row as CatalogRow, rate, availability, usage),
      ),
      total,
      page,
      pageSize,
      rate,
      providers: providers.map((row) => row.provider).sort(),
      upstreams: [
        { id: 0, name: 'AIPDD（平台 Key）', provider: 'AIPDD' },
        ...upstreamRows,
      ],
      aipdd: {
        baseUrl: aipddBaseUrl(),
        configured: aipdd.configured,
        masked: aipdd.masked,
        source: aipdd.source,
      },
    };
  }

  async save(userId: string, body: Record<string, unknown>) {
    const id = Number(body.id || 0);
    const upstreamId = Number(body.upstreamId || 0);
    if (upstreamId > 0) {
      const exists = await this.prisma.modelUpstream.findUnique({
        where: { id: upstreamId },
      });
      if (!exists)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '所选上游渠道不存在',
        );
    }
    const rawUnit = text(body.billingUnit).trim().toLowerCase();
    const billingUnit = (PLAZA_BILLING_UNITS as string[]).includes(rawUnit)
      ? (rawUnit as PlazaBillingUnit)
      : 'token';
    const rawDiscount = Number(body.discountRate ?? 1);
    const discountRate =
      Number.isFinite(rawDiscount) && rawDiscount > 0 && rawDiscount <= 1
        ? rawDiscount
        : 1;
    const payload = {
      upstreamId,
      provider:
        text(body.provider).trim() || (upstreamId ? 'LocalAPI' : 'AIPDD'),
      modelKey: text(body.modelKey).trim(),
      upstreamModelKey: text(body.upstreamModelKey).trim(),
      displayName: text(body.displayName).trim(),
      vendor: text(body.vendor).trim(),
      description: text(body.description).trim(),
      // 历史列：token 之外一律记 CALL，只为兼容旧读法
      quotaType: billingUnit === 'token' ? 'TOKEN' : 'CALL',
      billingUnit,
      category: categoryOf(
        (Array.isArray(body.endpoints) ? body.endpoints : []) as string[],
        body.category,
      ),
      inputRmbPrice: Number(body.inputRmbPrice || 0),
      outputRmbPrice: Number(body.outputRmbPrice || 0),
      callRmbPrice: Number(body.callRmbPrice || 0),
      cacheReadRmbPrice: Number(body.cacheReadRmbPrice || 0),
      cacheWriteRmbPrice: Number(body.cacheWriteRmbPrice || 0),
      minimumRmb: Number(body.minimumRmb || 0),
      tiers: Array.isArray(body.tiers) ? body.tiers : [],
      components: Array.isArray(body.components) ? body.components : [],
      discountRate,
      contextWindow: Number(body.contextWindow || 0),
      maxOutputTokens: Number(body.maxOutputTokens || 0),
      modalities: body.modalities || {
        input: ['text'],
        output: ['text'],
      },
      endpoints: (Array.isArray(body.endpoints)
        ? body.endpoints
        : ['/chat/completions']) as string[],
      tags: (Array.isArray(body.tags) ? body.tags : []) as string[],
      enabled: Boolean(body.enabled),
      sort: Number(body.sort || 0),
      remark: text(body.remark).trim(),
    };
    if (!payload.modelKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写模型标识（modelKey）',
      );
    }
    const duplicated = await this.prisma.modelCatalog.findFirst({
      where: {
        provider: payload.provider,
        modelKey: payload.modelKey,
        NOT: { id },
      },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '同一渠道下已存在该模型标识',
      );
    }
    const row = id
      ? await this.prisma.modelCatalog.update({ where: { id }, data: payload })
      : await this.prisma.modelCatalog.create({
          data: { ...payload, createdBy: userId },
        });
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          action: id ? 'MODEL_CATALOG_UPDATE' : 'MODEL_CATALOG_CREATE',
          detail: `#${row.id} ${row.provider}/${row.modelKey}`,
        },
      })
      .catch(() => undefined);
    const [rate, availability] = await Promise.all([
      this.rate(),
      this.availability(),
    ]);
    return this.adminView(row, rate, availability, new Map());
  }

  async toggle(userId: string, id: number, enabled: boolean) {
    const existing = await this.prisma.modelCatalog.findUnique({
      where: { id },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '模型不存在');
    await this.prisma.modelCatalog.update({ where: { id }, data: { enabled } });
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          action: enabled ? 'MODEL_CATALOG_LIST' : 'MODEL_CATALOG_UNLIST',
          detail: `#${id} ${existing.modelKey}`,
        },
      })
      .catch(() => undefined);
    return { id, enabled };
  }

  async remove(userId: string, id: number) {
    const existing = await this.prisma.modelCatalog.findUnique({
      where: { id },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '模型不存在');
    await this.prisma.modelCatalog.delete({ where: { id } });
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'MODEL_CATALOG_REMOVE',
          detail: `#${id} ${existing.modelKey}`,
        },
      })
      .catch(() => undefined);
    return { id };
  }

  /** 从 baseURL 拉取：新增 / 已有 / 已下架 三桶差异，供管理员勾选入库。 */
  async pull(input: {
    upstreamId: number;
    baseUrl: string;
    apiKey: string;
    protocol: 'openai' | 'anthropic';
  }) {
    const { credentials, models } = await this.upstreams.discoverModels(input);
    const existing = await this.prisma.modelCatalog.findMany({
      where: { upstreamId: credentials.upstreamId },
      select: { id: true, modelKey: true, enabled: true, category: true },
    });
    const byKey = new Map(existing.map((row) => [row.modelKey, row]));
    const discoveredKeys = new Set(models.map((row) => row.modelKey));
    const decorate = (row: (typeof models)[number]) => {
      const hit = byKey.get(row.modelKey);
      return {
        ...row,
        catalogId: hit?.id ?? null,
        enabled: hit?.enabled ?? null,
      };
    };
    return {
      upstreamId: credentials.upstreamId,
      provider: credentials.provider,
      baseUrl: credentials.baseUrl,
      added: models.filter((row) => !byKey.has(row.modelKey)).map(decorate),
      existing: models.filter((row) => byKey.has(row.modelKey)).map(decorate),
      removed: existing
        .filter((row) => !discoveredKeys.has(row.modelKey))
        .map((row) => ({
          modelKey: row.modelKey,
          kind: 'other',
          vision: false,
          endpoints: [],
          displayName: row.modelKey,
          billingUnit: 'token' as const,
          category: row.category,
          inputRmbPrice: 0,
          outputRmbPrice: 0,
          callRmbPrice: 0,
          cacheReadRmbPrice: 0,
          cacheWriteRmbPrice: 0,
          minimumRmb: 0,
          tiers: [],
          components: [],
          catalogId: row.id,
          enabled: row.enabled,
        })),
    };
  }

  /** 批量入库：按 (provider, modelKey) upsert；enabled 由管理员勾选决定。 */
  async importModels(userId: string, body: Record<string, unknown>) {
    const upstreamId = Number(body.upstreamId || 0);
    const credentials = await this.upstreams.credentials(upstreamId);
    const models = Array.isArray(body.models)
      ? (body.models as Record<string, unknown>[])
      : [];
    const enabled = Boolean(body.enabled);
    const disableMissing = Boolean(body.disableMissing);
    let created = 0;
    let updated = 0;
    let disabled = 0;
    const keys: string[] = [];
    for (const item of models) {
      const modelKey = text(item.modelKey).trim();
      if (!modelKey) continue;
      keys.push(modelKey);
      const rawUnit = text(item.billingUnit).trim().toLowerCase();
      const billingUnit = (PLAZA_BILLING_UNITS as string[]).includes(rawUnit)
        ? (rawUnit as PlazaBillingUnit)
        : 'token';
      const data = {
        upstreamId,
        provider: credentials.provider,
        modelKey,
        upstreamModelKey: modelKey,
        displayName: text(item.displayName).trim() || modelKey,
        quotaType: billingUnit === 'token' ? 'TOKEN' : 'CALL',
        billingUnit,
        category: categoryOf([], item.category),
        inputRmbPrice: Number(item.inputRmbPrice || 0),
        outputRmbPrice: Number(item.outputRmbPrice || 0),
        callRmbPrice: Number(item.callRmbPrice || 0),
        cacheReadRmbPrice: Number(item.cacheReadRmbPrice || 0),
        cacheWriteRmbPrice: Number(item.cacheWriteRmbPrice || 0),
        minimumRmb: Number(item.minimumRmb || 0),
        tiers: Array.isArray(item.tiers) ? item.tiers : [],
        components: Array.isArray(item.components) ? item.components : [],
        enabled,
        createdBy: userId,
      };
      const exists = await this.prisma.modelCatalog.findUnique({
        where: {
          provider_modelKey: { provider: credentials.provider, modelKey },
        },
        select: { id: true },
      });
      if (exists) {
        await this.prisma.modelCatalog.update({
          where: { id: exists.id },
          data,
        });
        updated += 1;
      } else {
        await this.prisma.modelCatalog.create({ data });
        created += 1;
      }
    }
    if (disableMissing && keys.length) {
      const res = await this.prisma.modelCatalog.updateMany({
        where: { upstreamId, modelKey: { notIn: keys }, enabled: true },
        data: { enabled: false },
      });
      disabled = res.count;
    }
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'MODEL_CATALOG_IMPORT',
          detail: `upstream=${upstreamId} 新增 ${created} / 更新 ${updated} / 下架 ${disabled}`,
        },
      })
      .catch(() => undefined);
    return { created, updated, disabled };
  }

  async reseed() {
    return ensurePlazaSeed(this.prisma);
  }
}
