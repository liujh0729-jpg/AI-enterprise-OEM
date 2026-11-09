/**
 * 模型广场计价纯函数：与上游 `aipdd.pricing` 完全同口径。
 *
 * 计费单位四种：token（每百万 tokens）、image（按张）、second（按秒）、call（按次）；
 * 人民币价是「官方原价」，平台只加一个折扣率（discountRate），
 * 积分一律由系统设置里的汇率换算（1 元 = rate 积分），用户不可单独定价。
 * 无 IO，便于单测。
 */

export const PLAZA_USAGE_CODE = 'model_plaza';
/** token 类目录价的人民币口径：每百万 tokens。 */
export const TOKENS_PER_PRICE_UNIT = 1_000_000;
/** 积分账本最小单元，与 PointsService 的 4 位精度一致。 */
export const LEDGER_MIN_POINTS = 0.0001;

export type PlazaBillingUnit = 'token' | 'image' | 'second' | 'call';

export const PLAZA_BILLING_UNITS: PlazaBillingUnit[] = [
  'token',
  'image',
  'second',
  'call',
];

/** 上游分档：match 里的键值全部命中才采用该档单价（人民币，官方价）。 */
export interface PlazaTier {
  match: Record<string, string>;
  unitRmb: number;
}

/** 上游附加计费组件，目前用于图像编辑的参考图超出量。 */
export interface PlazaComponent {
  code: string;
  freeUnits: number;
  unit: PlazaBillingUnit;
  unitRmb: number;
  tiers: PlazaTier[];
}

export interface PlazaPriceRow {
  billingUnit?: string | null;
  quotaType?: string | null;
  inputRmbPrice: unknown;
  outputRmbPrice: unknown;
  callRmbPrice: unknown;
  cacheReadRmbPrice?: unknown;
  cacheWriteRmbPrice?: unknown;
  minimumRmb?: unknown;
  tiers?: unknown;
  components?: unknown;
  discountRate?: unknown;
}

export interface PlazaMoney {
  inputRmb: number;
  outputRmb: number;
  unitRmb: number;
  cacheReadRmb: number;
  cacheWriteRmb: number;
  minimumRmb: number;
}

export interface PlazaPoints {
  inputPoints: number;
  outputPoints: number;
  unitPoints: number;
  cacheReadPoints: number;
  cacheWritePoints: number;
  minimumPoints: number;
}

export interface PlazaPriceView {
  billingUnit: PlazaBillingUnit;
  /** 平台折扣率：0.85 表示官方价 85 折；1 表示不打折。 */
  discountRate: number;
  /** 上游官方原价。 */
  official: PlazaMoney;
  /** 折后实际收费价。 */
  effective: PlazaMoney;
  /** 折后价按系统汇率换算出的积分价（token 类为每百万 tokens）。 */
  points: PlazaPoints;
  tiers: PlazaTier[];
  components: PlazaComponent[];
  /** 积分恒由系统设置里的汇率换算，用户不可设置。 */
  pointsFromRate: boolean;
}

export interface PlazaUsageInput {
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** image：张数；second：秒数；call：次数。 */
  quantity?: number;
  /** 分档上下文：quality / size / resolution / video_resolution。 */
  tier?: Record<string, string | number | undefined>;
  /** 图像编辑的参考图数量（reference_image_excess 组件）。 */
  referenceImages?: number;
}

