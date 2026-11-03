"use client";

import { Notice } from "@/components/ui/panel";
import { useBusinessQuery } from "@/query/business";
import { fmtDate, fmtTime } from "@/lib/datetime";
import { SUBITEM_LABELS } from "@/lib/provider-categories";

/* ============================================================
   平台管理后台：行类型、文案映射、取数（403 友好提示不崩页面）
   ============================================================ */

/** GET /enterprise/admin/provider-applications | /providers 行。 */
export type ProviderApplicationRow = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Admin_appPage">["data"]
>["list"][number];

/** 服务商管理行：按 userId 聚合的多项服务类型资质。 */
export type ProviderManagedRow =
  import("@enterprise/contracts").ProviderManagedRow;

/**
 * GET /enterprise/admin/stats。
 * 后端缺口：users / providers / taxPaid / refunds / legalRequests /
 * ipRequests / flexWorkOrders 未返回，故声明为可选（页面以「—」占位）。
 */
export type AdminStats = import("@enterprise/contracts").AdminStats;

/** GET /enterprise/admin/contracts 行。 */
export type AdminContractRow = import("@enterprise/contracts").AdminContractRow;

/* ---------- 文案映射（对齐 demo/public/assets/js/ui.js 与 admin.js） ---------- */

/** 服务类型徽标文案（Ui.providerTypeLabel）。 */
export const PROVIDER_TYPE_LABEL: Record<string, string> = {
  TAX_FINANCE: "企业财税服务",
  MICRO: "小微服务商",
  LOGISTICS: "物流服务",
  SMART_SERVICE: "IT服务",
  EXPORT_REFUND: "跨境出海服务",
  LEGAL_SERVICE: "法律服务",
  IP_SERVICE: "知识产权服务",
  THINK_TANK_SERVICE: "智库服务",
  FLEX_WORK: "灵活用工服务",
  SUPPLY_NETWORK: "供销服务",
  MARKETING: "营销服务",
  ASSET_TRADE: "资产交易",
  COMPANY_REG: "海外公司注册",
  SETTLEMENT: "跨境结算",
  TAX_COMPLIANCE: "海外税务合规",
  QUALIFICATION: "出口资质备案",
  BANK_ACCOUNT: "海外银行开户",
  INFLUENCER_VISIT: "达人探店",
  LIVE_SELLING: "直播带货",
  CONTENT_MARKETING: "内容营销",
  GEO_OPTIMIZATION: "GEO优化",
  PRECISION_MARKETING: "精准营销",
  PRIVATE_DOMAIN: "私域营销",
};

/** 服务类型徽标颜色（Ui.providerTypeBadge）。 */
export const PROVIDER_TYPE_VARIANT: Record<string, string> = {
  TAX_FINANCE: "blue",
  MICRO: "green",
  LOGISTICS: "orange",
  SMART_SERVICE: "violet",
  EXPORT_REFUND: "sky",
  LEGAL_SERVICE: "green",
  THINK_TANK_SERVICE: "sky",
  FLEX_WORK: "orange",
  SUPPLY_NETWORK: "blue",
  MARKETING: "violet",
  ASSET_TRADE: "sky",
};

export function providerTypeBadge(type: string) {
  return (
    <span className={`badge badge-${PROVIDER_TYPE_VARIANT[type] || "sky"}`}>
      {PROVIDER_TYPE_LABEL[type] || type}
    </span>
  );
}

/**
 * 服务类目顺序（与备案表单 `PROVIDER_TYPES` 同序）。
 * 注意：`MICRO`（小微服务商）是**服务商类型**、不是服务类目 —— 不在此列，
 * 由 `MICRO_TYPE` 单独展示与停用 / 恢复。
 */
export const SERVICE_CATEGORY_ORDER = [
  "TAX_FINANCE",
  "EXPORT_REFUND",
  "LOGISTICS",
  "SMART_SERVICE",
  "LEGAL_SERVICE",
  "IP_SERVICE",
  "THINK_TANK_SERVICE",
  "FLEX_WORK",
  "SUPPLY_NETWORK",
  "MARKETING",
  "ASSET_TRADE",
];

/** 服务商类型（备案判定）：仅 MICRO ＝ 小微服务商（个人主体直营，本人即唯一职员）。 */
export const MICRO_TYPE = "MICRO";

/** 服务商服务类型分布卡的短文案（demo 总览 TYPE_LABEL）。 */
export const SERVICE_DISTRIBUTION_LABEL: Record<string, string> = {
  TAX_FINANCE: "企业财税",
  EXPORT_REFUND: "跨境出海",
  MICRO: "小微服务商",
  LOGISTICS: "物流",
  SMART_SERVICE: "IT服务",
  LEGAL_SERVICE: "法律",
  IP_SERVICE: "知识产权",
  THINK_TANK_SERVICE: "智库",
  FLEX_WORK: "灵活用工",
  SUPPLY_NETWORK: "供销",
  MARKETING: "营销",
  ASSET_TRADE: "资产交易",
};

/**
 * 细项标签（供逐项审核展示）：跨境出海与营销服务同构，
 * code → 中文与 `@/lib/provider-categories` 同源（界面禁裸枚举）。
 */
export const SUBITEM_LABEL: Record<string, string> = SUBITEM_LABELS;

/** 逗号分隔细项 → 中文顿号连接。 */
export function subItemsText(value?: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => SUBITEM_LABEL[item] || item)
    .join("、");
}

/** demo fmtSize：资质附件大小。 */
export function fmtSize(size?: number) {
  if (!size) return "";
  return size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** 时间 / 日期：统一用 @/lib 共享实现，本模块只再导出供页签引用。 */
export { fmtTime, fmtDate };

/** 服务商管理：provider-applications 行按 userId 聚合为「一家服务商 + 多项资质」。 */
/* ---------- 取数 ---------- */

/** 平台管理后台页签统一取数（含 403「需要平台管理员」友好提示）。 */
export function useAdminData<T>(
  resource: string,
  load: (signal: AbortSignal) => Promise<T>,
  params: unknown = {},
) {
  const query = useBusinessQuery("admin", resource, params, load);
  return {
    data: query.data ?? null,
    loading: query.isPending,
    denied: query.error?.message || "",
    error: query.error,
    reload: async () => {
      await query.refetch();
    },
  };
}

/** 无管理员权限（403）时的友好提示：页面不崩，各页签仍可浏览表头。 */
export function PermissionNotice({ denied }: { denied: string }) {
  if (!denied) return null;
  return <Notice variant="error">{denied}</Notice>;
}
