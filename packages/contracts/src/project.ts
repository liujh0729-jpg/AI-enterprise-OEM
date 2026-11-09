import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * §5.2 项目 / 任务 / 工时（`Pj_*`）：项目主档、成员多态、迭代、里程碑、任务与依赖、
 * 工时流水与周表。组织键复用 HRM 的 (orgType, orgUserId) 口径；
 * 成员/负责人支持 STAFF 职员与 ASSIGNMENT 代理人两种主体。
 */

export const PJ_PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ACCEPTING", "CLOSED", "CANCELED"] as const;
export const PJ_PROJECT_STATUS_LABELS: Record<string, string> = {
  PLANNING: "立项中",
  ACTIVE: "进行中",
  ACCEPTING: "验收中",
  CLOSED: "已关闭",
  CANCELED: "已取消",
};
export const PJ_TASK_TYPES = ["STORY", "TASK", "BUG", "TIMESHEET"] as const;
export const PJ_TASK_TYPE_LABELS: Record<string, string> = {
  STORY: "需求",
  TASK: "任务",
  BUG: "缺陷",
  TIMESHEET: "工时单",
};
export const PJ_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const PJ_PRIORITY_LABELS: Record<string, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  URGENT: "紧急",
};
export const PJ_TASK_STATUSES = ["TODO", "DOING", "REVIEW", "DONE", "CANCELED"] as const;
export const PJ_TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "待办",
  DOING: "进行中",
  REVIEW: "待验收",
  DONE: "已完成",
  CANCELED: "已取消",
};
export const PJ_PRINCIPAL_TYPES = ["STAFF", "ASSIGNMENT"] as const;
export const PJ_ASSIGNEE_TYPES = ["NONE", "STAFF", "ASSIGNMENT", "PARTY"] as const;
export const PJ_MEMBER_ROLES = ["OWNER", "MEMBER", "APPROVER"] as const;
export const PJ_COST_KINDS = ["LABOR", "MATERIAL", "EQUIPMENT", "EXTERNAL", "OTHER"] as const;
export const PJ_COST_KIND_LABELS: Record<string, string> = {
  LABOR: "人工",
  MATERIAL: "物料",
  EQUIPMENT: "设备",
  EXTERNAL: "外部服务",
  OTHER: "其他",
};
export const PJ_COST_SOURCE_LABELS: Record<string, string> = {
  MANUAL: "手工登记",
  TIMESHEET: "工时审批",
  ERP_PO: "采购单",
  ENGAGEMENT: "外部合作",
};
export const PJ_RATE_PRINCIPAL_TYPES = ["STAFF", "ASSIGNMENT", "PARTY"] as const;
export const PJ_ENGAGEMENT_STATUSES = ["DRAFT", "ACTIVE", "ACCEPTING", "SETTLED", "CANCELED"] as const;
export const PJ_ENGAGEMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "履约中",
  ACCEPTING: "待验收",
  SETTLED: "已结算",
  CANCELED: "已取消",
};
export const PJ_TIMELOG_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export const PJ_TIMESHEET_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;

