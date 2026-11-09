import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { dateAt, int, localToday, weekKeyOf } from './okr.helpers';
import { OkrContext } from './okr.scope';
import type { ObjectiveRow } from './okr.types';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { OkrBase } from './okr.base';
import { OkrCycleService } from './okr-cycle.service';
import { OkrExecutionService } from './okr-execution.service';
import { OkrInsightService } from './okr-insight.service';
import { OkrMetricsService } from './okr.metrics.service';
import { OkrObjectiveService } from './okr-objective.service';
import { OkrScopeService } from './okr.scope';

/**
 * OKR 门面：概览 / 上下文留在本类，其余按周期、目标、执行、洞察四组委托。
 * 账号归属与成员权限统一走 OkrScopeService；自动取数走 OkrMetricsService。
 */
export class OkrService extends OkrBase {
  private readonly cycles: OkrCycleService;
  private readonly objectives: OkrObjectiveService;
  private readonly execution: OkrExecutionService;
  private readonly insight: OkrInsightService;

  constructor(
    prisma: PrismaService,
    scope: OkrScopeService,
    metrics: OkrMetricsService,
    notifications: NotificationService,
  ) {
    super(prisma, scope, metrics, notifications);
    this.cycles = new OkrCycleService(prisma, scope, metrics, notifications);
    this.objectives = new OkrObjectiveService(
      prisma,
      scope,
      metrics,
      notifications,
    );
    this.execution = new OkrExecutionService(
      prisma,
      scope,
      metrics,
      notifications,
    );
    this.insight = new OkrInsightService(prisma, scope, metrics, notifications);
  }

