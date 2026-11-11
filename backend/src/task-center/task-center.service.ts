import {
  TASK_ASSIGN_STRATEGY_LABELS,
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  taskFormSchema,
  taskFormValuesSchema,
  type MyTaskRow,
  type TaskFormDefinition,
  type TaskGroupStat,
  type TaskSummary,
} from '@enterprise/contracts';
import type { MyTask, Prisma } from '../../generated/prisma';
import { pageParam, pageOf, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { fromJson, toJsonInput } from '../common/json-input';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationService } from '../notifications/notification.service';
import type { TaskSourceRegistry } from './task-source.registry';
import { dedupKeyOf, type TaskDraft } from './task-source';

/** 列表/摘要刷新节流：同账号 10 秒内只跑一次全源 collect，避免驾驶舱高频调用打满源模块。 */
const REFRESH_TTL_MS = 10_000;
const TERMINAL_STATUSES = new Set(['DONE', 'CANCELED', 'EXPIRED']);
const UNCLOSED: Prisma.MyTaskWhereInput['status'] = { in: ['OPEN', 'DOING'] };

/** 合法日期才落库，非法值一律当作「无截止」。 */
function toDate(value: TaskDraft['dueAt']): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 按表单定义收敛提交值：只留已定义字段，必填缺失直接拒绝。 */
function formValuesOf(
  form: TaskFormDefinition,
  input: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of form.fields) {
    const value = text(input?.[field.key]).trim();
    if (!value) {
      if (field.required) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `请填写「${field.label}」`,
        );
      }
      continue;
    }
    out[field.key] = value.slice(0, 2000);
  }
  return out;
}

/** 任务变化类型：与工作流 `trigger.task` 的取值一一对应。 */
export type TaskEventKind = 'created' | 'closed' | 'overdue';

/** 任务事件出口（装配时回填工作流任务事件桥，进程内触发）。 */
export type TaskEventPort = (input: {
  kind: TaskEventKind;
  task: {
    id: number;
    source: string;
    assigneeUserId: string;
    orgType: string;
    orgUserId: string;
    title: string;
    status: string;
    link: string;
  };
}) => Promise<unknown>;

/**
 * 统一任务中心：assign（Push）/ collect 全源（Pull）/ list / summary / close / reopen 的收口。
 * 写入口只有这里；各板块要么发 draft，要么实现 TaskSource，不各写一套待办。
 */
