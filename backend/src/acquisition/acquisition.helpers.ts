import type { HrmOrg } from '../hrm/hrm.scope';
import type { JsonInput } from '../common/json-input';
import { toJsonInput } from '../common/json-input';
import { clip, iso } from '../hrm/hrm.helpers';
import {
  ACQ_CONTACT_FIELDS,
  ACQ_CONTACT_VISIBILITIES,
} from '@enterprise/contracts';

export type Row = Record<string, unknown>;
export type OrgKey = { orgType: string; orgUserId: string };

export const json = (value: unknown): JsonInput => toJsonInput(value);

export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const int = (v: unknown, fallback = 0): number =>
  Math.trunc(num(v, fallback));

export const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};

export const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

export const intArr = (v: unknown): number[] =>
  Array.isArray(v)
    ? v
        .map((x) => Math.trunc(Number(x)))
        .filter((x) => Number.isFinite(x) && x > 0)
    : [];

export const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  allowed.includes(String(value) as T) ? (String(value) as T) : fallback;

export const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

/** 只取组织键两列：HrmOrg 还带 actorId/isAdmin 等，直接展开会写进 Prisma 报未知字段。 */
export const orgKey = (org: HrmOrg | OrgKey): OrgKey => ({
  orgType: org.orgType,
  orgUserId: org.orgUserId,
});

/** 调度器与插件回执侧没有登录用户；dispatch 只读组织键两列，身份字段留空不假造管理员。 */
export const orgOf = (key: OrgKey): HrmOrg => ({
  ...orgKey(key),
  actorId: '',
  isOwner: false,
  isAdmin: false,
  roles: [],
  positions: [],
  department: '',
});

export const dateOr = (v: unknown): Date | null => {
  const raw = text(v).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const dayFloor = (at: Date): Date => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** 线索去重键：平台 + 平台用户标识相同即同一人。 */
export const dedupeKeyOf = (platform: string, platformUserId: string): string =>
  `${clip(platform, 20)}:${clip(platformUserId, 120)}`.slice(0, 200);

/** 渠道会话键：入站客户尚未提升 CRM 时用它做档案主键。 */
export const peerKeyOf = (channel: string, externalUserId: string): string =>
  `${clip(channel, 20)}:${clip(externalUserId, 160)}`.slice(0, 200);

export type AcqContact = {
  field: (typeof ACQ_CONTACT_FIELDS)[number];
  value: string;
  visibility: (typeof ACQ_CONTACT_VISIBILITIES)[number];
};

/**
 * 归一化插件上报的公开联系方式：只认白名单字段与可见性，逐条裁剪长度。
 * 插件只抽主页上「已公开可见」的字段，服务端不再二次抓取，只做落库前的收敛与去重。
 */
export const contactsOf = (raw: unknown): AcqContact[] => {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: AcqContact[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Row;
    const field = text(row.field) as AcqContact['field'];
    if (!(ACQ_CONTACT_FIELDS as readonly string[]).includes(field)) continue;
    const value = clip(text(row.value).trim(), 200);
    if (!value) continue;
    const visibility = oneOf(
      row.visibility,
      ACQ_CONTACT_VISIBILITIES,
      'PROFILE_PUBLIC',
    );
    const key = `${field}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ field, value, visibility });
    if (out.length >= 20) break;
  }
  return out;
};

/** 去重口径同 contactsOf：同一字段同一取值只留一条，跨证据汇总时用。 */
export const contactKey = (contact: AcqContact): string =>
  `${contact.field}:${contact.value.toLowerCase()}`;

/** 从证据行 JSON 里读回联系方式，脏数据一律丢。 */
export const evidenceContactsOf = (raw: unknown): AcqContact[] =>
  contactsOf(raw);

const minutesOf = (hhmm: string, fallback: number): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!match) return fallback;
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return h * 60 + m;
};

/** 活跃时段判定：跨零点（如 21:00-02:00）按「起点之后或终点之前」处理。 */
export function withinActiveHours(
  at: Date,
  start: string,
  end: string,
): boolean {
  const from = minutesOf(start, 9 * 60);
  const to = minutesOf(end, 21 * 60);
  const now = at.getHours() * 60 + at.getMinutes();
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

/** 把时间推到活跃时段内：早于起点等到起点，晚于终点顺延到次日起点。 */
export function shiftIntoActiveHours(
  at: Date,
  start: string,
  end: string,
): Date {
  if (withinActiveHours(at, start, end)) return at;
  const from = minutesOf(start, 9 * 60);
  const to = minutesOf(end, 21 * 60);
  const now = at.getHours() * 60 + at.getMinutes();
  const result = new Date(at);
  result.setHours(Math.floor(from / 60), from % 60, 0, 0);
  const overnight = from > to;
  if (!overnight && now >= to) result.setDate(result.getDate() + 1);
  if (overnight && now >= to && now < from)
    result.setDate(result.getDate() + 1);
  return result;
}

/** 插件串行执行的随机间隔（毫秒），上下界由组织设置下发。 */
export const randomIntervalMs = (
  minSeconds: number,
  maxSeconds: number,
): number => {
  const lo = Math.max(1, Math.min(minSeconds, maxSeconds));
  const hi = Math.max(lo, Math.max(minSeconds, maxSeconds));
  return Math.round((lo + Math.random() * (hi - lo)) * 1000);
};

export const pageArgs = (query: { page?: unknown; pageSize?: unknown }) => {
  const page = Math.max(1, int(query.page, 1));
  const pageSize = Math.min(200, Math.max(1, int(query.pageSize, 20)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

export const pageResult = <T>(
  list: T[],
  total: number,
  args: { page: number; pageSize: number },
) => ({ list, total, page: args.page, pageSize: args.pageSize });

export const percent = (part: number, whole: number): number =>
  whole > 0 ? Number(((part / whole) * 100).toFixed(2)) : 0;

export { clip, iso };
