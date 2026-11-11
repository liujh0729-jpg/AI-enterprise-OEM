import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * §5.8 平台底座横切机制：事件 Outbox/Webhook、导入导出中心、报表目录、
 * 规则引擎、公开分享、外部身份源（OIDC）、资产共享策略、IM 同步绑定。
 * 所有端点进契约自动进 OpenAPI/MCP；平台级配置（报表目录/OIDC）在控制器内做平台管理员校验，
 * 组织级机制（Webhook/导入导出/规则/分享/同步）按当前组织键隔离。
 */

export const WEBHOOK_EVENTS = [
  "task.created",
  "task.completed",
  "task.reopened",
  "project.created",
  "project.closed",
  "order.paid",
  "stock.low",
  "receivable.overdue",
  "application.created",
  "review.approved",
  "crm.lead.created",
  "crm.lead.converted",
  "crm.order.created",
  "crm.order.approved",
  "crm.payment.received",
  "crm.payment.removed",
  "demand.published",
  "demand.replied",
  "demand.accepted",
  "demand.closed",
  "engagement.created",
  "risk.detected",
  "custom",
] as const;
export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  "task.created": "任务创建",
  "task.completed": "任务完成",
  "task.reopened": "任务重开",
  "project.created": "项目创建",
  "project.closed": "项目关闭",
  "order.paid": "订单已支付",
  "stock.low": "库存偏低",
  "receivable.overdue": "应收逾期",
  "application.created": "收到投递",
  "review.approved": "审批通过",
  "crm.lead.created": "CRM 线索创建",
  "crm.lead.converted": "CRM 线索转客户",
  "crm.order.created": "CRM 订单创建",
  "crm.order.approved": "CRM 订单审批通过",
  "crm.payment.received": "CRM 回款到账",
  "crm.payment.removed": "CRM 回款撤销",
  "demand.published": "任务需求发布",
  "demand.replied": "任务需求收到响应",
  "demand.accepted": "任务需求采纳",
  "demand.closed": "任务需求关闭",
  "engagement.created": "外部合作创建",
  "risk.detected": "经营异常发现",
  custom: "自定义事件",
};

export const webhookSchema = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  enabled: z.boolean(),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]),
  secretMasked: z.string(),
  lastDeliveredAt: z.string(),
  lastError: z.string(),
  createdAt: z.string(),
});
export const webhookDeliverySchema = z.object({
  id: z.number(),
  event: z.string(),
  status: z.enum(["PENDING", "DELIVERING", "DONE", "FAILED", "SKIPPED"]),
  attempts: z.number(),
  nextAt: z.string(),
  deliveredAt: z.string(),
  error: z.string(),
  createdAt: z.string(),
});
export const saveWebhookBodySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(120),
  url: z.string().url().max(500),
  secret: z.string().max(128).default(""),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(20),
  enabled: z.boolean().default(true),
});

export const importMapSchema = z.object({
  id: z.number(),
  module: z.string(),
  name: z.string(),
  mapping: z.record(z.string(), z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const importRowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export const importJobSchema = z.object({
  id: z.number(),
  module: z.string(),
  fileName: z.string(),
  total: z.number(),
  success: z.number(),
  failed: z.number(),
  status: z.enum(["PENDING", "RUNNING", "DONE", "FAILED"]),
  errors: z.array(z.object({ row: z.number(), message: z.string() })),
  createdAt: z.string(),
  finishedAt: z.string(),
});
export const saveImportMapBodySchema = z.object({
  id: z.number().int().positive().optional(),
  module: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  mapping: z.record(z.string(), z.string()),
});
export const createImportJobBodySchema = z.object({
  module: z.string().min(1).max(32),
  fileName: z.string().max(200).default(""),
  mapping: z.record(z.string(), z.string()).default({}),
  rows: z.array(importRowSchema).min(1).max(2000),
  saveMapAs: z.string().max(64).default(""),
  dryRun: z.boolean().default(false),
});

export const exportModuleSchema = z.object({
  module: z.string(),
  label: z.string(),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  formats: z.array(z.enum(["csv", "json"])),
});
export const exportJobSchema = z.object({
  id: z.number(),
  module: z.string(),
  format: z.enum(["csv", "json"]),
  status: z.enum(["PENDING", "RUNNING", "DONE", "FAILED"]),
  rowCount: z.number(),
  progress: z.number(),
  fileUrl: z.string(),
  error: z.string(),
  createdAt: z.string(),
  finishedAt: z.string(),
});
export const createExportJobBodySchema = z.object({
  module: z.string().min(1).max(32),
  format: z.enum(["csv", "json"]).default("csv"),
  filters: z.record(z.string(), z.string()).default({}),
});
/** 认证下载：文件内容经当前会话按组织资格复核后回传，不再暴露长期公开直链。 */
export const exportDownloadSchema = z.object({
  id: z.number(),
  module: z.string(),
  format: z.enum(["csv", "json"]),
  fileName: z.string(),
  content: z.string(),
});

export const reportCatalogSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  module: z.string(),
  description: z.string(),
  path: z.string(),
  icon: z.string(),
  showInMenu: z.boolean(),
  sortOrder: z.number(),
  enabled: z.boolean(),
  planCode: z.string(),
  updatedAt: z.string(),
});
export const saveReportCatalogBodySchema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  module: z.string().min(1).max(32),
  description: z.string().max(300).default(""),
  path: z.string().max(200).default(""),
  icon: z.string().max(32).default("chart"),
  showInMenu: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  planCode: z.string().max(32).default(""),
});

