import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import { ScrmScopeService } from './scrm.scope';
import { ScrmContactService } from './scrm-contact.service';
import { ScrmChatService } from './scrm-chat.service';
import {
  dayKey,
  dayStart,
  int,
  nameOf,
  orgKey,
  orgOf,
  recentDays,
} from './scrm.helpers';

/**
 * SCRM 统计：概览、趋势、员工排行与导出。
 * 客户/群/待办都是实时聚合；群发按日快照（scrm_stat_daily）汇总，
 * 导出走 §5.8 横切机制的 ExportJob，文件落自有 OSS 并进导出账本。
 */

export const SCRM_EXPORT_MODULE = 'scrm_stats';

export class ScrmStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly contacts: ScrmContactService,
    private readonly chats: ScrmChatService,
    private readonly mechanisms: MechanismService,
  ) {}

  private async dailyRows(org: HrmOrg, days: number) {
    const list = recentDays(days);
    const rows = await this.prisma.scrmStatDaily.findMany({
      where: { ...orgKey(org), day: { in: list } },
      orderBy: { day: 'asc' },
    });
    const byDay = new Map(rows.map((row) => [row.day, row]));
    return list.map((day) => {
      const row = byDay.get(day);
      return {
        day,
        added: row?.added || 0,
        lost: row?.lost || 0,
        net: row?.net || 0,
        massSent: row?.massSent || 0,
        massDelivered: row?.massDelivered || 0,
      };
    });
  }

  async overview(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const [counts, chatCounts, daily] = await Promise.all([
      this.contacts.counts(org),
      this.chats.counts(org),
      this.dailyRows(org, 7),
    ]);
    const today = daily.find((row) => row.day === dayKey());
    return {
      contacts: counts.contacts,
      todayAdded: counts.todayAdded,
      lost: counts.lost,
      chats: chatCounts.chats,
      chatMembers: chatCounts.members,
      todayMassSent: today?.massSent || 0,
      todayMassDelivered: today?.massDelivered || 0,
      activeStaff: counts.activeStaff,
      daily: daily.map((row) => ({
        day: row.day,
        added: row.added,
        lost: row.lost,
        net: row.net,
      })),
    };
  }

  async trend(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const days = Math.min(180, Math.max(7, int(query.days, 30) || 30));
    const daily = await this.dailyRows(org, days);
    return {
      days,
      points: daily.map((row) => ({
        day: row.day,
        added: row.added,
        lost: row.lost,
        net: row.net,
      })),
      mass: daily.map((row) => ({
        day: row.day,
        sent: row.massSent,
        delivered: row.massDelivered,
      })),
    };
  }

  async staff(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const days = Math.min(180, Math.max(7, int(query.days, 30) || 30));
    const from = dayStart(recentDays(days)[0]);
    const [links, contacts, mass, tasks] = await Promise.all([
      this.prisma.scrmContactStaff.findMany({
        where: orgKey(org),
        select: { staffUserId: true, contactId: true },
      }),
      this.prisma.scrmContact.findMany({
        where: { ...orgKey(org), status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.scrmMassTarget.groupBy({
        by: ['staffUserId'],
        where: {
          ...orgKey(org),
          status: 'SENT',
          sentAt: { gte: from },
        },
        _count: { _all: true },
      }),
      this.prisma.scrmSopTask.findMany({
        where: { ...orgKey(org), createdAt: { gte: from } },
        select: { staffUserId: true, status: true },
      }),
    ]);
    const activeContacts = new Set(contacts.map((row) => row.id));
    const contactCount = new Map<string, number>();
    for (const link of links) {
      if (!link.staffUserId || !activeContacts.has(link.contactId)) continue;
      contactCount.set(
        link.staffUserId,
        (contactCount.get(link.staffUserId) || 0) + 1,
      );
    }
    const chatRows = await this.prisma.scrmChat.findMany({
      where: { ...orgKey(org), status: 'ACTIVE', ownerStaffId: { not: '' } },
      select: { ownerStaffId: true },
    });
    const chatCount = new Map<string, number>();
    for (const row of chatRows) {
      chatCount.set(
        row.ownerStaffId,
        (chatCount.get(row.ownerStaffId) || 0) + 1,
      );
    }
    const massCount = new Map(
      mass.map((row) => [row.staffUserId, row._count._all]),
    );
    const sopTotal = new Map<string, number>();
    const sopDone = new Map<string, number>();
    for (const row of tasks) {
      if (!row.staffUserId) continue;
      sopTotal.set(row.staffUserId, (sopTotal.get(row.staffUserId) || 0) + 1);
      if (row.status === 'DONE') {
        sopDone.set(row.staffUserId, (sopDone.get(row.staffUserId) || 0) + 1);
      }
    }
    const ids = [
      ...new Set([
        ...contactCount.keys(),
        ...chatCount.keys(),
        ...massCount.keys(),
        ...sopTotal.keys(),
      ]),
    ];
    const names = await this.scope.names(ids);
    const rows = ids
      .map((staffUserId) => {
        const total = sopTotal.get(staffUserId) || 0;
        const done = sopDone.get(staffUserId) || 0;
        return {
          staffUserId,
          name: nameOf(names, staffUserId),
          contacts: contactCount.get(staffUserId) || 0,
          chats: chatCount.get(staffUserId) || 0,
          massSent: massCount.get(staffUserId) || 0,
          sopDone: done,
          sopRate: total ? Math.round((done / total) * 100) : 0,
        };
      })
      .sort((a, b) => b.contacts - a.contacts || a.name.localeCompare(b.name));
    return { rows };
  }

  /** 注册统计导出：行数据由本服务提供，任务/文件账本仍归横切机制。 */
  registerExports() {
    this.mechanisms.registerExportModule(
      {
        module: SCRM_EXPORT_MODULE,
        label: '企微SCRM统计',
        columns: ['day', 'added', 'lost', 'net', 'massSent', 'massDelivered'],
      },
      async (org, filters) => {
        const days = Math.min(180, Math.max(7, int(filters.days, 30) || 30));
        return this.dailyRows(orgOf(org), days);
      },
    );
  }

  async export(user: CurrentUser, body: Record<string, unknown>) {
    await this.scope.resolve(user);
    const days = Math.min(180, Math.max(7, int(body.days, 30) || 30));
    const job = await this.mechanisms.createExportJob(user, {
      module: SCRM_EXPORT_MODULE,
      format: 'csv',
      filters: { days },
    });
    return { jobId: job.id, status: job.status };
  }
}
