import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * HRM 契约（方案 §5.1 的 L2 底座 + §12.9 人岗匹配 rubric）：
 * 员工档案（挂 OrgStaff）、假勤（政策→余额→申请→审批→打卡/节假日）、
 * 招聘双表（HrmJob 对内主体 ↔ HiringPost 对外渠道）、候选人/投递/面试/评分/Offer/盘点。
 * AI 人才评估输出仅作参考分：分档/阈值/矩阵校验在 LLM 外用代码执行（talent-match 单一实现点）。
 */

export const HRM_EMPLOYMENT_TYPES = ["FULL_TIME", "LABOR", "AGENT"] as const;
export const HRM_PROFILE_STATUSES = ["PROBATION", "ACTIVE", "LEFT"] as const;
export const HRM_TIMEOFF_TYPES = ["ANNUAL", "SICK", "PERSONAL", "MARRY", "BEREAVEMENT", "UNPAID"] as const;
export const HRM_TIMEOFF_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "REVOKED"] as const;
export const HRM_JOB_STATUSES = ["OPEN", "CLOSED", "FILLED", "CANCELED"] as const;
export const HRM_APP_STATUSES = ["NEW", "SCREENING", "INTERVIEWING", "OFFER", "REJECTED", "WITHDRAWN"] as const;
export const HRM_INTERVIEW_DIMENSIONS = ["HARD_SKILL", "SOFT", "EXPERIENCE", "STABILITY", "CULTURE", "WILL"] as const;
/** 职级词表（§12.9.4 单一 classifyTier 消费，两侧同表） */
export const HRM_TIERS = ["实习", "应届", "初级", "中级", "高级", "专家", "总监"] as const;

/** 员工档案行：OrgStaff 的 HR 扩展面（工号/雇佣类型/时薪/主管）。 */
export const hrmProfileSchema = z.object({
  id: z.number(),
  memberUserId: z.string(),
  employeeNo: z.string(),
  employmentType: z.enum(HRM_EMPLOYMENT_TYPES),
  hourlyRate: z.string(),
  supervisorUserId: z.string(),
  department: z.string(),
  skills: z.array(z.string()),
  status: z.enum(HRM_PROFILE_STATUSES),
  joinedAt: z.string(),
  leftAt: z.string(),
  note: z.string(),
  updatedAt: z.string(),
});
export const upsertHrmProfileBodySchema = z.object({
  memberUserId: z.string().min(1).max(64),
  employeeNo: z.string().max(32).default(""),
  employmentType: z.enum(HRM_EMPLOYMENT_TYPES).default("FULL_TIME"),
  hourlyRate: z.number().min(0).max(100000).default(0),
  supervisorUserId: z.string().max(64).default(""),
  department: z.string().max(64).default(""),
  skills: z.array(z.string().max(32)).max(50).default([]),
  joinedAt: z.string().max(16).default(""),
  note: z.string().max(500).default(""),
});
export const updateHrmProfileStatusBodySchema = z.object({
  memberUserId: z.string().min(1).max(64),
  status: z.enum(HRM_PROFILE_STATUSES),
  leftAt: z.string().max(16).default(""),
});

/** 假勤政策（年额度）与余额。 */
export const hrmPolicySchema = z.object({
  id: z.number(),
  year: z.number(),
  name: z.string(),
  quotas: z.record(z.string(), z.number()),
  isDefault: z.boolean(),
  updatedAt: z.string(),
});
export const saveHrmPolicyBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  name: z.string().min(1).max(64).default("默认"),
  /** 假别→年度天数（未给的假别按内置默认：ANNUAL 5 / SICK 10 / PERSONAL 3 / MARRY 3 / BEREAVEMENT 3 / UNPAID 0） */
  quotas: z.record(z.string(), z.number().min(0).max(365)).default({}),
  isDefault: z.boolean().default(true),
});
export const hrmBalanceSchema = z.object({
  id: z.number(),
  staffUserId: z.string(),
  year: z.number(),
  type: z.enum(HRM_TIMEOFF_TYPES),
  totalDays: z.string(),
  usedDays: z.string(),
});