export const pjProjectSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  source: z.enum(["MANUAL", "CRM_ORDER"]),
  sourceRef: z.string(),
  customerName: z.string(),
  contractId: z.number(),
  ownerId: z.string(),
  ownerName: z.string(),
  status: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  budgetAmount: z.string(),
  budgetHours: z.string(),
  currency: z.string(),
  memberCount: z.number(),
  taskTotal: z.number(),
  taskDone: z.number(),
  progress: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const pjProjectDetailSchema = pjProjectSchema.extend({
  members: z.array(
    z.object({
      id: z.number(),
      principalType: z.string(),
      principalId: z.string(),
      name: z.string(),
      role: z.string(),
      allocationPct: z.number(),
      createdAt: z.string(),
    }),
  ),
  milestones: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      dueDate: z.string(),
      status: z.string(),
      deliverable: z.string(),
      acceptanceNote: z.string(),
    }),
  ),
});
export const pjSprintSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  name: z.string(),
  goal: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  capacityHours: z.string(),
  status: z.string(),
  taskTotal: z.number(),
  taskDone: z.number(),
  createdAt: z.string(),
});
export const pjMilestoneSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  name: z.string(),
  dueDate: z.string(),
  status: z.string(),
  deliverable: z.string(),
  acceptanceNote: z.string(),
  createdAt: z.string(),
});
export const pjTaskSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  projectName: z.string(),
  sprintId: z.number(),
  milestoneId: z.number(),
  parentId: z.number(),
  title: z.string(),
  description: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  acceptanceCriteria: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      required: z.boolean(),
      evidence: z.string(),
    }),
  ),
  qualityRubric: z.record(z.string(), z.unknown()),
  assessmentWeight: z.string(),
  type: z.string(),
  priority: z.string(),
  status: z.string(),
  assigneeType: z.string(),
  assigneeId: z.string(),
  assigneeName: z.string(),
  estimateHours: z.string(),
  estimatePoints: z.number(),
  startDate: z.string(),
  dueDate: z.string(),
  completedAt: z.string(),
  sortOrder: z.number(),
  loggedMinutes: z.number(),
  relations: z.array(z.object({ id: z.number(), relatedTaskId: z.number(), kind: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const pjTimeLogSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  projectName: z.string(),
  taskId: z.number(),
  taskTitle: z.string(),
  principalType: z.string(),
  principalId: z.string(),
  principalName: z.string(),
  workDate: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  durationMinutes: z.number(),
  note: z.string(),
  source: z.string(),
  status: z.string(),
  approvedBy: z.string(),
  approvedAt: z.string(),
  createdAt: z.string(),
});
export const pjTimesheetSchema = z.object({
  id: z.number(),
  principalType: z.string(),
  principalId: z.string(),
  principalName: z.string(),
  projectId: z.number(),
  projectName: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalMinutes: z.number(),
  status: z.string(),
  approverId: z.string(),
  decidedAt: z.string(),
  note: z.string(),
  createdAt: z.string(),
});
export const pjSettingsSchema = z.object({
  statuses: z.array(z.string()),
  taskTypes: z.array(z.string()),
  currency: z.string(),
  standardHoursPerDay: z.number(),
  updatedAt: z.string(),
});
export const pjOverviewSchema = z.object({
  activeProjects: z.number(),
  openTasks: z.number(),
  overdueTasks: z.number(),
  weekLoggedMinutes: z.number(),
  approvalPending: z.number(),
  utilization: z.number(),
  riskProjects: z.number(),
});
export const pjRiskSchema = z.object({
  projectId: z.number(),
  projectName: z.string(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reasons: z.array(z.string()),
  suggestions: z.array(z.string()),
  overdueTasks: z.number(),
  totalTasks: z.number(),
  loggedMinutes: z.number(),
  budgetMinutes: z.number(),
});

export const saveProjectBodySchema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().max(32).default(""),
  name: z.string().min(1).max(120),
  description: z.string().max(20000).default(""),
  source: z.enum(["MANUAL", "CRM_ORDER"]).default("MANUAL"),
  sourceRef: z.string().max(64).default(""),
  customerName: z.string().max(120).default(""),
  contractId: z.number().int().min(0).default(0),
  ownerId: z.string().max(64).default(""),
  status: z.enum(PJ_PROJECT_STATUSES).default("PLANNING"),
  startDate: z.string().max(16).default(""),
  endDate: z.string().max(16).default(""),
  budgetAmount: z.number().min(0).default(0),
  budgetHours: z.number().min(0).default(0),
  currency: z.string().max(8).default("CNY"),
});
export const saveProjectMemberBodySchema = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  principalType: z.enum(PJ_PRINCIPAL_TYPES).default("STAFF"),
  principalId: z.string().min(1).max(64),
  role: z.enum(PJ_MEMBER_ROLES).default("MEMBER"),
  allocationPct: z.number().int().min(0).max(100).default(100),
});
export const saveSprintBodySchema = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  name: z.string().min(1).max(80),
  goal: z.string().max(500).default(""),
  startDate: z.string().max(16).default(""),
  endDate: z.string().max(16).default(""),
  capacityHours: z.number().min(0).default(0),
  status: z.enum(["PLANNED", "ACTIVE", "CLOSED"]).default("PLANNED"),
});
export const saveMilestoneBodySchema = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  name: z.string().min(1).max(120),
  dueDate: z.string().max(16).default(""),
  status: z.enum(["TODO", "DONE"]).default("TODO"),
  deliverable: z.string().max(500).default(""),
  acceptanceNote: z.string().max(500).default(""),
});
export const saveTaskBodySchema = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  sprintId: z.number().int().min(0).default(0),
  milestoneId: z.number().int().min(0).default(0),
  parentId: z.number().int().min(0).default(0),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).default(""),
  sourceType: z.enum(["MANUAL", "OKR", "CRM_ORDER", "DEMAND", "OA"]).default("MANUAL"),
  sourceId: z.string().max(64).default(""),
  acceptanceCriteria: z
    .array(
      z.object({
        key: z.string().max(64).default(""),
        label: z.string().max(200),
        required: z.boolean().default(false),
        evidence: z.string().max(200).default(""),
      }),
    )
    .max(20)
    .default([]),
  qualityRubric: z.record(z.string(), z.unknown()).default({}),
  assessmentWeight: z.number().min(0).max(100).default(1),
  type: z.enum(PJ_TASK_TYPES).default("TASK"),
  priority: z.enum(PJ_PRIORITIES).default("MEDIUM"),
  status: z.enum(PJ_TASK_STATUSES).default("TODO"),
  assigneeType: z.enum(PJ_ASSIGNEE_TYPES).default("NONE"),
  assigneeId: z.string().max(64).default(""),
  estimateHours: z.number().min(0).max(10000).default(0),
  estimatePoints: z.number().int().min(0).max(1000).default(0),
  startDate: z.string().max(16).default(""),
  dueDate: z.string().max(16).default(""),
  sortOrder: z.number().int().default(0),
});
export const moveTaskBodySchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(PJ_TASK_STATUSES),
  sortOrder: z.number().int().optional(),
});
export const taskRelationBodySchema = z.object({
  taskId: z.number().int().positive(),
  relatedTaskId: z.number().int().positive(),
  kind: z.enum(["FS", "SS", "FF", "SF"]).default("FS"),
});
export const wbsSuggestBodySchema = z.object({
  projectId: z.number().int().positive(),
  requirement: z.string().min(1).max(2000),
  maxTasks: z.number().int().min(1).max(30).default(8),
});
export const wbsSuggestResultSchema = z.object({
  mode: z.enum(["llm", "rule"]),
  tasks: z.array(
    z.object({
      title: z.string(),
      type: z.string(),
      priority: z.string(),
      estimateHours: z.number(),
      assigneeId: z.string(),
      assigneeName: z.string(),
      reason: z.string(),
    }),
  ),
});
export const projectInsightBodySchema = z.object({
  projectId: z.number().int().positive(),
});
export const projectInsightSchema = z.object({
  projectId: z.number(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  progress: z.number(),
  overdueTasks: z.number(),
  loggedMinutes: z.number(),
  budgetMinutes: z.number(),
  costEstimate: z.string(),
  reasons: z.array(z.string()),
  suggestions: z.array(z.string()),
  mode: z.enum(["llm", "rule"]),
});
export const addTimeLogBodySchema = z.object({
  projectId: z.number().int().positive(),
  taskId: z.number().int().min(0).default(0),
  workDate: z.string().min(10).max(16),
  startAt: z.string().max(32).default(""),
  endAt: z.string().max(32).default(""),
  durationMinutes: z.number().int().min(0).max(1440),
  note: z.string().max(500).default(""),
  source: z.enum(["TIMER", "MANUAL", "FEISHU", "WECOM"]).default("MANUAL"),
});
export const startTimerBodySchema = z.object({
  projectId: z.number().int().positive(),
  taskId: z.number().int().min(0).default(0),
  note: z.string().max(500).default(""),
});
export const stopTimerBodySchema = z.object({
  id: z.number().int().positive(),
  durationMinutes: z.number().int().min(0).max(1440).optional(),
  note: z.string().max(500).default(""),
});
export const decideTimeLogBodySchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).default(""),
});
export const generateTimesheetBodySchema = z.object({
  principalType: z.enum(PJ_PRINCIPAL_TYPES).default("STAFF"),
  principalId: z.string().min(1).max(64),
  periodStart: z.string().min(10).max(16),
  periodEnd: z.string().min(10).max(16),
});
export const decideTimesheetBodySchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).default(""),
});
export const saveProjectSettingsBodySchema = z.object({
  statuses: z.array(z.string().max(16)).max(12).default([]),
  taskTypes: z.array(z.string().max(16)).max(12).default([]),
  currency: z.string().max(8).default("CNY"),
  standardHoursPerDay: z.number().min(1).max(24).default(8),
});

