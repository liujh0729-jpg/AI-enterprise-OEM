import { Prisma, type WorkbuddyPlan } from '../../generated/prisma';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  computeNextOccurrence,
  readScheduleFields,
  scheduleConfigOf,
} from '../common/schedule';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  wbAgentTaskCancel,
  wbAgentTaskGet,
  wbCreateAgentSession,
  wbDescribeMessageEventList,
  wbDescribeUserAccessToken,
  wbPushInstruction,
  type WbCreds,
  type WbMessageEvent,
} from './workbuddy-client';
import { WorkbuddyAccountService } from './workbuddy-account.service';
import { requireId } from './workbuddy-agent.service';
import {
  PLAN_KINDS,
  PLAN_STATUSES,
  PLAN_STRATEGIES,
  idList,
  normalizeChoice,
  normalizePlanSpec,
  shorten,
  specIsReady,
  type PlanSpec,
} from './workbuddy-shared';

const TERMINAL_TASK = ['succeeded', 'failed', 'cancelled'];
/** 一次同步最多翻几页消息事件（每页 100），避免一个超长会话把请求拖死。 */
const MAX_EVENT_PAGES = 10;
/** 一个计划最多并行用几把凭据（派发目标与计划上登记的账号共用这个上限）。 */
const MAX_DISPATCH_TARGETS = 10;

type DispatchTarget = { accountId: number; agentId: string; versionId: string };

/**
 * 计划任务：口水话 → 任务书（在 LLM 服务里澄清）→ 逐条任务 → 派发到 Workbuddy 会话 → 轮询消息事件。
 *
 * 计划与任务是本地记录（用户回看用）；真正的 Agent 与会话都在腾讯云侧，
 * 每条任务用哪把凭据签名，就只能碰那把凭据对应的企业资源。
 */