/** 请假申请：days 由服务端按工作日（扣节假日）计算，客户端不传。 */
export const hrmTimeOffSchema = z.object({
  id: z.number(),
  staffUserId: z.string(),
  type: z.enum(HRM_TIMEOFF_TYPES),
  startDate: z.string(),
  endDate: z.string(),
  days: z.string(),
  reason: z.string(),
  status: z.enum(HRM_TIMEOFF_STATUSES),
  approverUserId: z.string(),
  decidedAt: z.string(),
  note: z.string(),
  createdAt: z.string(),
});
export const createHrmTimeOffBodySchema = z.object({
  type: z.enum(HRM_TIMEOFF_TYPES),
  startDate: z.string().min(10).max(16),
  endDate: z.string().min(10).max(16),
  reason: z.string().max(500).default(""),
});
export const decideHrmTimeOffBodySchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["approve", "reject", "revoke", "cancel"]),
  note: z.string().max(500).default(""),
});

/** 打卡流水与节假日。 */
export const hrmAttendanceLogSchema = z.object({
  id: z.number(),
  staffUserId: z.string(),
  logDate: z.string(),
  checkType: z.enum(["CLOCK_IN", "CLOCK_OUT", "REMEDY"]),
  at: z.string(),
  source: z.string(),
  mark: z.enum(["NORMAL", "LATE", "EARLY", "ABSENT"]),
  note: z.string(),
});
export const clockHrmBodySchema = z.object({
  note: z.string().max(200).default(""),
});
export const remedyHrmClockBodySchema = z.object({
  logDate: z.string().min(10).max(16),
  checkType: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  at: z.string().min(16).max(20),
  reason: z.string().min(1).max(500),
});
export const hrmHolidaySchema = z.object({
  id: z.number(),
  holidayDate: z.string(),
  name: z.string(),
  days: z.string(),
});
export const addHrmHolidayBodySchema = z.object({
  holidayDate: z.string().min(10).max(16),
  name: z.string().min(1).max(64),
  days: z.number().min(0).max(3).default(1),
});

/** 用人申请（批准后自动生成职位）。 */
export const hrmHiringRequestSchema = z.object({
  id: z.number(),
  department: z.string(),
  position: z.string(),
  headCount: z.number(),
  expectedTier: z.string(),
  budgetMonthly: z.string(),
  reason: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  applicantUserId: z.string(),
  approverUserId: z.string(),
  jobId: z.number(),
  createdAt: z.string(),
});
export const createHrmHiringRequestBodySchema = z.object({
  department: z.string().max(64).default(""),
  position: z.string().min(1).max(120),
  headCount: z.number().int().min(1).max(500).default(1),
  expectedTier: z.enum(HRM_TIERS).optional(),
  budgetMonthly: z.number().min(0).max(10000000).default(0),
  reason: z.string().max(500).default(""),
});
export const decideHrmHiringRequestBodySchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).default(""),
});

/** 招聘职位（对内主体）：JD 单一数据源，一键发布生成 HiringPost 渠道。 */
export const hrmJobSchema = z.object({
  id: z.number(),
  title: z.string(),
  department: z.string(),
  headCount: z.number(),
  tier: z.string(),
  jd: z.string(),
  status: z.enum(HRM_JOB_STATUSES),
  hiringRequestId: z.number(),
  hiringPostId: z.number(),
  minScore: z.string(),
  ownerId: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const createHrmJobBodySchema = z.object({
  title: z.string().min(1).max(120),
  department: z.string().max(64).default(""),
  headCount: z.number().int().min(1).max(500).default(1),
  tier: z.enum(HRM_TIERS).optional(),
  jd: z.string().max(20000).default(""),
  minScore: z.number().min(1).max(5).optional(),
  hiringRequestId: z.number().int().min(0).default(0),
});
export const updateHrmJobBodySchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(120).optional(),
  department: z.string().max(64).optional(),
  headCount: z.number().int().min(1).max(500).optional(),
  tier: z.enum(HRM_TIERS).optional(),
  jd: z.string().max(20000).optional(),
  status: z.enum(HRM_JOB_STATUSES).optional(),
  minScore: z.number().min(1).max(5).optional(),
});
export const generateHrmJdBodySchema = z.object({
  title: z.string().min(1).max(120),
  tier: z.enum(HRM_TIERS).optional(),
  /** 3~5 条职责要点（AI 生成 JD 草稿的原料，HR 编辑后再发布） */
  points: z.array(z.string().min(1).max(200)).min(1).max(8),
});

