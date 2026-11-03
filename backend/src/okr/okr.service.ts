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
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  clamp,
  csvLine,
  cycleRange,
  cycleTitle,
  dateAt,
  dateOrNull,
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
  scoreTotal,
  weekKeyOf,
  weekRange,
} from './okr.helpers';
import {
  OkrMetricsService,
  metricSourceFields,
  readMetricSource,
} from './okr.metrics.service';
import { recalcObjective, weighted } from './okr.progress';
import { OkrContext, OkrMemberRow, OkrScopeService } from './okr.scope';

type CycleRow = {
  id: number;
  ownerUserId: string;
  kind: string;
  year: number;
  period: number;
  title: string;
  startDate: Date;
  endDate: Date;
  status: string;
  closedAt: Date | null;
  createdAt: Date;
};

type ObjectiveRow = {
  id: number;
  ownerUserId: string;
  cycleId: number;
  parentId: number;
  level: string;
  title: string;
  description: string;
  ownerMemberUserId: string;
  assignerUserId: string;
  weight: unknown;
  progress: unknown;
  visibility: string;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

type KrRow = {
  id: number;
  ownerUserId: string;
  objectiveId: number;
  title: string;
  metricType: string;
  targetValue: unknown;
  currentValue: unknown;
  startValue: unknown;
  unit: string;
  direction: string;
  weight: unknown;
  ownerMemberUserId: string;
  metricSource: unknown;
  lastRefreshedAt: Date | null;
  createdAt: Date;
};

type PlanRow = {
  id: number;
  ownerUserId: string;
  memberUserId: string;
  objectiveId: number;
  krId: number;
  title: string;
  detail: string;
  kind: string;
  periodKey: string;
  startDate: Date | null;
  dueDate: Date | null;
  priority: string;
  status: string;
  progress: unknown;
  scheduleId: number;
  source: string;
  doneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReportRow = {
  id: number;
  ownerUserId: string;
  memberUserId: string;
  kind: string;
  periodKey: string;
  content: unknown;
  autoDraft: unknown;
  source: string;
  scheduleId: number;
  status: string;
  submittedAt: Date | null;
  managerComment: string;
  createdAt: Date;
  updatedAt: Date;
};

type ScoreRow = {
  id: number;
  ownerUserId: string;
  cycleId: number;
  memberUserId: string;
  reviewerUserId: string;
  scores: unknown;
  total: unknown;
  comment: string;
  status: string;
  submittedAt: Date | null;
  updatedAt: Date;
};

type ProgressRow = {
  id: number;
  krId: number;
  objectiveId: number;
  before: unknown;
  after: unknown;
  progress: unknown;
  note: string;
  source: string;
  authorId: string;
  refType: string;
  refId: string;
  createdAt: Date;
};

const CYCLE_STATUSES = new Set(['DRAFT', 'ACTIVE', 'REVIEW', 'CLOSED']);
const LEVELS = new Set(['COMPANY', 'DEPT', 'PERSONAL']);
const VISIBILITIES = new Set(['ORG', 'DEPT', 'SELF']);
const OBJ_STATUSES = new Set(['DRAFT', 'ACTIVE', 'DONE', 'CANCELLED']);
const METRIC_TYPES = new Set(['MANUAL', 'AUTO', 'ROLLUP']);
const PLAN_KINDS = new Set(['WEEK', 'DAY', 'ADHOC']);
const PLAN_STATUSES = new Set(['TODO', 'DOING', 'DONE', 'CANCELLED']);
const REPORT_KINDS = new Set(['DAILY', 'WEEKLY']);
const REPORT_SOURCES = new Set(['MANUAL', 'AGENT_AUTO', 'SYSTEM']);
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);

/** 自动指标草稿：能自动统计的优先给自动型，剩余给手动型。 */
const AUTO_KR_TEMPLATES = [
  {
    title: '本期新增商机',
    metricType: 'AUTO',
    targetValue: 20,
    unit: '个',
    direction: 'UP',
    weight: 1,
    metricSource: {
      source: 'CRM_OPPORTUNITY',
      agg: 'COUNT',
      field: '',
      filters: [],
      dateField: 'createdAt',
      dateRange: 'CYCLE',
      scope: 'ACCOUNT',
    },
  },
  {
    title: '本期合同成交金额',
    metricType: 'AUTO',
    targetValue: 1_000_000,
    unit: '元',
    direction: 'UP',
    weight: 1,
    metricSource: {
      source: 'CRM_CONTRACT',
      agg: 'SUM',
      field: 'amount',
      filters: [],
      dateField: 'createdAt',
      dateRange: 'CYCLE',
      scope: 'ACCOUNT',
    },
  },
  {
    title: '本期回款金额',
    metricType: 'AUTO',
    targetValue: 800_000,
    unit: '元',
    direction: 'UP',
    weight: 1,
    metricSource: {
      source: 'CRM_PAYMENT',
      agg: 'SUM',
      field: 'planAmount',
      filters: [],
      dateField: 'planEndAt',
      dateRange: 'CYCLE',
      scope: 'ACCOUNT',
    },
  },
  {
    title: '本期新增订单',
    metricType: 'AUTO',
    targetValue: 30,
    unit: '单',
    direction: 'UP',
    weight: 1,
    metricSource: {
      source: 'CRM_ORDER',
      agg: 'COUNT',
      field: '',
      filters: [],
      dateField: 'createdAt',
      dateRange: 'CYCLE',
      scope: 'ACCOUNT',
    },
  },
  {
    title: '关键交付完成率',
    metricType: 'MANUAL',
    targetValue: 100,
    unit: '%',
    direction: 'UP',
    weight: 1,
  },
];

/**
 * OKR 业务：周期 / 目标树 / KR / 计划 / 汇报 / 评分 / 设置 / 统计。
 * 账号归属与成员权限统一走 OkrScopeService；自动取数走 OkrMetricsService。
 */
export class OkrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OkrScopeService,
    private readonly metrics: OkrMetricsService,
    private readonly notifications: NotificationService,
  ) {}

  // =================== 概览 / 上下文 ===================

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

  // =================== 周期 ===================

  async cycleList(user: CurrentUser) {
    const ctx = await this.scope.context(user);
    return this.cycleViews(ctx.ownerUserId);
  }

  async cycleSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertOwner(ctx);
    const id = int(body['id']);
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = ['YEAR', 'QUARTER', 'MONTH'].includes(kindRaw)
      ? kindRaw
      : 'YEAR';
    const year = int(body['year'], new Date().getFullYear());
    if (year < 2000 || year > 2100) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '年份不合法');
    }
    let period = int(body['period']);
    if (kind === 'YEAR') period = 0;
    else if (kind === 'QUARTER' && (period < 1 || period > 4)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '季度周期的期数需为 1~4',
      );
    } else if (kind === 'MONTH' && (period < 1 || period > 12)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '月度周期的期数需为 1~12',
      );
    }
    const existing =
      id > 0
        ? await this.prisma.okrCycle.findFirst({
            where: { id, ownerUserId: ctx.ownerUserId },
          })
        : null;
    if (id > 0 && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '周期不存在');
    }
    if (existing?.status === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '已关闭的周期不能再修改',
      );
    }
    const defaults = cycleRange(kind, year, period);
    const startDate =
      dateOrNull(text(body['startDate']).trim()) || dateAt(defaults.startDate);
    const endDate =
      dateOrNull(text(body['endDate']).trim()) || dateAt(defaults.endDate);
    if (endDate < startDate) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '结束日期不能早于开始日期',
      );
    }
    const statusRaw = text(body['status']).toUpperCase();
    const status = CYCLE_STATUSES.has(statusRaw)
      ? statusRaw
      : existing?.status || 'ACTIVE';
    const title =
      text(body['title']).trim().slice(0, 120) ||
      cycleTitle(kind, year, period);
    const data = {
      ownerUserId: ctx.ownerUserId,
      kind,
      year,
      period,
      title,
      startDate,
      endDate,
      status,
    };
    let saved: CycleRow;
    try {
      saved = existing
        ? await this.prisma.okrCycle.update({ where: { id }, data })
        : await this.prisma.okrCycle.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '同一账号下该周期已存在',
        );
      }
      throw error;
    }
    if (!existing && status === 'ACTIVE') {
      await this.notifyMembers(ctx, {
        title: `新 OKR 周期：${title}`,
        body: `${dateStr(startDate)} 至 ${dateStr(endDate)}，请到「目标」页签查看与承接。`,
        link: '/okr?tab=objectives',
        entityType: 'okr_cycle_start',
        entityId: String(saved.id),
      });
    }
    if (existing?.status !== 'REVIEW' && status === 'REVIEW') {
      await this.notifyManagersOnce(ctx, {
        title: `周期进入复盘：${title}`,
        body: '现在可以给成员打分了。',
        link: '/okr?tab=stats',
        entityType: 'okr_cycle_review',
        entityId: `review:${saved.id}`,
      });
    }
    return this.cycleView(saved);
  }

  async cycleClose(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertOwner(ctx);
    const row = await this.cycleOf(ctx.ownerUserId, this.idOf(id));
    if (row.status === 'CLOSED') return this.cycleView(row);
    const saved = await this.prisma.okrCycle.update({
      where: { id: row.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await this.notifyMembers(ctx, {
      title: `周期已关闭：${this.cycleView(saved).title}`,
      body: '该周期的目标与 KR 已转为只读；如需继续复盘，请新建周期。',
      link: '/okr?tab=stats',
      entityType: 'okr_cycle_closed',
      entityId: `closed:${saved.id}`,
    });
    return this.cycleView(saved);
  }

  // =================== 目标 ===================

  async objectiveList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const where: Prisma.OkrObjectiveWhereInput = {};
    const cycleId = int(query['cycleId']);
    if (cycleId > 0) where.cycleId = cycleId;
    else {
      const cycle = await this.currentCycle(ctx.ownerUserId);
      where.cycleId = cycle ? cycle.id : -1;
    }
    const memberUserId = text(query['memberUserId']).trim();
    if (memberUserId) where.ownerMemberUserId = memberUserId;
    if (query['parentId'] !== undefined) {
      where.parentId = int(query['parentId']);
    }
    const result = await this.objectiveViews(ctx, where);
    return result.items;
  }

  async objectiveDetail(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.objectiveOf(ctx, this.idOf(id));
    const [visible] = await this.visibleObjectives(ctx, [row]);
    if (!visible) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标不存在');
    }
    return (await this.objectiveViews(ctx, { id: row.id })).items[0];
  }

  async objectiveSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const id = int(body['id']);
    const created = id === 0;
    const existing = created
      ? null
      : await this.prisma.okrObjective.findFirst({
          where: { id, ownerUserId: ctx.ownerUserId },
        });
    if (!created && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标不存在');
    }
    const cycleId = created ? int(body['cycleId']) : existing!.cycleId;
    const cycle = await this.cycleOf(ctx.ownerUserId, cycleId);
    this.assertCycleOpen(cycle);
    if (existing && !this.canEditObjective(ctx, existing)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能维护自己的目标；被下发的目标请联系下发人修改',
      );
    }
    const canAssign = ctx.isOwner || ctx.isManager;
    let ownerMemberUserId = text(body['ownerMemberUserId']).trim();
    if (!canAssign) {
      ownerMemberUserId = ctx.actorId;
    } else if (ownerMemberUserId && ownerMemberUserId !== ctx.ownerUserId) {
      await this.scope.requireMember(ctx, ownerMemberUserId);
    }
    if (ownerMemberUserId === ctx.ownerUserId) ownerMemberUserId = '';
    const parentId = int(body['parentId']);
    if (parentId > 0) {
      const parent = await this.prisma.okrObjective.findFirst({
        where: { id: parentId, ownerUserId: ctx.ownerUserId },
      });
      if (!parent) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '上级目标不存在');
      }
      if (parent.cycleId !== cycleId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '上级目标必须与当前目标同一周期',
        );
      }
      if (parent.id === id) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '上级目标不能是自己',
        );
      }
    }
    const title = text(body['title']).trim().slice(0, 200);
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写目标标题');
    }
    const levelRaw = text(body['level']).toUpperCase();
    const level = canAssign
      ? LEVELS.has(levelRaw)
        ? levelRaw
        : 'PERSONAL'
      : 'PERSONAL';
    const visibilityRaw = text(body['visibility']).toUpperCase();
    const visibility = VISIBILITIES.has(visibilityRaw)
      ? visibilityRaw
      : ctx.settings.defaultVisibility;
    const statusRaw = text(body['status']).toUpperCase();
    const status = OBJ_STATUSES.has(statusRaw) ? statusRaw : 'ACTIVE';
    const source =
      text(body['source']).toUpperCase() === 'AGENT' ? 'AGENT' : 'MANUAL';
    const data = {
      parentId,
      level,
      title,
      description: text(body['description']).trim().slice(0, 2000),
      ownerMemberUserId,
      weight: clamp(num(body['weight'], 1), 0, 100),
      visibility,
      status,
      source: existing?.source === 'AGENT' ? 'AGENT' : source,
    };
    let saved: ObjectiveRow;
    if (existing) {
      saved = await this.prisma.okrObjective.update({
        where: { id: existing.id },
        data,
      });
    } else {
      saved = await this.prisma.okrObjective.create({
        data: {
          ...data,
          ownerUserId: ctx.ownerUserId,
          cycleId,
          assignerUserId: '',
        },
      });
    }
    const krRows = Array.isArray(body['krs']) ? (body['krs'] as unknown[]) : [];
    const existingKrs = await this.prisma.okrKeyResult.count({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: saved.id },
    });
    if (krRows.length && (created || existingKrs === 0)) {
      await this.createKrs(
        ctx.ownerUserId,
        saved.id,
        krRows,
        ownerMemberUserId || ctx.actorId,
      );
    }
    if (existing && existing.parentId !== parentId && existing.parentId > 0) {
      await recalcObjective(this.prisma, ctx.ownerUserId, existing.parentId);
    }
    await recalcObjective(this.prisma, ctx.ownerUserId, saved.id);
    const assigneeChanged =
      !existing || existing.ownerMemberUserId !== ownerMemberUserId;
    if (
      ownerMemberUserId &&
      ownerMemberUserId !== ctx.actorId &&
      assigneeChanged
    ) {
      await this.notifications.notify(ownerMemberUserId, {
        category: 'okr',
        title: `你有新的 OKR 目标：${title}`,
        body: '请到「目标」页签查看，并补齐关键结果。',
        link: '/okr?tab=objectives',
        entityType: 'okr_objective_assign',
        entityId: String(saved.id),
      });
    }
    return (await this.objectiveViews(ctx, { id: saved.id })).items[0];
  }

  async objectiveDelete(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.objectiveOf(ctx, this.idOf(id));
    if (!this.canEditObjective(ctx, row)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能删除自己的目标');
    }
    if (
      row.ownerMemberUserId === ctx.actorId &&
      row.assignerUserId &&
      row.assignerUserId !== ctx.actorId
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '被下发的目标不能自行删除，请联系下发人',
      );
    }
    const children = await this.prisma.okrObjective.count({
      where: { ownerUserId: ctx.ownerUserId, parentId: row.id },
    });
    if (children > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该目标还有下级目标，请先删除下级目标',
      );
    }
    await this.prisma.okrKeyResult.deleteMany({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: row.id },
    });
    await this.prisma.okrProgressLog.deleteMany({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: row.id },
    });
    await this.prisma.okrPlan.updateMany({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: row.id },
      data: { objectiveId: 0, krId: 0 },
    });
    await this.prisma.okrObjective.delete({ where: { id: row.id } });
    if (row.parentId > 0) {
      await recalcObjective(this.prisma, ctx.ownerUserId, row.parentId);
    }
    return { removed: true };
  }

  async objectiveAssign(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const parent = await this.objectiveOf(ctx, this.idOf(id));
    const cycle = await this.cycleOf(ctx.ownerUserId, parent.cycleId);
    this.assertCycleOpen(cycle);
    const rawIds = Array.isArray(body['memberUserIds'])
      ? body['memberUserIds']
      : [];
    const memberIds = [
      ...new Set(rawIds.map((item) => text(item).trim()).filter(Boolean)),
    ];
    if (!memberIds.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要下发的成员');
    }
    const members = await this.scope.members(ctx.ownerUserId);
    for (const memberUserId of memberIds) {
      if (!members.some((row) => row.memberUserId === memberUserId)) {
        await this.scope.requireMember(ctx, memberUserId);
      }
    }
    const krTitles = (Array.isArray(body['krTitles']) ? body['krTitles'] : [])
      .map((item) => text(item).trim().slice(0, 200))
      .filter(Boolean);
    const source =
      text(body['source']).toUpperCase() === 'AGENT' ? 'AGENT' : 'MANUAL';
    const planKindRaw = text(body['generatePlan']).toUpperCase();
    const planKind =
      planKindRaw === 'WEEK' || planKindRaw === 'DAY' ? planKindRaw : '';
    const createdIds: number[] = [];
    const planIds: number[] = [];
    for (const memberUserId of memberIds) {
      const member = members.find((row) => row.memberUserId === memberUserId)!;
      const child = await this.prisma.okrObjective.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          cycleId: parent.cycleId,
          parentId: parent.id,
          level: 'PERSONAL',
          title: `${parent.title} · ${member.name}`.slice(0, 200),
          description: parent.description,
          ownerMemberUserId: memberUserId,
          assignerUserId: ctx.actorId,
          weight: 1,
          visibility: parent.visibility,
          status: 'ACTIVE',
          source,
        },
      });
      createdIds.push(child.id);
      const krs = krTitles.length
        ? await this.createKrs(
            ctx.ownerUserId,
            child.id,
            krTitles.map((title) => ({
              title,
              metricType: 'MANUAL',
              targetValue: 100,
              unit: '%',
              direction: 'UP',
              weight: 1,
            })),
            memberUserId,
          )
        : [];
      if (planKind) {
        const period = this.periodOf(planKind, ctx.settings.weekStart);
        const plan = await this.prisma.okrPlan.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            memberUserId,
            objectiveId: child.id,
            krId: krs[0]?.id || 0,
            title: `承接：${parent.title}`.slice(0, 200),
            detail: parent.description.slice(0, 2000),
            kind: planKind,
            periodKey: period.key,
            startDate: dateAt(period.start),
            dueDate: dateAt(period.end),
            priority: 'HIGH',
            status: 'TODO',
            progress: 0,
            source,
          },
        });
        planIds.push(plan.id);
      }
      await this.notifications.notify(memberUserId, {
        category: 'okr',
        title: `你收到一条新的目标：${parent.title}`,
        body: '请到「目标」页签查看，并补齐关键结果与计划。',
        link: '/okr?tab=objectives',
        entityType: 'okr_objective_assign',
        entityId: String(child.id),
      });
    }
    await recalcObjective(this.prisma, ctx.ownerUserId, parent.id);
    const objectives =
      createdIds.length > 0
        ? (
            await this.objectiveViews(ctx, {
              id: { in: createdIds },
            })
          ).items
        : [];
    const plans = planIds.length
      ? await this.prisma.okrPlan.findMany({
          where: { ownerUserId: ctx.ownerUserId, id: { in: planIds } },
          orderBy: { id: 'asc' },
        })
      : [];
    const names = await this.planNames(plans);
    const ownerName =
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) || '';
    return {
      objectives,
      plans: plans.map((row) => this.planView(row, names, ownerName)),
    };
  }

  // =================== 草稿（不落库） ===================

  async draftObjective(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const direction = text(body['direction']).trim();
    if (!direction) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先说明目标方向，例如「提升华东区新签合同额」',
      );
    }
    const levelRaw = text(body['level']).toUpperCase();
    const level = LEVELS.has(levelRaw) ? levelRaw : 'COMPANY';
    const memberUserId = text(body['memberUserId']).trim();
    const krCount = Math.min(Math.max(int(body['krCount'], 3), 2), 5);
    const cycleId = int(body['cycleId']);
    const cycle =
      cycleId > 0
        ? await this.cycleOf(ctx.ownerUserId, cycleId)
        : await this.currentCycle(ctx.ownerUserId);
    const notes: string[] = [];
    const members = await this.scope.members(ctx.ownerUserId);
    const member = members.find((row) => row.memberUserId === memberUserId);
    const title = direction.slice(0, 200);
    const description = cycle
      ? `围绕「${direction}」的${this.cycleView(cycle).title}目标。`
      : `围绕「${direction}」的 OKR 目标。`;
    const krs = AUTO_KR_TEMPLATES.slice(0, krCount).map((item) => ({
      ...item,
      metricSource: item.metricSource ? { ...item.metricSource } : undefined,
    }));
    notes.push(
      '自动指标按所选周期的起止日期统计；可在 KR 保存后调整数据源与范围。',
    );
    if (!cycle) {
      notes.push(
        '当前账号还没有周期，建议先在「目标」页签创建年度/季度/月度周期。',
      );
    }
    if (member) {
      const positions = member.positions.map((item) => item.name).join('、');
      notes.push(
        positions
          ? `${member.name} 在本组织的岗位：${positions}；拆解时会据此建议承担方向。`
          : `${member.name} 还没有岗位与能力说明，只能按部门和历史完成度建议。`,
      );
    }
    return {
      objective: {
        title,
        description,
        level,
        memberUserId,
        memberName: member?.name || '',
        krs,
      },
      notes,
    };
  }

  async decomposeSuggest(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const objective = await this.objectiveOf(ctx, int(body['objectiveId']));
    const members = await this.scope.members(ctx.ownerUserId);
    const wanted = (
      Array.isArray(body['memberUserIds']) ? body['memberUserIds'] : []
    )
      .map((item) => text(item).trim())
      .filter(Boolean);
    const candidates = wanted.length
      ? members.filter((row) => wanted.includes(row.memberUserId))
      : members;
    if (!candidates.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '本账号还没有可承接的职员或代理人',
      );
    }
    const parentKrs = await this.prisma.okrKeyResult.findMany({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: objective.id },
      orderBy: { id: 'asc' },
    });
    const objectives = await this.prisma.okrObjective.findMany({
      where: { ownerUserId: ctx.ownerUserId, cycleId: objective.cycleId },
      select: {
        id: true,
        ownerMemberUserId: true,
        progress: true,
      },
    });
    const notes: string[] = [];
    let missing = 0;
    const suggestions = candidates.map((member) => {
      const mine = objectives.filter(
        (row) => row.ownerMemberUserId === member.memberUserId,
      );
      const average = weighted(
        mine.map((row) => ({ weight: 1, progress: num(row.progress) })),
      );
      const tags = member.positions.map((item) => item.name).filter(Boolean);
      const parts: string[] = [];
      if (tags.length) parts.push(`岗位：${tags.join('、')}`);
      else {
        parts.push('还没填岗位与能力说明');
        missing += 1;
      }
      if (member.capabilities) {
        parts.push(`能力：${member.capabilities.slice(0, 60)}`);
      }
      parts.push(
        mine.length ? `本周期已有 ${mine.length} 个目标` : '本周期还没有目标',
      );
      if (mine.length) parts.push(`平均完成度 ${average}%`);
      const krs = parentKrs.length
        ? parentKrs.map((kr) => ({
            title: kr.title,
            metricType: 'MANUAL',
            targetValue: round(num(kr.targetValue) / candidates.length, 2),
            unit: kr.unit,
            direction: kr.direction,
            weight: num(kr.weight, 1),
          }))
        : [
            {
              title: `${objective.title} · 个人承担部分`,
              metricType: 'MANUAL',
              targetValue: 100,
              unit: '%',
              direction: 'UP',
              weight: 1,
            },
          ];
      return {
        memberUserId: member.memberUserId,
        memberName: member.name,
        department: member.department,
        positions: member.positions,
        capabilities: member.capabilities,
        reason: parts.join('；'),
        krs,
      };
    });
    if (missing > 0) {
      notes.push(
        `${missing} 人还没有填写岗位与能力说明，建议只按部门和历史完成度拆解，并在下发后逐个调整。`,
      );
    }
    notes.push(
      `目标值按 ${candidates.length} 人平均拆分，可在下发前后按实际情况调整；最终承接人需要你确认。`,
    );
    return { suggestions, notes };
  }

  async planGenerate(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = kindRaw === 'DAY' ? 'DAY' : 'WEEK';
    const raw = text(body['memberUserId']).trim();
    const memberUserId =
      raw || (ctx.actorId === ctx.ownerUserId ? '' : ctx.actorId);
    this.scope.assertCanWriteMember(ctx, raw || ctx.actorId);
    const cycleId = int(body['cycleId']);
    const cycle =
      cycleId > 0
        ? await this.cycleOf(ctx.ownerUserId, cycleId)
        : await this.currentCycle(ctx.ownerUserId);
    const period = this.periodOf(kind, ctx.settings.weekStart);
    const notes: string[] = [];
    const plans: Record<string, unknown>[] = [];
    if (cycle) {
      const objectives = await this.prisma.okrObjective.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          cycleId: cycle.id,
          ownerMemberUserId: memberUserId,
          status: 'ACTIVE',
        },
        orderBy: { id: 'asc' },
      });
      const krRows = objectives.length
        ? await this.prisma.okrKeyResult.findMany({
            where: {
              ownerUserId: ctx.ownerUserId,
              objectiveId: { in: objectives.map((row) => row.id) },
            },
            orderBy: [{ objectiveId: 'asc' }, { id: 'asc' }],
          })
        : [];
      for (const kr of krRows) {
        const objective = objectives.find((row) => row.id === kr.objectiveId);
        if (!objective) continue;
        const progress = progressOf(
          kr.direction,
          num(kr.startValue),
          num(kr.currentValue),
          num(kr.targetValue),
        );
        if (progress >= 100 || plans.length >= 6) continue;
        plans.push({
          title: `推进：${kr.title}`.slice(0, 200),
          detail:
            `目标：${objective.title}｜当前 ${num(kr.currentValue)}/${num(kr.targetValue)}${kr.unit}`.slice(
              0,
              2000,
            ),
          kind,
          periodKey: period.key,
          startDate: period.start,
          dueDate: period.end,
          priority: progress < 30 ? 'HIGH' : 'MEDIUM',
          krId: kr.id,
          objectiveId: objective.id,
        });
      }
    }
    const previous = this.previousPeriod(kind, ctx.settings.weekStart);
    const carried = await this.prisma.okrPlan.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        memberUserId,
        kind,
        periodKey: previous,
        status: { in: ['TODO', 'DOING'] },
      },
      orderBy: { id: 'asc' },
      take: 10,
    });
    for (const plan of carried) {
      if (plans.length >= 10) break;
      plans.push({
        title: `继续：${plan.title}`.slice(0, 200),
        detail: plan.detail,
        kind,
        periodKey: period.key,
        startDate: period.start,
        dueDate: period.end,
        priority: plan.priority,
        krId: plan.krId,
        objectiveId: plan.objectiveId,
      });
    }
    if (!plans.length) {
      notes.push(
        '当前没有未完成的 KR 或计划，请先在「目标」页签建立目标与 KR。',
      );
    } else {
      notes.push(
        `已按 KR 进度与上一${kind === 'WEEK' ? '周' : '日'}未完成计划生成 ${plans.length} 条草稿，可增删后再保存。`,
      );
    }
    return { periodKey: period.key, plans, notes };
  }

  // =================== KR ===================

  async krSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const id = int(body['id']);
    const objectiveId = int(body['objectiveId']);
    const objective = await this.objectiveOf(ctx, objectiveId);
    const existing =
      id > 0
        ? await this.prisma.okrKeyResult.findFirst({
            where: { id, ownerUserId: ctx.ownerUserId },
          })
        : null;
    if (id > 0 && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '关键结果不存在');
    }
    if (existing && existing.objectiveId !== objectiveId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '关键结果不属于该目标',
      );
    }
    const editable =
      this.canEditObjective(ctx, objective) ||
      existing?.ownerMemberUserId === ctx.actorId;
    if (!editable) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能维护自己的目标与关键结果',
      );
    }
    const cycle = await this.cycleOf(ctx.ownerUserId, objective.cycleId);
    this.assertCycleOpen(cycle);
    const title = text(body['title']).trim().slice(0, 200);
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写关键结果');
    }
    const metricRaw = text(body['metricType']).toUpperCase();
    const metricType = METRIC_TYPES.has(metricRaw) ? metricRaw : 'MANUAL';
    let ownerMemberUserId = text(body['ownerMemberUserId']).trim();
    if (!(ctx.isOwner || ctx.isManager)) {
      ownerMemberUserId = ctx.actorId;
    } else if (ownerMemberUserId && ownerMemberUserId !== ctx.ownerUserId) {
      await this.scope.requireMember(ctx, ownerMemberUserId);
    }
    if (ownerMemberUserId === ctx.ownerUserId) ownerMemberUserId = '';
    const source = body['metricSource']
      ? this.metricSourceValue(body['metricSource'])
      : {};
    const data = {
      title,
      metricType,
      targetValue: num(body['targetValue'], 100),
      startValue: num(body['startValue']),
      currentValue: num(body['currentValue']),
      unit: text(body['unit']).slice(0, 32),
      direction:
        text(body['direction']).toUpperCase() === 'DOWN' ? 'DOWN' : 'UP',
      weight: clamp(num(body['weight'], 1), 0, 100),
      ownerMemberUserId,
      metricSource: source,
    };
    const saved = existing
      ? await this.prisma.okrKeyResult.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.okrKeyResult.create({
          data: { ...data, ownerUserId: ctx.ownerUserId, objectiveId },
        });
    await recalcObjective(this.prisma, ctx.ownerUserId, objectiveId);
    const names = await this.scope.names([
      ownerMemberUserId || ctx.ownerUserId,
    ]);
    const ownerName = names.get(ownerMemberUserId || ctx.ownerUserId) || '';
    return this.krView(saved, names, ownerName);
  }

  async krDelete(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const kr = await this.krOf(ctx, this.idOf(id));
    const objective = await this.objectiveOf(ctx, kr.objectiveId);
    if (
      !this.canEditObjective(ctx, objective) &&
      kr.ownerMemberUserId !== ctx.actorId
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能删除自己的关键结果',
      );
    }
    const cycle = await this.cycleOf(ctx.ownerUserId, objective.cycleId);
    this.assertCycleOpen(cycle);
    await this.prisma.okrProgressLog.deleteMany({
      where: { ownerUserId: ctx.ownerUserId, krId: kr.id },
    });
    await this.prisma.okrPlan.updateMany({
      where: { ownerUserId: ctx.ownerUserId, krId: kr.id },
      data: { krId: 0 },
    });
    await this.prisma.okrKeyResult.delete({ where: { id: kr.id } });
    await recalcObjective(this.prisma, ctx.ownerUserId, kr.objectiveId);
    return { removed: true };
  }

  async krProgress(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    const kr = await this.krOf(ctx, this.idOf(id));
    const objective = await this.objectiveOf(ctx, kr.objectiveId);
    if (
      !this.canEditObjective(ctx, objective) &&
      kr.ownerMemberUserId !== ctx.actorId
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能更新自己的关键结果进度',
      );
    }
    const cycle = await this.cycleOf(ctx.ownerUserId, objective.cycleId);
    this.assertCycleOpen(cycle);
    if (kr.metricType === 'AUTO') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '自动统计的 KR 由指标刷新更新数值，不能手工填写',
      );
    }
    const before = num(kr.currentValue);
    const after =
      body['currentValue'] === undefined || body['currentValue'] === null
        ? before
        : num(body['currentValue']);
    const note = text(body['note']).trim().slice(0, 500);
    const saved = await this.prisma.okrKeyResult.update({
      where: { id: kr.id },
      data: { currentValue: after },
    });
    const progress = progressOf(
      kr.direction,
      num(kr.startValue),
      after,
      num(kr.targetValue),
    );
    if (after !== before || note) {
      await this.prisma.okrProgressLog.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          krId: kr.id,
          objectiveId: kr.objectiveId,
          before,
          after,
          progress,
          note,
          source: 'MANUAL',
          authorId: ctx.actorId,
        },
      });
    }
    await recalcObjective(this.prisma, ctx.ownerUserId, kr.objectiveId);
    const names = await this.scope.names([
      kr.ownerMemberUserId || ctx.ownerUserId,
    ]);
    const ownerName = names.get(kr.ownerMemberUserId || ctx.ownerUserId) || '';
    return { kr: this.krView(saved, names, ownerName), progress };
  }

  async progressList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const krId = int(query['krId']);
    const objectiveId = int(query['objectiveId']);
    const visibility = await this.visibleObjectiveIds(ctx);
    const where: Prisma.OkrProgressLogWhereInput = {
      ownerUserId: ctx.ownerUserId,
    };
    if (krId > 0) where.krId = krId;
    if (objectiveId > 0) where.objectiveId = objectiveId;
    if (visibility !== null) {
      const krs = await this.prisma.okrKeyResult.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          OR: [
            { ownerMemberUserId: ctx.actorId },
            { objectiveId: { in: [...visibility] } },
          ],
        },
        select: { id: true },
      });
      where.OR = [
        { krId: { in: krs.map((row) => row.id) } },
        { objectiveId: { in: [...visibility] } },
        { authorId: ctx.actorId },
      ];
    }
    const rows = await this.prisma.okrProgressLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.progressView(row));
  }

  // =================== 自动指标 ===================

  async metricPreview(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const cycleId = int(body['cycleId']);
    const cycle =
      cycleId > 0
        ? await this.cycleOf(ctx.ownerUserId, cycleId)
        : await this.currentCycle(ctx.ownerUserId);
    const raw = body['metricSource'];
    if (!raw || typeof raw !== 'object') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请配置数据源');
    }
    return this.metrics.evaluate(user, raw, this.cycleRangeOf(cycle));
  }

  async metricRefresh(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const krId = int(body['krId']);
    const cycleId = int(body['cycleId']);
    let ids: number[] = [];
    if (krId > 0) {
      const kr = await this.krOf(ctx, krId);
      const objective = await this.objectiveOf(ctx, kr.objectiveId);
      if (
        !this.canEditObjective(ctx, objective) &&
        kr.ownerMemberUserId !== ctx.actorId
      ) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '只能刷新自己的关键结果',
        );
      }
      if (kr.metricType !== 'AUTO') {
        return {
          refreshed: 0,
          failed: 1,
          message: '该 KR 不是自动统计类型',
          items: [],
        };
      }
      ids = [kr.id];
    } else {
      this.scope.assertManager(ctx);
      const cycle =
        cycleId > 0
          ? await this.cycleOf(ctx.ownerUserId, cycleId)
          : await this.currentCycle(ctx.ownerUserId);
      if (!cycle) {
        return {
          refreshed: 0,
          failed: 0,
          message: '还没有可刷新的周期',
          items: [],
        };
      }
      ids = await this.metrics.autoKrIds(ctx.ownerUserId, cycle.id);
    }
    if (!ids.length) {
      return {
        refreshed: 0,
        failed: 0,
        message: '没有自动统计类型的 KR 需要刷新',
        items: [],
      };
    }
    const items = await this.metrics.refresh(user, ctx.ownerUserId, ids);
    const refreshed = items.filter((item) => item.ok).length;
    const failed = items.length - refreshed;
    return {
      refreshed,
      failed,
      message:
        failed > 0
          ? `成功刷新 ${refreshed} 条，${failed} 条取数失败（已保留上次结果）`
          : `成功刷新 ${refreshed} 条`,
      items,
    };
  }

  // =================== 计划 ===================

  async planList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const self = this.selfKey(ctx);
    const requested = text(query['memberUserId']).trim();
    const memberUserId =
      ctx.isOwner || ctx.isManager ? requested || self : self;
    const where: Prisma.OkrPlanWhereInput = {
      ownerUserId: ctx.ownerUserId,
      memberUserId:
        memberUserId === '' ? { in: ['', ctx.actorId] } : memberUserId,
    };
    const kind = text(query['kind']).toUpperCase();
    if (PLAN_KINDS.has(kind)) where.kind = kind;
    const periodKey = text(query['periodKey']).trim();
    if (periodKey) where.periodKey = periodKey;
    const status = text(query['status']).toUpperCase();
    if (PLAN_STATUSES.has(status)) where.status = status;
    const cycleId = int(query['cycleId']);
    let cycleObjectiveIds: number[] | null = null;
    if (cycleId > 0) {
      const rows = await this.prisma.okrObjective.findMany({
        where: { ownerUserId: ctx.ownerUserId, cycleId },
        select: { id: true },
      });
      cycleObjectiveIds = rows.map((row) => row.id);
    }
    const rows = await this.prisma.okrPlan.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 300,
    });
    const filtered = cycleObjectiveIds
      ? rows.filter(
          (row) =>
            row.objectiveId === 0 ||
            cycleObjectiveIds.includes(row.objectiveId),
        )
      : rows;
    const names = await this.planNames(filtered);
    const ownerName =
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) || '';
    return filtered.map((row) => this.planView(row, names, ownerName));
  }

  async planSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const id = int(body['id']);
    const existing =
      id > 0
        ? await this.prisma.okrPlan.findFirst({
            where: { id, ownerUserId: ctx.ownerUserId },
          })
        : null;
    if (id > 0 && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '计划不存在');
    }
    const raw = text(body['memberUserId']).trim();
    let memberUserId = existing ? existing.memberUserId : raw;
    if (!memberUserId) memberUserId = this.selfKey(ctx);
    this.scope.assertCanWriteMember(ctx, raw || ctx.actorId);
    if (memberUserId && memberUserId !== ctx.ownerUserId) {
      await this.scope.requireMember(ctx, memberUserId);
    }
    const objectiveId = int(body['objectiveId']);
    const krId = int(body['krId']);
    if (objectiveId > 0) {
      const objective = await this.objectiveOf(ctx, objectiveId);
      const cycle = await this.cycleOf(ctx.ownerUserId, objective.cycleId);
      this.assertCycleOpen(cycle);
    }
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = PLAN_KINDS.has(kindRaw) ? kindRaw : 'ADHOC';
    const period =
      kind === 'ADHOC'
        ? { key: '', start: '', end: '' }
        : this.periodOf(kind as 'WEEK' | 'DAY', ctx.settings.weekStart);
    const periodKey = text(body['periodKey']).trim() || period.key;
    const startRaw = dateOrNull(text(body['startDate']).trim());
    const dueRaw = dateOrNull(text(body['dueDate']).trim());
    const startDate = startRaw || (period.start ? dateAt(period.start) : null);
    const dueDate = dueRaw || (period.end ? dateAt(period.end) : null);
    const priorityRaw = text(body['priority']).toUpperCase();
    const data = {
      memberUserId,
      objectiveId,
      krId,
      title: text(body['title']).trim().slice(0, 200) || '未命名计划',
      detail: text(body['detail']).trim().slice(0, 2000),
      kind,
      periodKey: periodKey.slice(0, 16),
      startDate,
      dueDate,
      priority: PRIORITIES.has(priorityRaw) ? priorityRaw : 'MEDIUM',
      source:
        existing?.source === 'AGENT' ||
        text(body['source']).toUpperCase() === 'AGENT'
          ? 'AGENT'
          : 'MANUAL',
    };
    const saved = existing
      ? await this.prisma.okrPlan.update({ where: { id: existing.id }, data })
      : await this.prisma.okrPlan.create({
          data: {
            ...data,
            ownerUserId: ctx.ownerUserId,
            status: 'TODO',
            progress: 0,
          },
        });
    return this.planViewSaved(ctx, saved);
  }

  async planUpdate(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    const row = await this.planOf(ctx, this.idOf(id));
    this.assertPlanWritable(ctx, row);
    const data: Prisma.OkrPlanUpdateInput = {};
    if (body['title'] !== undefined) {
      data.title = text(body['title']).trim().slice(0, 200) || row.title;
    }
    if (body['detail'] !== undefined) {
      data.detail = text(body['detail']).trim().slice(0, 2000);
    }
    if (body['dueDate'] !== undefined) {
      data.dueDate = dateOrNull(text(body['dueDate']).trim());
    }
    const priorityRaw = text(body['priority']).toUpperCase();
    if (PRIORITIES.has(priorityRaw)) data.priority = priorityRaw;
    const statusRaw = text(body['status']).toUpperCase();
    let becameDone = false;
    if (PLAN_STATUSES.has(statusRaw)) {
      data.status = statusRaw;
      if (statusRaw === 'DONE' && row.status !== 'DONE') {
        data.doneAt = new Date();
        data.progress = 100;
        becameDone = true;
      } else if (statusRaw !== 'DONE' && row.status === 'DONE') {
        data.doneAt = null;
        data.progress =
          body['progress'] !== undefined
            ? clamp(num(body['progress']), 0, 100)
            : 0;
      }
    }
    if (body['progress'] !== undefined && !becameDone) {
      data.progress = clamp(num(body['progress']), 0, 100);
    }
    const saved = await this.prisma.okrPlan.update({
      where: { id: row.id },
      data,
    });
    if (becameDone && saved.krId > 0) {
      const kr = await this.prisma.okrKeyResult.findFirst({
        where: { id: saved.krId, ownerUserId: ctx.ownerUserId },
      });
      if (kr) {
        await this.prisma.okrProgressLog.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            krId: kr.id,
            objectiveId: kr.objectiveId,
            before: num(kr.currentValue),
            after: num(kr.currentValue),
            progress: progressOf(
              kr.direction,
              num(kr.startValue),
              num(kr.currentValue),
              num(kr.targetValue),
            ),
            note: `计划完成：${saved.title}`.slice(0, 500),
            source: 'PLAN',
            authorId: ctx.actorId,
            refType: 'PLAN',
            refId: String(saved.id),
          },
        });
      }
    }
    return this.planViewSaved(ctx, saved);
  }

  async planDelete(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.planOf(ctx, this.idOf(id));
    this.assertPlanWritable(ctx, row);
    await this.prisma.okrPlan.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async planLinkSchedule(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    const row = await this.planOf(ctx, this.idOf(id));
    this.assertPlanWritable(ctx, row);
    const scheduleId = int(body['scheduleId']);
    if (scheduleId > 0) {
      const schedule = await this.prisma.contentAgentSchedule.findFirst({
        where: {
          id: scheduleId,
          userId: { in: [ctx.actorId, ctx.ownerUserId] },
        },
        select: { id: true },
      });
      if (!schedule) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '定时任务不存在');
      }
    }
    const saved = await this.prisma.okrPlan.update({
      where: { id: row.id },
      data: { scheduleId },
    });
    return this.planViewSaved(ctx, saved);
  }

  // =================== 汇报 ===================

  async reportList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const kindRaw = text(query['kind']).toUpperCase();
    const kind = REPORT_KINDS.has(kindRaw) ? kindRaw : 'DAILY';
    const where: Prisma.OkrReportWhereInput = {
      ownerUserId: ctx.ownerUserId,
      kind,
    };
    const periodKey = text(query['periodKey']).trim();
    if (periodKey) where.periodKey = periodKey;
    const scopeRaw = text(query['scope']).toUpperCase();
    if (!(ctx.isOwner || ctx.isManager) || scopeRaw === 'MINE') {
      where.memberUserId = ctx.actorId === ctx.ownerUserId ? '' : ctx.actorId;
    }
    const memberUserId = text(query['memberUserId']).trim();
    if (memberUserId) where.memberUserId = memberUserId;
    const rows = await this.prisma.okrReport.findMany({
      where,
      orderBy: [{ periodKey: 'desc' }, { id: 'desc' }],
      take: 300,
    });
    return this.reportViews(ctx, rows);
  }

  async reportGet(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.reportOf(ctx, this.idOf(id));
    this.assertReportVisible(ctx, row);
    return (await this.reportViews(ctx, [row]))[0];
  }

  async reportSaveDraft(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = REPORT_KINDS.has(kindRaw) ? kindRaw : 'DAILY';
    const raw = text(body['memberUserId']).trim();
    this.scope.assertCanWriteMember(ctx, raw || ctx.actorId);
    const memberUserId = raw
      ? raw === ctx.ownerUserId
        ? ''
        : raw
      : this.selfKey(ctx);
    if (memberUserId) await this.scope.requireMember(ctx, memberUserId);
    const period = this.reportPeriod(
      kind,
      text(body['periodKey']).trim(),
      ctx.settings.weekStart,
    );
    const sourceRaw = text(body['source']).toUpperCase();
    const source = REPORT_SOURCES.has(sourceRaw) ? sourceRaw : 'MANUAL';
    const incoming = jsonObject(body['content']);
    const existing = await this.prisma.okrReport.findUnique({
      where: {
        ownerUserId_memberUserId_kind_periodKey: {
          ownerUserId: ctx.ownerUserId,
          memberUserId,
          kind,
          periodKey: period.key,
        },
      },
    });
    if (existing) {
      if (existing.status === 'SUBMITTED') {
        if (source !== 'AGENT_AUTO') {
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '已提交的汇报不能修改，请先撤回',
          );
        }
        return (await this.reportViews(ctx, [existing]))[0];
      }
      const kept = jsonObject(existing.content);
      const hasContent = Object.keys(kept).length > 0;
      const content =
        source === 'AGENT_AUTO' && hasContent ? existing.content : incoming;
      const saved = await this.prisma.okrReport.update({
        where: { id: existing.id },
        data: {
          content: content as Prisma.InputJsonValue,
          autoDraft:
            source === 'AGENT_AUTO'
              ? (incoming as Prisma.InputJsonValue)
              : (existing.autoDraft as Prisma.InputJsonValue),
          source,
          scheduleId: int(body['scheduleId']) || existing.scheduleId,
        },
      });
      return (await this.reportViews(ctx, [saved]))[0];
    }
    const saved = await this.prisma.okrReport.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        memberUserId,
        kind,
        periodKey: period.key,
        content: incoming as Prisma.InputJsonValue,
        autoDraft:
          source === 'AGENT_AUTO' ? (incoming as Prisma.InputJsonValue) : {},
        source,
        scheduleId: int(body['scheduleId']),
        status: 'DRAFT',
      },
    });
    if (source === 'AGENT_AUTO') {
      await this.notifications.notify(memberUserId || ctx.ownerUserId, {
        category: 'okr',
        title: kind === 'DAILY' ? '今日日报草稿已生成' : '本周周报草稿已生成',
        body: '打开「汇报」页签检查并提交即可。',
        link: '/okr?tab=reports',
        entityType: 'okr_report_draft',
        entityId: String(saved.id),
      });
    }
    return (await this.reportViews(ctx, [saved]))[0];
  }

  async reportSubmit(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.reportOf(ctx, this.idOf(id));
    if (
      row.memberUserId !== this.selfKey(ctx) &&
      row.memberUserId !== ctx.actorId
    ) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能提交自己的汇报');
    }
    const saved = await this.prisma.okrReport.update({
      where: { id: row.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    const view = (await this.reportViews(ctx, [saved]))[0];
    const members = await this.scope.members(ctx.ownerUserId);
    const name =
      members.find((item) => item.memberUserId === row.memberUserId)?.name ||
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) ||
      '';
    await this.notifyManagersOnce(ctx, {
      title: `${name}提交了${OKR_REPORT_KIND_LABELS[saved.kind] || '汇报'}`,
      body: `${saved.periodKey} 的汇报已提交，可到「汇报」页签查看并点评。`,
      link: '/okr?tab=reports',
      entityType: 'okr_report_submitted',
      entityId: `submit:${saved.id}:${saved.updatedAt.toISOString()}`,
    });
    return view;
  }

  async reportWithdraw(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.reportOf(ctx, this.idOf(id));
    if (
      row.memberUserId !== this.selfKey(ctx) &&
      row.memberUserId !== ctx.actorId
    ) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能撤回自己的汇报');
    }
    const saved = await this.prisma.okrReport.update({
      where: { id: row.id },
      data: { status: 'DRAFT', submittedAt: null },
    });
    return (await this.reportViews(ctx, [saved]))[0];
  }

  async reportComment(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const row = await this.reportOf(ctx, this.idOf(id));
    const saved = await this.prisma.okrReport.update({
      where: { id: row.id },
      data: {
        managerComment: text(body['comment']).trim().slice(0, 500),
      },
    });
    const target = row.memberUserId || ctx.ownerUserId;
    if (target !== ctx.actorId) {
      await this.notifications.notify(target, {
        category: 'okr',
        title: '你的汇报收到一条点评',
        body: '打开「汇报」页签查看点评内容。',
        link: '/okr?tab=reports',
        entityType: 'okr_report_comment',
        entityId: String(row.id),
      });
    }
    return (await this.reportViews(ctx, [saved]))[0];
  }

  async reportGenerate(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    if (!ctx.settings.autoDraftEnabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '自动草稿已在设置里关闭，开启后才能一键生成',
      );
    }
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = REPORT_KINDS.has(kindRaw) ? kindRaw : 'DAILY';
    const raw = text(body['memberUserId']).trim();
    this.scope.assertCanWriteMember(ctx, raw || ctx.actorId);
    const memberUserId = raw
      ? raw === ctx.ownerUserId
        ? ''
        : raw
      : this.selfKey(ctx);
    if (memberUserId) await this.scope.requireMember(ctx, memberUserId);
    const actorId = memberUserId || ctx.actorId;
    const period = this.reportPeriod(
      kind,
      text(body['periodKey']).trim(),
      ctx.settings.weekStart,
    );
    const overwrite = Boolean(body['overwrite']);
    const existing = await this.prisma.okrReport.findUnique({
      where: {
        ownerUserId_memberUserId_kind_periodKey: {
          ownerUserId: ctx.ownerUserId,
          memberUserId,
          kind,
          periodKey: period.key,
        },
      },
    });
    if (existing?.status === 'SUBMITTED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '本期汇报已提交，如需重新生成请先撤回',
      );
    }
    const content = await this.buildReportContent(
      ctx,
      actorId,
      memberUserId,
      kind,
      period,
    );
    const hasContent =
      existing && Object.keys(jsonObject(existing.content)).length > 0;
    const keepExisting = Boolean(existing) && hasContent && !overwrite;
    const saved = existing
      ? await this.prisma.okrReport.update({
          where: { id: existing.id },
          data: {
            autoDraft: content,
            content: keepExisting
              ? (existing.content as Prisma.InputJsonValue)
              : (content as Prisma.InputJsonValue),
            source: 'SYSTEM',
          },
        })
      : await this.prisma.okrReport.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            memberUserId,
            kind,
            periodKey: period.key,
            content: content,
            autoDraft: content,
            source: 'SYSTEM',
            status: 'DRAFT',
          },
        });
    return (await this.reportViews(ctx, [saved]))[0];
  }

  // =================== 统计 / 导出 ===================

  async stats(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const requested = int(query['cycleId']);
    const cycle =
      requested > 0
        ? await this.cycleOf(ctx.ownerUserId, requested)
        : await this.currentCycle(ctx.ownerUserId);
    const dimensions = ctx.settings.scoreDimensions;
    if (!cycle) {
      return {
        cycle: null,
        completion: 0,
        objectiveCount: 0,
        krCount: 0,
        memberRanking: [],
        krTrend: [],
        scoreDistribution: [],
        scoreDimensions: dimensions,
        summary: ['还没有周期，先在「目标」页签创建年度/季度/月度周期。'],
      };
    }
    const objectives = await this.collectObjectives(ctx, { cycleId: cycle.id });
    const allKrs = objectives.length
      ? await this.prisma.okrKeyResult.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            objectiveId: { in: objectives.map((row) => row.id) },
          },
          select: { id: true },
        })
      : [];
    const reports = await this.prisma.okrReport.findMany({
      where: { ownerUserId: ctx.ownerUserId },
    });
    const cycleReports = reports.filter((row) =>
      this.periodInRange(
        row.periodKey,
        row.kind,
        cycle,
        ctx.settings.weekStart,
      ),
    );
    const scores = await this.prisma.okrScore.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        cycleId: cycle.id,
        status: 'SUBMITTED',
      },
    });
    const members = await this.scope.members(ctx.ownerUserId);
    const names = await this.scope.names([
      ctx.ownerUserId,
      ...members.map((row) => row.memberUserId),
    ]);
    const keys = new Set<string>();
    for (const row of objectives) keys.add(row.ownerMemberUserId);
    for (const row of cycleReports) keys.add(row.memberUserId);
    const averageByMember = new Map<string, number>();
    const scoreGroup = new Map<string, number[]>();
    for (const row of scores) {
      const list = scoreGroup.get(row.memberUserId) || [];
      list.push(num(row.total));
      scoreGroup.set(row.memberUserId, list);
    }
    for (const [memberUserId, list] of scoreGroup) {
      averageByMember.set(
        memberUserId,
        round(list.reduce((sum, value) => sum + value, 0) / list.length, 1),
      );
    }
    const memberRanking = [...keys]
      .map((key) => {
        const owned = objectives.filter((row) => row.ownerMemberUserId === key);
        const member = members.find((row) => row.memberUserId === key);
        return {
          memberUserId: key,
          memberName: member?.name || names.get(key) || (key ? key : '账号'),
          department: member?.department || '',
          objectives: owned.length,
          progress: this.completionOf(owned),
          reports: cycleReports.filter((row) => row.memberUserId === key)
            .length,
          avgScore: averageByMember.get(key) || 0,
        };
      })
      .filter((row) => row.objectives > 0 || row.reports > 0)
      .sort((a, b) => b.progress - a.progress);
    const topObjectives = objectives.filter((row) => row.parentId === 0);
    const completion = this.completionOf(
      topObjectives.length ? topObjectives : objectives,
    );
    const krTrend = await this.buildKrTrend(ctx.ownerUserId, cycle);
    const scoreDistribution = [...averageByMember.entries()]
      .map(([memberUserId, avg]) => ({
        memberUserId,
        memberName:
          members.find((row) => row.memberUserId === memberUserId)?.name ||
          names.get(memberUserId) ||
          memberUserId,
        avg,
      }))
      .sort((a, b) => b.avg - a.avg);
    const overdue = await this.prisma.okrPlan.count({
      where: {
        ownerUserId: ctx.ownerUserId,
        status: { in: ['TODO', 'DOING'] },
        dueDate: { lt: dateAt(localToday()) },
      },
    });
    const summary: string[] = [
      `本周期共 ${objectives.length} 个目标、${allKrs.length} 条 KR，整体完成度 ${completion}%。`,
    ];
    if (memberRanking.length) {
      summary.push(
        `完成度最高：${memberRanking[0].memberName}（${memberRanking[0].progress}%）。`,
      );
    }
    if (overdue > 0)
      summary.push(`还有 ${overdue} 条计划逾期，建议在「我的计划」里处理。`);
    if (scores.length) {
      summary.push(`已收到 ${scores.length} 条周期评分。`);
    } else if (cycle.status === 'REVIEW') {
      summary.push('周期已进入复盘，可以开始打分。');
    }
    return {
      cycle: this.cycleView(cycle),
      completion,
      objectiveCount: objectives.length,
      krCount: allKrs.length,
      memberRanking,
      krTrend,
      scoreDistribution,
      scoreDimensions: dimensions,
      summary,
    };
  }

  async export(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const requested = int(query['cycleId']);
    const cycle =
      requested > 0
        ? await this.cycleOf(ctx.ownerUserId, requested)
        : await this.currentCycle(ctx.ownerUserId);
    const stat = await this.stats(user, query);
    const lines = [
      csvLine(['成员', '部门', '目标数', '完成度(%)', '汇报数', '平均评分']),
    ];
    for (const row of stat.memberRanking) {
      lines.push(
        csvLine([
          row.memberName,
          row.department,
          row.objectives,
          row.progress,
          row.reports,
          row.avgScore,
        ]),
      );
    }
    const title = cycle ? this.cycleView(cycle).title : '全部周期';
    const filename = `OKR-${title}-${localToday()}.csv`.replace(
      /[\\/:*?"<>|]/g,
      '-',
    );
    return {
      filename,
      content: `\uFEFF${lines.join('\r\n')}`,
      rows: stat.memberRanking.length,
    };
  }

  // =================== 评分 ===================

  async scoreList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const cycleId = int(query['cycleId']);
    const cycle =
      cycleId > 0
        ? await this.cycleOf(ctx.ownerUserId, cycleId)
        : (await this.prisma.okrCycle.findFirst({
            where: {
              ownerUserId: ctx.ownerUserId,
              status: { in: ['REVIEW', 'CLOSED'] },
            },
            orderBy: [{ year: 'desc' }, { period: 'desc' }, { id: 'desc' }],
          })) || (await this.currentCycle(ctx.ownerUserId));
    const dimensions = ctx.settings.scoreDimensions;
    const members = await this.scope.members(ctx.ownerUserId);
    if (!cycle) {
      return {
        cycleId: 0,
        dimensions,
        candidates: [],
        items: [],
        averages: [],
      };
    }
    const candidates = await this.scoreCandidates(ctx, cycle.id, members);
    const scopeRaw = text(query['scope']).toUpperCase();
    const where: Prisma.OkrScoreWhereInput = {
      ownerUserId: ctx.ownerUserId,
      cycleId: cycle.id,
    };
    const manage = ctx.isOwner || ctx.isManager;
    if (!manage) where.memberUserId = ctx.actorId;
    else if (scopeRaw === 'GIVEN') where.reviewerUserId = ctx.actorId;
    else if (scopeRaw === 'RECEIVED') where.memberUserId = ctx.actorId;
    const rows = await this.prisma.okrScore.findMany({
      where,
      orderBy: { id: 'asc' },
    });
    const names = await this.scope.names([
      ctx.ownerUserId,
      ...members.map((row) => row.memberUserId),
    ]);
    const averages = [...new Set(rows.map((row) => row.memberUserId))]
      .map((memberUserId) => {
        const submitted = rows.filter(
          (row) =>
            row.memberUserId === memberUserId && row.status === 'SUBMITTED',
        );
        return {
          memberUserId,
          memberName:
            members.find((row) => row.memberUserId === memberUserId)?.name ||
            names.get(memberUserId) ||
            memberUserId,
          average: submitted.length
            ? round(
                submitted.reduce((sum, row) => sum + num(row.total), 0) /
                  submitted.length,
                1,
              )
            : 0,
          reviewers: submitted.length,
        };
      })
      .sort((a, b) => b.average - a.average);
    return {
      cycleId: cycle.id,
      dimensions,
      candidates: manage ? candidates.map((row) => this.memberView(row)) : [],
      items: rows.map((row) => this.scoreView(row, names)),
      averages,
    };
  }

  async scoreSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const cycleId = int(body['cycleId']);
    const cycle = await this.cycleOf(ctx.ownerUserId, cycleId);
    if (cycle.status !== 'REVIEW' && cycle.status !== 'CLOSED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '周期进入复盘或关闭后才能打分',
      );
    }
    const memberUserId = text(body['memberUserId']).trim();
    if (!memberUserId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择被评人');
    }
    if (memberUserId === ctx.actorId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能给自己打分');
    }
    const members = await this.scope.members(ctx.ownerUserId);
    const candidates = await this.scoreCandidates(ctx, cycle.id, members);
    if (!candidates.some((row) => row.memberUserId === memberUserId)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该成员在本周期没有目标或汇报，不能评分',
      );
    }
    const dimensions = ctx.settings.scoreDimensions;
    const rawScores = Array.isArray(body['scores']) ? body['scores'] : [];
    const items = rawScores.map((item) => {
      const row = jsonObject(item);
      const key = text(row['key']).trim();
      const dimension = dimensions.find((dim) => dim.key === key);
      if (!dimension) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '评分维度与设置不一致，请刷新后重试',
        );
      }
      const score = num(row['score']);
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '每项评分需为 1~5 的整数',
        );
      }
      return {
        key: dimension.key,
        label: dimension.label,
        score,
        weight: dimension.weight,
      };
    });
    if (!items.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少填写一项评分');
    }
    const total = scoreTotal(items, dimensions);
    const submit = Boolean(body['submit']);
    const existing = await this.prisma.okrScore.findUnique({
      where: {
        ownerUserId_cycleId_memberUserId_reviewerUserId: {
          ownerUserId: ctx.ownerUserId,
          cycleId,
          memberUserId,
          reviewerUserId: ctx.actorId,
        },
      },
    });
    if (existing?.status === 'SUBMITTED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '已提交的评分不能修改，需所有者撤回后才能重打',
      );
    }
    const data = {
      scores: items as unknown as Prisma.InputJsonValue,
      total,
      comment: text(body['comment']).trim().slice(0, 500),
      status: submit ? 'SUBMITTED' : 'DRAFT',
      submittedAt: submit ? new Date() : null,
    };
    const saved = existing
      ? await this.prisma.okrScore.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.okrScore.create({
          data: {
            ...data,
            ownerUserId: ctx.ownerUserId,
            cycleId,
            memberUserId,
            reviewerUserId: ctx.actorId,
          },
        });
    if (submit) {
      await this.notifications.notify(memberUserId, {
        category: 'okr',
        title: '你有一条新的周期评分',
        body: '打开「统计复盘」页签查看评分明细与平均分。',
        link: '/okr?tab=stats',
        entityType: 'okr_score_submitted',
        entityId: String(saved.id),
      });
    }
    const names = await this.scope.names([
      ctx.ownerUserId,
      memberUserId,
      ctx.actorId,
    ]);
    return this.scoreView(saved, names);
  }

  async scoreWithdraw(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertOwner(ctx);
    const row = await this.prisma.okrScore.findFirst({
      where: { id: this.idOf(id), ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '评分记录不存在');
    }
    const saved = await this.prisma.okrScore.update({
      where: { id: row.id },
      data: { status: 'DRAFT', submittedAt: null },
    });
    const names = await this.scope.names([
      ctx.ownerUserId,
      saved.memberUserId,
      saved.reviewerUserId,
    ]);
    return this.scoreView(saved, names);
  }

  // =================== 设置 ===================

  async settingsGet(user: CurrentUser) {
    const ctx = await this.scope.context(user);
    const members = await this.scope.members(ctx.ownerUserId);
    return {
      ...ctx.settings,
      members: members.map((row) => this.memberView(row)),
      isOwner: ctx.isOwner,
    };
  }

  async settingsSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertOwner(ctx);
    const current = ctx.settings;
    const data: Prisma.OkrSettingsUncheckedUpdateInput = {};
    if (Array.isArray(body['managers'])) {
      const members = await this.scope.members(ctx.ownerUserId);
      const ids = [
        ...new Set(
          body['managers'].map((item) => text(item).trim()).filter(Boolean),
        ),
      ];
      if (ids.some((id) => !members.some((row) => row.memberUserId === id))) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '管理者必须是本账号的成员',
        );
      }
      data.managers = ids;
    }
    const visibilityRaw = text(body['defaultVisibility']).toUpperCase();
    if (VISIBILITIES.has(visibilityRaw)) data.defaultVisibility = visibilityRaw;
    if (body['weekStart'] !== undefined) {
      data.weekStart = clamp(int(body['weekStart'], 1), 0, 6);
    }
    if (body['autoDraftEnabled'] !== undefined) {
      data.autoDraftEnabled = Boolean(body['autoDraftEnabled']);
    }
    if (body['reportTemplates'] !== undefined) {
      data.reportTemplates = jsonObject(
        body['reportTemplates'],
      ) as Prisma.InputJsonValue;
    }
    if (body['reportSchedules'] !== undefined) {
      data.reportSchedules = jsonObject(
        body['reportSchedules'],
      ) as Prisma.InputJsonValue;
    }
    if (body['metricRefreshHour'] !== undefined) {
      data.metricRefreshHour = clamp(int(body['metricRefreshHour'], 5), 0, 23);
    }
    if (Array.isArray(body['scoreDimensions'])) {
      const dims = body['scoreDimensions'].map((item) => {
        const row = jsonObject(item);
        return {
          key: text(row['key']).trim().slice(0, 32),
          label: text(row['label']).trim().slice(0, 32),
          weight: round(clamp(num(row['weight']), 0, 100), 2),
        };
      });
      if (!dims.length || dims.some((row) => !row.key || !row.label)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '评分维度需要名称与标识',
        );
      }
      const total = round(
        dims.reduce((sum, row) => sum + row.weight, 0),
        2,
      );
      if (Math.abs(total - 100) > 0.01) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `评分维度权重合计需为 100%（当前 ${total}%）`,
        );
      }
      data.scoreDimensions = dims;
    }
    await this.prisma.okrSettings.upsert({
      where: { ownerUserId: ctx.ownerUserId },
      create: {
        ownerUserId: ctx.ownerUserId,
        managers: (data.managers ?? current.managers) as Prisma.InputJsonValue,
        defaultVisibility: text(
          data.defaultVisibility ?? current.defaultVisibility,
        ),
        weekStart: int(data.weekStart ?? current.weekStart, 1),
        autoDraftEnabled: Boolean(
          data.autoDraftEnabled ?? current.autoDraftEnabled,
        ),
        reportTemplates: (data.reportTemplates ??
          current.reportTemplates) as Prisma.InputJsonValue,
        reportSchedules: (data.reportSchedules ??
          current.reportSchedules) as Prisma.InputJsonValue,
        scoreDimensions: (data.scoreDimensions ??
          current.scoreDimensions) as Prisma.InputJsonValue,
        metricRefreshHour: int(
          data.metricRefreshHour ?? current.metricRefreshHour,
          5,
        ),
      },
      update: data,
    });
    const saved = await this.scope.settings(ctx.ownerUserId);
    return { ...saved };
  }

  // =================== 内部工具 ===================

  private idOf(raw: unknown) {
    const id = int(raw);
    if (id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '参数不合法');
    }
    return id;
  }

  private selfKey(ctx: OkrContext) {
    return ctx.actorId === ctx.ownerUserId ? '' : ctx.actorId;
  }

  private assertCycleOpen(cycle: CycleRow) {
    if (cycle.status === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '周期已关闭，目标与 KR 只读',
      );
    }
  }

  private cycleRangeOf(cycle: CycleRow | null) {
    return cycle
      ? { startDate: dateStr(cycle.startDate), endDate: dateStr(cycle.endDate) }
      : null;
  }

  private async cycleOf(ownerUserId: string, id: number) {
    const row = await this.prisma.okrCycle.findFirst({
      where: { id, ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '周期不存在');
    }
    return row as CycleRow;
  }

  private async currentCycle(ownerUserId: string) {
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

  private async cycleViews(ownerUserId: string) {
    const rows = await this.prisma.okrCycle.findMany({
      where: { ownerUserId },
      orderBy: [{ year: 'desc' }, { period: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.cycleView(row as CycleRow));
  }

  private async objectiveOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrObjective.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标不存在');
    }
    return row as ObjectiveRow;
  }

  private async krOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrKeyResult.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '关键结果不存在');
    }
    return row as KrRow;
  }

  private async planOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrPlan.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '计划不存在');
    }
    return row as PlanRow;
  }

  private async reportOf(ctx: OkrContext, id: number) {
    const row = await this.prisma.okrReport.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '汇报不存在');
    }
    return row as ReportRow;
  }

  /** 成员可见的目标：自己 / 被指派 / ORG / 本部门 DEPT。 */
  private async visibleObjectives(ctx: OkrContext, rows: ObjectiveRow[]) {
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

  /** 成员可见目标 id 集合；所有者/管理者返回 null（不限）。 */
  private async visibleObjectiveIds(ctx: OkrContext) {
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
      (
        await this.visibleObjectives(ctx, rows as unknown as ObjectiveRow[])
      ).map((row) => row.id),
    );
  }

  private canEditObjective(ctx: OkrContext, row: ObjectiveRow) {
    return (
      ctx.isOwner ||
      ctx.isManager ||
      row.ownerMemberUserId === ctx.actorId ||
      row.assignerUserId === ctx.actorId
    );
  }

  private assertPlanWritable(ctx: OkrContext, row: PlanRow) {
    if (ctx.isOwner || ctx.isManager) return;
    const self = this.selfKey(ctx);
    if (row.memberUserId !== self && row.memberUserId !== ctx.actorId) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能维护自己的计划');
    }
  }

  private assertReportVisible(ctx: OkrContext, row: ReportRow) {
    if (ctx.isOwner || ctx.isManager) return;
    const self = this.selfKey(ctx);
    if (row.memberUserId !== self && row.memberUserId !== ctx.actorId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '汇报不存在');
    }
  }

  private async collectObjectives(
    ctx: OkrContext,
    where: Prisma.OkrObjectiveWhereInput,
  ) {
    const rows = await this.prisma.okrObjective.findMany({
      where: { ...where, ownerUserId: ctx.ownerUserId },
      orderBy: [{ parentId: 'asc' }, { id: 'asc' }],
    });
    return this.visibleObjectives(ctx, rows);
  }

  private async objectiveViews(
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

  private async planNames(rows: PlanRow[]) {
    const ids = rows.map((row) => row.memberUserId).filter(Boolean);
    return this.scope.names([...ids, ...rows.map(() => '')].filter(Boolean));
  }

  private async planViewSaved(ctx: OkrContext, row: PlanRow) {
    const names = await this.planNames([row]);
    const ownerName =
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) || '';
    return this.planView(row, names, ownerName);
  }

  private async reportViews(ctx: OkrContext, rows: ReportRow[]) {
    const names = await this.scope.names([
      ctx.ownerUserId,
      ...rows.map((row) => row.memberUserId).filter(Boolean),
    ]);
    const ownerName = names.get(ctx.ownerUserId) || '';
    return rows.map((row) => this.reportView(row, names, ownerName));
  }

  private async createKrs(
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

  private metricSourceValue(raw: unknown) {
    const value = readMetricSource(raw);
    if (!value.source) return {} as Prisma.InputJsonValue;
    return value as unknown as Prisma.InputJsonValue;
  }

  private periodOf(kind: 'WEEK' | 'DAY', weekStart: number) {
    if (kind === 'DAY') {
      const today = localToday();
      return { key: today, start: today, end: today };
    }
    const key = weekKeyOf(new Date(), weekStart);
    const range = weekRange(key, weekStart);
    return { key, start: range.start, end: range.end };
  }

  private previousPeriod(kind: 'WEEK' | 'DAY', weekStart: number) {
    const now = new Date();
    if (kind === 'DAY') {
      return localToday(new Date(now.getTime() - 86_400_000));
    }
    return weekKeyOf(new Date(now.getTime() - 7 * 86_400_000), weekStart);
  }

  private reportPeriod(kind: string, rawKey: string, weekStart: number) {
    const key =
      rawKey ||
      (kind === 'WEEKLY' ? weekKeyOf(new Date(), weekStart) : localToday());
    const range =
      kind === 'WEEKLY' ? weekRange(key, weekStart) : { start: key, end: key };
    return { key, start: range.start, end: range.end };
  }

  private periodInRange(
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

  private completionOf(rows: ObjectiveRow[]) {
    const active = rows.filter((row) => row.status !== 'CANCELLED');
    return weighted(
      active.map((row) => ({
        weight: num(row.weight, 1),
        progress: num(row.progress),
      })),
    );
  }

  private async buildKrTrend(ownerUserId: string, cycle: CycleRow) {
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

  private async scoreCandidates(
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

  private metricSourceCatalog() {
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

  /** 汇报草稿素材：操作流水 + CRM 变更 + KR 进度 + 计划完成情况。 */
  private async buildReportContent(
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

  private async notifyMembers(
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

  private async notifyManagersOnce(
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

  private cycleView(row: CycleRow) {
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

  private memberView(row: OkrMemberRow) {
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

  private krView(row: KrRow, names: Map<string, string>, accountName: string) {
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

  private objectiveView(
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

  private planView(
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

  private reportView(
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

  private scoreView(row: ScoreRow, names: Map<string, string>) {
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

  private progressView(row: ProgressRow) {
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