  async overview(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const requested = int(query['cycleId']);
    const cycle =
      requested > 0
        ? await this.cycleOf(ctx.ownerUserId, requested)
        : await this.currentCycle(ctx.ownerUserId);
    const cycles = await this.cycleViews(ctx.ownerUserId);
    const self = this.selfKey(ctx);
    const objectives = cycle
      ? await this.collectObjectives(ctx, { cycleId: cycle.id })
      : [];
    const krs = objectives.length
      ? await this.prisma.okrKeyResult.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            objectiveId: { in: objectives.map((row) => row.id) },
          },
          select: { id: true, objectiveId: true },
        })
      : [];
    const krCount = new Map<number, number>();
    for (const kr of krs) {
      krCount.set(kr.objectiveId, (krCount.get(kr.objectiveId) || 0) + 1);
    }
    const completion = this.completionOf(objectives);
    const pendingObjectives = objectives.filter(
      (row) =>
        row.status === 'ACTIVE' &&
        (row.ownerMemberUserId === self ||
          row.ownerMemberUserId === ctx.actorId) &&
        !krCount.get(row.id),
    ).length;
    const today = localToday();
    const weekKey = weekKeyOf(new Date(), ctx.settings.weekStart);
    const reports = await this.prisma.okrReport.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        memberUserId: self === '' ? ctx.actorId : self,
        OR: [
          { kind: 'DAILY', periodKey: today },
          { kind: 'WEEKLY', periodKey: weekKey },
        ],
      },
      select: { kind: true, periodKey: true, status: true },
    });
    const daily = reports.find(
      (row) => row.kind === 'DAILY' && row.periodKey === today,
    );
    const weekly = reports.find(
      (row) => row.kind === 'WEEKLY' && row.periodKey === weekKey,
    );
    const pendingReports =
      (daily?.status !== 'SUBMITTED' ? 1 : 0) +
      (weekly?.status !== 'SUBMITTED' ? 1 : 0);
    const overduePlans = await this.prisma.okrPlan.count({
      where: {
        ownerUserId: ctx.ownerUserId,
        memberUserId: { in: self === '' ? ['', ctx.actorId] : [self] },
        status: { in: ['TODO', 'DOING'] },
        dueDate: { lt: dateAt(today) },
      },
    });
    let todoScores = 0;
    if ((ctx.isOwner || ctx.isManager) && cycle && cycle.status === 'REVIEW') {
      const candidates = await this.scoreCandidates(
        ctx,
        cycle.id,
        await this.scope.members(ctx.ownerUserId),
      );
      const scored = await this.prisma.okrScore.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          cycleId: cycle.id,
          reviewerUserId: ctx.actorId,
          status: 'SUBMITTED',
        },
        select: { memberUserId: true },
      });
      const done = new Set(scored.map((row) => row.memberUserId));
      todoScores = candidates.filter(
        (row) => !done.has(row.memberUserId),
      ).length;
    }
    return {
      cycles,
      currentCycle: cycle ? this.cycleView(cycle) : null,
      completion,
      pendingObjectives,
      pendingReports,
      overduePlans,
      todoScores,
    };
  }

  async context(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const requested = int(query['cycleId']);
    const cycle =
      requested > 0
        ? await this.cycleOf(ctx.ownerUserId, requested)
        : await this.currentCycle(ctx.ownerUserId);
    const cycles = await this.cycleViews(ctx.ownerUserId);
    const members = await this.scope.members(ctx.ownerUserId);
    const ownerName =
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) || '';
    const mine = members.find((row) => row.memberUserId === ctx.actorId) || {
      memberUserId: ctx.ownerUserId,
      name: ownerName,
      memberKind: 'OWNER',
      memberKindLabel: '账号所有者',
      department: '',
      positions: [],
      capabilities: '',
      roles: [],
      dualKind: false,
    };
    const objectives = cycle
      ? await this.objectiveViews(ctx, { cycleId: cycle.id })
      : { items: [] as Record<string, unknown>[], rows: [] as ObjectiveRow[] };
    const self = this.selfKey(ctx);
    const cycleObjectiveIds = objectives.rows.map((row) => row.id);
    const planWhere: Prisma.OkrPlanWhereInput = {
      ownerUserId: ctx.ownerUserId,
      memberUserId: { in: self === '' ? ['', ctx.actorId] : [self] },
      status: { in: ['TODO', 'DOING'] },
    };
    if (cycleObjectiveIds.length) {
      planWhere.OR = [
        { objectiveId: { in: cycleObjectiveIds } },
        { objectiveId: 0 },
      ];
    }
    const plans = await this.prisma.okrPlan.findMany({
      where: planWhere,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    const names = await this.planNames(plans);
    return {
      ownerUserId: ctx.ownerUserId,
      me: this.memberView(mine),
      isOwner: ctx.isOwner,
      isManager: ctx.isManager,
      cycle: cycle ? this.cycleView(cycle) : null,
      cycles,
      members: members.map((row) => this.memberView(row)),
      objectives: objectives.items,
      plans: plans.map((row) => this.planView(row, names, ownerName)),
      metricSources: this.metricSourceCatalog(),
      scoreDimensions: ctx.settings.scoreDimensions,
      settings: {
        ...ctx.settings,
      },
    };
  }

  async objectiveViewsByIds(ctx: OkrContext, ids: number[]) {
    if (!ids.length) return [];
    return (await this.objectiveViews(ctx, { id: { in: ids } })).items;
  }

  async cycleList(user: CurrentUser) {
    return this.cycles.cycleList(user);
  }

  async cycleSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.cycles.cycleSave(user, body);
  }

  async cycleClose(user: CurrentUser, id: string) {
    return this.cycles.cycleClose(user, id);
  }

  async settingsGet(user: CurrentUser) {
    return this.cycles.settingsGet(user);
  }

  async settingsSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.cycles.settingsSave(user, body);
  }

  async objectiveList(user: CurrentUser, query: Record<string, unknown>) {
    return this.objectives.objectiveList(user, query);
  }

  async objectiveDetail(user: CurrentUser, id: string) {
    return this.objectives.objectiveDetail(user, id);
  }

  async objectiveSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.objectives.objectiveSave(user, body);
  }

  async objectiveDelete(user: CurrentUser, id: string) {
    return this.objectives.objectiveDelete(user, id);
  }

  async objectiveAssign(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.objectives.objectiveAssign(user, id, body);
  }

  async draftObjective(user: CurrentUser, body: Record<string, unknown>) {
    return this.objectives.draftObjective(user, body);
  }

  async decomposeSuggest(user: CurrentUser, body: Record<string, unknown>) {
    return this.objectives.decomposeSuggest(user, body);
  }

  async krSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.objectives.krSave(user, body);
  }

  async krDelete(user: CurrentUser, id: string) {
    return this.objectives.krDelete(user, id);
  }

  async krProgress(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.objectives.krProgress(user, id, body);
  }

  async progressList(user: CurrentUser, query: Record<string, unknown>) {
    return this.objectives.progressList(user, query);
  }

  async metricPreview(user: CurrentUser, body: Record<string, unknown>) {
    return this.objectives.metricPreview(user, body);
  }

  async metricRefresh(user: CurrentUser, body: Record<string, unknown>) {
    return this.objectives.metricRefresh(user, body);
  }

  async planGenerate(user: CurrentUser, body: Record<string, unknown>) {
    return this.execution.planGenerate(user, body);
  }

  async planList(user: CurrentUser, query: Record<string, unknown>) {
    return this.execution.planList(user, query);
  }

  async planSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.execution.planSave(user, body);
  }

  async planUpdate(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.execution.planUpdate(user, id, body);
  }

  async planDelete(user: CurrentUser, id: string) {
    return this.execution.planDelete(user, id);
  }

  async planLinkSchedule(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.execution.planLinkSchedule(user, id, body);
  }

  async reportList(user: CurrentUser, query: Record<string, unknown>) {
    return this.execution.reportList(user, query);
  }

  async reportGet(user: CurrentUser, id: string) {
    return this.execution.reportGet(user, id);
  }

  async reportSaveDraft(user: CurrentUser, body: Record<string, unknown>) {
    return this.execution.reportSaveDraft(user, body);
  }

  async reportSubmit(user: CurrentUser, id: string) {
    return this.execution.reportSubmit(user, id);
  }

  async reportWithdraw(user: CurrentUser, id: string) {
    return this.execution.reportWithdraw(user, id);
  }

  async reportComment(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.execution.reportComment(user, id, body);
  }

  async reportGenerate(user: CurrentUser, body: Record<string, unknown>) {
    return this.execution.reportGenerate(user, body);
  }

  async stats(user: CurrentUser, query: Record<string, unknown>) {
    return this.insight.stats(user, query);
  }

  async export(user: CurrentUser, query: Record<string, unknown>) {
    return this.insight.export(user, query);
  }

  async scoreList(user: CurrentUser, query: Record<string, unknown>) {
    return this.insight.scoreList(user, query);
  }

  async scoreSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.insight.scoreSave(user, body);
  }

  async scoreWithdraw(user: CurrentUser, id: string) {
    return this.insight.scoreWithdraw(user, id);
  }
}
