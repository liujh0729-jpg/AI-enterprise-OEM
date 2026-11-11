import { ACQ_PLATFORM_LABELS, ACQ_PRICING_CODES } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import { AcquisitionSettingsService } from './acquisition-settings.service';
import {
  clip,
  int,
  orgKey,
  percent,
  text,
  type OrgKey,
  type Row,
} from './acquisition.helpers';

const FUNNEL_LABELS: { stage: string; label: string }[] = [
  { stage: 'exposure', label: '采集曝光' },
  { stage: 'leads', label: '线索' },
  { stage: 'contacted', label: '已触达' },
  { stage: 'replied', label: '已回复' },
  { stage: 'qualified', label: '商机' },
  { stage: 'deal', label: '成交' },
];

const CONTACTED = ['CONTACTED', 'REPLIED', 'QUALIFIED', 'PROMOTED'];
const REPLIED = ['REPLIED', 'QUALIFIED', 'PROMOTED'];
const QUALIFIED = ['QUALIFIED', 'PROMOTED'];

export const ACQ_DASHBOARD_EXPORT_MODULE = 'acq_dashboard';
const EXPORT_COLUMNS = ['section', 'name', 'count', 'value'];

/**
 * 获客看板（设计 §6）：漏斗 → 渠道 → 触达质量 → 跟进 → 成本。
 * 口径一律以组织键为准；成本按组织成员在 acquisition 板块的用量事实汇总。
 */
