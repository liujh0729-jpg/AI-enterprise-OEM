import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

export const OKR_CYCLE_KINDS = ["YEAR", "QUARTER", "MONTH"] as const;
export const OKR_CYCLE_KIND_LABELS: Record<string, string> = {
  YEAR: "年度",
  QUARTER: "季度",
  MONTH: "月度",
};

export const OKR_CYCLE_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "REVIEW",
  "CLOSED",
] as const;
export const OKR_CYCLE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "进行中",
  REVIEW: "复盘中",
  CLOSED: "已关闭",
};

export const OKR_LEVELS = ["COMPANY", "DEPT", "PERSONAL"] as const;
export const OKR_LEVEL_LABELS: Record<string, string> = {
  COMPANY: "公司",
  DEPT: "部门",
  PERSONAL: "个人",
};

export const OKR_VISIBILITIES = ["ORG", "DEPT", "SELF"] as const;
export const OKR_VISIBILITY_LABELS: Record<string, string> = {
  ORG: "全账号",
  DEPT: "本部门",
  SELF: "仅本人",
};

export const OKR_OBJECTIVE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
};

export const OKR_METRIC_TYPES = ["MANUAL", "AUTO", "ROLLUP"] as const;
export const OKR_METRIC_TYPE_LABELS: Record<string, string> = {
  MANUAL: "手动填写",
  AUTO: "自动统计",
  ROLLUP: "汇总折算",
};

export const OKR_PLAN_KINDS = ["WEEK", "DAY", "ADHOC"] as const;
export const OKR_PLAN_KIND_LABELS: Record<string, string> = {
  WEEK: "周计划",
  DAY: "日计划",
  ADHOC: "日常计划",
};

export const OKR_PLAN_STATUSES = [
  "TODO",
  "DOING",
  "DONE",
  "CANCELLED",
] as const;
export const OKR_PLAN_STATUS_LABELS: Record<string, string> = {
  TODO: "待开始",
  DOING: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
};

export const OKR_REPORT_KINDS = ["DAILY", "WEEKLY"] as const;
export const OKR_REPORT_KIND_LABELS: Record<string, string> = {
  DAILY: "日报",
  WEEKLY: "周报",
};

export const OKR_REPORT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
};

export const OKR_REPORT_SOURCES: Record<string, string> = {
  MANUAL: "人工填写",
  AGENT_AUTO: "Agent 自动",
  SYSTEM: "系统生成",
};

/** 自动指标源（闭集，与方案 §6.1 一致）。 */
export const OKR_METRIC_SOURCES = [
  "CRM_OPPORTUNITY",
  "CRM_CONTRACT",
  "CRM_PAYMENT",
  "CRM_ORDER",
  "SIGN_CONTRACT",
  "DATA_TABLE",
  "LOWCODE_ENTITY",
] as const;
export const OKR_METRIC_SOURCE_LABELS: Record<string, string> = {
  CRM_OPPORTUNITY: "CRM 商机",
  CRM_CONTRACT: "CRM 合同",
  CRM_PAYMENT: "CRM 回款计划",
  CRM_ORDER: "CRM 订单",
  SIGN_CONTRACT: "签约管理合同",
  DATA_TABLE: "多维表格",
  LOWCODE_ENTITY: "内建应用实体",
};

export const OKR_DEFAULT_SCORE_DIMENSIONS = [
  { key: "achievement", label: "目标达成", weight: 50 },
  { key: "execution", label: "协作与执行", weight: 30 },
  { key: "review", label: "复盘质量", weight: 20 },
];

const positionSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
});

