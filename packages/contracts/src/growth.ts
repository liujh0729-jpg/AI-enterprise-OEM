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

export const growthEndpoints = {
  Growth_cockpit: {
    method: "get" as const,
    path: "/enterprise/growth/cockpit",
    params: z.object({}),
    query: growthQuerySchema,
    body: z.undefined(),
    response: envelope(growthCockpitSchema),
  },
};