export interface PlazaCost {
  points: number;
  /** 折后人民币成本。 */
  rmb: number;
  /** 官方原价（折前），用于对账上游账单。 */
  officialRmb: number;
  billingUnit: PlazaBillingUnit;
  quantity: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Decimal / number / string → 非负有限数。 */
export function toAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function round6(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * 积分账本取整：四舍五入到 4 位；精确值 > 0 但舍入后为 0 时兜到最小账本单元，
 * 避免海量微调用因为舍入而完全免费（上游成本是实打实发生的）。
 */
export function ledgerPoints(exact: number): number {
  if (!(exact > 0)) return 0;
  const rounded = Number(exact.toFixed(4));
  return rounded > 0 ? rounded : LEDGER_MIN_POINTS;
}

/** 目录行 → 计费单位；历史行没有 billingUnit 时按 quotaType 兜底。 */
export function billingUnitOf(row: {
  billingUnit?: string | null;
  quotaType?: string | null;
}): PlazaBillingUnit {
  const unit = String(row.billingUnit || '')
    .trim()
    .toLowerCase();
  if (
    unit === 'token' ||
    unit === 'image' ||
    unit === 'second' ||
    unit === 'call'
  ) {
    return unit;
  }
  return row.quotaType === 'CALL' ? 'call' : 'token';
}

/** 折扣率归一：缺省/非法/超范围一律按不打折处理。 */
export function discountOf(value: unknown): number {
  const n = Number(value ?? 1);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n > 1 ? 1 : n;
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** 上游 tiers JSON → 结构化分档；脏数据直接丢弃。 */
export function parseTiers(value: unknown): PlazaTier[] {
  const list = Array.isArray(value) ? value : [];
  const tiers: PlazaTier[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as { match?: unknown; unitRmb?: unknown };
    const matchRaw = entry.match;
    if (!matchRaw || typeof matchRaw !== 'object') continue;
    const match: Record<string, string> = {};
    for (const [key, raw] of Object.entries(
      matchRaw as Record<string, unknown>,
    )) {
      const textValue = scalarText(raw);
      if (textValue) match[key] = textValue;
    }
    if (!Object.keys(match).length) continue;
    const unitRmb = toAmount(entry.unitRmb);
    if (!(unitRmb > 0)) continue;
    tiers.push({ match, unitRmb });
  }
  return tiers;
}

/** 上游 components JSON → 结构化组件；只保留有正向单价的项。 */
export function parseComponents(value: unknown): PlazaComponent[] {
  const list = Array.isArray(value) ? value : [];
  const components: PlazaComponent[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const code = scalarText(entry.code);
    const unit = billingUnitOf({ billingUnit: scalarText(entry.unit) });
    const unitRmb = toAmount(entry.unitRmb);
    if (!code || !(unitRmb > 0)) continue;
    components.push({
      code,
      freeUnits: Math.max(0, Math.floor(Number(entry.freeUnits ?? 0) || 0)),
      unit,
      unitRmb,
      tiers: parseTiers(entry.tiers),
    });
  }
  return components;
}

/** 尺寸/分辨率归一：`1024×1024`、`1024*1024` 一律转成 `1024x1024`。 */
function normalizeDimension(value: string): string {
  return value.trim().toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '');
}

/**
 * 像素尺寸 → 上游的 1K/2K/4K 档位。
 * 以短边为准：1024x1536 与 1024x1024 同价（都是 1K），与上游 ap-image-2.0 的分档一致。
 */
function qualityFromSize(size: string): string {
  const matched = /^(\d+)\s*x\s*(\d+)$/.exec(normalizeDimension(size));
  if (!matched) return '';
  const shortEdge = Math.min(Number(matched[1]), Number(matched[2]));
  if (!Number.isFinite(shortEdge) || shortEdge <= 0) return '';
  if (shortEdge <= 1024) return '1k';
  if (shortEdge <= 2048) return '2k';
  return '4k';
}

/** 视频分辨率 → 可比较的高度：480p=480、2k=2000、1080P=1080。 */
function resolutionHeight(value: string): number {
  const matched = /(\d+)\s*([pk])/i.exec(value.trim());
  if (!matched) return 0;
  const number = Number(matched[1]);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return matched[2].toLowerCase() === 'k' ? number * 1000 : number;
}

/** 分档上下文取值：`video_resolution` 与平台入参 `resolution` 互为别名。 */
function contextValue(
  context: Record<string, string | number | undefined>,
  key: string,
): string {
  const direct = context[key];
  if (direct !== undefined && direct !== null && direct !== '') {
    const textValue = String(direct);
    return key === 'size'
      ? normalizeDimension(textValue)
      : textValue.trim().toLowerCase();
  }
  const alias =
    key === 'video_resolution'
      ? context.resolution
      : key === 'resolution'
        ? context.video_resolution
        : undefined;
  return alias === undefined || alias === null
    ? ''
    : String(alias).trim().toLowerCase();
}

/**
 * 命中分档：先精确匹配；未命中时做两类兜底，避免高像素请求落到基础价少收费：
 * 1. 只传 size 未传 quality 时，按短边推断 1K/2K/4K 再匹配；
 * 2. 视频分辨率不在上游档位表时，取最接近且不低于请求值的档位（720p → 768p）。
 */
export function matchTier(
  tiers: PlazaTier[],
  context: Record<string, string | number | undefined>,
): number | null {
  const enriched = { ...context };
  const size = contextValue(context, 'size');
  if (size && !contextValue(context, 'quality')) {
    const quality = qualityFromSize(size);
    if (quality) enriched.quality = quality;
  }

  const exact = (source: Record<string, string | number | undefined>) => {
    for (const tier of tiers) {
      const keys = Object.keys(tier.match);
      if (!keys.length) continue;
      const hit = keys.every(
        (key) =>
          contextValue(source, key) === tier.match[key].trim().toLowerCase(),
      );
      if (hit) return tier.unitRmb;
    }
    return null;
  };

  const direct = exact(enriched);
  if (direct !== null) return direct;

  const requested = Math.max(
    resolutionHeight(contextValue(context, 'resolution')),
    resolutionHeight(contextValue(context, 'video_resolution')),
  );
  if (!requested) return null;
  let nearest: { height: number; unitRmb: number } | null = null;
  for (const tier of tiers) {
    const key = Object.keys(tier.match).find(
      (item) => item === 'video_resolution' || item === 'resolution',
    );
    if (!key) continue;
    const height = resolutionHeight(tier.match[key]);
    if (!height || height < requested) continue;
    if (!nearest || height < nearest.height)
      nearest = { height, unitRmb: tier.unitRmb };
  }
  return nearest ? nearest.unitRmb : null;
}

/** 目录行 → 官方原价 / 折后价 / 积分价三视图。 */
export function effectivePrice(
  row: PlazaPriceRow,
  rate: number,
): PlazaPriceView {
  const ratio = Number.isFinite(rate) && rate > 0 ? rate : 0;
  const discountRate = discountOf(row.discountRate);
  const billingUnit = billingUnitOf(row);
  const official: PlazaMoney = {
    inputRmb: toAmount(row.inputRmbPrice),
    outputRmb: toAmount(row.outputRmbPrice),
    unitRmb: toAmount(row.callRmbPrice),
    cacheReadRmb: toAmount(row.cacheReadRmbPrice),
    cacheWriteRmb: toAmount(row.cacheWriteRmbPrice),
    minimumRmb: toAmount(row.minimumRmb),
  };
  const scaled = (value: number) => round6(value * discountRate);
  const effective: PlazaMoney = {
    inputRmb: scaled(official.inputRmb),
    outputRmb: scaled(official.outputRmb),
    unitRmb: scaled(official.unitRmb),
    cacheReadRmb: scaled(official.cacheReadRmb),
    cacheWriteRmb: scaled(official.cacheWriteRmb),
    minimumRmb: scaled(official.minimumRmb),
  };
  const toPoints = (value: number) => round6(value * ratio);
  return {
    billingUnit,
    discountRate,
    official,
    effective,
    points: {
      inputPoints: toPoints(effective.inputRmb),
      outputPoints: toPoints(effective.outputRmb),
      unitPoints: toPoints(effective.unitRmb),
      cacheReadPoints: toPoints(effective.cacheReadRmb),
      cacheWritePoints: toPoints(effective.cacheWriteRmb),
      minimumPoints: toPoints(effective.minimumRmb),
    },
    tiers: parseTiers(row.tiers),
    components: parseComponents(row.components),
    pointsFromRate: true,
  };
}

/** 计量数量：图像/按次取整至少 1，按秒保留 3 位小数。 */
export function quantityOf(unit: PlazaBillingUnit, raw: unknown): number {
  const n = Number(raw);
  if (unit === 'second') {
    return Number.isFinite(n) && n > 0
      ? Math.max(0.001, Number(n.toFixed(3)))
      : 1;
  }
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.floor(n)) : 1;
}

/**
 * 单次调用成本。
 * token：输入/输出/缓存读写分别计，按每百万 tokens；
 * image / second / call：`数量 × 分档单价`，再叠加组件（参考图超出量）与最低消费。
 * 官方价先算出再乘平台折扣，保证与上游账单可逐项对账。
 */
export function computePlazaCost(
  row: PlazaPriceRow,
  rate: number,
  usage: PlazaUsageInput,
): PlazaCost {
  const price = effectivePrice(row, rate);
  const discount = price.discountRate;
  const ratio = rate > 0 ? rate : 0;

  if (price.billingUnit === 'token') {
    const promptTokens = Math.max(0, Math.floor(usage.promptTokens ?? 0));
    const completionTokens = Math.max(
      0,
      Math.floor(usage.completionTokens ?? 0),
    );
    const cacheReadTokens = Math.max(0, Math.floor(usage.cacheReadTokens ?? 0));
    const cacheWriteTokens = Math.max(
      0,
      Math.floor(usage.cacheWriteTokens ?? 0),
    );
    const officialRmb = round6(
      (promptTokens * price.official.inputRmb +
        completionTokens * price.official.outputRmb +
        cacheReadTokens * price.official.cacheReadRmb +
        cacheWriteTokens * price.official.cacheWriteRmb) /
        TOKENS_PER_PRICE_UNIT,
    );
    const rmb = round6(officialRmb * discount);
    return {
      points: ledgerPoints(rmb * ratio),
      rmb,
      officialRmb,
      billingUnit: 'token',
      quantity: 0,
      promptTokens,
      completionTokens,
      cacheReadTokens,
      cacheWriteTokens,
    };
  }

  const quantity = quantityOf(price.billingUnit, usage.quantity);
  const context = usage.tier ?? {};
  const tierRmb = matchTier(price.tiers, context);
  const baseOfficial = tierRmb ?? price.official.unitRmb;
  let officialRmb = baseOfficial * quantity;
  let rmb = round6(baseOfficial * discount) * quantity;
  for (const component of price.components) {
    const chargedUnits = Math.max(
      0,
      Math.floor(usage.referenceImages ?? 0) - component.freeUnits,
    );
    if (!chargedUnits) continue;
    const componentOfficial =
      matchTier(component.tiers, context) ?? component.unitRmb;
    officialRmb += componentOfficial * chargedUnits;
    rmb += round6(componentOfficial * discount) * chargedUnits;
  }
  officialRmb = round6(Math.max(officialRmb, price.official.minimumRmb));
  rmb = round6(Math.max(rmb, price.effective.minimumRmb));
  return {
    points: ledgerPoints(rmb * ratio),
    rmb,
    officialRmb,
    billingUnit: price.billingUnit,
    quantity,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

/** 上游没回传 usage 时的粗估：CJK 约 1 字 1 token，其余约 4 字符 1 token。 */
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : '';
  if (!text) return 0;
  const cjk = (
    text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []
  ).length;
  const rest = text.length - cjk;
  return Math.max(1, Math.ceil(cjk + rest / 4));
}

/** 对话请求体 → 输入 token 粗估（每条消息按 4 token 结构开销计）。 */
export function estimateMessagesTokens(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const item of messages) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (typeof content === 'string') {
      total += estimateTokens(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        total += estimateTokens((part as { text?: unknown }).text);
      }
    }
    total += 4;
  }
  return total;
}

