import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';
import { AipddKeyService } from '../account/aipdd-key.service';
import { billingUnitOf, effectivePrice } from './model-plaza.pricing';
import type { PointsService } from '../points/points.service';
import type { PointsSettingsService } from '../points/points-settings.service';

/** 平台默认模型设置键：与模型广场目录同库，随系统设置一起备份。 */
export const PLATFORM_DEFAULT_SETTINGS_KEY = 'model_platform_defaults';

/** 可按能力分别继承的槽位（与内容创作槽位口径一致）。 */
export const PLATFORM_CAPABILITIES = [
  'text',
  'vision',
  'image',
  'video',
  'asr',
  'audio',
  'embedding',
] as const;
export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

export const PLATFORM_CAPABILITY_LABELS: Record<PlatformCapability, string> = {
  text: '文本',
  vision: '视觉',
  image: '图片',
  video: '视频',
  asr: '语音识别',
  audio: '语音合成',
  embedding: '向量',
};

export type PlatformDefaultLimits = {
  /** 单次调用最多扣多少积分；0＝不限 */
  perCallPoints: number;
  /** 账号每日平台模型消费上限；0＝不限 */
  dailyPoints: number;
  /** 账号每月平台模型消费上限；0＝不限 */
  monthlyPoints: number;
};

export type PlatformDefaultSlotRef = { catalogId: number; modelKey: string };

export type PlatformDefaultsConfig = {
  enabled: boolean;
  models: Partial<Record<PlatformCapability, PlatformDefaultSlotRef>>;
  limits: PlatformDefaultLimits;
  updatedBy: string;
  updatedAt: string;
  history: { at: string; by: string; summary: string }[];
};

const HISTORY_CAP = 30;

function blankConfig(): PlatformDefaultsConfig {
  return {
    enabled: false,
    models: {},
    limits: { perCallPoints: 0, dailyPoints: 0, monthlyPoints: 0 },
    updatedBy: '',
    updatedAt: '',
    history: [],
  };
}

function money(value: number) {
  return Number(value.toFixed(4)).toString();
}

