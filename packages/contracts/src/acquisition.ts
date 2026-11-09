import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const strList = z.array(z.string().max(120)).max(50);

/** AI 获客：线索雷达 → 触达编排 → 客户档案 → 销售剧本 → 跟进 → 质检 → 看板。 */
export const ACQ_PLATFORMS = [
  "XHS",
  "DOUYIN",
  "ZHIHU",
  "WEIBO",
  "BILIBILI",
  "WX_CHANNEL",
  "WX_MP",
  "TIKTOK",
  "X",
  "KUAISHOU",
] as const;
export const ACQ_PLATFORM_LABELS: Record<string, string> = {
  XHS: "小红书",
  DOUYIN: "抖音",
  ZHIHU: "知乎",
  WEIBO: "微博",
  BILIBILI: "B站",
  WX_CHANNEL: "微信视频号",
  WX_MP: "微信公众号",
  TIKTOK: "TikTok",
  X: "X",
  KUAISHOU: "快手",
};
export const ACQ_SOURCE_MODES = [
  "KEYWORD",
  "COMPETITOR",
  "TOPIC",
  "ACCOUNT",
  "URL",
] as const;
export const ACQ_SOURCE_MODE_LABELS: Record<string, string> = {
  KEYWORD: "关键词",
  COMPETITOR: "竞品名",
  TOPIC: "话题标签",
  ACCOUNT: "指定账号评论区",
  URL: "指定内容评论",
};
export const ACQ_SOURCE_STATUSES = ["ACTIVE", "PAUSED"] as const;
export const ACQ_TIME_WINDOWS = ["7d", "30d", "90d", "all"] as const;
export const ACQ_RUN_STATUSES = [
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "DONE",
  "PARTIAL",
  "FAILED",
] as const;
export const ACQ_RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  CLAIMED: "已领取",
  RUNNING: "采集中",
  DONE: "已完成",
  PARTIAL: "部分完成",
  FAILED: "失败",
};
export const ACQ_INTENT_LEVELS = ["HOT", "WARM", "COLD"] as const;
export const ACQ_INTENT_LEVEL_LABELS: Record<string, string> = {
  HOT: "高意向",
  WARM: "中意向",
  COLD: "低意向",
};
export const ACQ_LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "QUALIFIED",
  "PROMOTED",
  "IGNORED",
] as const;
export const ACQ_LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: "新线索",
  CONTACTED: "已触达",
  REPLIED: "已回复",
  QUALIFIED: "已确认商机",
  PROMOTED: "已提升CRM",
  IGNORED: "已忽略",
};
export const ACQ_EVIDENCE_SOURCES = ["SEARCH", "COMMENT", "POST", "PROFILE"] as const;
export const ACQ_EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  SEARCH: "搜索结果",
  COMMENT: "评论",
  POST: "作品正文",
  PROFILE: "主页",
};
export const ACQ_OUTREACH_CHANNELS = [
  "XHS_DM",
  "DOUYIN_COMMENT",
  "EMAIL",
  "WECOM",
] as const;
export const ACQ_OUTREACH_CHANNEL_LABELS: Record<string, string> = {
  XHS_DM: "小红书私信",
  DOUYIN_COMMENT: "抖音评论",
  EMAIL: "邮件",
  WECOM: "企业微信",
};
export const ACQ_OUTREACH_ACTIONS = [
  "COMMENT",
  "DM",
  "EMAIL",
  "FRIEND_REQUEST",
] as const;
export const ACQ_OUTREACH_ACTION_LABELS: Record<string, string> = {
  COMMENT: "评论回复",
  DM: "私信",
  EMAIL: "邮件",
  FRIEND_REQUEST: "加好友",
};
export const ACQ_OUTREACH_STATUSES = [
  "DRAFT",
  "APPROVED",
  "QUEUED",
  "SENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
  "SKIPPED",
] as const;
export const ACQ_OUTREACH_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  APPROVED: "已审核",
  QUEUED: "待执行",
  SENDING: "执行中",
  SENT: "已发送",
  FAILED: "失败",
  CANCELLED: "已取消",
  SKIPPED: "已跳过",
};
export const ACQ_RECEIPT_STATUSES = [
  "submitted",
  "succeeded",
  "failed",
  "unknown",
] as const;
export const ACQ_RECEIPT_STATUS_LABELS: Record<string, string> = {
  submitted: "已提交",
  succeeded: "已成功",
  failed: "已失败",
  unknown: "结果未知",
};
export const ACQ_BUSINESS_STATUSES = [
  "free",
  "engaged",
  "qualified",
  "customer",
  "churned",
] as const;
export const ACQ_BUSINESS_STATUS_LABELS: Record<string, string> = {
  free: "未成交",
  engaged: "沟通中",
  qualified: "已确认意向",
  customer: "已成交",
  churned: "已流失",
};
/** 档案业务状态 ↔ CRM 线索阶段，双向同步用。 */
export const ACQ_PROFILE_CRM_STAGE_MAP: Record<string, string> = {
  free: "NEW",
  engaged: "FOLLOWING",
  qualified: "INTERESTED",
  customer: "SUCCESS",
  churned: "FAIL",
};
export const ACQ_CRM_STAGE_PROFILE_MAP: Record<string, string> = {
  NEW: "free",
  FOLLOWING: "engaged",
  INTERESTED: "qualified",
  SUCCESS: "customer",
  FAIL: "churned",
};
export const ACQ_PROFILE_EVENT_KINDS = [
  "LEAD",
  "OUTREACH",
  "CHAT",
  "FOLLOW_UP",
  "STAGE",
  "NOTE",
] as const;
export const ACQ_PROFILE_EVENT_LABELS: Record<string, string> = {
  LEAD: "线索来源",
  OUTREACH: "触达",
  CHAT: "会话",
  FOLLOW_UP: "跟进",
  STAGE: "阶段变化",
  NOTE: "备注",
};
export const ACQ_PLAYBOOK_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export const ACQ_PLAYBOOK_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
};
export const ACQ_FOLLOW_UP_STATUSES = [
  "pending",
  "sent_once",
  "completed",
  "cancelled",
] as const;
export const ACQ_FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  pending: "待跟进",
  sent_once: "已发首轮",
  completed: "已完成",
  cancelled: "已取消",
};
/** 客户说法 → 跟进时间，与 xiaobei 的时间映射逐条对齐。 */
export const ACQ_FOLLOW_UP_TIME_RULES = [
  { key: "TOMORROW", label: "明天", offsetDays: 1, hour: 10 },
  { key: "DAY_AFTER", label: "后天", offsetDays: 2, hour: 10 },
  { key: "AFTERNOON", label: "下午", offsetDays: 0, hour: 14, cutoffHour: 13 },
  { key: "EVENING", label: "晚上", offsetDays: 0, hour: 19, cutoffHour: 18 },
  { key: "NEXT_WEEK", label: "下周", offsetDays: 7, hour: 10 },
  { key: "PAYDAY", label: "等工资 / 月底", offsetDays: 5, hour: 10 },
  { key: "IN_A_FEW_DAYS", label: "过两天 / 几天后", offsetDays: 3, hour: 10 },
  { key: "LATER", label: "晚点再谈 / 稍后", offsetDays: 0, hour: 14, cutoffHour: 13, fallbackHour: 10 },
  { key: "EXPLICIT", label: "具体日期时间", offsetDays: 0, hour: 10 },
] as const;
export const ACQ_QC_DIMENSIONS = [
  { key: "DEMAND", label: "需求识别", max: 20 },
  { key: "COMPLETENESS", label: "信息完整", max: 20 },
  { key: "BOUNDARY", label: "边界合规", max: 20 },
  { key: "PACE", label: "推进节奏", max: 20 },
  { key: "EMOTION", label: "情绪处理", max: 20 },
] as const;
/** 组织级默认限额，可被 acquisition.* 系统设置覆盖。 */
export const ACQ_DEFAULT_LIMITS = {
  dailyComments: 20,
  dailyDm: 30,
  cooldownDays: 7,
  intervalMinSeconds: 20,
  intervalMaxSeconds: 60,
  sourceDailyLimit: 200,
  pluginPullMax: 5,
  pluginTokenTtlSeconds: 300,
  evidenceRetentionDays: 180,
  followUpMaxRounds: 2,
  activeHoursStart: "09:00",
  activeHoursEnd: "21:00",
  batchPerMinute: 30,
} as const;
/** 只新增的积分科目，不改既有科目。 */
export const ACQ_PRICING_CODES = [
  { code: "acq_scan", unit: "批次", label: "线索采集批次", unitPriceAmount: 0, freeQuotaAmount: 20 },
  { code: "acq_score", unit: "条", label: "线索意图评分", unitPriceAmount: 500, freeQuotaAmount: 0 },
  { code: "acq_outreach", unit: "条", label: "触达消息", unitPriceAmount: 200, freeQuotaAmount: 0 },
  { code: "acq_sales_chat", unit: "会话", label: "AI 销售接待", unitPriceAmount: 100, freeQuotaAmount: 0 },
  { code: "acq_qc", unit: "会话", label: "接待质检", unitPriceAmount: 100, freeQuotaAmount: 0 },
] as const;
export const ACQ_PLUGIN_TYPES = ["collect", "outreach"] as const;
export const ACQ_PLUGIN_STOP_REASONS = [
  "NEED_LOGIN",
  "CAPTCHA",
  "RISK_CONTROL",
  "PAGE_CHANGED",
  "USER_STOPPED",
  "LIMIT_REACHED",
] as const;
export const ACQ_PLUGIN_STOP_LABELS: Record<string, string> = {
  NEED_LOGIN: "需要登录",
  CAPTCHA: "遇到验证码",
  RISK_CONTROL: "平台风控",
  PAGE_CHANGED: "页面结构变化",
  USER_STOPPED: "用户已停止",
  LIMIT_REACHED: "达到限额",
};

