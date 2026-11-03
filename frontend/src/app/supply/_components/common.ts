import { contactText } from "@/lib/contacts";
import { fmtTime } from "@/lib/datetime";
import { money } from "@/lib/money";
import { statusOptions } from "@/lib/status";

/** 后端 /enterprise/supply/stations 行。 */
export type SupplyStation = {
  id: number;
  providerUserId: string;
  name: string;
  region: string;
  address: string;
  contactName: string;
  contactPhone: string;
  status: string;
  remark: string;
  productCount?: number;
  serviceCount?: number;
  createdAt: string;
};

/** 商品 SKU（规格：独立供货价 / 单位 / 适配场景）。 */
export type SupplySku = {
  id: number;
  productId: number;
  specName: string;
  supplyPrice: string | number;
  unit: string;
  scene: string;
  status: string;
};

/** 商品可售站点（站点维度独立上下架）。 */
export type SupplyProductStation = {
  id: number;
  productId: number;
  stationId: number;
  status: string;
  stationName?: string;
};

/** 后端 /enterprise/supply/products 行（SPU + 规格 + 站点归属）。 */
export type SupplyProduct = {
  id: number;
  providerUserId: string;
  providerName?: string;
  name: string;
  category: string;
  basePrice: string | number;
  unit: string;
  attrs: { name?: string; value?: string }[];
  status: string;
  marketingTitle: string;
  marketingSummary: string;
  marketingContent: string;
  coverUrl: string;
  featured: boolean;
  aiworkinListingId: string;
  skus?: SupplySku[];
  stations?: SupplyProductStation[];
  createdAt: string;
};

/** 后端 /enterprise/supply/services 行（线下服务项目，必须绑定站点）。 */
export type SupplyService = {
  id: number;
  providerUserId: string;
  providerName?: string;
  stationId: number;
  stationName?: string;
  name: string;
  priceUnit: string;
  basePrice: string | number;
  intro: string;
  scene: string;
  status: string;
  marketingTitle: string;
  marketingSummary: string;
  marketingContent: string;
  coverUrl: string;
  featured: boolean;
  aiworkinListingId: string;
  createdAt: string;
};

/** 订货明细（报价时可微调价格/数量并标注缺货）。 */
export type SupplyOrderItem = {
  id: number;
  orderId: number;
  productId: number;
  skuId: number;
  productName: string;
  specName: string;
  unit: string;
  price: string | number;
  quantity: string | number;
  amount: string | number;
  stockState: string;
  shortageNote: string;
  restockCycle: string;
};

/** 其他费用条目（正数增收 / 负数减免）。 */
export type SupplyFeeEntry = { name?: string; amount?: number | string; note?: string };

/** 后端 /enterprise/supply/orders 行（订货单）。 */
export type SupplyOrder = {
  id: number;
  orderNo: string;
  enterpriseId: number;
  enterpriseName: string;
  createdBy: string;
  providerUserId: string;
  providerName?: string;
  staffUserId: string;
  staffName?: string;
  stationId: number;
  stationName: string;
  /** 订货联系人（企业侧，下单必填） */
  contactName: string;
  contactPhone: string;
  expectedDate: string;
  remark: string;
  status: string;
  revision: number;
  quotedAt?: string | null;
  promisedShipDate: string;
  quoteNote: string;
  /** 报价联系人（服务商/承办职员，报价必填） */
  providerContactName: string;
  providerContactPhone: string;
  productAmount: string | number;
  otherFees: SupplyFeeEntry[];
  feeAmount: string | number;
  totalAmount: string | number;
  confirmNote: string;
  confirmedAt?: string | null;
  items?: SupplyOrderItem[];
  createdAt: string;
};

/** 后端 /enterprise/supply/bookings 行（线下服务预约单）。 */
export type SupplyBooking = {
  id: number;
  bookingNo: string;
  enterpriseId: number;
  enterpriseName: string;
  createdBy: string;
  providerUserId: string;
  providerName?: string;
  staffUserId: string;
  staffName?: string;
  stationId: number;
  stationName: string;
  serviceId: number;
  serviceName: string;
  priceUnit: string;
  /** 预约联系人（企业侧，下单必填） */
  contactName: string;
  contactPhone: string;
  planDate: string;
  siteAddress: string;
  scale: string;
  remark: string;
  status: string;
  revision: number;
  quotedAt?: string | null;
  baseAmount: string | number;
  otherFees: SupplyFeeEntry[];
  feeAmount: string | number;
  totalAmount: string | number;
  quoteNote: string;
  /** 报价联系人（服务商/承办职员，报价必填） */
  providerContactName: string;
  providerContactPhone: string;
  confirmNote: string;
  confirmedAt?: string | null;
  createdAt: string;
};

/** 操作留痕（提交/报价/确认/驳回/修改）。 */
export type SupplyOrderLog = {
  id: number;
  bizType: string;
  bizId: number;
  action: string;
  operatorUserId: string;
  operatorName: string;
  detail: string;
  createdAt: string;
};

/** 后端 /enterprise/supply/admin/overview（平台监管：单据总览 + 站点统计）。 */
export type SupplyAdminOverview = {
  orders: SupplyOrder[];
  bookings: SupplyBooking[];
  station_stats: {
    station_id: number;
    station_name: string;
    provider_user_id: string;
    region: string;
    status: string;
    order_count: number;
    booking_count: number;
    product_count: number;
  }[];
  totals: {
    orders: number;
    bookings: number;
    stations: number;
    products: number;
    services: number;
  };
};

/** /enterprise/contracts 行（取服务商机构名用）。 */
export type SupplyContract = {
  providerUserId?: string;
  providerOrg?: string;
  provider_name?: string;
  serviceType?: string;
  status?: string;
};

