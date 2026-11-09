import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const jsonAny = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

/**
 * AI客服（账号级 SaaS）：一个账号多站点、真人接待、AI 四种模式。
 * 访客只来自挂了接入代码的官网；同域 iframe，不新增域名与环境变量。
 */
export const SERVICE_DESK_AI_MODES = [
  "OFF",
  "CANNED",
  "SUGGEST",
  "AUTO",
  "BOT",
] as const;
export type ServiceDeskAiMode = (typeof SERVICE_DESK_AI_MODES)[number];
export const SERVICE_DESK_AI_MODE_LABELS: Record<string, string> = {
  OFF: "关闭（纯人工）",
  CANNED: "固定文案",
  SUGGEST: "手动建议",
  AUTO: "自动回复",
  BOT: "纯AI接待（不转人工）",
};

export const SERVICE_DESK_AGENT_STATUS_LABELS: Record<string, string> = {
  ONLINE: "在线",
  AWAY: "离开",
  OFFLINE: "离线",
  DISABLED: "已停用",
};

export const SERVICE_DESK_CONVERSATION_STATUS_LABELS: Record<string, string> = {
  waiting: "待接入",
  active: "进行中",
  closed: "已结束",
};

export const SERVICE_DESK_ROLE_LABELS: Record<string, string> = {
  owner: "负责人",
  lead: "主管",
  agent: "客服",
};

/**
 * 渠道接入：企业自己在官方开放平台申请应用/客服账号，把凭据填进来。
 * 只收「官方 API + 双向」的通道；群机器人只能推送，第三方协议（OneBot 等）不是官方接口，都不接。
 * custom 是例外出口：客户自己的平台按我方约定的 JSON 收发，入站映射/出站地址都由客户配置。
 */
export const SERVICE_DESK_CHANNEL_KINDS = [
  "wecom_kf",
  "wecom_app",
  "wechat_mp",
  "feishu_app",
  "dingtalk_robot",
  "custom",
] as const;
export type ServiceDeskChannelKind =
  (typeof SERVICE_DESK_CHANNEL_KINDS)[number];

export type ServiceDeskChannelField = {
  key: string;
  label: string;
  required?: boolean;
  /** 保存后不再回显明文，编辑时留空表示沿用 */
  secret?: boolean;
  placeholder?: string;
  hint?: string;
  /** JSON / 模板类字段用多行编辑 */
  multiline?: boolean;
};

export type ServiceDeskChannelKindSpec = {
  kind: ServiceDeskChannelKind;
  label: string;
  description: string;
  /** 客户在官方后台要做的准备 */
  setup: string;
  /** 回调地址放到官方后台的哪个位置 */
  callbackHint: string;
  fields: ServiceDeskChannelField[];
  /** 新建时的预填示例（仅 custom 用） */
  samples?: Record<string, string>;
};