const cycleView = z.object({
  id: z.number(),
  kind: z.string(),
  kindLabel: z.string(),
  year: z.number(),
  period: z.number(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  closedAt: z.string(),
  createdAt: z.string(),
});
export type OkrCycleView = z.infer<typeof cycleView>;

const memberView = z.object({
  memberUserId: z.string(),
  name: z.string(),
  memberKind: z.string(),
  memberKindLabel: z.string(),
  department: z.string(),
  positions: z.array(positionSchema),
  capabilities: z.string(),
  roles: z.array(z.string()),
  dualKind: z.boolean().default(false),
});
export type OkrMemberView = z.infer<typeof memberView>;

const krView = z.object({
  id: z.number(),
  objectiveId: z.number(),
  title: z.string(),
  metricType: z.string(),
  metricTypeLabel: z.string(),
  targetValue: z.number(),
  currentValue: z.number(),
  startValue: z.number(),
  unit: z.string(),
  direction: z.string(),
  weight: z.number(),
  ownerMemberUserId: z.string(),
  ownerName: z.string().default(""),
  metricSource: z.record(z.string(), z.unknown()),
  lastRefreshedAt: z.string(),
  progress: z.number(),
  createdAt: z.string(),
});
export type OkrKrView = z.infer<typeof krView>;

const objectiveView = z.object({
  id: z.number(),
  cycleId: z.number(),
  parentId: z.number(),
  level: z.string(),
  levelLabel: z.string(),
  title: z.string(),
  description: z.string(),
  ownerMemberUserId: z.string(),
  ownerName: z.string(),
  assignerUserId: z.string(),
  weight: z.number(),
  progress: z.number(),
  visibility: z.string(),
  visibilityLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  source: z.string(),
  krs: z.array(krView),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OkrObjectiveView = z.infer<typeof objectiveView>;

const progressLogView = z.object({
  id: z.number(),
  krId: z.number(),
  objectiveId: z.number(),
  before: z.number(),
  after: z.number(),
  progress: z.number(),
  note: z.string(),
  source: z.string(),
  authorId: z.string(),
  refType: z.string(),
  refId: z.string(),
  createdAt: z.string(),
});

const planView = z.object({
  id: z.number(),
  objectiveId: z.number(),
  krId: z.number(),
  memberUserId: z.string(),
  memberName: z.string().default(""),
  title: z.string(),
  detail: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  periodKey: z.string(),
  startDate: z.string(),
  dueDate: z.string(),
  priority: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  progress: z.number(),
  scheduleId: z.number(),
  source: z.string(),
  doneAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OkrPlanView = z.infer<typeof planView>;

const reportView = z.object({
  id: z.number(),
  memberUserId: z.string(),
  memberName: z.string().default(""),
  kind: z.string(),
  kindLabel: z.string(),
  periodKey: z.string(),
  content: z.record(z.string(), z.unknown()),
  autoDraft: z.record(z.string(), z.unknown()),
  source: z.string(),
  scheduleId: z.number(),
  status: z.string(),
  statusLabel: z.string(),
  submittedAt: z.string(),
  managerComment: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OkrReportView = z.infer<typeof reportView>;

const scoreItem = z.object({
  key: z.string(),
  label: z.string().default(""),
  score: z.number().min(1).max(5),
  weight: z.number().default(0),
});

const scoreView = z.object({
  id: z.number(),
  cycleId: z.number(),
  memberUserId: z.string(),
  memberName: z.string().default(""),
  reviewerUserId: z.string(),
  reviewerName: z.string().default(""),
  scores: z.array(scoreItem),
  total: z.number(),
  comment: z.string(),
  status: z.string(),
  submittedAt: z.string(),
  updatedAt: z.string(),
});
export type OkrScoreView = z.infer<typeof scoreView>;

const metricSourceSchema = z.object({
  source: z.enum(OKR_METRIC_SOURCES).default("CRM_OPPORTUNITY"),
  agg: z.enum(["COUNT", "SUM", "AVG"]).default("COUNT"),
  field: z.string().default(""),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z
          .enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"])
          .default("eq"),
        value: z.unknown().optional(),
      }),
    )
    .default([]),
  dateField: z.string().default(""),
  dateRange: z.enum(["CYCLE", "NONE"]).default("CYCLE"),
  scope: z.enum(["MYSELF", "MY_DEPT", "ACCOUNT"]).default("ACCOUNT"),
  tableId: z.number().int().min(0).default(0),
  projectId: z.string().default(""),
  entityId: z.number().int().min(0).default(0),
  groupBy: z.string().default(""),
});
export type OkrMetricSource = z.output<typeof metricSourceSchema>;

const draftKr = z.object({
  title: z.string(),
  metricType: z.string().default("MANUAL"),
  targetValue: z.number().default(100),
  unit: z.string().default(""),
  direction: z.enum(["UP", "DOWN"]).default("UP"),
  weight: z.number().default(1),
  metricSource: metricSourceSchema.optional(),
});

const draftObjective = z.object({
  title: z.string(),
  description: z.string().default(""),
  level: z.enum(OKR_LEVELS).default("PERSONAL"),
  memberUserId: z.string().default(""),
  memberName: z.string().default(""),
  krs: z.array(draftKr).default([]),
});

const decomposeSuggestion = z.object({
  memberUserId: z.string(),
  memberName: z.string(),
  department: z.string().default(""),
  positions: z.array(positionSchema).default([]),
  capabilities: z.string().default(""),
  reason: z.string().default(""),
  krs: z.array(draftKr).default([]),
});

const draftPlan = z.object({
  title: z.string(),
  detail: z.string().default(""),
  kind: z.enum(OKR_PLAN_KINDS).default("WEEK"),
  periodKey: z.string().default(""),
  startDate: z.string().default(""),
  dueDate: z.string().default(""),
  priority: z.string().default("MEDIUM"),
  krId: z.number().default(0),
  objectiveId: z.number().default(0),
});

// ---------------------------------------------------------------------------
// OKR 2.0（2026-11-08）：目标书 → 对话澄清 → 多方案拆解 → 模拟 → 确认落库
// ---------------------------------------------------------------------------

export const OKR_BRIEF_STATUSES = [
  "DRAFT",
  "CLARIFYING",
  "READY",
  "COMMITTED",
  "CLOSED",
] as const;
export const OKR_BRIEF_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  CLARIFYING: "澄清中",
  READY: "待拆解",
  COMMITTED: "已落库",
  CLOSED: "已关闭",
};

export const OKR_OPTION_LABELS: Record<string, string> = {
  CONSERVATIVE: "稳健",
  BALANCED: "平衡",
  AGGRESSIVE: "进取",
};

export const OKR_DECOMPOSITION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "候选",
  CONFIRMED: "已确认",
  REJECTED: "已放弃",
};

const briefDeliverable = z.object({
  name: z.string().max(120),
  description: z.string().max(500).default(""),
  acceptance: z.string().max(500).default(""),
});

const briefLabor = z.object({
  role: z.string().max(64),
  headcount: z.number().min(0).default(1),
  hours: z.number().min(0).default(0),
  memberUserId: z.string().max(64).default(""),
});

const briefMaterial = z.object({
  name: z.string().max(120),
  qty: z.number().min(0).default(1),
  unitCost: z.number().min(0).default(0),
});

const briefEquipment = z.object({
  name: z.string().max(120),
  qty: z.number().min(0).default(1),
  unitCost: z.number().min(0).default(0),
  days: z.number().min(0).default(0),
});

const briefExternal = z.object({
  kind: z.string().max(16).default("VENDOR"),
  scope: z.string().max(300).default(""),
  budget: z.number().min(0).default(0),
  partyId: z.number().int().min(0).default(0),
});

export const okrBriefView = z.object({
  id: z.number(),
  cycleId: z.number(),
  title: z.string(),
  businessGoal: z.string(),
  scopeWhat: z.string(),
  scopeTarget: z.string(),
  deliverables: z.array(briefDeliverable),
  startDate: z.string(),
  endDate: z.string(),
  budgetAmount: z.number(),
  budgetHours: z.number(),
  currency: z.string(),
  labor: z.array(briefLabor),
  materials: z.array(briefMaterial),
  equipment: z.array(briefEquipment),
  externalServices: z.array(briefExternal),
  constraints: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  readiness: z.object({
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});
export type OkrBriefView = z.infer<typeof okrBriefView>;

const dialogTurnView = z.object({
  id: z.number(),
  role: z.string(),
  content: z.string(),
  structured: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const clarifyQuestion = z.object({
  key: z.string(),
  question: z.string(),
  why: z.string().default(""),
  options: z.array(z.string()).default([]),
  defaultValue: z.string().default(""),
  required: z.boolean().default(false),
});

const riskItem = z.object({
  risk: z.string(),
  impact: z.string().default(""),
  mitigation: z.string().default(""),
});

const acceptanceItem = z.object({
  key: z.string().default(""),
  label: z.string(),
  required: z.boolean().default(true),
  evidence: z.string().default(""),
});

const rubricLevel = z.object({
  level: z.string(),
  label: z.string(),
  description: z.string().default(""),
});

const krNode = z.object({
  key: z.string(),
  title: z.string(),
  metricType: z.string().default("MANUAL"),
  baseline: z.number().default(0),
  target: z.number().default(100),
  unit: z.string().default(""),
  direction: z.enum(["UP", "DOWN"]).default("UP"),
  weight: z.number().default(1),
  ownerMemberUserId: z.string().default(""),
  ownerName: z.string().default(""),
  metricSource: z.record(z.string(), z.unknown()).default({}),
  quality: z
    .object({
      ok: z.boolean().default(true),
      issues: z.array(z.string()).default([]),
    })
    .default({ ok: true, issues: [] }),
});

const objectiveNode = z.object({
  key: z.string(),
  level: z.enum(OKR_LEVELS).default("COMPANY"),
  title: z.string(),
  description: z.string().default(""),
  ownerMemberUserId: z.string().default(""),
  ownerName: z.string().default(""),
  weight: z.number().default(1),
  krs: z.array(krNode).default([]),
});

const taskNode = z.object({
  key: z.string(),
  objectiveKey: z.string().default(""),
  krKey: z.string().default(""),
  title: z.string(),
  detail: z.string().default(""),
  deliverable: z.string().default(""),
  acceptance: z.array(acceptanceItem).default([]),
  rubric: z.array(rubricLevel).default([]),
  weight: z.number().default(1),
  estimateHours: z.number().default(0),
  dueDate: z.string().default(""),
  priority: z.string().default("MEDIUM"),
  ownerMemberUserId: z.string().default(""),
  ownerName: z.string().default(""),
  dependencies: z.array(z.string()).default([]),
  externalPartyIds: z.array(z.number()).default([]),
});

const decompositionPayload = z.object({
  summary: z.string().default(""),
  mode: z.enum(["LLM", "RULE"]).default("RULE"),
  optionKey: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).default("BALANCED"),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(riskItem).default([]),
  objectives: z.array(objectiveNode).default([]),
  tasks: z.array(taskNode).default([]),
  cost: z
    .object({
      budgetAmount: z.number().default(0),
      internalCost: z.number().default(0),
      externalCost: z.number().default(0),
      laborHours: z.number().default(0),
    })
    .default({ budgetAmount: 0, internalCost: 0, externalCost: 0, laborHours: 0 }),
});
export type OkrDecompositionPayload = z.infer<typeof decompositionPayload>;

const simulationCheck = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["PASS", "WARN", "FAIL"]),
  detail: z.string().default(""),
});

export const okrSimulationView = z.object({
  feasible: z.boolean(),
  checks: z.array(simulationCheck),
  capacity: z.array(
    z.object({
      memberUserId: z.string(),
      name: z.string(),
      hours: z.number(),
      load: z.number(),
      ok: z.boolean(),
    }),
  ),
  budget: z.object({
    planned: z.number(),
    internal: z.number(),
    external: z.number(),
    remaining: z.number(),
  }),
  timeline: z.object({
    startDate: z.string(),
    endDate: z.string(),
    criticalDays: z.number(),
    deadlineDays: z.number(),
  }),
  notes: z.array(z.string()).default([]),
});
export type OkrSimulationView = z.infer<typeof okrSimulationView>;

export const okrDecompositionView = z.object({
  id: z.number(),
  briefId: z.number(),
  version: z.number(),
  mode: z.string(),
  optionKey: z.string(),
  optionLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  payload: decompositionPayload,
  simulation: okrSimulationView.nullable(),
  committedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OkrDecompositionView = z.infer<typeof okrDecompositionView>;

const taskLinkView = z.object({
  id: z.number(),
  objectiveId: z.number(),
  krId: z.number(),
  taskId: z.number(),
  taskTitle: z.string().default(""),
  weight: z.number(),
  targetValue: z.number(),
  acceptance: z.array(acceptanceItem),
  ownerMemberUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OkrTaskLinkView = z.infer<typeof taskLinkView>;

export const okrEndpoints = {
  // ---------- 概览 / 上下文 ----------
  Okr_overview: {
    method: "get" as const,
    path: "/enterprise/okr/overview",
    params: z.object({}),
    query: z.object({ cycleId: z.coerce.number().int().optional() }),
    body: z.undefined(),
    response: envelope(
      z.object({
        cycles: z.array(cycleView),
        currentCycle: cycleView.nullable(),
        completion: z.number(),
        pendingObjectives: z.number(),
        pendingReports: z.number(),
        overduePlans: z.number(),
        todoScores: z.number().default(0),
      }),
    ),
  },
  Okr_context: {
    method: "get" as const,
    path: "/enterprise/okr/context",
    params: z.object({}),
    query: z.object({ cycleId: z.coerce.number().int().optional() }),
    body: z.undefined(),
    response: envelope(
      z.object({
        ownerUserId: z.string(),
        me: memberView.partial({ memberUserId: true, name: true }),
        isOwner: z.boolean(),
        isManager: z.boolean(),
        cycle: cycleView.nullable(),
        cycles: z.array(cycleView),
        members: z.array(memberView),
        objectives: z.array(objectiveView),
        plans: z.array(planView),
        metricSources: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            fields: z.array(z.string()),
            aggs: z.array(z.string()),
          }),
        ),
        scoreDimensions: z.array(
          z.object({ key: z.string(), label: z.string(), weight: z.number() }),
        ),
        settings: z.record(z.string(), z.unknown()),
      }),
    ),
  },

  // ---------- 周期 ----------
  Okr_cycleList: {
    method: "get" as const,
    path: "/enterprise/okr/cycles",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(cycleView)),
  },
  Okr_cycleSave: {
    method: "post" as const,
    path: "/enterprise/okr/cycles",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      kind: z.enum(OKR_CYCLE_KINDS),
      year: z.number().int().min(2000).max(2100),
      period: z.number().int().min(0).max(12).default(0),
      title: z.string().max(120).default(""),
      startDate: z.string().default(""),
      endDate: z.string().default(""),
      status: z.enum(OKR_CYCLE_STATUSES).optional(),
    }),
    response: envelope(cycleView),
  },
  Okr_cycleClose: {
    method: "post" as const,
    path: "/enterprise/okr/cycles/:id/close",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(cycleView),
  },

  // ---------- 目标 / KR ----------
  Okr_objectiveList: {
    method: "get" as const,
    path: "/enterprise/okr/objectives",
    params: z.object({}),
    query: z.object({
      cycleId: z.coerce.number().int().optional(),
      memberUserId: z.string().optional(),
      parentId: z.coerce.number().int().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(objectiveView)),
  },
  Okr_objectiveDetail: {
    method: "get" as const,
    path: "/enterprise/okr/objectives/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(objectiveView),
  },
  Okr_objectiveSave: {
    method: "post" as const,
    path: "/enterprise/okr/objectives",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      cycleId: z.number().int().min(1),
      parentId: z.number().int().min(0).default(0),
      level: z.enum(OKR_LEVELS).default("PERSONAL"),
      title: z.string().min(1).max(200),
      description: z.string().max(2000).default(""),
      ownerMemberUserId: z.string().max(64).default(""),
      weight: z.number().min(0).max(100).default(1),
      visibility: z.enum(OKR_VISIBILITIES).default("ORG"),
      status: z
        .enum(["DRAFT", "ACTIVE", "DONE", "CANCELLED"])
        .default("ACTIVE"),
      source: z.enum(["MANUAL", "AGENT"]).default("MANUAL"),
      krs: z.array(draftKr).max(20).default([]),
    }),
    response: envelope(objectiveView),
  },
  Okr_objectiveDelete: {
    method: "delete" as const,
    path: "/enterprise/okr/objectives/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Okr_objectiveAssign: {
    method: "post" as const,
    path: "/enterprise/okr/objectives/:id/assign",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      memberUserIds: z.array(z.string()).min(1),
      generatePlan: z.enum(["NONE", "WEEK", "DAY"]).default("NONE"),
      krTitles: z.array(z.string()).default([]),
      source: z.enum(["MANUAL", "AGENT"]).default("MANUAL"),
    }),
    response: envelope(
      z.object({
        objectives: z.array(objectiveView),
        plans: z.array(planView),
      }),
    ),
  },

  // ---------- 草稿（不落库） ----------
  Okr_draftObjective: {
    method: "post" as const,
    path: "/enterprise/okr/drafts/objective",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      cycleId: z.number().int().min(0).default(0),
      direction: z.string().min(1).max(500),
      level: z.enum(OKR_LEVELS).default("COMPANY"),
      memberUserId: z.string().default(""),
      krCount: z.number().int().min(2).max(5).default(3),
    }),
    response: envelope(
      z.object({
        objective: draftObjective,
        notes: z.array(z.string()).default([]),
      }),
    ),
  },
  Okr_decomposeSuggest: {
    method: "post" as const,
    path: "/enterprise/okr/drafts/decompose",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      objectiveId: z.number().int().min(1),
      memberUserIds: z.array(z.string()).default([]),
    }),
    response: envelope(
      z.object({
        suggestions: z.array(decomposeSuggestion),
        notes: z.array(z.string()).default([]),
      }),
    ),
  },
  Okr_planGenerate: {
    method: "post" as const,
    path: "/enterprise/okr/drafts/plans",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      kind: z.enum(["WEEK", "DAY"]).default("WEEK"),
      memberUserId: z.string().default(""),
      cycleId: z.number().int().min(0).default(0),
    }),
    response: envelope(
      z.object({
        periodKey: z.string(),
        plans: z.array(draftPlan),
        notes: z.array(z.string()).default([]),
      }),
    ),
  },

  Okr_krSave: {
    method: "post" as const,
    path: "/enterprise/okr/key-results",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      objectiveId: z.number().int().min(1),
      title: z.string().min(1).max(200),
      metricType: z.enum(OKR_METRIC_TYPES).default("MANUAL"),
      targetValue: z.number().default(100),
      currentValue: z.number().default(0),
      startValue: z.number().default(0),
      unit: z.string().max(32).default(""),
      direction: z.enum(["UP", "DOWN"]).default("UP"),
      weight: z.number().min(0).max(100).default(1),
      ownerMemberUserId: z.string().max(64).default(""),
      metricSource: metricSourceSchema.partial().optional(),
    }),
    response: envelope(krView),
  },
  Okr_krDelete: {
    method: "delete" as const,
    path: "/enterprise/okr/key-results/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Okr_krProgress: {
    method: "post" as const,
    path: "/enterprise/okr/key-results/:id/progress",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      currentValue: z.number().optional(),
      note: z.string().max(500).default(""),
    }),
    response: envelope(z.object({ kr: krView, progress: z.number() })),
  },
  Okr_progressList: {
    method: "get" as const,
    path: "/enterprise/okr/progress",
    params: z.object({}),
    query: z.object({
      krId: z.coerce.number().int().optional(),
      objectiveId: z.coerce.number().int().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(progressLogView)),
  },

  // ---------- 自动指标 ----------
  Okr_metricPreview: {
    method: "post" as const,
    path: "/enterprise/okr/metrics/preview",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      cycleId: z.number().int().min(0).default(0),
      metricSource: metricSourceSchema,
    }),
    response: envelope(
      z.object({
        value: z.number(),
        ok: z.boolean(),
        message: z.string().default(""),
        rangeStart: z.string().default(""),
        rangeEnd: z.string().default(""),
      }),
    ),
  },
  Okr_metricRefresh: {
    method: "post" as const,
    path: "/enterprise/okr/metrics/refresh",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      krId: z.number().int().min(0).default(0),
      cycleId: z.number().int().min(0).default(0),
    }),
    response: envelope(
      z.object({
        refreshed: z.number(),
        failed: z.number(),
        message: z.string().default(""),
        items: z.array(
          z.object({
            krId: z.number(),
            value: z.number(),
            ok: z.boolean(),
            message: z.string(),
          }),
        ),
      }),
    ),
  },

  // ---------- 计划 ----------
  Okr_planList: {
    method: "get" as const,
    path: "/enterprise/okr/plans",
    params: z.object({}),
    query: z.object({
      kind: z.enum(OKR_PLAN_KINDS).optional(),
      periodKey: z.string().optional(),
      memberUserId: z.string().optional(),
      status: z.string().optional(),
      cycleId: z.coerce.number().int().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(planView)),
  },
  Okr_planSave: {
    method: "post" as const,
    path: "/enterprise/okr/plans",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      memberUserId: z.string().max(64).default(""),
      objectiveId: z.number().int().min(0).default(0),
      krId: z.number().int().min(0).default(0),
      title: z.string().min(1).max(200),
      detail: z.string().max(2000).default(""),
      kind: z.enum(OKR_PLAN_KINDS).default("ADHOC"),
      periodKey: z.string().max(16).default(""),
      startDate: z.string().default(""),
      dueDate: z.string().default(""),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
      source: z.enum(["MANUAL", "AGENT"]).default("MANUAL"),
    }),
    response: envelope(planView),
  },
  Okr_planUpdate: {
    method: "post" as const,
    path: "/enterprise/okr/plans/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      title: z.string().max(200).optional(),
      detail: z.string().max(2000).optional(),
      status: z.enum(OKR_PLAN_STATUSES).optional(),
      progress: z.number().min(0).max(100).optional(),
      dueDate: z.string().optional(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    }),
    response: envelope(planView),
  },
  Okr_planDelete: {
    method: "delete" as const,
    path: "/enterprise/okr/plans/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Okr_planLinkSchedule: {
    method: "post" as const,
    path: "/enterprise/okr/plans/:id/schedule",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ scheduleId: z.number().int().min(0).default(0) }),
    response: envelope(planView),
  },

  // ---------- 汇报 ----------
  Okr_reportList: {
    method: "get" as const,
    path: "/enterprise/okr/reports",
    params: z.object({}),
    query: z.object({
      kind: z.enum(OKR_REPORT_KINDS).default("DAILY"),
      periodKey: z.string().optional(),
      memberUserId: z.string().optional(),
      scope: z.enum(["MINE", "ALL"]).default("MINE"),
    }),
    body: z.undefined(),
    response: envelope(z.array(reportView)),
  },
  Okr_reportGet: {
    method: "get" as const,
    path: "/enterprise/okr/reports/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(reportView),
  },
  Okr_reportSaveDraft: {
    method: "post" as const,
    path: "/enterprise/okr/reports/draft",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      kind: z.enum(OKR_REPORT_KINDS),
      periodKey: z.string().max(16).default(""),
      memberUserId: z.string().max(64).default(""),
      content: z.record(z.string(), z.unknown()).default({}),
      source: z.enum(["MANUAL", "AGENT_AUTO", "SYSTEM"]).default("MANUAL"),
      scheduleId: z.number().int().min(0).default(0),
    }),
    response: envelope(reportView),
  },
  Okr_reportSubmit: {
    method: "post" as const,
    path: "/enterprise/okr/reports/:id/submit",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(reportView),
  },
  Okr_reportWithdraw: {
    method: "post" as const,
    path: "/enterprise/okr/reports/:id/withdraw",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(reportView),
  },
  Okr_reportComment: {
    method: "post" as const,
    path: "/enterprise/okr/reports/:id/comment",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ comment: z.string().max(500).default("") }),
    response: envelope(reportView),
  },
  Okr_reportGenerate: {
    method: "post" as const,
    path: "/enterprise/okr/reports/generate",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      kind: z.enum(OKR_REPORT_KINDS).default("DAILY"),
      periodKey: z.string().max(16).default(""),
      memberUserId: z.string().max(64).default(""),
      overwrite: z.boolean().default(false),
    }),
    response: envelope(reportView),
  },

  // ---------- 统计 / 导出 ----------
  Okr_stats: {
    method: "get" as const,
    path: "/enterprise/okr/stats",
    params: z.object({}),
    query: z.object({ cycleId: z.coerce.number().int().optional() }),
    body: z.undefined(),
    response: envelope(
      z.object({
        cycle: cycleView.nullable(),
        completion: z.number(),
        objectiveCount: z.number(),
        krCount: z.number(),
        memberRanking: z.array(
          z.object({
            memberUserId: z.string(),
            memberName: z.string(),
            department: z.string().default(""),
            objectives: z.number(),
            progress: z.number(),
            reports: z.number(),
            avgScore: z.number().default(0),
          }),
        ),
        krTrend: z.array(z.object({ date: z.string(), progress: z.number() })),
        scoreDistribution: z.array(
          z.object({
            memberUserId: z.string(),
            memberName: z.string(),
            avg: z.number(),
          }),
        ),
        scoreDimensions: z.array(
          z.object({ key: z.string(), label: z.string(), weight: z.number() }),
        ),
        summary: z.array(z.string()).default([]),
      }),
    ),
  },
  Okr_export: {
    method: "get" as const,
    path: "/enterprise/okr/export",
    params: z.object({}),
    query: z.object({ cycleId: z.coerce.number().int().optional() }),
    body: z.undefined(),
    response: envelope(
      z.object({ filename: z.string(), content: z.string(), rows: z.number() }),
    ),
  },

  // ---------- 评分 ----------
  Okr_scoreList: {
    method: "get" as const,
    path: "/enterprise/okr/scores",
    params: z.object({}),
    query: z.object({
      cycleId: z.coerce.number().int().optional(),
      scope: z.enum(["GIVEN", "RECEIVED", "ALL"]).default("ALL"),
    }),
    body: z.undefined(),
    response: envelope(
      z.object({
        cycleId: z.number(),
        dimensions: z.array(
          z.object({ key: z.string(), label: z.string(), weight: z.number() }),
        ),
        candidates: z.array(memberView),
        items: z.array(scoreView),
        averages: z.array(
          z.object({
            memberUserId: z.string(),
            memberName: z.string(),
            average: z.number(),
            reviewers: z.number(),
          }),
        ),
      }),
    ),
  },
  Okr_scoreSave: {
    method: "post" as const,
    path: "/enterprise/okr/scores",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      cycleId: z.number().int().min(1),
      memberUserId: z.string().min(1),
      scores: z.array(scoreItem).min(1),
      comment: z.string().max(500).default(""),
      submit: z.boolean().default(false),
    }),
    response: envelope(scoreView),
  },
  Okr_scoreWithdraw: {
    method: "post" as const,
    path: "/enterprise/okr/scores/:id/withdraw",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(scoreView),
  },

  // ---------- 设置 ----------
  Okr_settingsGet: {
    method: "get" as const,
    path: "/enterprise/okr/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        managers: z.array(z.string()),
        defaultVisibility: z.string(),
        weekStart: z.number(),
        autoDraftEnabled: z.boolean(),
        reportTemplates: z.record(z.string(), z.unknown()),
        reportSchedules: z.record(z.string(), z.unknown()),
        scoreDimensions: z.array(
          z.object({ key: z.string(), label: z.string(), weight: z.number() }),
        ),
        metricRefreshHour: z.number(),
        members: z.array(memberView),
        isOwner: z.boolean(),
      }),
    ),
  },
  Okr_settingsSave: {
    method: "post" as const,
    path: "/enterprise/okr/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      managers: z.array(z.string()).optional(),
      defaultVisibility: z.enum(OKR_VISIBILITIES).optional(),
      weekStart: z.number().int().min(0).max(6).optional(),
      autoDraftEnabled: z.boolean().optional(),
      reportTemplates: z.record(z.string(), z.unknown()).optional(),
      reportSchedules: z.record(z.string(), z.unknown()).optional(),
      scoreDimensions: z
        .array(
          z.object({ key: z.string(), label: z.string(), weight: z.number() }),
        )
        .optional(),
      metricRefreshHour: z.number().int().min(0).max(23).optional(),
    }),
    response: envelope(
      z.object({
        managers: z.array(z.string()),
        defaultVisibility: z.string(),
        weekStart: z.number(),
        autoDraftEnabled: z.boolean(),
        reportTemplates: z.record(z.string(), z.unknown()),
        reportSchedules: z.record(z.string(), z.unknown()),
        scoreDimensions: z.array(
          z.object({ key: z.string(), label: z.string(), weight: z.number() }),
        ),
        metricRefreshHour: z.number(),
      }),
    ),
  },

  // ---------- 目标书（OKR 2.0） ----------
  Okr_briefList: {
    method: "get" as const,
    path: "/enterprise/okr/briefs",
    params: z.object({}),
    query: z.object({
      cycleId: z.coerce.number().int().optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(okrBriefView)),
  },
  Okr_briefGet: {
    method: "get" as const,
    path: "/enterprise/okr/briefs/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(okrBriefView),
  },
  Okr_briefSave: {
    method: "post" as const,
    path: "/enterprise/okr/briefs",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      cycleId: z.number().int().min(0).default(0),
      title: z.string().min(1).max(200),
      businessGoal: z.string().max(5000).default(""),
      scopeWhat: z.string().max(3000).default(""),
      scopeTarget: z.string().max(3000).default(""),
      deliverables: z.array(briefDeliverable).max(50).default([]),
      startDate: z.string().max(16).default(""),
      endDate: z.string().max(16).default(""),
      budgetAmount: z.number().min(0).default(0),
      budgetHours: z.number().min(0).default(0),
      currency: z.string().max(8).default("CNY"),
      labor: z.array(briefLabor).max(50).default([]),
      materials: z.array(briefMaterial).max(50).default([]),
      equipment: z.array(briefEquipment).max(50).default([]),
      externalServices: z.array(briefExternal).max(50).default([]),
      constraints: z.string().max(3000).default(""),
      status: z.enum(OKR_BRIEF_STATUSES).optional(),
    }),
    response: envelope(okrBriefView),
  },
  Okr_briefRemove: {
    method: "post" as const,
    path: "/enterprise/okr/briefs/:id/remove",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number(), removed: z.boolean() })),
  },

  // ---------- 互动澄清 ----------
  Okr_dialogList: {
    method: "get" as const,
    path: "/enterprise/okr/briefs/:id/dialog",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(dialogTurnView)),
  },
  Okr_dialogSend: {
    method: "post" as const,
    path: "/enterprise/okr/briefs/:id/dialog",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      message: z.string().max(3000).default(""),
      answers: z.record(z.string(), z.string()).default({}),
    }),
    response: envelope(
      z.object({
        turns: z.array(dialogTurnView),
        questions: z.array(clarifyQuestion),
        assumptions: z.array(z.string()),
        risks: z.array(riskItem),
        readyToDecompose: z.boolean(),
        mode: z.enum(["LLM", "RULE"]),
      }),
    ),
  },

  // ---------- 拆解方案 ----------
  Okr_decompositionList: {
    method: "get" as const,
    path: "/enterprise/okr/briefs/:id/decompositions",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(okrDecompositionView)),
  },
  Okr_decompositionGenerate: {
    method: "post" as const,
    path: "/enterprise/okr/briefs/:id/decompositions",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      optionKey: z
        .enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"])
        .optional(),
      forceRule: z.boolean().default(false),
    }),
    response: envelope(z.array(okrDecompositionView)),
  },
  Okr_decompositionSimulate: {
    method: "post" as const,
    path: "/enterprise/okr/decompositions/:id/simulate",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(okrDecompositionView),
  },
  Okr_decompositionCommit: {
    method: "post" as const,
    path: "/enterprise/okr/decompositions/:id/commit",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      /** 人工闸门：必须显式确认，缺了直接 400。 */
      confirmed: z.literal(true),
      createProject: z.boolean().default(false),
      projectId: z.number().int().min(0).default(0),
      projectName: z.string().max(200).default(""),
    }),
    response: envelope(
      z.object({
        decompositionId: z.number(),
        projectId: z.number(),
        objectives: z.array(objectiveView),
        tasks: z.array(
          z.object({
            id: z.number(),
            title: z.string(),
            objectiveId: z.number(),
            krId: z.number(),
            ownerMemberUserId: z.string(),
          }),
        ),
        links: z.array(taskLinkView),
      }),
    ),
  },

  // ---------- 任务关联与考核 ----------
  Okr_taskLinkList: {
    method: "get" as const,
    path: "/enterprise/okr/task-links",
    params: z.object({}),
    query: z.object({
      objectiveId: z.coerce.number().int().optional(),
      krId: z.coerce.number().int().optional(),
      taskId: z.coerce.number().int().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(taskLinkView)),
  },
  Okr_taskLinkSave: {
    method: "post" as const,
    path: "/enterprise/okr/task-links",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      objectiveId: z.number().int().min(1),
      krId: z.number().int().min(0).default(0),
      taskId: z.number().int().min(1),
      weight: z.number().min(0).default(1),
      targetValue: z.number().default(0),
      acceptance: z.array(acceptanceItem).max(30).default([]),
      ownerMemberUserId: z.string().max(64).default(""),
    }),
    response: envelope(taskLinkView),
  },
  Okr_taskLinkRemove: {
    method: "post" as const,
    path: "/enterprise/okr/task-links/:id/remove",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number(), removed: z.boolean() })),
  },
  Okr_assessmentPreview: {
    method: "get" as const,
    path: "/enterprise/okr/assessment-preview",
    params: z.object({}),
    query: z.object({
      cycleId: z.coerce.number().int().optional(),
      memberUserId: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(
      z.object({
        cycleId: z.number(),
        memberUserId: z.string(),
        memberName: z.string(),
        items: z.array(
          z.object({
            taskId: z.number(),
            taskTitle: z.string(),
            objectiveId: z.number(),
            krId: z.number(),
            weight: z.number(),
            status: z.string(),
            acceptanceTotal: z.number(),
            acceptanceDone: z.number(),
            evidence: z.array(z.string()),
          }),
        ),
        krScore: z.number(),
        taskScore: z.number(),
        okrScore: z.number(),
        notes: z.array(z.string()).default([]),
      }),
    ),
  },
};

export type OkrOverview = z.infer<
  typeof okrEndpoints.Okr_overview.response
>["data"];