/**
 * 服务商展示名：优先签约里的机构名（后端未在单据里回传机构名，只有 userId）；
 * 没有签约行可查时（如本机构账号自己看）回退到登录账号的显示名。
 */
export function providerLabel(
  contracts: SupplyContract[],
  userId: string,
  selfUserId = "",
  selfName = "",
): string {
  if (!userId) return "—";
  const hit = contracts.find((item) => item.providerUserId === userId);
  if (hit?.providerOrg) return hit.providerOrg;
  if (hit?.provider_name) return hit.provider_name;
  if (userId === selfUserId && selfName) return selfName;
  return userId;
}

/** 承办职员展示名（单据只回传 staffUserId；这里按当前登录人回退）。 */
export function staffLabel(
  userId: string,
  selfUserId = "",
  selfName = "",
): string {
  if (!userId) return "待指派";
  return userId === selfUserId && selfName ? selfName : userId;
}

/** 报价联系人文案：尚在报价环节显示「待报价」，历史单据未留存显示「—」。 */
export function providerContactText(row: {
  status: string;
  providerContactName?: string | null;
  providerContactPhone?: string | null;
}): string {
  const text = contactText(
    row.providerContactName,
    row.providerContactPhone,
    "",
  );
  if (text) return text;
  return ["DRAFT", "SUBMITTED", "RETURNED"].includes(row.status)
    ? "待报价"
    : "—";
}

export function orderItemText(items: SupplyOrderItem[] | undefined): string {
  if (!items?.length) return "—";
  return items
    .map(
      (item) =>
        `${item.productName}${item.specName ? `（${item.specName}）` : ""} × ${item.quantity}${item.unit || ""}`,
    )
    .join("；");
}

/** 缺货提示（需求 §四.3：单品标注缺货情况 + 原因 + 补货周期）。 */
export function stockText(item: SupplyOrderItem): string {
  const state = STOCK_STATE_OPTIONS.find((entry) => entry.value === item.stockState);
  if (!item.stockState || item.stockState === "SUFFICIENT") {
    return state?.label || "库存充足";
  }
  const parts = [state?.label || item.stockState];
  if (item.shortageNote) parts.push(item.shortageNote);
  if (item.restockCycle) parts.push(`补货周期 ${item.restockCycle}`);
  return parts.join(" · ");
}

/** 订货单状态（文案唯一来源：lib/status 的 DOMAIN_STATUS.supply）。 */
export const SUPPLY_STATUS_OPTIONS = statusOptions("supply");

/**
 * 企业侧报价处置动作（桌面端与 H5 共用一套文案）：
 * confirm / return / veto / cancel 对应 `POST /enterprise/supply/orders/:id/<action>`。
 */
export type SupplyNoteAction = "confirm" | "return" | "veto" | "cancel";

export const SUPPLY_NOTE_TEXT: Record<
  SupplyNoteAction,
  {
    title: string;
    label: string;
    tip: string;
    okText: string;
    success: string;
    danger: boolean;
    requireNote: boolean;
  }
> = {
  confirm: {
    title: "确认报价 · 订单生效",
    label: "确认备注",
    tip: "确认后订单生效，进入履约；如需变更请与服务商另行约定。",
    okText: "确认报价",
    success: "已确认报价，订单生效",
    danger: false,
    requireNote: false,
  },
  return: {
    title: "驳回报价 · 退回服务商重新报价",
    label: "驳回原因",
    tip: "驳回后服务商可二次修改报价（价格/缺货说明/其他费用）再提交。",
    okText: "确认驳回",
    success: "已驳回，退回服务商重新报价",
    danger: false,
    requireNote: false,
  },
  veto: {
    title: "否决订货单",
    label: "否决原因",
    tip: "否决后订单终止流转，不可再报价；如需继续采购请重新下单。",
    okText: "确认否决",
    success: "已否决该订货单",
    danger: true,
    requireNote: true,
  },
  cancel: {
    title: "取消订货单",
    label: "取消原因",
    tip: "取消后订单终止流转；草稿可直接删除。",
    okText: "确认取消",
    success: "已取消该订货单",
    danger: true,
    requireNote: true,
  },
};

/** 缺货情况说明（需求 §四.3）。 */
export const STOCK_STATE_OPTIONS = statusOptions("supplyStock");

export function supplyStatusLabel(value: unknown): string {
  return (
    SUPPLY_STATUS_OPTIONS.find((item) => item.value === value)?.label ||
    String(value || "—")
  );
}

/** 取数回退 / 时间 / 金额：统一用 @/lib 共享实现，本模块只再导出供页签引用。 */
export { fmtTime, money };

/** 其他费用科目汇总文案（正数增收 / 负数减免，需求 §四.2）。 */
export function feeText(fees: SupplyFeeEntry[] | undefined): string {
  if (!Array.isArray(fees) || !fees.length) return "—";
  return fees
    .map((item) => `${item.name || "费用"} ${Number(item.amount || 0) >= 0 ? "+" : ""}${money(item.amount)}`)
    .join("；");
}

/** 商品属性文案（[{name,value}]）。 */
export function attrText(attrs: SupplyProduct["attrs"] | undefined): string {
  if (!Array.isArray(attrs) || !attrs.length) return "—";
  return attrs
    .filter((item) => item?.name)
    .map((item) => `${item.name}：${item.value || "—"}`)
    .join("；");
}

export function toDateText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const asFormat = value as { format?: (pattern: string) => string };
  return typeof asFormat.format === "function"
    ? asFormat.format("YYYY-MM-DD")
    : "";
}
