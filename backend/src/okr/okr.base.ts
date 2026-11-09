import {
  OKR_CYCLE_KIND_LABELS,
  OKR_CYCLE_STATUS_LABELS,
  OKR_LEVEL_LABELS,
  OKR_METRIC_SOURCE_LABELS,
  OKR_METRIC_SOURCES,
  OKR_METRIC_TYPE_LABELS,
  OKR_OBJECTIVE_STATUS_LABELS,
  OKR_PLAN_KIND_LABELS,
  OKR_PLAN_STATUS_LABELS,
  OKR_REPORT_KIND_LABELS,
  OKR_REPORT_STATUS_LABELS,
  OKR_VISIBILITY_LABELS,
  agentActionLabel,
} from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import { toJsonInput, type JsonInput } from '../common/json-input';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  clamp,
  cycleTitle,
  dateAt,
  dateStr,
  dayRange,
  int,
  iso,
  jsonArray,
  jsonObject,
  localToday,
  num,
  progressOf,
  round,
  weekKeyOf,
  weekRange,
} from './okr.helpers';
import { metricSourceFields, readMetricSource } from './okr.metrics.service';
import { weighted } from './okr.progress';
import { OkrContext, OkrMemberRow } from './okr.scope';
import type {
  CycleRow,
  KrRow,
  ObjectiveRow,
  PlanRow,
  ProgressRow,
  ReportRow,
  ScoreRow,
} from './okr.types';
import { METRIC_TYPES } from './okr.types';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { OkrMetricsService } from './okr.metrics.service';
import { OkrScopeService } from './okr.scope';

