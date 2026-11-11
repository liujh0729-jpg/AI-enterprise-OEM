import { EventEmitter } from 'node:events';
import type { WorkflowGraph, WorkflowNode } from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { fromJson, toJsonInput } from '../common/json-input';
import { httpRequest } from '../http/transport';
import { recordAiUsage } from '../ai/ai-gateway';
import type { PrismaService } from '../prisma/prisma.service';
import type { TaskCenterService } from '../task-center/task-center.service';
import { findOperation } from '../mcp/mcp-catalog';
import { actionForbiddenReason, builtinNodeOf } from './workflow-catalog';
import {
  compileGraph,
  resolveTemplates,
  type CompiledGraph,
} from './workflow-graph';
import type {
  AiUsage,
  NodeOutcome,
  RunContext,
  WorkflowBudgets,
  WorkflowRuntime,
  WorkflowUsage,
} from './workflow.types';

/** 运行事件：Playground 用它做步进高亮（SSE 转手给它）。 */
export type WorkflowRunEvent = {
  runId: number;
  type: 'run' | 'step';
  status: string;
  nodeId?: string;
  payload?: unknown;
};

type PersistedStep = {
  nodeId: string;
  status: string;
  output: unknown;
  branch: string;
};

const MAX_WAIT_SECONDS = 300;
/** 单次运行的节点并发上限：并行分支最多同时跑这么多，避免一次扇出打满上游。 */
const NODE_CONCURRENCY = Math.max(
  1,
  Number(process.env.WORKFLOW_NODE_CONCURRENCY ?? 4) || 4,
);
/** 节点超时默认值：动作 60s、AI 180s、Webhook 30s；显式配置封顶 10 分钟。 */
const DEFAULT_TIMEOUT_MS = 60_000;
const AI_TIMEOUT_MS = 180_000;
const WEBHOOK_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_RETRY_TIMES = 5;
const TERMINAL_RUN_STATUSES = new Set(['DONE', 'FAILED', 'CANCELED']);

/** 预算触顶项人话：运行详情与失败原因共用一份。 */
const BUDGET_STOP_LABELS: Record<string, string> = {
  NONE: '未触顶',
  TOKENS: 'AI 用量（token）',
  AI_CALLS: 'AI 调用次数',
  TOOL_CALLS: '工具调用次数',
  BROWSER_ACTIONS: '浏览器动作次数',
  LOOP_LIMIT: '节点执行次数（循环）',
};

/** 模型用量随步骤产出落库；下游模板取值只看业务产出，成本报表读 `__usage`。 */
function withUsage(output: unknown, usage: AiUsage | undefined): unknown {
  if (!usage) return output;
  const base =
    output && typeof output === 'object' && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : { result: output };
  return { ...base, __usage: usage };
}

/**
 * 执行引擎：把一张 DAG 走完。
 * 运行状态一律落 `WorkflowRun` / `WorkflowRunStep`，进程重启后可从已完成的步骤续跑；
 * 每个副作用步骤以 `runId + nodeId` 为幂等锚，重放不会重复执行已完成的节点。
 * 每步都以**运行发起人**身份调真实模块服务（动作节点走内部自执行器，工具节点走 Agent 工具派发），
 * 组织隔离 / 必填校验 / 审计全部沿用模块自身，工作流不另写一套权限。
 */
