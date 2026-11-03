import { OKR_DEFAULT_SCORE_DIMENSIONS } from '@enterprise/contracts';
import { text } from '../common/api';

export type OkrPosition = { name: string; description: string };
export type OkrDimension = { key: string; label: string; weight: number };

export const num = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const int = (value: unknown, fallback = 0) =>
  Math.trunc(num(value, fallback));

export const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const clamp = (value: number, min = 0, max = 100) =>
  Math.min(Math.max(value, min), max);

export const iso = (value: Date | null | undefined) =>
  value ? value.toISOString() : '';

/** 日期列只输出 YYYY-MM-DD，避免前端把 00:00Z 显示成前一天。 */
export const dateStr = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : '';

/** `@db.Date` 列按 UTC 零点存，读写都只取日期部分，避免东八区偏移把日期退一天。 */
export const dateOrNull = (value: unknown) => {
  const raw = text(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const dateAt = (value: string) => new Date(`${value}T00:00:00.000Z`);

export const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const jsonArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const asArray = (value: unknown): string[] => {
  if (Array.isArray(value))
    return value.map((item) => text(item).trim()).filter(Boolean);
  const raw = text(value).trim();
  return raw ? raw.split(/[,，\s]+/).filter(Boolean) : [];
};

export const asPositions = (value: unknown): OkrPosition[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      name: text((item as { name?: unknown })?.name)
        .trim()
        .slice(0, 64),
      description: text((item as { description?: unknown })?.description)
        .trim()
        .slice(0, 500),
    }))
    .filter((item) => item.name)
    .slice(0, 5);
};

export const asDimensions = (value: unknown): OkrDimension[] => {
  const rows = jsonArray(value)
    .map((item) => {
      const row = jsonObject(item);
      const key = text(row.key).trim().slice(0, 32);
      const label = text(row.label).trim().slice(0, 32);
      const weight = round(clamp(num(row.weight), 0, 100), 2);
      return key && label ? { key, label, weight } : null;
    })
    .filter((item): item is OkrDimension => Boolean(item));
  return rows.length ? rows : defaultDimensions();
};

export const defaultDimensions = (): OkrDimension[] =>
  OKR_DEFAULT_SCORE_DIMENSIONS.map((item) => ({ ...item }));

/** 进度口径：正向 (cur-start)/(target-start)，反向 (start-cur)/(start-target)，封顶 100。 */
export const progressOf = (
  direction: string,
  startValue: number,
  currentValue: number,
  targetValue: number,
) => {
  if (direction === 'DOWN') {
    if (startValue > targetValue) {
      return round(
        clamp(((startValue - currentValue) / (startValue - targetValue)) * 100),
      );
    }
    return currentValue <= targetValue ? 100 : 0;
  }
  if (targetValue > startValue) {
    return round(
      clamp(((currentValue - startValue) / (targetValue - startValue)) * 100),
    );
  }
  return currentValue >= targetValue ? 100 : 0;
};

export const scoreTotal = (
  scores: OkrDimensionScore[],
  dimensions: OkrDimension[],
) =>
  round(
    scores.reduce((sum, item) => {
      const dimension = dimensions.find((row) => row.key === item.key);
      const weight = dimension ? dimension.weight : item.weight;
      return sum + (num(item.score) * weight) / 100;
    }, 0),
    1,
  );

export type OkrDimensionScore = {
  key: string;
  label: string;
  score: number;
  weight: number;
};

const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;

/** 业务口径统一按东八区取「今天」，服务器时区不影响归期。 */
export const localToday = (now = new Date()) =>
  new Date(now.getTime() + SHANGHAI_OFFSET).toISOString().slice(0, 10);

export const localDate = (now = new Date()) =>
  new Date(now.getTime() + SHANGHAI_OFFSET);

/** 周期边界按自然日；返回 [00:00:00, 23:59:59.999]（UTC 零点，对应 `@db.Date`）。 */
export const dayRange = (start: string, end: string) => {
  const from = new Date(`${start}T00:00:00.000Z`);
  const to = new Date(`${end}T23:59:59.999Z`);
  return { from, to };
};

/** 一周的起点（按设置里的周起始日）。 */
export const startOfWeek = (date: Date, weekStart = 1) => {
  const local = localDate(date);
  const day = local.getUTCDay();
  const diff = (day - weekStart + 7) % 7;
  const start = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
};

/** ISO 周键：2026-W44。周起始日只决定归到哪一周，键仍按该周周四所在 ISO 周。 */
export const weekKeyOf = (date: Date, weekStart = 1) => {
  const start = startOfWeek(date, weekStart);
  const thursday = new Date(start);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  const firstDay = first.getUTCDay() || 7;
  const week = Math.ceil(
    ((thursday.getTime() - first.getTime()) / 86_400_000 + firstDay) / 7,
  );
  return `${year}-W${String(week).padStart(2, '0')}`;
};

export const weekRange = (periodKey: string, weekStart = 1) => {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(periodKey);
  if (!match) {
    const start = startOfWeek(new Date(), weekStart);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { start: dateStr(start), end: dateStr(end), key: periodKey };
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = startOfWeek(jan4, 1);
  monday.setUTCDate(monday.getUTCDate() + (week - 1) * 7);
  const start = startOfWeek(monday, weekStart);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: dateStr(start), end: dateStr(end), key: periodKey };
};

/** 周期默认起止：年度 1/1–12/31，季度/月度按自然日历。 */
export const cycleRange = (kind: string, year: number, period: number) => {
  if (kind === 'YEAR') {
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }
  if (kind === 'QUARTER') {
    const safe = Math.min(Math.max(period || 1, 1), 4);
    const month = (safe - 1) * 3 + 1;
    const endMonth = month + 2;
    const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    return {
      startDate: `${year}-${String(month).padStart(2, '0')}-01`,
      endDate: `${year}-${String(endMonth).padStart(2, '0')}-${endDay}`,
    };
  }
  const safe = Math.min(Math.max(period || 1, 1), 12);
  const endDay = new Date(Date.UTC(year, safe, 0)).getUTCDate();
  return {
    startDate: `${year}-${String(safe).padStart(2, '0')}-01`,
    endDate: `${year}-${String(safe).padStart(2, '0')}-${endDay}`,
  };
};

export const cycleTitle = (kind: string, year: number, period: number) => {
  if (kind === 'YEAR') return `${year} 年度`;
  if (kind === 'QUARTER') return `${year} 年第 ${period || 1} 季度`;
  return `${year} 年 ${period || 1} 月`;
};

export const csvCell = (value: unknown) => {
  const raw = text(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
};

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');