/** 候选人：items 为结构化事实（evidence sourceRef 回跳锚点），不喂自由文本原件。 */
export const hrmResumeItemSchema = z.object({
  id: z.string().min(1).max(32),
  kind: z.enum(["EDU", "WORK", "PROJECT", "SKILL"]),
  title: z.string().max(200),
  detail: z.string().max(2000).default(""),
  period: z.string().max(64).default(""),
});
export const hrmCandidateSchema = z.object({
  id: z.number(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  source: z.string(),
  resumeAssetId: z.number(),
  items: z.array(hrmResumeItemSchema),
  skills: z.array(z.string()),
  tier: z.string(),
  note: z.string(),
  createdAt: z.string(),
});
export const upsertHrmCandidateBodySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(64),
  phone: z.string().max(32).default(""),
  email: z.string().max(120).default(""),
  source: z.enum(["UPLOAD", "HIRING_POST", "REFERRAL"]).default("UPLOAD"),
  resumeText: z.string().max(100000).default(""),
  items: z.array(hrmResumeItemSchema).max(100).default([]),
  skills: z.array(z.string().max(32)).max(50).default([]),
  tier: z.enum(HRM_TIERS).optional(),
  note: z.string().max(500).default(""),
});

/** 投递：talent-match 评分落库处（rubricVersion 可追溯「当时用哪版规则评的」）。 */
export const hrmApplicationSchema = z.object({
  id: z.number(),
  jobId: z.number(),
  candidateId: z.number(),
  channel: z.string(),
  status: z.enum(HRM_APP_STATUSES),
  matchScore: z.string(),
  matchTier: z.string(),
  evalResult: z.record(z.string(), z.unknown()),
  rubricCode: z.string(),
  rubricVersion: z.number(),
  decidedBy: z.string(),
  createdAt: z.string(),
});
export const createHrmApplicationBodySchema = z.object({
  jobId: z.number().int().positive(),
  candidateId: z.number().int().positive(),
  channel: z.enum(["LOCAL", "HIRING_POST"]).default("LOCAL"),
});
export const decideHrmApplicationBodySchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["advance", "reject", "withdraw"]),
  note: z.string().max(500).default(""),
});

/** 面试安排与维度评分（宽严校准数据源）。 */
export const hrmInterviewSchema = z.object({
  id: z.number(),
  applicationId: z.number(),
  interviewerUserId: z.string(),
  mode: z.enum(["ONSITE", "VIDEO", "PHONE"]),
  scheduledAt: z.string(),
  durationMin: z.number(),
  status: z.enum(["SCHEDULED", "DONE", "CANCELED"]),
  notes: z.string(),
  createdAt: z.string(),
});
export const scheduleHrmInterviewBodySchema = z.object({
  applicationId: z.number().int().positive(),
  interviewerUserId: z.string().min(1).max(64),
  mode: z.enum(["ONSITE", "VIDEO", "PHONE"]).default("ONSITE"),
  scheduledAt: z.string().min(16).max(20),
  durationMin: z.number().int().min(15).max(240).default(60),
});
export const rateHrmInterviewBodySchema = z.object({
  interviewId: z.number().int().positive(),
  ratings: z
    .array(z.object({ dimension: z.enum(HRM_INTERVIEW_DIMENSIONS), score: z.number().min(1).max(5), note: z.string().max(500).default("") }))
    .min(1)
    .max(6),
});
export const hrmCalibrationSchema = z.object({
  raters: z.array(z.object({ raterUserId: z.string(), ratedCount: z.number(), avgScore: z.string(), bias: z.string() })),
  note: z.string(),
});

/** Offer：接受后打通入转调离（建 OrgStaff + 档案，application 进 OFFER）。 */
export const hrmOfferSchema = z.object({
  id: z.number(),
  applicationId: z.number(),
  candidateId: z.number(),
  jobId: z.number(),
  salaryMonthly: z.string(),
  startAt: z.string(),
  status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "EXPIRED"]),
  memberUserId: z.string(),
  orgStaffId: z.number(),
  note: z.string(),
  createdAt: z.string(),
});
export const createHrmOfferBodySchema = z.object({
  applicationId: z.number().int().positive(),
  salaryMonthly: z.number().min(0).max(1000000),
  startAt: z.string().min(10).max(16),
  note: z.string().max(500).default(""),
});
export const decideHrmOfferBodySchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["accept", "decline"]),
  /** accept 必填：入职成员账号（登录用户名对应 id） */
  memberUserId: z.string().max(64).default(""),
});