function capacityOfMediaType(value: string): PlatformCapability | null {
  const mediaType = text(value).trim();
  if (mediaType === 'music' || mediaType === 'enhance') return null;
  return (PLATFORM_CAPABILITIES as readonly string[]).includes(mediaType)
    ? (mediaType as PlatformCapability)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function modalitiesOf(value: unknown): string[] {
  const raw = (value || {}) as Record<string, unknown>;
  return strings(raw.input);
}

type CatalogRow = {
  id: number;
  upstreamId: number;
  modelKey: string;
  displayName: string;
  billingUnit: string;
  endpoints: unknown;
  modalities: unknown;
  enabled: boolean;
  sort: number;
  inputRmbPrice: unknown;
  outputRmbPrice: unknown;
  callRmbPrice: unknown;
  cacheReadRmbPrice: unknown;
  cacheWriteRmbPrice: unknown;
  minimumRmb: unknown;
  tiers: unknown;
  components: unknown;
  discountRate: unknown;
};

/** 目录行支持哪些平台默认能力：只按模型自己声明的端点与模态归类，不拿文本模型凑数。 */
function capabilitiesOf(row: CatalogRow): PlatformCapability[] {
  const endpoints = strings(row.endpoints);
  const caps = new Set<PlatformCapability>();
  if (endpoints.includes('/chat/completions')) {
    caps.add('text');
    if (modalitiesOf(row.modalities).includes('image')) caps.add('vision');
  }
  if (
    endpoints.includes('/images/generations') ||
    endpoints.includes('/images/edits')
  ) {
    caps.add('image');
  }
  if (endpoints.includes('/videos')) caps.add('video');
  if (endpoints.includes('/audio/transcriptions')) caps.add('asr');
  if (endpoints.includes('/audio/speech')) caps.add('audio');
  if (endpoints.includes('/embeddings')) caps.add('embedding');
  return [...caps];
}

/** 价格说明：展示用户实际会被扣的折后价，单位与模型广场一致。 */
function priceNote(row: CatalogRow, rate: number) {
  const price = effectivePrice(row, rate);
  if (price.billingUnit === 'token') {
    return `输入 ¥${money(price.effective.inputRmb)} / 输出 ¥${money(
      price.effective.outputRmb,
    )} · 每百万 tokens`;
  }
  const suffix =
    price.billingUnit === 'image'
      ? '张'
      : price.billingUnit === 'second'
        ? '秒'
        : '次';
  return `¥${money(price.effective.unitRmb)} / ${suffix}`;
}

function normalizeLimits(value: unknown): PlatformDefaultLimits {
  const raw = (value || {}) as Record<string, unknown>;
  const pick = (key: string) => {
    const number = Number(raw[key] ?? 0);
    return Number.isFinite(number) && number > 0
      ? Number(number.toFixed(4))
      : 0;
  };
  return {
    perCallPoints: pick('perCallPoints'),
    dailyPoints: pick('dailyPoints'),
    monthlyPoints: pick('monthlyPoints'),
  };
}

/** 配置解析：任何历史脏数据都退回空配置，绝不让一条坏 JSON 拖垮全站取模型。 */
export async function readPlatformDefaults(
  prisma: PrismaService,
): Promise<PlatformDefaultsConfig> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: PLATFORM_DEFAULT_SETTINGS_KEY },
  });
  if (!row?.value) return blankConfig();
  try {
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    const models: Partial<Record<PlatformCapability, PlatformDefaultSlotRef>> =
      {};
    const rawModels = (raw.models || {}) as Record<string, unknown>;
    for (const capability of PLATFORM_CAPABILITIES) {
      const item = rawModels[capability];
      if (!item) continue;
      if (typeof item === 'number') {
        if (item > 0) models[capability] = { catalogId: item, modelKey: '' };
        continue;
      }
      const entry = item as Record<string, unknown>;
      const catalogId = Number(entry.catalogId || 0);
      if (catalogId > 0) {
        models[capability] = {
          catalogId,
          modelKey: text(entry.modelKey),
        };
      }
    }
    const history = Array.isArray(raw.history)
      ? (raw.history as Record<string, unknown>[])
          .map((item) => ({
            at: text(item.at),
            by: text(item.by),
            summary: text(item.summary),
          }))
          .filter((item) => item.summary)
          .slice(0, HISTORY_CAP)
      : [];
    return {
      enabled: raw.enabled === true,
      models,
      limits: normalizeLimits(raw.limits),
      updatedBy: text(raw.updatedBy),
      updatedAt: text(raw.updatedAt),
      history,
    };
  } catch {
    return blankConfig();
  }
}

function dayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * 平台模型消费：只统计本站 LocalAPI 通道（`lk_` 派生令牌，apiKeyId 为空）的扣分，
 * 用户自带 `ek_` Key 的对外调用不占平台默认模型的额度。
 */
async function usageSince(prisma: PrismaService, userId: string, since: Date) {
  const row = await prisma.modelUsageLog.aggregate({
    where: {
      userId,
      apiKeyId: null,
      source: 'API',
      createdAt: { gte: since },
    },
    _sum: { pointsCost: true },
  });
  return Number(Number(row._sum.pointsCost ?? 0).toFixed(4));
}

/** 真实充值资格：只看支付成功的充值单；赠送、调账、邀请奖励都不算。 */
export async function isPlatformEligible(
  prisma: PrismaService,
  userId: string,
): Promise<boolean> {
  const count = await prisma.rechargeOrder.count({
    where: { userId, status: 'PAID' },
  });
  return count > 0;
}

export type PlatformBudget = {
  allowed: boolean;
  todayPoints: number;
  monthPoints: number;
};

