import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const passthroughBody = z.object({}).passthrough();
const jsonObject = z.record(z.string(), z.unknown());
const idBody = z.object({ id: z.number().int().positive() });

/**
 * 附录 B 剩余项契约（2026-11-07）：
 * 权益配额 / 预约忙闲 / 邮件模板 / 页面助手 / 语音转写 / 报价单 PDF /
 * 工时审计 / 促销码 / 售后状态机 / 服务评价 / 三方任务同步 / 条款留痕 /
 * 入职引导 / 产品更新日志 / 主体切换 / 使用埋点。
 * 所有页面文案由前端按 `*_LABELS` 映射，界面不出现裸枚举。
 */

// ---------------------------------------------------------------------------
// B1#2 权益配额目录
// ---------------------------------------------------------------------------

export const ENTITLEMENT_AUDIENCES = ["USER", "ENTERPRISE", "PROVIDER"] as const;
export const ENTITLEMENT_AUDIENCE_LABELS: Record<string, string> = {
  USER: "个人版",
  ENTERPRISE: "企业版",
  PROVIDER: "服务商版",
};

export const entitlementQuotaSchema = z.object({
  featureCode: z.string(),
  access: z.enum(["allowed", "denied"]),
  limitCount: z.number().int(),
  unit: z.string(),
  note: z.string(),
});
export type EntitlementQuota = z.infer<typeof entitlementQuotaSchema>;

export const entitlementPlanSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  audience: z.string(),
  audienceLabel: z.string(),
  description: z.string(),
  priceMonthly: z.number(),
  status: z.string(),
  quotas: z.array(entitlementQuotaSchema),
  updatedAt: z.string(),
});
export type EntitlementPlan = z.infer<typeof entitlementPlanSchema>;

export const saveEntitlementPlanBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(1).max(64),
  audience: z.enum(ENTITLEMENT_AUDIENCES).default("ENTERPRISE"),
  description: z.string().max(500).default(""),
  priceMonthly: z.number().min(0).default(0),
  status: z.enum(["ACTIVE", "ARCHIVED"]).default("ACTIVE"),
  quotas: z
    .array(
      z.object({
        featureCode: z.string().trim().min(1).max(64),
        access: z.enum(["allowed", "denied"]).default("allowed"),
        limitCount: z.number().int().min(-1).default(-1),
        unit: z.string().max(16).default(""),
        note: z.string().max(200).default(""),
      }),
    )
    .max(300)
    .default([]),
});

export const orgEntitlementSchema = z.object({
  orgType: z.string(),
  orgUserId: z.string(),
  planCode: z.string(),
  planName: z.string(),
  audience: z.string(),
  source: z.string(),
  status: z.string(),
  startedAt: z.string(),
  expiresAt: z.string(),
  quotas: z.array(
    entitlementQuotaSchema.extend({
      usedCount: z.number().int(),
      period: z.string(),
    }),
  ),
});
export type OrgEntitlement = z.infer<typeof orgEntitlementSchema>;

export const assignEntitlementBodySchema = z.object({
  orgUserId: z.string().trim().max(64).default(""),
  planCode: z.string().trim().min(1).max(32),
  expiresAt: z.string().max(32).default(""),
});

export const consumeEntitlementBodySchema = z.object({
  featureCode: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).default(1),
});

// ---------------------------------------------------------------------------
// B1#7 预约 / 忙闲
// ---------------------------------------------------------------------------

export const APPOINTMENT_PURPOSES = ["INTERVIEW", "SERVICE", "MEETING"] as const;
export const APPOINTMENT_PURPOSE_LABELS: Record<string, string> = {
  INTERVIEW: "面试",
  SERVICE: "客户会面",
  MEETING: "项目会议",
};
export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  BOOKED: "已预约",
  DONE: "已完成",
  CANCELED: "已取消",
};

export const appointmentEventSchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  purpose: z.string(),
  purposeLabel: z.string(),
  durationMin: z.number(),
  bufferMin: z.number(),
  location: z.string(),
  description: z.string(),
  horizonDays: z.number(),
  active: z.boolean(),
  publicUrl: z.string(),
  upcomingSlots: z.number(),
  upcomingBookings: z.number(),
  createdAt: z.string(),
});
export type AppointmentEvent = z.infer<typeof appointmentEventSchema>;

export const appointmentSlotSchema = z.object({
  id: z.number(),
  eventId: z.number(),
  startAt: z.string(),
  endAt: z.string(),
  booked: z.boolean(),
});
export type AppointmentSlot = z.infer<typeof appointmentSlotSchema>;

export const appointmentBookingSchema = z.object({
  id: z.number(),
  eventId: z.number(),
  slotId: z.number(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  company: z.string(),
  note: z.string(),
  refType: z.string(),
  refId: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  eventTitle: z.string(),
  createdAt: z.string(),
});
export type AppointmentBooking = z.infer<typeof appointmentBookingSchema>;

export const saveAppointmentEventBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9-]+$/)
    .default(""),
  title: z.string().trim().min(1).max(120),
  purpose: z.enum(APPOINTMENT_PURPOSES).default("MEETING"),
  durationMin: z.number().int().min(10).max(480).default(30),
  bufferMin: z.number().int().min(0).max(120).default(10),
  location: z.string().max(200).default(""),
  description: z.string().max(1000).default(""),
  horizonDays: z.number().int().min(1).max(180).default(30),
  active: z.boolean().default(true),
});