export class AcquisitionDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
    private readonly scope: HrmScopeService,
    private readonly mechanisms: MechanismService,
  ) {
    this.mechanisms.registerExportModule(
      {
        module: ACQ_DASHBOARD_EXPORT_MODULE,
        label: '获客看板',
        columns: EXPORT_COLUMNS,
      },
      (org, filters) => this.exportRows(org, filters),
    );
  }

  async dashboard(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    return this.compute(org, query);
  }

  async exportJob(user: CurrentUser, body: Row) {
    const org = await this.settings.org(user);
    const job = await this.mechanisms.createExportJob(user, {
      module: ACQ_DASHBOARD_EXPORT_MODULE,
      format: body.format === 'json' ? 'json' : 'csv',
      filters: {
        ...this.scopeOf(body),
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    return {
      jobId: job.id,
      status: job.status,
      downloadUrl: job.fileUrl,
    };
  }

  async share(user: CurrentUser, body: Row) {
    const org = await this.settings.org(user);
    const snapshot = await this.compute(org, body);
    const share = await this.mechanisms.createShare(user, {
      kind: 'REPORT',
      targetId: ACQ_DASHBOARD_EXPORT_MODULE,
      title: `获客看板 ${snapshot.range.from} ~ ${snapshot.range.to}`,
      projection: { dashboard: snapshot },
      expiresDays: int(body.expiresInDays, 7),
      password: text(body.password),
    });
    return {
      shareId: share.id,
      url: share.url,
      expiresAt: share.expiresAt,
    };
  }

  private async exportRows(org: HrmOrg, filters: Row): Promise<Row[]> {
    const data = await this.compute(
      { orgType: org.orgType, orgUserId: org.orgUserId },
      filters,
    );
    const rows: Row[] = [];
    for (const item of data.funnel) {
      rows.push({
        section: '漏斗',
        name: item.label,
        count: item.count,
        value: item.rate,
      });
    }
    for (const item of data.channels) {
      rows.push({
        section: '渠道',
        name: item.label,
        count: item.leads,
        value: item.conversionRate,
      });
    }
    rows.push(
      { section: '触达', name: '已发送', count: data.outreach.sent, value: 0 },
      {
        section: '触达',
        name: '成功',
        count: data.outreach.succeeded,
        value: 0,
      },
      { section: '触达', name: '失败', count: data.outreach.failed, value: 0 },
      {
        section: '触达',
        name: '结果未知',
        count: data.outreach.unknown,
        value: 0,
      },
      { section: '触达', name: '跳过', count: data.outreach.skipped, value: 0 },
      {
        section: '触达',
        name: '内容安全拦截',
        count: data.outreach.moderationBlocked,
        value: 0,
      },
      { section: '跟进', name: '待执行', count: data.followUp.due, value: 0 },
      {
        section: '跟进',
        name: '已发首轮',
        count: data.followUp.sentOnce,
        value: 0,
      },
      {
        section: '跟进',
        name: '已完成',
        count: data.followUp.completed,
        value: 0,
      },
      {
        section: '跟进',
        name: '已逾期',
        count: data.followUp.overdue,
        value: 0,
      },
      {
        section: '跟进',
        name: '二轮占比',
        count: 0,
        value: data.followUp.secondRoundRatio,
      },
    );
    for (const item of data.cost.byCode) {
      rows.push({
        section: '成本',
        name: item.label,
        count: item.calls,
        value: item.points,
      });
    }
    rows.push({
      section: '成本',
      name: '单线索积分',
      count: 0,
      value: data.cost.costPerLead,
    });
    return rows;
  }

  /** 从请求体/查询里只取看板维度，避免把 format/password 之类带进报表过滤。 */
  private scopeOf(input: Row): Row {
    return {
      from: text(input.from),
      to: text(input.to),
      platform: text(input.platform),
      sourceId: int(input.sourceId) || undefined,
      playbookId: int(input.playbookId) || undefined,
      agentUserId: text(input.agentUserId),
    };
  }

  private async compute(org: OrgKey | HrmOrg, query: Row) {
    const key = orgKey(org);
    const { from, to, fromLabel, toLabel } = this.rangeOf(query);
    const platform = clip(text(query.platform), 20);
    const sourceId = int(query.sourceId);
    const playbookId = int(query.playbookId);
    const agentUserId = clip(text(query.agentUserId), 64);

    // 线索域的过滤：平台直接筛；来源按批次→证据→线索反查
    let scopedLeadIds: number[] | null = null;
    if (sourceId > 0) {
      const runs = await this.prisma.acqRun.findMany({
        where: { ...key, sourceId },
        select: { id: true },
        orderBy: { id: 'desc' },
        take: 500,
      });
      const runIds = runs.map((row) => row.id);
      const evidence =
        runIds.length > 0
          ? await this.prisma.acqLeadEvidence.findMany({
              where: { ...key, runId: { in: runIds } },
              select: { leadId: true },
              distinct: ['leadId'],
              take: 5000,
            })
          : [];
      scopedLeadIds = evidence.map((row) => row.leadId);
    }

    const leadWhere = {
      ...key,
      deletedAt: null,
      firstSeenAt: { gte: from, lte: to },
      ...(platform ? { platform } : {}),
      ...(scopedLeadIds
        ? { id: { in: scopedLeadIds.length ? scopedLeadIds : [-1] } }
        : {}),
    };

    const [exposure, leads, deals, tasks, followUp, cost] = await Promise.all([
      this.prisma.acqLeadEvidence.count({
        where: {
          ...key,
          capturedAt: { gte: from, lte: to },
          ...(scopedLeadIds
            ? { leadId: { in: scopedLeadIds.length ? scopedLeadIds : [-1] } }
            : {}),
        },
      }),
      this.prisma.acqLead.findMany({
        where: leadWhere,
        select: { id: true, platform: true, status: true },
        take: 20000,
      }),
      this.prisma.acqProfile.count({
        where: {
          ...key,
          deletedAt: null,
          businessStatus: 'customer',
          updatedAt: { gte: from, lte: to },
        },
      }),
      this.prisma.acqOutreachTask.findMany({
        where: {
          ...key,
          createdAt: { gte: from, lte: to },
          ...(playbookId > 0 ? { playbookId } : {}),
          ...(agentUserId ? { createdBy: agentUserId } : {}),
        },
        select: {
          status: true,
          moderation: true,
          moderationNote: true,
          receiptStatus: true,
          sentAt: true,
          blockedReason: true,
        },
        take: 50000,
      }),
      this.followUpStats(key),
      this.costStats(org, from, to),
    ]);

    const total = leads.length;
    const contacted = leads.filter((row) =>
      CONTACTED.includes(row.status),
    ).length;
    const replied = leads.filter((row) => REPLIED.includes(row.status)).length;
    const qualified = leads.filter((row) =>
      QUALIFIED.includes(row.status),
    ).length;
    const counts = [exposure, total, contacted, replied, qualified, deals];
    const base = counts[0] || 0;
    const funnel = FUNNEL_LABELS.map((item, index) => ({
      stage: item.stage,
      label: item.label,
      count: counts[index],
      rate: index === 0 ? (base > 0 ? 100 : 0) : percent(counts[index], base),
    }));

    const byPlatform = new Map<
      string,
      {
        leads: number;
        contacted: number;
        replied: number;
        qualified: number;
        promoted: number;
      }
    >();
    for (const row of leads) {
      const entry = byPlatform.get(row.platform) || {
        leads: 0,
        contacted: 0,
        replied: 0,
        qualified: 0,
        promoted: 0,
      };
      entry.leads += 1;
      if (CONTACTED.includes(row.status)) entry.contacted += 1;
      if (REPLIED.includes(row.status)) entry.replied += 1;
      if (QUALIFIED.includes(row.status)) entry.qualified += 1;
      if (row.status === 'PROMOTED') entry.promoted += 1;
      byPlatform.set(row.platform, entry);
    }
    const channels = [...byPlatform.entries()]
      .sort((a, b) => b[1].leads - a[1].leads)
      .map(([platformKey, entry]) => ({
        key: platformKey,
        label: ACQ_PLATFORM_LABELS[platformKey] || platformKey,
        ...entry,
        conversionRate: percent(entry.promoted, entry.leads),
      }));

    const sent = tasks.filter((row) => row.sentAt !== null).length;
    const succeeded = tasks.filter(
      (row) => row.receiptStatus === 'succeeded',
    ).length;
    const failed = tasks.filter(
      (row) => row.status === 'FAILED' || row.receiptStatus === 'failed',
    ).length;
    const unknown = tasks.filter(
      (row) => row.receiptStatus === 'unknown',
    ).length;
    const skipped = tasks.filter((row) => row.status === 'SKIPPED').length;
    const moderationBlocked = tasks.filter(
      (row) => row.moderation === 'block',
    ).length;
    const reasonMap = new Map<string, number>();
    for (const row of tasks) {
      const reason =
        clip(row.blockedReason, 80) ||
        (row.moderation === 'block'
          ? clip(row.moderationNote || '内容安全拦截', 80)
          : '');
      if (!reason) continue;
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    }
    const reasons = [...reasonMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count }));

    return {
      range: { from: fromLabel, to: toLabel },
      funnel,
      channels,
      outreach: {
        sent,
        succeeded,
        failed,
        unknown,
        skipped,
        moderationBlocked,
        successRate: percent(succeeded, sent),
        reasons,
      },
      followUp,
      cost: {
        ...cost,
        outreachCount: sent,
        costPerLead: total > 0 ? Number((cost.points / total).toFixed(2)) : 0,
      },
    };
  }

  private async followUpStats(key: OrgKey) {
    const now = new Date();
    const overdueBefore = new Date(now.getTime() - 24 * 3600_000);
    const where = { ...key };
    const [due, sentOnce, completed, overdue, secondRound, totalRounds] =
      await Promise.all([
        this.prisma.acqFollowUp.count({
          where: { ...where, status: 'pending', followUpAt: { lte: now } },
        }),
        this.prisma.acqFollowUp.count({
          where: { ...where, status: 'sent_once' },
        }),
        this.prisma.acqFollowUp.count({
          where: { ...where, status: 'completed' },
        }),
        this.prisma.acqFollowUp.count({
          where: {
            ...where,
            status: 'pending',
            followUpAt: { lt: overdueBefore },
          },
        }),
        this.prisma.acqFollowUp.count({
          where: { ...where, retryCount: { gte: 1 } },
        }),
        this.prisma.acqFollowUp.count({
          where: { ...where, status: { in: ['sent_once', 'completed'] } },
        }),
      ]);
    return {
      due,
      sentOnce,
      completed,
      overdue,
      secondRoundRatio: percent(secondRound, totalRounds),
    };
  }

  private async costStats(org: OrgKey | HrmOrg, from: Date, to: Date) {
    const members = await this.scope.memberUserIds({
      ...orgKey(org),
      actorId: '',
      isOwner: false,
      isAdmin: false,
      roles: [],
      positions: [],
      department: '',
    });
    const grouped = await this.prisma.usageEvent.groupBy({
      by: ['code'],
      where: {
        module: 'acquisition',
        userId: { in: members.length ? members : [org.orgUserId] },
        occurredAt: { gte: from, lte: to },
      },
      _sum: { quantityAmount: true, pointsAmount: true },
    });
    const labels = new Map<string, string>(
      ACQ_PRICING_CODES.map((item) => [item.code, item.label]),
    );
    const byCode = grouped
      .map((row) => ({
        code: row.code,
        label: labels.get(row.code) || row.code,
        calls: Math.round(Number(row._sum.quantityAmount ?? 0)),
        points: Number(Number(row._sum.pointsAmount ?? 0).toFixed(2)),
      }))
      .sort((a, b) => b.points - a.points);
    return {
      aiCalls: byCode.reduce((sum, item) => sum + item.calls, 0),
      points: Number(
        byCode.reduce((sum, item) => sum + item.points, 0).toFixed(2),
      ),
      byCode,
    };
  }

  private rangeOf(query: Row) {
    const now = new Date();
    const parse = (value: unknown, fallback: Date) => {
      const raw = text(value).trim();
      if (!raw) return fallback;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? fallback : parsed;
    };
    let to = parse(query.to, now);
    let from = parse(query.from, new Date(to.getTime() - 30 * 86_400_000));
    if (from > to) [from, to] = [to, from];
    const day = (at: Date) => at.toISOString().slice(0, 10);
    // 结束日按当天 23:59:59 计，避免用户选「今天」时漏掉今天的数据
    const toEnd = new Date(to);
    if (text(query.to).trim().length <= 10) {
      toEnd.setHours(23, 59, 59, 999);
    }
    const fromStart = new Date(from);
    if (text(query.from).trim().length <= 10) {
      fromStart.setHours(0, 0, 0, 0);
    }
    return {
      from: fromStart,
      to: toEnd,
      fromLabel: day(fromStart),
      toLabel: day(toEnd),
    };
  }
}
