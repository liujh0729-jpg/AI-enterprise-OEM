import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { CrmScopeService } from '../crm/crm.scope';
import { DataTableService } from '../data-table/data-table.service';
import { LowCodeAccessService } from '../lowcode/lowcode.access.service';
import { rowAllowed } from '../lowcode/lowcode.shared';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  dateOrNull,
  dateStr,
  jsonArray,
  jsonObject,
  localDate,
  localToday,
  num,
  progressOf,
  round,
} from './okr.helpers';
import { recalcObjective } from './okr.progress';

export type OkrMetricFilter = {
  field: string;
  op: string;
  value: unknown;
};

export type OkrMetricSourceValue = {
  source: string;
  agg: string;
  field: string;
  filters: OkrMetricFilter[];
  dateField: string;
  dateRange: string;
  scope: string;
  tableId: number;
  projectId: string;
  entityId: number;
  groupBy: string;
};

export type OkrMetricResult = {
  value: number;
  ok: boolean;
  message: string;
  rangeStart: string;
  rangeEnd: string;
};

export type OkrRefreshItem = {
  krId: number;
  value: number;
  ok: boolean;
  message: string;
};

type CycleRange = { startDate: string; endDate: string } | null;
type Scalar = 'number' | 'string' | 'date';

const METRIC_SOURCES = new Set([
  'CRM_OPPORTUNITY',
  'CRM_CONTRACT',
  'CRM_PAYMENT',
  'CRM_ORDER',
  'SIGN_CONTRACT',
  'DATA_TABLE',
  'LOWCODE_ENTITY',
]);

/** 每个数据源允许的字段与类型：闭集，不接受自由 SQL。 */
const FIELD_TYPES: Record<string, Record<string, Scalar>> = {
  CRM_OPPORTUNITY: {
    amount: 'number',
    possible: 'number',
    stageId: 'number',
    ownerId: 'string',
    customerId: 'number',
    approvalStatus: 'string',
    expectedEndAt: 'date',
    actualEndAt: 'date',
    lastFollowAt: 'date',
    createdAt: 'date',
  },
  CRM_CONTRACT: {
    amount: 'number',
    stageId: 'number',
    ownerId: 'string',
    customerId: 'number',
    approvalStatus: 'string',
    startAt: 'date',
    endAt: 'date',
    createdAt: 'date',
  },
  CRM_PAYMENT: {
    planAmount: 'number',
    status: 'string',
    planEndAt: 'date',
    createdAt: 'date',
  },
  CRM_ORDER: {
    amount: 'number',
    stageId: 'number',
    ownerId: 'string',
    customerId: 'number',
    approvalStatus: 'string',
    createdAt: 'date',
  },
  SIGN_CONTRACT: {
    serviceType: 'string',
    status: 'string',
    providerUserId: 'string',
    enterpriseId: 'number',
    createdAt: 'date',
  },
};

/** 未填 dateField 时的默认统计区间字段。 */
const DEFAULT_DATE_FIELD: Record<string, string> = {
  CRM_OPPORTUNITY: 'createdAt',
  CRM_CONTRACT: 'createdAt',
  CRM_PAYMENT: 'planEndAt',
  CRM_ORDER: 'createdAt',
  SIGN_CONTRACT: 'createdAt',
};

const NUMERIC_FIELDS: Record<string, string[]> = {
  CRM_OPPORTUNITY: ['amount', 'possible'],
  CRM_CONTRACT: ['amount'],
  CRM_PAYMENT: ['planAmount'],
  CRM_ORDER: ['amount'],
  SIGN_CONTRACT: [],
};

export const readMetricSource = (raw: unknown): OkrMetricSourceValue => {
  const row = jsonObject(raw);
  return {
    source: text(row.source).trim(),
    agg: text(row.agg || 'COUNT')
      .trim()
      .toUpperCase(),
    field: text(row.field).trim(),
    filters: jsonArray(row.filters).map((item) => {
      const filter = jsonObject(item);
      return {
        field: text(filter.field).trim(),
        op: text(filter.op || 'eq').trim(),
        value: filter.value,
      };
    }),
    dateField: text(row.dateField).trim(),
    dateRange: text(row.dateRange || 'CYCLE').trim(),
    scope: text(row.scope || 'ACCOUNT').trim(),
    tableId: Number(row.tableId) || 0,
    projectId: text(row.projectId).trim(),
    entityId: Number(row.entityId) || 0,
    groupBy: text(row.groupBy).trim(),
  };
};

