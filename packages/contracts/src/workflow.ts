import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** 可见性：私有 / 当前主体（公司） / 服务商机构。 */
export const WORKFLOW_SCOPES = ["PRIVATE", "ORG", "PROVIDER"] as const;
export type WorkflowScope = (typeof WORKFLOW_SCOPES)[number];
export const WORKFLOW_SCOPE_LABELS: Record<string, string> = {
  PRIVATE: "私有",
  ORG: "公司共享",
  PROVIDER: "服务商共享",
};

/**
 * 共享主体：工作流的数据域跟着主体走，A 公司的流程不能和 B 公司的混在一个清单里，
 * 因此共享分组按「具体哪一个公司 / 哪一个服务商」拆开，由用户在主体之间选择。
 */
export const workflowOrgSchema = z.object({
  orgType: z.string(),
  orgUserId: z.string(),
  name: z.string(),
  current: z.boolean(),
});
export type WorkflowOrg = z.infer<typeof workflowOrgSchema>;

export const WORKFLOW_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
};

export const WORKFLOW_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "WAITING",
  "DONE",
  "FAILED",
  "CANCELED",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export const WORKFLOW_RUN_STATUS_LABELS: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "运行中",
  WAITING: "等待中",
  DONE: "已完成",
  FAILED: "已失败",
  CANCELED: "已取消",
};

/** 触发方式。外部 Webhook 触发不开放（决策 D2=C），故无 WEBHOOK。 */
export const WORKFLOW_TRIGGERS = [
  "MANUAL",
  "SCHEDULE",
  "EVENT",
  "TASK",
  "AGENT",
  "MCP",
] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];
export const WORKFLOW_TRIGGER_LABELS: Record<string, string> = {
  MANUAL: "手动",
  SCHEDULE: "定时",
  EVENT: "事件",
  TASK: "任务变化",
  AGENT: "Agent 调用",
  MCP: "MCP 调用",
};

/** 任务变化触发的事件名（trigger.task 节点 config.event 取值）。 */
export const WORKFLOW_TASK_EVENTS = ["created", "closed", "overdue"] as const;
export type WorkflowTaskEvent = (typeof WORKFLOW_TASK_EVENTS)[number];
export const WORKFLOW_TASK_EVENT_LABELS: Record<string, string> = {
  created: "任务创建",
  closed: "任务关闭",
  overdue: "任务逾期",
};

/**
 * 执行预算（§7.3-9 / §11.4）：0＝不限。每次运行在创建时快照一份，
 * token 上限即本次运行的 AI 费用上限，运行记录按快照逐项累计用量。
 */
export const workflowBudgetsSchema = z.object({
  /** 单次运行的 AI 调用次数（含重试） */
  maxAiCalls: z.number().int().min(0).max(10000),
  /** 单次运行的 AI token 总量（输入+输出），费用按模型单价折算 */
  maxTokens: z.number().int().min(0).max(100000000),
  /** 工具调用次数（系统动作/集成节点，含重试） */
  maxToolCalls: z.number().int().min(0).max(10000),
  /** 浏览器动作次数（RPA / 插件派发类工具） */
  maxBrowserActions: z.number().int().min(0).max(10000),
  /** 节点执行次数：循环与重复触发共用一道闸 */
  maxNodes: z.number().int().min(0).max(10000),
});
export type WorkflowBudgets = z.infer<typeof workflowBudgetsSchema>;

export const workflowUsageSchema = z.object({
  nodes: z.number(),
  aiCalls: z.number(),
  tokenIn: z.number(),
  tokenOut: z.number(),
  toolCalls: z.number(),
  browserActions: z.number(),
});
export type WorkflowUsage = z.infer<typeof workflowUsageSchema>;

/** 触顶的预算项；NONE＝未触顶。 */
export const WORKFLOW_BUDGET_STOPS = [
  "NONE",
  "AI_CALLS",
  "TOKENS",
  "TOOL_CALLS",
  "BROWSER_ACTIONS",
  "LOOP_LIMIT",
] as const;
export type WorkflowBudgetStop = (typeof WORKFLOW_BUDGET_STOPS)[number];
export const WORKFLOW_BUDGET_STOP_LABELS: Record<string, string> = {
  NONE: "未触顶",
  AI_CALLS: "AI 调用次数",
  TOKENS: "AI 用量（token）",
  TOOL_CALLS: "工具调用次数",
  BROWSER_ACTIONS: "浏览器动作次数",
  LOOP_LIMIT: "节点执行次数（循环）",
};
export const WORKFLOW_BUDGET_FIELD_LABELS: Record<string, string> = {
  maxAiCalls: "AI 调用次数上限",
  maxTokens: "AI token 上限",
  maxToolCalls: "工具调用次数上限",
  maxBrowserActions: "浏览器动作次数上限",
  maxNodes: "节点执行次数上限",
};

