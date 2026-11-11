import { apiEnvelope, endpoints, z, type EndpointResponse } from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

/**
 * 附录 B 补齐项的薄包装：与契约 `xxx_*` 一一对应，视图类型从响应派生。
 */

export type EntitlementPlan =
  NonNullable<EndpointResponse<"Plan_plans">["data"]>[number];
export type OrgEntitlement = NonNullable<EndpointResponse<"Plan_orgPlan">["data"]>;
export type AppointmentEvent =
  NonNullable<EndpointResponse<"Apt_events">["data"]>[number];
export type AppointmentSlot =
  NonNullable<EndpointResponse<"Apt_slots">["data"]>[number];
export type AppointmentBooking =
  NonNullable<EndpointResponse<"Apt_bookings">["data"]>["list"][number];
export type MailTemplate =
  NonNullable<EndpointResponse<"MailTpl_templates">["data"]>[number];
export type AssistantAnswer =
  NonNullable<EndpointResponse<"Assistant_ask">["data"]>;
export type AssistantHistory =
  NonNullable<EndpointResponse<"Assistant_history">["data"]>["list"][number];
export type AssistantRegistry =
  NonNullable<EndpointResponse<"Assistant_registry">["data"]>[number];
export type AssistantExtractResult =
  NonNullable<EndpointResponse<"Assistant_extractActions">["data"]>;
export type AiTranscript =
  NonNullable<EndpointResponse<"Transcribe_transcripts">["data"]>["list"][number];
export type QuotationTracking =
  NonNullable<EndpointResponse<"Quote_tracking">["data"]>["list"][number];
export type TimeAuditRow =
  NonNullable<EndpointResponse<"TimeAudit_edits">["data"]>["list"][number];
export type TimeAuditSummary =
  NonNullable<EndpointResponse<"TimeAudit_summary">["data"]>[number];
export type PromoCode =
  NonNullable<EndpointResponse<"Promo_promoCodes">["data"]>[number];
export type AfterSalesTicket =
  NonNullable<EndpointResponse<"AfterSales_tickets">["data"]>["list"][number];
export type TaskSyncBinding =
  NonNullable<EndpointResponse<"TaskSync_bindings">["data"]>[number];
export type TaskSyncRun =
  NonNullable<EndpointResponse<"TaskSync_runs">["data"]>["list"][number];
export type TaskSyncLink =
  NonNullable<EndpointResponse<"TaskSync_links">["data"]>["list"][number];
export type TermsDocument =
  NonNullable<EndpointResponse<"Terms_documents">["data"]>[number];
export type TermsAcceptance =
  NonNullable<EndpointResponse<"Terms_my">["data"]>[number];
export type OnboardingTemplate =
  NonNullable<EndpointResponse<"Onboard_templates">["data"]>[number];
export type OnboardingRun =
  NonNullable<EndpointResponse<"Onboard_runs">["data"]>["list"][number];
export type ChangelogEntry =
  NonNullable<EndpointResponse<"Changelog_entries">["data"]>["list"][number];
export type OrgContext =
  NonNullable<EndpointResponse<"OrgCtx_contexts">["data"]>[number];
export type UsageSettings =
  NonNullable<EndpointResponse<"Usage_settings">["data"]>;
export type UsageEvent =
  NonNullable<EndpointResponse<"Usage_events">["data"]>["list"][number];
export type UsageSummary = NonNullable<EndpointResponse<"Usage_summary">["data"]>;

// 时长卡（日卡 / 30 天卡）：视图类型全部从契约响应派生
export type CardTemplate =
  NonNullable<EndpointResponse<"Card_templates">["data"]>[number];
export type MyCard = NonNullable<EndpointResponse<"Card_myCards">["data"]>[number];
export type UsableCard =
  NonNullable<EndpointResponse<"Card_usableCards">["data"]>[number];
export type CardOrder =
  NonNullable<EndpointResponse<"Card_orders">["data"]>["list"][number];
export type CardUsageRow =
  NonNullable<EndpointResponse<"Card_orderUsage">["data"]>["list"][number];

