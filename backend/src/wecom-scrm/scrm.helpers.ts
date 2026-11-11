import type { Prisma } from '../../generated/prisma';
import type { HrmOrg } from '../hrm/hrm.scope';
import { clip, iso } from '../hrm/hrm.helpers';
import type { PrismaService } from '../prisma/prisma.service';

export { clip };

/**
 * SCRM 公用口径：组织键、JSON 视图、日期、日快照累加、客户时间线。
 * 企微是客户/标签/群的唯一源，本地只做镜像；所有读写都带 (orgType, orgUserId)。
 */

export type Row = Record<string, unknown>;
export type OrgKey = { orgType: string; orgUserId: string };

export const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

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

export const orgKey = (org: HrmOrg | OrgKey): OrgKey => ({
  orgType: org.orgType,
  orgUserId: org.orgUserId,
});

export const orgOf = (key: OrgKey): HrmOrg => ({
  ...orgKey(key),
  actorId: '',
  isOwner: false,
  isAdmin: false,
  roles: [],
  positions: [],
  department: '',
});

/**
 * 客户与标签、归属员工都是独立关联表，客户表上没有关系字段；
 * 按这些关系筛客户时先查关联表拿 contactId，多个条件取交集。
 * 没有关系条件时返回 null，调用方不追加 id 过滤。
 */
export async function contactIdsByRelation(
  prisma: PrismaService,
  org: HrmOrg | OrgKey,
  filter: { tagIds?: number[]; staffUserIds?: string[] },
): Promise<number[] | null> {
  const sets: number[][] = [];
  const tagIds = filter.tagIds ?? [];
  if (tagIds.length) {
    const rows = await prisma.scrmContactTag.findMany({
      where: { ...orgKey(org), tagId: { in: tagIds } },
      select: { contactId: true },
    });
    sets.push(rows.map((row) => row.contactId));
  }
  const staffUserIds = filter.staffUserIds ?? [];
  if (staffUserIds.length) {
    const rows = await prisma.scrmContactStaff.findMany({
      where: { ...orgKey(org), staffUserId: { in: staffUserIds } },
      select: { contactId: true },
    });
    sets.push(rows.map((row) => row.contactId));
  }
  if (!sets.length) return null;
  const [first, ...rest] = sets.map((list) => new Set(list));
  return [...first].filter((id) => rest.every((set) => set.has(id)));
}

/** 业务日（北京时间）：日快照与「今日」统计统一用它，避免服务器时区漂移。 */
export const dayKey = (at: Date = new Date()): string => {
  const shifted = new Date(at.getTime() + 8 * 3600_000);
  return shifted.toISOString().slice(0, 10);
};

export const dayStart = (day: string): Date => {
  const parsed = new Date(`${day}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const dateOr = (v: unknown): Date | null => {
  const raw = text(v).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const secondsOr = (v: unknown): Date | null => {
  const n = num(v, 0);
  return n > 0 ? new Date(n * 1000) : null;
};

export const timeOf = (v: unknown): string => {
  const parsed = dateOr(v) || secondsOr(v);
  return parsed ? iso(parsed) : '';
};

/** 日快照累加：调用方只传增量，负数用于流失/失败回退。 */
export async function bumpStatDaily(
  prisma: PrismaService,
  org: OrgKey,
  patch: {
    day?: string;
    added?: number;
    lost?: number;
    massSent?: number;
    massDelivered?: number;
  },
): Promise<void> {
  const day = patch.day || dayKey();
  const added = patch.added ?? 0;
  const lost = patch.lost ?? 0;
  await prisma.scrmStatDaily.upsert({
    where: {
      orgType_orgUserId_day: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        day,
      },
    },
    create: {
      ...orgKey(org),
      day,
      added,
      lost,
      net: added - lost,
      massSent: patch.massSent ?? 0,
      massDelivered: patch.massDelivered ?? 0,
    },
    update: {
      added: { increment: added },
      lost: { increment: lost },
      net: { increment: added - lost },
      massSent: { increment: patch.massSent ?? 0 },
      massDelivered: { increment: patch.massDelivered ?? 0 },
    },
  });
}

export async function addTimeline(
  prisma: PrismaService,
  org: OrgKey,
  contactId: number,
  kind: string,
  title: string,
  detail = '',
  at: Date = new Date(),
): Promise<void> {
  if (!contactId) return;
  await prisma.scrmTimelineEvent.create({
    data: {
      ...orgKey(org),
      contactId,
      kind: clip(kind, 24),
      title: clip(title, 120),
      detail: clip(detail, 4000),
      at,
    },
  });
}

/** 员工展示名：先按账号 id 查，查不到时（外部 userid 兜底）原样展示。 */
export function nameOf(names: Map<string, string>, id: string): string {
  return names.get(id) || id;
}

/** 一周内的日期键（含今天），用于趋势图补齐空白天。 */
export function recentDays(days: number, end: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(dayKey(new Date(end.getTime() - i * 86_400_000)));
  }
  return out;
}

/** 分页游标收敛：负数/非数字一律回到默认页。 */
export function safePage(page: unknown, pageSize: unknown, fallback = 20) {
  const p = Math.max(1, Math.min(int(page, 1) || 1, 100_000));
  const size = Math.max(1, Math.min(int(pageSize, fallback) || fallback, 200));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}
