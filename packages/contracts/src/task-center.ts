import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** 任务分组：与后端 TaskSource.category 同一份口径，界面一律显示中文。 */
export const TASK_CATEGORIES = [
  "approval",
  "report",
  "task",
  "matter",
  "audit",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const TASK_CATEGORY_LABELS: Record<string, string> = {
  approval: "审批",
  report: "汇报",
  task: "任务",
  matter: "事务",
  audit: "审核",
};

/** 中心状态机：OPEN → DOING → DONE / CANCELED / EXPIRED（与业务状态正交）。 */
export const TASK_STATUSES = [
  "OPEN",
  "DOING",
  "DONE",
  "CANCELED",
  "EXPIRED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<string, string> = {
  OPEN: "待处理",
  DOING: "处理中",
  DONE: "已完成",
  CANCELED: "已取消",
  EXPIRED: "已失效",
};

/** 承办对象类型：USER 直接落账号；ORG 先落机构队列，由负责人改派或到期自动落实。 */
export const TASK_ASSIGNEE_TYPES = ["USER", "ORG"] as const;
export type TaskAssigneeType = (typeof TASK_ASSIGNEE_TYPES)[number];

/** 派单策略：ORG_QUEUE 表示先落机构队列；其余与 TaskRouter.resolve 同一份口径。 */
export const TASK_ASSIGN_STRATEGIES = [
  "DIRECT",
  "ROUND_ROBIN",
  "LOAD",
  "ORG_QUEUE",
] as const;
export type TaskAssignStrategy = (typeof TASK_ASSIGN_STRATEGIES)[number];
export const TASK_ASSIGN_STRATEGY_LABELS: Record<string, string> = {
  DIRECT: "指定承办人",
  ROUND_ROBIN: "轮询派单",
  LOAD: "按负载派单",
  ORG_QUEUE: "机构待派",
};

/** 派单规则可选的落实方式（不含 ORG_QUEUE：规则命中就必须落到人）。 */
export const TASK_RULE_STRATEGIES = ["DIRECT", "ROUND_ROBIN", "LOAD"] as const;
export type TaskRuleStrategy = (typeof TASK_RULE_STRATEGIES)[number];

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<string, string> = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
};

/** 表单节点字段：与 `human.form` 的 `config.fields` 同一份形状，任务侧据此渲染。 */
export const taskFormFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  required: z.boolean().default(false),
});
export type TaskFormField = z.infer<typeof taskFormFieldSchema>;

export const taskFormSchema = z.object({
  title: z.string().max(200).default(""),
  fields: z.array(taskFormFieldSchema).min(1).max(50),
});
export type TaskFormDefinition = z.infer<typeof taskFormSchema>;

/** 表单填写值：任务侧只收字符串，提交时按字段定义校验必填。 */
export const taskFormValuesSchema = z.record(z.string(), z.string().max(2000));

export const myTaskSchema = z.object({
  id: z.number(),
  source: z.string(),
  sourceLabel: z.string(),
  sourceId: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  title: z.string(),
  description: z.string(),
  link: z.string(),
  priority: z.string(),
  priorityLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  sourceStatus: z.string(),
  sourceStatusLabel: z.string(),
  orgType: z.string(),
  orgUserId: z.string(),
  assigneeType: z.string(),
  assignedBy: z.string(),
  assignedAt: z.string().nullable(),
  assignPolicy: z.string(),
  assignPolicyLabel: z.string(),
  acceptedAt: z.string().nullable(),
  createdBy: z.string(),
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
  closedAt: z.string().nullable(),
  closedBy: z.string(),
  closeNote: z.string(),
  /** 表单任务的定义；普通任务为 null */
  formSchema: taskFormSchema.nullable(),
  /** 表单填写结果；未提交为 null */
  formData: taskFormValuesSchema.nullable(),
  createdAt: z.string(),
});
export type MyTaskRow = z.infer<typeof myTaskSchema>;

