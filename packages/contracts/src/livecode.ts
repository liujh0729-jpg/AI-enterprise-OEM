import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 活码引流（营销工具第 12 卡）：
 * 固定入口 + 动态子码；短链域名必须是客户自有域名（客户 CDN 回源 / 客户官网脚本两条链路）。
 * 平台不代持域名、不签发证书、不做平台封禁探测。
 */

export const QR_MAX_DOMAINS = 100;
export const QR_MAX_CODES_PER_USER = 500;
export const QR_MAX_CHILDREN_PER_CODE = 100;

export const QR_DOMAIN_STATUS_LABELS: Record<string, string> = {
  PENDING: "待配置",
  VERIFYING: "检测中",
  ACTIVE: "已生效",
  ERROR: "异常",
  DISABLED: "已停用",
};

export const QR_DOMAIN_MODES = ["CDN", "SCRIPT"] as const;
export const QR_DOMAIN_MODE_LABELS: Record<string, string> = {
  CDN: "官网独立页（CDN 回源）",
  SCRIPT: "官网弹层（接入脚本）",
};

export const QR_SELECT_MODES = ["RANDOM", "ORDER", "WEIGHT"] as const;
export const QR_SELECT_MODE_LABELS: Record<string, string> = {
  RANDOM: "随机",
  ORDER: "顺序轮转",
  WEIGHT: "按权重",
};

export const QR_LIMIT_SCOPES = ["NONE", "DAILY", "TOTAL"] as const;
export const QR_LIMIT_SCOPE_LABELS: Record<string, string> = {
  NONE: "不限制",
  DAILY: "每天上限",
  TOTAL: "累计上限",
};

export const QR_CHILD_KINDS = ["IMAGE", "LINK", "TEXT"] as const;
export const QR_CHILD_KIND_LABELS: Record<string, string> = {
  IMAGE: "图片",
  LINK: "链接",
  TEXT: "文本",
};

export const QR_CHILD_LIMIT_SCOPES = [
  "INHERIT",
  "NONE",
  "DAILY",
  "TOTAL",
] as const;
export const QR_CHILD_LIMIT_SCOPE_LABELS: Record<string, string> = {
  INHERIT: "跟随活码",
  NONE: "不限制",
  DAILY: "每天上限",
  TOTAL: "累计上限",
};

export const QR_CODE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "启用",
  PAUSED: "暂停",
  DISABLED: "已停用",
};

export const qrDomainSchema = z.object({
  id: z.number(),
  domain: z.string(),
  domainKey: z.string(),
  mode: z.string(),
  modeLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  weight: z.number(),
  /** 回源地址 / 脚本地址（前端按当前站点 origin 拼出完整 URL） */
  originPath: z.string(),
  lastCheckAt: z.string(),
  lastSeenAt: z.string(),
  lastError: z.string(),
  codeCount: z.number(),
});
export type QrDomainRow = z.infer<typeof qrDomainSchema>;

export const qrChildSchema = z.object({
  id: z.number(),
  codeId: z.number(),
  name: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  imageKey: z.string(),
  imageUrl: z.string(),
  linkUrl: z.string(),
  textContent: z.string(),
  channel: z.string(),
  weight: z.number(),
  sortOrder: z.number(),
  limitScope: z.string(),
  limitScopeLabel: z.string(),
  dailyLimit: z.number(),
  totalLimit: z.number(),
  todayCount: z.number(),
  totalCount: z.number(),
  status: z.string(),
});
export type QrChildRow = z.infer<typeof qrChildSchema>;

export const qrCodeSchema = z.object({
  id: z.number(),
  name: z.string(),
  code: z.string(),
  entryMode: z.string(),
  entryModeLabel: z.string(),
  domainMode: z.string(),
  domainId: z.number(),
  currentDomainId: z.number(),
  currentDomain: z.string(),
  autoFailover: z.boolean(),
  scriptUrl: z.string(),
  title: z.string(),
  note: z.string(),
  selectMode: z.string(),
  selectModeLabel: z.string(),
  sticky: z.boolean(),
  limitScope: z.string(),
  limitScopeLabel: z.string(),
  dailyLimit: z.number(),
  totalLimit: z.number(),
  fallbackChildId: z.number(),
  todayCount: z.number(),
  totalCount: z.number(),
  status: z.string(),
  statusLabel: z.string(),
  disabledReason: z.string(),
  entryChangedAt: z.string(),
  children: z.array(qrChildSchema),
  createdAt: z.string(),
});
export type QrCodeRow = z.infer<typeof qrCodeSchema>;

