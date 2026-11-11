import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";
import { TASK_RULE_STRATEGIES, TASK_ASSIGN_STRATEGY_LABELS } from "./task-center";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** 派单规则：服务商负责人自助维护（决策 D5=A），平台侧只读审计。 */
export const taskAssignmentRuleSchema = z.object({
  id: z.number(),
  orgType: z.string(),
  orgUserId: z.string(),
  orgName: z.string(),
  source: z.string(),
  category: z.string(),
  region: z.string(),
  strategy: z.string(),
  strategyLabel: z.string(),
  /** DIRECT 时只有 1 个目标；轮询/负载时是候选职员池，空数组表示全体在职职员 */
  targets: z.array(z.string()),
  priority: z.number(),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type TaskAssignmentRuleRow = z.infer<typeof taskAssignmentRuleSchema>;

export const taskAssignmentRuleInputSchema = z.object({
  orgType: z.literal("PROVIDER").optional(),
  /** 缺省＝当前服务商账号；只允许写自己机构 */
  orgUserId: z.string().max(64).optional(),
  /** 任务源，* 表示全部 */
  source: z.string().min(1).max(32),
  /** 任务类目，* 表示全部 */
  category: z.string().min(1).max(16),
  region: z.string().max(32).default(""),
  strategy: z.enum(TASK_RULE_STRATEGIES),
  targets: z.array(z.string().min(1).max(64)).max(100).default([]),
  priority: z.number().int().min(0).max(999).default(0),
  enabled: z.boolean().default(true),
});
export type TaskAssignmentRuleInput = z.infer<
  typeof taskAssignmentRuleInputSchema
>;

export const taskAssignmentRulePatchSchema =
  taskAssignmentRuleInputSchema.partial();

export const taskAssignmentEndpoints = {
  TaskRule_list: {
    method: "get" as const,
    path: "/enterprise/task-assignment-rules",
    params: z.object({}),
    query: z.object({ orgUserId: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.array(taskAssignmentRuleSchema)),
  },
  TaskRule_create: {
    method: "post" as const,
    path: "/enterprise/task-assignment-rules",
    params: z.object({}),
    query: emptyQuery,
    body: taskAssignmentRuleInputSchema,
    response: envelope(taskAssignmentRuleSchema),
  },
  TaskRule_update: {
    method: "post" as const,
    path: "/enterprise/task-assignment-rules/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: taskAssignmentRulePatchSchema,
    response: envelope(taskAssignmentRuleSchema),
  },
  TaskRule_remove: {
    method: "post" as const,
    path: "/enterprise/task-assignment-rules/:id/delete",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  /** 平台管理员只读审计：跨机构列出规则，不提供任何写入入口。 */
  TaskRule_audit: {
    method: "get" as const,
    path: "/enterprise/task-assignment-rules/audit",
    params: z.object({}),
    query: pageQuerySchema.extend({
      orgUserId: z.string().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(taskAssignmentRuleSchema)),
  },
};