export const taskGroupStatSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number(),
});
export type TaskGroupStat = z.infer<typeof taskGroupStatSchema>;

export const taskSummarySchema = z.object({
  /** 未办（OPEN + DOING），供菜单角标与驾驶舱统计卡 */
  pending: z.number(),
  doing: z.number(),
  /** 今日到期 */
  dueToday: z.number(),
  overdue: z.number(),
  closed: z.number(),
  /** 机构待派：assigneeType=ORG 且仍挂在本机构的件数 */
  orgPending: z.number(),
  /** 机构队列超时未接（24h）——即 D4 自动落实前的候选 */
  unassigned: z.number(),
  total: z.number(),
  byCategory: z.array(taskGroupStatSchema),
  bySource: z.array(taskGroupStatSchema),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskAssignmentLogSchema = z.object({
  id: z.number(),
  taskId: z.number(),
  fromUserId: z.string(),
  toUserId: z.string(),
  strategy: z.string(),
  strategyLabel: z.string(),
  note: z.string(),
  actorId: z.string(),
  createdAt: z.string(),
});
export type TaskAssignmentLogRow = z.infer<typeof taskAssignmentLogSchema>;

export const taskCenterEndpoints = {
  MyTask_list: {
    method: "get" as const,
    path: "/enterprise/my-tasks",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      category: z.string().optional(),
      source: z.string().optional(),
      keyword: z.string().optional(),
      /** 默认只列未办；置 true 时「已关闭」也一并返回 */
      includeClosed: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(
      pageSchema(myTaskSchema).extend({
        groups: z.array(taskGroupStatSchema),
        summary: taskSummarySchema,
      }),
    ),
  },
  MyTask_get: {
    method: "get" as const,
    path: "/enterprise/my-tasks/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(myTaskSchema),
  },
  MyTask_summary: {
    method: "get" as const,
    path: "/enterprise/my-tasks/summary",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(taskSummarySchema),
  },
  MyTask_close: {
    method: "post" as const,
    path: "/enterprise/my-tasks/:id/close",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ note: z.string().max(500).optional() }),
    response: envelope(myTaskSchema),
  },
  /** 表单任务提交：按字段定义校验必填，成功即关闭任务并唤醒源流程。 */
  MyTask_submitForm: {
    method: "post" as const,
    path: "/enterprise/my-tasks/:id/form",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      values: taskFormValuesSchema,
      note: z.string().max(500).optional(),
    }),
    response: envelope(myTaskSchema),
  },
  MyTask_reopen: {
    method: "post" as const,
    path: "/enterprise/my-tasks/:id/reopen",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(myTaskSchema),
  },
  /** 机构收件箱：只列 assigneeType=ORG 且归属我这个服务商的任务。 */
  MyTask_orgList: {
    method: "get" as const,
    path: "/enterprise/my-tasks/org",
    params: z.object({}),
    query: pageQuerySchema.extend({
      /** 默认只列未办 */
      includeClosed: z.coerce.boolean().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(
      pageSchema(myTaskSchema).extend({
        pending: z.number(),
        unassigned: z.number(),
      }),
    ),
  },
  /** 服务商负责人/管理员改派：可落到具体账号，也可退回机构队列（不传 toUserId）。 */
  MyTask_assign: {
    method: "post" as const,
    path: "/enterprise/my-tasks/:id/assign",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      toUserId: z.string().max(64).optional(),
      strategy: z.enum(TASK_RULE_STRATEGIES).optional(),
      note: z.string().max(500).optional(),
    }),
    response: envelope(myTaskSchema),
  },
  /** 职员主动接机构队列里的任务。 */
  MyTask_claim: {
    method: "post" as const,
    path: "/enterprise/my-tasks/:id/claim",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(myTaskSchema),
  },
  /** 改派留痕：只追加，按时间正序。 */
  MyTask_assignmentLog: {
    method: "get" as const,
    path: "/enterprise/my-tasks/:id/assignments",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(taskAssignmentLogSchema)),
  },
};