export const pjCostRateSchema = z.object({
  id: z.number(),
  principalType: z.string(),
  principalId: z.string(),
  principalName: z.string(),
  role: z.string(),
  hourlyRate: z.string(),
  dailyRate: z.string(),
  currency: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const saveCostRateBodySchema = z.object({
  id: z.number().int().positive().optional(),
  principalType: z.enum(PJ_RATE_PRINCIPAL_TYPES).default("STAFF"),
  principalId: z.string().min(1).max(64),
  role: z.string().max(64).default(""),
  hourlyRate: z.number().min(0).max(1_000_000).default(0),
  dailyRate: z.number().min(0).max(10_000_000).default(0),
  currency: z.string().max(8).default("CNY"),
  effectiveFrom: z.string().max(16).default(""),
  effectiveTo: z.string().max(16).default(""),
});

export const pjCostItemSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  projectName: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  title: z.string(),
  qty: z.string(),
  unit: z.string(),
  unitCost: z.string(),
  amount: z.string(),
  currency: z.string(),
  sourceType: z.string(),
  sourceTypeLabel: z.string(),
  sourceId: z.string(),
  occurredAt: z.string(),
  note: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const saveCostItemBodySchema = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  kind: z.enum(PJ_COST_KINDS).default("OTHER"),
  title: z.string().max(120).default(""),
  qty: z.number().min(0).max(1_000_000).default(1),
  unit: z.string().max(16).default(""),
  unitCost: z.number().min(0).max(100_000_000).default(0),
  currency: z.string().max(8).default("CNY"),
  occurredAt: z.string().max(16).default(""),
  note: z.string().max(500).default(""),
});

