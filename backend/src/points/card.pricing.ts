/**
 * 时长卡（日卡 / 30 天卡）计量纯函数：与模型广场计价同一套命中与取整口径。
 *
 * 一张卡只绑一个模型，额度量纲由该模型的 billingUnit 派生：
 * - token：卡的「量」= tokens 个数，本次消耗 = promptTokens + completionTokens（缓存读写不计入卡，见 D5=A）；
 * - image：恒为 1 张 = 1 额度，不看分辨率（管理员明确要求）；
 * - second：本次消耗 = 实际秒数 × 规格倍率（倍率表写在卡规格上）。
 * 无 IO，便于单测。
 */

import {
  matchTier,
  quantityOf,
  toAmount,
  type PlazaTier,
} from '../model-plaza/model-plaza.pricing';
import { asText } from '../gaps/gaps.helpers';

/** 可建卡的量纲：call（按次）没有「量」可表达，不允许建卡。 */
export const CARD_BILLING_UNITS = ['token', 'image', 'second'] as const;
export type CardBillingUnit = (typeof CARD_BILLING_UNITS)[number];

export function isCardBillingUnit(value: unknown): value is CardBillingUnit {
  const unit = asText(value).trim().toLowerCase();
  return (CARD_BILLING_UNITS as readonly string[]).includes(unit);
}

/** 规格倍率行：`{ match: { video_resolution: '720p' }, multiplier: 2 }`。 */
export type CardSpecMultiplierRow = {
  match?: Record<string, unknown>;
  multiplier?: unknown;
};

export type CardMultiplierHit = 'EXACT' | 'NEAREST' | 'BASE';

export type CardMultiplierResult = {
  multiplier: number;
  /** 命中来源：精确档位 / 就近不低于请求值 / 回落基准，写进扣量明细供对账。 */
  hit: CardMultiplierHit;
};

const normalize = (value: unknown) => asText(value).trim().toLowerCase();

function parseRows(raw: unknown): CardSpecMultiplierRow[] {
  let source: unknown = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];
  return source.filter(
    (row): row is CardSpecMultiplierRow =>
      !!row && typeof row === 'object' && !Array.isArray(row),
  );
}

/** 倍率行 → 分档形状（unitRmb 位复用为 multiplier），命中算法与计价完全同一份实现。 */
function multiplierTiers(rows: CardSpecMultiplierRow[]): PlazaTier[] {
  const out: PlazaTier[] = [];
  for (const row of rows) {
    const match = row.match;
    if (!match || typeof match !== 'object') continue;
    const keys = Object.keys(match);
    if (!keys.length) continue;
    const multiplier = Number(row.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) continue;
    const normalized: Record<string, string> = {};
    for (const key of keys) {
      const value = normalize(match[key]);
      if (value) normalized[key] = value;
    }
    if (!Object.keys(normalized).length) continue;
    out.push({ match: normalized, unitRmb: multiplier });
  }
  return out;
}

/**
 * 与 `matchTier` 内的 `contextValue` 同口径取档位上下文，但不含 size→quality 推断：
 * 卡倍率只服务视频秒卡，档位键只会是 video_resolution / resolution（图片卡不看倍率）。
 */
function contextValueForHit(
  context: Record<string, string | number | undefined>,
  key: string,
): string {
  const direct = context[key];
  if (direct !== undefined && direct !== null && String(direct) !== '') {
    return normalize(direct);
  }
  const alias =
    key === 'video_resolution'
      ? context.resolution
      : key === 'resolution'
        ? context.video_resolution
        : undefined;
  return normalize(alias);
}

function isExactHit(
  tiers: PlazaTier[],
  context: Record<string, string | number | undefined>,
): boolean {
  return tiers.some((tier) =>
    Object.entries(tier.match).every(
      ([key, value]) => contextValueForHit(context, key) === value,
    ),
  );
}

/**
 * 规格倍率命中（D7=A）：先交给 `matchTier` 走与计价完全相同的规则
 * （精确匹配 → size 推断 quality → 视频取「不低于请求值的最接近档位」）；
 * 都没命中则回落基准 1 倍，绝不猜更高档，避免多扣用户额度。
 */
