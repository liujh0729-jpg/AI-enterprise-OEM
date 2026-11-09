import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const idParams = z.object({ id: z.coerce.number().int().positive() });
/** 上游/站点地址只收 http(s)，避免 ftp、mailto 之类被当成 baseURL 存进目录。 */
const httpUrl = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine((value) => /^https?:\/\//i.test(value), "只支持 http/https 地址");

/**
 * 模型广场：平台统一上架的可售模型目录 + 按量计费 + OpenAI 兼容对外调用。
 *
 * 口径（2026-11-08 确认）：
 * - 计费单位与上游 `aipdd.pricing` 完全一致：token（每百万 tokens，含缓存读写）、
 *   image（按张）、second（按秒）、call（按次）；
 * - 人民币价是「官方原价」，平台管理员只加一个折扣率（discountRate）；
 *   用户看到官方原价、折后价与折扣标识；
 * - 积分一律按系统设置里的汇率换算（1 元 = rate 积分），用户不可单独设置。
 * AIPDD 系列固定用平台级 Key，用户自带渠道仍留在「内容创作 → 模型设置」，不进广场、不扣积分。
 */

export const mpBillingUnitSchema = z.enum(["token", "image", "second", "call"]);
export type MpBillingUnit = z.infer<typeof mpBillingUnitSchema>;

/** 能力分类：文本 / 图片 / 视频 / 音频 / 向量 / 其他（按模型端点归类）。 */
export const mpCategorySchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "embedding",
  "other",
]);
export type MpCategory = z.infer<typeof mpCategorySchema>;

export const mpSourceSchema = z.enum(["IN_APP", "API"]);
export type MpSource = z.infer<typeof mpSourceSchema>;

/** 上游分档：match 全中才采用该档官方单价。 */
export const mpTierSchema = z.object({
  match: z.record(z.string(), z.string()),
  unitRmb: z.number(),
});
export type MpTier = z.infer<typeof mpTierSchema>;

/** 上游附加计费组件（目前是图像编辑的参考图超出量）。 */
export const mpComponentSchema = z.object({
  code: z.string(),
  freeUnits: z.number(),
  unit: mpBillingUnitSchema,
  unitRmb: z.number(),
  tiers: z.array(mpTierSchema).default([]),
});
export type MpComponent = z.infer<typeof mpComponentSchema>;

/** 一组人民币价：token 类看 input/output/cache，媒体类看 unit（每张/每秒/每次）。 */
export const mpMoneySchema = z.object({
  inputRmb: z.number(),
  outputRmb: z.number(),
  unitRmb: z.number(),
  cacheReadRmb: z.number(),
  cacheWriteRmb: z.number(),
  minimumRmb: z.number(),
});
export type MpMoney = z.infer<typeof mpMoneySchema>;

export const mpPointsSchema = z.object({
  inputPoints: z.number(),
  outputPoints: z.number(),
  unitPoints: z.number(),
  cacheReadPoints: z.number(),
  cacheWritePoints: z.number(),
  minimumPoints: z.number(),
});
export type MpPoints = z.infer<typeof mpPointsSchema>;

/**
 * 三视图：official 是上游官方原价，effective 是乘平台折扣后的实际收费价，
 * points 是按系统汇率换算出的积分价（token 类均为每百万 tokens）。
 */
export const mpPriceSchema = z.object({
  billingUnit: mpBillingUnitSchema,
  discountRate: z.number(),
  official: mpMoneySchema,
  effective: mpMoneySchema,
  points: mpPointsSchema,
  tiers: z.array(mpTierSchema).default([]),
  components: z.array(mpComponentSchema).default([]),
  pointsFromRate: z.boolean(),
});
export type MpPrice = z.infer<typeof mpPriceSchema>;

export const mpModalitiesSchema = z.object({
  input: z.array(z.string()).default([]),
  output: z.array(z.string()).default([]),
});
export type MpModalities = z.infer<typeof mpModalitiesSchema>;

export const mpUsageStatSchema = z.object({
  calls: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  pointsCost: z.number(),
});
export type MpUsageStat = z.infer<typeof mpUsageStatSchema>;

/** 速率限制口径：网关按「Key × 自然日」计数，全模型合计。 */
export const mpRateLimitSchema = z.object({
  /** 单 Key 每日调用上限；0＝不限（Key 上单独设置的限额优先） */
  dailyCalls: z.number().int().nonnegative(),
  /** 中文说明，直接展示给用户 */
  note: z.string(),
});
export type MpRateLimit = z.infer<typeof mpRateLimitSchema>;