/** 日/月限额闸门：0 表示该维度不限；余额由模型广场既有闸门另行把关。 */
export async function platformBudget(
  prisma: PrismaService,
  userId: string,
  limits: PlatformDefaultLimits,
): Promise<PlatformBudget> {
  const [todayPoints, monthPoints] = await Promise.all([
    usageSince(prisma, userId, dayStart()),
    usageSince(prisma, userId, monthStart()),
  ]);
  const overDay = limits.dailyPoints > 0 && todayPoints >= limits.dailyPoints;
  const overMonth =
    limits.monthlyPoints > 0 && monthPoints >= limits.monthlyPoints;
  return { allowed: !overDay && !overMonth, todayPoints, monthPoints };
}

/** 运行时可用性：上游渠道已启用且有 Key（AIPDD 渠道看平台 Key 是否配置）。 */
async function upstreamUsable(
  prisma: PrismaService,
  upstreamId: number,
): Promise<boolean> {
  if (upstreamId === 0) {
    const view = await new AipddKeyService(prisma)
      .platformKeyView()
      .catch(() => null);
    return Boolean(view?.configured);
  }
  const row = await prisma.modelUpstream.findUnique({
    where: { id: upstreamId },
    select: { enabled: true, keyCipher: true },
  });
  return Boolean(row?.enabled && row.keyCipher);
}

/**
 * 统一解析的平台默认层：总开关、该能力配置、充值资格、模型可用、日/月额度
 * 全部成立才返回；否则 null 让调用方走下一级或规则式兜底（静默链路不抛错）。
 */
export async function platformModelFor(
  prisma: PrismaService,
  userId: string,
  mediaType: string,
): Promise<{ catalogId: number; modelKey: string } | null> {
  const capability = capacityOfMediaType(mediaType);
  if (!capability) return null;
  const config = await readPlatformDefaults(prisma).catch(() => null);
  if (!config?.enabled) return null;
  const ref = config.models[capability];
  if (!ref?.catalogId) return null;
  const [eligible, row] = await Promise.all([
    isPlatformEligible(prisma, userId),
    prisma.modelCatalog.findUnique({ where: { id: ref.catalogId } }),
  ]);
  if (!eligible || !row?.enabled) return null;
  if (!capabilitiesOf(row).includes(capability)) return null;
  if (!(await upstreamUsable(prisma, row.upstreamId))) return null;
  const budget = await platformBudget(prisma, userId, config.limits).catch(
    () => ({ allowed: false, todayPoints: 0, monthPoints: 0 }),
  );
  if (!budget.allowed) return null;
  return { catalogId: row.id, modelKey: row.modelKey };
}

/**
 * 平台默认模型配置：管理端维护「总开关 / 各能力默认模型 / 单次·日·月限额 / 变更记录」，
 * 用户侧只看到自己能否继承与当前继承了哪些模型。所有解析实时读目录，不复制模型配置。
 */