export const generateAppointmentSlotsBodySchema = z.object({
  eventId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  stepMin: z.number().int().min(5).max(240).default(30),
});

export const bookAppointmentBodySchema = z.object({
  slotId: z.number().int().positive(),
  name: z.string().trim().min(1).max(64),
  phone: z.string().max(32).default(""),
  email: z.string().max(120).default(""),
  company: z.string().max(120).default(""),
  note: z.string().max(1000).default(""),
  refType: z.string().max(24).default(""),
  refId: z.string().max(64).default(""),
});

// ---------------------------------------------------------------------------
// B1#10 邮件模板体系
// ---------------------------------------------------------------------------

export const emailTemplateVariableSchema = z.object({
  key: z.string().max(48),
  label: z.string().max(64),
  required: z.boolean().default(false),
});

export const emailTemplateSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  locale: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  variables: z.array(emailTemplateVariableSchema),
  enabled: z.boolean(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

export const saveEmailTemplateBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  code: z.string().trim().min(2).max(48),
  name: z.string().trim().min(1).max(80),
  locale: z.string().trim().min(2).max(16).default("zh-CN"),
  subject: z.string().trim().min(1).max(200),
  html: z.string().max(200000).default(""),
  text: z.string().max(20000).default(""),
  variables: z.array(emailTemplateVariableSchema).max(50).default([]),
  enabled: z.boolean().default(true),
});

export const previewEmailTemplateBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  subject: z.string().max(200).default(""),
  html: z.string().max(200000).default(""),
  text: z.string().max(20000).default(""),
  variables: jsonObject.default({}),
});
export const emailTemplatePreviewSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  missing: z.array(z.string()),
});

export const sendEmailTemplateBodySchema = z.object({
  id: z.number().int().positive(),
  mailboxId: z.number().int().positive(),
  to: z.string().trim().min(3).max(200),
  variables: jsonObject.default({}),
});

// ---------------------------------------------------------------------------
// B2#15 页面感知助手
// ---------------------------------------------------------------------------

export const assistantAskBodySchema = z.object({
  route: z.string().trim().min(1).max(200),
  entityType: z.string().max(32).default(""),
  entityId: z.string().max(64).default(""),
  question: z.string().trim().min(1).max(1000),
  model: z.string().max(128).default(""),
  channelId: z.number().int().min(0).default(0),
});

export const assistantAnswerSchema = z.object({
  answer: z.string(),
  model: z.string(),
  source: z.string(),
  context: z.array(z.object({ label: z.string(), value: z.string() })),
});

export const assistantHistoryRowSchema = z.object({
  id: z.number(),
  route: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  question: z.string(),
  answer: z.string(),
  model: z.string(),
  createdAt: z.string(),
});

export const assistantRegistryRowSchema = z.object({
  route: z.string(),
  title: z.string(),
  domain: z.string(),
  entityType: z.string(),
});

// ---------------------------------------------------------------------------
// B2#16 会话语音转写
// ---------------------------------------------------------------------------

export const AI_TRANSCRIPT_TARGETS = ["INTERVIEW", "MEETING", "SERVICE", "OTHER"] as const;
export const AI_TRANSCRIPT_TARGET_LABELS: Record<string, string> = {
  INTERVIEW: "面试",
  MEETING: "会议",
  SERVICE: "客服会话",
  OTHER: "其他",
};

export const aiTranscriptSchema = z.object({
  id: z.number(),
  targetType: z.string(),
  targetTypeLabel: z.string(),
  targetId: z.number(),
  title: z.string(),
  audioName: z.string(),
  durationSec: z.number(),
  language: z.string(),
  transcript: z.string(),
  summary: z.string(),
  insights: jsonObject,
  model: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type AiTranscript = z.infer<typeof aiTranscriptSchema>;

export const createTranscriptBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  targetType: z.enum(AI_TRANSCRIPT_TARGETS).default("OTHER"),
  targetId: z.number().int().min(0).default(0),
  mediaUrl: z.string().trim().min(1).max(2000),
  audioName: z.string().max(200).default(""),
  durationSec: z.number().int().min(0).default(0),
  language: z.string().max(16).default("zh"),
});

export const summarizeTranscriptBodySchema = z.object({
  prompt: z.string().max(2000).default(""),
});

export const applyTranscriptBodySchema = z.object({
  interviewId: z.number().int().positive(),
  interviewerUserId: z.string().max(64).default(""),
});

// ---------------------------------------------------------------------------
// B3#18 报价单 PDF 与发送跟踪
// ---------------------------------------------------------------------------

export const quotationDocumentSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  base64: z.string(),
});

export const sendQuotationBodySchema = z.object({
  customerName: z.string().max(120).default(""),
  note: z.string().max(1000).default(""),
  templateCode: z.enum(["CLASSIC", "MODERN", "MINIMAL"]).default("CLASSIC"),
});

