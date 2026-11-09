import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 平台治理契约（方案 §5.9/§5.10/§5.12 的 L0 底座）：
 * 菜单/功能目录与开关（关闭即拦后端）、Agent 访问策略（黑名单+沙箱硬上限）、
 * 技能审查台账与人工放行、Agent 按用量计费规则。
 * 管理端动作经 requireAdmin 收口，MCP Key 按既有规则看不到平台管理接口。
 */

/** 目录节点（平铺返回，前端按 parentCode 组树；state 是 PLATFORM∪ORG 合并后的有效态）。 */
export const featureCatalogNodeSchema = z.object({
  code: z.string(),
  kind: z.enum(["GROUP", "MENU"]),
  parentCode: z.string(),
  title: z.string(),
  path: z.string(),
  scope: z.enum(["PLATFORM", "ORG"]),
  /** protected 不可关：UI 置灰 + 后端拒绝关闭请求 */
  protected: z.boolean(),
  /** 有效状态：任一祖先 GROUP closed 时叶子级联显示 closed */
  state: z.enum(["open", "closed"]),
  sortOrder: z.number(),
});
export type FeatureCatalogNode = z.infer<typeof featureCatalogNodeSchema>;

export const setFeatureToggleBodySchema = z.object({
  code: z.string().min(1).max(64),
  state: z.enum(["open", "closed"]),
  /** 默认 PLATFORM 全局行；ORG 行仅平台管理员代企业设置时使用 */
  scope: z.enum(["PLATFORM", "ORG"]).default("PLATFORM"),
  orgUserId: z.string().max(64).default(""),
});

