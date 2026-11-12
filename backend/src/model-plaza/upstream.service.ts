import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';
import type { PrismaService } from '../prisma/prisma.service';
import { AipddKeyService } from '../account/aipdd-key.service';
import { AccountCrypto } from '../account/account-crypto';
import { aipddBaseUrl, classifyModel } from '../content/content-shared';
import { protocolHeaders } from '../content/model-catalog.service';
import { text } from '../common/api';
import { parseComponents, parseTiers } from './model-plaza.pricing';
import type {
  PlazaBillingUnit,
  PlazaComponent,
  PlazaTier,
} from './model-plaza.pricing';
import type { PlazaCategory } from './model-plaza.category';

const DISCOVER_TIMEOUT_MS = 20000;

/** 本系统对外网关支持的 OpenAI 兼容路径（目录里只登记这些）。 */
export const PLAZA_ENDPOINTS = [
  '/chat/completions',
  '/embeddings',
  '/images/generations',
  '/images/edits',
  '/audio/speech',
  '/audio/transcriptions',
  '/videos',
] as const;

export type PlazaProtocol = 'openai' | 'anthropic';

export type PlazaCredentials = {
  upstreamId: number;
  provider: string;
  baseUrl: string;
  apiKey: string;
  protocol: PlazaProtocol;
  upstreamName: string;
};

export type DiscoveredModel = {
  modelKey: string;
  kind: string;
  vision: boolean;
  endpoints: string[];
  displayName: string;
  billingUnit: PlazaBillingUnit;
  category: PlazaCategory;
  inputRmbPrice: number;
  outputRmbPrice: number;
  callRmbPrice: number;
  cacheReadRmbPrice: number;
  cacheWriteRmbPrice: number;
  minimumRmb: number;
  tiers: PlazaTier[];
  components: PlazaComponent[];
};

/** 上游 kind → 目录分类。 */
function categoryOfKind(kind: string): PlazaCategory {
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'video';
  if (kind === 'audio' || kind === 'asr') return 'audio';
  if (kind === 'embedding') return 'embedding';
  if (kind === 'llm' || kind === 'text') return 'text';
  return 'other';
}

/** 没有上游元数据（自定义渠道）时按能力推断计费单位。 */
function defaultUnitOf(kind: string): PlazaBillingUnit {
  if (kind === 'image') return 'image';
  if (kind === 'video' || kind === 'asr') return 'second';
  if (kind === 'audio') return 'call';
  return 'token';
}

/** 上游 `aipdd.pricing` → 与本系统完全一致的计费规格；缺字段按 0 处理。 */
function priceOf(
  kind: string,
  pricing: Record<string, unknown>,
): Pick<
  DiscoveredModel,
  | 'billingUnit'
  | 'inputRmbPrice'
  | 'outputRmbPrice'
  | 'callRmbPrice'
  | 'cacheReadRmbPrice'
  | 'cacheWriteRmbPrice'
  | 'minimumRmb'
  | 'tiers'
  | 'components'