export const gapsApi = {
  // B1#2 权益配额目录
  plans: endpoint(endpoints.Plan_plans),
  savePlan: endpoint(endpoints.Plan_savePlan),
  removePlan: endpoint(endpoints.Plan_removePlan),
  orgPlan: endpoint(endpoints.Plan_orgPlan),
  assignEntitlement: endpoint(endpoints.Plan_assign),
  consumeEntitlement: endpoint(endpoints.Plan_consume),

  // B1#7 预约 / 忙闲
  appointmentEvents: endpoint(endpoints.Apt_events),
  saveAppointmentEvent: endpoint(endpoints.Apt_saveEvent),
  removeAppointmentEvent: endpoint(endpoints.Apt_removeEvent),
  appointmentSlots: endpoint(endpoints.Apt_slots),
  generateAppointmentSlots: endpoint(endpoints.Apt_generateSlots),
  appointmentBookings: endpoint(endpoints.Apt_bookings),
  bookAppointment: endpoint(endpoints.Apt_book),
  cancelAppointmentBooking: endpoint(endpoints.Apt_cancelBooking),

  // B1#10 邮件模板
  mailTemplates: endpoint(endpoints.MailTpl_templates),
  mailTemplate: endpoint(endpoints.MailTpl_template),
  saveMailTemplate: endpoint(endpoints.MailTpl_saveTemplate),
  removeMailTemplate: endpoint(endpoints.MailTpl_removeTemplate),
  previewMailTemplate: endpoint(endpoints.MailTpl_previewTemplate),
  sendTestMail: endpoint(endpoints.MailTpl_sendTest),

  // B2#15 页面感知助手
  askAssistant: endpoint(endpoints.Assistant_ask),
  assistantHistory: endpoint(endpoints.Assistant_history),
  assistantRegistry: endpoint(endpoints.Assistant_registry),
  extractAssistantActions: endpoint(endpoints.Assistant_extractActions),

  // B2#16 会话语音转写
  transcripts: endpoint(endpoints.Transcribe_transcripts),
  createTranscript: endpoint(endpoints.Transcribe_create),
  transcript: endpoint(endpoints.Transcribe_transcript),
  summarizeTranscript: endpoint(endpoints.Transcribe_summarize),
  applyInterviewDraft: endpoint(endpoints.Transcribe_applyInterviewDraft),
  removeTranscript: endpoint(endpoints.Transcribe_remove),

  // B3#18 报价单 PDF 与发送跟踪
  quotationDocument: endpoint(endpoints.Quote_document),
  sendQuotation: endpoint(endpoints.Quote_send),
  quotationTracking: endpoint(endpoints.Quote_tracking),

  // B3#21 工时修改审计
  timeAuditEdits: endpoint(endpoints.TimeAudit_edits),
  timeAuditSummary: endpoint(endpoints.TimeAudit_summary),

  // B3#22① 促销码
  promoCodes: endpoint(endpoints.Promo_promoCodes),
  savePromoCode: endpoint(endpoints.Promo_savePromoCode),
  removePromoCode: endpoint(endpoints.Promo_removePromoCode),
  redeemPromoCode: endpoint(endpoints.Promo_redeem),

  // B3#22② 售后状态机
  afterSalesTickets: endpoint(endpoints.AfterSales_tickets),
  afterSalesTicket: endpoint(endpoints.AfterSales_ticket),
  saveAfterSalesTicket: endpoint(endpoints.AfterSales_saveTicket),
  advanceAfterSales: endpoint(endpoints.AfterSales_advance),

  // B3#23 三方任务双向同步
  taskSyncBindings: endpoint(endpoints.TaskSync_bindings),
  saveTaskSyncBinding: endpoint(endpoints.TaskSync_saveBinding),
  removeTaskSyncBinding: endpoint(endpoints.TaskSync_removeBinding),
  runTaskSync: endpoint(endpoints.TaskSync_run),
  taskSyncRuns: endpoint(endpoints.TaskSync_runs),
  taskSyncLinks: endpoint(endpoints.TaskSync_links),

  // B3#26 条款接受留痕
  termsDocuments: endpoint(endpoints.Terms_documents),
  saveTermsDocument: endpoint(endpoints.Terms_saveDocument),
  removeTermsDocument: endpoint(endpoints.Terms_removeDocument),
  acceptTerms: endpoint(endpoints.Terms_accept),
  myTerms: endpoint(endpoints.Terms_my),
  pendingTerms: endpoint(endpoints.Terms_pending),

  // B3#27 入职引导清单
  onboardingTemplates: endpoint(endpoints.Onboard_templates),
  saveOnboardingTemplate: endpoint(endpoints.Onboard_saveTemplate),
  removeOnboardingTemplate: endpoint(endpoints.Onboard_removeTemplate),
  onboardingRuns: endpoint(endpoints.Onboard_runs),
  onboardingRun: endpoint(endpoints.Onboard_run),
  startOnboardingRun: endpoint(endpoints.Onboard_startRun),
  completeOnboardingTask: endpoint(endpoints.Onboard_completeTask),

  // B3#28 产品更新日志
  changelogEntries: endpoint(endpoints.Changelog_entries),
  saveChangelog: endpoint(endpoints.Changelog_save),
  removeChangelog: endpoint(endpoints.Changelog_remove),

  // B3#29 主体切换器
  orgContexts: endpoint(endpoints.OrgCtx_contexts),
  switchOrgContext: endpoint(endpoints.OrgCtx_switch),

  // B3#30 使用埋点
  trackUsage: endpoint(endpoints.Usage_track),
  usageEvents: endpoint(endpoints.Usage_events),
  usageSummary: endpoint(endpoints.Usage_summary),
  usageSettings: endpoint(endpoints.Usage_settings),
  saveUsageSettings: endpoint(endpoints.Usage_saveSettings),
};

