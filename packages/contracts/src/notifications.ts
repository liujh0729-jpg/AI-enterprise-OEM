import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** 全站系统消息：六类事件统一进铃铛（浏览器右上角设置左侧）。 */
export const NOTIFICATION_CATEGORIES = [
  "service_desk",
  "demand",
  "identity",
  "tax",
  "automation",
  "account",
  "platform",
  "okr",
  "oa",
  "question",
  "sns",
  "collab",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  service_desk: "客服",
  demand: "需求与商机",
  identity: "身份与签约",
  tax: "财税与申报",
  automation: "自动化与集成",
  account: "账号与安全",
  platform: "平台公告",
  okr: "OKR与汇报",
  oa: "OA审批",
  question: "专题大厅",
  sns: "AIworkin 社交",
  collab: "协作",
};

export const NOTIFICATION_LEVELS = ["info", "warning", "error"] as const;

export const notificationSchema = z.object({
  id: z.number(),
  category: z.string(),
  categoryLabel: z.string(),
  level: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  read: z.boolean(),
  createdAt: z.string(),
  /** local＝本系统消息；sns＝AIworkin 社交（私信 / 好友等）通知 */
  source: z.string().default("local"),
  /** 外部来源的原始编号（SNS 通知 id）；local 为空串 */
  externalId: z.string().default(""),
});
export type NotificationRow = z.infer<typeof notificationSchema>;

export const notificationsEndpoints = {
  Notifications_list: {
    method: "get" as const,
    path: "/enterprise/notifications",
    params: z.object({}),
    query: pageQuerySchema.extend({
      category: z.string().optional(),
      unreadOnly: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(notificationSchema)),
  },
  Notifications_unread: {
    method: "get" as const,
    path: "/enterprise/notifications/unread",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        count: z.number(),
        items: z.array(notificationSchema),
        sns: z
          .object({ available: z.boolean(), unread: z.number() })
          .default({ available: false, unread: 0 }),
      }),
    ),
  },
  Notifications_get: {
    method: "get" as const,
    path: "/enterprise/notifications/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(notificationSchema),
  },
  Notifications_read: {
    method: "post" as const,
    path: "/enterprise/notifications/:id/read",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(notificationSchema),
  },
  Notifications_readSns: {
    method: "post" as const,
    path: "/enterprise/notifications/sns/:id/read",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.string(), read: z.boolean() })),
  },
  Notifications_readAll: {
    method: "post" as const,
    path: "/enterprise/notifications/read-all",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ category: z.string().optional() }).partial(),
    response: envelope(z.object({ updated: z.number() })),
  },
  Sns_sendMessage: {
    method: "post" as const,
    path: "/enterprise/sns/messages",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      toUserId: z.string().min(1).max(64),
      subject: z.string().max(200).default(""),
      body: z.string().min(1).max(3000),
    }),
    response: envelope(
      z.object({
        messageId: z.number(),
        toUserId: z.string(),
        subject: z.string(),
      }),
    ),
  },
};