> {
  const rawUnit = text(pricing.billing_unit).trim().toLowerCase();
  const billingUnit: PlazaBillingUnit =
    rawUnit === 'token' ||
    rawUnit === 'image' ||
    rawUnit === 'second' ||
    rawUnit === 'call'
      ? rawUnit
      : defaultUnitOf(kind);
  const num = (key: string) => {
    const value = Number(pricing[key] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    billingUnit,
    inputRmbPrice: billingUnit === 'token' ? num('prompt_rmb_per_million') : 0,
    outputRmbPrice:
      billingUnit === 'token' ? num('completion_rmb_per_million') : 0,
    callRmbPrice: billingUnit === 'token' ? 0 : num('unit_rmb'),
    cacheReadRmbPrice: num('cache_read_rmb_per_million'),
    cacheWriteRmbPrice: num('cache_write_rmb_per_million'),
    minimumRmb: num('minimum_rmb'),
    tiers: parseTiers(pricing.tiers),
    components: parseComponents(pricing.components),
  };
}

/** kind → 本系统支持的端点；上游声明的 /messages、/responses 不在白名单内。 */
function endpointsOf(kind: string, declared: string[]): string[] {
  const allowed = new Set<string>(PLAZA_ENDPOINTS);
  const normalized = declared
    .map((item) => item.replace(/^\/v1/, ''))
    .filter((item) => allowed.has(item));
  if (normalized.length) return Array.from(new Set(normalized));
  switch (kind) {
    case 'image':
      return ['/images/generations', '/images/edits'];
    case 'video':
      return ['/videos'];
    case 'audio':
      return ['/audio/speech'];
    case 'asr':
      return ['/audio/transcriptions'];
    case 'embedding':
      return ['/embeddings'];
    default:
      return ['/chat/completions'];
  }
}

export class ModelUpstreamService {
  private readonly aipdd: AipddKeyService;
  private readonly crypto = new AccountCrypto();

  constructor(private readonly prisma: PrismaService) {
    this.aipdd = new AipddKeyService(prisma);
  }

  /** AIPDD 渠道的凭据：固定平台级 Key（系统设置里那把）。 */
  async aipddCredentials(): Promise<PlazaCredentials> {
    const apiKey = await this.aipdd.resolvePlatformToken();
    if (!apiKey) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '平台还没有配置 AIPDD API Key：请到「平台管理后台 → 系统配置」填写后再试',
      );
    }
    return {
      upstreamId: 0,
      provider: 'AIPDD',
      baseUrl: aipddBaseUrl(),
      apiKey,
      protocol: 'openai',
      upstreamName: 'AIPDD',
    };
  }

  /** upstreamId=0 走 AIPDD 平台 Key；>0 走管理员保存的上游渠道（密文解密后仅本进程使用）。 */
  async credentials(upstreamId: number): Promise<PlazaCredentials> {
    if (!upstreamId) return this.aipddCredentials();
    const row = await this.prisma.modelUpstream.findUnique({
      where: { id: upstreamId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '上游渠道不存在，请刷新后重试',
      );
    }
    if (!row.enabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `上游渠道「${row.name}」已停用`,
      );
    }
    let apiKey = '';
    try {
      apiKey = this.crypto.decrypt(row.keyCipher);
    } catch {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `上游渠道「${row.name}」的 Key 无法解密（EXTERNAL_CRED_KEY 变更过），请重新保存`,
      );
    }
    if (!apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `上游渠道「${row.name}」还没有配置 API Key`,
      );
    }
    return {
      upstreamId: row.id,
      provider: row.provider,
      baseUrl: row.baseUrl,
      apiKey,
      protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
      upstreamName: row.name,
    };
  }

  async list() {
    const [rows, aipdd] = await Promise.all([
      this.prisma.modelUpstream.findMany({ orderBy: { id: 'asc' } }),
      this.aipdd.platformKeyView(),
    ]);
    const counts = await this.prisma.modelCatalog.groupBy({
      by: ['upstreamId'],
      _count: { _all: true },
    });
    const countOf = (id: number) =>
      counts.find((row) => row.upstreamId === id)?._count._all ?? 0;
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        provider: row.provider,
        baseUrl: row.baseUrl,
        protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
        enabled: row.enabled,
        remark: row.remark,
        keyMasked: row.keyCipher ? this.mask(row.keyCipher) : '',
        modelCount: countOf(row.id),
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      aipdd: {
        baseUrl: aipddBaseUrl(),
        configured: aipdd.configured,
        masked: aipdd.masked,
        source: aipdd.source,
      },
    };
  }

  /**
   * 保存上游渠道。新增或改了 Key 时必须先连通上游 `/models` 校验通过才落库——
   * 这样「目录里能选的渠道」天然都是可用凭据，避免用户选了才发现 Key 是错的。
   */
  async save(
    userId: string,
    body: {
      id: number;
      name: string;
      provider: string;
      baseUrl: string;
      protocol: PlazaProtocol;
      apiKey: string;
      enabled: boolean;
      remark: string;
    },
  ) {
    const existing = body.id
      ? await this.prisma.modelUpstream.findUnique({ where: { id: body.id } })
      : null;
    if (body.id && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '上游渠道不存在');
    }
    const duplicated = await this.prisma.modelUpstream.findFirst({
      where: { name: body.name, NOT: { id: existing?.id ?? 0 } },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '渠道名称已存在，请换一个名字',
      );
    }
    const plainKey = body.apiKey.trim();
    let keyCipher = existing?.keyCipher ?? '';
    if (plainKey) {
      // 校验通过才加密落库；失败直接抛出可读错误
      await this.discover(body.baseUrl, plainKey, body.protocol);
      keyCipher = this.crypto.encrypt(plainKey);
    } else if (!keyCipher) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 API Key：未配置且校验通过的渠道不能用于调用模型',
      );
    } else if (body.enabled) {
      // 只改名称/地址而没重填 Key：用已存 Key 再验一次，防止地址改错后变成「能选但调不通」
      await this.discover(
        body.baseUrl,
        this.crypto.decrypt(keyCipher),
        body.protocol,
      );
    }
    const row = existing
      ? await this.prisma.modelUpstream.update({
          where: { id: existing.id },
          data: {
            name: body.name,
            provider: body.provider,
            baseUrl: body.baseUrl,
            protocol: body.protocol,
            keyCipher,
            enabled: body.enabled,
            remark: body.remark,
          },
        })
      : await this.prisma.modelUpstream.create({
          data: {
            name: body.name,
            provider: body.provider,
            baseUrl: body.baseUrl,
            protocol: body.protocol,
            keyCipher,
            enabled: body.enabled,
            remark: body.remark,
            createdBy: userId,
          },
        });
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          action: existing ? 'MODEL_UPSTREAM_UPDATE' : 'MODEL_UPSTREAM_CREATE',
          detail: `#${row.id} ${row.name}`,
        },
      })
      .catch(() => undefined);
    const view = await this.list();
    return view.list.find((item) => item.id === row.id)!;
  }

  /** 删除上游渠道：连带删除它的目录行（没有凭据的模型留着只会调用失败）。 */
  async remove(userId: string, id: number) {
    const existing = await this.prisma.modelUpstream.findUnique({
      where: { id },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '上游渠道不存在');
    const removedModels = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.modelCatalog.deleteMany({
        where: { upstreamId: id },
      });
      await tx.modelUpstream.delete({ where: { id } });
      return deleted.count;
    });
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'MODEL_UPSTREAM_REMOVE',
          detail: `#${id} ${existing.name}，同时移除 ${removedModels} 个模型`,
        },
      })
      .catch(() => undefined);
    return { id, removedModels };
  }

  /**
   * 拉取上游模型清单。baseUrl + apiKey 传了就用临时的（不入库）；
   * 否则按 upstreamId 取已保存凭据（0 = AIPDD 平台 Key）。
   */
  async discoverModels(input: {
    upstreamId: number;
    baseUrl: string;
    apiKey: string;
    protocol: PlazaProtocol;
  }): Promise<{ credentials: PlazaCredentials; models: DiscoveredModel[] }> {
    let credentials: PlazaCredentials;
    if (input.baseUrl.trim()) {
      const apiKey = input.apiKey.trim();
      if (!apiKey) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请填写临时拉取用的 API Key',
        );
      }
      credentials = {
        upstreamId: input.upstreamId,
        provider: input.upstreamId ? 'LocalAPI' : 'AIPDD',
        baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
        apiKey,
        protocol: input.protocol,
        upstreamName: '临时渠道',
      };
    } else {
      credentials = await this.credentials(input.upstreamId);
    }
    return {
      credentials,
      models: await this.discover(
        credentials.baseUrl,
        credentials.apiKey,
        credentials.protocol,
      ),
    };
  }

  /** 调上游 `GET {base}/models` 并归一；同时兼作「Key 是否可用」的连通校验。 */
  async discover(
    baseUrl: string,
    apiKey: string,
    protocol: PlazaProtocol,
  ): Promise<DiscoveredModel[]> {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    if (!base)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '渠道地址为空');
    if (!apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该渠道还没有配置 API Key',
      );
    }
    let response;
    try {
      response = await httpRequest<string>(`${base}/models`, {
        headers: protocolHeaders(apiKey, protocol),
        timeoutMs: DISCOVER_TIMEOUT_MS,
        readAs: 'text',
        operation: 'model-plaza:models',
      });
    } catch (error) {
      if (error instanceof TransportError && error.kind === 'timeout') {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `校验超时（${DISCOVER_TIMEOUT_MS} ms）：渠道地址不可达`,
        );
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '校验失败：渠道地址不可达',
      );
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `API Key 校验失败（上游 HTTP ${response.status}）：请检查 Key 与渠道地址`,
      );
    }
    let payload: { data?: unknown };
    try {
      payload = JSON.parse(response.data) as { data?: unknown };
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '模型列表不是合法 JSON（渠道地址可能填成了网页地址）',
      );
    }
    const raw = Array.isArray(payload.data) ? payload.data : [];
    const models: DiscoveredModel[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const meta = (entry.aipdd || {}) as Record<string, unknown>;
      if (meta.available === false) continue;
      const classified = classifyModel(entry);
      if (!classified.id) continue;
      const pricing = (meta.pricing || {}) as Record<string, unknown>;
      models.push({
        modelKey: classified.id,
        kind: classified.kind,
        vision: classified.vision,
        endpoints: endpointsOf(classified.kind, classified.endpoints),
        displayName: text(meta.display_name).trim() || classified.id,
        category: categoryOfKind(classified.kind),
        ...priceOf(classified.kind, pricing),
      });
    }
    if (!models.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该渠道没有返回任何可用模型',
      );
    }
    return models;
  }

  private mask(keyCipher: string) {
    try {
      const plain = this.crypto.decrypt(keyCipher);
      return plain.length <= 8
        ? '*'.repeat(plain.length)
        : `${plain.slice(0, 4)}…${plain.slice(-4)}`;
    } catch {
      return '****';
    }
  }
}