export const SERVICE_DESK_CHANNEL_SPECS: ServiceDeskChannelKindSpec[] = [
  {
    kind: "wecom_kf",
    label: "微信客服",
    description:
      "微信用户加企业微信「微信客服」后直接对话；受平台 48 小时会话窗口限制（用户最后一次发言后 48 小时内可回复）。",
    setup:
      "企业微信管理后台 → 应用管理 → 微信客服 → 开发配置 → 接收消息，记录 Token / EncodingAESKey 与客服账号 open_kfid；企业需完成认证并在可信 IP 白名单里放行服务端出口 IP。",
    callbackHint: "把回调地址填到「微信客服 → 开发配置 → 接收消息」的 URL。",
    fields: [
      {
        key: "corpId",
        label: "企业 CorpID",
        required: true,
        placeholder: "ww...",
      },
      { key: "secret", label: "微信客服 Secret", secret: true, required: true },
      {
        key: "openKfId",
        label: "客服账号 open_kfid",
        required: true,
        placeholder: "wk...",
      },
      { key: "token", label: "接收消息 Token", secret: true, required: true },
      {
        key: "encodingAesKey",
        label: "EncodingAESKey",
        secret: true,
        required: true,
        placeholder: "43 位",
      },
    ],
  },
  {
    kind: "wecom_app",
    label: "企业微信自建应用",
    description: "企业微信内部成员在应用里发消息，客服工作台直接收到并回复。",
    setup:
      "企业微信管理后台 → 应用管理 → 自建应用 → 接收消息 → 设置 API 接收，记录 CorpID、AgentId、应用 Secret、Token、EncodingAESKey。",
    callbackHint: "把回调地址填到自建应用「接收消息」的 URL。",
    fields: [
      {
        key: "corpId",
        label: "企业 CorpID",
        required: true,
        placeholder: "ww...",
      },
      {
        key: "agentId",
        label: "应用 AgentId",
        required: true,
        placeholder: "1000002",
      },
      { key: "secret", label: "应用 Secret", secret: true, required: true },
      { key: "token", label: "接收消息 Token", secret: true, required: true },
      {
        key: "encodingAesKey",
        label: "EncodingAESKey",
        secret: true,
        required: true,
        placeholder: "43 位",
      },
    ],
  },
  {
    kind: "wechat_mp",
    label: "微信公众号服务号",
    description:
      "关注者给服务号发消息进入客服工作台；客服消息同样受平台 48 小时会话窗口限制。",
    setup:
      "公众号后台 → 设置与开发 → 基本配置 → 服务器配置，记录 AppID、AppSecret、Token、EncodingAESKey，并开通客服消息接口权限。",
    callbackHint:
      "把回调地址填到「服务器配置」的 URL，Token / EncodingAESKey 与这里填的一致。",
    fields: [
      { key: "appId", label: "AppID", required: true, placeholder: "wx..." },
      { key: "appSecret", label: "AppSecret", secret: true, required: true },
      { key: "token", label: "服务器配置 Token", secret: true, required: true },
      {
        key: "encodingAesKey",
        label: "EncodingAESKey",
        secret: true,
        required: true,
      },
    ],
  },
  {
    kind: "feishu_app",
    label: "飞书自建应用",
    description:
      "飞书里给应用机器人发消息，客服工作台直接收到并回复到同一会话。",
    setup:
      "飞书开放平台 → 自建应用 → 事件订阅（请求地址填回调地址，订阅 im.message.receive_v1），开通 im:message:send_as_bot 权限并发布版本。",
    callbackHint:
      "把回调地址填到「事件订阅 → 请求地址」，Encrypt Key 与 Verification Token 按同一页填写。",
    fields: [
      { key: "appId", label: "App ID", required: true, placeholder: "cli_..." },
      { key: "appSecret", label: "App Secret", secret: true, required: true },
      {
        key: "verificationToken",
        label: "Verification Token",
        secret: true,
        required: true,
      },
      {
        key: "encryptKey",
        label: "Encrypt Key",
        secret: true,
        hint: "未开启加密可留空",
      },
    ],
  },
  {
    kind: "dingtalk_robot",
    label: "钉钉机器人",
    description: "钉钉单聊或群里 @ 企业内部机器人，客服工作台直接收到并回复。",
    setup:
      "钉钉开发者后台 → 应用 → 机器人 → 消息接收模式选「HTTP 推送」，填回调地址；记录 AppKey、AppSecret、RobotCode。",
    callbackHint: "把回调地址填到机器人「消息接收地址」。",
    fields: [
      {
        key: "appKey",
        label: "AppKey",
        required: true,
        placeholder: "ding...",
      },
      { key: "appSecret", label: "AppSecret", secret: true, required: true },
      {
        key: "robotCode",
        label: "RobotCode",
        required: true,
        placeholder: "ding...",
      },
    ],
  },
  {
    kind: "custom",
    label: "自定义渠道",
    description:
      "自己的平台/内部系统对接：回调进来时按你配的 JSON 路径取字段，回复时按你配的地址和模板发出去，变量用 {{chatId}}、{{text}} 这类占位符。",
    setup:
      "把下面的回调地址配到你方平台的消息推送里；入站映射填 JSON 路径（如 data.chat.id）。出站只支持 https 公网地址，禁止内网/回环/元数据地址，且不跟随重定向。",
    callbackHint:
      "把回调地址填到你方平台的推送地址；回调请求体需能被入站映射解析。",
    fields: [
      {
        key: "inboundMapping",
        label: "入站映射（JSON）",
        required: true,
        multiline: true,
        hint: "值为点路径；chatId / text 必填，extra 里登记要带回去的会话级额外字段",
      },
      {
        key: "outboundUrl",
        label: "出站地址",
        required: true,
        placeholder: "https://your-platform.example.com/api/reply",
      },
      { key: "outboundMethod", label: "出站方法", placeholder: "POST" },
      {
        key: "outboundHeaders",
        label: "出站请求头（JSON）",
        multiline: true,
        hint: '值可用占位符，如 {"Content-Type":"application/json"}',
      },
      {
        key: "outboundBody",
        label: "出站请求体（JSON）",
        multiline: true,
        hint: "值可用 {{chatId}} / {{userId}} / {{userName}} / {{text}} / {{messageId}} / {{extra.xxx}}",
      },
      {
        key: "securityMode",
        label: "校验方式",
        placeholder: "none | header | hmac",
        hint: "none 不校验；header 原样比对请求头；hmac 用 SHA256 对请求体签名（入站校验、出站附带）",
      },
      {
        key: "securityHeader",
        label: "校验请求头名",
        placeholder: "X-Signature",
      },
      { key: "securitySecret", label: "校验密钥", secret: true },
      { key: "ackStatus", label: "回执状态码", placeholder: "200" },
      { key: "ackBody", label: "回执内容", placeholder: "ok" },
    ],
    samples: {
      inboundMapping: JSON.stringify(
        {
          chatId: "data.chat.id",
          userId: "data.sender.id",
          userName: "data.sender.name",
          text: "data.message.text",
          messageId: "data.message.id",
          extra: {
            tenant: "data.chat.tenantId",
            thread: "data.message.threadId",
          },
        },
        null,
        2,
      ),
      outboundMethod: "POST",
      outboundHeaders: JSON.stringify(
        { "Content-Type": "application/json" },
        null,
        2,
      ),
      outboundBody: JSON.stringify(
        {
          chat_id: "{{chatId}}",
          reply: {
            to: "{{userId}}",
            text: "{{text}}",
            quote: "{{messageId}}",
            tenant: "{{extra.tenant}}",
          },
        },
        null,
        2,
      ),
      securityMode: "none",
      ackStatus: "200",
      ackBody: "ok",
    },
  },
];