export const sendQuotationResultSchema = z.object({
  publicToken: z.string(),
  publicUrl: z.string(),
  sentAt: z.string(),
});

export const quotationTrackingRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  customerName: z.string(),
  amount: z.number(),
  sentAt: z.string(),
  readAt: z.string(),
  viewCount: z.number(),
  publicUrl: z.string(),
  opportunityId: z.number(),
});

// ---------------------------------------------------------------------------
// B3#21 工时修改审计
// ---------------------------------------------------------------------------

export const timeAuditRowSchema = z.object({
  id: z.number(),
  timeLogId: z.number(),
  action: z.string(),
  actionLabel: z.string(),
  editorId: z.string(),
  before: jsonObject,
  after: jsonObject,
  reason: z.string(),
  createdAt: z.string(),
});
export type TimeAuditRow = z.infer<typeof timeAuditRowSchema>;

export const timeAuditSummaryRowSchema = z.object({
  editorId: z.string(),
  edits: z.number(),
  deletes: z.number(),
  minutesDelta: z.number(),
});

// ---------------------------------------------------------------------------
// B3#22① 促销码
// ---------------------------------------------------------------------------

export const PROMO_KIND_LABELS: Record<string, string> = {
  FIXED: "固定积分",
  PERCENT: "按比例返积分",
};

export const promoCodeSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  value: z.number(),
  minAmount: z.number(),
  maxRedemptions: z.number(),
  redeemedCount: z.number(),
  perUserLimit: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  createdAt: z.string(),
});
export type PromoCode = z.infer<typeof promoCodeSchema>;

export const savePromoCodeBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  code: z.string().trim().min(3).max(32),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["FIXED", "PERCENT"]).default("FIXED"),
  value: z.number().min(0),
  minAmount: z.number().min(0).default(0),
  maxRedemptions: z.number().int().min(0).default(0),
  perUserLimit: z.number().int().min(1).max(100).default(1),
  startsAt: z.string().max(32).default(""),
  endsAt: z.string().max(32).default(""),
  status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
});

export const redeemPromoBodySchema = z.object({
  code: z.string().trim().min(1).max(32),
  amount: z.number().min(0).default(0),
});
export const redeemPromoResultSchema = z.object({
  points: z.number(),
  balance: z.number(),
  promoCode: z.string(),
  promoName: z.string(),
});

// ---------------------------------------------------------------------------
// B3#22② 售后状态机
// ---------------------------------------------------------------------------

export const AFTER_SALES_KIND_LABELS: Record<string, string> = {
  RETURN: "退货",
  REPAIR: "维修",
  REFUND: "退款",
  EXCHANGE: "换货",
};
export const AFTER_SALES_STATUS_LABELS: Record<string, string> = {
  PENDING: "待受理",
  REVIEWING: "处理中",
  APPROVED: "已同意",
  REJECTED: "已拒绝",
  RECEIVED: "已收货",
  SHIPPED: "已寄回",
  COMPLETED: "已完成",
  CANCELED: "已取消",
};

export const afterSalesEventSchema = z.object({
  id: z.number(),
  fromStatus: z.string(),
  toStatus: z.string(),
  note: z.string(),
  operatorId: z.string(),
  createdAt: z.string(),
});

export const afterSalesTicketSchema = z.object({
  id: z.number(),
  conversationId: z.number(),
  orderNo: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  reason: z.string(),
  amount: z.number(),
  contact: z.string(),
  note: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  assigneeUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  events: z.array(afterSalesEventSchema),
});
export type AfterSalesTicket = z.infer<typeof afterSalesTicketSchema>;

export const saveAfterSalesTicketBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  conversationId: z.number().int().min(0).default(0),
  orderNo: z.string().max(64).default(""),
  kind: z.enum(["RETURN", "REPAIR", "REFUND", "EXCHANGE"]).default("RETURN"),
  reason: z.string().max(500).default(""),
  amount: z.number().min(0).default(0),
  contact: z.string().max(80).default(""),
  note: z.string().max(1000).default(""),
  assigneeUserId: z.string().max(64).default(""),
});

export const advanceAfterSalesBodySchema = z.object({
  toStatus: z.enum([
    "PENDING",
    "REVIEWING",
    "APPROVED",
    "REJECTED",
    "RECEIVED",
    "SHIPPED",
    "COMPLETED",
    "CANCELED",
  ]),
  note: z.string().max(500).default(""),
});

// ---------------------------------------------------------------------------
// B3#22③ 服务评价
// ---------------------------------------------------------------------------

export const marketReviewSchema = z.object({
  id: z.number(),
  listingId: z.string(),
  listingType: z.string(),
  rating: z.number(),
  content: z.string(),
  reviewerName: z.string(),
  reviewerUserId: z.string(),
  orderRef: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type MarketReview = z.infer<typeof marketReviewSchema>;

export const saveMarketReviewBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  listingId: z.string().trim().min(1).max(64),
  listingType: z.enum(["DEMAND", "SUPPLY"]).default("SUPPLY"),
  rating: z.number().int().min(1).max(5),
  content: z.string().max(1000).default(""),
  reviewerName: z.string().max(64).default(""),
  orderRef: z.string().max(64).default(""),
});