export const metricSourceFields = (source: string) =>
  Object.keys(FIELD_TYPES[source] || {});

/**
 * 自动指标引擎：闭集数据源 + 白名单字段，取数一律叠加源系统的数据权限。
 * 取数失败不抛错、不清零：保留上次值并返回中文原因，页面照常可用。
 */
export class OkrMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crmScope: CrmScopeService,
    private readonly dataTable: DataTableService,
    private readonly lowcodeAccess: LowCodeAccessService,
    private readonly notifications: NotificationService,
  ) {}

  /** 每日批处理已完成的账号 × 日期，进程内去重，避免同一小时内重复刷新。 */
  private readonly batchDone = new Map<string, string>();

  async evaluate(
    user: CurrentUser,
    raw: unknown,
    cycle: CycleRange,
  ): Promise<OkrMetricResult> {
    const source = readMetricSource(raw);
    const empty = { value: 0, rangeStart: '', rangeEnd: '' };
    if (!METRIC_SOURCES.has(source.source)) {
      return {
        ...empty,
        ok: false,
        message: '暂不支持该数据源，请重新选择',
      };
    }
    const agg = ['COUNT', 'SUM', 'AVG'].includes(source.agg)
      ? source.agg
      : 'COUNT';
    if (agg !== 'COUNT' && !source.field) {
      return { ...empty, ok: false, message: '请选择要汇总的数值字段' };
    }
    if (
      agg !== 'COUNT' &&
      !(NUMERIC_FIELDS[source.source] || []).includes(source.field)
    ) {
      return {
        ...empty,
        ok: false,
        message: '该字段不支持求和/平均，只能按数量统计',
      };
    }
    let from: Date | null = null;
    let to: Date | null = null;
    if (cycle && source.dateRange === 'CYCLE') {
      const range = dateRangeOf(cycle.startDate, cycle.endDate);
      from = range.from;
      to = range.to;
    }
    try {
      if (source.source === 'DATA_TABLE') {
        return await this.fromDataTable(user, source, agg, from, to, cycle);
      }
      if (source.source === 'LOWCODE_ENTITY') {
        return await this.fromLowCode(user, source, agg, from, to, cycle);
      }
      if (source.source === 'SIGN_CONTRACT') {
        return await this.fromContracts(source, agg, from, to, cycle);
      }
      return await this.fromCrm(user, source, agg, from, to, cycle);
    } catch (error) {
      return {
        ...empty,
        ok: false,
        message: describeError(error),
      };
    }
  }

  private async fromCrm(
    user: CurrentUser,
    source: OkrMetricSourceValue,
    agg: string,
    from: Date | null,
    to: Date | null,
    cycle: CycleRange,
  ): Promise<OkrMetricResult> {
    const crmContext = await this.crmScope.context(user);
    if (!crmContext.isMember) {
      return {
        value: 0,
        ok: false,
        message: '你还没有被加入本账号的 CRM，无法取数',
        rangeStart: cycle?.startDate || '',
        rangeEnd: cycle?.endDate || '',
      };
    }
    const scoped = await this.crmScope.scopeWhereAsync(crmContext);
    const where: Record<string, unknown> = { ...scoped };
    if (source.source !== 'CRM_PAYMENT') where.deletedAt = null;
    applyFilters(where, source.filters, FIELD_TYPES[source.source] || {});
    const dateField =
      source.dateField || DEFAULT_DATE_FIELD[source.source] || '';
    if (from && to && dateField) {
      if (FIELD_TYPES[source.source]?.[dateField] === 'date') {
        where[dateField] = { gte: from, lte: to };
      }
    }
    const cycleRange = {
      rangeStart: cycle?.startDate || '',
      rangeEnd: cycle?.endDate || '',
    };
    if (source.source === 'CRM_PAYMENT') {
      const contractWhere = { ...scoped, deletedAt: null } as Record<
        string,
        unknown
      >;
      const contracts = await this.prisma.crmContract.findMany({
        where: contractWhere,
        select: { id: true },
      });
      where.contractId = { in: contracts.map((row) => row.id) };
      if (from && to && dateField) {
        where.createdAt = { gte: from, lte: to };
        if (dateField === 'planEndAt' || dateField === 'createdAt') {
          where[dateField] = { gte: from, lte: to };
        }
      }
      if (agg === 'COUNT') {
        const value = await this.prisma.crmPaymentPlan.count({
          where: where,
        });
        return { value, ok: true, message: '', ...cycleRange };
      }
      const result = await this.prisma.crmPaymentPlan.aggregate({
        where: where,
        _sum: { planAmount: true },
        _avg: { planAmount: true },
      });
      const rawValue =
        agg === 'SUM' ? result._sum.planAmount : result._avg.planAmount;
      return {
        value: round(num(rawValue)),
        ok: true,
        message: '',
        ...cycleRange,
      };
    }
    if (source.source === 'CRM_OPPORTUNITY') {
      if (agg === 'COUNT') {
        return {
          value: await this.prisma.crmOpportunity.count({
            where: where,
          }),
          ok: true,
          message: '',
          ...cycleRange,
        };
      }
      const key = source.field as 'amount' | 'possible';
      const result = await this.prisma.crmOpportunity.aggregate({
        where: where,
        _sum: { amount: true, possible: true },
        _avg: { amount: true, possible: true },
      });
      const rawValue = agg === 'SUM' ? result._sum[key] : result._avg[key];
      return {
        value: round(num(rawValue)),
        ok: true,
        message: '',
        ...cycleRange,
      };
    }
    if (source.source === 'CRM_CONTRACT') {
      if (agg === 'COUNT') {
        return {
          value: await this.prisma.crmContract.count({
            where: where,
          }),
          ok: true,
          message: '',
          ...cycleRange,
        };
      }
      const result = await this.prisma.crmContract.aggregate({
        where: where,
        _sum: { amount: true },
        _avg: { amount: true },
      });
      const rawValue = agg === 'SUM' ? result._sum.amount : result._avg.amount;
      return {
        value: round(num(rawValue)),
        ok: true,
        message: '',
        ...cycleRange,
      };
    }
    if (agg === 'COUNT') {
      return {
        value: await this.prisma.crmOrder.count({
          where: where,
        }),
        ok: true,
        message: '',
        ...cycleRange,
      };
    }
    const result = await this.prisma.crmOrder.aggregate({
      where: where,
      _sum: { amount: true },
      _avg: { amount: true },
    });
    const rawValue = agg === 'SUM' ? result._sum.amount : result._avg.amount;
    return {
      value: round(num(rawValue)),
      ok: true,
      message: '',
      ...cycleRange,
    };
  }

  private async fromContracts(
    source: OkrMetricSourceValue,
    agg: string,
    from: Date | null,
    to: Date | null,
    cycle: CycleRange,
  ): Promise<OkrMetricResult> {
    if (agg !== 'COUNT') {
      return {
        value: 0,
        ok: false,
        message: '签约管理没有金额字段，只能按签约数量统计',
        rangeStart: cycle?.startDate || '',
        rangeEnd: cycle?.endDate || '',
      };
    }
    const where: Record<string, unknown> = {};
    applyFilters(where, source.filters, FIELD_TYPES.SIGN_CONTRACT);
    const dateField = source.dateField || 'createdAt';
    if (from && to && dateField === 'createdAt') {
      where.createdAt = { gte: from, lte: to };
    }
    const value = await this.prisma.contract.count({
      where: where,
    });
    return {
      value,
      ok: true,
      message: '',
      rangeStart: cycle?.startDate || '',
      rangeEnd: cycle?.endDate || '',
    };
  }

  private async fromDataTable(
    user: CurrentUser,
    source: OkrMetricSourceValue,
    agg: string,
    from: Date | null,
    to: Date | null,
    cycle: CycleRange,
  ): Promise<OkrMetricResult> {
    if (!source.tableId) {
      return {
        value: 0,
        ok: false,
        message: '请选择多维表格',
        rangeStart: '',
        rangeEnd: '',
      };
    }
    const table = await this.dataTable.get(user, source.tableId);
    const fields = (table.fields || []) as {
      fieldKey: string;
      fieldType: string;
    }[];
    const rows: { data: Record<string, unknown>; createdBy: string }[] = [];
    const cap = 5000;
    for (let offset = 0; offset < cap; offset += 500) {
      const page = (await this.dataTable.listRowsByOffset(
        user,
        source.tableId,
        500,
        offset,
      )) as { data: unknown; createdBy: string }[];
      for (const row of page) {
        rows.push({
          data: jsonObject(row.data),
          createdBy: text(row.createdBy),
        });
      }
      if (page.length < 500) break;
    }
    const matched = rows.filter((row) =>
      rowMatches(row.data, source, from, to, fields),
    );
    return {
      value: aggregate(
        matched.map((row) => row.data),
        source,
        agg,
        fields,
      ),
      ok: true,
      message: '',
      rangeStart: cycle?.startDate || '',
      rangeEnd: cycle?.endDate || '',
    };
  }

  private async fromLowCode(
    user: CurrentUser,
    source: OkrMetricSourceValue,
    agg: string,
    from: Date | null,
    to: Date | null,
    cycle: CycleRange,
  ): Promise<OkrMetricResult> {
    if (!source.projectId || !source.entityId) {
      return {
        value: 0,
        ok: false,
        message: '请选择内建应用与实体',
        rangeStart: '',
        rangeEnd: '',
      };
    }
    const access = await this.lowcodeAccess.resolve(user, source.projectId);
    const entity = await this.prisma.lowCodeEntity.findFirst({
      where: { id: source.entityId, projectId: access.project.id },
    });
    if (!entity) {
      return {
        value: 0,
        ok: false,
        message: '实体不存在',
        rangeStart: '',
        rangeEnd: '',
      };
    }
    const fields = await this.prisma.dataTableField.findMany({
      where: { tableId: entity.dataTableId },
      select: { fieldKey: true, fieldType: true },
    });
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId: entity.dataTableId },
      take: 5000,
    });
    const visible = rows.filter((row) => rowAllowed(access, entity.id, row));
    const matched = visible
      .map((row) => ({
        data: jsonObject(row.data),
        createdBy: row.createdBy,
      }))
      .filter((row) => rowMatches(row.data, source, from, to, fields));
    return {
      value: aggregate(
        matched.map((row) => row.data),
        source,
        agg,
        fields,
      ),
      ok: true,
      message: '',
      rangeStart: cycle?.startDate || '',
      rangeEnd: cycle?.endDate || '',
    };
  }

  /** 单条 KR 刷新；失败保留上次值，不写 0。 */
  async refreshKr(
    user: CurrentUser,
    ownerUserId: string,
    kr: {
      id: number;
      objectiveId: number;
      metricSource: unknown;
      direction: string;
      startValue: unknown;
      currentValue: unknown;
      targetValue: unknown;
    },
    cycle: CycleRange,
  ): Promise<OkrRefreshItem> {
    const result = await this.evaluate(user, kr.metricSource, cycle);
    if (!result.ok) {
      return {
        krId: kr.id,
        value: num(kr.currentValue),
        ok: false,
        message: result.message,
      };
    }
    const before = num(kr.currentValue);
    const after = result.value;
    await this.prisma.okrKeyResult.update({
      where: { id: kr.id },
      data: { currentValue: after, lastRefreshedAt: new Date() },
    });
    await this.prisma.okrMetricSnapshot.create({
      data: { ownerUserId, krId: kr.id, value: after },
    });
    if (after !== before) {
      const progress = progressOf(
        kr.direction,
        num(kr.startValue),
        after,
        num(kr.targetValue),
      );
      await this.prisma.okrProgressLog.create({
        data: {
          ownerUserId,
          krId: kr.id,
          objectiveId: kr.objectiveId,
          before,
          after,
          progress,
          note: '自动指标刷新',
          source: 'AUTO',
          refType: 'METRIC',
          refId: String(kr.id),
        },
      });
      await recalcObjective(this.prisma, ownerUserId, kr.objectiveId);
    }
    return { krId: kr.id, value: after, ok: true, message: '' };
  }

  /** 批量刷新指定 KR（只认 AUTO 类型）。 */
  async refresh(
    user: CurrentUser,
    ownerUserId: string,
    krIds: number[],
  ): Promise<OkrRefreshItem[]> {
    const ids = [...new Set(krIds.filter((id) => id > 0))];
    if (!ids.length) return [];
    const krs = await this.prisma.okrKeyResult.findMany({
      where: {
        ownerUserId,
        id: { in: ids },
        metricType: 'AUTO',
      },
    });
    if (!krs.length) return [];
    const objectives = await this.prisma.okrObjective.findMany({
      where: {
        ownerUserId,
        id: { in: [...new Set(krs.map((kr) => kr.objectiveId))] },
      },
      select: { id: true, cycleId: true },
    });
    const cycles = await this.prisma.okrCycle.findMany({
      where: {
        ownerUserId,
        id: { in: [...new Set(objectives.map((row) => row.cycleId))] },
      },
      select: { id: true, startDate: true, endDate: true },
    });
    const cycleByObjective = new Map(
      objectives.map((row) => [row.id, row.cycleId]),
    );
    const cycleById = new Map(
      cycles.map((row) => [
        row.id,
        { startDate: dateStr(row.startDate), endDate: dateStr(row.endDate) },
      ]),
    );
    const items: OkrRefreshItem[] = [];
    for (const kr of krs) {
      const cycleId = cycleByObjective.get(kr.objectiveId) || 0;
      const cycle = cycleById.get(cycleId) || null;
      items.push(await this.refreshKr(user, ownerUserId, kr, cycle));
    }
    return items;
  }

  /** 取某周期下所有 AUTO KR 的 id。 */
  async autoKrIds(ownerUserId: string, cycleId: number) {
    const objectives = await this.prisma.okrObjective.findMany({
      where: { ownerUserId, cycleId },
      select: { id: true },
    });
    if (!objectives.length) return [];
    const krs = await this.prisma.okrKeyResult.findMany({
      where: {
        ownerUserId,
        objectiveId: { in: objectives.map((row) => row.id) },
        metricType: 'AUTO',
      },
      select: { id: true },
    });
    return krs.map((row) => row.id);
  }

  /**
   * 每日批处理：按账号刷新自动指标 + 催逾期计划 + 提醒待填日报。
   * 所有通知按 (类型, 对象, 当天) 去重，不会重复轰炸。
   */
  async runDailyBatch(hour = this.currentHour()) {
    const settings = await this.prisma.okrSettings.findMany({
      select: { ownerUserId: true, metricRefreshHour: true },
    });
    const today = localToday();
    // @db.Date 列按 UTC 零点存，比较也必须用 UTC 零点。
    const dayStart = new Date(`${today}T00:00:00.000Z`);
    for (const setting of settings) {
      const ownerUserId = setting.ownerUserId;
      if (Number(setting.metricRefreshHour ?? 5) !== hour) continue;
      if (this.batchDone.get(ownerUserId) === today) continue;
      try {
        const cycles = await this.prisma.okrCycle.findMany({
          where: {
            ownerUserId,
            status: { in: ['ACTIVE', 'REVIEW'] },
            startDate: { lte: dayStart },
            endDate: { gte: dayStart },
          },
          select: { id: true },
        });
        for (const cycle of cycles) {
          const krIds = await this.autoKrIds(ownerUserId, cycle.id);
          if (krIds.length) {
            await this.refresh(
              new CurrentUser(ownerUserId, '', ''),
              ownerUserId,
              krIds,
            );
          }
        }
        await this.remindOverduePlans(ownerUserId, today, dayStart);
        await this.remindMissingDaily(ownerUserId, today);
        this.batchDone.set(ownerUserId, today);
      } catch {
        // 单个账号失败不影响其他账号；本轮不记完成，下次 tick 会再试。
      }
    }
  }

  private async remindOverduePlans(
    ownerUserId: string,
    today: string,
    dayStart: Date,
  ) {
    const plans = await this.prisma.okrPlan.findMany({
      where: {
        ownerUserId,
        status: { in: ['TODO', 'DOING'] },
        dueDate: { lt: dayStart },
      },
      orderBy: { id: 'asc' },
    });
    for (const plan of plans) {
      const marker = `${plan.id}:${today}`;
      const exists = await this.prisma.notification.findFirst({
        where: {
          userId: plan.memberUserId,
          entityType: 'okr_plan_overdue',
          entityId: marker,
        },
        select: { id: true },
      });
      if (exists) continue;
      await this.notifications.notify(plan.memberUserId, {
        category: 'okr',
        level: 'warning',
        title: `计划已逾期：${plan.title}`,
        body: `计划截止 ${dateStr(plan.dueDate)}，请尽快推进或调整时间。`,
        link: '/okr?tab=plans',
        entityType: 'okr_plan_overdue',
        entityId: marker,
      });
    }
  }

  private async remindMissingDaily(ownerUserId: string, today: string) {
    const members = await this.prisma.orgStaff.findMany({
      where: { orgUserId: ownerUserId, status: 'ACTIVE' },
      select: { memberUserId: true },
    });
    if (!members.length) return;
    const ids = members.map((row) => row.memberUserId);
    const reports = await this.prisma.okrReport.findMany({
      where: {
        ownerUserId,
        memberUserId: { in: ids },
        kind: 'DAILY',
        periodKey: today,
        status: 'SUBMITTED',
      },
      select: { memberUserId: true },
    });
    const done = new Set(reports.map((row) => row.memberUserId));
    for (const memberUserId of ids) {
      if (done.has(memberUserId)) continue;
      const marker = `${memberUserId}:${today}`;
      const exists = await this.prisma.notification.findFirst({
        where: {
          userId: memberUserId,
          entityType: 'okr_report_todo',
          entityId: marker,
        },
        select: { id: true },
      });
      if (exists) continue;
      await this.notifications.notify(memberUserId, {
        category: 'okr',
        title: '今天还没有提交日报',
        body: '打开 OKR → 汇报，可一键生成结构化草稿再提交。',
        link: '/okr?tab=reports',
        entityType: 'okr_report_todo',
        entityId: marker,
      });
    }
  }

  /** 当前本地小时，供调度器判断是否到达刷新时刻。 */
  currentHour() {
    return localDate().getUTCHours();
  }
}

