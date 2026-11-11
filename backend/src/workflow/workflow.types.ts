import type { CurrentUser } from '../auth/current-user';

/** 一次契约动作的入参：路径参数 / 查询串 / 请求体，与 MCP 自执行器同一口径。 */
export type OperationInput = {
  pathParams?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

/** 内部自执行器的返回：与 MCP `execute` 同一份信封解析结果。 */
export type OperationResult = {
  status: number;
  code: number | undefined;
  message: string;
  data: unknown;
};

/**
 * 工作流的运行期能力。全部由 `services.ts` 装配、`app.ts` 回填：
 * 动作节点走内部自执行器（与浏览器同一张路由表、同一份校验），
 * 工具节点走 Agent 的统一工具派发（连接器 / 硬件 / 内置 / 技能 / 插件），
 * AI 节点走统一网关与 RAG 出口。工作流不另写一套权限，也不另存一份目录。
 */
export type WorkflowRuntime = {
  /** 以运行发起人身份执行一个契约 operationId。 */
  runOperation?: (
    user: CurrentUser,
    requestId: string,
    operationId: string,
    input: OperationInput,
  ) => Promise<OperationResult>;
  /** 执行一次 Agent 工具（`mcp__c*__*` / `hw__*` / 内置 / 技能 / 插件）。 */
  callTool?: (
    user: CurrentUser,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ text: string; ok: boolean }>;
  /** 大模型一次性对话（AI 节点）。token 用量随返回值回到步骤产出里记账。 */
  chat?: (
    user: CurrentUser,
    messages: { role: string; content: string }[],
  ) => Promise<{ text: string; usage?: AiUsage }>;
  /** 知识库检索（AI 节点 `ai.retrieve`）。 */
  retrieve?: (
    user: CurrentUser,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  /**
   * 跑一次站内 Agent（AI 节点 `ai.agent` 的 agent 模式），返回最终回答文本；
   * usage 由 Agent 侧按本轮实际用量回填。
   */
  runAgent?: (
    user: CurrentUser,
    prompt: string,
  ) => Promise<{ text: string; usage?: AiUsage }>;
};

/** 一次模型调用的 token 用量：工作流按运行汇总，报表读这同一份事实。 */
export type AiUsage = { tokenIn: number; tokenOut: number; call: number };

/** 节点一次执行的结局。`branches` 只对条件节点有意义，表示要走哪几条出边。 */
export type NodeOutcome = {
  status: 'DONE' | 'SKIPPED' | 'WAITING' | 'FAILED' | 'TIMEOUT';
  output?: unknown;
  error?: string;
  branches?: string[];
  /** 实际尝试次数（含重试）；缺省按 1 次记。 */
  attempts?: number;
  /** WAITING 时的等待锚：任务编号 + 分配该任务的节点 id（任务关闭回调据此定位）。 */
  waitFor?: {
    kind: 'myTask';
    taskId: number;
    dedupKey: string;
    anchor: string;
  };
  /** 本节点模型调用的 token 用量：随步骤一起落库，运行详情与成本报表读这一处。 */
  usage?: AiUsage;
  /** 本节点触发的工具 / 浏览器动作次数：执行预算按次累计。 */
  toolCalls?: number;
  browserActions?: number;
};

/**
 * 一次运行的执行预算（§7.3-9）：发布时快照到运行行，运行中途改图不影响在途实例。
 * 0 ＝ 不限制；AI 费用按 token 计（tokenIn + tokenOut），与用量事实同一份口径，不另算钱。
 */
export type WorkflowBudgets = {
  /** 单次运行的模型调用次数上限（含重试）。 */
  maxAiCalls: number;
  /** 单次运行累计 token 上限（AI 费用口径 §11.4）。 */
  maxTokens: number;
  /** Agent 工具 / 业务动作 / Webhook 调用次数上限。 */
  maxToolCalls: number;
  /** 浏览器执行动作次数上限（发布填充、接管步骤等）。 */
  maxBrowserActions: number;
  /** 单次运行的节点执行总数上限（循环/扇出的硬闸）。 */
  maxNodes: number;
};

/** 运行耗用累计：与预算同名同口径，任务中心与运行详情直接对照。 */
export type WorkflowUsage = {
  nodes: number;
  aiCalls: number;
  tokenIn: number;
  tokenOut: number;
  toolCalls: number;
  browserActions: number;
};

/** 运行期上下文：入参 + 变量 + 各节点产出 + 发起人，模板取值都从这里解析。 */
export type RunContext = {
  input: Record<string, unknown>;
  vars: Record<string, unknown>;
  nodes: Record<string, unknown>;
  /** 运行发起人：模板用 {{actor.userId}} / {{actor.username}} 默认派给本人。 */
  actor: { userId: string; username: string };
};

/** 领域事件桥入参：事件所属主体 + 事件名 + 载荷 + 事件台账 id（幂等锚）。 */
export type WorkflowEventTrigger = {
  orgType: string;
  orgUserId: string;
  event: string;
  payload: Record<string, unknown>;
  eventLogId: number;
};

/** 任务事件桥入参：任务中心的 created / closed / overdue 三类变化。 */
export type WorkflowTaskTrigger = {
  kind: string;
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
};