export class TaskCenterService {
  private readonly lastRefresh = new Map<string, number>();
  private taskEvents?: TaskEventPort;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TaskSourceRegistry,
    private readonly notifications: NotificationService,
  ) {}

  /** 任务变化出口：created / closed / overdue 命中已发布工作流的 trigger.task。 */
  useTaskEventPort(port: TaskEventPort) {
    this.taskEvents = port;
  }

  private emitTaskEvent(kind: TaskEventKind, row: MyTask): void {
    if (!this.taskEvents) return;
    // 不阻塞派单/关闭主链路：事件桥内部已做幂等，失败也不影响业务写入。
    void this.taskEvents({
      kind,
      task: {
        id: row.id,
        source: row.source,
        assigneeUserId: row.assigneeUserId,
        orgType: row.orgType,
        orgUserId: row.orgUserId,
        title: row.title,
        status: row.status,
        link: row.link,
      },
    }).catch(() => null);
  }

  // ---------- 写入：Push 通道 ----------

  /** 派发一条任务：dedupKey upsert；首次创建时顺带通知收件人。 */
  async assign(draft: TaskDraft): Promise<MyTask> {
    const assigneeType = draft.assigneeType === 'ORG' ? 'ORG' : 'USER';
    const orgUserId = (draft.orgUserId || '').slice(0, 64);
    // 机构队列的幂等锚用机构键：同一单据派给同一机构只保留一行，改派后也不会重复生成。
    const dedupKey = dedupKeyOf({
      source: draft.source,
      sourceId: draft.sourceId,
      assigneeUserId:
        assigneeType === 'ORG'
          ? `org:${orgUserId || 'none'}`
          : draft.assigneeUserId,
    });
    const existing = await this.prisma.myTask.findUnique({
      where: { dedupKey },
    });
    const title = (draft.title || '待办').slice(0, 200);
    const description = (draft.description || '').slice(0, 20000);
    const link = (draft.link || '').slice(0, 500);
    const priority = draft.priority || 'NORMAL';
    const sourceStatus = (draft.sourceStatus || '').slice(0, 32);
    const sourceStatusLabel = (draft.sourceStatusLabel || '').slice(0, 40);
    const dueAt = toDate(draft.dueAt);
    const now = new Date();
    // 已存在的行只刷新业务字段：承办人可能已被负责人改派，不能让源的下次 collect 弹回。
    const row = existing
      ? await this.prisma.myTask.update({
          where: { dedupKey },
          data: {
            title,
            description,
            link,
            priority,
            sourceStatus,
            sourceStatusLabel,
            dueAt,
            lastSyncedAt: now,
            // 表单定义由源模块权威，源再次 collect 时同步刷新；填写结果不在此覆盖。
            ...(draft.formSchema
              ? { formSchema: toJsonInput(draft.formSchema) }
              : {}),
          },
        })
      : await this.prisma.myTask.create({
          data: {
            dedupKey,
            assigneeUserId: assigneeType === 'ORG' ? '' : draft.assigneeUserId,
            assigneeType,
            orgType: (draft.orgType || '').slice(0, 16),
            orgUserId,
            assignedBy: (draft.assignedBy || draft.createdBy || '').slice(
              0,
              64,
            ),
            assignedAt: now,
            assignPolicy:
              draft.assignPolicy ||
              (assigneeType === 'ORG' ? 'ORG_QUEUE' : 'DIRECT'),
            source: draft.source,
            sourceId: draft.sourceId || '',
            category: draft.category || 'matter',
            title,
            description,
            link,
            priority,
            sourceStatus,
            sourceStatusLabel,
            createdBy: (draft.createdBy || '').slice(0, 64),
            dueAt,
            formSchema: draft.formSchema
              ? toJsonInput(draft.formSchema)
              : undefined,
            lastSyncedAt: now,
            ...(draft.terminal ? { status: 'DONE', closedAt: now } : {}),
          },
        });
    // 机构队列通知的是服务商账号（负责人），不是空收件人。
    const notifyTo = assigneeType === 'ORG' ? orgUserId : draft.assigneeUserId;
    if (!existing && notifyTo && notifyTo !== (draft.createdBy || '')) {
      await this.notifications
        .notify(notifyTo, {
          category: 'platform',
          title: `新任务：${row.title}`,
          body: row.description,
          link: row.link || '/tasks',
          entityType: 'my_task',
          entityId: row.id,
        })
        .catch(() => null);
    }
    // 首次建单才算「任务创建」；源反复 collect 命中同一行不重复触发。
    if (!existing && !TERMINAL_STATUSES.has(row.status))
      this.emitTaskEvent('created', row);
    return row;
  }

  /**
   * 关闭前复核（§P4-6 关闭口径）：任务源可声明 `recheck`，点「完成」时先按当前库表现场复核，
   * 业务异常仍在就拒绝关闭，避免用「点已完成」掩盖未消除的问题。
   */
  async recheckBeforeClose(input: {
    assigneeUserId: string;
    source: string;
    sourceId: string;
    orgType: string;
    orgUserId: string;
  }): Promise<{ cleared: boolean; reason: string }> {
    const source = this.registry.get(input.source);
    if (!source?.recheck) return { cleared: true, reason: '' };
    try {
      const result = await source.recheck(input);
      return result || { cleared: true, reason: '' };
    } catch {
      // 复核本身失败不拦办结：复核是加码，不是新单点。
      return { cleared: true, reason: '' };
    }
  }

  /** 源模块回写业务状态（内部约定，不暴露为公开业务路由）。terminal=true 时中心自动完成。 */
  async syncStatus(input: {
    source: string;
    sourceId: string;
    assigneeUserId: string;
    sourceStatus?: string;
    sourceStatusLabel?: string;
    terminal?: boolean;
  }): Promise<MyTask | null> {
    const dedupKey = dedupKeyOf(input);
    const existing = await this.prisma.myTask.findUnique({
      where: { dedupKey },
    });
    if (!existing) return null;
    const closing =
      input.terminal === true && !TERMINAL_STATUSES.has(existing.status);
    const updated = await this.prisma.myTask.update({
      where: { dedupKey },
      data: {
        sourceStatus: (input.sourceStatus ?? existing.sourceStatus).slice(
          0,
          32,
        ),
        sourceStatusLabel: (
          input.sourceStatusLabel ?? existing.sourceStatusLabel
        ).slice(0, 40),
        lastSyncedAt: new Date(),
        ...(closing ? { status: 'DONE', closedAt: new Date() } : {}),
      },
    });
    if (closing) this.emitTaskEvent('closed', updated);
    return updated;
  }

  // ---------- 拉取：Pull 通道 ----------

  /** 全源 collect → upsert；单源失败静默降级（照抄 OA 聚合的容错写法）。 */
  private async refresh(user: CurrentUser, force = false): Promise<void> {
    const now = Date.now();
    if (
      !force &&
      now - (this.lastRefresh.get(user.userId) ?? 0) < REFRESH_TTL_MS
    ) {
      return;
    }
    this.lastRefresh.set(user.userId, now);
    const results = await Promise.allSettled(
      this.registry.all().map(async (source) => ({
        source: source.key,
        push: source.push === true,
        // 对账必须基于「全量」：full=true 让源返回该账号全部未办（不受列表分页上限影响），
        // 否则「本次未取到」就不能当作已办结（§14.2）。
        drafts: await source.collect(user, { full: true }),
      })),
    );
    const collected = new Map<string, Set<string>>();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { source, push, drafts } = result.value;
      // Push-only 源不参与对账：它们的待办是模块主动派的，collect 恒空不代表办结。
      if (push) continue;
      const ids = new Set<string>();
      for (const draft of drafts) {
        if (!draft?.assigneeUserId) continue;
        if (draft.sourceId) ids.add(draft.sourceId);
        try {
          await this.assign(draft);
        } catch {
          // 单条落库失败不影响其余任务
        }
      }
      collected.set(source, ids);
    }
    // 对账：源以全量返回、本次仍不在集合里、中心还挂着的（非 Push 手工任务）一律置完成，
    // 否则业务侧办结后这条待办会永远留在列表里。
    for (const [source, ids] of collected) {
      try {
        await this.prisma.myTask.updateMany({
          where: {
            assigneeUserId: user.userId,
            source,
            status: { in: ['OPEN', 'DOING'] },
            sourceId: { not: '', ...(ids.size ? { notIn: [...ids] } : {}) },
          },
          data: {
            status: 'DONE',
            closedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        });
      } catch {
        // 对账失败不影响本次列表
      }
    }
  }

  private where(
    user: CurrentUser,
    query: Record<string, unknown>,
  ): Prisma.MyTaskWhereInput {
    const status = text(query.status);
    const includeClosed =
      query.includeClosed === true || query.includeClosed === 'true';
    const keyword = text(query.keyword).trim();
    return {
      assigneeUserId: user.userId,
      ...(status ? { status } : includeClosed ? {} : { status: UNCLOSED }),
      ...(query.category ? { category: text(query.category) } : {}),
      ...(query.source ? { source: text(query.source) } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword } },
              { description: { contains: keyword } },
            ],
          }
        : {}),
    };
  }

  // ---------- 读取 ----------

  async get(user: CurrentUser, id: string): Promise<MyTaskRow> {
    return this.toRow(await this.loadOwn(user, id));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    await this.refresh(user);
    const page = pageParam(
      query.page as string | number,
      query.pageSize as string | number,
    );
    const where = this.where(user, query);
    const [total, rows] = await Promise.all([
      this.prisma.myTask.count({ where }),
      this.prisma.myTask.findMany({
        where,
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        skip: page.offset,
        take: page.pageSize,
      }),
    ]);
    const summary = await this.summary(user, true);
    return {
      ...pageOf(
        rows.map((row) => this.toRow(row)),
        total,
        page.page,
        page.pageSize,
      ),
      groups: summary.byCategory,
      summary,
    };
  }

  /** 未办/今日到期/逾期/已关闭 + 按分组/来源计数；skipRefresh 供 list 复用同一次刷新。 */
  async summary(user: CurrentUser, skipRefresh = false): Promise<TaskSummary> {
    if (!skipRefresh) await this.refresh(user);
    const rows = await this.prisma.myTask.findMany({
      where: { assigneeUserId: user.userId },
      select: { status: true, category: true, source: true, dueAt: true },
    });
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const categoryCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    let open = 0;
    let doing = 0;
    let dueToday = 0;
    let overdue = 0;
    let closed = 0;
    for (const row of rows) {
      const unclosed = row.status === 'OPEN' || row.status === 'DOING';
      if (row.status === 'OPEN') open += 1;
      else if (row.status === 'DOING') doing += 1;
      else if (TERMINAL_STATUSES.has(row.status)) closed += 1;
      if (!unclosed) continue;
      categoryCounts.set(
        row.category,
        (categoryCounts.get(row.category) ?? 0) + 1,
      );
      sourceCounts.set(row.source, (sourceCounts.get(row.source) ?? 0) + 1);
      if (row.dueAt) {
        if (row.dueAt < now) overdue += 1;
        else if (row.dueAt < dayEnd) dueToday += 1;
      }
    }
    const byCategory: TaskGroupStat[] = TASK_CATEGORIES.map((key) => ({
      key,
      label: TASK_CATEGORY_LABELS[key] || key,
      count: categoryCounts.get(key) ?? 0,
    }));
    const bySource: TaskGroupStat[] = [...sourceCounts.entries()]
      .map(([key, count]) => ({
        key,
        label: this.registry.labelOf(key),
        count,
      }))
      .sort((a, b) => b.count - a.count);
    const org = await this.orgQueueCounts(user.userId, now);
    return {
      pending: open + doing,
      doing,
      dueToday,
      overdue,
      closed,
      orgPending: org.pending,
      unassigned: org.unassigned,
      total: rows.length,
      byCategory,
      bySource,
    };
  }

  /**
   * 机构待派只统计「本人是服务商账号」的队列。
   * `unassigned` = 建单超过 24 小时仍无人承办（事实口径，不会因提醒而重置）；
   * D4 的自动落实用的是队列进入时间 `assignedAt`，提醒后会推后计时，两者各司其职。
   */
  private async orgQueueCounts(orgUserId: string, now: Date) {
    const unassignedBefore = new Date(now.getTime() - 86_400_000);
    const where: Prisma.MyTaskWhereInput = {
      assigneeType: 'ORG',
      orgType: 'PROVIDER',
      orgUserId,
      status: UNCLOSED,
    };
    const [pending, unassigned] = await Promise.all([
      this.prisma.myTask.count({ where }),
      this.prisma.myTask.count({
        where: { ...where, createdAt: { lt: unassignedBefore } },
      }),
    ]);
    return { pending, unassigned };
  }

  // ---------- 逾期扫描 ----------

  /**
   * 逾期变化只扫「截止时间落在回看窗口内」的未办任务（定时器默认 10 分钟、窗口 2 倍），
   * 窗口重叠由工作流侧 dedupeKey（任务 + 变化类型）兜底，不会重复起流程。
   */
  async sweepOverdue(lookbackMs: number): Promise<number> {
    if (!this.taskEvents) return 0;
    const now = new Date();
    const from = new Date(now.getTime() - Math.max(lookbackMs, 60_000));
    const rows = await this.prisma.myTask.findMany({
      where: {
        status: UNCLOSED,
        dueAt: { not: null, lt: now, gte: from },
      },
      orderBy: { dueAt: 'asc' },
      take: 500,
    });
    for (const row of rows) this.emitTaskEvent('overdue', row);
    return rows.length;
  }

  // ---------- 本人关闭 / 表单提交 / 撤销 ----------

  async close(
    user: CurrentUser,
    id: string,
    body: { note?: string },
  ): Promise<MyTaskRow> {
    const row = await this.loadOwn(user, id);
    return this.toRow(
      await this.finish(user, row, (body?.note || '').slice(0, 500)),
    );
  }

  /**
   * 表单任务提交：按落库的字段定义校验必填，写入 formData 后关闭任务；
   * 关闭走同一条 finish，源模块（工作流）照常被唤醒并读取 formData 续跑。
   */
  async submitForm(
    user: CurrentUser,
    id: string,
    body: { values?: Record<string, string>; note?: string },
  ): Promise<MyTaskRow> {
    const row = await this.loadOwn(user, id);
    if (TERMINAL_STATUSES.has(row.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务已关闭，不能重复提交',
      );
    }
    const form = this.formOf(row);
    if (!form) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该任务不是表单任务');
    }
    const values = formValuesOf(form, body?.values);
    const updated = await this.finish(
      user,
      row,
      (body?.note || '').slice(0, 500),
      { formData: toJsonInput(values) },
    );
    return this.toRow(updated);
  }

  /** 本人办结：写终态、发 closed 事件、回调源模块；关闭与表单提交共用。 */
  private async finish(
    user: CurrentUser,
    row: MyTask,
    note: string,
    extra: Prisma.MyTaskUpdateInput = {},
  ): Promise<MyTask> {
    const closing = !TERMINAL_STATUSES.has(row.status);
    if (closing) {
      const check = await this.recheckBeforeClose({
        assigneeUserId: row.assigneeUserId,
        source: row.source,
        sourceId: row.sourceId,
        orgType: row.orgType,
        orgUserId: row.orgUserId,
      });
      if (!check.cleared) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          check.reason || '业务异常仍未消除，暂不能关闭',
        );
      }
    }
    const updated = closing
      ? await this.prisma.myTask.update({
          where: { id: row.id },
          data: {
            ...extra,
            status: 'DONE',
            closedAt: new Date(),
            closedBy: user.userId,
            closeNote: note,
          },
        })
      : row;
    if (closing) this.emitTaskEvent('closed', updated);
    const source = this.registry.get(row.source);
    if (source?.onClosed) {
      await source
        .onClosed(
          {
            assigneeUserId: row.assigneeUserId,
            source: row.source,
            sourceId: row.sourceId,
            title: row.title,
            link: row.link,
            category: row.category,
          },
          note,
        )
        .catch(() => undefined);
    }
    return updated;
  }

  async reopen(user: CurrentUser, id: string): Promise<MyTaskRow> {
    const row = await this.loadOwn(user, id);
    const updated = await this.prisma.myTask.update({
      where: { id: row.id },
      data: { status: 'OPEN', closedAt: null, closedBy: '', closeNote: '' },
    });
    return this.toRow(updated);
  }

  /** 读回表单定义：列里是 JSON，损坏或非表单任务一律按 null 处理。 */
  private formOf(row: MyTask): TaskFormDefinition | null {
    const parsed = taskFormSchema.safeParse(fromJson<unknown>(row.formSchema));
    return parsed.success ? parsed.data : null;
  }

  private formDataOf(row: MyTask): Record<string, string> | null {
    const parsed = taskFormValuesSchema.safeParse(
      fromJson<unknown>(row.formData),
    );
    return parsed.success ? parsed.data : null;
  }

  /** 只允许对「指派给我」的行操作；越权一律 403。 */
  private async loadOwn(user: CurrentUser, id: string): Promise<MyTask> {
    const taskId = Number(id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    }
    const row = await this.prisma.myTask.findUnique({ where: { id: taskId } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    if (row.assigneeUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能操作指派给自己的任务',
      );
    }
    return row;
  }

  toRow(row: MyTask): MyTaskRow {
    const unclosed = row.status === 'OPEN' || row.status === 'DOING';
    return {
      id: row.id,
      source: row.source,
      sourceLabel: this.registry.labelOf(row.source),
      sourceId: row.sourceId,
      category: row.category,
      categoryLabel: TASK_CATEGORY_LABELS[row.category] || row.category,
      title: row.title,
      description: row.description,
      link: row.link,
      priority: row.priority,
      priorityLabel: TASK_PRIORITY_LABELS[row.priority] || row.priority,
      status: row.status,
      statusLabel: TASK_STATUS_LABELS[row.status] || row.status,
      sourceStatus: row.sourceStatus,
      sourceStatusLabel: row.sourceStatusLabel,
      orgType: row.orgType,
      orgUserId: row.orgUserId,
      assigneeType: row.assigneeType,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
      assignPolicy: row.assignPolicy,
      assignPolicyLabel:
        TASK_ASSIGN_STRATEGY_LABELS[row.assignPolicy] || row.assignPolicy,
      acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      createdBy: row.createdBy,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      overdue:
        unclosed && row.dueAt !== null && row.dueAt.getTime() < Date.now(),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      closedBy: row.closedBy,
      closeNote: row.closeNote,
      formSchema: this.formOf(row),
      formData: this.formDataOf(row),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