const dateRangeOf = (start: string, end: string) => ({
  from: new Date(`${start}T00:00:00.000Z`),
  to: new Date(`${end}T23:59:59.999Z`),
});

const describeError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : text(error);
  if (/permission|权限|没有访问|不存在/i.test(raw)) {
    return '没有该数据的访问权限，已保留上次结果';
  }
  return '数据更新失败，展示上次结果';
};

function filterValue(value: unknown, type: Scalar | undefined) {
  if (type === 'number') return num(value);
  if (type === 'date') return dateOrNull(value);
  return text(value);
}

function inList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item));
  return text(value)
    .split(/[,，\s]+/)
    .filter(Boolean);
}

/** 把 KR 配置的过滤条件翻译成 Prisma where（字段必须命中白名单）。 */
function applyFilters(
  where: Record<string, unknown>,
  filters: OkrMetricFilter[],
  types: Record<string, Scalar>,
) {
  for (const filter of filters) {
    const type = types[filter.field];
    if (!type) continue;
    const value = filterValue(filter.value, type);
    if (value === null || value === '') continue;
    switch (filter.op) {
      case 'neq':
        where[filter.field] = { not: value };
        break;
      case 'gt':
        where[filter.field] = { gt: value };
        break;
      case 'gte':
        where[filter.field] = { gte: value };
        break;
      case 'lt':
        where[filter.field] = { lt: value };
        break;
      case 'lte':
        where[filter.field] = { lte: value };
        break;
      case 'contains':
        where[filter.field] = { contains: text(value) };
        break;
      case 'in':
        where[filter.field] = { in: inList(filter.value) };
        break;
      default:
        where[filter.field] = value;
    }
  }
}

