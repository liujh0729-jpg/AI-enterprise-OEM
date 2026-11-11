import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** 可映射到微信模板消息的业务事件：后台按事件逐条选择模板与字段。 */
export const WECHAT_MP_EVENT_KEYS = [
  "task.assigned",
  "task.due",
  "task.status",
  "service_desk.reply",
  "service_desk.assign",
  "oa.approval",
  "oa.result",
  "account.security",
  "platform.notice",
  "question.reply",
  "collab.mention",
] as const;
export type WechatMpEventKey = (typeof WECHAT_MP_EVENT_KEYS)[number];
export const WECHAT_MP_EVENT_LABELS: Record<string, string> = {
  "task.assigned": "任务派发",
  "task.due": "任务到期提醒",
  "task.status": "任务状态变更",
  "service_desk.reply": "客服回复",
  "service_desk.assign": "客服会话转接",
  "oa.approval": "OA 审批待办",
  "oa.result": "OA 审批结果",
  "account.security": "账号安全提醒",
  "platform.notice": "平台公告",
  "question.reply": "专题大厅回复",
  "collab.mention": "协作提及",
};

export const wechatMpTemplateFieldSchema = z.object({
  key: z.string().trim().min(1).max(32),
  value: z.string().max(200).default(""),
});
export type WechatMpTemplateField = z.infer<
  typeof wechatMpTemplateFieldSchema
>;

export const wechatMpTemplateMapSchema = z.object({
  eventKey: z.enum(WECHAT_MP_EVENT_KEYS),
  enabled: z.boolean().default(false),
  templateId: z.string().trim().max(64).default(""),
  title: z.string().trim().max(80).default(""),
  fields: z.array(wechatMpTemplateFieldSchema).max(20).default([]),
  url: z.string().trim().max(500).default(""),
  customFallback: z.boolean().default(true),
});
export type WechatMpTemplateMap = z.infer<typeof wechatMpTemplateMapSchema>;

export const wechatMpKeywordReplySchema = z.object({
  keyword: z.string().trim().min(1).max(40),
  match: z.enum(["exact", "contains"]).default("contains"),
  text: z.string().trim().max(1000).default(""),
  linkText: z.string().trim().max(40).default(""),
  linkUrl: z.string().trim().max(500).default(""),
  enabled: z.boolean().default(true),
});
export type WechatMpKeywordReply = z.infer<
  typeof wechatMpKeywordReplySchema
>;

export const wechatMpFollowReplySchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string().trim().max(1000).default(""),
  linkText: z.string().trim().max(40).default(""),
  linkUrl: z.string().trim().max(500).default(""),
});
export type WechatMpFollowReply = z.infer<typeof wechatMpFollowReplySchema>;

export const wechatMpQuietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  start: z.string().trim().max(5).default("22:00"),
  end: z.string().trim().max(5).default("08:00"),
});
export type WechatMpQuietHours = z.infer<typeof wechatMpQuietHoursSchema>;

/** 微信自定义菜单结构：一级 3 个以内，每个一级最多 5 个二级；只支持两级。 */
export const wechatMpMenuLeafSchema = z.object({
  type: z.enum(["view", "click"]).default("view"),
  name: z.string().trim().min(1).max(16),
  url: z.string().trim().max(500).optional(),
  key: z.string().trim().max(128).optional(),
});
export type WechatMpMenuLeaf = z.infer<typeof wechatMpMenuLeafSchema>;

export const wechatMpMenuButtonSchema = z.object({
  type: z.enum(["view", "click"]).default("view"),
  name: z.string().trim().min(1).max(16),
  url: z.string().trim().max(500).optional(),
  key: z.string().trim().max(128).optional(),
  sub_button: z.array(wechatMpMenuLeafSchema).max(5).optional(),
});
export type WechatMpMenuButton = z.infer<typeof wechatMpMenuButtonSchema>;

export const wechatMpMenuSchema = z.object({
  button: z.array(wechatMpMenuButtonSchema).max(3).default([]),
  draftUpdatedAt: z.string().default(""),
  publishedAt: z.string().default(""),
});
export type WechatMpMenu = z.infer<typeof wechatMpMenuSchema>;