/** Agent 访问策略（§5.9）：黑名单条目 + 沙箱硬上限，运行期技能不可突破。 */
export const accessBlacklistEntrySchema = z.object({
  type: z.enum(["domain", "ip", "cidr"]),
  value: z.string().min(1).max(120),
  reason: z.string().max(200).default(""),
  addedBy: z.string().max(64).default(""),
});
export const sandboxLimitsSchema = z.object({
  minIntervalMs: z.number().int().min(0).max(600000).default(1000),
  maxConcurrency: z.number().int().min(1).max(64).default(2),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  maxRequestsPerRun: z.number().int().min(1).max(1000).default(100),
  perDomainQps: z.number().int().min(1).max(60).default(5),
  allowMethods: z.array(z.enum(["GET", "HEAD"])).default(["GET", "HEAD"]),
  enforceRobots: z.boolean().default(true),
  botUa: z.string().max(200).default("PlatformBot/1.0 (+https://{site}/robots; abuse@{site})"),
});
export const accessPolicySchema = z.object({
  blacklist: z.array(accessBlacklistEntrySchema),
  limits: sandboxLimitsSchema,
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export const saveAccessPolicyBodySchema = z.object({
  blacklist: z.array(accessBlacklistEntrySchema).max(500).optional(),
  limits: sandboxLimitsSchema.partial().optional(),
});

/** 技能审查台账（§5.9）：静态命中 + LLM 判定 + 最终决议。 */
export const skillReviewRunSchema = z.object({
  id: z.number(),
  kind: z.enum(["skill", "plugin"]),
  itemId: z.number(),
  userId: z.string(),
  inputDigest: z.string(),
  staticHits: z.array(z.object({ rule: z.string(), file: z.string(), excerpt: z.string() })),
  llmVerdict: z.record(z.string(), z.unknown()),
  decision: z.enum(["pass", "reject", "needsAdmin", "unreviewed"]),
  riskLevel: z.string(),
  model: z.string(),
  tokens: z.number(),
  cost: z.string(),
  createdAt: z.string(),
});
export const reviewDecisionBodySchema = z.object({
  kind: z.enum(["skill", "plugin"]),
  itemId: z.number().int().positive(),
  decision: z.enum(["passed", "rejected"]),
  note: z.string().max(200).default(""),
});

/** Agent 按用量计费规则（§5.12）：扣分 = baseFee + Σ(用量 × unitPrice × multiplier)。 */
export const billingRuleSchema = z.object({
  id: z.number(),
  code: z.string(),
  scope: z.enum(["PLATFORM", "ORG", "PLAN"]),
  orgUserId: z.string(),
  metric: z.enum(["token_in", "token_out", "call", "byte", "page"]),
  unitPriceAmount: z.string(),
  baseFeeAmount: z.string(),
  multiplier: z.string(),
  minChargeAmount: z.string(),
  maxChargeAmount: z.string(),
  budgetCapMonthly: z.string(),
  freeQuotaMonthly: z.string(),
  enabled: z.boolean(),
  version: z.number(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export const upsertBillingRuleBodySchema = z.object({
  code: z.string().min(1).max(32),
  scope: z.enum(["PLATFORM", "ORG", "PLAN"]).default("PLATFORM"),
  orgUserId: z.string().max(64).default(""),
  metric: z.enum(["token_in", "token_out", "call", "byte", "page"]),
  unitPriceAmount: z.number().min(0).default(0),
  baseFeeAmount: z.number().min(0).default(0),
  multiplier: z.number().min(0).max(1000).default(1),
  minChargeAmount: z.number().min(0).default(0.01),
  maxChargeAmount: z.number().min(0).default(0),
  budgetCapMonthly: z.number().min(0).default(0),
  freeQuotaMonthly: z.number().min(0).default(0),
  enabled: z.boolean().default(true),
});

/**
 * AI 主开关与调用限流（§5.7 安全三件套）：平台总闸 + 按组织收紧 + 用户×组织双维限流。
 * 关闭后统一网关与内容模型设置一律拒绝取模型，静默链路回落规则式产出；
 * 限流按 60 秒滑动窗口计，0 表示不限。
 */
export const aiGuardSchema = z.object({
  enabled: z.boolean(),
  userPerMinute: z.number().int().min(0).max(600),
  orgPerMinute: z.number().int().min(0).max(20000),
  orgOverrides: z.array(
    z.object({
      orgUserId: z.string().min(1).max(64),
      enabled: z.boolean(),
    }),
  ),
});
export type AiGuardSettings = z.infer<typeof aiGuardSchema>;

export const governanceEndpoints = {
  /** 有效菜单树（§5.10）：按当前身份合并 PLATFORM/ORG 开关后的目录，前端导航唯一数据源。 */
  Platform_menu: {
    method: "get" as const,
    path: "/enterprise/platform/menu",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(featureCatalogNodeSchema)),
  },
  /** 功能目录全量（管理端）：含 protected 与有效状态。 */
  Platform_featureCatalog: {
    method: "get" as const,
    path: "/enterprise/platform/features",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(featureCatalogNodeSchema)),
  },
  /** 设置功能开关（管理端）：protected 节点拒绝 closed；改后立即生效（菜单+直链+MCP 同口径）。 */
  Platform_setFeatureToggle: {
    method: "post" as const,
    path: "/enterprise/platform/features/toggle",
    params: z.object({}),
    query: emptyQuery,
    body: setFeatureToggleBodySchema,
    response: envelope(featureCatalogNodeSchema),
  },
  /** Agent 访问策略读取（管理端）。 */
  Platform_accessPolicy: {
    method: "get" as const,
    path: "/enterprise/platform/access-policy",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(accessPolicySchema),
  },
  /** Agent 访问策略保存（管理端）：黑名单增删与沙箱上限收紧，技能与连接器运行期实时读取。 */
  Platform_saveAccessPolicy: {
    method: "post" as const,
    path: "/enterprise/platform/access-policy/save",
    params: z.object({}),
    query: emptyQuery,
    body: saveAccessPolicyBodySchema,
    response: envelope(accessPolicySchema),
  },
  /** 技能审查台账分页（管理端）：静态命中与 LLM 判定全程留痕。 */
  Platform_skillReviews: {
    method: "get" as const,
    path: "/enterprise/platform/skill-reviews",
    params: z.object({}),
    query: pageQuerySchema.extend({ kind: z.string().optional(), decision: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(skillReviewRunSchema)),
  },
  /** needsAdmin 人工放行/终裁（管理端）：放行后技能进可用集（reviewStatus=passed）。 */
  Platform_reviewSkillDecision: {
    method: "post" as const,
    path: "/enterprise/platform/skill-reviews/decision",
    params: z.object({}),
    query: emptyQuery,
    body: reviewDecisionBodySchema,
    response: envelope(z.object({ kind: z.string(), itemId: z.number(), reviewStatus: z.string() })),
  },
  /** 计费规则列表（管理端）：PLATFORM 默认 + ORG/PLAN 覆盖行。 */
  Points_billingRules: {
    method: "get" as const,
    path: "/enterprise/points/billing-rules",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(billingRuleSchema)),
  },
  /** 计费规则 upsert（管理端）：改价即时生效、版本自增、留审计。 */
  Points_upsertBillingRule: {
    method: "post" as const,
    path: "/enterprise/points/billing-rules/upsert",
    params: z.object({}),
    query: emptyQuery,
    body: upsertBillingRuleBodySchema,
    response: envelope(billingRuleSchema),
  },
  /** 计费规则删除（管理端）：只删覆盖行，PLATFORM 默认行由种子维护。 */
  Points_deleteBillingRule: {
    method: "post" as const,
    path: "/enterprise/points/billing-rules/delete",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ id: z.number().int().positive() }),
    response: envelope(z.object({ deleted: z.number() })),
  },
  /** AI 主开关与限流（管理端）：平台总闸、组织级收紧、用户×组织每分钟上限。 */
  Platform_aiGuard: {
    method: "get" as const,
    path: "/enterprise/platform/ai-guard",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aiGuardSchema),
  },
  /** AI 闸门保存（管理端）：即时生效，统一网关与模型设置同口径读取。 */
  Platform_saveAiGuard: {
    method: "post" as const,
    path: "/enterprise/platform/ai-guard/save",
    params: z.object({}),
    query: emptyQuery,
    body: aiGuardSchema,
    response: envelope(aiGuardSchema),
  },
};