export const pjCostKindLineSchema = z.object({
  kind: z.string(),
  label: z.string(),
  amount: z.string(),
  items: z.number(),
});
export const pjCostSummarySchema = z.object({
  projectId: z.number(),
  currency: z.string(),
  budgetAmount: z.string(),
  budgetHours: z.string(),
  costTotal: z.string(),
  budgetUtilizationPct: z.number(),
  laborAmount: z.string(),
  materialAmount: z.string(),
  equipmentAmount: z.string(),
  externalAmount: z.string(),
  otherAmount: z.string(),
  timeLogMinutes: z.number(),
  timeLogHours: z.string(),
  missingRateMinutes: z.number(),
  engagementAmount: z.string(),
  engagementCount: z.number(),
  settledEngagementCount: z.number(),
  costItemCount: z.number(),
  byKind: z.array(pjCostKindLineSchema),
});

export const pjEngagementSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  projectName: z.string(),
  partyId: z.number(),
  partyName: z.string(),
  partyKind: z.string(),
  partyKindLabel: z.string(),
  scope: z.string(),
  contractId: z.number(),
  amount: z.string(),
  currency: z.string(),
  paymentTerms: z.string(),
  acceptance: z.record(z.string(), z.unknown()),
  startDate: z.string(),
  endDate: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const saveEngagementBodySchema = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  partyId: z.number().int().positive(),
  scope: z.string().max(500).default(""),
  contractId: z.number().int().min(0).default(0),
  amount: z.number().min(0).max(1_000_000_000).default(0),
  currency: z.string().max(8).default("CNY"),
  paymentTerms: z.string().max(200).default(""),
  acceptance: z.record(z.string(), z.unknown()).default({}),
  startDate: z.string().max(16).default(""),
  endDate: z.string().max(16).default(""),
});
export const decideEngagementBodySchema = z.object({
  decision: z.enum(["start", "submit", "accept", "cancel"]),
  note: z.string().max(500).default(""),
});

