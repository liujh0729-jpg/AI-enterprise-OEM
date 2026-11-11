import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { IdentityService } from '../identity/identity.service';
import type { NotificationService } from '../notifications/notification.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MyTask, Prisma } from '../../generated/prisma';
import type { TaskCenterService } from './task-center.service';
import type {
  TaskAssignmentLogRow,
  TaskAssignStrategy,
} from '@enterprise/contracts';
import {
  TASK_ASSIGN_STRATEGY_LABELS,
  TASK_CATEGORIES,
} from '@enterprise/contracts';
import type { TaskDocumentRegistry } from './task-document.binding';
import type { TaskDraft } from './task-source';

/** D4：机构队列挂满一天还没人接，就按规则/轮询自动落实并通知负责人。 */
const UNCLAIMED_MS = 86_400_000;
const OPEN_STATUSES = ['OPEN', 'DOING'];

export type ResolvedAssignment = {
  assigneeType: 'USER' | 'ORG';
  assigneeUserId: string;
  /** DIRECT | ROUND_ROBIN | LOAD | ORG_QUEUE */
  strategy: TaskAssignStrategy;
  ruleId: number | null;
};

/** 板块派单入口：订货/预约建单时把任务交给 TaskRouter，不直接写 my_tasks。 */
export type TaskDispatchInput = {
  source: string;
  sourceId: string;
  orgUserId: string;
  orgType?: string;
  category?: string;
  region?: string;
  title: string;
  description?: string;
  link: string;
  priority?: string;
  dueAt?: string | Date | null;
  createdBy: string;
  /** 板块默认承办人（ProviderAssignment）；没有就按规则/机构队列 */
  staffUserId?: string;
  sourceStatus?: string;
  sourceStatusLabel?: string;
};

/** 板块侧改承办人：任务与单据同事务，失败整体回滚（D3=A）。 */
export type TaskDocumentAssignInput = {
  source: string;
  sourceId: string;
  orgUserId: string;
  staffUserId: string;
  actorId: string;
  note?: string;
};

export type TaskDispatchPort = {
  dispatch(input: TaskDispatchInput): Promise<MyTask>;
  assignDocument(input: TaskDocumentAssignInput): Promise<string>;
};

function jsonIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * 服务商 → 业务执行人派单原语：派给谁只由这里决定。
 * 规则（服务商负责人自助配置）优先于板块默认承办人，都没有就落机构队列等改派。
 */
