import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const passthroughBody = z.object({}).passthrough();

/**
 * AI邮箱服务：多邮箱收信（POP3 / IMAP）、SMTP 发信、场景话术与处理台账。
 * 邮件正文、主题与附件一律不落库，列表与详情都是实时读取服务器；
 * 落库的只有账号凭据密文、话术，以及只含去重键与结果的「最小台账」。
 */

export const MAIL_PROTOCOLS = ["imap", "pop3"] as const;
export type MailProtocol = (typeof MAIL_PROTOCOLS)[number];
export const MAIL_PROTOCOL_LABELS: Record<string, string> = {
  imap: "IMAP",
  pop3: "POP3",
};

export const MAIL_SECURITY_MODES = ["ssl", "starttls", "none"] as const;
export const MAIL_SECURITY_LABELS: Record<string, string> = {
  ssl: "SSL/TLS",
  starttls: "STARTTLS",
  none: "不加密",
};

/** 回复方式：只写草稿 / 写好草稿并自动发出。 */
export const MAIL_REPLY_MODES = ["draft_only", "auto_send"] as const;
export type MailReplyMode = (typeof MAIL_REPLY_MODES)[number];
export const MAIL_REPLY_MODE_LABELS: Record<string, string> = {
  draft_only: "只写草稿",
  auto_send: "写草稿并自动回复",
};

/** 单封邮件的处理状态（来自台账；没有台账行＝未处理）。 */
export const MAIL_MESSAGE_STATUS_LABELS: Record<string, string> = {
  pending: "未处理",
  draft: "已生成草稿",
  sent: "已发送",
  skipped: "已跳过",
};

export const mailAttachmentSchema = z.object({
  name: z.string(),
  size: z.number(),
  contentType: z.string(),
});
export type MailAttachment = z.infer<typeof mailAttachmentSchema>;

/** 收件列表一行：只读，实时来自服务器，不落库。 */
export const mailMessageSummarySchema = z.object({
  /** 去重键：Message-ID 优先，缺失时用服务器 UID/UIDL 派生 */
  key: z.string(),
  subject: z.string(),
  fromName: z.string(),
  fromAddress: z.string(),
  receivedAt: z.string(),
  snippet: z.string(),
  unread: z.boolean(),
  hasAttachments: z.boolean(),
  /** pending | draft | sent | skipped */
  status: z.string(),
  statusLabel: z.string(),
});
export type MailMessageSummary = z.infer<typeof mailMessageSummarySchema>;

/** 邮件详情：正文只在这次响应里出现，不写库。 */
export const mailMessageSchema = mailMessageSummarySchema.extend({
  to: z.array(z.string()),
  cc: z.array(z.string()),
  text: z.string(),
  attachments: z.array(mailAttachmentSchema),
});
export type MailMessage = z.infer<typeof mailMessageSchema>;