export const qrStatsSchema = z.object({
  days: z.number(),
  today: z.number(),
  todayVisitors: z.number(),
  total: z.number(),
  clicks: z.number(),
  perDay: z.array(
    z.object({ date: z.string(), scans: z.number(), visitors: z.number() }),
  ),
  perChild: z.array(
    z.object({ childId: z.number(), name: z.string(), scans: z.number() }),
  ),
  perChannel: z.array(z.object({ channel: z.string(), scans: z.number() })),
  perDomain: z.array(
    z.object({ domainId: z.number(), domain: z.string(), scans: z.number() }),
  ),
});

export const livecodeEndpoints = {
  MarketingQr_domains: {
    method: "get" as const,
    path: "/enterprise/marketing/livecode/domains",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(qrDomainSchema)),
  },
  MarketingQr_domainCreate: {
    method: "post" as const,
    path: "/enterprise/marketing/livecode/domains",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      domain: z.string().min(3).max(253),
      mode: z.enum(QR_DOMAIN_MODES).default("CDN"),
      ack: z.boolean().default(false),
    }),
    response: envelope(qrDomainSchema),
  },
  MarketingQr_domainCheck: {
    method: "post" as const,
    path: "/enterprise/marketing/livecode/domains/:id/check",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        status: z.string(),
        statusLabel: z.string(),
        error: z.string(),
        checks: z.array(
          z.object({ key: z.string(), label: z.string(), ok: z.boolean() }),
        ),
      }),
    ),
  },
  MarketingQr_domainUpdate: {
    method: "patch" as const,
    path: "/enterprise/marketing/livecode/domains/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      weight: z.number().int().min(0).max(100).optional(),
      status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    }),
    response: envelope(qrDomainSchema),
  },
  MarketingQr_domainRemove: {
    method: "delete" as const,
    path: "/enterprise/marketing/livecode/domains/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  MarketingQr_list: {
    method: "get" as const,
    path: "/enterprise/marketing/livecode/codes",
    params: z.object({}),
    query: pageQuerySchema.extend({
      keyword: z.string().optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(qrCodeSchema)),
  },
  MarketingQr_create: {
    method: "post" as const,
    path: "/enterprise/marketing/livecode/codes",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(60),
      entryMode: z.enum(QR_DOMAIN_MODES).default("CDN"),
      domainMode: z.enum(["PINNED", "ROTATE"]).default("ROTATE"),
      domainId: z.number().default(0),
      title: z.string().max(60).default(""),
      note: z.string().max(1000).default(""),
      selectMode: z.enum(QR_SELECT_MODES).default("RANDOM"),
      sticky: z.boolean().default(true),
      limitScope: z.enum(QR_LIMIT_SCOPES).default("NONE"),
      dailyLimit: z.number().int().min(0).max(1000000).default(0),
      totalLimit: z.number().int().min(0).max(100000000).default(0),
      scriptUrl: z.string().max(500).default(""),
    }),
    response: envelope(qrCodeSchema),
  },
  MarketingQr_get: {
    method: "get" as const,
    path: "/enterprise/marketing/livecode/codes/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(qrCodeSchema),
  },
  MarketingQr_update: {
    method: "patch" as const,
    path: "/enterprise/marketing/livecode/codes/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(60).optional(),
      title: z.string().max(60).optional(),
      note: z.string().max(1000).optional(),
      domainMode: z.enum(["PINNED", "ROTATE"]).optional(),
      domainId: z.number().optional(),
      autoFailover: z.boolean().optional(),
      selectMode: z.enum(QR_SELECT_MODES).optional(),
      sticky: z.boolean().optional(),
      limitScope: z.enum(QR_LIMIT_SCOPES).optional(),
      dailyLimit: z.number().int().min(0).max(1000000).optional(),
      totalLimit: z.number().int().min(0).max(100000000).optional(),
      fallbackChildId: z.number().optional(),
      scriptUrl: z.string().max(500).optional(),
      status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    }),
    response: envelope(qrCodeSchema),
  },
  MarketingQr_remove: {
    method: "delete" as const,
    path: "/enterprise/marketing/livecode/codes/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  MarketingQr_entry: {
    method: "post" as const,
    path: "/enterprise/marketing/livecode/codes/:id/entry",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ count: z.number().int().min(1).max(100).default(1) }),
    response: envelope(
      z.object({
        entries: z.array(
          z.object({
            domainId: z.number(),
            domain: z.string(),
            url: z.string(),
          }),
        ),
      }),
    ),
  },
  MarketingQr_switchDomain: {
    method: "post" as const,
    path: "/enterprise/marketing/livecode/codes/:id/domain",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ domainId: z.number().optional() }),
    response: envelope(qrCodeSchema),
  },
  MarketingQr_childCreate: {
    method: "post" as const,
    path: "/enterprise/marketing/livecode/codes/:id/children",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(60),
      kind: z.enum(QR_CHILD_KINDS),
      imageKey: z.string().max(255).default(""),
      linkUrl: z.string().max(1000).default(""),
      textContent: z.string().max(2000).default(""),
      channel: z.string().max(32).default(""),
      weight: z.number().int().min(1).max(100).default(1),
      sortOrder: z.number().int().default(0),
      limitScope: z.enum(QR_CHILD_LIMIT_SCOPES).default("INHERIT"),
      dailyLimit: z.number().int().min(0).max(1000000).default(0),
      totalLimit: z.number().int().min(0).max(100000000).default(0),
    }),
    response: envelope(qrChildSchema),
  },
  MarketingQr_childUpdate: {
    method: "patch" as const,
    path: "/enterprise/marketing/livecode/codes/:id/children/:childId",
    params: z.object({ id: z.string(), childId: z.string() }),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(60).optional(),
      imageKey: z.string().max(255).optional(),
      linkUrl: z.string().max(1000).optional(),
      textContent: z.string().max(2000).optional(),
      channel: z.string().max(32).optional(),
      weight: z.number().int().min(1).max(100).optional(),
      sortOrder: z.number().int().optional(),
      limitScope: z.enum(QR_CHILD_LIMIT_SCOPES).optional(),
      dailyLimit: z.number().int().min(0).max(1000000).optional(),
      totalLimit: z.number().int().min(0).max(100000000).optional(),
      status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    }),
    response: envelope(qrChildSchema),
  },
  MarketingQr_childRemove: {
    method: "delete" as const,
    path: "/enterprise/marketing/livecode/codes/:id/children/:childId",
    params: z.object({ id: z.string(), childId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  MarketingQr_stats: {
    method: "get" as const,
    path: "/enterprise/marketing/livecode/codes/:id/stats",
    params: z.object({ id: z.string() }),
    query: z.object({
      days: z.coerce.number().int().min(1).max(90).default(30),
    }),
    body: z.undefined(),
    response: envelope(qrStatsSchema),
  },
  MarketingQr_scans: {
    method: "get" as const,
    path: "/enterprise/marketing/livecode/codes/:id/scans",
    params: z.object({ id: z.string() }),
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(
      pageSchema(
        z.object({
          id: z.number(),
          childName: z.string(),
          channel: z.string(),
          domain: z.string(),
          region: z.string(),
          device: z.string(),
          result: z.string(),
          createdAt: z.string(),
        }),
      ),
    ),
  },
  AdminMarketingQr_list: {
    method: "get" as const,
    path: "/enterprise/admin/marketing-livecode",
    params: z.object({}),
    query: pageQuerySchema.extend({ keyword: z.string().optional() }),
    body: z.undefined(),
    response: envelope(
      pageSchema(
        z.object({
          id: z.number(),
          userId: z.string(),
          name: z.string(),
          code: z.string(),
          domain: z.string(),
          status: z.string(),
          totalCount: z.number(),
          createdAt: z.string(),
        }),
      ),
    ),
  },
  AdminMarketingQr_disable: {
    method: "post" as const,
    path: "/enterprise/admin/marketing-livecode/:id/disable",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      reason: z.string().max(200).default(""),
      enable: z.boolean().default(false),
    }),
    response: envelope(z.object({ id: z.number(), status: z.string() })),
  },
};