/* ------------------------------------------------------------------ 时长卡 */

/**
 * 日卡 / 30 天卡：规格目录、我的卡、兑换订单与扣量明细。
 * 用户侧与平台管理侧分开导出，管理侧只给「积分与计费 → 时长卡规格」页签使用。
 */
export const cardApi = {
  templates: endpoint(endpoints.Card_templates),
  myCards: endpoint(endpoints.Card_myCards),
  usableCards: endpoint(endpoints.Card_usableCards),
  orders: endpoint(endpoints.Card_orders),
  orderUsage: endpoint(endpoints.Card_orderUsage),
  exchangeByPoints: endpoint(endpoints.Card_exchangeByPoints),
  createCashOrder: endpoint(endpoints.Card_createCashOrder),
  queryOrder: endpoint(endpoints.Card_queryOrder),
};

export const adminCardApi = {
  templates: endpoint(endpoints.AdminCard_templates),
  saveTemplate: endpoint(endpoints.AdminCard_saveTemplate),
  removeTemplate: endpoint(endpoints.AdminCard_removeTemplate),
  revokeCard: endpoint(endpoints.AdminCard_revokeCard),
};

/* ------------------------------------------------------------------ 公开通道 */

const publicAppointmentSlotSchema = z.object({
  id: z.number(),
  startAt: z.string(),
  endAt: z.string(),
  label: z.string(),
});

const publicAppointmentSchema = z.object({
  title: z.string(),
  purpose: z.string(),
  purposeLabel: z.string(),
  durationMin: z.number(),
  location: z.string(),
  description: z.string(),
  slots: z.array(publicAppointmentSlotSchema),
});

export type PublicAppointment = z.infer<typeof publicAppointmentSchema>;

const publicTermsSchema = z.object({
  id: z.number(),
  code: z.string(),
  version: z.string(),
  title: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  content: z.string(),
  requireReaccept: z.boolean(),
  effectiveAt: z.string().nullable().optional(),
  /** CUSTOM＝后台已发布版本；DEFAULT＝平台内置默认文本（尚未在后台发布）。 */
  source: z.enum(["CUSTOM", "DEFAULT"]).optional(),
});

export type PublicTerms = z.infer<typeof publicTermsSchema>;

/** 免登录公开页专用：直接读 /api/public/*，不挂业务登录态。 */
export const gapsPublicApi = {
  async appointment(slug: string) {
    const result = await http(
      `/api/public/appointments/${encodeURIComponent(slug)}`,
      apiEnvelope(publicAppointmentSchema),
    );
    if (!result.data.data) throw new Error("预约链接不存在或已关闭");
    return result.data.data;
  },
  async bookAppointment(
    slug: string,
    body: {
      slotId: number;
      name: string;
      phone?: string;
      email?: string;
      company?: string;
      note?: string;
    },
  ) {
    const result = await http(
      `/api/public/appointments/${encodeURIComponent(slug)}/book`,
      apiEnvelope(z.unknown()),
      { method: "POST", body },
    );
    return result.data.data;
  },
  async terms(code: string) {
    const result = await http(
      `/api/public/terms/${encodeURIComponent(code)}`,
      apiEnvelope(publicTermsSchema),
    );
    if (!result.data.data) throw new Error("条款不存在");
    return result.data.data;
  },
  /** 注册页必读清单（用户注册协议 + 隐私政策，含当前生效版本号）。 */
  async registerConsents() {
    const result = await http(
      "/api/public/terms/register-consents",
      apiEnvelope(z.array(publicTermsSchema)),
    );
    return result.data.data ?? [];
  },
};