function rowMatches(
  data: Record<string, unknown>,
  source: OkrMetricSourceValue,
  from: Date | null,
  to: Date | null,
  fields: { fieldKey: string; fieldType: string }[],
) {
  const fieldType = new Map(
    fields.map((field) => [field.fieldKey, field.fieldType]),
  );
  for (const filter of source.filters) {
    const actual = data[filter.field];
    const type = fieldType.get(filter.field);
    if (!type) continue;
    const expected = filterValue(
      filter.value,
      type === 'number' ? 'number' : type === 'date' ? 'date' : 'string',
    );
    if (expected === null || expected === '') continue;
    const ok = compareRow(actual, expected, filter.op);
    if (!ok) return false;
  }
  const dateField = source.dateField;
  if (from && to && dateField && fieldType.get(dateField) === 'date') {
    const when = dateOrNull(data[dateField]);
    if (!when) return false;
    if (when < from || when > to) return false;
  }
  return true;
}

function compareRow(actual: unknown, expected: unknown, op: string) {
  if (op === 'contains') {
    return text(actual).toLowerCase().includes(text(expected).toLowerCase());
  }
  if (op === 'in') {
    return inList(expected).some((item) => item === text(actual));
  }
  const left = typeof expected === 'number' ? num(actual) : text(actual);
  const right = typeof expected === 'number' ? expected : text(expected);
  switch (op) {
    case 'neq':
      return left !== right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    default:
      return left === right;
  }
}

function aggregate(
  rows: Record<string, unknown>[],
  source: OkrMetricSourceValue,
  agg: string,
  fields: { fieldKey: string; fieldType: string }[],
) {
  if (agg === 'COUNT' || !source.field) return rows.length;
  if (
    fields.find((field) => field.fieldKey === source.field)?.fieldType !==
    'number'
  ) {
    return 0;
  }
  const values = rows
    .map((row) => num(row[source.field]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return agg === 'AVG' ? round(total / values.length) : round(total);
}