export const RULE_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "exists",
] as const;
export const ruleConditionSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(RULE_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});
export const RULE_ACTION_TYPES = [
  "webhook",
  "notify",
  "insight",
  "task",
  "run_workflow",
  "assign_task",
] as const;
export const ruleActionSchema = z.object({
  type: z.enum(RULE_ACTION_TYPES),
  target: z.string().max(200).default(""),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const ruleSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  event: z.string(),
  conditions: z.array(ruleConditionSchema),
  actions: z.array(ruleActionSchema),
  enabled: z.boolean(),
  lastTriggeredAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const saveRuleBodySchema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  description: z.string().max(300).default(""),
  event: z.string().min(1).max(64),
  conditions: z.array(ruleConditionSchema).min(1).max(20),
  actions: z.array(ruleActionSchema).max(10).default([]),
  enabled: z.boolean().default(true),
});
export const testRuleBodySchema = z.object({
  conditions: z.array(ruleConditionSchema).min(1).max(20),
  context: z.record(z.string(), z.unknown()).default({}),
});

export const shareSchema = z.object({
  id: z.number(),
  slug: z.string(),
  kind: z.enum(["REPORT", "PROJECT", "BOARD", "DOC"]),
  targetId: z.string(),
  title: z.string(),
  enabled: z.boolean(),
  hasPassword: z.boolean(),
  expiresAt: z.string(),
  viewCount: z.number(),
  url: z.string(),
  createdAt: z.string(),
});
export const createShareBodySchema = z.object({
  kind: z.enum(["REPORT", "PROJECT", "BOARD", "DOC"]),
  targetId: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  projection: z.record(z.string(), z.unknown()).default({}),
  password: z.string().max(64).default(""),
  expiresDays: z.number().int().min(0).max(365).default(7),
});
export const updateShareBodySchema = z.object({
  id: z.number().int().positive(),
  enabled: z.boolean().optional(),
  password: z.string().max(64).optional(),
  expiresDays: z.number().int().min(0).max(365).optional(),
});

export const oidcProviderSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  issuer: z.string(),
  clientId: z.string(),
  clientSecretMasked: z.string(),
  scopes: z.string(),
  enabled: z.boolean(),
  autoProvision: z.boolean(),
  defaultRole: z.string(),
  redirectUri: z.string(),
  updatedAt: z.string(),
});
export const saveOidcProviderBodySchema = z.object({
  id: z.number().int().positive().optional(),
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  issuer: z.string().url().max(300),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().max(500).default(""),
  scopes: z.string().max(200).default("openid profile email"),
  enabled: z.boolean().default(true),
  autoProvision: z.boolean().default(false),
  defaultRole: z.string().max(16).default("user"),
});

export const assetSharePolicySchema = z.object({
  id: z.number(),
  name: z.string(),
  defaultExpiresDays: z.number(),
  maxExpiresDays: z.number(),
  requirePassword: z.boolean(),
  allowPublic: z.boolean(),
  allowedKinds: z.array(z.string()),
  updatedAt: z.string(),
});
export const saveAssetSharePolicyBodySchema = z.object({
  name: z.string().min(1).max(64).default("默认策略"),
  defaultExpiresDays: z.number().int().min(1).max(365).default(7),
  maxExpiresDays: z.number().int().min(1).max(365).default(30),
  requirePassword: z.boolean().default(false),
  allowPublic: z.boolean().default(true),
  allowedKinds: z.array(z.string().max(32)).max(20).default([]),
});