export const marketReviewSummarySchema = z.object({
  listingId: z.string(),
  listingType: z.string(),
  average: z.number(),
  count: z.number(),
  distribution: z.array(z.object({ rating: z.number(), count: z.number() })),
});

// ---------------------------------------------------------------------------
// B3#23 三方任务双向同步
// ---------------------------------------------------------------------------

export const TASK_SYNC_PROVIDERS = ["JIRA", "TEAMBITION", "TAPD"] as const;
export const TASK_SYNC_PROVIDER_LABELS: Record<string, string> = {
  JIRA: "Jira",
  TEAMBITION: "Teambition",
  TAPD: "TAPD",
};

export const taskSyncBindingSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  projectName: z.string(),
  provider: z.string(),
  providerLabel: z.string(),
  baseUrl: z.string(),
  projectKey: z.string(),
  username: z.string(),
  hasToken: z.boolean(),
  enabled: z.boolean(),
  lastRunAt: z.string(),
  lastResult: z.string(),
  links: z.number(),
  updatedAt: z.string(),
});
export type TaskSyncBinding = z.infer<typeof taskSyncBindingSchema>;

export const saveTaskSyncBindingBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  projectId: z.number().int().positive(),
  provider: z.enum(TASK_SYNC_PROVIDERS),
  baseUrl: z.string().trim().min(1).max(300),
  projectKey: z.string().max(80).default(""),
  username: z.string().max(120).default(""),
  token: z.string().max(500).default(""),
  enabled: z.boolean().default(true),
});

export const runTaskSyncBodySchema = z.object({
  direction: z.enum(["PUSH", "PULL", "BOTH"]).default("BOTH"),
});

export const taskSyncRunSchema = z.object({
  id: z.number(),
  direction: z.string(),
  pushed: z.number(),
  pulled: z.number(),
  failed: z.number(),
  message: z.string(),
  createdAt: z.string(),
});

export const taskSyncLinkSchema = z.object({
  id: z.number(),
  taskId: z.number(),
  taskTitle: z.string(),
  remoteId: z.string(),
  remoteKey: z.string(),
  remoteStatus: z.string(),
  lastSyncedAt: z.string(),
});

// ---------------------------------------------------------------------------
// B3#26 条款接受留痕
// ---------------------------------------------------------------------------

export const TERMS_CATEGORIES = ["SERVICE", "PRIVACY", "REGISTRATION", "OTHER"] as const;
export const TERMS_CATEGORY_LABELS: Record<string, string> = {
  SERVICE: "服务协议",
  PRIVACY: "隐私政策",
  REGISTRATION: "注册协议",
  OTHER: "其他条款",
};

export const termsDocumentSchema = z.object({
  id: z.number(),
  code: z.string(),
  version: z.string(),
  title: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  content: z.string(),
  requireReaccept: z.boolean(),
  effectiveAt: z.string(),
  status: z.string(),
  acceptedCount: z.number(),
  myAccepted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TermsDocument = z.infer<typeof termsDocumentSchema>;

export const saveTermsDocumentBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  code: z.string().trim().min(2).max(32),
  version: z.string().trim().min(1).max(24),
  title: z.string().trim().min(1).max(160),
  category: z.enum(TERMS_CATEGORIES).default("SERVICE"),
  content: z.string().min(1).max(200000),
  requireReaccept: z.boolean().default(true),
  effectiveAt: z.string().max(32).default(""),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
});

export const acceptTermsBodySchema = z.object({
  code: z.string().trim().min(1).max(32),
  version: z.string().trim().min(1).max(24),
});

export const termsAcceptanceSchema = z.object({
  id: z.number(),
  code: z.string(),
  version: z.string(),
  title: z.string(),
  acceptedAt: z.string(),
  ip: z.string(),
});

// ---------------------------------------------------------------------------
// B3#27 入职引导清单
// ---------------------------------------------------------------------------

export const ONBOARD_OWNER_ROLE_LABELS: Record<string, string> = {
  HR: "HR",
  IT: "IT",
  FINANCE: "财务",
  MANAGER: "直属主管",
  STAFF: "新员工",
};

export const onboardingTemplateItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  ownerRole: z.string(),
  ownerRoleLabel: z.string(),
  dueDays: z.number(),
  sort: z.number(),
});

export const onboardingTemplateSchema = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  description: z.string(),
  active: z.boolean(),
  items: z.array(onboardingTemplateItemSchema),
  updatedAt: z.string(),
});
export type OnboardingTemplate = z.infer<typeof onboardingTemplateSchema>;

export const saveOnboardingTemplateBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["HIRE", "ADMIN"]).default("HIRE"),
  description: z.string().max(500).default(""),
  active: z.boolean().default(true),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        description: z.string().max(500).default(""),
        ownerRole: z.enum(["HR", "IT", "FINANCE", "MANAGER", "STAFF"]).default("STAFF"),
        dueDays: z.number().int().min(0).max(365).default(3),
        sort: z.number().int().min(0).default(0),
      }),
    )
    .max(100)
    .default([]),
});