/** OKR 公共依赖与内部工具：各特性服务继承后只写业务方法。 */
export abstract class OkrBase {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly scope: OkrScopeService,
    protected readonly metrics: OkrMetricsService,
    protected readonly notifications: NotificationService,
  ) {}

  protected idOf(raw: unknown) {
    const id = int(raw);
    if (id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '参数不合法');
    }
    return id;
  }

  protected selfKey(ctx: OkrContext) {
    return ctx.actorId === ctx.ownerUserId ? '' : ctx.actorId;
  }

  protected assertCycleOpen(cycle: CycleRow) {
    if (cycle.status === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '周期已关闭，目标与 KR 只读',
      );
    }
  }

  protected cycleRangeOf(cycle: CycleRow | null) {
    return cycle
      ? { startDate: dateStr(cycle.startDate), endDate: dateStr(cycle.endDate) }
      : null;
  }

  protected async cycleOf(ownerUserId: string, id: number) {
    const row = await this.prisma.okrCycle.findFirst({
      where: { id, ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '周期不存在');
    }
    return row as CycleRow;
  }

  protected async currentCycle(ownerUserId: string) {
    const today = dateAt(localToday());
    const active =
      (await this.prisma.okrCycle.findFirst({
        where: {
          ownerUserId,
          status: 'ACTIVE',
          startDate: { lte: today },
          endDate: { gte: today },
        },
        orderBy: { startDate: 'desc' },
      })) ||
      (await this.prisma.okrCycle.findFirst({
        where: { ownerUserId, status: 'ACTIVE' },
        orderBy: { startDate: 'desc' },
      }));
    return (active ||
      (await this.prisma.okrCycle.findFirst({
        where: { ownerUserId },
        orderBy: { startDate: 'desc' },
      }))) as CycleRow | null;
  }

  protected async cycleViews(ownerUserId: string) {
    const rows = await this.prisma.okrCycle.findMany({
      where: { ownerUserId },
      orderBy: [{ year: 'desc' }, { period: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.cycleView(row as CycleRow));
  }

  protected async objectiveOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrObjective.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标不存在');
    }
    return row as ObjectiveRow;
  }

  protected async krOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrKeyResult.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '关键结果不存在');
    }
    return row as KrRow;
  }

  protected async planOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrPlan.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '计划不存在');
    }
    return row as PlanRow;
  }

  protected async reportOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrReport.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '汇报不存在');
    }
    return row as ReportRow;
  }

  protected async visibleObjectives<
    T extends {
      visibility: string;
      ownerMemberUserId: string;
      assignerUserId: string;
    },
  >(ctx: OkrContext, rows: T[]): Promise<T[]> {
    if (ctx.isOwner || ctx.isManager) return rows;
    const department = ctx.department;
    const departmentMembers = department
      ? new Set(
          (await this.scope.members(ctx.ownerUserId))
            .filter((row) => row.department === department)
            .map((row) => row.memberUserId),
        )
      : new Set<string>();
    return rows.filter(
      (row) =>
        row.visibility === 'ORG' ||
        row.ownerMemberUserId === ctx.actorId ||
        row.assignerUserId === ctx.actorId ||
        (row.visibility === 'DEPT' &&
          department !== '' &&
          (departmentMembers.has(row.ownerMemberUserId) ||
            row.ownerMemberUserId === '')),
    );
  }

  protected async visibleObjectiveIds(ctx: OkrContext) {
    if (ctx.isOwner || ctx.isManager) return null;
    const rows = await this.prisma.okrObjective.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      select: {
        id: true,
        visibility: true,
        ownerMemberUserId: true,
        assignerUserId: true,
      },
    });
    return new Set(
      (await this.visibleObjectives(ctx, rows)).map((row) => row.id),
    );
  }

  protected canEditObjective(ctx: OkrContext, row: ObjectiveRow) {
    return (
      ctx.isOwner ||
      ctx.isManager ||
      row.ownerMemberUserId === ctx.actorId ||
      row.assignerUserId === ctx.actorId
    );
  }

  protected assertPlanWritable(ctx: OkrContext, row: PlanRow) {
    if (ctx.isOwner || ctx.isManager) return;
    const self = this.selfKey(ctx);
    if (row.memberUserId !== self && row.memberUserId !== ctx.actorId) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能维护自己的计划');
    }
  }

  protected assertReportVisible(ctx: OkrContext, row: ReportRow) {
    if (ctx.isOwner || ctx.isManager) return;
    const self = this.selfKey(ctx);
    if (row.memberUserId !== self && row.memberUserId !== ctx.actorId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '汇报不存在');
    }
  }

  protected async collectObjectives(
    ctx: OkrContext,
    where: Prisma.OkrObjectiveWhereInput,
  ) {
    const rows = await this.prisma.okrObjective.findMany({
      where: { ...where, ownerUserId: ctx.ownerUserId },
      orderBy: [{ parentId: 'asc' }, { id: 'asc' }],
    });
    return this.visibleObjectives(ctx, rows);
  }

  protected async objectiveViews(
    ctx: OkrContext,
    where: Prisma.OkrObjectiveWhereInput,
  ) {
    const rows = await this.collectObjectives(ctx, where);
    if (!rows.length) {
      return { items: [] as Record<string, unknown>[], rows };
    }
    const krRows = await this.prisma.okrKeyResult.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        objectiveId: { in: rows.map((row) => row.id) },
      },
      orderBy: [{ objectiveId: 'asc' }, { id: 'asc' }],
    });
    const byObjective = new Map<number, KrRow[]>();
    for (const kr of krRows) {
      const list = byObjective.get(kr.objectiveId) || [];
      list.push(kr);
      byObjective.set(kr.objectiveId, list);
    }
    const memberIds = rows
      .map((row) => row.ownerMemberUserId)
      .concat(krRows.map((row) => row.ownerMemberUserId))
      .filter(Boolean);
    const names = await this.scope.names([ctx.ownerUserId, ...memberIds]);
    const ownerName = names.get(ctx.ownerUserId) || '';
    const items = rows.map((row) =>
      this.objectiveView(row, byObjective.get(row.id) || [], names, ownerName),
    );
    return { items, rows };
  }

  protected async planNames(rows: PlanRow[]) {
    const ids = rows.map((row) => row.memberUserId).filter(Boolean);
    return this.scope.names([...ids, ...rows.map(() => '')].filter(Boolean));
  }

  protected async planViewSaved(ctx: OkrContext, row: PlanRow) {
    const names = await this.planNames([row]);
    const ownerName =
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) || '';
    return this.planView(row, names, ownerName);
  }

  protected async reportViews(ctx: OkrContext, rows: ReportRow[]) {
    const names = await this.scope.names([
      ctx.ownerUserId,
      ...rows.map((row) => row.memberUserId).filter(Boolean),
    ]);
    const ownerName = names.get(ctx.ownerUserId) || '';
    return rows.map((row) => this.reportView(row, names, ownerName));
  }

  protected async createKrs(
    ownerUserId: string,
    objectiveId: number,
    rows: unknown[],
    defaultOwner: string,
  ) {
    const created: KrRow[] = [];
    for (const item of rows) {
      const row = jsonObject(item);
      const title = text(row['title']).trim().slice(0, 200);
      if (!title) continue;
      const metricRaw = text(row['metricType']).toUpperCase();
      const metricType = METRIC_TYPES.has(metricRaw) ? metricRaw : 'MANUAL';
      const saved = await this.prisma.okrKeyResult.create({
        data: {
          ownerUserId,
          objectiveId,
          title,
          metricType,
          targetValue: num(row['targetValue'], 100),
          startValue: num(row['startValue']),
          currentValue: num(row['currentValue']),
          unit: text(row['unit']).slice(0, 32),
          direction:
            text(row['direction']).toUpperCase() === 'DOWN' ? 'DOWN' : 'UP',
          weight: clamp(num(row['weight'], 1), 0, 100),
          ownerMemberUserId: defaultOwner,
          metricSource: row['metricSource']
            ? this.metricSourceValue(row['metricSource'])
            : {},
        },
      });
      created.push(saved);
    }
    return created;
  }

  protected metricSourceValue(raw: unknown): JsonInput {
    const value = readMetricSource(raw);
    if (!value.source) return {};
    return toJsonInput(value);
  }

  protected periodOf(kind: 'WEEK' | 'DAY', weekStart: number) {
    if (kind === 'DAY') {
      const today = localToday();
      return { key: today, start: today, end: today };
    }
    const key = weekKeyOf(new Date(), weekStart);
    const range = weekRange(key, weekStart);
    return { key, start: range.start, end: range.end };
  }

  protected previousPeriod(kind: 'WEEK' | 'DAY', weekStart: number) {
    const now = new Date();
    if (kind === 'DAY') {
      return localToday(new Date(now.getTime() - 86_400_000));
    }
    return weekKeyOf(new Date(now.getTime() - 7 * 86_400_000), weekStart);
  }

  protected reportPeriod(kind: string, rawKey: string, weekStart: number) {
    const key =
      rawKey ||
      (kind === 'WEEKLY' ? weekKeyOf(new Date(), weekStart) : localToday());
    const range =
      kind === 'WEEKLY' ? weekRange(key, weekStart) : { start: key, end: key };
    return { key, start: range.start, end: range.end };
  }

  protected periodInRange(
    periodKey: string,
    kind: string,
    cycle: CycleRow,
    weekStart: number,
  ) {
    const start = dateStr(cycle.startDate);
    const end = dateStr(cycle.endDate);
    if (kind === 'DAILY') return periodKey >= start && periodKey <= end;
    const range = weekRange(periodKey, weekStart);
    return range.end >= start && range.start <= end;
  }

  protected completionOf(rows: ObjectiveRow[]) {
    const active = rows.filter((row) => row.status !== 'CANCELLED');
    return weighted(
      active.map((row) => ({
        weight: num(row.weight, 1),
        progress: num(row.progress),
      })),
    );
  }

  protected async buildKrTrend(ownerUserId: string, cycle: CycleRow) {
    const { from, to } = dayRange(
      dateStr(cycle.startDate),
      dateStr(cycle.endDate),
    );
    const rows = await this.prisma.okrProgressLog.findMany({
      where: { ownerUserId, createdAt: { gte: from, lte: to } },
      orderBy: { id: 'asc' },
      select: { progress: true, createdAt: true },
    });
    const byDay = new Map<string, { sum: number; count: number }>();
    for (const row of rows) {
      const key = localToday(row.createdAt);
      const bucket = byDay.get(key) || { sum: 0, count: 0 };
      bucket.sum += num(row.progress);
      bucket.count += 1;
      byDay.set(key, bucket);
    }
    return [...byDay.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .slice(-30)
      .map(([date, bucket]) => ({
        date,
        progress: round(bucket.sum / bucket.count, 1),
      }));
  }

  protected async scoreCandidates(
    ctx: OkrContext,
    cycleId: number,
    members: OkrMemberRow[],
  ) {
    const objectives = await this.prisma.okrObjective.findMany({
      where: { ownerUserId: ctx.ownerUserId, cycleId },
      select: { ownerMemberUserId: true },
    });
    const cycle = await this.prisma.okrCycle.findFirst({
      where: { id: cycleId, ownerUserId: ctx.ownerUserId },
    });
    const keys = new Set(
      objectives.map((row) => row.ownerMemberUserId).filter(Boolean),
    );
    if (cycle) {
      const reports = await this.prisma.okrReport.findMany({
        where: { ownerUserId: ctx.ownerUserId },
        select: { memberUserId: true, kind: true, periodKey: true },
      });
      for (const report of reports) {
        if (
          report.memberUserId &&
          this.periodInRange(
            report.periodKey,
            report.kind,
            cycle,
            ctx.settings.weekStart,
          )
        ) {
          keys.add(report.memberUserId);
        }
      }
    }
    return members.filter((row) => keys.has(row.memberUserId));
  }

  protected metricSourceCatalog() {
    const aggs = (source: string) =>
      source === 'SIGN_CONTRACT'
        ? ['COUNT']
        : source === 'DATA_TABLE' || source === 'LOWCODE_ENTITY'
          ? ['COUNT', 'SUM', 'AVG']
          : ['COUNT', 'SUM'];
    return OKR_METRIC_SOURCES.map((source) => ({
      key: source,
      label: OKR_METRIC_SOURCE_LABELS[source] || source,
      fields: metricSourceFields(source),
      aggs: aggs(source),
    }));
  }

  protected async buildReportContent(
    ctx: OkrContext,
    actorId: string,
    memberUserId: string,
    kind: string,
    period: { key: string; start: string; end: string },
  ) {
    const { from, to } = dayRange(period.start, period.end);
    const done: string[] = [];
    const dataChange: string[] = [];
    const blockers: string[] = [];
    const next: string[] = [];
    const events = await this.prisma.agentMemoryEvent.findMany({
      where: {
        userId: actorId,
        occurredAt: { gte: from, lte: to },
        outcome: { not: 'failed' },
      },
      orderBy: { occurredAt: 'asc' },
      take: 200,
      select: { action: true, targetLabel: true },
    });
    const actionCount = new Map<string, number>();
    for (const event of events) {
      const label = agentActionLabel(event.action);
      actionCount.set(label, (actionCount.get(label) || 0) + 1);
    }
    for (const [label, count] of [...actionCount.entries()].slice(0, 8)) {
      done.push(`${label} ${count} 次`);
    }
    const changes = await this.prisma.crmChangeLog.count({
      where: {
        ownerUserId: ctx.ownerUserId,
        operator: actorId,
        createdAt: { gte: from, lte: to },
      },
    });
    if (changes) dataChange.push(`CRM 记录变更 ${changes} 条`);
    const memberObjectives = await this.prisma.okrObjective.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        ownerMemberUserId: memberUserId,
      },
      select: { id: true, title: true },
    });
    if (memberObjectives.length) {
      const krs = await this.prisma.okrKeyResult.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          objectiveId: { in: memberObjectives.map((row) => row.id) },
        },
        select: { id: true, title: true },
      });
      const krTitles = new Map(krs.map((row) => [row.id, row.title]));
      if (krs.length) {
        const logs = await this.prisma.okrProgressLog.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            krId: { in: krs.map((row) => row.id) },
            createdAt: { gte: from, lte: to },
          },
          orderBy: { id: 'asc' },
          take: 50,
        });
        for (const log of logs) {
          const title = krTitles.get(log.krId) || '关键结果';
          dataChange.push(`${title}：${num(log.before)} → ${num(log.after)}`);
        }
      }
    }
    const plans = await this.prisma.okrPlan.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        memberUserId,
        dueDate: { gte: from, lte: to },
      },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const plan of plans) {
      if (plan.status === 'DONE') done.push(`完成计划：${plan.title}`);
      else if (plan.status === 'TODO' || plan.status === 'DOING') {
        next.push(
          `推进：${plan.title}${plan.dueDate ? `（截止 ${dateStr(plan.dueDate)}）` : ''}`,
        );
      }
    }
    const overdue = await this.prisma.okrPlan.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        memberUserId,
        status: { in: ['TODO', 'DOING'] },
        dueDate: { lt: dateAt(localToday()) },
      },
      orderBy: { dueDate: 'asc' },
      take: 10,
    });
    for (const plan of overdue) {
      blockers.push(`计划逾期：${plan.title}（截止 ${dateStr(plan.dueDate)}）`);
    }
    if (!done.length) done.push('本期没有记录到系统操作，可手工补充完成事项。');
    if (!dataChange.length) dataChange.push('本期没有关键数据变化。');
    if (!next.length) next.push('补充下期要推进的事项。');
    return { done, dataChange, blockers, next, attachments: [] };
  }

  protected async notifyMembers(
    ctx: OkrContext,
    input: {
      title: string;
      body: string;
      link: string;
      entityType: string;
      entityId: string;
    },
  ) {
    const members = await this.scope.members(ctx.ownerUserId);
    const ids = members
      .map((row) => row.memberUserId)
      .filter((id) => id !== ctx.actorId);
    await this.notifications.notifyMany(ids, {
      category: 'okr',
      ...input,
    });
  }

  protected async notifyManagersOnce(
    ctx: OkrContext,
    input: {
      title: string;
      body: string;
      link: string;
      entityType: string;
      entityId: string;
    },
  ) {
    const ids = [ctx.ownerUserId, ...ctx.settings.managers].filter(
      (id) => id && id !== ctx.actorId,
    );
    for (const id of [...new Set(ids)]) {
      const exists = await this.prisma.notification.findFirst({
        where: {
          userId: id,
          entityType: input.entityType,
          entityId: input.entityId,
        },
        select: { id: true },
      });
      if (exists) continue;
      await this.notifications.notify(id, { category: 'okr', ...input });
    }
  }

  protected cycleView(row: CycleRow) {
    return {
      id: row.id,
      kind: row.kind,
      kindLabel: OKR_CYCLE_KIND_LABELS[row.kind] || row.kind,
      year: row.year,
      period: row.period,
      title: text(row.title) || cycleTitle(row.kind, row.year, row.period),
      startDate: dateStr(row.startDate),
      endDate: dateStr(row.endDate),
      status: row.status,
      statusLabel: OKR_CYCLE_STATUS_LABELS[row.status] || row.status,
      closedAt: iso(row.closedAt),
      createdAt: iso(row.createdAt),
    };
  }

  protected memberView(row: OkrMemberRow) {
    return {
      memberUserId: row.memberUserId,
      name: row.name,
      memberKind: row.memberKind,
      memberKindLabel: row.memberKindLabel,
      department: row.department,
      positions: row.positions,
      capabilities: row.capabilities,
      roles: row.roles,
      dualKind: row.dualKind,
    };
  }

  protected krView(
    row: KrRow,
    names: Map<string, string>,
    accountName: string,
  ) {
    const ownerKey = row.ownerMemberUserId || '';
    return {
      id: row.id,
      objectiveId: row.objectiveId,
      title: row.title,
      metricType: row.metricType || 'MANUAL',
      metricTypeLabel:
        OKR_METRIC_TYPE_LABELS[row.metricType || 'MANUAL'] ||
        row.metricType ||
        '手动填写',
      targetValue: num(row.targetValue),
      currentValue: num(row.currentValue),
      startValue: num(row.startValue),
      unit: row.unit || '',
      direction: row.direction || 'UP',
      weight: num(row.weight, 1),
      ownerMemberUserId: ownerKey,
      ownerName: ownerKey ? names.get(ownerKey) || ownerKey : accountName,
      metricSource: jsonObject(row.metricSource),
      lastRefreshedAt: iso(row.lastRefreshedAt),
      progress: progressOf(
        row.direction,
        num(row.startValue),
        num(row.currentValue),
        num(row.targetValue),
      ),
      createdAt: iso(row.createdAt),
    };
  }

  protected objectiveView(
    row: ObjectiveRow,
    krs: KrRow[],
    names: Map<string, string>,
    accountName: string,
  ) {
    const ownerKey = row.ownerMemberUserId || '';
    return {
      id: row.id,
      cycleId: row.cycleId,
      parentId: row.parentId,
      level: row.level,
      levelLabel: OKR_LEVEL_LABELS[row.level] || row.level,
      title: row.title,
      description: row.description,
      ownerMemberUserId: ownerKey,
      ownerName: ownerKey ? names.get(ownerKey) || ownerKey : accountName,
      assignerUserId: row.assignerUserId,
      weight: num(row.weight, 1),
      progress: num(row.progress),
      visibility: row.visibility,
      visibilityLabel: OKR_VISIBILITY_LABELS[row.visibility] || row.visibility,
      status: row.status,
      statusLabel: OKR_OBJECTIVE_STATUS_LABELS[row.status] || row.status,
      source: row.source,
      krs: krs.map((kr) => this.krView(kr, names, accountName)),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  protected planView(
    row: PlanRow,
    names: Map<string, string>,
    accountName: string,
  ) {
    const ownerKey = row.memberUserId || '';
    return {
      id: row.id,
      objectiveId: row.objectiveId,
      krId: row.krId,
      memberUserId: ownerKey,
      memberName: ownerKey ? names.get(ownerKey) || ownerKey : accountName,
      title: row.title,
      detail: row.detail,
      kind: row.kind,
      kindLabel: OKR_PLAN_KIND_LABELS[row.kind] || row.kind,
      periodKey: row.periodKey,
      startDate: dateStr(row.startDate),
      dueDate: dateStr(row.dueDate),
      priority: row.priority,
      status: row.status,
      statusLabel: OKR_PLAN_STATUS_LABELS[row.status] || row.status,
      progress: num(row.progress),
      scheduleId: row.scheduleId,
      source: row.source,
      doneAt: iso(row.doneAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  protected reportView(
    row: ReportRow,
    names: Map<string, string>,
    accountName: string,
  ) {
    const ownerKey = row.memberUserId || '';
    return {
      id: row.id,
      memberUserId: ownerKey,
      memberName: ownerKey ? names.get(ownerKey) || ownerKey : accountName,
      kind: row.kind,
      kindLabel: OKR_REPORT_KIND_LABELS[row.kind] || row.kind,
      periodKey: row.periodKey,
      content: jsonObject(row.content),
      autoDraft: jsonObject(row.autoDraft),
      source: row.source,
      scheduleId: row.scheduleId,
      status: row.status,
      statusLabel: OKR_REPORT_STATUS_LABELS[row.status] || row.status,
      submittedAt: iso(row.submittedAt),
      managerComment: row.managerComment,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  protected scoreView(row: ScoreRow, names: Map<string, string>) {
    return {
      id: row.id,
      cycleId: row.cycleId,
      memberUserId: row.memberUserId,
      memberName: names.get(row.memberUserId) || row.memberUserId,
      reviewerUserId: row.reviewerUserId,
      reviewerName: names.get(row.reviewerUserId) || row.reviewerUserId,
      scores: jsonArray(row.scores).map((item) => {
        const value = jsonObject(item);
        return {
          key: text(value['key']),
          label: text(value['label']),
          score: num(value['score']),
          weight: num(value['weight']),
        };
      }),
      total: num(row.total),
      comment: row.comment,
      status: row.status,
      submittedAt: iso(row.submittedAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  protected progressView(row: ProgressRow) {
    return {
      id: row.id,
      krId: row.krId,
      objectiveId: row.objectiveId,
      before: num(row.before),
      after: num(row.after),
      progress: num(row.progress),
      note: row.note,
      source: row.source,
      authorId: row.authorId,
      refType: row.refType,
      refId: row.refId,
      createdAt: iso(row.createdAt),
    };
  }
}