export const syncBindingSchema = z.object({
  id: z.number(),
  channel: z.enum(["FEISHU", "WECOM"]),
  domain: z.enum(["CONTACT", "ATTENDANCE", "APPROVAL", "MESSAGE"]),
  externalId: z.string(),
  principalType: z.string(),
  localId: z.string(),
  label: z.string(),
  createdAt: z.string(),
});
export const saveSyncBindingBodySchema = z.object({
  id: z.number().int().positive().optional(),
  channel: z.enum(["FEISHU", "WECOM"]),
  domain: z.enum(["CONTACT", "ATTENDANCE", "APPROVAL", "MESSAGE"]),
  externalId: z.string().min(1).max(128),
  principalType: z.string().max(24).default("STAFF"),
  localId: z.string().min(1).max(64),
  label: z.string().max(120).default(""),
});
export const syncRunResultSchema = z.object({
  channel: z.string(),
  domain: z.string(),
  processed: z.number(),
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  errors: z.array(z.string()),
});
export const syncOverviewSchema = z.object({
  bindings: z.number(),
  byChannel: z.record(z.string(), z.number()),
  byDomain: z.record(z.string(), z.number()),
  lastSyncAt: z.string(),
  feishuConfigured: z.boolean(),
  wecomConfigured: z.boolean(),
});

export const mechanismOverviewSchema = z.object({
  webhooks: z.number(),
  outboxPending: z.number(),
  outboxFailed: z.number(),
  importJobs: z.number(),
  exportJobs: z.number(),
  reports: z.number(),
  rules: z.number(),
  shares: z.number(),
  oidcProviders: z.number(),
});