export const PJ_DEMAND_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;
export const PJ_DEMAND_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "招募中",
  CLOSED: "已关闭",
};
export const PJ_DEMAND_RESPONSE_STATUSES = ["NEW", "SHORTLISTED", "ACCEPTED", "REJECTED"] as const;
export const PJ_DEMAND_RESPONSE_STATUS_LABELS: Record<string, string> = {
  NEW: "待评估",
  SHORTLISTED: "已入围",
  ACCEPTED: "已采纳",
  REJECTED: "未采纳",
};

export const pjDemandResponseSchema = z.object({
  id: z.number(),
  demandId: z.number(),
  partyId: z.number(),
  partyName: z.string(),
  partyKind: z.string(),
  partyKindLabel: z.string(),
  contact: z.string(),
  quoteAmount: z.string(),
  currency: z.string(),
  durationDays: z.number(),
  note: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  engagementId: z.number(),
  createdAt: z.string(),
});
export const pjDemandSchema = z.object({
  id: z.number(),
  taskId: z.number(),
  taskTitle: z.string(),
  taskStatus: z.string(),
  projectId: z.number(),
  projectName: z.string(),
  title: z.string(),
  scope: z.string(),
  deliverables: z.string(),
  acceptance: z.string(),
  budgetAmount: z.string(),
  currency: z.string(),
  startDate: z.string(),
  dueDate: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  publishedAt: z.string(),
  responseCount: z.number(),
  responses: z.array(pjDemandResponseSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const saveDemandBodySchema = z.object({
  taskId: z.number().int().positive(),
  title: z.string().max(200).optional(),
  scope: z.string().max(4000).default(""),
  deliverables: z.string().max(4000).default(""),
  acceptance: z.string().max(4000).default(""),
  budgetAmount: z.number().min(0).max(1_000_000_000).default(0),
  currency: z.string().max(8).default("CNY"),
  startDate: z.string().max(16).default(""),
  dueDate: z.string().max(16).default(""),
  publish: z.boolean().default(false),
});
export const respondDemandBodySchema = z.object({
  demandId: z.number().int().positive(),
  partyId: z.number().int().min(0).default(0),
  partyName: z.string().max(160).default(""),
  contact: z.string().max(160).default(""),
  quoteAmount: z.number().min(0).max(1_000_000_000).default(0),
  currency: z.string().max(8).default("CNY"),
  durationDays: z.number().int().min(0).max(3650).default(0),
  note: z.string().max(2000).default(""),
});
export const acceptDemandBodySchema = z.object({
  demandId: z.number().int().positive(),
  responseId: z.number().int().positive(),
  note: z.string().max(500).default(""),
});
export const closeDemandBodySchema = z.object({
  demandId: z.number().int().positive(),
});

export const projectEndpoints = {
  Pj_overview: {
    method: "get" as const,
    path: "/enterprise/project/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(pjOverviewSchema),
  },
  Pj_listProjects: {
    method: "get" as const,
    path: "/enterprise/project/projects",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      q: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(pjProjectSchema)),
  },
  Pj_getProject: {
    method: "get" as const,
    path: "/enterprise/project/projects/:id",
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(pjProjectDetailSchema),
  },
  Pj_saveProject: {
    method: "post" as const,
    path: "/enterprise/project/projects/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveProjectBodySchema,
    response: envelope(pjProjectSchema),
  },
  Pj_removeProject: {
    method: "post" as const,
    path: "/enterprise/project/projects/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_saveMember: {
    method: "post" as const,
    path: "/enterprise/project/members/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveProjectMemberBodySchema,
    response: envelope(
      z.object({
        id: z.number(),
        principalType: z.string(),
        principalId: z.string(),
        role: z.string(),
        allocationPct: z.number(),
      }),
    ),
  },
  Pj_removeMember: {
    method: "post" as const,
    path: "/enterprise/project/members/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_listSprints: {
    method: "get" as const,
    path: "/enterprise/project/sprints",
    params: z.object({}),
    query: z.object({ projectId: z.coerce.number().int().min(0).optional() }),
    body: z.undefined(),
    response: envelope(z.array(pjSprintSchema)),
  },
  Pj_saveSprint: {
    method: "post" as const,
    path: "/enterprise/project/sprints/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveSprintBodySchema,
    response: envelope(pjSprintSchema),
  },
  Pj_removeSprint: {
    method: "post" as const,
    path: "/enterprise/project/sprints/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_listMilestones: {
    method: "get" as const,
    path: "/enterprise/project/milestones",
    params: z.object({}),
    query: z.object({ projectId: z.coerce.number().int().min(0).optional() }),
    body: z.undefined(),
    response: envelope(z.array(pjMilestoneSchema)),
  },
  Pj_saveMilestone: {
    method: "post" as const,
    path: "/enterprise/project/milestones/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveMilestoneBodySchema,
    response: envelope(pjMilestoneSchema),
  },
  Pj_removeMilestone: {
    method: "post" as const,
    path: "/enterprise/project/milestones/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_listTasks: {
    method: "get" as const,
    path: "/enterprise/project/tasks",
    params: z.object({}),
    query: pageQuerySchema.extend({
      projectId: z.coerce.number().int().min(0).optional(),
      sprintId: z.coerce.number().int().min(0).optional(),
      status: z.string().optional(),
      assigneeId: z.string().optional(),
      q: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(pjTaskSchema)),
  },
  Pj_saveTask: {
    method: "post" as const,
    path: "/enterprise/project/tasks/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveTaskBodySchema,
    response: envelope(pjTaskSchema),
  },
  Pj_moveTask: {
    method: "post" as const,
    path: "/enterprise/project/tasks/move",
    params: z.object({}),
    query: emptyQuery,
    body: moveTaskBodySchema,
    response: envelope(pjTaskSchema),
  },
  Pj_removeTask: {
    method: "post" as const,
    path: "/enterprise/project/tasks/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_addRelation: {
    method: "post" as const,
    path: "/enterprise/project/tasks/relations/add",
    params: z.object({}),
    query: emptyQuery,
    body: taskRelationBodySchema,
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_removeRelation: {
    method: "post" as const,
    path: "/enterprise/project/tasks/relations/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_wbsSuggest: {
    method: "post" as const,
    path: "/enterprise/project/ai/wbs",
    params: z.object({}),
    query: emptyQuery,
    body: wbsSuggestBodySchema,
    response: envelope(wbsSuggestResultSchema),
  },
  Pj_projectInsight: {
    method: "post" as const,
    path: "/enterprise/project/ai/insight",
    params: z.object({}),
    query: emptyQuery,
    body: projectInsightBodySchema,
    response: envelope(projectInsightSchema),
  },
  Pj_riskList: {
    method: "get" as const,
    path: "/enterprise/project/risks",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(pjRiskSchema)),
  },
  Pj_listTimeLogs: {
    method: "get" as const,
    path: "/enterprise/project/time-logs",
    params: z.object({}),
    query: pageQuerySchema.extend({
      projectId: z.coerce.number().int().min(0).optional(),
      taskId: z.coerce.number().int().min(0).optional(),
      principalId: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(pjTimeLogSchema)),
  },
  Pj_addTimeLog: {
    method: "post" as const,
    path: "/enterprise/project/time-logs/save",
    params: z.object({}),
    query: emptyQuery,
    body: addTimeLogBodySchema,
    response: envelope(pjTimeLogSchema),
  },
  Pj_startTimer: {
    method: "post" as const,
    path: "/enterprise/project/time-logs/start",
    params: z.object({}),
    query: emptyQuery,
    body: startTimerBodySchema,
    response: envelope(pjTimeLogSchema),
  },
  Pj_stopTimer: {
    method: "post" as const,
    path: "/enterprise/project/time-logs/stop",
    params: z.object({}),
    query: emptyQuery,
    body: stopTimerBodySchema,
    response: envelope(pjTimeLogSchema),
  },
  Pj_decideTimeLog: {
    method: "post" as const,
    path: "/enterprise/project/time-logs/decide",
    params: z.object({}),
    query: emptyQuery,
    body: decideTimeLogBodySchema,
    response: envelope(pjTimeLogSchema),
  },
  Pj_removeTimeLog: {
    method: "post" as const,
    path: "/enterprise/project/time-logs/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_listTimesheets: {
    method: "get" as const,
    path: "/enterprise/project/timesheets",
    params: z.object({}),
    query: pageQuerySchema.extend({
      principalId: z.string().optional(),
      status: z.string().optional(),
      periodStart: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(pjTimesheetSchema)),
  },
  Pj_generateTimesheet: {
    method: "post" as const,
    path: "/enterprise/project/timesheets/generate",
    params: z.object({}),
    query: emptyQuery,
    body: generateTimesheetBodySchema,
    response: envelope(pjTimesheetSchema),
  },
  Pj_decideTimesheet: {
    method: "post" as const,
    path: "/enterprise/project/timesheets/decide",
    params: z.object({}),
    query: emptyQuery,
    body: decideTimesheetBodySchema,
    response: envelope(pjTimesheetSchema),
  },
  Pj_settingsGet: {
    method: "get" as const,
    path: "/enterprise/project/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(pjSettingsSchema),
  },
  Pj_settingsSave: {
    method: "post" as const,
    path: "/enterprise/project/settings/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveProjectSettingsBodySchema,
    response: envelope(pjSettingsSchema),
  },
  Pj_listCostRates: {
    method: "get" as const,
    path: "/enterprise/project/cost-rates",
    params: z.object({}),
    query: pageQuerySchema.extend({
      principalType: z.string().optional(),
      q: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(pjCostRateSchema)),
  },
  Pj_saveCostRate: {
    method: "post" as const,
    path: "/enterprise/project/cost-rates/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveCostRateBodySchema,
    response: envelope(pjCostRateSchema),
  },
  Pj_removeCostRate: {
    method: "post" as const,
    path: "/enterprise/project/cost-rates/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_listCostItems: {
    method: "get" as const,
    path: "/enterprise/project/cost-items",
    params: z.object({}),
    query: pageQuerySchema.extend({
      projectId: z.coerce.number().int().min(0).optional(),
      kind: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(pjCostItemSchema)),
  },
  Pj_saveCostItem: {
    method: "post" as const,
    path: "/enterprise/project/cost-items/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveCostItemBodySchema,
    response: envelope(pjCostItemSchema),
  },
  Pj_removeCostItem: {
    method: "post" as const,
    path: "/enterprise/project/cost-items/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Pj_projectCost: {
    method: "get" as const,
    path: "/enterprise/project/projects/:id/cost",
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(pjCostSummarySchema),
  },
  Pj_listEngagements: {
    method: "get" as const,
    path: "/enterprise/project/engagements",
    params: z.object({}),
    query: pageQuerySchema.extend({
      projectId: z.coerce.number().int().min(0).optional(),
      partyId: z.coerce.number().int().min(0).optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(pjEngagementSchema)),
  },
  Pj_saveEngagement: {
    method: "post" as const,
    path: "/enterprise/project/engagements/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveEngagementBodySchema,
    response: envelope(pjEngagementSchema),
  },
  Pj_decideEngagement: {
    method: "post" as const,
    path: "/enterprise/project/engagements/:id/decide",
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: emptyQuery,
    body: decideEngagementBodySchema,
    response: envelope(pjEngagementSchema),
  },
  Pj_removeEngagement: {
    method: "post" as const,
    path: "/enterprise/project/engagements/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },

  // ---------- 任务外发需求（任务 ↔ 需求发布 ↔ 外部合作） ----------
  Pj_getDemand: {
    method: "get" as const,
    path: "/enterprise/project/tasks/:id/demand",
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(pjDemandSchema),
  },
  Pj_saveDemand: {
    method: "post" as const,
    path: "/enterprise/project/tasks/demand/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveDemandBodySchema,
    response: envelope(pjDemandSchema),
  },
  Pj_respondDemand: {
    method: "post" as const,
    path: "/enterprise/project/tasks/demand/respond",
    params: z.object({}),
    query: emptyQuery,
    body: respondDemandBodySchema,
    response: envelope(pjDemandSchema),
  },
  Pj_acceptDemand: {
    method: "post" as const,
    path: "/enterprise/project/tasks/demand/accept",
    params: z.object({}),
    query: emptyQuery,
    body: acceptDemandBodySchema,
    response: envelope(pjDemandSchema),
  },
  Pj_closeDemand: {
    method: "post" as const,
    path: "/enterprise/project/tasks/demand/close",
    params: z.object({}),
    query: emptyQuery,
    body: closeDemandBodySchema,
    response: envelope(pjDemandSchema),
  },
};