/**
 * 语音文件 → 秒数粗估。上游按秒计费但不一定回传时长，
 * 这里按常见编码码率兜底（WAV 16kHz/16bit 单声道 ≈ 32KB/s）。
 */
export function estimateAudioSeconds(input: {
  bytes?: number;
  mime?: string;
}): number {
  const bytes = Math.max(0, Number(input.bytes ?? 0));
  if (!bytes) return 1;
  const mime = String(input.mime || '').toLowerCase();
  const bytesPerSecond =
    mime.includes('wav') || mime.includes('wave')
      ? 32000
      : mime.includes('ogg') || mime.includes('opus')
        ? 6000
        : 16000;
  return Math.max(0.001, Number((bytes / bytesPerSecond).toFixed(3)));
}

export interface PlazaNormalizedUsage {
  /** 未命中缓存的输入 tokens。 */
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * 上游 usage 归一：兼容 OpenAI（prompt/completion + prompt_tokens_details）、
 * DeepSeek（prompt_cache_hit/miss_tokens）与 Anthropic（input/output + cache_read/creation）。
 * 返回的 promptTokens 是「未命中缓存」的部分，缓存读写在独立字段，避免重复计费。
 */
export function normalizeUsage(payload: unknown): PlazaNormalizedUsage {
  const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== 'object') {
    return {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  }
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = Number(usage[key]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
    return 0;
  };
  const details = usage.prompt_tokens_details as
    { cached_tokens?: unknown } | undefined;
  const openAiCached = Math.max(
    0,
    Math.floor(Number(details?.cached_tokens ?? 0) || 0),
  );
  const deepseekHit = pick('prompt_cache_hit_tokens');
  const deepseekMiss = pick('prompt_cache_miss_tokens');
  const anthropicRead = pick('cache_read_input_tokens');
  const anthropicWrite = pick('cache_creation_input_tokens');
  const promptTotal = pick('prompt_tokens', 'input_tokens');
  const cacheReadTokens = anthropicRead || deepseekHit || openAiCached;
  let promptTokens = promptTotal;
  if (deepseekMiss > 0) {
    // DeepSeek 把输入拆成 hit/miss 两段，prompt_tokens 是两者之和
    promptTokens = deepseekMiss;
  } else if (openAiCached > 0) {
    // OpenAI 的 cached_tokens 是 prompt_tokens 的子集
    promptTokens = Math.max(0, promptTotal - openAiCached);
  }
  return {
    promptTokens,
    completionTokens: pick('completion_tokens', 'output_tokens'),
    cacheReadTokens,
    cacheWriteTokens: anthropicWrite,
  };
}