export const mechanismsEndpoints = {
  // ---------- Webhook / Outbox ----------
  Webhook_list: {
    method: "get" as const,
    path: "/enterprise/webhooks",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(webhookSchema)),
  },
  Webhook_save: {
    method: "post" as const,
    path: "/enterprise/webhooks/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveWebhookBodySchema,
    response: envelope(webhookSchema),
  },
  Webhook_remove: {
    method: "post" as const,
    path: "/enterprise/webhooks/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Webhook_deliveries: {
    method: "get" as const,
    path: "/enterprise/webhooks/deliveries",
    params: z.object({}),
    query: pageQuerySchema.extend({
      subscriptionId: z.coerce.number().int().min(0).optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(webhookDeliverySchema)),
  },
  Webhook_replay: {
    method: "post" as const,
    path: "/enterprise/webhooks/replay",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(webhookDeliverySchema),
  },
  Webhook_test: {
    method: "post" as const,
    path: "/enterprise/webhooks/test",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(
      z.object({ ok: z.boolean(), status: z.number(), message: z.string() }),
    ),
  },

  // ---------- 导入 ----------
  Import_listMaps: {
    method: "get" as const,
    path: "/enterprise/import/maps",
    params: z.object({}),
    query: z.object({ module: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.array(importMapSchema)),
  },
  Import_saveMap: {
    method: "post" as const,
    path: "/enterprise/import/maps/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveImportMapBodySchema,
    response: envelope(importMapSchema),
  },
  Import_removeMap: {
    method: "post" as const,
    path: "/enterprise/import/maps/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Import_createJob: {
    method: "post" as const,
    path: "/enterprise/import/jobs/create",
    params: z.object({}),
    query: emptyQuery,
    body: createImportJobBodySchema,
    response: envelope(importJobSchema),
  },
  Import_jobs: {
    method: "get" as const,
    path: "/enterprise/import/jobs",
    params: z.object({}),
    query: pageQuerySchema.extend({ module: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(importJobSchema)),
  },
  Import_removeJob: {
    method: "post" as const,
    path: "/enterprise/import/jobs/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },

  // ---------- 导出 ----------
  Export_modules: {
    method: "get" as const,
    path: "/enterprise/export/modules",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(exportModuleSchema)),
  },
  Export_createJob: {
    method: "post" as const,
    path: "/enterprise/export/jobs/create",
    params: z.object({}),
    query: emptyQuery,
    body: createExportJobBodySchema,
    response: envelope(exportJobSchema),
  },
  Export_jobs: {
    method: "get" as const,
    path: "/enterprise/export/jobs",
    params: z.object({}),
    query: pageQuerySchema,
    body: z.undefined(),
    response: envelope(pageSchema(exportJobSchema)),
  },
  Export_removeJob: {
    method: "post" as const,
    path: "/enterprise/export/jobs/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Export_download: {
    method: "get" as const,
    path: "/enterprise/export/jobs/:id/download",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(exportDownloadSchema),
  },

  // ---------- 报表目录 ----------
  Report_listCatalog: {
    method: "get" as const,
    path: "/enterprise/reports/catalog",
    params: z.object({}),
    query: z.object({
      module: z.string().optional(),
      menuOnly: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(reportCatalogSchema)),
  },
  Report_saveCatalog: {
    method: "post" as const,
    path: "/enterprise/reports/catalog/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveReportCatalogBodySchema,
    response: envelope(reportCatalogSchema),
  },
  Report_removeCatalog: {
    method: "post" as const,
    path: "/enterprise/reports/catalog/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },

  // ---------- 规则引擎 ----------
  Rule_list: {
    method: "get" as const,
    path: "/enterprise/rules",
    params: z.object({}),
    query: pageQuerySchema.extend({ event: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(ruleSchema)),
  },
  Rule_save: {
    method: "post" as const,
    path: "/enterprise/rules/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveRuleBodySchema,
    response: envelope(ruleSchema),
  },
  Rule_remove: {
    method: "post" as const,
    path: "/enterprise/rules/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Rule_test: {
    method: "post" as const,
    path: "/enterprise/rules/test",
    params: z.object({}),
    query: emptyQuery,
    body: testRuleBodySchema,
    response: envelope(
      z.object({
        matched: z.boolean(),
        details: z.array(
          z.object({
            field: z.string(),
            op: z.string(),
            actual: z.string(),
            pass: z.boolean(),
          }),
        ),
      }),
    ),
  },

  // ---------- 公开分享 ----------
  Share_list: {
    method: "get" as const,
    path: "/enterprise/shares",
    params: z.object({}),
    query: pageQuerySchema.extend({ kind: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(shareSchema)),
  },
  Share_create: {
    method: "post" as const,
    path: "/enterprise/shares/create",
    params: z.object({}),
    query: emptyQuery,
    body: createShareBodySchema,
    response: envelope(shareSchema),
  },
  Share_update: {
    method: "post" as const,
    path: "/enterprise/shares/update",
    params: z.object({}),
    query: emptyQuery,
    body: updateShareBodySchema,
    response: envelope(shareSchema),
  },
  Share_remove: {
    method: "post" as const,
    path: "/enterprise/shares/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },

  // ---------- 外部身份源 ----------
  Oidc_listProviders: {
    method: "get" as const,
    path: "/enterprise/oidc/providers",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(oidcProviderSchema)),
  },
  Oidc_saveProvider: {
    method: "post" as const,
    path: "/enterprise/oidc/providers/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveOidcProviderBodySchema,
    response: envelope(oidcProviderSchema),
  },
  Oidc_removeProvider: {
    method: "post" as const,
    path: "/enterprise/oidc/providers/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Oidc_testProvider: {
    method: "post" as const,
    path: "/enterprise/oidc/providers/test",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(
      z.object({
        ok: z.boolean(),
        issuer: z.string(),
        authorizationEndpoint: z.string(),
        tokenEndpoint: z.string(),
        message: z.string(),
      }),
    ),
  },

  // ---------- 资产共享策略 ----------
  // 挂在 /enterprise/mechanisms 而非 /enterprise/asset：后者是资产模块的 REST 命名空间，
  // 静态段 /asset/share-policy 会被先注册的 /asset/:id 当作 id 吃掉（param 校验失败 → 422）。
  AssetPolicy_getSharePolicy: {
    method: "get" as const,
    path: "/enterprise/mechanisms/asset-share-policy",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(assetSharePolicySchema),
  },
  AssetPolicy_saveSharePolicy: {
    method: "post" as const,
    path: "/enterprise/mechanisms/asset-share-policy/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveAssetSharePolicyBodySchema,
    response: envelope(assetSharePolicySchema),
  },

  // ---------- IM 同步 ----------
  Sync_listBindings: {
    method: "get" as const,
    path: "/enterprise/im-sync/bindings",
    params: z.object({}),
    query: z.object({
      channel: z.string().optional(),
      domain: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(syncBindingSchema)),
  },
  Sync_saveBinding: {
    method: "post" as const,
    path: "/enterprise/im-sync/bindings/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveSyncBindingBodySchema,
    response: envelope(syncBindingSchema),
  },
  Sync_removeBinding: {
    method: "post" as const,
    path: "/enterprise/im-sync/bindings/remove",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ id: z.number() })),
  },
  Sync_overview: {
    method: "get" as const,
    path: "/enterprise/im-sync/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(syncOverviewSchema),
  },
  Sync_runContacts: {
    method: "post" as const,
    path: "/enterprise/im-sync/contacts",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      channel: z.enum(["FEISHU", "WECOM"]),
      dryRun: z.boolean().default(false),
    }),
    response: envelope(syncRunResultSchema),
  },
  Sync_runAttendance: {
    method: "post" as const,
    path: "/enterprise/im-sync/attendance",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      channel: z.enum(["FEISHU", "WECOM"]),
      startDate: z.string().min(10).max(16),
      endDate: z.string().min(10).max(16),
    }),
    response: envelope(syncRunResultSchema),
  },
  Sync_sendMessage: {
    method: "post" as const,
    path: "/enterprise/im-sync/message",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      channel: z.enum(["FEISHU", "WECOM"]),
      to: z.string().min(1).max(128),
      title: z.string().min(1).max(120),
      content: z.string().min(1).max(2000),
      link: z.string().max(500).default(""),
    }),
    response: envelope(z.object({ ok: z.boolean(), message: z.string() })),
  },
  Mechanism_overview: {
    method: "get" as const,
    path: "/enterprise/mechanisms/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(mechanismOverviewSchema),
  },
};