export function cardMultiplierOf(
  specMultipliers: unknown,
  tier: Record<string, string | number | undefined> | undefined,
): CardMultiplierResult {
  const tiers = multiplierTiers(parseRows(specMultipliers));
  const context = tier ?? {};
  if (!tiers.length) return { multiplier: 1, hit: 'BASE' };
  const value = matchTier(tiers, context);
  if (value === null) return { multiplier: 1, hit: 'BASE' };
  return {
    multiplier: Number(value.toFixed(4)),
    hit: isExactHit(tiers, context) ? 'EXACT' : 'NEAREST',
  };
}

export type CardUsageInput = {
  billingUnit: string;
  promptTokens?: number;
  completionTokens?: number;
  /** image：张数；second：秒数。 */
  quantity?: number;
  tier?: Record<string, string | number | undefined>;
  specMultipliers?: unknown;
};

export type CardNeed = {
  billingUnit: CardBillingUnit | null;
  /** 本次需要从卡里扣掉的量（同 billingUnit 单位，已含倍率）；无法折算时为 0。 */
  units: number;
  multiplier: number;
  hit: CardMultiplierHit;
};

/** 本次消耗的卡额度：token 用 prompt+completion 个数，image 取整张数，second 秒数×倍率。 */
export function cardUnitsNeeded(input: CardUsageInput): CardNeed {
  const unit = input.billingUnit;
  if (!isCardBillingUnit(unit)) {
    return { billingUnit: null, units: 0, multiplier: 1, hit: 'BASE' };
  }
  if (unit === 'token') {
    const tokens =
      Math.max(0, Math.floor(input.promptTokens ?? 0)) +
      Math.max(0, Math.floor(input.completionTokens ?? 0));
    return {
      billingUnit: unit,
      units: tokens,
      multiplier: 1,
      hit: 'BASE',
    };
  }
  if (unit === 'second') {
    const base = quantityOf('second', input.quantity);
    const rate = cardMultiplierOf(input.specMultipliers, input.tier);
    return {
      billingUnit: unit,
      units: Number((base * rate.multiplier).toFixed(3)),
      multiplier: rate.multiplier,
      hit: rate.hit,
    };
  }
  return {
    billingUnit: unit,
    units: quantityOf('image', input.quantity),
    multiplier: 1,
    hit: 'BASE',
  };
}

/** 额度读法：token 折算成「万 / 亿」，其余按单位原样，界面与提示共用一处口径。 */
export function formatQuota(unit: string, value: number): string {
  const n = toAmount(value);
  if (unit === 'token') {
    if (n >= 100_000_000) return `${trimNumber(n / 100_000_000)} 亿 tokens`;
    if (n >= 10_000) return `${trimNumber(n / 10_000)} 万 tokens`;
    return `${Math.round(n)} tokens`;
  }
  if (unit === 'second') return `${trimNumber(n)} 秒`;
  return `${Math.round(n)} 张`;
}

function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(2));
  return String(rounded);
}

/** 量纲的中文读法；`call` 不能建卡，只为报错文案保留。 */
export const CARD_UNIT_LABELS: Record<string, string> = {
  token: 'tokens',
  image: '张',
  second: '秒',
  call: '次',
};

export function cardUnitLabel(unit: unknown): string {
  const key = asText(unit).trim().toLowerCase();
  return CARD_UNIT_LABELS[key] || asText(unit) || '—';
}

/** 倍率命中来源的中文读法（D7：回落基准 1 倍也要在明细里说清楚）。 */
export const MULTIPLIER_HIT_LABELS: Record<CardMultiplierHit, string> = {
  EXACT: '精确档位',
  NEAREST: '就近档位',
  BASE: '基准 1 倍',
};

/**
 * 用量日志里的卡扣量说明：基准 1 倍且整额扣满时留空，别给每条 token 调用刷噪音。
 */
export function multiplierNote(
  units: number,
  deduct: number,
  quote: { multiplier: number; hit: CardMultiplierHit },
): string {
  const parts: string[] = [];
  if (quote.hit !== 'BASE' || quote.multiplier !== 1) {
    parts.push(
      `卡倍率 ${quote.multiplier} × ${MULTIPLIER_HIT_LABELS[quote.hit] ?? '基准 1 倍'}`,
    );
  }
  if (deduct < units) parts.push('卡额度不足，差额转积分');
  return parts.join('，');
}