export class PlatformDefaultsService {
  private readonly aipdd: AipddKeyService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly settings: PointsSettingsService,
  ) {
    this.aipdd = new AipddKeyService(prisma);
  }

  private async rate() {
    const view = await this.settings.view();
    return view.rate > 0 ? view.rate : 0;
  }

  private async availability() {
    const [aipdd, rows] = await Promise.all([
      this.aipdd.platformKeyView(),
      this.prisma.modelUpstream.findMany({
        select: { id: true, enabled: true, keyCipher: true, name: true },
      }),
    ]);
    const map = new Map<number, { ok: boolean; reason: string }>();
    map.set(0, {
      ok: aipdd.configured,
      reason: aipdd.configured ? '' : '平台未配置 AIPDD API Key',
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
      });
    }
    return map;
  }

  async view() {
    const [config, rate, availability, rows] = await Promise.all([
      readPlatformDefaults(this.prisma),
      this.rate(),
      this.availability(),
      this.prisma.modelCatalog.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'desc' }, { id: 'asc' }],
      }),
    ]);
    const byCapability = new Map<PlatformCapability, CatalogRow[]>();
    for (const capability of PLATFORM_CAPABILITIES) {
      byCapability.set(capability, []);
    }
    for (const row of rows) {
      for (const capability of capabilitiesOf(row)) {
        byCapability.get(capability)?.push(row);
      }
    }
    const slots = PLATFORM_CAPABILITIES.map((capability) => {
      const ref = config.models[capability];
      const selected = ref
        ? rows.find((row) => row.id === ref.catalogId) || null
        : null;
      const upstream = selected ? availability.get(selected.upstreamId) : null;
      const available = Boolean(selected?.enabled && upstream?.ok);
      return {
        capability,
        label: PLATFORM_CAPABILITY_LABELS[capability],
        catalogId: ref?.catalogId || 0,
        modelKey: selected?.modelKey || ref?.modelKey || '',
        displayName:
          selected?.displayName || selected?.modelKey || ref?.modelKey || '',
        available,
        unavailableReason: selected
          ? upstream?.ok
            ? ''
            : upstream?.reason || '模型已下架'
          : ref
            ? '所选模型已从目录删除'
            : '',
        priceNote: selected ? priceNote(selected, rate) : '',
        candidates: (byCapability.get(capability) || []).map((row) => {
          const upstream = availability.get(row.upstreamId);
          return {
            id: row.id,
            modelKey: row.modelKey,
            displayName: row.displayName || row.modelKey,
            available: Boolean(upstream?.ok),
            unavailableReason: upstream?.reason || '',
            billingUnit: billingUnitOf(row),
            priceNote: priceNote(row, rate),
          };
        }),
      };
    });
    return {
      enabled: config.enabled,
      limits: config.limits,
      slots,
      history: config.history,
      updatedAt: config.updatedAt,
      rate,
    };
  }

  async save(userId: string, body: Record<string, unknown>) {
    const before = await readPlatformDefaults(this.prisma);
    const enabled = body.enabled === true;
    const limits = normalizeLimits(body.limits);
    const rawModels = (body.models || {}) as Record<string, unknown>;
    const ids = Object.values(rawModels)
      .map((value) => Number(value || 0))
      .filter((id) => Number.isInteger(id) && id > 0);
    const rows = ids.length
      ? await this.prisma.modelCatalog.findMany({
          where: { id: { in: ids } },
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const models: Partial<Record<PlatformCapability, PlatformDefaultSlotRef>> =
      {};
    for (const capability of PLATFORM_CAPABILITIES) {
      const catalogId = Number(rawModels[capability] || 0);
      if (!catalogId) continue;
      const row = byId.get(catalogId);
      if (!row) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${PLATFORM_CAPABILITY_LABELS[capability]}」所选模型不在目录里，请刷新后重选`,
        );
      }
      if (!row.enabled) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${row.displayName || row.modelKey}」尚未上架，不能作为平台默认模型`,
        );
      }
      if (!capabilitiesOf(row).includes(capability)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${row.displayName || row.modelKey}」不支持「${PLATFORM_CAPABILITY_LABELS[capability]}」能力`,
        );
      }
      models[capability] = { catalogId: row.id, modelKey: row.modelKey };
    }
    if (enabled && !Object.keys(models).length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '开启平台默认模型前，至少要为一个能力选择默认模型',
      );
    }

    const changes: string[] = [];
    if (before.enabled !== enabled) {
      changes.push(enabled ? '开启平台默认模型' : '关闭平台默认模型');
    }
    for (const capability of PLATFORM_CAPABILITIES) {
      const oldId = before.models[capability]?.catalogId || 0;
      const nextId = models[capability]?.catalogId || 0;
      if (oldId === nextId) continue;
      const label = PLATFORM_CAPABILITY_LABELS[capability];
      changes.push(
        nextId
          ? `${label} → ${models[capability]?.modelKey || `#${nextId}`}`
          : `${label} → 取消`,
      );
    }
    if (
      before.limits.perCallPoints !== limits.perCallPoints ||
      before.limits.dailyPoints !== limits.dailyPoints ||
      before.limits.monthlyPoints !== limits.monthlyPoints
    ) {
      changes.push(
        `限额 单次 ${limits.perCallPoints || '不限'} / 日 ${
          limits.dailyPoints || '不限'
        } / 月 ${limits.monthlyPoints || '不限'}`,
      );
    }

    if (changes.length) {
      const now = new Date();
      const config: PlatformDefaultsConfig = {
        enabled,
        models,
        limits,
        updatedBy: userId,
        updatedAt: now.toISOString(),
        history: [
          {
            at: now.toISOString(),
            by: userId,
            summary: changes.join('；'),
          },
          ...before.history,
        ].slice(0, HISTORY_CAP),
      };
      await this.prisma.systemSetting.upsert({
        where: { key: PLATFORM_DEFAULT_SETTINGS_KEY },
        create: {
          key: PLATFORM_DEFAULT_SETTINGS_KEY,
          value: JSON.stringify(config),
        },
        update: { value: JSON.stringify(config) },
      });
      await this.prisma.auditLog
        .create({
          data: {
            userId,
            action: 'MODEL_PLATFORM_DEFAULTS_UPDATE',
            detail: changes.join('；').slice(0, 500),
          },
        })
        .catch(() => undefined);
    }
    return this.view();
  }

  /** 用户侧：是否具备继承资格、当前继承了哪些模型、今日/本月已用额度。 */
  async userStatus(userId: string) {
    const [
      config,
      rate,
      eligible,
      summary,
      todayPoints,
      monthPoints,
      availability,
    ] = await Promise.all([
      readPlatformDefaults(this.prisma),
      this.rate(),
      isPlatformEligible(this.prisma, userId),
      this.points.summary(userId),
      usageSince(this.prisma, userId, dayStart()),
      usageSince(this.prisma, userId, monthStart()),
      this.availability(),
    ]);
    const ids = Object.values(config.models)
      .map((ref) => ref?.catalogId || 0)
      .filter((id) => id > 0);
    const rows = ids.length
      ? await this.prisma.modelCatalog.findMany({
          where: { id: { in: ids }, enabled: true },
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const slots = PLATFORM_CAPABILITIES.flatMap((capability) => {
      const ref = config.models[capability];
      const row = ref ? byId.get(ref.catalogId) : undefined;
      if (!row || !capabilitiesOf(row).includes(capability)) return [];
      if (!availability.get(row.upstreamId)?.ok) return [];
      return [
        {
          capability,
          label: PLATFORM_CAPABILITY_LABELS[capability],
          modelKey: row.modelKey,
          displayName: row.displayName || row.modelKey,
          priceNote: priceNote(row, rate),
        },
      ];
    });
    const reason = !config.enabled
      ? '管理员还没有开启平台默认模型'
      : !eligible
        ? '完成任意金额充值并到账后，未单独配置的能力会自动使用平台默认模型'
        : !Object.keys(config.models).length
          ? '管理员还没有为任何能力配置默认模型'
          : !slots.length
            ? '平台默认模型暂不可用，请联系管理员检查上游渠道'
            : summary.status === 'ARREARS'
              ? '账号当前欠费，充值补齐后恢复使用平台默认模型'
              : summary.balance <= 0
                ? '积分余额不足，充值后恢复使用平台默认模型'
                : '';
    return {
      enabled: config.enabled,
      eligible,
      reason,
      balance: summary.balance,
      rate,
      limits: config.limits,
      usage: { todayPoints, monthPoints },
      slots: eligible ? slots : [],
    };
  }

  /** 对外网关用：内部 LocalAPI 通道的限额配置（0 全部代表不限）。 */
  async limits() {
    const config = await readPlatformDefaults(this.prisma);
    return config.limits;
  }
}
