import type { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';

/**
 * HRM 公用口径：组织键、日期/工作日计算、九宫格换算、Decimal/Json 视图转换。
 * 工作日 = 区间天数 − 周末 − 节假日（HrmHoliday，含平台全局 orgUserId='' 行）。
 */

export type OrgKey = { orgType: string; orgUserId: string };

/** 本期组织键固定为本人账号名下企业（多组织切换器属 L0 §5.8 机制，业务侧后续接入）。 */
export function orgKeyOf(user: CurrentUser): OrgKey {
  return { orgType: 'ENTERPRISE', orgUserId: user.userId };
}

/** HrmOrg 还带 actorId/角色判定，落库只取组织键两列——Prisma 的 data/where 绝不能整体展开 HrmOrg。 */
export const orgKey = (org: OrgKey): OrgKey => ({
  orgType: org.orgType,
  orgUserId: org.orgUserId,
});

export const ds = (v: unknown, digits = 2): string =>
  Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : (0).toFixed(digits);

export const clip = (v: unknown, max: number): string => text(v).slice(0, max);

export const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : text(v);

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean) : [];
}

/** 简历结构化事实（items JSON 列 → scoring 入参）。 */
export function asResumeItems(v: unknown): {
  id: string;
  kind: string;
  title: string;
  detail: string;
  period: string;
}[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw, idx) => {
      const item = raw as Record<string, unknown>;
      return {
        id: text(item?.id, `auto-${idx}`),
        kind: text(item?.kind, 'SKILL'),
        title: clip(item?.title, 200),
        detail: clip(item?.detail, 2000),
        period: clip(item?.period, 64),
      };
    })
    .slice(0, 100);
}

/** YYYY-MM-DD → UTC 零点（避免本地时区把天数算错）。 */
export function dayStart(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? '').trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

const DAY_MS = 86_400_000;

/**
 * 请假天数：闭区间自然日 − 周六日 − 命中节假日（holidayDays 取该日 days 值，默认 1）。
 * 结果保留 0.5 精度且最小 0.5（半天起请）。
 */
export function workdaysBetween(
  startDate: string,
  endDate: string,
  holidays: Map<string, number>,
): number {
  const start = dayStart(startDate);
  const end = dayStart(endDate);
  if (!start || !end || end < start) return -1;
  let days = 0;
  for (
    let cursor = start.getTime();
    cursor <= end.getTime();
    cursor += DAY_MS
  ) {
    const d = new Date(cursor);
    const weekday = d.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const key = cursorKey(d);
    if (holidays.has(key)) continue;
    days += 1;
  }
  return days;
}

export const cursorKey = (d: Date): string => d.toISOString().slice(0, 10);

/** 绩效×潜力（1~5）→ 九宫格位：三档（<3 低 / <4 中 / ≥4 高），行=绩效列=潜力，1~9。 */
export function gridCellOf(performance: number, potential: number): number {
  const band = (v: number) => (v < 3 ? 0 : v < 4 ? 1 : 2);
  return band(potential) * 3 + band(performance) + 1;
}

/** 当前时间在 09:30 之后算迟到、18:00 之前收工算早退（HRM 内置考勤基线）。 */
export function clockMark(
  at: Date,
  kind: 'in' | 'out',
): 'NORMAL' | 'LATE' | 'EARLY' {
  const d = new Date(at.getTime() + 8 * 3_600_000); // 业务按东八区墙钟判读
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (kind === 'in') return minutes > 9 * 60 + 30 ? 'LATE' : 'NORMAL';
  return minutes < 18 * 60 ? 'EARLY' : 'NORMAL';
}