export const mpModelSchema = z.object({
  id: z.number().int(),
  /** 与 AIPDD 并列展示的渠道名：AIPDD | LocalAPI | 管理员自定义 */
  provider: z.string(),
  modelKey: z.string(),
  displayName: z.string(),
  vendor: z.string(),
  description: z.string(),
  /** 与上游 aipdd.pricing.billing_unit 一致 */
  billingUnit: mpBillingUnitSchema,
  /** 能力分类，用于目录筛选与卡片标识 */
  category: mpCategorySchema,
  price: mpPriceSchema,
  contextWindow: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
  modalities: mpModalitiesSchema,
  /** 支持的调用路径，形如 ["/chat/completions", "/embeddings"] */
  endpoints: z.array(z.string()),
  /** 支持的请求参数（按能力推导的静态清单） */
  params: z.array(z.string()).default([]),
  /** 速率限制（Key 维度、按自然日） */
  rateLimit: mpRateLimitSchema,
  tags: z.array(z.string()),
  upstreamName: z.string(),
  /** 凭据齐备且已上架才为 true；false 时前端置灰并给出原因 */
  available: z.boolean(),
  unavailableReason: z.string(),
  myUsage7d: mpUsageStatSchema,
});
export type MpModel = z.infer<typeof mpModelSchema>;

export const mpCatalogSchema = z.object({
  /** 1 元人民币 = rate 积分 */
  rate: z.number(),
  balance: z.number(),
  list: z.array(mpModelSchema),
  total: z.number().int().nonnegative(),
  providers: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })),
  vendors: z.array(z.string()),
  tags: z.array(z.string()),
});
export type MpCatalog = z.infer<typeof mpCatalogSchema>;

export const mpModelDetailSchema = mpModelSchema.extend({
  upstreamId: z.number().int().nonnegative(),
  upstreamModelKey: z.string(),
  remark: z.string(),
  myUsageTotal: mpUsageStatSchema,
});
export type MpModelDetail = z.infer<typeof mpModelDetailSchema>;

export const mpTrialInputSchema = z.object({
  modelId: z.number().int().positive(),
  prompt: z.string().trim().min(1).max(20000),
  system: z.string().max(4000).default(""),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
  maxTokens: z.coerce.number().int().positive().max(8192).default(1024),
});
export type MpTrialInput = z.infer<typeof mpTrialInputSchema>;