/** 节点六类（对齐 §11.3）。 */
export const WORKFLOW_NODE_KINDS = [
  "trigger",
  "action",
  "ai",
  "logic",
  "human",
  "integration",
] as const;
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];
export const WORKFLOW_NODE_KIND_LABELS: Record<string, string> = {
  trigger: "触发",
  action: "系统动作",
  ai: "AI / Agent",
  logic: "逻辑",
  human: "人工",
  integration: "集成",
};

const jsonObject = z.record(z.string(), z.unknown());

export const workflowNodeSchema = z.object({
  id: z.string(),
  /** 六类之一 */
  type: z.string(),
  /** 具体节点 key：内置触发/逻辑节点用内置 key；动作节点＝operationId / 工具名 */
  kind: z.string(),
  name: z.string().default(""),
  operationId: z.string().default(""),
  params: jsonObject.default({}),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  config: jsonObject.default({}),
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().default(""),
  targetHandle: z.string().default(""),
  /** 上游输出 → 下游输入的参数映射 */
  mapping: z.record(z.string(), z.string()).default({}),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema).default([]),
  edges: z.array(workflowEdgeSchema).default([]),
});
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const workflowSchema = z.object({
  id: z.number(),
  ownerUserId: z.string(),
  orgType: z.string(),
  orgUserId: z.string(),
  name: z.string(),
  description: z.string(),
  /** 稳定别名：业务代码按它 invoke，不依赖自增 id；发布时未填则自动补 wf.<id>。 */
  businessKey: z.string().default(""),
  /** 执行预算：新建运行按这份配置快照，0 表示该项不限。 */
  budgets: workflowBudgetsSchema,
  scope: z.string(),
  scopeLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  version: z.number(),
  /** 已发布版本号（未发布为 null） */
  publishedVersion: z.number().nullable(),
  graph: workflowGraphSchema,
  inputSchema: jsonObject,
  outputSchema: jsonObject,
  createdBy: z.string(),
  /** 当前登录人是否可编辑（仅创建人可编辑） */
  editable: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowRow = z.infer<typeof workflowSchema>;

/** 节点目录条目：从 `endpoints` + `AGENT_TOOL_MANIFEST` 派生。 */
export const workflowNodeSpecSchema = z.object({
  kind: z.string(),
  kindLabel: z.string(),
  /** 节点唯一 key：内置节点 key / operationId / 工具名 */
  key: z.string(),
  name: z.string(),
  description: z.string(),
  operationId: z.string().default(""),
  /** 二级分组（域标签 / 连接器名 / 技能插件名） */
  group: z.string().default(""),
  write: z.boolean().default(false),
  permission: z.string().default(""),
  forbiddenReason: z.string().default(""),
  inputSchema: jsonObject.nullable().default(null),
  pathParams: z.array(z.string()).default([]),
});
export type WorkflowNodeSpec = z.infer<typeof workflowNodeSpecSchema>;

export const workflowRunStepSchema = z.object({
  id: z.number(),
  runId: z.number(),
  nodeId: z.string(),
  nodeType: z.string(),
  status: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  error: z.string(),
  attempts: z.number(),
  durationMs: z.number(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type WorkflowRunStep = z.infer<typeof workflowRunStepSchema>;

export const workflowRunSchema = z.object({
  id: z.number(),
  workflowId: z.number(),
  workflowName: z.string().default(""),
  version: z.number(),
  trigger: z.string(),
  triggerLabel: z.string().default(""),
  status: z.string(),
  statusLabel: z.string().default(""),
  input: z.unknown(),
  output: z.unknown(),
  actorId: z.string(),
  error: z.string(),
  /** 业务关联：单据类型 + 主键，供单据页反查「由工作流 #N 驱动」。 */
  sourceType: z.string().default(""),
  sourceId: z.string().default(""),
  /** 本次运行生效的预算快照与已耗用量 */
  budgets: workflowBudgetsSchema,
  usage: workflowUsageSchema,
  /** 触顶的预算项；非 NONE 时 error 里说明停在哪个节点边界 */
  budgetStop: z.string().default("NONE"),
  budgetStopLabel: z.string().default("未触顶"),
  steps: z.array(workflowRunStepSchema).default([]),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const workflowEndpoints = {
  Workflow_list: {
    method: "get" as const,
    path: "/enterprise/workflows",
    params: z.object({}),
    query: pageQuerySchema.extend({
      group: z.enum(["mine", "org", "provider"]).optional(),
      /** 共享分组必填到具体主体；缺省取当前主体，绝不跨主体混合。 */
      orgUserId: z.string().max(64).optional(),
      status: z.string().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(
      pageSchema(workflowSchema).extend({
        counts: z.record(z.string(), z.number()).default({}),
        orgs: z.array(workflowOrgSchema).default([]),
      }),
    ),
  },
  Workflow_create: {
    method: "post" as const,
    path: "/enterprise/workflows",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      businessKey: z.string().max(80).optional(),
      scope: z.enum(WORKFLOW_SCOPES).optional(),
      /** 共享到哪一个主体；缺省取当前主体。 */
      orgUserId: z.string().max(64).optional(),
      graph: workflowGraphSchema.optional(),
      budgets: workflowBudgetsSchema.optional(),
    }),
    response: envelope(workflowSchema),
  },
  Workflow_catalog: {
    method: "get" as const,
    path: "/enterprise/workflows/catalog",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ nodes: z.array(workflowNodeSpecSchema) })),
  },
  /**
   * 用自然语言搭建工作流：把多轮对话翻译成一张可保存的 DAG，只回草案不落库。
   * `graph` 传当前草稿（多轮迭代时回传），助手在此基础上改；`ready` 为真才允许创建。
   */
  Workflow_aiBuild: {
    method: "post" as const,
    path: "/enterprise/workflows/ai-build",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      messages: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(4000),
          }),
        )
        .min(1)
        .max(30),
      graph: workflowGraphSchema.optional(),
    }),
    response: envelope(
      z.object({
        reply: z.string(),
        name: z.string().default(""),
        description: z.string().default(""),
        graph: workflowGraphSchema,
        /** 通过 DAG 与触发器校验、且至少一个节点时才为真。 */
        ready: z.boolean(),
        /** 被剔除或需要用户处理的问题（未知节点、成环、缺事件名等）。 */
        issues: z.array(z.string()).default([]),
        model: z.string().default(""),
        elapsedMs: z.number().default(0),
      }),
    ),
  },
  Workflow_detail: {
    method: "get" as const,
    path: "/enterprise/workflows/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workflowSchema),
  },
  Workflow_save: {
    method: "patch" as const,
    path: "/enterprise/workflows/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(500).optional(),
      businessKey: z.string().max(80).optional(),
      scope: z.enum(WORKFLOW_SCOPES).optional(),
      orgUserId: z.string().max(64).optional(),
      graph: workflowGraphSchema.optional(),
      inputSchema: jsonObject.optional(),
      outputSchema: jsonObject.optional(),
      budgets: workflowBudgetsSchema.optional(),
    }),
    response: envelope(workflowSchema),
  },
  Workflow_remove: {
    method: "delete" as const,
    path: "/enterprise/workflows/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  Workflow_publish: {
    method: "post" as const,
    path: "/enterprise/workflows/:id/publish",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workflowSchema),
  },
  Workflow_run: {
    method: "post" as const,
    path: "/enterprise/workflows/:id/run",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ input: jsonObject.optional() }),
    response: envelope(workflowRunSchema),
  },
  Workflow_runDetail: {
    method: "get" as const,
    path: "/enterprise/workflows/runs/:runId",
    params: z.object({ runId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workflowRunSchema),
  },
  /** 运行记录：按工作流 / 状态 / 业务关联分页，可见范围与工作流一致。 */
  Workflow_runList: {
    method: "get" as const,
    path: "/enterprise/workflows/runs",
    params: z.object({}),
    query: pageQuerySchema.extend({
      workflowId: z.coerce.number().int().positive().optional(),
      status: z.enum(WORKFLOW_RUN_STATUSES).optional(),
      sourceType: z.string().max(32).optional(),
      sourceId: z.string().max(64).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(workflowRunSchema)),
  },
  /** 取消运行：排队中 / 运行中在下一次节点边界停；等待人工直接把等待步骤记 CANCELED。 */
  Workflow_runCancel: {
    method: "post" as const,
    path: "/enterprise/workflows/runs/:runId/cancel",
    params: z.object({ runId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workflowRunSchema),
  },
  /**
   * 统一触发入口：手动 / 定时 / 事件 / 任务变化 / Agent / MCP 都落到这里。
   * 业务模块在进程内直接调 WorkflowService.invoke；本端点供管理员联调与前端触发器面板试触发。
   * dedupeKey 命中已存在的运行时不再起新运行，直接回原 runId（duplicated=true）。
   */
  Workflow_invoke: {
    method: "post" as const,
    path: "/enterprise/workflows/invoke",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      workflowId: z.number().optional(),
      businessKey: z.string().max(80).optional(),
      trigger: z.enum(WORKFLOW_TRIGGERS).optional(),
      input: jsonObject.optional(),
      sourceType: z.string().max(32).optional(),
      sourceId: z.string().max(64).optional(),
      dedupeKey: z.string().max(191).optional(),
    }),
    response: envelope(
      z.object({ runId: z.number(), duplicated: z.boolean() }),
    ),
  },
  Workflow_duplicate: {
    method: "post" as const,
    path: "/enterprise/workflows/:id/duplicate",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workflowSchema),
  },
};