export class WorkflowEngine {
  private readonly bus = new EventEmitter();
  private runtime: WorkflowRuntime = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskCenterService,
  ) {
    this.bus.setMaxListeners(0);
  }

  /** 运行期能力由 `app.ts` 在服务装配完成后回填（与内置 MCP 同一套回填手法）。 */
  setRuntime(runtime: WorkflowRuntime) {
    this.runtime = { ...this.runtime, ...runtime };
  }

  subscribe(runId: number, listener: (event: WorkflowRunEvent) => void) {
    const handler = (event: WorkflowRunEvent) => listener(event);
    this.bus.on(`run:${runId}`, handler);
    return () => this.bus.off(`run:${runId}`, handler);
  }

  private publish(event: WorkflowRunEvent) {
    this.bus.emit(`run:${event.runId}`, event);
  }

  /** 外部改运行状态（取消）后广播一次，让 Playground 的 SSE 及时收流。 */
  announce(runId: number, status: string) {
    this.publish({ runId, type: 'run', status });
  }

  /** 启动（或续跑）一次运行；走到完成 / 等待 / 失败为止。 */
  async start(runId: number, actor: CurrentUser): Promise<void> {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
    });
    if (!run) return;
    // 已取消 / 已完结的运行不再推进：取消发生在排队阶段时靠这道闸收口。
    if (TERMINAL_RUN_STATUSES.has(run.status)) return;
    const version = await this.prisma.workflowVersion.findFirst({
      where: { workflowId: run.workflowId, version: run.version },
    });
    const graph = this.graphOf(version?.graph);
    const compiled = compileGraph(graph);
    if (!compiled.ok) {
      await this.finish(runId, 'FAILED', undefined, compiled.message);
      return;
    }
    const steps = await this.prisma.workflowRunStep.findMany({
      where: { runId },
    });
    const context: RunContext = {
      input: fromJson<Record<string, unknown>>(run.input) ?? {},
      vars: {},
      nodes: {},
      actor: { userId: actor.userId, username: actor.username },
    };
    const done = new Set<string>();
    const persisted: PersistedStep[] = [];
    for (const step of steps) {
      const output = fromJson<unknown>(step.output);
      if (step.status === 'DONE' || step.status === 'SKIPPED') {
        done.add(step.nodeId);
        context.nodes[step.nodeId] = output;
        persisted.push({
          nodeId: step.nodeId,
          status: step.status,
          output,
          branch: this.branchOf(output),
        });
      }
    }
    if (run.status !== 'RUNNING') {
      await this.prisma.workflowRun.update({
        where: { id: runId },
        data: { status: 'RUNNING', startedAt: run.startedAt ?? new Date() },
      });
      this.publish({ runId, type: 'run', status: 'RUNNING' });
    }
    await this.drive(
      runId,
      compiled.compiled,
      context,
      done,
      persisted,
      actor,
      this.budgetsOf(run.budgets),
    );
  }

  /** 任务源回调入口：按幂等锚找到任务并按任务编号唤醒。 */
  async resumeByDedupKey(dedupKey: string, note: string): Promise<void> {
    const row = await this.prisma.myTask.findUnique({ where: { dedupKey } });
    if (row) await this.resumeFromTask(row.id, note);
  }

  /** 「我的任务」被关闭后的唤醒入口：找到该运行里等它的那一步，置完成并续跑。 */
  async resumeFromTask(taskId: number, note: string): Promise<void> {
    const task = await this.prisma.myTask.findUnique({ where: { id: taskId } });
    if (!task || task.source !== 'workflow') return;
    const [rawRunId, anchorNode] = task.sourceId.split(':');
    const runId = Number(rawRunId);
    if (!Number.isInteger(runId) || runId <= 0) return;
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
    });
    if (!run || run.status !== 'WAITING') return;
    const steps = await this.prisma.workflowRunStep.findMany({
      where: { runId, status: 'WAITING' },
    });
    // 等待锚点写在步骤产出里（saveStep 把 waitFor.anchor 合并进 output），恢复侧必须读同一字段；
    // 任务编号（taskId）是兜底锚，兼容表单任务按节点自身 id 作锚的场景（§四：读写一致）。
    const waiting = steps.find((step) => {
      const output = fromJson<Record<string, unknown>>(step.output) as Record<
        string,
        unknown
      > | null;
      if (!output) return false;
      return output.anchor === anchorNode || Number(output.taskId) === taskId;
    });
    if (!waiting) return;
    // 表单任务：把提交的结构化结果一并写进步骤产出，下游可用 nodes.<id>.form.<key>。
    const form = fromJson<Record<string, string> | null>(task.formData);
    await this.prisma.workflowRunStep.update({
      where: { id: waiting.id },
      data: {
        status: 'DONE',
        output: toJsonInput({
          taskId,
          closed: true,
          closeNote: note,
          ...(form ? { form } : {}),
        }),
        finishedAt: new Date(),
      },
    });
    this.publish({
      runId,
      type: 'step',
      status: 'DONE',
      nodeId: waiting.nodeId,
    });
    // 续跑用运行发起人身份；与后台重入（bi / community 的 `new CurrentUser(id, id, '')`）同口径。
    await this.start(runId, new CurrentUser(run.actorId, run.actorId, ''));
  }

  // ---------------------------------------------------------------- 驱动

  private async drive(
    runId: number,
    compiled: CompiledGraph,
    context: RunContext,
    done: Set<string>,
    persisted: PersistedStep[],
    actor: CurrentUser,
    budgets: WorkflowBudgets,
  ): Promise<void> {
    const indegree = new Map<string, number>();
    const remaining = new Map<string, number>();
    const skippedIn = new Map<string, number>();
    for (const id of compiled.nodes.keys()) {
      const degree = compiled.incoming.get(id)?.length ?? 0;
      indegree.set(id, degree);
      remaining.set(id, degree);
      skippedIn.set(id, 0);
    }

    const apply = (
      nodeId: string,
      taken: Set<string> | null,
      enqueue: boolean,
      queue: string[],
      queued: Set<string>,
    ) => {
      for (const edge of compiled.outgoing.get(nodeId) ?? []) {
        const target = edge.target;
        remaining.set(target, Math.max(0, (remaining.get(target) ?? 1) - 1));
        if (taken !== null && !taken.has(edge.sourceHandle)) {
          skippedIn.set(target, (skippedIn.get(target) ?? 0) + 1);
        }
        if (
          enqueue &&
          (remaining.get(target) ?? 0) === 0 &&
          !done.has(target) &&
          !queued.has(target)
        ) {
          queued.add(target);
          queue.push(target);
        }
      }
    };

    // 阶段一：把已落库的节点当作已处理，重建各节点的待办入度。
    for (const step of persisted) {
      const taken =
        step.status === 'SKIPPED'
          ? new Set<string>()
          : step.branch
            ? new Set<string>([step.branch])
            : null;
      apply(step.nodeId, taken, false, [], new Set());
    }

    // 阶段二：入度为 0 的节点就是入口。
    const queue: string[] = [];
    const queued = new Set<string>();
    for (const id of compiled.nodes.keys()) {
      if (!done.has(id) && (remaining.get(id) ?? 0) === 0) {
        queued.add(id);
        queue.push(id);
      }
    }

    let runError = '';
    while (queue.length) {
      // 取消：运行行被置 CANCELED 后不再开新节点；上一波已收尾的步骤照常落库。
      if (await this.canceled(runId)) return;
      // 一波 = 当前就绪的若干个节点：并发跑、各自读同一份上下文快照，
      // 落库与出边推进统一在本波结束后做，避免同波节点互相看到半成品产出。
      const wave: string[] = [];
      while (queue.length && wave.length < NODE_CONCURRENCY) {
        const id = queue.shift()!;
        queued.delete(id);
        if (!done.has(id)) wave.push(id);
      }
      if (!wave.length) break;
      const meter = await this.openMeter(runId, budgets);
      const results = await Promise.all(
        wave.map(async (nodeId) => {
          const node = compiled.nodes.get(nodeId)!;
          if (
            (indegree.get(nodeId) ?? 0) > 0 &&
            (skippedIn.get(nodeId) ?? 0) >= (indegree.get(nodeId) ?? 0)
          ) {
            // 所有入边都没走到：本节点及其下游整体跳过。
            return {
              node,
              outcome: {
                status: 'SKIPPED' as const,
                output: { reason: '上游分支未走到' },
              },
              durationMs: 0,
            };
          }
          const snapshot: RunContext = {
            input: context.input,
            vars: { ...context.vars },
            nodes: { ...context.nodes },
            actor: context.actor,
          };
          const started = Date.now();
          const outcome = await meter.reserve(node, () =>
            this.runWithPolicy(node, snapshot, actor, runId, compiled),
          );
          return { node, outcome, durationMs: Date.now() - started };
        }),
      );

      await meter.settle();
      let waiting = false;
      for (const { node, outcome, durationMs } of results) {
        // AI 节点的费用归到本次运行：节点标量落步骤产出，同一笔同时进 usage_events 供成本报表。
        if (outcome.usage?.call) {
          await recordAiUsage(actor.userId, outcome.usage, {
            module: 'workflow',
            operation: node.kind,
            model: '',
          }).catch(() => undefined);
        }
        await this.saveStep(
          runId,
          node,
          outcome.status,
          withUsage(outcome.output, outcome.usage),
          outcome.error,
          outcome.waitFor,
          outcome.attempts,
          durationMs,
        );
        this.publish({
          runId,
          type: 'step',
          status: outcome.status,
          nodeId: node.id,
          payload: outcome.output,
        });
        if (outcome.status === 'FAILED' || outcome.status === 'TIMEOUT') {
          runError = outcome.error || '节点执行失败';
          continue;
        }
        if (outcome.status === 'WAITING') {
          waiting = true;
          continue;
        }
        done.add(node.id);
        if (outcome.status === 'DONE') {
          context.nodes[node.id] = outcome.output;
          // 变量节点写进本波快照的 vars，这里提升回共享上下文供后续节点取值。
          if (node.kind === 'logic.variable') {
            const output = outcome.output as {
              name?: unknown;
              value?: unknown;
            } | null;
            if (output && typeof output.name === 'string') {
              context.vars[output.name] = output.value;
            }
          }
        }
        const taken =
          outcome.status === 'SKIPPED'
            ? new Set<string>()
            : outcome.branches
              ? new Set(outcome.branches)
              : null;
        apply(node.id, taken, true, queue, queued);
      }
      // token 只有跑完才知道用量：本波已把累计推到上限时，下一波开门就被判停，
      // 这里用开波时的触顶原因做准入，保证运行行落 FAILED + budgetStop 而不再多发请求。
      const stop = meter.blocked || meter.pending;
      if (stop) {
        runError = this.budgetErrorMessage(stop, budgets);
        break;
      }
      if (waiting) {
        await this.prisma.workflowRun.update({
          where: { id: runId },
          data: { status: 'WAITING' },
        });
        this.publish({ runId, type: 'run', status: 'WAITING' });
        return;
      }
    }

    if (runError) {
      await this.finish(runId, 'FAILED', undefined, runError);
      return;
    }
    // 收尾前再确认一次：取消与完成撞车时以取消为准。
    if (await this.canceled(runId)) return;
    await this.finish(runId, 'DONE', this.finalOutput(compiled, context));
  }

  private async canceled(runId: number): Promise<boolean> {
    const row = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    return row?.status === 'CANCELED';
  }

  private async finish(
    runId: number,
    status: 'DONE' | 'FAILED',
    output: unknown,
    error = '',
  ) {
    // 取消优先：用户取消后，正在收尾的这轮不再把状态改回「已完成」。
    if (await this.canceled(runId)) return;
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status,
        ...(output === undefined ? {} : { output: toJsonInput(output) }),
        error: error.slice(0, 500),
        finishedAt: new Date(),
      },
    });
    this.publish({ runId, type: 'run', status, payload: output });
  }

  /** 终态产出：所有出口节点（无出边）的产出合并。 */
  private finalOutput(compiled: CompiledGraph, context: RunContext) {
    const out: Record<string, unknown> = {};
    for (const id of compiled.nodes.keys()) {
      if ((compiled.outgoing.get(id)?.length ?? 0) === 0) {
        out[id] = context.nodes[id] ?? null;
      }
    }
    return out;
  }

  private branchOf(output: unknown): string {
    if (output && typeof output === 'object') {
      const branch = (output as Record<string, unknown>).__branch;
      if (typeof branch === 'string') return branch;
    }
    return '';
  }

  private graphOf(raw: unknown): WorkflowGraph {
    const parsed = fromJson<Partial<WorkflowGraph>>(raw) ?? {};
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  }

  // ---------------------------------------------------------------- 节点执行

  /**
   * 节点执行策略：超时 + 重试。
   * 重试只作用于失败节点，写动作节点永不自动重试（决策 D6：写副作用不能靠重放兜底）。
   */
  private async runWithPolicy(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
    runId: number,
    compiled: CompiledGraph,
  ): Promise<NodeOutcome> {
    const retry = this.retryOf(node);
    const timeoutMs = this.timeoutOf(node);
    const canRetry = retry.times > 0 && this.retryable(node);
    let attempts = 0;
    let outcome: NodeOutcome = { status: 'FAILED', error: '节点未执行' };
    for (;;) {
      attempts += 1;
      outcome = await this.withTimeout(node, timeoutMs, () =>
        this.runNode(node, context, actor, runId, compiled),
      );
      const failed =
        outcome.status === 'FAILED' || outcome.status === 'TIMEOUT';
      if (!failed || !canRetry || attempts > retry.times) {
        return { ...outcome, attempts };
      }
      if (retry.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retry.backoffMs));
      }
    }
  }

  private retryOf(node: WorkflowNode) {
    const raw = this.config(node).retry;
    const retry =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const times = Math.min(
      Math.max(0, Math.floor(Number(retry.times ?? 0)) || 0),
      MAX_RETRY_TIMES,
    );
    const backoffMs = Math.min(
      Math.max(0, Math.floor(Number(retry.backoffMs ?? 1000)) || 0),
      30_000,
    );
    return { times, backoffMs };
  }

  private timeoutOf(node: WorkflowNode): number {
    const configured = Number(this.config(node).timeoutMs ?? 0);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(configured, MAX_TIMEOUT_MS);
    }
    if (node.type === 'ai') return AI_TIMEOUT_MS;
    if (node.kind === 'integration.webhook') return WEBHOOK_TIMEOUT_MS;
    if (node.type === 'action' || node.type === 'integration') {
      return DEFAULT_TIMEOUT_MS;
    }
    return 0;
  }

  /**
   * 重试范围：配置 retryable=false 的一律不重试；
   * 写动作（契约写端点）与工具 / 人工节点也不重试——它们的副作用不完全幂等。
   */
  private retryable(node: WorkflowNode): boolean {
    const config = this.config(node);
    if (config.retryable === false) return false;
    if (node.type === 'human') return false;
    if (node.type === 'action') {
      const operation = findOperation(node.operationId || node.kind);
      return operation !== undefined && !operation.write;
    }
    // 非内置 kind ＝ Agent 工具（连接器 / 硬件），写读无法可靠判定，按写处理。
    if (!builtinNodeOf(node.kind)) return false;
    return (
      node.type === 'ai' ||
      node.type === 'logic' ||
      node.type === 'trigger' ||
      node.kind === 'integration.webhook'
    );
  }

  /** 超时只约束外层等待，不中断已在途的请求（取消能力取决于各出口自身）。 */
  private async withTimeout(
    node: WorkflowNode,
    timeoutMs: number,
    run: () => Promise<NodeOutcome>,
  ): Promise<NodeOutcome> {
    if (!timeoutMs) return run();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<NodeOutcome>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            status: 'TIMEOUT',
            error: `节点执行超时（${Math.round(timeoutMs / 1000)} 秒，节点 ${node.id}）`,
          }),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([run(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async runNode(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
    runId: number,
    compiled: CompiledGraph,
  ): Promise<NodeOutcome> {
    try {
      if (node.type === 'action') {
        return await this.runAction(node, context, actor, runId);
      }
      const seed = builtinNodeOf(node.kind);
      if (!seed) {
        // 非内置：按 Agent 工具派发（连接器 / 硬件）。
        return await this.runTool(node, context, actor);
      }
      switch (node.kind) {
        case 'trigger.manual':
        case 'trigger.schedule':
        case 'trigger.event':
        case 'trigger.task':
          return {
            status: 'DONE',
            output: { trigger: node.kind, input: context.input },
          };
        case 'logic.condition':
          return this.runCondition(node, context);
        case 'logic.parallel':
          return { status: 'DONE', output: { parallel: true } };
        case 'logic.merge':
          return this.runMerge(node, context, compiled);
        case 'logic.wait':
          return await this.runWait(node);
        case 'logic.variable':
          return this.runVariable(node, context);
        case 'ai.llm':
          return await this.runLlm(node, context, actor);
        case 'ai.retrieve':
          return await this.runRetrieve(node, context, actor);
        case 'ai.agent':
          return await this.runSubWorkflow(node, context, actor);
        case 'human.assign_task':
          return await this.runAssignTask(node, context, actor, runId);
        case 'human.wait_task':
          return await this.runWaitTask(node, context);
        case 'human.form':
          return await this.runForm(node, context, actor, runId);
        case 'integration.webhook':
          return await this.runWebhook(node, context);
        default:
          return { status: 'FAILED', error: `不支持的节点：${node.kind}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '节点执行失败';
      return { status: 'FAILED', error: message.slice(0, 500) };
    }
  }

  private config(node: WorkflowNode): Record<string, unknown> {
    return node.config ?? {};
  }

  private resolve(value: unknown, context: RunContext): unknown {
    return resolveTemplates(value, context);
  }

  /** 系统动作节点：以运行发起人身份走内部自执行器（与浏览器同一张路由表、同一份校验）。 */
  private async runAction(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
    runId: number,
  ): Promise<NodeOutcome> {
    const operationId = node.operationId || node.kind;
    const forbidden = actionForbiddenReason(operationId);
    if (forbidden) {
      return {
        status: 'FAILED',
        error: `该动作在权限红线上，工作流不能代为执行：${forbidden}`,
      };
    }
    const operation = findOperation(operationId);
    if (!operation)
      return { status: 'FAILED', error: `未知的系统动作：${operationId}` };
    if (!this.runtime.runOperation) {
      return { status: 'FAILED', error: '执行器尚未就绪' };
    }
    const params = (this.resolve(node.params, context) ?? {}) as Record<
      string,
      unknown
    >;
    const pathParams = (this.resolve(this.config(node).pathParams, context) ??
      {}) as Record<string, string | number>;
    const result = await this.runtime.runOperation(
      actor,
      `wf-${runId}-${node.id}`,
      operationId,
      operation.hasBody
        ? { pathParams, body: params }
        : { pathParams, query: params },
    );
    const failed =
      result.status >= 400 ||
      (typeof result.code === 'number' && result.code !== 0);
    if (failed && this.config(node).allowFailure !== true) {
      return {
        status: 'FAILED',
        error: result.message || `动作返回 HTTP ${result.status}`,
      };
    }
    return { status: 'DONE', output: result.data ?? result };
  }

  /** 集成节点：连接器 / 硬件工具，走 Agent 的统一工具派发。 */
  private async runTool(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
  ): Promise<NodeOutcome> {
    if (!this.runtime.callTool) {
      return { status: 'FAILED', error: '工具派发尚未就绪' };
    }
    const args = (this.resolve(node.params, context) ?? {}) as Record<
      string,
      unknown
    >;
    const result = await this.runtime.callTool(actor, node.kind, args);
    if (!result.ok && this.config(node).allowFailure !== true) {
      return { status: 'FAILED', error: result.text || '工具执行失败' };
    }
    return { status: 'DONE', output: { text: result.text } };
  }

  private runCondition(node: WorkflowNode, context: RunContext): NodeOutcome {
    const config = this.config(node);
    const left = this.resolve(`{{${str(config.path)}}}`, context);
    const right = config.value;
    const operator = str(config.operator, 'eq');
    const passed = compare(left, right, operator);
    return {
      status: 'DONE',
      output: {
        passed,
        path: config.path ?? '',
        operator,
        expected: right,
        __branch: passed ? 'true' : 'false',
      },
      branches: [passed ? 'true' : 'false'],
    };
  }

  private runMerge(
    node: WorkflowNode,
    context: RunContext,
    compiled: CompiledGraph,
  ): NodeOutcome {
    const inputs: unknown[] = [];
    for (const edge of compiled.incoming.get(node.id) ?? []) {
      inputs.push(context.nodes[edge.source] ?? null);
    }
    return { status: 'DONE', output: { merged: inputs } };
  }

  private async runWait(node: WorkflowNode): Promise<NodeOutcome> {
    const seconds = Math.min(
      Math.max(0, Number(this.config(node).seconds ?? 0) || 0),
      MAX_WAIT_SECONDS,
    );
    if (seconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
    return { status: 'DONE', output: { waitedSeconds: seconds } };
  }

  private runVariable(node: WorkflowNode, context: RunContext): NodeOutcome {
    const config = this.config(node);
    const name = str(config.name).trim();
    if (!name) return { status: 'FAILED', error: '变量赋值节点缺少变量名' };
    const value = this.resolve(config.value, context);
    context.vars[name] = value;
    return { status: 'DONE', output: { name, value } };
  }

  private async runLlm(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
  ): Promise<NodeOutcome> {
    if (!this.runtime.chat)
      return { status: 'FAILED', error: 'AI 网关尚未就绪' };
    const config = this.config(node);
    const prompt = textOf(this.resolve(config.prompt, context)).trim();
    if (!prompt) return { status: 'FAILED', error: '大模型调用节点缺少提示词' };
    const system = textOf(this.resolve(config.system, context)).trim();
    const messages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ];
    const answer = await this.runtime.chat(actor, messages);
    return {
      status: 'DONE',
      output: { text: answer.text },
      usage: answer.usage,
    };
  }

  private async runRetrieve(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
  ): Promise<NodeOutcome> {
    if (!this.runtime.retrieve)
      return { status: 'FAILED', error: '检索出口尚未就绪' };
    const config = this.config(node);
    const query = textOf(this.resolve(config.query, context)).trim();
    if (!query) return { status: 'FAILED', error: '知识库检索节点缺少检索词' };
    const result = await this.runtime.retrieve(actor, {
      query,
      topK: Number(config.topK ?? 6) || 6,
    });
    return { status: 'DONE', output: result };
  }

  private async runSubWorkflow(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
  ): Promise<NodeOutcome> {
    const config = this.config(node);
    const mode = str(config.mode, 'workflow');
    if (mode === 'agent') {
      if (!this.runtime.runAgent)
        return { status: 'FAILED', error: 'Agent 出口尚未就绪' };
      const prompt = textOf(this.resolve(config.prompt, context)).trim();
      if (!prompt) return { status: 'FAILED', error: 'Agent 节点缺少任务描述' };
      const text = await this.runtime.runAgent(actor, prompt);
      return { status: 'DONE', output: { text: text.text }, usage: text.usage };
    }
    const childId = Number(config.workflowId ?? 0);
    if (!Number.isInteger(childId) || childId <= 0) {
      return { status: 'FAILED', error: '子工作流节点缺少目标工作流编号' };
    }
    const child = await this.prisma.workflow.findUnique({
      where: { id: childId },
    });
    if (!child || child.status !== 'PUBLISHED') {
      return { status: 'FAILED', error: '目标工作流未发布或不存在' };
    }
    // 共享工作流只读可用（可被引用运行）；私有的只有本人能跑。
    if (child.ownerUserId !== actor.userId && child.scope === 'PRIVATE') {
      return { status: 'FAILED', error: '无权运行该私有工作流' };
    }
    const childRun = await this.prisma.workflowRun.create({
      data: {
        workflowId: child.id,
        version: child.version,
        trigger: 'AGENT',
        status: 'PENDING',
        input: toJsonInput(
          (this.resolve(config.input, context) ?? {}) as Record<
            string,
            unknown
          >,
        ),
        actorId: actor.userId,
        budgets: toJsonInput(this.budgetsOf(child.budgets)),
      },
    });
    await this.start(childRun.id, actor);
    const finished = await this.prisma.workflowRun.findUnique({
      where: { id: childRun.id },
    });
    if (!finished || finished.status !== 'DONE') {
      return {
        status: 'FAILED',
        error: `子工作流未成功完成（${finished?.status ?? 'unknown'}）：${finished?.error || ''}`,
      };
    }
    return { status: 'DONE', output: fromJson<unknown>(finished.output) };
  }

  private async runAssignTask(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
    runId: number,
  ): Promise<NodeOutcome> {
    const config = this.config(node);
    const assignee = textOf(this.resolve(config.assignee, context)).trim();
    const title = textOf(this.resolve(config.title, context)).trim();
    if (!assignee) return { status: 'FAILED', error: '分配任务节点缺少收件人' };
    if (!title) return { status: 'FAILED', error: '分配任务节点缺少标题' };
    const sourceId = `${runId}:${node.id}`;
    const row = await this.tasks.assign({
      assigneeUserId: assignee,
      source: 'workflow',
      sourceId,
      title,
      description: textOf(this.resolve(config.description, context)),
      link: textOf(this.resolve(config.link, context)) || '/tasks',
      category: str(config.category, 'task'),
      priority: str(config.priority, 'NORMAL'),
      createdBy: actor.userId,
      dueAt: this.dueAtOf(config.dueDays),
      sourceStatus: 'WAITING',
      sourceStatusLabel: '等待处理',
    });
    return {
      status: 'DONE',
      output: {
        taskId: row.id,
        dedupKey: row.dedupKey,
        assignee,
      },
    };
  }

  private async runWaitTask(
    node: WorkflowNode,
    context: RunContext,
  ): Promise<NodeOutcome> {
    const anchor = this.assignAnchorOf(node, context);
    if (!anchor)
      return {
        status: 'FAILED',
        error: '等待任务完成节点找不到上游的分配任务',
      };
    const produced = (context.nodes[anchor] ?? {}) as Record<string, unknown>;
    const taskId = Number(produced.taskId ?? 0);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return { status: 'FAILED', error: '上游分配任务没有产出任务编号' };
    }
    const task = await this.prisma.myTask.findUnique({ where: { id: taskId } });
    if (!task) return { status: 'FAILED', error: '等待的任务不存在' };
    const terminal = ['DONE', 'CANCELED', 'EXPIRED'].includes(task.status);
    if (terminal) {
      return {
        status: 'DONE',
        output: { taskId, closed: true, closeNote: task.closeNote },
      };
    }
    return {
      status: 'WAITING',
      output: { waiting: true, taskId },
      waitFor: { kind: 'myTask', taskId, dedupKey: task.dedupKey, anchor },
    };
  }

  private async runForm(
    node: WorkflowNode,
    context: RunContext,
    actor: CurrentUser,
    runId: number,
  ): Promise<NodeOutcome> {
    const config = this.config(node);
    const assignee = textOf(this.resolve(config.assignee, context)).trim();
    const title = textOf(this.resolve(config.title, context)).trim();
    if (!assignee) return { status: 'FAILED', error: '表单填写节点缺少收件人' };
    if (!title) return { status: 'FAILED', error: '表单填写节点缺少标题' };
    const fields = (Array.isArray(config.fields) ? config.fields : [])
      .map((field) => {
        const item = (field ?? {}) as Record<string, unknown>;
        const key = textOf(item.key).trim().slice(0, 64);
        const label = (textOf(item.label) || key).trim().slice(0, 80);
        return { key, label, required: item.required === true };
      })
      .filter((field) => field.key && field.label);
    if (!fields.length) {
      return { status: 'FAILED', error: '表单填写节点缺少字段定义' };
    }
    const sourceId = `${runId}:${node.id}`;
    const row = await this.tasks.assign({
      assigneeUserId: assignee,
      source: 'workflow',
      sourceId,
      title: `请填写：${title}`,
      description: fields
        .map((field) => `${field.label}${field.required ? '（必填）' : ''}`)
        .join('\n'),
      formSchema: { title, fields },
      link: '/tasks',
      category: 'matter',
      priority: 'NORMAL',
      createdBy: actor.userId,
      sourceStatus: 'WAITING',
      sourceStatusLabel: '待填写',
    });
    return {
      status: 'WAITING',
      output: { waiting: true, taskId: row.id, formTitle: title },
      waitFor: {
        kind: 'myTask',
        taskId: row.id,
        dedupKey: row.dedupKey,
        anchor: node.id,
      },
    };
  }

  private async runWebhook(
    node: WorkflowNode,
    context: RunContext,
  ): Promise<NodeOutcome> {
    const config = this.config(node);
    const url = textOf(this.resolve(config.url, context)).trim();
    if (!/^https?:\/\//i.test(url)) {
      return { status: 'FAILED', error: 'Webhook 地址必须是 http(s) 开头' };
    }
    const method = str(config.method, 'POST').toUpperCase();
    const headers = (this.resolve(config.headers, context) ?? {}) as Record<
      string,
      string
    >;
    const body = this.resolve(config.body, context);
    const response = await httpRequest<string>(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(method === 'GET' || body === undefined
        ? {}
        : { body: JSON.stringify(body) }),
      readAs: 'text',
      timeoutMs: 10_000,
      operation: 'workflow.webhook',
    });
    const text = response.data ?? '';
    if (!response.ok && this.config(node).allowFailure !== true) {
      return {
        status: 'FAILED',
        error: `Webhook 返回 HTTP ${response.status}`,
      };
    }
    return {
      status: 'DONE',
      output: { status: response.status, text: text.slice(0, 4000) },
    };
  }

  // ---------------------------------------------------------------- 持久化助手

  private async saveStep(
    runId: number,
    node: WorkflowNode,
    status: string,
    output?: unknown,
    error?: string,
    waitFor?: NodeOutcome['waitFor'],
    attempts?: number,
    durationMs?: number,
  ) {
    const now = new Date();
    const elapsed = Math.max(0, Math.round(durationMs ?? 0));
    const payload = {
      status,
      output: toJsonInput(
        waitFor
          ? {
              ...((output ?? {}) as Record<string, unknown>),
              anchor: waitFor.anchor,
            }
          : (output ?? {}),
      ),
      error: (error ?? '').slice(0, 500),
      durationMs: elapsed,
      finishedAt: now,
    };
    const existing = await this.prisma.workflowRunStep.findFirst({
      where: { runId, nodeId: node.id },
    });
    if (existing) {
      await this.prisma.workflowRunStep.update({
        where: { id: existing.id },
        data: {
          ...payload,
          attempts: Math.max(existing.attempts + 1, attempts ?? 1),
        },
      });
      return;
    }
    await this.prisma.workflowRunStep.create({
      data: {
        runId,
        nodeId: node.id,
        nodeType: node.type.slice(0, 32),
        attempts: Math.max(1, attempts ?? 1),
        startedAt: new Date(now.getTime() - elapsed),
        ...payload,
      },
    });
  }

  private assignAnchorOf(node: WorkflowNode, context: RunContext): string {
    const configured = textOf(this.config(node).node).trim();
    if (configured) return configured;
    const candidates = Object.keys(context.nodes).filter((id) => {
      const value = context.nodes[id];
      return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).taskId === 'number'
      );
    });
    return candidates.length ? candidates[candidates.length - 1] : '';
  }

  private dueAtOf(days: unknown): Date | null {
    const count = Number(days ?? 0);
    if (!Number.isFinite(count) || count <= 0) return null;
    return new Date(Date.now() + count * 86_400_000);
  }

  // ---------------------------------------------------------------- 执行预算

  /** 预算快照：运行行未带（旧数据）时按默认口径补齐，避免 undefined 穿透比较。 */
  budgetsOf(raw: unknown): WorkflowBudgets {
    const source =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const pick = (key: keyof WorkflowBudgets) => {
      const value = Math.floor(Number(source[key] ?? 0));
      return Number.isFinite(value) && value > 0 ? value : 0;
    };
    return {
      maxAiCalls: pick('maxAiCalls'),
      maxTokens: pick('maxTokens'),
      maxToolCalls: pick('maxToolCalls'),
      maxBrowserActions: pick('maxBrowserActions'),
      maxNodes: pick('maxNodes'),
    };
  }

  usageOf(raw: unknown): WorkflowUsage {
    const source =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const num = (key: keyof WorkflowUsage) => {
      const value = Number(source[key] ?? 0);
      return Number.isFinite(value) && value > 0 ? value : 0;
    };
    return {
      nodes: num('nodes'),
      aiCalls: num('aiCalls'),
      tokenIn: num('tokenIn'),
      tokenOut: num('tokenOut'),
      toolCalls: num('toolCalls'),
      browserActions: num('browserActions'),
    };
  }

  /**
   * 预算闸：开一波前读一次已耗用量，生成这波的「预留器」。
   * 每个节点执行前同时占用节点/调用/动作配额，同波节点不会因为并发而一起越过上限；
   * token 只能事后根据模型回传的用量落账，因此在同一波内共享一份 token 桶，
   * 并发节点全停下后再统一把这一波的发生额记到运行行上。
   */
  private async openMeter(
    runId: number,
    budget: WorkflowBudgets,
  ): Promise<{
    blocked: string;
    pending: string;
    reserve: (
      node: WorkflowNode,
      run: () => Promise<NodeOutcome>,
    ) => Promise<NodeOutcome>;
    settle: () => Promise<void>;
  }> {
    const row = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { usage: true },
    });
    const before = this.usageOf(row?.usage);
    const reserved: WorkflowUsage = { ...before };
    // 开波时就已经累计到上限（token 只能同波事后记账）：本波一个节点都不开跑。
    let pending = this.overBudget(budget, reserved, reserved);
    let blocked = '';
    const reserve = async (
      node: WorkflowNode,
      run: () => Promise<NodeOutcome>,
    ): Promise<NodeOutcome> => {
      const stop = this.reserveOf(budget, before, reserved, node);
      if (stop) {
        blocked ||= stop;
        return { status: 'SKIPPED', output: { reason: '超预算跳过' } };
      }
      reserved.nodes += 1;
      if (node.type === 'ai') reserved.aiCalls = Math.max(1, reserved.aiCalls + 1);
      if (node.type === 'action' || node.type === 'integration') {
        reserved.toolCalls += Math.max(1, this.retryOf(node).times + 1);
      }
      if (this.browserActionOf(node)) reserved.browserActions += 1;
      const outcome = await run();
      reserved.tokenIn += outcome.usage?.tokenIn ?? 0;
      reserved.tokenOut += outcome.usage?.tokenOut ?? 0;
      return outcome;
    };
    const settle = async () => {
      await this.chargeUsage(runId, {
        nodes: reserved.nodes - before.nodes,
        aiCalls: reserved.aiCalls - before.aiCalls,
        tokenIn: reserved.tokenIn - before.tokenIn,
        tokenOut: reserved.tokenOut - before.tokenOut,
        toolCalls: reserved.toolCalls - before.toolCalls,
        browserActions: reserved.browserActions - before.browserActions,
      });
      // token 是事后才知道的：本波跑完后按实际累计再判一次，同波多跑出去的用量照实计入。
      blocked ||= pending || this.overBudget(budget, reserved, reserved);
      if (blocked) {
        await this.prisma.workflowRun.update({
          where: { id: runId },
          data: { budgetStop: blocked },
        });
      }
    };
    // blocked 是 let：必须用 getter 暴露实时值，否则 wave 末尾读到的永远是开波时的空串。
    return {
      get blocked() {
        return blocked;
      },
      get pending() {
        return pending;
      },
      reserve,
      settle,
    };
  }

  /**
   * 节点级预检：执行前把这一节点的次数与「最多可能跑的重试」都算进去，
   * 超出上限就不开跑；运行中途触顶时运行行记 budgetStop，停在当前节点边界上。
   */
  private reserveOf(
    budget: WorkflowBudgets,
    settled: WorkflowUsage,
    reserved: WorkflowUsage,
    node: WorkflowNode,
  ): string {
    const next: WorkflowUsage = { ...reserved, nodes: reserved.nodes + 1 };
    if (node.type === 'ai') next.aiCalls = Math.max(1, next.aiCalls + 1);
    if (node.type === 'action' || node.type === 'integration') {
      next.toolCalls += Math.max(1, this.retryOf(node).times + 1);
    }
    if (this.browserActionOf(node)) next.browserActions += 1;
    return this.overBudget(budget, next, settled);
  }

  /**
   * 触顶判定：数量类按「含本节点的预留量超过上限」判停，
   * token 按「本次运行已累计到上限」判停（模型用量无法预知，只能事后续记）。
   * 返回首个超限项，未超限返回空串。
   */
  private overBudget(
    budget: WorkflowBudgets,
    reserved: WorkflowUsage,
    settled: WorkflowUsage,
  ): '' | 'TOKENS' | 'AI_CALLS' | 'TOOL_CALLS' | 'BROWSER_ACTIONS' | 'LOOP_LIMIT' {
    if (budget.maxNodes > 0 && reserved.nodes > budget.maxNodes)
      return 'LOOP_LIMIT';
    if (budget.maxAiCalls > 0 && reserved.aiCalls > budget.maxAiCalls)
      return 'AI_CALLS';
    if (
      budget.maxTokens > 0 &&
      settled.tokenIn + settled.tokenOut >= budget.maxTokens
    )
      return 'TOKENS';
    if (budget.maxToolCalls > 0 && reserved.toolCalls > budget.maxToolCalls)
      return 'TOOL_CALLS';
    if (
      budget.maxBrowserActions > 0 &&
      reserved.browserActions > budget.maxBrowserActions
    )
      return 'BROWSER_ACTIONS';
    return '';
  }

  /** 一个节点实际跑了几次、烧了多少 token 就记多少：失败与重试也是真实调用，一并计入。 */
  private async chargeUsage(
    runId: number,
    charge: Partial<WorkflowUsage>,
  ): Promise<void> {
    const row = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { usage: true },
    });
    const usage = this.usageOf(row?.usage);
    let changed = false;
    for (const key of Object.keys(usage) as (keyof WorkflowUsage)[]) {
      const delta = Math.max(0, Math.floor(Number(charge[key] ?? 0)) || 0);
      if (delta > 0) {
        usage[key] += delta;
        changed = true;
      }
    }
    // 空记账不落库：否则会覆盖同一事务里刚写的预算触顶标记。
    if (!changed) return;
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { usage: toJsonInput(usage) },
    });
  }

  /** 浏览器动作节点：RPA 接管与插件派发类工具都算一次浏览器动作。 */
  private browserActionOf(node: WorkflowNode): boolean {
    const key = `${node.operationId || ''} ${node.kind}`.toLowerCase();
    return (
      key.includes('chrome') ||
      key.includes('browser') ||
      key.includes('rpa') ||
      key.includes('distribution')
    );
  }

  private budgetErrorMessage(stop: string, budget: WorkflowBudgets): string {
    const label = BUDGET_STOP_LABELS[stop] || stop;
    const cap =
      stop === 'TOKENS'
        ? budget.maxTokens
        : stop === 'AI_CALLS'
          ? budget.maxAiCalls
          : stop === 'TOOL_CALLS'
            ? budget.maxToolCalls
            : stop === 'BROWSER_ACTIONS'
              ? budget.maxBrowserActions
              : budget.maxNodes;
    return `已触达执行预算（${label}上限 ${cap}），运行按超预算中止；如需继续请调整工作流预算后重新运行`;
  }
}

function compare(left: unknown, right: unknown, operator: string): boolean {
  switch (operator) {
    case 'eq':
      return looseEqual(left, right);
    case 'ne':
      return !looseEqual(left, right);
    case 'gt':
      return toNumber(left) > toNumber(right);
    case 'gte':
      return toNumber(left) >= toNumber(right);
    case 'lt':
      return toNumber(left) < toNumber(right);
    case 'lte':
      return toNumber(left) <= toNumber(right);
    case 'contains':
      return textOf(left).includes(textOf(right));
    case 'empty':
      return (
        left === null ||
        left === undefined ||
        left === '' ||
        (Array.isArray(left) && left.length === 0)
      );
    default:
      return false;
  }
}

function looseEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' || typeof right === 'number') {
    const a = toNumber(left);
    const b = toNumber(right);
    if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
  }
  return textOf(left) === textOf(right);
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

/** 配置项取文本：只认标量，对象/数组/空值一律回落到默认值。 */
function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return fallback;
}

/** 模板取值转文本：标量直转，对象走 JSON（与 workflow-graph 的 asText 同口径）。 */
function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