export class WorkbuddyPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly accounts: WorkbuddyAccountService,
  ) {}

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const status = text(query.status).trim();
    const where: Prisma.WorkbuddyPlanWhereInput = { createdBy: user.userId };
    if (status) {
      where.status = normalizeChoice(
        status,
        PLAN_STATUSES,
        '计划状态',
        'draft',
      );
    }
    const [rows, counts] = await Promise.all([
      this.prisma.workbuddyPlan.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      this.prisma.workbuddyPlan.groupBy({
        by: ['status'],
        where: { createdBy: user.userId },
        _count: { _all: true },
      }),
    ]);
    return {
      items: rows.map((row) => this.decoratePlan(row)),
      counts: Object.fromEntries(
        counts.map((item) => [item.status, item._count._all]),
      ),
    };
  }

  async get(user: CurrentUser, id: number) {
    const plan = await this.loadOwnedPlan(user, id);
    const [tasks, accounts] = await Promise.all([
      this.prisma.workbuddyTask.findMany({
        where: { planId: id },
        orderBy: { seq: 'asc' },
      }),
      this.prisma.workbuddyAccount.findMany({
        where: { createdBy: user.userId },
        select: { id: true, name: true, status: true },
      }),
    ]);
    return {
      plan: this.decoratePlan(plan),
      tasks: tasks.map((task) => this.decorateTask(task)),
      accounts,
    };
  }

  /**
   * 新建计划：先选分类，三类走同一个入口。
   * ai＝只存原始描述，后面和 AI 澄清成任务书再拆解；
   * direct＝按 Workbuddy 字段直接摊出任务，建完就是待派发；
   * scheduled＝同 direct，再带一套排期字段（与 RPA 任务同一口径），到点由调度器派发。
   */
  async create(user: CurrentUser, body: Record<string, unknown>) {
    const kind = normalizeChoice(body.kind, PLAN_KINDS, '任务类型', 'ai');
    if (kind !== 'ai') return this.createExplicitPlan(user, kind, body);
    const rawInput = text(body.rawInput).trim().slice(0, 20000);
    const title =
      text(body.title).trim().slice(0, 200) ||
      shorten(rawInput).slice(0, 60) ||
      '未命名计划';
    if (!rawInput) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先用一句话说清你想让 Agent 做什么',
      );
    }
    const row = await this.prisma.workbuddyPlan.create({
      data: {
        createdBy: user.userId,
        kind,
        title,
        rawInput,
        status: 'draft',
      },
    });
    await this.identity.audit(
      user.userId,
      'Workbuddy新建计划',
      `#${row.id} ${row.title}`,
    );
    return this.decoratePlan(row);
  }

  /** 明确生成任务 / 定时任务：任务书直接由表单填出，一次落库计划 + 逐条任务。 */
  private async createExplicitPlan(
    user: CurrentUser,
    kind: string,
    body: Record<string, unknown>,
  ) {
    const goal = text(body.goal ?? body.rawInput)
      .trim()
      .slice(0, 2000);
    const spec = normalizePlanSpec({
      goal: goal || text(body.title).trim().slice(0, 200),
      deliverable: text(body.deliverable).trim(),
      acceptance: text(body.acceptance).trim(),
      steps: body.steps,
    });
    if (!spec.steps.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少填写一条任务内容',
      );
    }
    const targets = await this.readTargets(user, body);
    const title =
      text(body.title).trim().slice(0, 200) ||
      shorten(spec.goal).slice(0, 60) ||
      '未命名任务';
    const rawInput = text(body.rawInput).trim().slice(0, 20000) || spec.goal;
    const schedule =
      kind === 'scheduled'
        ? this.readPlanSchedule(body)
        : { scheduleType: 'once' };
    const strategy = targets.length > 1 ? 'fan_out' : 'single';
    const row = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.workbuddyPlan.create({
        data: {
          createdBy: user.userId,
          kind,
          title,
          rawInput,
          spec,
          taskCount: spec.steps.length,
          strategy,
          accountIds: [...new Set(targets.map((target) => target.accountId))],
          status: 'ready',
          ...schedule,
        },
      });
      await tx.workbuddyTask.createMany({
        data: this.buildTaskRows(plan.id, user, kind, spec, targets),
      });
      return plan;
    });
    await this.identity.audit(
      user.userId,
      kind === 'scheduled' ? 'Workbuddy新建定时任务' : 'Workbuddy新建任务',
      `#${row.id} ${row.title} → ${spec.steps.length} 条任务（${
        row.scheduledAt ? `下次 ${row.scheduledAt.toISOString()}` : '不排期'
      }）`,
    );
    return this.decoratePlan(row);
  }

  /**
   * 定时任务的排期：与 RPA 任务同一套字段口径，但建完就要有第一次执行时刻，
   * 否则调度器永远等不到它。once 不算定时，直接拒掉。
   */
  private readPlanSchedule(body: Record<string, unknown>) {
    const schedule = readScheduleFields(body);
    const scheduleType = text(schedule.scheduleType).trim();
    if (scheduleType === 'once' || !scheduleType) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '定时任务要选择执行时间或重复频率',
      );
    }
    if (scheduleType === 'recurring') {
      const config = scheduleConfigOf(schedule.scheduleConfig);
      const freq = text(config.freq).trim();
      if (!freq) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '周期重复要选择重复频率',
        );
      }
      schedule.scheduledAt = computeNextOccurrence(config, new Date());
    }
    return schedule;
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    await this.loadOwnedPlan(user, id);
    const data: Prisma.WorkbuddyPlanUpdateInput = {};
    if (body.title !== undefined) {
      const title = text(body.title).trim().slice(0, 200);
      if (!title) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '计划标题不能为空');
      }
      data.title = title;
    }
    if (body.rawInput !== undefined) {
      data.rawInput = text(body.rawInput).slice(0, 20000);
    }
    if (body.spec !== undefined) {
      data.spec = normalizePlanSpec(body.spec);
    }
    if (body.strategy !== undefined) {
      data.strategy = normalizeChoice(
        body.strategy,
        PLAN_STRATEGIES,
        '派发方式',
        'single',
      );
    }
    if (body.accountIds !== undefined) {
      const ids = idList(body.accountIds);
      if (ids.length > MAX_DISPATCH_TARGETS) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `一次最多选 ${MAX_DISPATCH_TARGETS} 个 Workbuddy Enterprise 账号并行`,
        );
      }
      // 计划上这几个 id 后面会拿去解密签名，必须逐个确认归本人；
      // 传进来的非法 id（别人的凭据、已删除的凭据）一律报错，不静默丢掉。
      for (const accountId of ids) {
        await this.accounts.loadOwned(user, accountId);
      }
      data.accountIds = ids;
    }
    if (body.summary !== undefined) {
      data.summary = text(body.summary).slice(0, 20000);
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const saved = await this.prisma.workbuddyPlan.update({
      where: { id },
      data,
    });
    return this.decoratePlan(saved);
  }

  async remove(user: CurrentUser, id: number) {
    await this.loadOwnedPlan(user, id);
    const tasks = await this.prisma.workbuddyTask.findMany({
      where: { planId: id },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.workbuddyTaskEvent.deleteMany({
        where: { taskId: { in: tasks.map((task) => task.id) } },
      }),
      this.prisma.workbuddyTask.deleteMany({ where: { planId: id } }),
      this.prisma.workbuddyPlan.delete({ where: { id } }),
    ]);
    await this.identity.audit(
      user.userId,
      'Workbuddy删除计划',
      `#${id}（连同 ${tasks.length} 条任务）`,
    );
    return { id };
  }

  /**
   * 把任务书的步骤摊成任务行（逐条可改可删）。
   * 已经派发过的计划不允许重新拆解，否则同一段活会被跑两遍。
   */
  async materialize(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const plan = await this.loadOwnedPlan(user, id);
    const dispatched = await this.prisma.workbuddyTask.count({
      where: { planId: id, sessionId: { not: '' } },
    });
    if (dispatched) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该计划已有 ${dispatched} 条任务派发执行过，重新拆解会重复执行；请新建一个计划`,
      );
    }
    const spec = normalizePlanSpec(body.spec ?? plan.spec);
    if (!specIsReady(spec)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务书还没有目标或可执行步骤，请先和 AI 把任务书聊完整',
      );
    }
    const targets = await this.readTargets(user, body);
    const strategy = targets.length > 1 ? 'fan_out' : 'single';
    const rows = this.buildTaskRows(id, user, plan.kind, spec, targets);
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workbuddyTask.findMany({
        where: { planId: id },
        select: { id: true },
      });
      await tx.workbuddyTaskEvent.deleteMany({
        where: { taskId: { in: existing.map((task) => task.id) } },
      });
      await tx.workbuddyTask.deleteMany({ where: { planId: id } });
      await tx.workbuddyTask.createMany({ data: rows });
      return tx.workbuddyPlan.update({
        where: { id },
        data: {
          spec,
          taskCount: rows.length,
          strategy,
          accountIds: [...new Set(targets.map((target) => target.accountId))],
          status: 'ready',
          lastError: '',
        },
      });
    });
    await this.identity.audit(
      user.userId,
      'Workbuddy拆解计划',
      `#${id} → ${rows.length} 条任务（${strategy === 'fan_out' ? `${targets.length} 个账号并行` : '单账号'}）`,
    );
    return this.decoratePlan(saved);
  }

  async addTask(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const plan = await this.loadOwnedPlan(user, id);
    const target = await this.readTarget(user, body);
    const instruction = text(body.instruction).trim().slice(0, 8000);
    if (!instruction) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写这条任务要做什么',
      );
    }
    const last = await this.prisma.workbuddyTask.findFirst({
      where: { planId: id },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const task = await this.prisma.workbuddyTask.create({
      data: {
        planId: id,
        createdBy: user.userId,
        kind: plan.kind,
        seq: (last?.seq || 0) + 1,
        accountId: target.accountId,
        agentId: target.agentId,
        versionId: target.versionId,
        instruction,
        status: 'pending',
      },
    });
    await this.prisma.workbuddyPlan.update({
      where: { id },
      data: {
        taskCount: plan.taskCount + 1,
        status: plan.status === 'draft' ? 'ready' : plan.status,
      },
    });
    return this.decorateTask(task);
  }

  async updateTask(
    user: CurrentUser,
    taskId: number,
    body: Record<string, unknown>,
  ) {
    const task = await this.loadOwnedTask(user, taskId);
    if (task.sessionId) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '这条任务已经派发到 Agent 会话，指令不能改；要换做法请新建一条任务',
      );
    }
    const data: Prisma.WorkbuddyTaskUpdateInput = {};
    if (body.instruction !== undefined) {
      const instruction = text(body.instruction).trim().slice(0, 8000);
      if (!instruction) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '任务内容不能为空');
      }
      data.instruction = instruction;
    }
    if (
      body.accountId !== undefined ||
      body.agentId !== undefined ||
      body.versionId !== undefined
    ) {
      const target = await this.readTarget(user, {
        accountId: body.accountId ?? task.accountId,
        agentId: body.agentId ?? task.agentId,
        versionId: body.versionId ?? task.versionId,
      });
      data.accountId = target.accountId;
      data.agentId = target.agentId;
      data.versionId = target.versionId;
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const saved = await this.prisma.workbuddyTask.update({
      where: { id: taskId },
      data,
    });
    return this.decorateTask(saved);
  }

  async removeTask(user: CurrentUser, taskId: number) {
    const task = await this.loadOwnedTask(user, taskId);
    if (task.sessionId) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '这条任务已经派发到 Agent 会话，不能删除（可取消）',
      );
    }
    await this.prisma.$transaction([
      this.prisma.workbuddyTaskEvent.deleteMany({
        where: { taskId },
      }),
      this.prisma.workbuddyTask.delete({ where: { id: taskId } }),
      this.prisma.workbuddyPlan.update({
        where: { id: task.planId },
        data: { taskCount: { decrement: 1 } },
      }),
    ]);
    return { id: taskId };
  }

  /**
   * 派发：每条任务建一个会话 → 换用户级访问令牌 → 把指令推给 Agent。
   * 会话与令牌按账号复用，多账号时各自签名；单条失败不影响其它任务，失败原因落在任务上。
   */
  async dispatch(user: CurrentUser, id: number) {
    await this.loadOwnedPlan(user, id);
    const result = await this.dispatchPlanTasks(user, id);
    if (!result.total) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '没有待执行的任务，请先拆解任务书或新增任务',
      );
    }
    await this.identity.audit(
      user.userId,
      'Workbuddy派发计划',
      `#${id} ${result.dispatched}/${result.total} 条已下发${
        result.failed ? `，${result.failed} 条失败` : ''
      }`,
    );
    return {
      dispatched: result.dispatched,
      failed: result.failed,
      plan: this.decoratePlan(result.plan),
      errors: result.errors,
    };
  }

  /**
   * 派发某个计划里待执行的任务：界面点「派发」与定时任务到点走同一段代码。
   * 没有待执行任务时只返回 total=0（调度器要把「这一轮没什么可跑」当成正常情况）。
   */
  private async dispatchPlanTasks(
    user: CurrentUser,
    planId: number,
  ): Promise<{
    total: number;
    dispatched: number;
    failed: number;
    errors: string[];
    plan: WorkbuddyPlan;
  }> {
    const tasks = await this.prisma.workbuddyTask.findMany({
      where: { planId, status: { in: ['pending', 'failed'] } },
      orderBy: { seq: 'asc' },
    });
    if (!tasks.length) {
      const plan = await this.prisma.workbuddyPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      return { total: 0, dispatched: 0, failed: 0, errors: [], plan };
    }
    const tokenCache = new Map<number, string>();
    const credsCache = new Map<number, WbCreds>();
    for (const task of tasks) {
      if (!credsCache.has(task.accountId)) {
        const { creds } = await this.accounts.credsOf(user, task.accountId);
        credsCache.set(task.accountId, creds);
        const { token } = await wbDescribeUserAccessToken(creds);
        tokenCache.set(task.accountId, token);
      }
    }
    // 条件抢单：只有还停在 pending/failed 的任务会被置成 running。
    // 双开界面或重复点「派发」时，第二次一条也抢不到，就不会把同一段活下发两遍。
    const claimed = await this.prisma.workbuddyTask.updateMany({
      where: {
        planId,
        id: { in: tasks.map((task) => task.id) },
        status: { in: ['pending', 'failed'] },
      },
      data: { status: 'running', startedAt: new Date(), lastError: '' },
    });
    if (!claimed.count) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '这些任务刚被另一次派发接走，请刷新后查看执行状态',
      );
    }
    const running = await this.prisma.workbuddyTask.findMany({
      where: { planId, id: { in: tasks.map((task) => task.id) } },
      orderBy: { seq: 'asc' },
    });
    const results = await Promise.allSettled(
      running.map((task) =>
        this.runTask(
          task,
          credsCache.get(task.accountId)!,
          tokenCache.get(task.accountId) || '',
        ),
      ),
    );
    const failed = results.filter((item) => item.status === 'rejected').length;
    const plan = await this.refreshPlanStatus(planId);
    return {
      total: running.length,
      dispatched: running.length - failed,
      failed,
      plan,
      errors: results
        .map((item, index) =>
          item.status === 'rejected'
            ? `第 ${running[index].seq} 步：${
                item.reason instanceof BusinessException
                  ? item.reason.message
                  : (item.reason as Error)?.message || '未知异常'
              }`
            : '',
        )
        .filter(Boolean),
    };
  }

  /**
   * 调度器调用：把到点的定时任务计划派发一轮。
   * 先推下一次执行时刻（或消费掉本次时间）再跑，避免一轮没跑完就被下一个 tick 重复接走；
   * 周期重复的每轮开始时把上一轮跑到终态的任务退回待执行，重新建会话下发。
   */
  async advanceScheduledPlans() {
    const now = new Date();
    const due = await this.prisma.workbuddyPlan.findMany({
      where: {
        kind: 'scheduled',
        scheduleType: { in: ['scheduled', 'recurring'] },
        scheduledAt: { lte: now },
        status: { notIn: ['cancelled'] },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });
    let dispatched = 0;
    for (const plan of due) {
      const nextAt =
        plan.scheduleType === 'recurring'
          ? computeNextOccurrence(scheduleConfigOf(plan.scheduleConfig), now)
          : null;
      await this.prisma.workbuddyPlan.update({
        where: { id: plan.id },
        data: { scheduledAt: nextAt },
      });
      const user = new CurrentUser(plan.createdBy, '', '');
      try {
        if (plan.scheduleType === 'recurring') {
          await this.requeueFinishedTasks(plan.id);
        }
        const result = await this.dispatchPlanTasks(user, plan.id);
        dispatched += result.dispatched;
        if (result.errors.length) {
          await this.identity.audit(
            plan.createdBy,
            'Workbuddy定时派发',
            `#${plan.id} ${plan.title}：${result.errors.join('；')}`,
          );
        }
      } catch (error) {
        const reason =
          error instanceof BusinessException
            ? error.message
            : (error as Error)?.message || '未知异常';
        await this.identity.audit(
          plan.createdBy,
          'Workbuddy定时派发失败',
          `#${plan.id} ${plan.title}：${reason}`,
        );
      }
    }
    return dispatched;
  }

  /**
   * 上一轮跑到终态的任务退回待执行：换会话重跑，所以清掉会话与 A2A 任务号。
   * 本地消息缓存按 (任务, 序号) 去重，新一轮的序号从 1 重新开始，
   * 不清掉上一轮就会被当成重复事件丢掉（腾讯云侧的原始记录不受影响）。
   */
  private async requeueFinishedTasks(planId: number) {
    const finished = await this.prisma.workbuddyTask.findMany({
      where: { planId, status: { in: TERMINAL_TASK } },
      select: { id: true },
    });
    if (!finished.length) return;
    const ids = finished.map((task) => task.id);
    await this.prisma.$transaction([
      this.prisma.workbuddyTaskEvent.deleteMany({
        where: { taskId: { in: ids } },
      }),
      this.prisma.workbuddyTask.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'pending',
          sessionId: '',
          endpoint: '',
          output: {},
          lastEventSeq: 0,
          lastError: '',
          startedAt: null,
          finishedAt: null,
        },
      }),
    ]);
  }

  /** 在已有会话里继续对话：任务跑完想追加要求时用，不再新建会话。 */
  async followUp(
    user: CurrentUser,
    taskId: number,
    body: Record<string, unknown>,
  ) {
    const task = await this.loadOwnedTask(user, taskId);
    if (!task.sessionId || !task.endpoint) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这条任务还没有会话，请先派发',
      );
    }
    const instruction = text(body.instruction).trim().slice(0, 8000);
    if (!instruction) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写要追加的内容');
    }
    const { creds } = await this.accounts.credsOf(user, task.accountId);
    const { token } = await wbDescribeUserAccessToken(creds);
    const pushed = await wbPushInstruction({
      endpoint: task.endpoint,
      token,
      sessionId: task.sessionId,
      instruction,
    });
    const saved = await this.applyPushResult(
      task.id,
      task.sessionId,
      pushed.payload,
    );
    await this.identity.audit(
      user.userId,
      'Workbuddy追加指令',
      `任务 #${task.id}`,
    );
    return this.decorateTask(saved);
  }

  /** 同步：先问 A2A 任务态，再把新消息事件按 (task, seq) 幂等落库。 */
  async sync(user: CurrentUser, id: number) {
    const plan = await this.loadOwnedPlan(user, id);
    const tasks = await this.prisma.workbuddyTask.findMany({
      where: { planId: id, sessionId: { not: '' } },
      orderBy: { seq: 'asc' },
    });
    if (!tasks.length) return { synced: 0, plan: this.decoratePlan(plan) };
    const tokenCache = new Map<number, string>();
    for (const task of tasks) {
      if (!tokenCache.has(task.accountId)) {
        const { creds } = await this.accounts.credsOf(user, task.accountId);
        const { token } = await wbDescribeUserAccessToken(creds);
        tokenCache.set(task.accountId, token);
      }
    }
    const results = await Promise.allSettled(
      tasks.map((task) =>
        this.syncTask(task, tokenCache.get(task.accountId) || ''),
      ),
    );
    const errors = results
      .map((item, index) =>
        item.status === 'rejected'
          ? `第 ${tasks[index].seq} 步：${
              item.reason instanceof BusinessException
                ? item.reason.message
                : (item.reason as Error)?.message || '未知异常'
            }`
          : '',
      )
      .filter(Boolean);
    const saved = await this.refreshPlanStatus(id);
    return {
      synced: results.filter((item) => item.status === 'fulfilled').length,
      errors,
      plan: this.decoratePlan(saved),
    };
  }

  async events(user: CurrentUser, taskId: number) {
    const task = await this.loadOwnedTask(user, taskId);
    const rows = await this.prisma.workbuddyTaskEvent.findMany({
      where: { taskId: task.id },
      orderBy: { seq: 'asc' },
      take: 500,
    });
    return { task: this.decorateTask(task), events: rows };
  }

  async cancelTask(user: CurrentUser, taskId: number) {
    const task = await this.loadOwnedTask(user, taskId);
    if (TERMINAL_TASK.includes(task.status)) return this.decorateTask(task);
    const remoteId = this.remoteTaskId(task);
    if (remoteId) {
      const { creds } = await this.accounts.credsOf(user, task.accountId);
      const { token } = await wbDescribeUserAccessToken(creds);
      await wbAgentTaskCancel({
        rpcUrl: task.endpoint,
        token,
        taskId: remoteId,
      });
    }
    const saved = await this.prisma.workbuddyTask.update({
      where: { id: taskId },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        lastError: '',
      },
    });
    await this.refreshPlanStatus(task.planId);
    await this.identity.audit(user.userId, 'Workbuddy取消任务', `#${taskId}`);
    return this.decorateTask(saved);
  }

  /** 派发一条任务：建会话 → 推指令 → 记下 A2A 任务号。 */
  private async runTask(
    task: {
      id: number;
      sessionId: string;
      endpoint: string;
      agentId: string;
      versionId: string;
      accountId: number;
      instruction: string;
    },
    creds: WbCreds,
    token: string,
  ) {
    let sessionId = task.sessionId;
    let endpoint = task.endpoint;
    if (!sessionId || !endpoint) {
      const session = await wbCreateAgentSession(creds, {
        agentId: task.agentId,
        versionId: task.versionId || undefined,
      });
      sessionId = String(session.SessionId || '');
      endpoint = String(session.EndpointSet?.[0]?.Url || '');
      if (!sessionId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '腾讯云没有返回会话 ID，Agent 可能没有可用的路由版本',
        );
      }
      if (!endpoint) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '腾讯云没有返回会话聊天接入点，暂时无法下发指令',
        );
      }
      await this.prisma.workbuddyTask.update({
        where: { id: task.id },
        data: {
          sessionId,
          endpoint,
          status: 'running',
          startedAt: new Date(),
          lastError: '',
        },
      });
    }
    try {
      const pushed = await wbPushInstruction({
        endpoint,
        token,
        sessionId,
        instruction: task.instruction,
      });
      return await this.applyPushResult(task.id, sessionId, pushed.payload);
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : (error as Error)?.message || '未知异常';
      await this.prisma.workbuddyTask.update({
        where: { id: task.id },
        data: { status: 'failed', lastError: shorten(message) },
      });
      throw error;
    }
  }

  /** A2A message/send 的回包要么是 Task（带 id/status.state），要么是直接回复的消息。 */
  private async applyPushResult(
    taskId: number,
    sessionId: string,
    payload: Record<string, unknown>,
  ) {
    const result =
      payload?.result && typeof payload.result === 'object'
        ? (payload.result as Record<string, unknown>)
        : {};
    const remoteId = text(result.id).trim();
    const state = text(
      (result.status as Record<string, unknown> | undefined)?.state,
    )
      .trim()
      .toLowerCase();
    const status = stateToTaskStatus(state) || 'running';
    return this.prisma.workbuddyTask.update({
      where: { id: taskId },
      data: {
        sessionId,
        status,
        ...(status === 'running' ? {} : { finishedAt: new Date() }),
        output: {
          a2aTaskId: remoteId || null,
          state: state || null,
          result,
        } as unknown as Prisma.InputJsonValue,
        lastError:
          status === 'failed' ? shorten(state || 'Agent 返回失败状态') : '',
      },
    });
  }

  private async syncTask(
    task: {
      id: number;
      agentId: string;
      sessionId: string;
      endpoint: string;
      accountId: number;
      lastEventSeq: number;
      output: Prisma.JsonValue;
    },
    token: string,
  ) {
    const remoteId = this.remoteTaskId(task);
    if (remoteId && task.endpoint) {
      const current = await wbAgentTaskGet({
        rpcUrl: task.endpoint,
        token,
        taskId: remoteId,
      });
      const result =
        current?.result && typeof current.result === 'object'
          ? (current.result as Record<string, unknown>)
          : {};
      const state = text(
        (result.status as Record<string, unknown> | undefined)?.state,
      )
        .trim()
        .toLowerCase();
      const status = stateToTaskStatus(state);
      if (status) {
        const output = {
          ...(task.output && typeof task.output === 'object'
            ? (task.output as Record<string, unknown>)
            : {}),
          state: state || null,
          result,
        };
        await this.prisma.workbuddyTask.update({
          where: { id: task.id },
          data: {
            status,
            output: output as unknown as Prisma.InputJsonValue,
            ...(status === 'running' ? {} : { finishedAt: new Date() }),
            lastError:
              status === 'failed' ? shorten(state || 'Agent 返回失败状态') : '',
          },
        });
      }
    }
    let ingested = 0;
    for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
      const response = await wbDescribeMessageEventList(
        await this.credsForTask(task.accountId),
        {
          sessionId: task.sessionId,
          agentId: task.agentId,
          offset: page * 100,
          limit: 100,
        },
      );
      const batch = Array.isArray(response.MessageEventSet)
        ? response.MessageEventSet
        : [];
      if (!batch.length) break;
      await this.saveEvents(task.id, batch, task.lastEventSeq);
      ingested += batch.length;
      const total = Number(response.TotalCount || 0);
      if (total && (page + 1) * 100 >= total) break;
      if (batch.length < 100) break;
    }
    return ingested;
  }

  private async saveEvents(
    taskId: number,
    batch: WbMessageEvent[],
    lastEventSeq: number,
  ) {
    const rows: Prisma.WorkbuddyTaskEventCreateManyInput[] = [];
    for (const event of batch) {
      const seq = Number(event.Sequence || 0);
      if (!seq || seq <= lastEventSeq) continue;
      const usage = event.Message?.TokenUsage || {};
      rows.push({
        taskId,
        seq,
        eventType: normalizeEventType(event.EventType),
        content: text(event.Message?.Content).slice(0, 20000),
        toolName: text(event.ToolCall?.ToolName).slice(0, 128),
        toolInput: text(event.ToolCall?.Input).slice(0, 20000),
        toolOutput: text(event.ToolCall?.Output).slice(0, 20000),
        tokenUsage: {
          input: Number(usage.InputTokens || 0),
          output: Number(usage.OutputTokens || 0),
          total: Number(usage.TotalTokens || 0),
        },
        occurredAt: parseTime(event.OccurredAt),
      });
    }
    if (!rows.length) return;
    await this.prisma.workbuddyTaskEvent.createMany({
      data: rows,
      skipDuplicates: true,
    });
    const maxSeq = Math.max(...rows.map((row) => row.seq));
    await this.prisma.workbuddyTask.updateMany({
      where: { id: taskId },
      data: { lastEventSeq: maxSeq },
    });
  }

  private async credsForTask(accountId: number) {
    const row = await this.prisma.workbuddyAccount.findUnique({
      where: { id: accountId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这条任务引用的 Workbuddy 凭据已被删除',
      );
    }
    return this.accounts.creds(row);
  }

  private remoteTaskId(task: { output: Prisma.JsonValue }) {
    if (!task.output || typeof task.output !== 'object') return '';
    return text((task.output as Record<string, unknown>).a2aTaskId).trim();
  }

  /**
   * 任务书步骤 → 任务行：多账号时按顺序轮流分配（并行加速，不是同一步重复下发），
   * 每条任务记下它属于哪一种新建方式，列表按它筛选。
   */
  private buildTaskRows(
    planId: number,
    user: CurrentUser,
    kind: string,
    spec: PlanSpec,
    targets: DispatchTarget[],
  ): Prisma.WorkbuddyTaskCreateManyInput[] {
    return spec.steps.map((step, index) => {
      const target = targets[index % targets.length];
      return {
        planId,
        createdBy: user.userId,
        kind,
        seq: index + 1,
        accountId: target.accountId,
        agentId: target.agentId,
        versionId: target.versionId,
        instruction: step.instruction,
        status: 'pending',
      };
    });
  }

  /** 派发目标：targets[] 支持多个账号并行分配步骤；只给 accountId/agentId 时按单账号处理。 */
  private async readTargets(user: CurrentUser, body: Record<string, unknown>) {
    const rawTargets = Array.isArray(body.targets) ? body.targets : [];
    if (rawTargets.length > MAX_DISPATCH_TARGETS) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `一次最多选 ${MAX_DISPATCH_TARGETS} 个 Workbuddy Enterprise 账号并行`,
      );
    }
    if (rawTargets.length) {
      const targets: DispatchTarget[] = [];
      for (const item of rawTargets) {
        targets.push(
          await this.readTarget(user, item as Record<string, unknown>),
        );
      }
      return targets;
    }
    if (body.accountId === undefined) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择用来执行任务的 Workbuddy Enterprise 账号与 Agent',
      );
    }
    return [await this.readTarget(user, body)];
  }

  private async readTarget(user: CurrentUser, body: Record<string, unknown>) {
    const accountId = requireId(
      body.accountId,
      '请选择 Workbuddy Enterprise 账号',
    );
    await this.accounts.credsOf(user, accountId);
    const agentId = text(body.agentId).trim();
    if (!agentId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择 Agent');
    }
    return {
      accountId,
      agentId: agentId.slice(0, 64),
      versionId: text(body.versionId).trim().slice(0, 64),
    };
  }

  /** 计划状态由任务状态收敛；没有任务时保持原状态。 */
  private async refreshPlanStatus(planId: number) {
    const tasks = await this.prisma.workbuddyTask.findMany({
      where: { planId },
      select: { status: true },
    });
    const plan = await this.prisma.workbuddyPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '计划不存在');
    }
    if (!tasks.length) return plan;
    const statuses = tasks.map((task) => task.status);
    let status = plan.status;
    let lastError = plan.lastError;
    if (statuses.some((item) => item === 'running')) status = 'running';
    else if (statuses.some((item) => item === 'pending')) status = 'ready';
    else if (statuses.every((item) => item === 'succeeded'))
      status = 'succeeded';
    else if (statuses.every((item) => item === 'cancelled'))
      status = 'cancelled';
    else if (statuses.some((item) => item === 'failed')) status = 'failed';
    if (status !== 'failed') lastError = '';
    return this.prisma.workbuddyPlan.update({
      where: { id: planId },
      data: { status, lastError },
    });
  }

  private async loadOwnedPlan(user: CurrentUser, id: number) {
    const row = await this.prisma.workbuddyPlan.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该计划不存在');
    }
    if (row.createdBy !== user.userId) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '该计划归他人所有');
    }
    return row;
  }

  private async loadOwnedTask(user: CurrentUser, id: number) {
    const row = await this.prisma.workbuddyTask.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该任务不存在');
    }
    if (row.createdBy !== user.userId) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '该任务归他人所有');
    }
    return row;
  }

  private decoratePlan(row: {
    id: number;
    createdBy: string;
    kind: string;
    title: string;
    rawInput: string;
    spec: Prisma.JsonValue;
    taskCount: number;
    strategy: string;
    accountIds: Prisma.JsonValue;
    scheduleType: string;
    scheduleConfig: Prisma.JsonValue;
    scheduledAt: Date | null;
    status: string;
    summary: string;
    lastError: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const spec: PlanSpec = normalizePlanSpec(row.spec);
    return {
      id: row.id,
      createdBy: row.createdBy,
      kind: row.kind,
      title: row.title,
      rawInput: row.rawInput,
      spec,
      stepCount: spec.steps.length,
      ready: specIsReady(spec),
      taskCount: row.taskCount,
      strategy: row.strategy,
      accountIds: idList(row.accountIds),
      scheduleType: row.scheduleType,
      scheduleConfig: scheduleConfigOf(row.scheduleConfig),
      scheduledAt: row.scheduledAt,
      status: row.status,
      summary: row.summary,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private decorateTask(row: {
    id: number;
    planId: number;
    kind: string;
    seq: number;
    accountId: number;
    agentId: string;
    versionId: string;
    sessionId: string;
    endpoint: string;
    instruction: string;
    status: string;
    lastEventSeq: number;
    output: Prisma.JsonValue;
    lastError: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      planId: row.planId,
      kind: row.kind,
      seq: row.seq,
      accountId: row.accountId,
      agentId: row.agentId,
      versionId: row.versionId,
      sessionId: row.sessionId,
      instruction: row.instruction,
      status: row.status,
      lastEventSeq: row.lastEventSeq,
      state: this.remoteState(row.output),
      lastError: row.lastError,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private remoteState(output: Prisma.JsonValue) {
    if (!output || typeof output !== 'object') return '';
    return text((output as Record<string, unknown>).state).trim();
  }
}

/** A2A 任务态 → 本地任务状态；working/submitted 继续算执行中，认不出的态不覆盖。 */
function stateToTaskStatus(
  state: string,
): 'running' | 'succeeded' | 'failed' | 'cancelled' | null {
  if (!state) return null;
  if (state === 'completed') return 'succeeded';
  if (state === 'failed' || state === 'rejected') return 'failed';
  if (state === 'canceled' || state === 'cancelled') return 'cancelled';
  return 'running';
}

function normalizeEventType(value: unknown) {
  const type = text(value).trim().toLowerCase();
  if (type === 'user' || type === 'tool' || type === 'assistant') return type;
  return 'assistant';
}

function parseTime(value: unknown) {
  const raw = text(value).trim();
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}
