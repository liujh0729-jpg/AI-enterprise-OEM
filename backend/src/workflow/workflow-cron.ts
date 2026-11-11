/**
 * 五段标准 cron（分 时 日 月 周）的解析与匹配。
 * 支持通配、数字、列表 `1,2`、区间 `1-5`、步长 `0-30/5` 与 `5/15`；不支持 @daily / 秒段 / 昵称。
 * 日与周同时被限定时按标准 cron 取「或」，只限定其一时另一项视为恒真。
 */

export type CronField = {
  /** 原字段是否为 `*`（日/周的「或」语义要用它区分「不限定」与「限定为全集」）。 */
  any: boolean;
  values: Set<number>;
};

export type CronSpec = {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
};

export type CronParseResult =
  { ok: true; spec: CronSpec } | { ok: false; message: string };

const RANGES: ReadonlyArray<readonly [string, number, number]> = [
  ['分钟', 0, 59],
  ['小时', 0, 23],
  ['日', 1, 31],
  ['月', 1, 12],
  ['星期', 0, 7],
];

const MINUTE_MS = 60_000;

export function parseCron(expression: string): CronParseResult {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      message: 'cron 必须是 5 段（分 时 日 月 周），如 0 9 * * 1-5',
    };
  }
  const fields: CronField[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const [label, min, max] = RANGES[index];
    const parsed = parseField(parts[index], min, max);
    if (!parsed.ok) {
      return { ok: false, message: `cron ${label}段不合法：${parsed.message}` };
    }
    fields.push(parsed.field);
  }
  // 星期 7 与 0 都表示周日，归一到 0 便于匹配。
  const dow = fields[4];
  if (dow.values.has(7)) {
    dow.values.delete(7);
    dow.values.add(0);
  }
  return {
    ok: true,
    spec: {
      minute: fields[0],
      hour: fields[1],
      dom: fields[2],
      month: fields[3],
      dow: fields[4],
    },
  };
}

function parseField(
  raw: string,
  min: number,
  max: number,
): { ok: true; field: CronField } | { ok: false; message: string } {
  const values = new Set<number>();
  let any = false;
  for (const part of raw.split(',')) {
    const [base, stepRaw, extra] = part.split('/');
    if (extra !== undefined || !base) {
      return { ok: false, message: `「${part}」格式不对` };
    }
    let step = 1;
    if (stepRaw !== undefined) {
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step <= 0) {
        return { ok: false, message: `步长「${stepRaw}」必须是正整数` };
      }
    }
    let from = min;
    let to = max;
    if (base === '*') {
      any = stepRaw === undefined;
    } else if (base.includes('-')) {
      const [lo, hi, rest] = base.split('-');
      if (rest !== undefined) {
        return { ok: false, message: `区间「${base}」格式不对` };
      }
      from = Number(lo);
      to = Number(hi);
    } else {
      from = Number(base);
      // `5/15` 语义＝从 5 开始按步长走到上限；裸数字则只取自身。
      to = stepRaw === undefined ? from : max;
    }
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < min ||
      to > max ||
      from > to
    ) {
      return {
        ok: false,
        message: `「${base}」超出 ${min}–${max} 或起止颠倒`,
      };
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  if (!values.size) return { ok: false, message: '没有取到任何值' };
  return { ok: true, field: { any, values } };
}

/** 匹配到分钟：按 Asia/Shanghai 解释（与 common/schedule.ts 同一口径），入参先截断到分钟边界。 */
export function cronMatches(spec: CronSpec, at: Date): boolean {
  const minute = Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS;
  const date = new Date(
    new Date(minute).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }),
  );
  if (!spec.minute.values.has(date.getMinutes())) return false;
  if (!spec.hour.values.has(date.getHours())) return false;
  if (!spec.month.values.has(date.getMonth() + 1)) return false;
  const domHit = spec.dom.values.has(date.getDate());
  const dowHit = spec.dow.values.has(date.getDay());
  if (!spec.dom.any && !spec.dow.any) return domHit || dowHit;
  return domHit && dowHit;
}

/**
 * 取 (fromMinute, toMinute] 区间内所有命中的分钟时间戳（epoch ms）。
 * 调度器用它补上 tick 漂移漏掉的分钟；cap 限制一次最多补多少格，避免长时间停机后集中爆发。
 */
export function dueCronSlots(
  spec: CronSpec,
  fromMinute: number,
  toMinute: number,
  cap = 10,
): number[] {
  const out: number[] = [];
  const start = Math.max(fromMinute + 1, toMinute - cap + 1);
  for (let slot = start; slot <= toMinute; slot += 1) {
    if (cronMatches(spec, new Date(slot * MINUTE_MS)))
      out.push(slot * MINUTE_MS);
  }
  return out;
}

/** 分钟时间戳 → 幂等锚用的 ISO 串（秒与毫秒恒为 0）。 */
export function slotKey(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
