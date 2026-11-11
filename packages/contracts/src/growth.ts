import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });

/**
 * 增长驾驶舱（Growth_*）：把 OKR、销售、交付、获客、客服五条链路的当期数据
 * 收敛成一个快照，供首页与「增长驾驶舱」页面直接消费，避免前端各页各拉一遍。
 */
export const growthCockpitSchema = z.object({
  generatedAt: z.string(),
  days: z.number(),
  goals: z.object({
    objectives: z.number(),
    keyResults: z.number(),
    avgProgress: z.number(),
    atRisk: z.number(),
  }),
  sales: z.object({
    leads: z.number(),
    customers: z.number(),
    opportunities: z.number(),
    pipelineAmount: z.string(),
    contractAmount: z.string(),
    paidAmount: z.string(),
    collectionRate: z.number(),
  }),
  delivery: z.object({
    activeProjects: z.number(),
    openTasks: z.number(),
    doneTasks: z.number(),
    overdueTasks: z.number(),
    budgetAmount: z.string(),
    actualCost: z.string(),
    costRate: z.number(),
  }),
  acquisition: z.object({
    leads: z.number(),
    contacted: z.number(),
    replied: z.number(),
    converted: z.number(),
  }),
  service: z.object({
    conversations: z.number(),
    closed: z.number(),
    crmConverted: z.number(),
  }),
  funnel: z.array(
    z.object({ key: z.string(), label: z.string(), value: z.number() }),
  ),
  alerts: z.array(
    z.object({
      level: z.enum(["WARNING", "INFO"]),
      title: z.string(),
      detail: z.string(),
    }),
  ),
  trend: z.array(z.object({ month: z.string(), paidAmount: z.string() })),
});
export type GrowthCockpit = z.infer<typeof growthCockpitSchema>;

export const growthQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
});

/** 四态口径（只做读侧聚合，不引入主状态机）：读法见各 state 的 hit/缺件。 */
export const GROWTH_FULFILL_STATES = [
  "SIGNED",
  "DELIVERED",
  "ACCEPTED",
  "SETTLED",
] as const;
export const growthFulfillmentRowSchema = z.object({
  contractId: z.number(),
  contractName: z.string(),
  customerName: z.string(),
  amount: z.string(),
  signedAt: z.string(),
  projectId: z.number(),
  projectStatus: z.string(),
  /** 合同签约完成：审批通过且未作废（作废视为未签约）。 */
  signed: z.boolean(),
  /** 服务已交付：关联项目进入待验收/已结项（ACCEPTING / CLOSED）。 */
  delivered: z.boolean(),
  /** 客户验收通过：项目结项（CLOSED）。 */
  accepted: z.boolean(),
  /** 财务结算完成：合同名下应收全部结清。 */
  settled: z.boolean(),
  receivableAmount: z.string(),
  receivedAmount: z.string(),
  /** 卡在哪个口径：SIGNED / DELIVERED / ACCEPTED / SETTLED / DONE */
  gap: z.enum(["SIGNED", "DELIVERED", "ACCEPTED", "SETTLED", "DONE"]),
  gapLabel: z.string(),
});
export const growthFulfillmentSummarySchema = z.object({
  signed: z.number(),
  delivered: z.number(),
  accepted: z.number(),
  settled: z.number(),
  total: z.number(),
  signedAmount: z.string(),
  receivedAmount: z.string(),
});
export const growthFulfillmentSchema = z.object({
  summary: growthFulfillmentSummarySchema,
  list: z.array(growthFulfillmentRowSchema),
});

/** 经营异常（P4-6）：应收/应付逾期、项目超预算、库存低于补货点、任务超期。 */
export const GROWTH_RISK_KINDS = [
  "RECEIVABLE_OVERDUE",
  "PAYABLE_OVERDUE",
  "PROJECT_OVER_BUDGET",
  "STOCK_LOW",
  "TASK_OVERDUE",
] as const;
export const growthRiskSignalSchema = z.object({
  kind: z.enum(GROWTH_RISK_KINDS),
  kindLabel: z.string(),
  entityKey: z.string(),
  title: z.string(),
  detail: z.string(),
  amount: z.string(),
  severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
  ownerUserId: z.string(),
  ownerName: z.string(),
  link: z.string(),
});
export const growthRiskReportSchema = z.object({
  scannedAt: z.string(),
  total: z.number(),
  high: z.number(),
  byKind: z.array(z.object({ kind: z.string(), kindLabel: z.string(), count: z.number() })),
  list: z.array(growthRiskSignalSchema),
});

/** 合同履约助手：卡点 + 下一步动作；AI 不可用时退回规则式（source=RULE），结论同样可用。 */
export const growthFulfillmentAdviceItemSchema = z.object({
  contractId: z.number(),
  contractName: z.string(),
  customerName: z.string(),
  amount: z.string(),
  gap: z.enum(["SIGNED", "DELIVERED", "ACCEPTED", "SETTLED", "DONE"]),
  gapLabel: z.string(),
  ownerRole: z.string(),
  risk: z.string(),
  action: z.string(),
  source: z.enum(["AI", "RULE"]),
});
export const growthFulfillmentAdviceSchema = z.object({
  generatedAt: z.string(),
  source: z.enum(["AI", "RULE"]),
  model: z.string(),
  headline: z.string(),
  summary: growthFulfillmentSummarySchema,
  items: z.array(growthFulfillmentAdviceItemSchema),
  openCount: z.number(),
});
export type GrowthFulfillmentAdvice = z.infer<
  typeof growthFulfillmentAdviceSchema
>;

export const growthEndpoints = {
  Growth_cockpit: {
    method: "get" as const,
    path: "/enterprise/growth/cockpit",
    params: z.object({}),
    query: growthQuerySchema,
    body: z.undefined(),
    response: envelope(growthCockpitSchema),
  },
  Growth_fulfillment: {
    method: "get" as const,
    path: "/enterprise/growth/fulfillment",
    params: z.object({}),
    query: growthQuerySchema,
    body: z.undefined(),
    response: envelope(growthFulfillmentSchema),
  },
  Growth_risks: {
    method: "get" as const,
    path: "/enterprise/growth/risks",
    params: z.object({}),
    query: z.object({ kind: z.string().max(32).optional() }),
    body: z.undefined(),
    response: envelope(growthRiskReportSchema),
  },
  Growth_scanRisks: {
    method: "post" as const,
    path: "/enterprise/growth/risks/scan",
    params: z.object({}),
    query: z.object({}),
    body: z.object({}),
    response: envelope(
      z.object({ scannedAt: z.string(), total: z.number() }),
    ),
  },
  Growth_fulfillmentAdvice: {
    method: "get" as const,
    path: "/enterprise/growth/fulfillment/advice",
    params: z.object({}),
    query: growthQuerySchema,
    body: z.undefined(),
    response: envelope(growthFulfillmentAdviceSchema),
  },
  Growth_dispatchFulfillment: {
    method: "post" as const,
    path: "/enterprise/growth/fulfillment/dispatch",
    params: z.object({}),
    query: z.object({}),
    body: z.object({
      contractIds: z.array(z.number().int().positive()).min(1).max(50),
      assigneeUserId: z.string().max(64).optional().default(""),
      note: z.string().max(200).optional().default(""),
    }),
    response: envelope(
      z.object({ created: z.number(), skipped: z.number(), total: z.number() }),
    ),
  },
};