export const serviceDeskSiteSchema = z.object({
  id: z.number(),
  siteKey: z.string(),
  name: z.string(),
  allowedOrigins: z.array(z.string()),
  appearance: z.record(z.string(), jsonAny),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type ServiceDeskSite = z.infer<typeof serviceDeskSiteSchema>;

export const serviceDeskChannelSchema = z.object({
  id: z.number(),
  kind: z.string(),
  kindLabel: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  /** 相对路径，前端拼当前站点 origin 后给客户填到平台后台 */
  callbackPath: z.string(),
  /** 非密文字段原样回显 */
  config: z.record(z.string(), z.string()),
  /** 已填写的字段 key（含密文字段，只报有无） */
  configured: z.array(z.string()),
  /** 密文字段 key，前端据此留空表示沿用 */
  secretKeys: z.array(z.string()),
  lastEventAt: z.string(),
  lastError: z.string(),
  createdAt: z.string(),
});
export type ServiceDeskChannel = z.infer<typeof serviceDeskChannelSchema>;

export const serviceDeskSettingsSchema = z.object({
  businessHours: z.record(z.string(), jsonAny),
  welcomeText: z.string(),
  queueText: z.string(),
  offlineText: z.string(),
  autoAssign: z.boolean(),
  maxConcurrent: z.number(),
  ratingEnabled: z.boolean(),
  aiMode: z.string(),
  aiModeLabel: z.string(),
  aiChannelId: z.number(),
  aiModel: z.string(),
  aiHandoffKeywords: z.array(z.string()),
  libraryIds: z.array(z.number()),
  requireContact: z.boolean(),
  retentionDays: z.number(),
});

export const serviceDeskGroupSchema = z.object({
  id: z.number(),
  name: z.string(),
  categories: z.array(z.string()),
  enabled: z.boolean(),
});

export const serviceDeskAgentSchema = z.object({
  id: z.number(),
  memberUserId: z.string(),
  memberName: z.string(),
  role: z.string(),
  roleLabel: z.string(),
  groupId: z.number(),
  status: z.string(),
  statusLabel: z.string(),
  maxConcurrent: z.number(),
  activeCount: z.number(),
  online: z.boolean(),
});

export type ServiceDeskAgent = z.infer<typeof serviceDeskAgentSchema>;

export const serviceDeskConversationSchema = z.object({
  id: z.number(),
  siteId: z.number(),
  siteName: z.string(),
  groupId: z.number(),
  assigneeUserId: z.string(),
  assigneeName: z.string(),
  visitorName: z.string(),
  visitorContact: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  /** 转为 CRM 线索后的回写 id（0＝未转化） */
  crmLeadId: z.number(),
  subject: z.string(),
  sourceUrl: z.string(),
  unread: z.number(),
  lastMessageAt: z.string(),
  lastMessage: z.string(),
  rating: z.number(),
  aiMode: z.string(),
  createdAt: z.string(),
});
export type ServiceDeskConversationRow = z.infer<
  typeof serviceDeskConversationSchema
>;

export const serviceDeskMessageSchema = z.object({
  id: z.number(),
  conversationId: z.number(),
  senderType: z.string(),
  senderName: z.string(),
  contentType: z.string(),
  content: z.string(),
  attachmentUrl: z.string(),
  attachmentName: z.string(),
  attachmentSize: z.number(),
  createdAt: z.string(),
});
export type ServiceDeskMessage = z.infer<typeof serviceDeskMessageSchema>;

export const serviceDeskStatsSchema = z.object({
  days: z.number(),
  conversations: z.number(),
  closed: z.number(),
  waiting: z.number(),
  avgFirstResponseSeconds: z.number(),
  avgDurationSeconds: z.number(),
  avgRating: z.number(),
  aiReplies: z.number(),
  aiAutoResolved: z.number(),
  perDay: z.array(
    z.object({
      date: z.string(),
      conversations: z.number(),
      aiReplies: z.number(),
    }),
  ),
  perAgent: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      handled: z.number(),
      rating: z.number(),
    }),
  ),
});