export const acqSourceQuerySchema = z.object({
  keywords: strList.default([]),
  competitorIds: strList.default([]),
  topicTags: strList.default([]),
  accountUrls: strList.default([]),
  urls: strList.default([]),
});
export const acqSourceFiltersSchema = z.object({
  timeWindow: z.enum(ACQ_TIME_WINDOWS).default("30d"),
  excludeWords: strList.default([]),
  minComments: z.number().int().min(0).max(100000).default(0),
  regions: strList.default([]),
  excludeCustomers: z.boolean().default(true),
});
export const acqSourceSchema = z.object({
  id: z.number(),
  name: z.string(),
  platform: z.string(),
  mode: z.string(),
  query: acqSourceQuerySchema,
  filters: acqSourceFiltersSchema,
  cron: z.string(),
  dailyLimit: z.number(),
  status: z.string(),
  lastRunAt: z.string(),
  nextRunAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const saveAcqSourceBodySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(80),
  platform: z.enum(ACQ_PLATFORMS),
  mode: z.enum(ACQ_SOURCE_MODES),
  query: acqSourceQuerySchema.prefault({}),
  filters: acqSourceFiltersSchema.prefault({}),
  cron: z.string().max(60).default(""),
  dailyLimit: z.number().int().min(1).max(2000).default(200),
  status: z.enum(ACQ_SOURCE_STATUSES).default("ACTIVE"),
});
export const acqRunStatsSchema = z.object({
  scanned: z.number().int().nonnegative().default(0),
  new: z.number().int().nonnegative().default(0),
  duplicate: z.number().int().nonnegative().default(0),
  filtered: z.number().int().nonnegative().default(0),
});
export const acqRunSchema = z.object({
  id: z.number(),
  sourceId: z.number(),
  sourceName: z.string(),
  platform: z.string(),
  status: z.string(),
  stats: acqRunStatsSchema,
  error: z.string(),
  claimedAt: z.string(),
  heartbeatAt: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
});
export const acqIntentScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  level: z.enum(ACQ_INTENT_LEVELS),
  tags: strList,
  reason: z.string(),
  opening: z.string(),
  risk: z.string(),
  mode: z.enum(["rule", "llm"]),
  dimensions: z
    .array(z.object({ name: z.string(), score: z.number(), note: z.string() }))
    .default([]),
});
export const acqLeadEvidenceSchema = z.object({
  id: z.number(),
  leadId: z.number(),
  runId: z.number(),
  sourceType: z.string(),
  url: z.string(),
  excerpt: z.string(),
  summary: z.string(),
  metrics: z.record(z.string(), z.unknown()),
  capturedAt: z.string(),
});
export const acqLeadSchema = z.object({
  id: z.number(),
  platform: z.string(),
  platformUserId: z.string(),
  nickname: z.string(),
  profileUrl: z.string(),
  intentScore: z.number(),
  intentLevel: z.string(),
  intentTags: z.array(z.string()),
  scoreMode: z.string(),
  scoreReason: z.string(),
  status: z.string(),
  blockReason: z.string(),
  ownerUserId: z.string(),
  crmLeadId: z.number(),
  evidenceCount: z.number(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export const acqLeadDetailSchema = acqLeadSchema.extend({
  evidence: z.array(acqLeadEvidenceSchema),
  opening: z.string(),
  risk: z.string(),
  profileId: z.number(),
  outreach: z.array(
    z.object({
      id: z.number(),
      channel: z.string(),
      action: z.string(),
      status: z.string(),
      receiptStatus: z.string(),
      sentAt: z.string(),
      finalText: z.string(),
    }),
  ),
});
export const updateAcqLeadBodySchema = z.object({
  status: z.enum(ACQ_LEAD_STATUSES).optional(),
  /** status=IGNORED 时的抑制原因：退订/黑名单/竞品员工/已成交 */
  blockReason: z.string().max(300).optional(),
  ownerUserId: z.string().max(64).optional(),
  tags: strList.optional(),
  note: z.string().max(500).optional(),
});
export const promoteAcqLeadBodySchema = z.object({
  name: z.string().max(120).default(""),
  contactName: z.string().max(60).default(""),
  phone: z.string().max(40).default(""),
  email: z.string().max(120).default(""),
  source: z.string().max(60).default(""),
  ownerId: z.string().max(64).default(""),
  poolId: z.number().int().min(0).default(0),
  remark: z.string().max(2000).default(""),
});
export const acqLeadsToTableBodySchema = z.object({
  leadIds: z.array(z.number().int().positive()).min(1).max(500),
  tableId: z.number().int().positive(),
  fieldMap: z.record(z.string(), z.string()).default({}),
});
export const acqExportBodySchema = z.object({
  leadIds: z.array(z.number().int().positive()).max(2000).default([]),
  platform: z.string().max(20).optional(),
  status: z.string().max(20).optional(),
  intentLevel: z.string().max(10).optional(),
  format: z.enum(["csv", "json"]).default("csv"),
});
export const acqOutreachDraftSchema = z.object({
  angle: z.string(),
  text: z.string(),
  why: z.string(),
});
export const acqOutreachSchema = z.object({
  id: z.number(),
  leadId: z.number(),
  leadNickname: z.string(),
  platform: z.string(),
  channel: z.string(),
  action: z.string(),
  targetUrl: z.string(),
  externalUserId: z.string(),
  draft: z.string(),
  finalText: z.string(),
  status: z.string(),
  moderation: z.string(),
  moderationNote: z.string(),
  /** 风控拦截原因：非空即不发送（退订/黑名单/竞品/已成交/频控/冷却/内容安全） */
  blockedReason: z.string(),
  scheduledAt: z.string(),
  sentAt: z.string(),
  receiptStatus: z.string(),
  receiptRef: z.string(),
  retryCount: z.number(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const createAcqOutreachBodySchema = z.object({
  leadId: z.number().int().positive(),
  channel: z.enum(ACQ_OUTREACH_CHANNELS),
  action: z.enum(ACQ_OUTREACH_ACTIONS).optional(),
  targetUrl: z.string().max(500).default(""),
  /** 服务端渠道的客户标识：私信/企微为平台或企微外部用户 ID，邮件留空走 CRM 邮箱 */
  externalUserId: z.string().max(160).default(""),
  playbookId: z.number().int().positive().optional(),
  text: z.string().max(4000).default(""),
  generate: z.boolean().default(true),
  scheduledAt: z.string().max(40).default(""),
  autoApprove: z.boolean().default(false),
});
export const acqOutreachLogSchema = z.object({
  at: z.string(),
  step: z.string(),
  result: z.string(),
  detail: z.string(),
});
export const acqPluginTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  version: z.string(),
  pullMax: z.number(),
  intervalMinSeconds: z.number(),
  intervalMaxSeconds: z.number(),
});
export const acqPluginCollectItemSchema = z.object({
  platform: z.string().max(20),
  platformUserId: z.string().max(120),
  nickname: z.string().max(120).default(""),
  profileUrl: z.string().max(500).default(""),
  sourceType: z.enum(ACQ_EVIDENCE_SOURCES).default("COMMENT"),
  url: z.string().max(500),
  excerpt: z.string().max(4000),
  metrics: z.record(z.string(), z.unknown()).default({}),
});
export const acqPluginJobSchema = z.object({
  jobId: z.string(),
  type: z.enum(ACQ_PLUGIN_TYPES),
  runId: z.number(),
  outreachId: z.number(),
  platform: z.string(),
  mode: z.string(),
  query: z.record(z.string(), z.unknown()),
  filters: z.record(z.string(), z.unknown()),
  urls: strList,
  limits: z.record(z.string(), z.unknown()),
  action: z.string(),
  targetUrl: z.string(),
  /** 私信目标在平台内的用户 ID：没有可打开的会话链接时用它定位对方主页 */
  externalUserId: z.string().default(""),
  text: z.string(),
  maxPerHour: z.number(),
});
export const acqPluginPullBodySchema = z.object({
  token: z.string().min(8).max(200),
  type: z.enum(ACQ_PLUGIN_TYPES).optional(),
});
export const acqPluginReportBodySchema = z.object({
  token: z.string().min(8).max(200),
  jobId: z.string().min(1).max(120),
  type: z.enum(ACQ_PLUGIN_TYPES),
  runId: z.number().int().min(0).default(0),
  outreachId: z.number().int().min(0).default(0),
  status: z.enum(["running", "done", "partial", "failed", "stopped"]).default("done"),
  items: z.array(acqPluginCollectItemSchema).max(500).default([]),
  stats: acqRunStatsSchema.prefault({}),
  receiptStatus: z.enum(ACQ_RECEIPT_STATUSES).optional(),
  receiptRef: z.string().max(160).default(""),
  stopReason: z.string().max(40).default(""),
  error: z.string().max(1000).default(""),
});
export const acqPluginReportResultSchema = z.object({
  accepted: z.boolean(),
  duplicated: z.boolean(),
  newLeads: z.number(),
  runStatus: z.string(),
  outreachStatus: z.string(),
  message: z.string(),
});
export const acqProfileSchema = z.object({
  id: z.number(),
  crmLeadId: z.number(),
  channelPeerKey: z.string(),
  displayName: z.string(),
  businessStatus: z.string(),
  purpose: z.string(),
  source: z.string(),
  budget: z.string(),
  timeline: z.string(),
  decisionRole: z.string(),
  objections: z.array(z.string()),
  tags: z.array(z.string()),
  healthScore: z.number(),
  ownerUserId: z.string(),
  nextActionAt: z.string(),
  lastContactAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const acqProfileEventSchema = z.object({
  id: z.number(),
  profileId: z.number(),
  kind: z.string(),
  refId: z.number(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export const acqProfileDetailSchema = acqProfileSchema.extend({
  events: z.array(acqProfileEventSchema),
  crmStage: z.string(),
  followUps: z.array(
    z.object({
      id: z.number(),
      followUpAt: z.string(),
      reason: z.string(),
      status: z.string(),
      retryCount: z.number(),
    }),
  ),
});
export const updateAcqProfileBodySchema = z.object({
  displayName: z.string().max(120).optional(),
  businessStatus: z.enum(ACQ_BUSINESS_STATUSES).optional(),
  purpose: z.string().max(200).optional(),
  source: z.string().max(60).optional(),
  budget: z.string().max(80).optional(),
  timeline: z.string().max(80).optional(),
  decisionRole: z.string().max(40).optional(),
  objections: strList.optional(),
  tags: strList.optional(),
  ownerUserId: z.string().max(64).optional(),
  note: z.string().max(500).optional(),
});
export const acqPlaybookPersonaSchema = z.object({
  alias: z.string().max(60).default(""),
  personality: z.string().max(500).default(""),
  canDo: strList.default([]),
  cannotDo: strList.default([]),
  tone: z.string().max(200).default(""),
  format: z.string().max(200).default(""),
  maxLinks: z.number().int().min(0).max(5).default(1),
});
export const acqPlaybookBoundariesSchema = z.object({
  noPricePromise: z.boolean().default(true),
  noTimelinePromise: z.boolean().default(true),
  noCompensationPromise: z.boolean().default(true),
  noCustomPromise: z.boolean().default(true),
  noFabricatedCases: z.boolean().default(true),
  extra: strList.default([]),
});
export const acqPlaybookEscalationSchema = z.object({
  triggers: strList.default(["退款", "投诉", "合同条款"]),
  handoffText: z.string().max(300).default("这个问题我帮您转接人工同事确认。"),
  agentUserIds: strList.default([]),
});
export const acqPlaybookOpenerSchema = z.object({
  scene: z.string().max(60),
  text: z.string().max(500),
});
export const acqPlaybookObjectionSchema = z.object({
  topic: z.string().max(60),
  acknowledge: z.string().max(300),
  conclusion: z.string().max(300),
  evidence: z.string().max(300).default(""),
  nextStep: z.string().max(300).default(""),
});
export const acqPlaybookSchema = z.object({
  id: z.number(),
  name: z.string(),
  goal: z.string(),
  persona: acqPlaybookPersonaSchema,
  boundaries: acqPlaybookBoundariesSchema,
  escalation: acqPlaybookEscalationSchema,
  openers: z.array(acqPlaybookOpenerSchema),
  objections: z.array(acqPlaybookObjectionSchema),
  kbIds: z.array(z.number().int()),
  faqIds: z.array(z.number().int()),
  status: z.string(),
  currentVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const saveAcqPlaybookBodySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(80),
  goal: z.string().max(120).default(""),
  persona: acqPlaybookPersonaSchema.prefault({}),
  boundaries: acqPlaybookBoundariesSchema.prefault({}),
  escalation: acqPlaybookEscalationSchema.prefault({}),
  openers: z.array(acqPlaybookOpenerSchema).max(20).default([]),
  objections: z.array(acqPlaybookObjectionSchema).max(30).default([]),
  kbIds: z.array(z.number().int().positive()).max(20).default([]),
  faqIds: z.array(z.number().int().positive()).max(50).default([]),
  status: z.enum(ACQ_PLAYBOOK_STATUSES).default("DRAFT"),
});
export const acqPlaybookVersionSchema = z.object({
  id: z.number(),
  playbookId: z.number(),
  version: z.number(),
  snapshot: z.record(z.string(), z.unknown()),
  publishedAt: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const acqPlaybookPreviewBodySchema = z.object({
  leadId: z.number().int().positive().optional(),
  profileId: z.number().int().positive().optional(),
  customerMessage: z.string().max(2000).default(""),
  version: z.number().int().positive().optional(),
});
export const acqPlaybookPreviewSchema = z.object({
  prompt: z.string(),
  sections: z.array(z.object({ name: z.string(), text: z.string() })),
  reply: z.string(),
  mode: z.enum(["rule", "llm"]),
  version: z.number(),
});
export const acqFollowUpSchema = z.object({
  id: z.number(),
  profileId: z.number(),
  profileName: z.string(),
  channelPeerKey: z.string(),
  externalUserId: z.string(),
  channel: z.string(),
  accountId: z.string(),
  followUpAt: z.string(),
  reason: z.string(),
  contextSummary: z.string(),
  status: z.string(),
  sentText: z.string(),
  retryCount: z.number(),
  completedAt: z.string(),
  createdAt: z.string(),
});
export const createAcqFollowUpBodySchema = z.object({
  profileId: z.number().int().positive(),
  channel: z.enum(ACQ_OUTREACH_CHANNELS).default("XHS_DM"),
  accountId: z.string().max(80).default(""),
  timeRule: z.string().max(30).default("TOMORROW"),
  followUpAt: z.string().max(40).default(""),
  reason: z.string().min(1).max(300),
  contextSummary: z.string().max(4000).default(""),
  playbookId: z.number().int().positive().optional(),
});
export const acqFollowUpReceiptSchema = z.object({
  id: z.number(),
  followUpId: z.number(),
  attempt: z.number(),
  text: z.string(),
  accountId: z.string(),
  operationId: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export const acqQcDimensionSchema = z.object({
  key: z.string(),
  name: z.string(),
  score: z.number().int().min(0).max(20),
  note: z.string(),
});
export const acqQcIssueSchema = z.object({
  dimension: z.string(),
  quote: z.string(),
  problem: z.string(),
  rewrite: z.string(),
});
export const acqQcReviewSchema = z.object({
  id: z.number(),
  conversationId: z.number(),
  agentUserId: z.string(),
  playbookId: z.number(),
  score: z.number(),
  dimensions: z.array(acqQcDimensionSchema),
  issues: z.array(acqQcIssueSchema),
  suggestions: z.array(z.string()),
  mode: z.string(),
  createdAt: z.string(),
});
export const runAcqQcBodySchema = z.object({
  conversationId: z.number().int().positive(),
  playbookId: z.number().int().positive().optional(),
});
export const acqDashboardSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  funnel: z.array(z.object({ stage: z.string(), label: z.string(), count: z.number(), rate: z.number() })),
  channels: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      leads: z.number(),
      contacted: z.number(),
      replied: z.number(),
      qualified: z.number(),
      promoted: z.number(),
      conversionRate: z.number(),
    }),
  ),
  outreach: z.object({
    sent: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    unknown: z.number(),
    skipped: z.number(),
    moderationBlocked: z.number(),
    successRate: z.number(),
    reasons: z.array(z.object({ reason: z.string(), count: z.number() })),
  }),
  followUp: z.object({
    due: z.number(),
    sentOnce: z.number(),
    completed: z.number(),
    overdue: z.number(),
    secondRoundRatio: z.number(),
  }),
  cost: z.object({
    aiCalls: z.number(),
    points: z.number(),
    outreachCount: z.number(),
    costPerLead: z.number(),
    byCode: z.array(z.object({ code: z.string(), label: z.string(), calls: z.number(), points: z.number() })),
  }),
});
export const acqDashboardQuerySchema = z.object({
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  platform: z.string().max(20).optional(),
  sourceId: z.coerce.number().int().positive().optional(),
  playbookId: z.coerce.number().int().positive().optional(),
  agentUserId: z.string().max(64).optional(),
});
export const acqDashboardExportBodySchema = acqDashboardQuerySchema.extend({
  format: z.enum(["csv", "json"]).default("csv"),
});
export const acqDashboardShareBodySchema = acqDashboardQuerySchema.extend({
  expiresInDays: z.number().int().min(1).max(90).default(7),
  password: z.string().max(60).default(""),
});
export const acqSettingsSchema = z.object({
  enabled: z.boolean(),
  collectEnabled: z.boolean(),
  qcEnabled: z.boolean(),
  outreachAutoSend: z.boolean(),
  humanConfirm: z.boolean(),
  dmAlwaysHuman: z.boolean(),
  dailyComments: z.number(),
  dailyDm: z.number(),
  cooldownDays: z.number(),
  intervalMinSeconds: z.number(),
  intervalMaxSeconds: z.number(),
  activeHoursStart: z.string(),
  activeHoursEnd: z.string(),
  evidenceRetentionDays: z.number(),
  followUpMaxRounds: z.number(),
  defaultPlaybookId: z.number(),
  aiModel: z.string(),
  aiChannelId: z.number(),
  extensionVersion: z.string(),
  extensionDownloadPath: z.string(),
});
export const saveAcqSettingsBodySchema = z.object({
  enabled: z.boolean().optional(),
  collectEnabled: z.boolean().optional(),
  qcEnabled: z.boolean().optional(),
  outreachAutoSend: z.boolean().optional(),
  humanConfirm: z.boolean().optional(),
  dailyComments: z.number().int().min(0).max(500).optional(),
  dailyDm: z.number().int().min(0).max(500).optional(),
  cooldownDays: z.number().int().min(0).max(90).optional(),
  intervalMinSeconds: z.number().int().min(5).max(600).optional(),
  intervalMaxSeconds: z.number().int().min(5).max(900).optional(),
  activeHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  activeHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  evidenceRetentionDays: z.number().int().min(7).max(730).optional(),
  followUpMaxRounds: z.number().int().min(1).max(5).optional(),
  defaultPlaybookId: z.number().int().min(0).optional(),
  aiModel: z.string().max(80).optional(),
  aiChannelId: z.number().int().min(0).optional(),
});
export const acqMetaSchema = z.object({
  platforms: z.array(z.object({ key: z.string(), label: z.string(), collectable: z.boolean() })),
  modes: z.array(z.object({ key: z.string(), label: z.string() })),
  channels: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      action: z.string(),
      executor: z.enum(["PLUGIN", "SERVER"]),
      requiresHuman: z.boolean(),
    }),
  ),
  leadStatuses: z.array(z.object({ key: z.string(), label: z.string() })),
  intentLevels: z.array(z.object({ key: z.string(), label: z.string() })),
  businessStatuses: z.array(z.object({ key: z.string(), label: z.string() })),
  followUpTimeRules: z.array(z.object({ key: z.string(), label: z.string() })),
  qcDimensions: z.array(z.object({ key: z.string(), label: z.string(), max: z.number() })),
  limits: z.record(z.string(), z.unknown()),
  pricing: z.array(z.object({ code: z.string(), unit: z.string(), label: z.string(), unitPriceAmount: z.number(), freeQuotaAmount: z.number() })),
  extension: z.object({ version: z.string(), downloadPath: z.string(), chromeStoreUrl: z.string() }),
  kbOptions: z.array(z.object({ id: z.number(), name: z.string() })),
  faqOptions: z.array(z.object({ id: z.number(), question: z.string() })),
  tableOptions: z.array(z.object({ id: z.number(), name: z.string() })),
});

export const acquisitionEndpoints = {
  Acquisition_sources: {
    method: "get" as const,
    path: "/enterprise/acquisition/sources",
    params: z.object({}),
    query: pageQuerySchema.extend({
      platform: z.string().optional(),
      status: z.string().optional(),
      q: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(acqSourceSchema)),
  },
  Acquisition_saveSource: {
    method: "post" as const,
    path: "/enterprise/acquisition/sources",
    params: z.object({}),
    query: emptyQuery,
    body: saveAcqSourceBodySchema,
    response: envelope(acqSourceSchema),
  },
  Acquisition_removeSource: {
    method: "delete" as const,
    path: "/enterprise/acquisition/sources/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Acquisition_runSource: {
    method: "post" as const,
    path: "/enterprise/acquisition/sources/:id/run",
    params: idParam,
    query: emptyQuery,
    body: z.object({}).default({}),
    response: envelope(acqRunSchema),
  },
  Acquisition_runs: {
    method: "get" as const,
    path: "/enterprise/acquisition/runs",
    params: z.object({}),
    query: pageQuerySchema.extend({
      sourceId: z.coerce.number().int().positive().optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(acqRunSchema)),
  },
  Acquisition_runDetail: {
    method: "get" as const,
    path: "/enterprise/acquisition/runs/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(acqRunSchema.extend({ leads: z.array(acqLeadSchema) })),
  },
  Acquisition_leads: {
    method: "get" as const,
    path: "/enterprise/acquisition/leads",
    params: z.object({}),
    query: pageQuerySchema.extend({
      platform: z.string().optional(),
      status: z.string().optional(),
      intentLevel: z.string().optional(),
      minScore: z.coerce.number().int().min(0).max(100).optional(),
      tag: z.string().optional(),
      q: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(acqLeadSchema)),
  },
  Acquisition_leadDetail: {
    method: "get" as const,
    path: "/enterprise/acquisition/leads/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(acqLeadDetailSchema),
  },
  Acquisition_updateLead: {
    method: "patch" as const,
    path: "/enterprise/acquisition/leads/:id",
    params: idParam,
    query: emptyQuery,
    body: updateAcqLeadBodySchema,
    response: envelope(acqLeadSchema),
  },
  Acquisition_scoreLead: {
    method: "post" as const,
    path: "/enterprise/acquisition/leads/:id/score",
    params: idParam,
    query: emptyQuery,
    body: z.object({ force: z.boolean().default(false) }),
    response: envelope(acqIntentScoreSchema),
  },
  Acquisition_promoteLead: {
    method: "post" as const,
    path: "/enterprise/acquisition/leads/:id/promote",
    params: idParam,
    query: emptyQuery,
    body: promoteAcqLeadBodySchema,
    response: envelope(acqLeadSchema.extend({ crmLeadId: z.number(), profileId: z.number() })),
  },
  Acquisition_leadsToTable: {
    method: "post" as const,
    path: "/enterprise/acquisition/leads/to-table",
    params: z.object({}),
    query: emptyQuery,
    body: acqLeadsToTableBodySchema,
    response: envelope(
      z.object({ tableId: z.number(), written: z.number(), skipped: z.number(), failed: z.number() }),
    ),
  },
  Acquisition_exportLeads: {
    method: "post" as const,
    path: "/enterprise/acquisition/leads/export",
    params: z.object({}),
    query: emptyQuery,
    body: acqExportBodySchema,
    response: envelope(z.object({ jobId: z.number(), status: z.string(), downloadUrl: z.string() })),
  },
  Acquisition_outreach: {
    method: "get" as const,
    path: "/enterprise/acquisition/outreach",
    params: z.object({}),
    query: pageQuerySchema.extend({
      leadId: z.coerce.number().int().positive().optional(),
      channel: z.string().optional(),
      status: z.string().optional(),
      receiptStatus: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(acqOutreachSchema)),
  },
  Acquisition_createOutreach: {
    method: "post" as const,
    path: "/enterprise/acquisition/outreach",
    params: z.object({}),
    query: emptyQuery,
    body: createAcqOutreachBodySchema,
    response: envelope(
      acqOutreachSchema.extend({ drafts: z.array(acqOutreachDraftSchema), blocked: z.string(), mode: z.enum(["rule", "llm"]) }),
    ),
  },
  Acquisition_approveOutreach: {
    method: "post" as const,
    path: "/enterprise/acquisition/outreach/:id/approve",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      finalText: z.string().max(4000).default(""),
      scheduledAt: z.string().max(40).default(""),
      /** 企微群发透传给企点「群发任务」的字段，与既有企微工具同一份口径 */
      payload: z.record(z.string(), z.unknown()).default({}),
      /** 企微群发会产生真实发送与额度消耗，必须显式确认 */
      confirmCost: z.boolean().default(false),
    }),
    response: envelope(acqOutreachSchema),
  },
  Acquisition_cancelOutreach: {
    method: "post" as const,
    path: "/enterprise/acquisition/outreach/:id/cancel",
    params: idParam,
    query: emptyQuery,
    body: z.object({ reason: z.string().max(200).default("") }),
    response: envelope(acqOutreachSchema),
  },
  Acquisition_outreachLogs: {
    method: "get" as const,
    path: "/enterprise/acquisition/outreach/:id/logs",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(acqOutreachLogSchema)),
  },
  Acquisition_pluginToken: {
    method: "post" as const,
    path: "/enterprise/acquisition/plugin/token",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ type: z.enum(ACQ_PLUGIN_TYPES).default("collect") }),
    response: envelope(acqPluginTokenSchema),
  },
  Acquisition_pluginPull: {
    method: "post" as const,
    path: "/enterprise/acquisition/plugin/pull",
    params: z.object({}),
    query: emptyQuery,
    body: acqPluginPullBodySchema,
    response: envelope(z.object({ jobs: z.array(acqPluginJobSchema), intervalMinSeconds: z.number(), intervalMaxSeconds: z.number() })),
  },
  Acquisition_pluginReport: {
    method: "post" as const,
    path: "/enterprise/acquisition/plugin/report",
    params: z.object({}),
    query: emptyQuery,
    body: acqPluginReportBodySchema,
    response: envelope(acqPluginReportResultSchema),
  },
  Acquisition_profiles: {
    method: "get" as const,
    path: "/enterprise/acquisition/profiles",
    params: z.object({}),
    query: pageQuerySchema.extend({
      businessStatus: z.string().optional(),
      ownerUserId: z.string().optional(),
      q: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(acqProfileSchema)),
  },
  Acquisition_profileDetail: {
    method: "get" as const,
    path: "/enterprise/acquisition/profiles/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(acqProfileDetailSchema),
  },
  Acquisition_updateProfile: {
    method: "patch" as const,
    path: "/enterprise/acquisition/profiles/:id",
    params: idParam,
    query: emptyQuery,
    body: updateAcqProfileBodySchema,
    response: envelope(acqProfileSchema),
  },
  Acquisition_profileEvents: {
    method: "get" as const,
    path: "/enterprise/acquisition/profiles/:id/events",
    params: idParam,
    query: pageQuerySchema.extend({ kind: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(acqProfileEventSchema)),
  },
  Acquisition_playbooks: {
    method: "get" as const,
    path: "/enterprise/acquisition/playbooks",
    params: z.object({}),
    query: pageQuerySchema.extend({ status: z.string().optional(), q: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(acqPlaybookSchema)),
  },
  Acquisition_savePlaybook: {
    method: "post" as const,
    path: "/enterprise/acquisition/playbooks",
    params: z.object({}),
    query: emptyQuery,
    body: saveAcqPlaybookBodySchema,
    response: envelope(acqPlaybookSchema),
  },
  Acquisition_publishPlaybook: {
    method: "post" as const,
    path: "/enterprise/acquisition/playbooks/:id/publish",
    params: idParam,
    query: emptyQuery,
    body: z.object({}).default({}),
    response: envelope(acqPlaybookSchema),
  },
  Acquisition_playbookVersions: {
    method: "get" as const,
    path: "/enterprise/acquisition/playbooks/:id/versions",
    params: idParam,
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(acqPlaybookVersionSchema)),
  },
  Acquisition_playbookPreview: {
    method: "post" as const,
    path: "/enterprise/acquisition/playbooks/:id/preview",
    params: idParam,
    query: emptyQuery,
    body: acqPlaybookPreviewBodySchema,
    response: envelope(acqPlaybookPreviewSchema),
  },
  Acquisition_followUps: {
    method: "get" as const,
    path: "/enterprise/acquisition/follow-ups",
    params: z.object({}),
    query: pageQuerySchema.extend({
      profileId: z.coerce.number().int().positive().optional(),
      status: z.string().optional(),
      due: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(acqFollowUpSchema)),
  },
  Acquisition_createFollowUp: {
    method: "post" as const,
    path: "/enterprise/acquisition/follow-ups",
    params: z.object({}),
    query: emptyQuery,
    body: createAcqFollowUpBodySchema,
    response: envelope(acqFollowUpSchema),
  },
  Acquisition_cancelFollowUp: {
    method: "post" as const,
    path: "/enterprise/acquisition/follow-ups/:id/cancel",
    params: idParam,
    query: emptyQuery,
    body: z.object({ reason: z.string().max(200).default("") }),
    response: envelope(acqFollowUpSchema),
  },
  Acquisition_completeFollowUp: {
    method: "post" as const,
    path: "/enterprise/acquisition/follow-ups/:id/complete",
    params: idParam,
    query: emptyQuery,
    body: z.object({ reason: z.string().max(200).default("") }),
    response: envelope(acqFollowUpSchema.extend({ receipts: z.array(acqFollowUpReceiptSchema) })),
  },
  Acquisition_qcReviews: {
    method: "get" as const,
    path: "/enterprise/acquisition/qc",
    params: z.object({}),
    query: pageQuerySchema.extend({
      conversationId: z.coerce.number().int().positive().optional(),
      agentUserId: z.string().optional(),
      playbookId: z.coerce.number().int().positive().optional(),
      maxScore: z.coerce.number().int().min(0).max(100).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(acqQcReviewSchema)),
  },
  Acquisition_runQc: {
    method: "post" as const,
    path: "/enterprise/acquisition/qc/run",
    params: z.object({}),
    query: emptyQuery,
    body: runAcqQcBodySchema,
    response: envelope(acqQcReviewSchema),
  },
  Acquisition_qcDetail: {
    method: "get" as const,
    path: "/enterprise/acquisition/qc/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      acqQcReviewSchema.extend({
        conversationTitle: z.string(),
        messages: z.array(z.object({ role: z.string(), text: z.string(), at: z.string() })),
      }),
    ),
  },
  Acquisition_dashboard: {
    method: "get" as const,
    path: "/enterprise/acquisition/dashboard",
    params: z.object({}),
    query: acqDashboardQuerySchema,
    body: z.undefined(),
    response: envelope(acqDashboardSchema),
  },
  Acquisition_dashboardExport: {
    method: "post" as const,
    path: "/enterprise/acquisition/dashboard/export",
    params: z.object({}),
    query: emptyQuery,
    body: acqDashboardExportBodySchema,
    response: envelope(z.object({ jobId: z.number(), status: z.string(), downloadUrl: z.string() })),
  },
  Acquisition_dashboardShare: {
    method: "post" as const,
    path: "/enterprise/acquisition/dashboard/share",
    params: z.object({}),
    query: emptyQuery,
    body: acqDashboardShareBodySchema,
    response: envelope(z.object({ shareId: z.number(), url: z.string(), expiresAt: z.string() })),
  },
  Acquisition_settings: {
    method: "get" as const,
    path: "/enterprise/acquisition/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(acqSettingsSchema),
  },
  Acquisition_saveSettings: {
    method: "post" as const,
    path: "/enterprise/acquisition/settings",
    params: z.object({}),
    query: emptyQuery,
    body: saveAcqSettingsBodySchema,
    response: envelope(acqSettingsSchema),
  },
  Acquisition_meta: {
    method: "get" as const,
    path: "/enterprise/acquisition/meta",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(acqMetaSchema),
  },
};