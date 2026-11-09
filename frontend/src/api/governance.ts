import { endpoints, type FeatureCatalogNode } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/**
 * 平台治理 API（方案 §5.9/§5.10/§5.12 契约端点的薄包装）：
 * - menu 对登录用户开放（导航唯一数据源，PLATFORM∪ORG 合并后的有效态）；
 * - 目录/开关/访问策略/审查台账/计费规则为管理端动作，后端 requireAdmin 收口。
 */

/** 有效菜单/目录节点（平铺，前端按 parentCode 组树）。 */
export type FeatureNode = FeatureCatalogNode;

/** Agent 访问策略：黑名单条目 + 沙箱硬上限（GET/POST access-policy 同构返回）。 */
export type AccessPolicy = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Platform_accessPolicy">["data"]
>;

/** 技能审查台账行（静态命中 + LLM 判定 + 最终决议）。 */
export type SkillReviewRun = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Platform_skillReviews">["data"]
>["list"][number];

/** Agent 按用量计费规则行（金额全部字符串，展示时自行 Number() 格式化）。 */
export type BillingRule = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Points_billingRules">["data"]
>[number];

/** AI 主开关与限流（§5.7）：平台总闸 + 组织覆盖 + 用户×组织每分钟上限。 */
export type AiGuard = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Platform_aiGuard">["data"]
>;

export const governanceApi = {
  menu: endpoint(endpoints.Platform_menu),
  features: endpoint(endpoints.Platform_featureCatalog),
  setToggle: endpoint(endpoints.Platform_setFeatureToggle),
  accessPolicy: endpoint(endpoints.Platform_accessPolicy),
  saveAccessPolicy: endpoint(endpoints.Platform_saveAccessPolicy),
  skillReviews: endpoint(endpoints.Platform_skillReviews),
  reviewDecision: endpoint(endpoints.Platform_reviewSkillDecision),
  aiGuard: endpoint(endpoints.Platform_aiGuard),
  saveAiGuard: endpoint(endpoints.Platform_saveAiGuard),
};

export const billingRuleApi = {
  list: endpoint(endpoints.Points_billingRules),
  upsert: endpoint(endpoints.Points_upsertBillingRule),
  remove: endpoint(endpoints.Points_deleteBillingRule),
};