export const mpTrialResultSchema = z.object({
  content: z.string(),
  model: z.string(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  pointsCost: z.number(),
  rmbCost: z.number(),
  elapsedMs: z.number().int().nonnegative(),
  balance: z.number(),
});
export type MpTrialResult = z.infer<typeof mpTrialResultSchema>;

export const mpUsageLogSchema = z.object({
  id: z.number().int(),
  modelKey: z.string(),
  displayName: z.string(),
  provider: z.string(),
  source: mpSourceSchema,
  endpoint: z.string(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  /** 媒体类计量：图片张数 / 视频秒数 / 音频秒数 / 调用次数。 */
  billingQuantity: z.number(),
  billingUnit: z.string(),
  pointsCost: z.number(),
  rmbCost: z.number(),
  elapsedMs: z.number().int().nonnegative(),
  isStream: z.boolean(),
  status: z.enum(["SUCCESS", "FAILED"]),
  message: z.string(),
  requestId: z.string(),
  createdAt: z.string(),
});
export type MpUsageLog = z.infer<typeof mpUsageLogSchema>;

export const mpUsageSummarySchema = z.object({
  calls: z.number().int().nonnegative(),
  successCalls: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  pointsCost: z.number(),
  rmbCost: z.number(),
  byModel: z.array(
    z.object({
      modelKey: z.string(),
      provider: z.string(),
      calls: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      pointsCost: z.number(),
    }),
  ),
  bySource: z.array(
    z.object({
      source: z.string(),
      calls: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      pointsCost: z.number(),
    }),
  ),
  daily: z.array(
    z.object({
      date: z.string(),
      calls: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      pointsCost: z.number(),
    }),
  ),
});
export type MpUsageSummary = z.infer<typeof mpUsageSummarySchema>;

export const mpApiKeySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  masked: z.string(),
  rateLimitDay: z.number().int().nonnegative(),
  callCount: z.number().int().nonnegative(),
  todayCalls: z.number().int().nonnegative(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MpApiKey = z.infer<typeof mpApiKeySchema>;

export const mpConnectionSchema = z.object({
  /** 对外 OpenAI 兼容 baseURL（站点域名 + /v1），站外 SDK 直接填这个 */
  baseUrl: z.string(),
  rate: z.number(),
  /** 单个 Key 每日调用上限缺省值；0＝不限，Key 上的 rateLimitDay 优先 */
  dailyLimit: z.number().int().nonnegative(),
  keys: z.array(mpApiKeySchema),
  modelsPath: z.string(),
});
export type MpConnection = z.infer<typeof mpConnectionSchema>;

export const mpUpstreamSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  provider: z.string(),
  baseUrl: z.string(),
  protocol: z.enum(["openai", "anthropic"]),
  enabled: z.boolean(),
  remark: z.string(),
  /** 只回掩码，密文与明文都不出接口 */
  keyMasked: z.string(),
  modelCount: z.number().int().nonnegative(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MpUpstream = z.infer<typeof mpUpstreamSchema>;

export const mpAipddViewSchema = z.object({
  baseUrl: z.string(),
  configured: z.boolean(),
  masked: z.string(),
  source: z.enum(["db", "env", "none"]),
});
export type MpAipddView = z.infer<typeof mpAipddViewSchema>;

export const mpAdminModelSchema = mpModelSchema.extend({
  upstreamId: z.number().int().nonnegative(),
  upstreamModelKey: z.string(),
  enabled: z.boolean(),
  sort: z.number().int(),
  remark: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  usage7d: mpUsageStatSchema,
});
export type MpAdminModel = z.infer<typeof mpAdminModelSchema>;

export const mpDiscoveredModelSchema = z.object({
  modelKey: z.string(),
  /** text | vision | image | video | audio | asr | embedding | other */
  kind: z.string(),
  vision: z.boolean(),
  endpoints: z.array(z.string()),
  displayName: z.string(),
  /** 上游声明的计费单位与官方价；非 AIPDD 渠道没有元数据时为单位 token、价格 0 */
  billingUnit: mpBillingUnitSchema,
  category: mpCategorySchema,
  inputRmbPrice: z.number(),
  outputRmbPrice: z.number(),
  /** 媒体类基础单价：元 / 张、元 / 秒、元 / 次 */
  callRmbPrice: z.number(),
  cacheReadRmbPrice: z.number(),
  cacheWriteRmbPrice: z.number(),
  minimumRmb: z.number(),
  tiers: z.array(mpTierSchema),
  components: z.array(mpComponentSchema),
  /** 已在目录里时带上，便于前端显示当前上架状态与价格 */
  catalogId: z.number().int().nullable(),
  enabled: z.boolean().nullable(),
});
export type MpDiscoveredModel = z.infer<typeof mpDiscoveredModelSchema>;

export const mpPullResultSchema = z.object({
  upstreamId: z.number().int().nonnegative(),
  provider: z.string(),
  baseUrl: z.string(),
  /** 上游有、目录没有 */
  added: z.array(mpDiscoveredModelSchema),
  /** 两边都有 */
  existing: z.array(mpDiscoveredModelSchema),
  /** 目录有、上游已不再提供（仅提示，不自动下架） */
  removed: z.array(mpDiscoveredModelSchema),
});
export type MpPullResult = z.infer<typeof mpPullResultSchema>;

const rmbPrice = z.coerce.number().nonnegative().max(1000000);
/** 折扣率：0.85 = 85 折；1 = 不打折，不允许上浮。 */
const discountRate = z.coerce.number().positive().max(1);

export const mpCatalogSaveSchema = z.object({
  id: z.coerce.number().int().nonnegative().default(0),
  upstreamId: z.coerce.number().int().nonnegative().default(0),
  provider: z.string().trim().min(1).max(24).default("AIPDD"),
  modelKey: z.string().trim().min(1).max(128),
  upstreamModelKey: z.string().trim().max(128).default(""),
  displayName: z.string().trim().max(128).default(""),
  vendor: z.string().trim().max(64).default(""),
  description: z.string().trim().max(500).default(""),
  /** 与上游计费单位完全一致 */
  billingUnit: mpBillingUnitSchema.default("token"),
  /** 能力分类；留空时后端按端点推导 */
  category: mpCategorySchema.default("text"),
  /** 官方原价：token 类按每百万 tokens，媒体类按每张/每秒/每次 */
  inputRmbPrice: rmbPrice.default(0),
  outputRmbPrice: rmbPrice.default(0),
  callRmbPrice: rmbPrice.default(0),
  cacheReadRmbPrice: rmbPrice.default(0),
  cacheWriteRmbPrice: rmbPrice.default(0),
  minimumRmb: rmbPrice.default(0),
  tiers: z.array(mpTierSchema).max(50).default([]),
  components: z.array(mpComponentSchema).max(10).default([]),
  /** 平台折扣，仅允许下调（0,1] */
  discountRate: discountRate.default(1),
  contextWindow: z.coerce.number().int().nonnegative().max(10000000).default(0),
  maxOutputTokens: z.coerce.number().int().nonnegative().max(1000000).default(0),
  modalities: mpModalitiesSchema.default({ input: ["text"], output: ["text"] }),
  endpoints: z.array(z.string().trim().min(1).max(64)).max(16).default(["/chat/completions"]),
  tags: z.array(z.string().trim().min(1).max(32)).max(16).default([]),
  enabled: z.boolean().default(false),
  sort: z.coerce.number().int().min(-10000).max(10000).default(0),
  remark: z.string().trim().max(200).default(""),
});
export type MpCatalogSave = z.infer<typeof mpCatalogSaveSchema>;

export const mpUpstreamSaveSchema = z.object({
  id: z.coerce.number().int().nonnegative().default(0),
  name: z.string().trim().min(1).max(64),
  provider: z.string().trim().min(1).max(24).default("LocalAPI"),
  baseUrl: httpUrl,
  protocol: z.enum(["openai", "anthropic"]).default("openai"),
  /** 留空＝沿用已存密文（编辑时不必重填 Key） */
  apiKey: z.string().max(512).default(""),
  enabled: z.boolean().default(true),
  remark: z.string().trim().max(200).default(""),
});
export type MpUpstreamSave = z.infer<typeof mpUpstreamSaveSchema>;

export const mpPullInputSchema = z.object({
  /** 0＝AIPDD 内置（用平台级 Key）；>0＝已保存的上游渠道 */
  upstreamId: z.coerce.number().int().nonnegative().default(0),
  /** 临时试拉：不入库，直接给地址与 Key */
  baseUrl: z.string().trim().max(300).default(""),
  apiKey: z.string().max(512).default(""),
  protocol: z.enum(["openai", "anthropic"]).default("openai"),
});
export type MpPullInput = z.infer<typeof mpPullInputSchema>;

export const mpImportInputSchema = z.object({
  upstreamId: z.coerce.number().int().nonnegative().default(0),
  models: z
    .array(
      z.object({
        modelKey: z.string().trim().min(1).max(128),
        displayName: z.string().trim().max(128).default(""),
        billingUnit: mpBillingUnitSchema.default("token"),
        category: mpCategorySchema.default("text"),
        inputRmbPrice: rmbPrice.default(0),
        outputRmbPrice: rmbPrice.default(0),
        callRmbPrice: rmbPrice.default(0),
        cacheReadRmbPrice: rmbPrice.default(0),
        cacheWriteRmbPrice: rmbPrice.default(0),
        minimumRmb: rmbPrice.default(0),
        tiers: z.array(mpTierSchema).max(50).default([]),
        components: z.array(mpComponentSchema).max(10).default([]),
      }),
    )
    .min(1)
    .max(500),
  /** 入库即上架；缺省 false，等管理员填完价再上架 */
  enabled: z.boolean().default(false),
  /** true＝把目录里该上游下、本次未勾选的模型一并下架 */
  disableMissing: z.boolean().default(false),
});
export type MpImportInput = z.infer<typeof mpImportInputSchema>;

const usageFilter = {
  source: z.enum(["ALL", "IN_APP", "API"]).default("ALL"),
  modelKey: z.string().trim().max(128).default(""),
  from: z.string().trim().max(32).default(""),
  to: z.string().trim().max(32).default(""),
};

export const modelPlazaEndpoints = {
  Mp_catalog: {
    method: "get" as const,
    path: "/enterprise/model-plaza/catalog",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(mpCatalogSchema),
  },
  Mp_detail: {
    method: "get" as const,
    path: "/enterprise/model-plaza/models/:id",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(mpModelDetailSchema),
  },
  Mp_trial: {
    method: "post" as const,
    path: "/enterprise/model-plaza/trial",
    params: z.object({}),
    query: emptyQuery,
    body: mpTrialInputSchema,
    response: envelope(mpTrialResultSchema),
  },
  Mp_usage: {
    method: "get" as const,
    path: "/enterprise/model-plaza/usage",
    params: z.object({}),
    query: pageQuerySchema.extend(usageFilter),
    body: z.undefined(),
    response: envelope(pageSchema(mpUsageLogSchema).extend({ summary: mpUsageSummarySchema })),
  },
  Mp_usageSummary: {
    method: "get" as const,
    path: "/enterprise/model-plaza/usage/summary",
    params: z.object({}),
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }),
    body: z.undefined(),
    response: envelope(mpUsageSummarySchema),
  },
  Mp_connection: {
    method: "get" as const,
    path: "/enterprise/model-plaza/connection",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(mpConnectionSchema),
  },
};

export const modelPlazaAdminEndpoints = {
  AdminMp_overview: {
    method: "get" as const,
    path: "/enterprise/admin/model-plaza/overview",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        rate: z.number(),
        upstreamCount: z.number().int().nonnegative(),
        catalogTotal: z.number().int().nonnegative(),
        catalogEnabled: z.number().int().nonnegative(),
        aipdd: mpAipddViewSchema,
        calls7d: z.number().int().nonnegative(),
        points7d: z.number(),
        activeUsers7d: z.number().int().nonnegative(),
      }),
    ),
  },
  AdminMp_upstreams: {
    method: "get" as const,
    path: "/enterprise/admin/model-plaza/upstreams",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ list: z.array(mpUpstreamSchema), aipdd: mpAipddViewSchema })),
  },
  AdminMp_saveUpstream: {
    method: "post" as const,
    path: "/enterprise/admin/model-plaza/upstreams",
    params: z.object({}),
    query: emptyQuery,
    body: mpUpstreamSaveSchema,
    response: envelope(mpUpstreamSchema),
  },
  AdminMp_removeUpstream: {
    method: "delete" as const,
    path: "/enterprise/admin/model-plaza/upstreams/:id",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number().int(), removedModels: z.number().int().nonnegative() })),
  },
  AdminMp_listCatalog: {
    method: "get" as const,
    path: "/enterprise/admin/model-plaza/catalog",
    params: z.object({}),
    query: pageQuerySchema.extend({
      keyword: z.string().trim().max(128).default(""),
      provider: z.string().trim().max(24).default(""),
      category: z
        .enum(["ALL", "text", "image", "video", "audio", "embedding", "other"])
        .default("ALL"),
      enabled: z.enum(["ALL", "ON", "OFF"]).default("ALL"),
    }),
    body: z.undefined(),
    response: envelope(
      pageSchema(mpAdminModelSchema).extend({
        rate: z.number(),
        providers: z.array(z.string()),
        upstreams: z.array(z.object({ id: z.number().int(), name: z.string(), provider: z.string() })),
        aipdd: mpAipddViewSchema,
      }),
    ),
  },
  AdminMp_saveCatalog: {
    method: "post" as const,
    path: "/enterprise/admin/model-plaza/catalog",
    params: z.object({}),
    query: emptyQuery,
    body: mpCatalogSaveSchema,
    response: envelope(mpAdminModelSchema),
  },
  AdminMp_toggleCatalog: {
    method: "post" as const,
    path: "/enterprise/admin/model-plaza/catalog/:id/toggle",
    params: idParams,
    query: emptyQuery,
    body: z.object({ enabled: z.boolean() }),
    response: envelope(z.object({ id: z.number().int(), enabled: z.boolean() })),
  },
  AdminMp_removeCatalog: {
    method: "delete" as const,
    path: "/enterprise/admin/model-plaza/catalog/:id",
    params: idParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number().int() })),
  },
  AdminMp_pullModels: {
    method: "post" as const,
    path: "/enterprise/admin/model-plaza/pull",
    params: z.object({}),
    query: emptyQuery,
    body: mpPullInputSchema,
    response: envelope(mpPullResultSchema),
  },
  AdminMp_importModels: {
    method: "post" as const,
    path: "/enterprise/admin/model-plaza/import",
    params: z.object({}),
    query: emptyQuery,
    body: mpImportInputSchema,
    response: envelope(
      z.object({
        created: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
        disabled: z.number().int().nonnegative(),
      }),
    ),
  },
  AdminMp_seed: {
    method: "post" as const,
    path: "/enterprise/admin/model-plaza/seed",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ created: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() })),
  },
  AdminMp_usageList: {
    method: "get" as const,
    path: "/enterprise/admin/model-plaza/usage",
    params: z.object({}),
    query: pageQuerySchema.extend({ ...usageFilter, userId: z.string().trim().max(64).default("") }),
    body: z.undefined(),
    response: envelope(
      pageSchema(mpUsageLogSchema.extend({ userId: z.string(), userName: z.string() })).extend({
        summary: mpUsageSummarySchema,
      }),
    ),
  },
};