export const wechatMpSettingsViewSchema = z.object({
  enabled: z.boolean(),
  accountName: z.string(),
  appId: z.string(),
  tokenConfigured: z.boolean(),
  appSecretConfigured: z.boolean(),
  encodingAesKeyConfigured: z.boolean(),
  encryptedMode: z.boolean(),
  followReply: wechatMpFollowReplySchema,
  keywordReplies: z.array(wechatMpKeywordReplySchema),
  defaultReply: wechatMpFollowReplySchema,
  quietHours: wechatMpQuietHoursSchema,
  dailyCap: z.number(),
  dedupeSeconds: z.number(),
  mobileLinks: z.record(z.string(), z.string()),
  templates: z.array(wechatMpTemplateMapSchema),
  menu: wechatMpMenuSchema,
  serverUrl: z.string(),
  boundCount: z.number(),
  updatedAt: z.string(),
});
export type WechatMpSettingsView = z.infer<
  typeof wechatMpSettingsViewSchema
>;

export const wechatMpSettingsInputSchema = z.object({
  enabled: z.boolean().default(false),
  accountName: z.string().trim().max(80).default(""),
  appId: z.string().trim().max(64).default(""),
  /** 留空表示保留原值。 */
  token: z.string().trim().max(32).optional(),
  appSecret: z.string().max(128).optional(),
  encodingAesKey: z.string().trim().max(64).optional(),
  encryptedMode: z.boolean().default(true),
  followReply: wechatMpFollowReplySchema.default({
    enabled: true,
    text: "",
    linkText: "",
    linkUrl: "",
  }),
  keywordReplies: z.array(wechatMpKeywordReplySchema).max(50).default([]),
  defaultReply: wechatMpFollowReplySchema.default({
    enabled: true,
    text: "",
    linkText: "",
    linkUrl: "",
  }),
  quietHours: wechatMpQuietHoursSchema.default({
    enabled: false,
    start: "22:00",
    end: "08:00",
  }),
  dailyCap: z.number().int().min(0).max(200).default(20),
  dedupeSeconds: z.number().int().min(0).max(86400).default(300),
  mobileLinks: z.record(z.string(), z.string()).default({}),
  templates: z.array(wechatMpTemplateMapSchema).max(50).default([]),
});
export type WechatMpSettingsInput = z.infer<
  typeof wechatMpSettingsInputSchema
>;

export const wechatMpTemplateCatalogSchema = z.object({
  templateId: z.string(),
  title: z.string(),
  content: z.string(),
  example: z.string().default(""),
});
export type WechatMpTemplateCatalog = z.infer<
  typeof wechatMpTemplateCatalogSchema
>;