export class TaskRouterService implements TaskDispatchPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskCenterService,
    private readonly documents: TaskDocumentRegistry,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------- 解析与人选 ----------

  private async matchRule(
    orgUserId: string,
    source: string,
    category: string,
    region: string,
  ) {
    const rules = await this.prisma.taskAssignmentRule.findMany({
      where: { orgType: 'PROVIDER', orgUserId, enabled: true },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
    return (
      rules.find(
        (rule) =>
          (rule.source === '*' || rule.source === source) &&
          (rule.category === '*' || rule.category === category) &&
          (!rule.region || rule.region === region),
      ) ?? null
    );
  }

  private async activeStaff(orgUserId: string): Promise<string[]> {
    const rows = await this.prisma.providerStaff.findMany({
      where: { providerUserId: orgUserId, status: 'ACTIVE' },
      select: { staffUserId: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.staffUserId);
  }

  /** 轮询按「最近一次被派活的时间」取最旧；负载按未办数最少，再按最近派活时间。 */
  private async pickByStrategy(
    strategy: string,
    pool: string[],
  ): Promise<string | null> {
    if (!pool.length) return null;
    if (strategy === 'DIRECT') return pool[0];
    const [recent, load] = await Promise.all([
      this.prisma.myTask.groupBy({
        by: ['assigneeUserId'],
        where: {
          assigneeType: 'USER',
          assigneeUserId: { in: pool },
        },
        _max: { assignedAt: true },
      }),
      this.prisma.myTask.groupBy({
        by: ['assigneeUserId'],
        where: {
          assigneeUserId: { in: pool },
          status: { in: OPEN_STATUSES },
        },
        _count: { _all: true },
      }),
    ]);
    const lastAt = new Map(
      recent.map((row) => [row.assigneeUserId, row._max.assignedAt]),
    );
    const busy = new Map(
      load.map((row) => [row.assigneeUserId, row._count._all]),
    );
    const weight = (id: string) => {
      const at = lastAt.get(id);
      return { count: busy.get(id) ?? 0, at: at ? at.getTime() : 0 };
    };
    const ranked = [...pool].sort((a, b) => {
      const left = weight(a);
      const right = weight(b);
      if (strategy === 'LOAD' && left.count !== right.count) {
        return left.count - right.count;
      }
      return left.at - right.at;
    });
    return ranked[0];
  }

  async resolve(input: {
    orgType?: string;
    orgUserId: string;
    source: string;
    category: string;
    region?: string;
  }): Promise<ResolvedAssignment> {
    const orgType = input.orgType || 'PROVIDER';
    if (orgType !== 'PROVIDER' || !input.orgUserId) {
      return {
        assigneeType: 'ORG',
        assigneeUserId: '',
        strategy: 'ORG_QUEUE',
        ruleId: null,
      };
    }
    const rule = await this.matchRule(
      input.orgUserId,
      input.source,
      input.category,
      input.region || '',
    );
    if (rule) {
      const targets = jsonIds(rule.targets);
      const all = await this.activeStaff(input.orgUserId);
      const allowed = new Set(all);
      const pool = targets.length
        ? targets.filter((id) => allowed.has(id))
        : all;
      const picked = await this.pickByStrategy(rule.strategy, pool);
      if (picked) {
        return {
          assigneeType: 'USER',
          assigneeUserId: picked,
          strategy: (rule.strategy as TaskAssignStrategy) || 'DIRECT',
          ruleId: rule.id,
        };
      }
    }
    return {
      assigneeType: 'ORG',
      assigneeUserId: '',
      strategy: 'ORG_QUEUE',
      ruleId: null,
    };
  }

  // ---------- 派发 ----------

  async dispatch(input: TaskDispatchInput): Promise<MyTask> {
    const category =
      TASK_CATEGORIES.find((key) => key === input.category) || 'task';
    const resolved = await this.resolve({
      orgType: input.orgType,
      orgUserId: input.orgUserId,
      source: input.source,
      category,
      region: input.region,
    });
    let assigneeType = resolved.assigneeType;
    let assigneeUserId = resolved.assigneeUserId;
    let strategy = resolved.strategy;
    if (assigneeType === 'ORG' && input.staffUserId) {
      assigneeType = 'USER';
      assigneeUserId = input.staffUserId;
      strategy = 'DIRECT';
    }
    const draft: TaskDraft = {
      assigneeUserId,
      assigneeType,
      orgType: input.orgType || 'PROVIDER',
      orgUserId: input.orgUserId,
      assignPolicy: strategy,
      assignedBy: 'system',
      region: input.region,
      source: input.source,
      sourceId: input.sourceId,
      title: input.title,
      description: input.description,
      link: input.link,
      category,
      priority: input.priority,
      dueAt: input.dueAt,
      createdBy: input.createdBy,
      sourceStatus: input.sourceStatus,
      sourceStatusLabel: input.sourceStatusLabel,
    };
    return this.tasks.assign(draft);
  }

  // ---------- 改派 / 接单 / 留痕 ----------

  private async requireManager(user: CurrentUser, orgUserId: string) {
    if (!orgUserId || orgUserId !== user.userId) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能管理本机构的派单');
    }
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
  }

  private async requireActiveStaff(orgUserId: string, staffUserId: string) {
    const bind = await this.prisma.providerStaff.findUnique({
      where: {
        providerUserId_staffUserId: {
          providerUserId: orgUserId,
          staffUserId,
        },
      },
    });
    if (!bind || bind.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该职员未绑定本机构');
    }
  }

  /** 串行：MyTask → 业务单据 staffUserId → 留痕；任一步失败整体回滚（D3=A）。 */
  private async commitAssign(
    task: MyTask,
    toUserId: string,
    actorId: string,
    note: string,
    strategy: TaskAssignStrategy,
    accepted: boolean,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.myTask.update({
        where: { id: task.id },
        data: {
          assigneeUserId: toUserId,
          assigneeType: toUserId ? 'USER' : 'ORG',
          assignedBy: actorId,
          assignedAt: new Date(),
          assignPolicy: strategy,
          acceptedAt: accepted ? new Date() : null,
        },
      });
      const binding = this.documents.get(task.source);
      if (binding) {
        const docId = binding.idOf(task.sourceId);
        const ok =
          docId !== null && (await binding.setStaff(tx, docId, toUserId));
        if (!ok) {
          throw new BusinessException(
            ErrorCode.NOT_FOUND,
            '业务单据不存在，无法同步承办人',
          );
        }
      }
      await tx.taskAssignmentLog.create({
        data: {
          taskId: task.id,
          fromUserId: task.assigneeUserId,
          toUserId,
          strategy,
          note,
          actorId,
        },
      });
      return row;
    });
    return this.tasks.toRow(updated);
  }

  async reassign(
    user: CurrentUser,
    taskId: string,
    body: { toUserId?: string; strategy?: string; note?: string },
  ) {
    const task = await this.loadTask(taskId);
    await this.requireManager(user, task.orgUserId);
    const toUserId = text(body?.toUserId).trim().slice(0, 64);
    if (toUserId) await this.requireActiveStaff(task.orgUserId, toUserId);
    const strategy: TaskAssignStrategy = toUserId
      ? (body?.strategy as TaskAssignStrategy) || 'DIRECT'
      : 'ORG_QUEUE';
    return this.commitAssign(
      task,
      toUserId,
      user.userId,
      text(body?.note).slice(0, 500),
      strategy,
      false,
    );
  }

  async claim(user: CurrentUser, taskId: string) {
    const task = await this.loadTask(taskId);
    if (task.assigneeType !== 'ORG' || task.assigneeUserId) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该任务已有人承办，无需接单',
      );
    }
    if (task.orgUserId !== user.userId) {
      await this.requireActiveStaff(task.orgUserId, user.userId);
    }
    return this.commitAssign(
      task,
      user.userId,
      user.userId,
      '主动接单',
      'DIRECT',
      true,
    );
  }

  /** 板块侧改承办人（如供销「指派承办职员」）：单据 + 任务 + 留痕同事务。 */
  async assignDocument(input: TaskDocumentAssignInput): Promise<string> {
    const staffUserId = text(input.staffUserId).trim().slice(0, 64);
    if (staffUserId) {
      await this.requireActiveStaff(input.orgUserId, staffUserId);
    }
    const task = await this.prisma.myTask.findFirst({
      where: {
        source: input.source,
        sourceId: input.sourceId,
        orgType: 'PROVIDER',
        orgUserId: input.orgUserId,
      },
    });
    const binding = this.documents.get(input.source);
    if (!binding) {
      // 宁可失败也不做「只改任务不改单据」：那样服务商能看到任务却打不开单据（D3=A）。
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该板块未登记承办人同步，无法指派',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      if (task) {
        await tx.myTask.update({
          where: { id: task.id },
          data: {
            assigneeUserId: staffUserId,
            assigneeType: staffUserId ? 'USER' : 'ORG',
            assignedBy: input.actorId,
            assignedAt: new Date(),
            assignPolicy: staffUserId ? 'DIRECT' : 'ORG_QUEUE',
            acceptedAt: null,
          },
        });
      }
      const docId = binding.idOf(input.sourceId);
      const ok =
        docId !== null && (await binding.setStaff(tx, docId, staffUserId));
      if (!ok) {
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '业务单据不存在，无法同步承办人',
        );
      }
      if (task) {
        await tx.taskAssignmentLog.create({
          data: {
            taskId: task.id,
            fromUserId: task.assigneeUserId,
            toUserId: staffUserId,
            strategy: staffUserId ? 'DIRECT' : 'ORG_QUEUE',
            note: text(input.note).slice(0, 500),
            actorId: input.actorId,
          },
        });
      }
    });
    return staffUserId;
  }

  async assignmentLogs(user: CurrentUser, taskId: string) {
    const task = await this.loadTask(taskId);
    if (
      task.assigneeUserId !== user.userId &&
      task.orgUserId !== user.userId &&
      !user.isAdmin()
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能查看自己的任务留痕',
      );
    }
    const rows = await this.prisma.taskAssignmentLog.findMany({
      where: { taskId: task.id },
      orderBy: { id: 'asc' },
    });
    return rows.map((row): TaskAssignmentLogRow => ({
      id: row.id,
      taskId: row.taskId,
      fromUserId: row.fromUserId,
      toUserId: row.toUserId,
      strategy: row.strategy,
      strategyLabel: TASK_ASSIGN_STRATEGY_LABELS[row.strategy] || row.strategy,
      note: row.note,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ---------- 机构收件箱 ----------

  async orgInbox(user: CurrentUser, query: Record<string, unknown>) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    const page = pageParam(
      query.page as string | number,
      query.pageSize as string | number,
    );
    const includeClosed =
      query.includeClosed === true || query.includeClosed === 'true';
    const keyword = text(query.keyword).trim();
    const base: Prisma.MyTaskWhereInput = {
      assigneeType: 'ORG',
      orgType: 'PROVIDER',
      orgUserId: user.userId,
      ...(includeClosed ? {} : { status: { in: OPEN_STATUSES } }),
    };
    const where: Prisma.MyTaskWhereInput = keyword
      ? {
          ...base,
          OR: [
            { title: { contains: keyword } },
            { description: { contains: keyword } },
          ],
        }
      : base;
    const [total, rows] = await Promise.all([
      this.prisma.myTask.count({ where }),
      this.prisma.myTask.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: page.offset,
        take: page.pageSize,
      }),
    ]);
    const cutoff = new Date(Date.now() - UNCLAIMED_MS);
    const unassigned = await this.prisma.myTask.count({
      where: { ...base, createdAt: { lt: cutoff } },
    });
    return {
      ...pageOf(
        rows.map((row) => this.tasks.toRow(row)),
        total,
        page.page,
        page.pageSize,
      ),
      pending: total,
      unassigned,
    };
  }

  // ---------- D4：超时自动落实 ----------

  async sweepUnassigned(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - UNCLAIMED_MS);
    const rows = await this.prisma.myTask.findMany({
      where: {
        assigneeType: 'ORG',
        orgType: 'PROVIDER',
        status: { in: OPEN_STATUSES },
        assignedAt: { lt: cutoff },
      },
      orderBy: { id: 'asc' },
      take: 200,
    });
    let assigned = 0;
    for (const task of rows) {
      try {
        const resolved = await this.resolve({
          orgType: 'PROVIDER',
          orgUserId: task.orgUserId,
          source: task.source,
          category: task.category,
        });
        if (resolved.assigneeType === 'USER' && resolved.assigneeUserId) {
          await this.commitAssign(
            task,
            resolved.assigneeUserId,
            'system',
            `机构待派超过 24 小时，按「${TASK_ASSIGN_STRATEGY_LABELS[resolved.strategy] || resolved.strategy}」自动落实`,
            resolved.strategy,
            false,
          );
          assigned += 1;
          continue;
        }
        // 没有可用职员：推一次负责人提醒，并把计时推到 now，避免每轮重复轰炸。
        await this.prisma.myTask.update({
          where: { id: task.id },
          data: { assignedAt: now },
        });
        await this.notifications
          .notify(task.orgUserId, {
            category: 'platform',
            title: '机构待派超时提醒',
            body: `「${task.title}」已超过 24 小时未指派，请尽快改派给具体职员`,
            link: '/tasks?view=org',
            entityType: 'my_task',
            entityId: task.id,
          })
          .catch(() => null);
      } catch {
        // 单条失败不影响其余任务
      }
    }
    return assigned;
  }

  private async loadTask(taskId: string): Promise<MyTask> {
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    }
    const task = await this.prisma.myTask.findUnique({ where: { id } });
    if (!task) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    if (task.orgType !== 'PROVIDER' || !task.orgUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有服务商任务支持改派与接单',
      );
    }
    return task;
  }
}