export const mailScriptSchema = z.object({
  id: z.number(),
  mailboxId: z.number(),
  /** 生效邮箱（可多选；空数组＝全部邮箱） */
  mailboxIds: z.array(z.number()),
  name: z.string(),
  keywords: z.string(),
  senderPattern: z.string(),
  priority: z.number(),
  content: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MailScript = z.infer<typeof mailScriptSchema>;

/** 邮箱账号：密码只回「是否已填」，界面永不回显。 */
export const mailAccountSchema = z.object({
  id: z.number(),
  address: z.string(),
  displayName: z.string(),
  protocol: z.enum(MAIL_PROTOCOLS),
  protocolLabel: z.string(),
  incomingHost: z.string(),
  incomingPort: z.number(),
  incomingSecurity: z.string(),
  incomingSecurityLabel: z.string(),
  incomingUsername: z.string(),
  inboxFolder: z.string(),
  draftsFolder: z.string(),
  sentFolder: z.string(),
  outgoingHost: z.string(),
  outgoingPort: z.number(),
  outgoingSecurity: z.string(),
  outgoingUsername: z.string(),
  /** 收信密码 / 发信密码是否已保存（值只进不出） */
  hasIncomingSecret: z.boolean(),
  hasOutgoingSecret: z.boolean(),
  signature: z.string(),
  replyMode: z.enum(MAIL_REPLY_MODES),
  replyModeLabel: z.string(),
  maxPerRun: z.number(),
  enabled: z.boolean(),
  libraryIds: z.array(z.number()),
  /** 今日：已发送 / 已出草稿（来自处理台账） */
  todaySent: z.number(),
  todayDraft: z.number(),
  /** 本月累计处理封数（草稿 + 已发送） */
  monthHandled: z.number(),
  lastRunAt: z.string().nullable(),
  lastError: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MailAccount = z.infer<typeof mailAccountSchema>;

/** 连接测试结果：收信与发信分开报，失败原因用中文，不带上游原文。 */
export const mailAccountTestSchema = z.object({
  incoming: z.boolean(),
  incomingMessage: z.string(),
  outgoing: z.boolean(),
  outgoingMessage: z.string(),
});
export type MailAccountTest = z.infer<typeof mailAccountTestSchema>;

/** 台账一行：只有去重键、发件人与结果，不含主题与正文。 */
export const mailHandleLogSchema = z.object({
  id: z.number(),
  mailboxId: z.number(),
  address: z.string(),
  fromAddress: z.string(),
  result: z.string(),
  resultLabel: z.string(),
  reason: z.string(),
  handledAt: z.string(),
});
export type MailHandleLog = z.infer<typeof mailHandleLogSchema>;

/** 生成草稿 / 发出回复的结果：两种协议口径一致，草稿位置不同。 */
export const mailDraftResultSchema = z.object({
  ok: z.boolean(),
  executed: z.boolean(),
  /** draft | sent */
  result: z.enum(["draft", "sent"]),
  /** 草稿保存位置（IMAP 服务器文件夹名；POP3 无草稿箱时为空串） */
  savedTo: z.string(),
  message: z.string(),
  /** 命中场景话术名；空串＝没有命中 */
  matchedScript: z.string(),
  /** 本次草稿正文（POP3 无草稿箱时供用户复制） */
  body: z.string(),
});
export type MailDraftResult = z.infer<typeof mailDraftResultSchema>;

export const mailEndpoints = {
  Mail_accounts: {
    method: "get" as const,
    path: "/enterprise/mail/accounts",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(mailAccountSchema)),
  },
  Mail_saveAccount: {
    method: "post" as const,
    path: "/enterprise/mail/accounts",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(mailAccountSchema),
  },
  Mail_updateAccount: {
    method: "put" as const,
    path: "/enterprise/mail/accounts/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(mailAccountSchema),
  },
  Mail_removeAccount: {
    method: "delete" as const,
    path: "/enterprise/mail/accounts/:id",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Mail_testAccount: {
    method: "post" as const,
    path: "/enterprise/mail/accounts/:id/test",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(mailAccountTestSchema),
  },
  Mail_messages: {
    method: "get" as const,
    path: "/enterprise/mail/accounts/:id/messages",
    params: z.object({ id: z.string().min(1) }),
    query: z.object({
      folder: z.string().trim().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).max(1000).optional(),
      unreadOnly: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(mailMessageSummarySchema)),
  },
  Mail_message: {
    method: "get" as const,
    path: "/enterprise/mail/accounts/:id/messages/:key",
    params: z.object({ id: z.string().min(1), key: z.string().min(1) }),
    query: z.object({ folder: z.string().trim().max(80).optional() }),
    body: z.undefined(),
    response: envelope(mailMessageSchema),
  },
  Mail_drafts: {
    method: "get" as const,
    path: "/enterprise/mail/accounts/:id/drafts",
    params: z.object({ id: z.string().min(1) }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(mailMessageSummarySchema)),
  },
  Mail_saveDraft: {
    method: "post" as const,
    path: "/enterprise/mail/accounts/:id/drafts",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(mailDraftResultSchema),
  },
  Mail_sendReply: {
    method: "post" as const,
    path: "/enterprise/mail/accounts/:id/replies",
    params: z.object({ id: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(mailDraftResultSchema),
  },
  Mail_scripts: {
    method: "get" as const,
    path: "/enterprise/mail/scripts",
    params: z.object({}),
    query: z.object({
      mailboxId: z.coerce.number().int().positive().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(mailScriptSchema)),
  },
  Mail_saveScript: {
    method: "post" as const,
    path: "/enterprise/mail/scripts",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(mailScriptSchema),
  },
  Mail_updateScript: {
    method: "put" as const,
    path: "/enterprise/mail/scripts/:scriptId",
    params: z.object({ scriptId: z.string().min(1) }),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(mailScriptSchema),
  },
  Mail_removeScript: {
    method: "delete" as const,
    path: "/enterprise/mail/scripts/:scriptId",
    params: z.object({ scriptId: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Mail_ledger: {
    method: "get" as const,
    path: "/enterprise/mail/ledger",
    params: z.object({}),
    query: z.object({
      mailboxId: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(mailHandleLogSchema)),
  },
};

/** MCP 邮件工具的参数：与本地 REST 接口同一份业务字段，不走通用 read_data/write_data。 */
export const MAIL_MCP_TOOL_NAMES = [
  "mail_list_mailboxes",
  "mail_list_messages",
  "mail_read_message",
  "mail_create_draft",
  "mail_send_reply",
] as const;
export type MailMcpToolName = (typeof MAIL_MCP_TOOL_NAMES)[number];

export const mailMcpToolArgs = {
  mail_list_mailboxes: z.object({}).strict(),
  mail_list_messages: z
    .object({
      mailboxId: z.number().int().positive(),
      unreadOnly: z.boolean().default(true),
      sinceHours: z.number().int().min(1).max(168).default(24),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  mail_read_message: z
    .object({
      mailboxId: z.number().int().positive(),
      key: z.string().trim().min(1).max(255),
    })
    .strict(),
  mail_create_draft: z
    .object({
      mailboxId: z.number().int().positive(),
      key: z.string().trim().min(1).max(255),
      subject: z.string().trim().max(200).optional(),
      body: z.string().trim().min(1).max(8000),
    })
    .strict(),
  mail_send_reply: z
    .object({
      mailboxId: z.number().int().positive(),
      key: z.string().trim().min(1).max(255),
      subject: z.string().trim().max(200).optional(),
      body: z.string().trim().min(1).max(8000),
    })
    .strict(),
};