export const onboardingTaskSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  ownerRole: z.string(),
  ownerRoleLabel: z.string(),
  assigneeUserId: z.string(),
  dueAt: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  doneAt: z.string(),
  note: z.string(),
  sort: z.number(),
});

export const onboardingRunSchema = z.object({
  id: z.number(),
  templateId: z.number(),
  templateName: z.string(),
  staffUserId: z.string(),
  memberUserId: z.string(),
  offerId: z.number(),
  status: z.string(),
  statusLabel: z.string(),
  done: z.number(),
  total: z.number(),
  startedAt: z.string(),
  completedAt: z.string(),
  tasks: z.array(onboardingTaskSchema),
});
export type OnboardingRun = z.infer<typeof onboardingRunSchema>;

export const startOnboardingBodySchema = z.object({
  templateId: z.number().int().positive(),
  staffUserId: z.string().trim().min(1).max(64),
  memberUserId: z.string().max(64).default(""),
  offerId: z.number().int().min(0).default(0),
});

export const completeOnboardingTaskBodySchema = z.object({
  status: z.enum(["TODO", "DONE", "SKIPPED"]).default("DONE"),
  note: z.string().max(500).default(""),
});

// ---------------------------------------------------------------------------
// B3#28 产品更新日志
// ---------------------------------------------------------------------------

export const CHANGELOG_CATEGORY_LABELS: Record<string, string> = {
  PRODUCT: "产品功能",
  MODULE: "模块更新",
  FIX: "问题修复",
  SECURITY: "安全更新",
};

export const changelogEntrySchema = z.object({
  id: z.number(),
  version: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  releasedAt: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

export const saveChangelogBodySchema = z.object({
  id: z.number().int().min(0).default(0),
  version: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(160),
  summary: z.string().max(5000).default(""),
  body: z.string().max(100000).default(""),
  category: z.enum(["PRODUCT", "MODULE", "FIX", "SECURITY"]).default("PRODUCT"),
  releasedAt: z.string().max(32).default(""),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED"),
});

// ---------------------------------------------------------------------------
// B3#29 主体切换器
// ---------------------------------------------------------------------------

export const orgContextSchema = z.object({
  orgType: z.string(),
  orgUserId: z.string(),
  name: z.string(),
  roleLabel: z.string(),
  current: z.boolean(),
});
export type OrgContext = z.infer<typeof orgContextSchema>;

export const switchOrgContextBodySchema = z.object({
  orgType: z.enum(["ENTERPRISE", "PROVIDER"]),
  orgUserId: z.string().trim().min(1).max(64),
});

// ---------------------------------------------------------------------------
// B3#30 使用埋点
// ---------------------------------------------------------------------------

export const trackUsageBodySchema = z.object({
  event: z.string().trim().min(1).max(64),
  route: z.string().max(200).default(""),
  targetType: z.string().max(32).default(""),
  targetId: z.string().max(64).default(""),
  metadata: jsonObject.default({}),
});

export const usageEventSchema = z.object({
  id: z.number(),
  userId: z.string(),
  orgType: z.string(),
  orgUserId: z.string(),
  event: z.string(),
  route: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: jsonObject,
  createdAt: z.string(),
});

export const usageSummaryRowSchema = z.object({
  event: z.string(),
  count: z.number(),
  users: z.number(),
});

export const usageSettingsSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.number(),
});

export const saveUsageSettingsBodySchema = z.object({
  enabled: z.boolean().default(false),
  retentionDays: z.number().int().min(7).max(730).default(90),
});

// ---------------------------------------------------------------------------
// 端点注册
// ---------------------------------------------------------------------------