/** 述职/转正评估：绩效×潜力双轴 → 九宫格位（1~9）服务端换算。 */
export const hrmReviewSchema = z.object({
  id: z.number(),
  staffUserId: z.string(),
  period: z.string(),
  kind: z.enum(["PROBATION", "YEAR", "QUARTER"]),
  performanceScore: z.string(),
  potentialScore: z.string(),
  gridCell: z.number(),
  summary: z.string(),
  status: z.enum(["DRAFT", "DONE"]),
  reviewerUserId: z.string(),
  updatedAt: z.string(),
});
export const upsertHrmReviewBodySchema = z.object({
  staffUserId: z.string().min(1).max(64),
  period: z.string().min(1).max(32),
  kind: z.enum(["PROBATION", "YEAR", "QUARTER"]).default("YEAR"),
  performanceScore: z.number().min(1).max(5),
  potentialScore: z.number().min(1).max(5),
  summary: z.string().max(5000).default(""),
  status: z.enum(["DRAFT", "DONE"]).default("DRAFT"),
});

/** 人岗匹配 rubric 模板（§12.9.1：DB 驱动版本化，两侧共读同一实现点）。 */
export const hrmRubricSchema = z.object({
  id: z.number(),
  code: z.string(),
  version: z.number(),
  dimensions: z.array(z.object({ key: z.string(), label: z.string(), description: z.string().default("") })),
  weights: z.record(z.string(), z.number()),
  thresholds: z.record(z.string(), z.number()),
  tierLexicon: z.array(z.string()),
  promptDigest: z.string(),
  active: z.boolean(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export const saveHrmRubricBodySchema = z.object({
  code: z.string().min(1).max(32).default("general"),
  dimensions: z.array(z.object({ key: z.string().max(24), label: z.string().max(32), description: z.string().max(200).default("") })).min(1).max(8),
  weights: z.record(z.string(), z.number().min(0).max(1)),
  thresholds: z.record(z.string(), z.number().min(1).max(5)).default({}),
  tierLexicon: z.array(z.string().max(16)).max(10).default([]),
  promptDigest: z.string().max(20000).default(""),
});

/** 评估结果（talent-match 出参，两侧同构 §12.9.1）。 */
export const talentEvalResultSchema = z.object({
  score: z.string(),
  tier: z.enum(["excellent", "strong", "medium", "gap"]),
  dimensions: z.array(z.object({ key: z.string(), label: z.string(), score: z.string() })),
  requirementsMatrix: z.array(
    z.object({
      requirement: z.string(),
      importance: z.enum(["HIGH", "MEDIUM", "NICE"]),
      match: z.enum(["STRONG", "PARTIAL", "MISSING"]),
      evidence: z.array(z.object({ quote: z.string(), sourceRef: z.string() })),
      gapNote: z.string().default(""),
    }),
  ),
  knockouts: z.array(z.string()),
  recommendation: z.string(),
  rubricCode: z.string(),
  rubricVersion: z.number(),
  /** llm=模型评 + 代码校验；rule=未配 Key 的规则式证据矩阵回落（确定性可验收） */
  mode: z.enum(["llm", "rule"]),
});

export const hrmEndpoints = {
  // ---------- 员工档案 ----------
  Hrm_listProfiles: {
    method: "get" as const,
    path: "/enterprise/hrm/profiles",
    params: z.object({}),
    query: pageQuerySchema.extend({ department: z.string().optional(), status: z.string().optional(), q: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmProfileSchema)),
  },
  Hrm_upsertProfile: {
    method: "post" as const,
    path: "/enterprise/hrm/profiles/upsert",
    params: z.object({}),
    query: emptyQuery,
    body: upsertHrmProfileBodySchema,
    response: envelope(hrmProfileSchema),
  },
  Hrm_updateProfileStatus: {
    method: "post" as const,
    path: "/enterprise/hrm/profiles/status",
    params: z.object({}),
    query: emptyQuery,
    body: updateHrmProfileStatusBodySchema,
    response: envelope(hrmProfileSchema),
  },
  // ---------- 假勤 ----------
  Hrm_listPolicies: {
    method: "get" as const,
    path: "/enterprise/hrm/policies",
    params: z.object({}),
    query: z.object({ year: z.coerce.number().int().optional() }),
    body: z.undefined(),
    response: envelope(z.array(hrmPolicySchema)),
  },
  Hrm_savePolicy: {
    method: "post" as const,
    path: "/enterprise/hrm/policies/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveHrmPolicyBodySchema,
    response: envelope(hrmPolicySchema),
  },
  Hrm_listBalances: {
    method: "get" as const,
    path: "/enterprise/hrm/balances",
    params: z.object({}),
    query: z.object({ year: z.coerce.number().int(), staffUserId: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.array(hrmBalanceSchema)),
  },
  Hrm_createTimeOff: {
    method: "post" as const,
    path: "/enterprise/hrm/timeoff/create",
    params: z.object({}),
    query: emptyQuery,
    body: createHrmTimeOffBodySchema,
    response: envelope(hrmTimeOffSchema),
  },
  Hrm_listTimeOff: {
    method: "get" as const,
    path: "/enterprise/hrm/timeoff",
    params: z.object({}),
    query: pageQuerySchema.extend({ staffUserId: z.string().optional(), status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmTimeOffSchema)),
  },
  Hrm_decideTimeOff: {
    method: "post" as const,
    path: "/enterprise/hrm/timeoff/decide",
    params: z.object({}),
    query: emptyQuery,
    body: decideHrmTimeOffBodySchema,
    response: envelope(hrmTimeOffSchema),
  },
  Hrm_clock: {
    method: "post" as const,
    path: "/enterprise/hrm/attendance/clock",
    params: z.object({}),
    query: emptyQuery,
    body: clockHrmBodySchema,
    response: envelope(hrmAttendanceLogSchema),
  },
  Hrm_remedyClock: {
    method: "post" as const,
    path: "/enterprise/hrm/attendance/remedy",
    params: z.object({}),
    query: emptyQuery,
    body: remedyHrmClockBodySchema,
    response: envelope(hrmAttendanceLogSchema),
  },
  Hrm_listAttendance: {
    method: "get" as const,
    path: "/enterprise/hrm/attendance",
    params: z.object({}),
    query: pageQuerySchema.extend({ staffUserId: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmAttendanceLogSchema)),
  },
  Hrm_listHolidays: {
    method: "get" as const,
    path: "/enterprise/hrm/holidays",
    params: z.object({}),
    query: z.object({ year: z.coerce.number().int() }),
    body: z.undefined(),
    response: envelope(z.array(hrmHolidaySchema)),
  },
  Hrm_addHoliday: {
    method: "post" as const,
    path: "/enterprise/hrm/holidays/add",
    params: z.object({}),
    query: emptyQuery,
    body: addHrmHolidayBodySchema,
    response: envelope(hrmHolidaySchema),
  },
  // ---------- 招聘：用人申请 / 职位 ----------
  Hrm_createHiringRequest: {
    method: "post" as const,
    path: "/enterprise/hrm/hiring-requests/create",
    params: z.object({}),
    query: emptyQuery,
    body: createHrmHiringRequestBodySchema,
    response: envelope(hrmHiringRequestSchema),
  },
  Hrm_listHiringRequests: {
    method: "get" as const,
    path: "/enterprise/hrm/hiring-requests",
    params: z.object({}),
    query: pageQuerySchema.extend({ status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmHiringRequestSchema)),
  },
  Hrm_decideHiringRequest: {
    method: "post" as const,
    path: "/enterprise/hrm/hiring-requests/decide",
    params: z.object({}),
    query: emptyQuery,
    body: decideHrmHiringRequestBodySchema,
    response: envelope(hrmHiringRequestSchema),
  },
  Hrm_listJobs: {
    method: "get" as const,
    path: "/enterprise/hrm/jobs",
    params: z.object({}),
    query: pageQuerySchema.extend({ status: z.string().optional(), q: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmJobSchema)),
  },
  Hrm_getJob: {
    method: "get" as const,
    path: "/enterprise/hrm/jobs/:id",
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(hrmJobSchema),
  },
  Hrm_createJob: {
    method: "post" as const,
    path: "/enterprise/hrm/jobs/create",
    params: z.object({}),
    query: emptyQuery,
    body: createHrmJobBodySchema,
    response: envelope(hrmJobSchema),
  },
  Hrm_updateJob: {
    method: "post" as const,
    path: "/enterprise/hrm/jobs/update",
    params: z.object({}),
    query: emptyQuery,
    body: updateHrmJobBodySchema,
    response: envelope(hrmJobSchema),
  },
  Hrm_generateJd: {
    method: "post" as const,
    path: "/enterprise/hrm/jobs/generate-jd",
    params: z.object({}),
    query: emptyQuery,
    body: generateHrmJdBodySchema,
    response: envelope(z.object({ jd: z.string(), mode: z.enum(["llm", "rule"]) })),
  },
  Hrm_publishJob: {
    method: "post" as const,
    path: "/enterprise/hrm/jobs/publish",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(hrmJobSchema),
  },
  // ---------- 招聘：候选人 / 投递 / 评估 ----------
  Hrm_listCandidates: {
    method: "get" as const,
    path: "/enterprise/hrm/candidates",
    params: z.object({}),
    query: pageQuerySchema.extend({ q: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmCandidateSchema)),
  },
  Hrm_upsertCandidate: {
    method: "post" as const,
    path: "/enterprise/hrm/candidates/upsert",
    params: z.object({}),
    query: emptyQuery,
    body: upsertHrmCandidateBodySchema,
    response: envelope(hrmCandidateSchema),
  },
  Hrm_createApplication: {
    method: "post" as const,
    path: "/enterprise/hrm/applications/create",
    params: z.object({}),
    query: emptyQuery,
    body: createHrmApplicationBodySchema,
    response: envelope(hrmApplicationSchema),
  },
  Hrm_listApplications: {
    method: "get" as const,
    path: "/enterprise/hrm/applications",
    params: z.object({}),
    query: pageQuerySchema.extend({ jobId: z.coerce.number().int().optional(), status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmApplicationSchema)),
  },
  Hrm_evaluateApplication: {
    method: "post" as const,
    path: "/enterprise/hrm/applications/evaluate",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(hrmApplicationSchema.extend({ evalResult: talentEvalResultSchema.nullable() })),
  },
  Hrm_decideApplication: {
    method: "post" as const,
    path: "/enterprise/hrm/applications/decide",
    params: z.object({}),
    query: emptyQuery,
    body: decideHrmApplicationBodySchema,
    response: envelope(hrmApplicationSchema),
  },
  // ---------- 面试与评分 ----------
  Hrm_scheduleInterview: {
    method: "post" as const,
    path: "/enterprise/hrm/interviews/schedule",
    params: z.object({}),
    query: emptyQuery,
    body: scheduleHrmInterviewBodySchema,
    response: envelope(hrmInterviewSchema),
  },
  Hrm_listInterviews: {
    method: "get" as const,
    path: "/enterprise/hrm/interviews",
    params: z.object({}),
    query: pageQuerySchema.extend({ applicationId: z.coerce.number().int().optional(), status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmInterviewSchema)),
  },
  Hrm_rateInterview: {
    method: "post" as const,
    path: "/enterprise/hrm/interviews/rate",
    params: z.object({}),
    query: emptyQuery,
    body: rateHrmInterviewBodySchema,
    response: envelope(hrmInterviewSchema),
  },
  Hrm_calibration: {
    method: "get" as const,
    path: "/enterprise/hrm/ai/calibration",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(hrmCalibrationSchema),
  },
  // ---------- Offer 与盘点 ----------
  Hrm_createOffer: {
    method: "post" as const,
    path: "/enterprise/hrm/offers/create",
    params: z.object({}),
    query: emptyQuery,
    body: createHrmOfferBodySchema,
    response: envelope(hrmOfferSchema),
  },
  Hrm_decideOffer: {
    method: "post" as const,
    path: "/enterprise/hrm/offers/decide",
    params: z.object({}),
    query: emptyQuery,
    body: decideHrmOfferBodySchema,
    response: envelope(hrmOfferSchema),
  },
  Hrm_listOffers: {
    method: "get" as const,
    path: "/enterprise/hrm/offers",
    params: z.object({}),
    query: pageQuerySchema.extend({ status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmOfferSchema)),
  },
  Hrm_upsertReview: {
    method: "post" as const,
    path: "/enterprise/hrm/reviews/upsert",
    params: z.object({}),
    query: emptyQuery,
    body: upsertHrmReviewBodySchema,
    response: envelope(hrmReviewSchema),
  },
  Hrm_listReviews: {
    method: "get" as const,
    path: "/enterprise/hrm/reviews",
    params: z.object({}),
    query: pageQuerySchema.extend({ staffUserId: z.string().optional(), period: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(hrmReviewSchema)),
  },
  // ---------- rubric 模板库 ----------
  Hrm_getRubric: {
    method: "get" as const,
    path: "/enterprise/hrm/rubric",
    params: z.object({}),
    query: z.object({ code: z.string().optional() }),
    body: z.undefined(),
    response: envelope(hrmRubricSchema),
  },
  Hrm_saveRubric: {
    method: "post" as const,
    path: "/enterprise/hrm/rubric/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveHrmRubricBodySchema,
    response: envelope(hrmRubricSchema),
  },
};
export type HrmEndpoints = typeof hrmEndpoints;
