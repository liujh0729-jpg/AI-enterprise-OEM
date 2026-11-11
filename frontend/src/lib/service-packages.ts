import { SUBITEM_LABELS } from "./provider-categories";

/**
 * 官方服务套餐共享文案与选项：板块名、可签约交付项（CONTRACT_CATEGORIES 口径）、
 * 交付状态 / 明细状态徽标。后台套餐表单与用户侧共享面板同源，避免两处枚举漂移。
 */

/** 卡片 / 详情统一交付声明（§二.5 商业模式）。 */
export const PLATFORM_DELIVERY_NOTICE = "本套餐由平台整合优质服务商完成交付";

/** 板块码（SERVICE_TYPES 的 11 个业务板块）→ 界面名。 */
export const BOARD_LABELS: Record<string, string> = {
  MARKETING: "营销服务",
  SUPPLY_NETWORK: "供销网络",
  EXPORT_REFUND: "跨境出海",
  FLEX_WORK: "灵活用工",
  LOGISTICS: "物流服务",
  SMART_SERVICE: "IT服务",
  IP_SERVICE: "知识产权服务",
  LEGAL_SERVICE: "法律服务",
  THINK_TANK_SERVICE: "智库服务",
  ASSET_TRADE: "资产交易",
  TAX_FINANCE: "财税工具",
};

export const BOARD_OPTIONS = Object.entries(BOARD_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function boardLabel(code: string | null | undefined) {
  const key = String(code || "");
  return BOARD_LABELS[key] || key;
}

/**
 * 交付项可选码（须落在后端 CONTRACT_CATEGORIES 内，否则无法主持发起签约）：
 * 出海 / 营销 / 物流 / IT服务 / 资产交易只在细项级签约，其余板块为整块类目。
 */
const SUBITEM_GROUPS: { board: string; label: string; codes: string[] }[] = [
  {
    board: "MARKETING",
    label: "营销服务",
    codes: [
      "INFLUENCER_VISIT",
      "LIVE_SELLING",
      "CONTENT_MARKETING",
      "GEO_OPTIMIZATION",
      "PRECISION_MARKETING",
      "PRIVATE_DOMAIN",
    ],
  },
  {
    board: "EXPORT_REFUND",
    label: "跨境出海",
    codes: [
      "EXPORT_REFUND",
      "COMPANY_REG",
      "SETTLEMENT",
      "TAX_COMPLIANCE",
      "QUALIFICATION",
      "BANK_ACCOUNT",
    ],
  },
  {
    board: "LOGISTICS",
    label: "物流服务",
    codes: ["DOMESTIC_LAND", "CROSS_BORDER_FORWARDER", "WAREHOUSING"],
  },
  {
    board: "SMART_SERVICE",
    label: "IT服务",
    codes: ["AI_DEPLOY", "SOFTWARE_DEV", "COMPUTE", "HARDWARE", "DATA_SERVICE"],
  },
  {
    board: "ASSET_TRADE",
    label: "资产交易",
    codes: [
      "REAL_ESTATE",
      "INSURANCE",
      "INVESTMENT",
      "NON_PERFORMING_ASSET",
      "AUTO_TRADE",
    ],
  },
];

const SINGLE_CODES: { board: string; code: string }[] = [
  { board: "TAX_FINANCE", code: "TAX_FINANCE" },
  { board: "LEGAL_SERVICE", code: "LEGAL_SERVICE" },
  { board: "IP_SERVICE", code: "IP_SERVICE" },
  { board: "THINK_TANK_SERVICE", code: "THINK_TANK_SERVICE" },
  { board: "FLEX_WORK", code: "FLEX_WORK" },
  { board: "SUPPLY_NETWORK", code: "SUPPLY_NETWORK" },
];

/** 交付项码 → 中文名（细项取 SUBITEM_LABELS，整块类目取板块名）。 */
export const DELIVERY_CODE_LABELS: Record<string, string> = {
  ...SUBITEM_LABELS,
  TAX_FINANCE: "企业财税服务",
  LEGAL_SERVICE: "法律服务",
  IP_SERVICE: "知识产权服务",
  THINK_TANK_SERVICE: "智库服务",
  FLEX_WORK: "灵活用工服务",
  SUPPLY_NETWORK: "供销服务",
};

export function deliveryCodeLabel(code: string | null | undefined) {
  const key = String(code || "");
  return DELIVERY_CODE_LABELS[key] || key;
}

/** 交付项下拉分组（后台套餐表单）。 */
export const DELIVERY_CODE_GROUPS = [
  ...SUBITEM_GROUPS.map((g) => ({
    label: g.label,
    options: g.codes.map((code) => ({
      value: code,
      label: SUBITEM_LABELS[code] || code,
    })),
  })),
  {
    label: "整块类目",
    options: SINGLE_CODES.map(({ code }) => ({
      value: code,
      label: DELIVERY_CODE_LABELS[code] || code,
    })),
  },
];

/** 订单交付状态（fulfillmentStatus）。 */
export const FULFILLMENT_STATUS: Record<
  string,
  { label: string; cls: string }
> = {
  PENDING_MATCH: { label: "待匹配", cls: "badge-sky" },
  SIGNING: { label: "签约中", cls: "badge-orange" },
  DELIVERED: { label: "已签约", cls: "badge-green" },
  CLOSED: { label: "已关闭", cls: "badge-gray" },
};

/** 交付明细实时状态（读关联签约）。 */
export const ITEM_STATE: Record<string, { label: string; cls: string }> = {
  PENDING_MATCH: { label: "待匹配服务商", cls: "badge-sky" },
  PENDING_INITIATE: { label: "待发起签约", cls: "badge-orange" },
  SIGNING: { label: "签约待确认", cls: "badge-orange" },
  ACTIVE: { label: "签约已生效", cls: "badge-green" },
  TERMINATED: { label: "已撤销/否决", cls: "badge-red" },
};