export const enterpriseGapEndpoints = {
  // B1#2 权益配额目录
  Plan_plans: {
    method: "get" as const,
    path: "/enterprise/entitlements/plans",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(entitlementPlanSchema)),
  },
  Plan_savePlan: {
    method: "post" as const,
    path: "/enterprise/entitlements/plans",
    params: z.object({}),
    query: emptyQuery,
    body: saveEntitlementPlanBodySchema,
    response: envelope(entitlementPlanSchema),
  },
  Plan_removePlan: {
    method: "post" as const,
    path: "/enterprise/entitlements/plans/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Plan_orgPlan: {
    method: "get" as const,
    path: "/enterprise/entitlements/org",
    params: z.object({}),
    query: z.object({ orgType: z.string().optional(), orgUserId: z.string().optional() }),
    body: z.undefined(),
    response: envelope(orgEntitlementSchema),
  },
  Plan_assign: {
    method: "post" as const,
    path: "/enterprise/entitlements/assign",
    params: z.object({}),
    query: emptyQuery,
    body: assignEntitlementBodySchema,
    response: envelope(orgEntitlementSchema),
  },
  Plan_consume: {
    method: "post" as const,
    path: "/enterprise/entitlements/consume",
    params: z.object({}),
    query: emptyQuery,
    body: consumeEntitlementBodySchema,
    response: envelope(
      z.object({ allowed: z.boolean(), used: z.number(), limit: z.number() }),
    ),
  },

  // B1#7 预约 / 忙闲
  Apt_events: {
    method: "get" as const,
    path: "/enterprise/appointments/events",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(appointmentEventSchema)),
  },
  Apt_saveEvent: {
    method: "post" as const,
    path: "/enterprise/appointments/events",
    params: z.object({}),
    query: emptyQuery,
    body: saveAppointmentEventBodySchema,
    response: envelope(appointmentEventSchema),
  },
  Apt_removeEvent: {
    method: "post" as const,
    path: "/enterprise/appointments/events/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Apt_slots: {
    method: "get" as const,
    path: "/enterprise/appointments/slots",
    params: z.object({}),
    query: z.object({
      eventId: z.coerce.number().int().positive(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(appointmentSlotSchema)),
  },
  Apt_generateSlots: {
    method: "post" as const,
    path: "/enterprise/appointments/slots/generate",
    params: z.object({}),
    query: emptyQuery,
    body: generateAppointmentSlotsBodySchema,
    response: envelope(z.array(appointmentSlotSchema)),
  },
  Apt_bookings: {
    method: "get" as const,
    path: "/enterprise/appointments/bookings",
    params: z.object({}),
    query: pageQuerySchema.extend({
      eventId: z.coerce.number().int().min(0).optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(appointmentBookingSchema)),
  },
  Apt_book: {
    method: "post" as const,
    path: "/enterprise/appointments/bookings",
    params: z.object({}),
    query: emptyQuery,
    body: bookAppointmentBodySchema,
    response: envelope(appointmentBookingSchema),
  },
  Apt_cancelBooking: {
    method: "post" as const,
    path: "/enterprise/appointments/bookings/cancel",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive(), note: z.string().max(500).default("") }),
    response: envelope(appointmentBookingSchema),
  },

  // B1#10 邮件模板体系
  MailTpl_templates: {
    method: "get" as const,
    path: "/enterprise/mail/templates",
    params: z.object({}),
    query: z.object({ q: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.array(emailTemplateSchema)),
  },
  MailTpl_template: {
    method: "get" as const,
    path: "/enterprise/mail/templates/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(emailTemplateSchema),
  },
  MailTpl_saveTemplate: {
    method: "post" as const,
    path: "/enterprise/mail/templates",
    params: z.object({}),
    query: emptyQuery,
    body: saveEmailTemplateBodySchema,
    response: envelope(emailTemplateSchema),
  },
  MailTpl_removeTemplate: {
    method: "post" as const,
    path: "/enterprise/mail/templates/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },
  MailTpl_previewTemplate: {
    method: "post" as const,
    path: "/enterprise/mail/templates/preview",
    params: z.object({}),
    query: emptyQuery,
    body: previewEmailTemplateBodySchema,
    response: envelope(emailTemplatePreviewSchema),
  },
  MailTpl_sendTest: {
    method: "post" as const,
    path: "/enterprise/mail/templates/send",
    params: z.object({}),
    query: emptyQuery,
    body: sendEmailTemplateBodySchema,
    response: envelope(z.object({ sent: z.boolean(), savedTo: z.string() })),
  },

  // B2#15 页面感知助手
  Assistant_ask: {
    method: "post" as const,
    path: "/enterprise/assistant/ask",
    params: z.object({}),
    query: emptyQuery,
    body: assistantAskBodySchema,
    response: envelope(assistantAnswerSchema),
  },
  Assistant_history: {
    method: "get" as const,
    path: "/enterprise/assistant/history",
    params: z.object({}),
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(assistantHistoryRowSchema)),
  },
  Assistant_registry: {
    method: "get" as const,
    path: "/enterprise/assistant/registry",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(assistantRegistryRowSchema)),
  },

  // B2#16 会话语音转写
  Transcribe_transcripts: {
    method: "get" as const,
    path: "/enterprise/ai/transcripts",
    params: z.object({}),
    query: pageQuerySchema.extend({
      targetType: z.string().optional(),
      targetId: z.coerce.number().int().min(0).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(aiTranscriptSchema)),
  },
  Transcribe_create: {
    method: "post" as const,
    path: "/enterprise/ai/transcripts",
    params: z.object({}),
    query: emptyQuery,
    body: createTranscriptBodySchema,
    response: envelope(aiTranscriptSchema),
  },
  Transcribe_transcript: {
    method: "get" as const,
    path: "/enterprise/ai/transcripts/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aiTranscriptSchema),
  },
  Transcribe_summarize: {
    method: "post" as const,
    path: "/enterprise/ai/transcripts/:id/summarize",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: summarizeTranscriptBodySchema,
    response: envelope(aiTranscriptSchema),
  },
  Transcribe_applyInterviewDraft: {
    method: "post" as const,
    path: "/enterprise/ai/transcripts/:id/apply-interview",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: applyTranscriptBodySchema,
    response: envelope(
      z.object({
        ratings: z.array(
          z.object({ dimension: z.string(), score: z.number(), note: z.string() }),
        ),
      }),
    ),
  },
  Transcribe_remove: {
    method: "post" as const,
    path: "/enterprise/ai/transcripts/:id/remove",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.object({}),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // B3#18 报价单 PDF 与发送跟踪
  Quote_document: {
    method: "get" as const,
    path: "/enterprise/crm/quotations/:id/document",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(quotationDocumentSchema),
  },
  Quote_send: {
    method: "post" as const,
    path: "/enterprise/crm/quotations/:id/send",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: sendQuotationBodySchema,
    response: envelope(sendQuotationResultSchema),
  },
  Quote_tracking: {
    method: "get" as const,
    path: "/enterprise/crm/quotations/tracking",
    params: z.object({}),
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(quotationTrackingRowSchema)),
  },

  // B3#21 工时修改审计
  TimeAudit_edits: {
    method: "get" as const,
    path: "/enterprise/project/time-audit/edits",
    params: z.object({}),
    query: pageQuerySchema.extend({
      action: z.string().optional(),
      timeLogId: z.coerce.number().int().min(0).optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(timeAuditRowSchema)),
  },
  TimeAudit_summary: {
    method: "get" as const,
    path: "/enterprise/project/time-audit/summary",
    params: z.object({}),
    query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
    body: z.undefined(),
    response: envelope(z.array(timeAuditSummaryRowSchema)),
  },

  // B3#22① 促销码
  Promo_promoCodes: {
    method: "get" as const,
    path: "/enterprise/points/promos",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(promoCodeSchema)),
  },
  Promo_savePromoCode: {
    method: "post" as const,
    path: "/enterprise/points/promos",
    params: z.object({}),
    query: emptyQuery,
    body: savePromoCodeBodySchema,
    response: envelope(promoCodeSchema),
  },
  Promo_removePromoCode: {
    method: "post" as const,
    path: "/enterprise/points/promos/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Promo_redeem: {
    method: "post" as const,
    path: "/enterprise/points/promos/redeem",
    params: z.object({}),
    query: emptyQuery,
    body: redeemPromoBodySchema,
    response: envelope(redeemPromoResultSchema),
  },

  // B3#22② 售后状态机
  AfterSales_tickets: {
    method: "get" as const,
    path: "/enterprise/service-desk/after-sales",
    params: z.object({}),
    query: pageQuerySchema.extend({ status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(afterSalesTicketSchema)),
  },
  AfterSales_ticket: {
    method: "get" as const,
    path: "/enterprise/service-desk/after-sales/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(afterSalesTicketSchema),
  },
  AfterSales_saveTicket: {
    method: "post" as const,
    path: "/enterprise/service-desk/after-sales",
    params: z.object({}),
    query: emptyQuery,
    body: saveAfterSalesTicketBodySchema,
    response: envelope(afterSalesTicketSchema),
  },
  AfterSales_advance: {
    method: "post" as const,
    path: "/enterprise/service-desk/after-sales/:id/advance",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: advanceAfterSalesBodySchema,
    response: envelope(afterSalesTicketSchema),
  },

  // B3#22③ 服务评价
  Review_reviews: {
    method: "get" as const,
    path: "/enterprise/market/reviews",
    params: z.object({}),
    query: pageQuerySchema.extend({
      listingId: z.string().optional(),
      listingType: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(marketReviewSchema)),
  },
  Review_saveReview: {
    method: "post" as const,
    path: "/enterprise/market/reviews",
    params: z.object({}),
    query: emptyQuery,
    body: saveMarketReviewBodySchema,
    response: envelope(marketReviewSchema),
  },
  Review_removeReview: {
    method: "post" as const,
    path: "/enterprise/market/reviews/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Review_summary: {
    method: "get" as const,
    path: "/enterprise/market/reviews/summary",
    params: z.object({}),
    query: z.object({
      listingId: z.string().min(1),
      listingType: z.string().default("SUPPLY"),
    }),
    body: z.undefined(),
    response: envelope(marketReviewSummarySchema),
  },

  // B3#23 三方任务双向同步
  TaskSync_bindings: {
    method: "get" as const,
    path: "/enterprise/project/task-sync",
    params: z.object({}),
    query: z.object({ projectId: z.coerce.number().int().min(0).optional() }),
    body: z.undefined(),
    response: envelope(z.array(taskSyncBindingSchema)),
  },
  TaskSync_saveBinding: {
    method: "post" as const,
    path: "/enterprise/project/task-sync",
    params: z.object({}),
    query: emptyQuery,
    body: saveTaskSyncBindingBodySchema,
    response: envelope(taskSyncBindingSchema),
  },
  TaskSync_removeBinding: {
    method: "post" as const,
    path: "/enterprise/project/task-sync/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },
  TaskSync_run: {
    method: "post" as const,
    path: "/enterprise/project/task-sync/:id/run",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: runTaskSyncBodySchema,
    response: envelope(taskSyncRunSchema),
  },
  TaskSync_runs: {
    method: "get" as const,
    path: "/enterprise/project/task-sync/:id/runs",
    params: z.object({ id: z.string().min(1) }),
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(taskSyncRunSchema)),
  },
  TaskSync_links: {
    method: "get" as const,
    path: "/enterprise/project/task-sync/:id/links",
    params: z.object({ id: z.string().min(1) }),
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(taskSyncLinkSchema)),
  },

  // B3#26 条款接受留痕
  Terms_documents: {
    method: "get" as const,
    path: "/enterprise/terms/documents",
    params: z.object({}),
    query: z.object({ status: z.string().optional(), category: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.array(termsDocumentSchema)),
  },
  Terms_saveDocument: {
    method: "post" as const,
    path: "/enterprise/terms/documents",
    params: z.object({}),
    query: emptyQuery,
    body: saveTermsDocumentBodySchema,
    response: envelope(termsDocumentSchema),
  },
  Terms_removeDocument: {
    method: "post" as const,
    path: "/enterprise/terms/documents/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Terms_accept: {
    method: "post" as const,
    path: "/enterprise/terms/accept",
    params: z.object({}),
    query: emptyQuery,
    body: acceptTermsBodySchema,
    response: envelope(termsAcceptanceSchema),
  },
  Terms_my: {
    method: "get" as const,
    path: "/enterprise/terms/my",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(termsAcceptanceSchema)),
  },
  Terms_pending: {
    method: "get" as const,
    path: "/enterprise/terms/pending",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(termsDocumentSchema)),
  },

  // B3#27 入职引导清单
  Onboard_templates: {
    method: "get" as const,
    path: "/enterprise/hrm/onboarding/templates",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(onboardingTemplateSchema)),
  },
  Onboard_saveTemplate: {
    method: "post" as const,
    path: "/enterprise/hrm/onboarding/templates",
    params: z.object({}),
    query: emptyQuery,
    body: saveOnboardingTemplateBodySchema,
    response: envelope(onboardingTemplateSchema),
  },
  Onboard_removeTemplate: {
    method: "post" as const,
    path: "/enterprise/hrm/onboarding/templates/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Onboard_runs: {
    method: "get" as const,
    path: "/enterprise/hrm/onboarding/runs",
    params: z.object({}),
    query: pageQuerySchema.extend({ status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(onboardingRunSchema)),
  },
  Onboard_run: {
    method: "get" as const,
    path: "/enterprise/hrm/onboarding/runs/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(onboardingRunSchema),
  },
  Onboard_startRun: {
    method: "post" as const,
    path: "/enterprise/hrm/onboarding/runs",
    params: z.object({}),
    query: emptyQuery,
    body: startOnboardingBodySchema,
    response: envelope(onboardingRunSchema),
  },
  Onboard_completeTask: {
    method: "post" as const,
    path: "/enterprise/hrm/onboarding/tasks/:taskId/complete",
    params: z.object({ taskId: z.string().min(1) }),
    query: emptyQuery,
    body: completeOnboardingTaskBodySchema,
    response: envelope(onboardingRunSchema),
  },

  // B3#28 产品更新日志
  Changelog_entries: {
    method: "get" as const,
    path: "/enterprise/help/changelog",
    params: z.object({}),
    query: pageQuerySchema.extend({ status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(changelogEntrySchema)),
  },
  Changelog_save: {
    method: "post" as const,
    path: "/enterprise/help/changelog",
    params: z.object({}),
    query: emptyQuery,
    body: saveChangelogBodySchema,
    response: envelope(changelogEntrySchema),
  },
  Changelog_remove: {
    method: "post" as const,
    path: "/enterprise/help/changelog/remove",
    params: z.object({}),
    query: emptyQuery,
    body: idBody,
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // B3#29 主体切换器
  OrgCtx_contexts: {
    method: "get" as const,
    path: "/enterprise/org/contexts",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(orgContextSchema)),
  },
  OrgCtx_switch: {
    method: "post" as const,
    path: "/enterprise/org/contexts/switch",
    params: z.object({}),
    query: emptyQuery,
    body: switchOrgContextBodySchema,
    response: envelope(orgContextSchema),
  },

  // B3#30 使用埋点
  Usage_track: {
    method: "post" as const,
    path: "/enterprise/usage/track",
    params: z.object({}),
    query: emptyQuery,
    body: trackUsageBodySchema,
    response: envelope(z.object({ recorded: z.boolean() })),
  },
  Usage_events: {
    method: "get" as const,
    path: "/enterprise/usage/events",
    params: z.object({}),
    query: pageQuerySchema.extend({ event: z.string().optional(), userId: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(usageEventSchema)),
  },
  Usage_summary: {
    method: "get" as const,
    path: "/enterprise/usage/summary",
    params: z.object({}),
    query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
    body: z.undefined(),
    response: envelope(
      z.object({
        total: z.number(),
        rows: z.array(usageSummaryRowSchema),
      }),
    ),
  },
  Usage_settings: {
    method: "get" as const,
    path: "/enterprise/usage/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(usageSettingsSchema),
  },
  Usage_saveSettings: {
    method: "post" as const,
    path: "/enterprise/usage/settings",
    params: z.object({}),
    query: emptyQuery,
    body: saveUsageSettingsBodySchema,
    response: envelope(usageSettingsSchema),
  },
} as const;

export type EnterpriseGapEndpoints = typeof enterpriseGapEndpoints;