export type ServiceDeskSettings = z.infer<typeof serviceDeskSettingsSchema>;
export type ServiceDeskGroup = z.infer<typeof serviceDeskGroupSchema>;

export type ServiceDeskStats = z.infer<typeof serviceDeskStatsSchema>;

const siteAppearance = z
  .object({
    title: z.string().max(60).optional(),
    color: z.string().max(20).optional(),
    avatar: z.string().max(500).optional(),
    welcome: z.string().max(500).optional(),
    locale: z.string().max(16).optional(),
  })
  .partial();

export const serviceDeskEndpoints = {
  ServiceDesk_overview: {
    method: "get" as const,
    path: "/enterprise/service-desk/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        waiting: z.number(),
        active: z.number(),
        todayConvos: z.number(),
        myStatus: z.string(),
        myActive: z.number(),
        isAgent: z.boolean(),
        isManager: z.boolean(),
        siteCount: z.number(),
      }),
    ),
  },
  ServiceDesk_settings: {
    method: "get" as const,
    path: "/enterprise/service-desk/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(serviceDeskSettingsSchema),
  },
  ServiceDesk_saveSettings: {
    method: "post" as const,
    path: "/enterprise/service-desk/settings",
    params: z.object({}),
    query: emptyQuery,
    body: serviceDeskSettingsSchema.omit({ aiModeLabel: true }).partial(),
    response: envelope(serviceDeskSettingsSchema),
  },
  ServiceDesk_sites: {
    method: "get" as const,
    path: "/enterprise/service-desk/sites",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(serviceDeskSiteSchema)),
  },
  ServiceDesk_saveSite: {
    method: "post" as const,
    path: "/enterprise/service-desk/sites",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().optional(),
      name: z.string().min(1).max(80),
      allowedOrigins: z.array(z.string()).default([]),
      appearance: siteAppearance.optional(),
      enabled: z.boolean().optional(),
    }),
    response: envelope(serviceDeskSiteSchema),
  },
  ServiceDesk_removeSite: {
    method: "delete" as const,
    path: "/enterprise/service-desk/sites/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  ServiceDesk_rotateSiteKey: {
    method: "post" as const,
    path: "/enterprise/service-desk/sites/:id/rotate",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(serviceDeskSiteSchema),
  },
  ServiceDesk_uploadIcon: {
    method: "post" as const,
    path: "/enterprise/service-desk/sites/icon",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(120),
      contentType: z.string().max(120).optional(),
      contentBase64: z.string().min(1),
    }),
    response: envelope(
      z.object({ url: z.string(), name: z.string(), size: z.number() }),
    ),
  },
  ServiceDesk_channels: {
    method: "get" as const,
    path: "/enterprise/service-desk/channels",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(serviceDeskChannelSchema)),
  },
  ServiceDesk_saveChannel: {
    method: "post" as const,
    path: "/enterprise/service-desk/channels",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().optional(),
      kind: z.enum(SERVICE_DESK_CHANNEL_KINDS),
      name: z.string().min(1).max(80),
      /** 密文字段留空表示沿用已存的值 */
      config: z.record(z.string(), z.string()).default({}),
      enabled: z.boolean().optional(),
    }),
    response: envelope(serviceDeskChannelSchema),
  },
  ServiceDesk_removeChannel: {
    method: "delete" as const,
    path: "/enterprise/service-desk/channels/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  ServiceDesk_testChannel: {
    method: "post" as const,
    path: "/enterprise/service-desk/channels/:id/test",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ ok: z.boolean(), message: z.string() })),
  },
  ServiceDesk_groups: {
    method: "get" as const,
    path: "/enterprise/service-desk/groups",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(serviceDeskGroupSchema)),
  },
  ServiceDesk_saveGroup: {
    method: "post" as const,
    path: "/enterprise/service-desk/groups",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().optional(),
      name: z.string().min(1).max(60),
      categories: z.array(z.string()).default([]),
      enabled: z.boolean().optional(),
    }),
    response: envelope(serviceDeskGroupSchema),
  },
  ServiceDesk_removeGroup: {
    method: "delete" as const,
    path: "/enterprise/service-desk/groups/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  ServiceDesk_agents: {
    method: "get" as const,
    path: "/enterprise/service-desk/agents",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(serviceDeskAgentSchema)),
  },
  ServiceDesk_saveAgent: {
    method: "post" as const,
    path: "/enterprise/service-desk/agents",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      memberUserId: z.string().min(1),
      role: z.enum(["owner", "lead", "agent"]).default("agent"),
      groupId: z.number().default(0),
      status: z.enum(["ONLINE", "AWAY", "OFFLINE", "DISABLED"]).optional(),
      maxConcurrent: z.number().int().min(1).max(50).optional(),
    }),
    response: envelope(serviceDeskAgentSchema),
  },
  ServiceDesk_removeAgent: {
    method: "delete" as const,
    path: "/enterprise/service-desk/agents/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  ServiceDesk_setStatus: {
    method: "post" as const,
    path: "/enterprise/service-desk/status",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ status: z.enum(["ONLINE", "AWAY", "OFFLINE"]) }),
    response: envelope(z.object({ status: z.string() })),
  },
  ServiceDesk_conversations: {
    method: "get" as const,
    path: "/enterprise/service-desk/conversations",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.enum(["waiting", "active", "closed"]).optional(),
      mine: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(serviceDeskConversationSchema)),
  },
  ServiceDesk_conversation: {
    method: "get" as const,
    path: "/enterprise/service-desk/conversations/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        conversation: serviceDeskConversationSchema,
        messages: z.array(serviceDeskMessageSchema),
        visitor: z.object({
          nickname: z.string(),
          contact: z.string(),
          firstSeenAt: z.string(),
          lastSeenAt: z.string(),
        }),
      }),
    ),
  },
  ServiceDesk_send: {
    method: "post" as const,
    path: "/enterprise/service-desk/conversations/:id/messages",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      content: z.string().max(4000).default(""),
      contentType: z.enum(["text", "image", "file"]).default("text"),
      attachmentUrl: z.string().max(500).optional(),
      attachmentName: z.string().max(200).optional(),
      attachmentSize: z.number().optional(),
      clientMsgId: z.string().max(64).optional(),
    }),
    response: envelope(serviceDeskMessageSchema),
  },
  ServiceDesk_claim: {
    method: "post" as const,
    path: "/enterprise/service-desk/conversations/:id/claim",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(serviceDeskConversationSchema),
  },
  ServiceDesk_transfer: {
    method: "post" as const,
    path: "/enterprise/service-desk/conversations/:id/transfer",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      toUserId: z.string().min(1),
      note: z.string().max(200).optional(),
    }),
    response: envelope(serviceDeskConversationSchema),
  },
  ServiceDesk_close: {
    method: "post" as const,
    path: "/enterprise/service-desk/conversations/:id/close",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ inviteRating: z.boolean().default(true) }),
    response: envelope(serviceDeskConversationSchema),
  },
  ServiceDesk_convertToCrm: {
    method: "post" as const,
    path: "/enterprise/service-desk/conversations/:id/convert-to-crm",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      name: z.string().max(120).optional(),
      phone: z.string().max(40).optional(),
      email: z.string().max(120).optional(),
    }),
    response: envelope(
      z.object({ conversationId: z.number(), crmLeadId: z.number() }),
    ),
  },
  ServiceDesk_aiSuggest: {
    method: "post" as const,
    path: "/enterprise/service-desk/conversations/:id/ai-suggest",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ instruction: z.string().max(500).default("") }),
    response: envelope(
      z.object({ suggestion: z.string(), summary: z.string() }),
    ),
  },
  ServiceDesk_canned: {
    method: "get" as const,
    path: "/enterprise/service-desk/canned",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.array(
        z.object({
          id: z.number(),
          scope: z.string(),
          userId: z.string(),
          title: z.string(),
          content: z.string(),
          category: z.string(),
          sort: z.number(),
        }),
      ),
    ),
  },
  ServiceDesk_saveCanned: {
    method: "post" as const,
    path: "/enterprise/service-desk/canned",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().optional(),
      scope: z.enum(["shared", "personal"]).default("shared"),
      title: z.string().min(1).max(80),
      content: z.string().min(1).max(2000),
      category: z.string().max(40).default(""),
      sort: z.number().default(0),
    }),
    response: envelope(z.object({ id: z.number() })),
  },
  ServiceDesk_removeCanned: {
    method: "delete" as const,
    path: "/enterprise/service-desk/canned/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  ServiceDesk_faqs: {
    method: "get" as const,
    path: "/enterprise/service-desk/faqs",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.array(
        z.object({
          id: z.number(),
          question: z.string(),
          keywords: z.string(),
          answer: z.string(),
          enabled: z.boolean(),
        }),
      ),
    ),
  },
  ServiceDesk_saveFaq: {
    method: "post" as const,
    path: "/enterprise/service-desk/faqs",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().optional(),
      question: z.string().min(1).max(300),
      keywords: z.string().max(300).default(""),
      answer: z.string().min(1).max(4000),
      enabled: z.boolean().default(true),
    }),
    response: envelope(z.object({ id: z.number() })),
  },
  ServiceDesk_removeFaq: {
    method: "delete" as const,
    path: "/enterprise/service-desk/faqs/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  ServiceDesk_stats: {
    method: "get" as const,
    path: "/enterprise/service-desk/stats",
    params: z.object({}),
    query: z.object({
      days: z.coerce.number().int().min(1).max(90).default(7),
    }),
    body: z.undefined(),
    response: envelope(serviceDeskStatsSchema),
  },
};