export const wechatMpBindingRowSchema = z.object({
  id: z.number(),
  userId: z.string(),
  userName: z.string(),
  nickname: z.string(),
  openIdMasked: z.string(),
  subscribed: z.boolean(),
  pushMuted: z.boolean(),
  source: z.string(),
  subscribedAt: z.string().nullable(),
  unsubscribedAt: z.string().nullable(),
  lastInteractionAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WechatMpBindingRow = z.infer<typeof wechatMpBindingRowSchema>;

export const wechatMpMessageRowSchema = z.object({
  id: z.number(),
  userId: z.string(),
  userName: z.string(),
  kind: z.string(),
  eventKey: z.string(),
  templateId: z.string(),
  title: z.string(),
  status: z.string(),
  errcode: z.number().nullable(),
  errmsg: z.string(),
  attempts: z.number(),
  entityType: z.string(),
  entityId: z.string(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export type WechatMpMessageRow = z.infer<
  typeof wechatMpMessageRowSchema
>;

export const wechatMpStatusSchema = z.object({
  enabled: z.boolean(),
  bound: z.boolean(),
  subscribed: z.boolean(),
  muted: z.boolean(),
  nickname: z.string(),
  accountName: z.string(),
  boundAt: z.string().nullable(),
});
export type WechatMpStatus = z.infer<typeof wechatMpStatusSchema>;

export const wechatMpBindSceneSchema = z.object({
  scene: z.string(),
  qrUrl: z.string(),
  expiresAt: z.string(),
});
export type WechatMpBindScene = z.infer<typeof wechatMpBindSceneSchema>;

export const wechatMpAdminStatsSchema = z.object({
  enabled: z.boolean(),
  boundCount: z.number(),
  subscribedCount: z.number(),
  mutedCount: z.number(),
  todaySent: z.number(),
  todayFailed: z.number(),
  templateCount: z.number(),
  menuPublished: z.boolean(),
});
export type WechatMpAdminStats = z.infer<typeof wechatMpAdminStatsSchema>;

export const wechatMpEndpoints = {
  WechatMp_status: {
    method: "get" as const,
    path: "/enterprise/wechat-mp/status",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(wechatMpStatusSchema),
  },
  WechatMp_bindScene: {
    method: "post" as const,
    path: "/enterprise/wechat-mp/bind-scene",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(wechatMpBindSceneSchema),
  },
  WechatMp_unbind: {
    method: "delete" as const,
    path: "/enterprise/wechat-mp/binding",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  WechatMpAdmin_settings: {
    method: "get" as const,
    path: "/enterprise/admin/wechat-mp/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(wechatMpSettingsViewSchema),
  },
  WechatMpAdmin_saveSettings: {
    method: "put" as const,
    path: "/enterprise/admin/wechat-mp/settings",
    params: z.object({}),
    query: emptyQuery,
    body: wechatMpSettingsInputSchema,
    response: envelope(wechatMpSettingsViewSchema),
  },
  WechatMpAdmin_test: {
    method: "post" as const,
    path: "/enterprise/admin/wechat-mp/settings/test",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({}),
    response: envelope(
      z.object({
        ok: z.boolean(),
        accountName: z.string().default(""),
        templateCount: z.number().default(0),
        message: z.string().default(""),
      }),
    ),
  },
  WechatMpAdmin_templates: {
    method: "get" as const,
    path: "/enterprise/admin/wechat-mp/templates",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(wechatMpTemplateCatalogSchema)),
  },
  WechatMpAdmin_testSend: {
    method: "post" as const,
    path: "/enterprise/admin/wechat-mp/templates/test-send",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      eventKey: z.enum(WECHAT_MP_EVENT_KEYS).optional(),
      userId: z.string().max(64).optional(),
    }),
    response: envelope(
      z.object({
        sent: z.boolean(),
        status: z.string(),
        message: z.string(),
      }),
    ),
  },
  WechatMpAdmin_saveTemplates: {
    method: "put" as const,
    path: "/enterprise/admin/wechat-mp/templates",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      templates: z.array(wechatMpTemplateMapSchema).max(50),
    }),
    response: envelope(wechatMpSettingsViewSchema),
  },
  WechatMpAdmin_menu: {
    method: "get" as const,
    path: "/enterprise/admin/wechat-mp/menu",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(wechatMpMenuSchema),
  },
  WechatMpAdmin_saveMenu: {
    method: "put" as const,
    path: "/enterprise/admin/wechat-mp/menu",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ button: z.array(wechatMpMenuButtonSchema).max(3) }),
    response: envelope(wechatMpMenuSchema),
  },
  WechatMpAdmin_publishMenu: {
    method: "post" as const,
    path: "/enterprise/admin/wechat-mp/menu/publish",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ published: z.boolean(), message: z.string().default("") }),
    ),
  },
  WechatMpAdmin_pullMenu: {
    method: "post" as const,
    path: "/enterprise/admin/wechat-mp/menu/pull",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(wechatMpMenuSchema),
  },
  WechatMpAdmin_bindings: {
    method: "get" as const,
    path: "/enterprise/admin/wechat-mp/bindings",
    params: z.object({}),
    query: pageQuerySchema.extend({
      keyword: z.string().default(""),
      subscribed: z.enum(["all", "yes", "no"]).default("all"),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(wechatMpBindingRowSchema)),
  },
  WechatMpAdmin_unbindBinding: {
    method: "post" as const,
    path: "/enterprise/admin/wechat-mp/bindings/:userId/unbind",
    params: z.object({ userId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  WechatMpAdmin_messages: {
    method: "get" as const,
    path: "/enterprise/admin/wechat-mp/messages",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().default("all"),
      eventKey: z.string().default(""),
      keyword: z.string().default(""),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(wechatMpMessageRowSchema)),
  },
  WechatMpAdmin_retry: {
    method: "post" as const,
    path: "/enterprise/admin/wechat-mp/messages/:id/retry",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(wechatMpMessageRowSchema),
  },
  WechatMpAdmin_stats: {
    method: "get" as const,
    path: "/enterprise/admin/wechat-mp/stats",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(wechatMpAdminStatsSchema),
  },
} as const;
