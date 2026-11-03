import type { ReactNode } from "react";
import { fmtTime } from "@/lib/datetime";
import { money } from "@/lib/money";
import { OVERSEAS_SUB_ITEMS } from "@/lib/provider-categories";

/**
 * 跨境出海服务商六项（service_type 枚举与后端 common/constants.ts 一致）。
 * 定义已并入 `lib/provider-categories`（名录分区与「更多」列表页同源，避免两处口径漂移）。
 */
export const OVERSEAS_SERVICES = OVERSEAS_SUB_ITEMS;

export type OverseasServiceType = (typeof OVERSEAS_SERVICES)[number]["type"];

export const OVERSEAS_SERVICE_MAP: Record<
  string,
  { type: string; name: string; icon: ReactNode; desc: string }
> = Object.fromEntries(OVERSEAS_SERVICES.map((item) => [item.type, item]));

/** 后端 /enterprise/overseas 行（Prisma 原样返回）。 */
export type OverseasClaimRow = {
  id: number;
  claimNo: string;
  contractId: number;
  enterpriseId: number;
  providerUserId: string;
  staffUserId: string;
  serviceType: string;
  title: string;
  amount: string | number;
  country: string;
  remark: string;
  status: string;
  /** 企业侧联系方式（系统按企业档案带出，临时换人可改） */
  contactName?: string;
  contactPhone?: string;
  /** 执行侧联系方式（承办服务商/职员） */
  providerContactName?: string;
  providerContactPhone?: string;
  createdAt: string;
  updatedAt: string;
};

/** 后端 /enterprise/overseas/catalog 行（已备案出海服务商）+ display_name/items。 */
export type OverseasProvider = import('@enterprise/contracts').z.infer<typeof import('@enterprise/contracts').overseasProviderSchema>;

/** 后端 /enterprise/contracts 行（用于签约状态与名称回填）。 */
export type OverseasContractRow = {
  id: number;
  contractNo: string;
  enterpriseId: number;
  enterpriseName: string;
  providerUserId: string;
  provider_name?: string;
  providerOrg?: string;
  serviceType: string;
  status: string;
  /** 承办人：服务商指定的「出口退税专员」（未指派时为 null） */
  designatedStaff?: {
    name?: string;
    phone?: string;
    title?: string;
    email?: string;
  } | null;
};

export type SignState = {
  providerUserId: string;
  orgName: string;
  serviceType: string;
  serviceName: string;
  locked: boolean;
  lockedProviderName: string;
  contractNo: string;
  contractStatus: string;
};

/** 取数回退 / 时间 / 金额：统一用 @/lib 共享实现，本模块只再导出供页签引用。 */
export { fmtTime, money };

export function serviceNameOf(type: string): string {
  return OVERSEAS_SERVICE_MAP[type]?.name || type || "—";
}

/** 服务商是否提供某类出海服务（细项为空 = 承接全部出海服务）。 */
export function providerSupports(
  provider: OverseasProvider,
  type: string,
): boolean {
  // 出海必须申请到「细项」：未申请细项的服务商不出现在任何子功能分区
  const items = provider.items || [];
  return items.includes(type);
}

export type ProviderSignStatus = {
  status: "ACTIVE" | "PENDING" | "NONE";
  label: string;
  variant: string;
  locked: boolean;
  lockedProviderName: string;
  contractNo: string;
};

/**
 * 分类签约状态（对齐 demo /api/refunds/providers 的 contract_status / category_locked）：
 * 由 /enterprise/overseas/catalog + /enterprise/contracts 现算，不臆造接口。
 */
export function providerSignStatus(
  provider: OverseasProvider,
  type: string,
  contracts: OverseasContractRow[],
): ProviderSignStatus {
  const scoped = contracts.filter((item) => item.serviceType === type);
  const mine = scoped.find(
    (item) => item.providerUserId === provider.userId,
  );
  const other = scoped.find(
    (item) => item.status === "ACTIVE" && item.providerUserId !== provider.userId,
  );
  if (mine?.status === "ACTIVE") {
    return {
      status: "ACTIVE",
      label: "已签约",
      variant: "badge-green",
      locked: false,
      lockedProviderName: "",
      contractNo: mine.contractNo,
    };
  }
  if (other) {
    return {
      status: mine ? "PENDING" : "NONE",
      label: "分类已签",
      variant: "badge-gray",
      locked: true,
      lockedProviderName:
        other.providerOrg || other.provider_name || "其他服务商",
      contractNo: mine?.contractNo || "",
    };
  }
  if (mine) {
    return {
      status: "PENDING",
      label: "签约待确认",
      variant: "badge-orange",
      locked: false,
      lockedProviderName: "",
      contractNo: mine.contractNo,
    };
  }
  return {
    status: "NONE",
    label: "可签约",
    variant: "badge-gray",
    locked: false,
    lockedProviderName: "",
    contractNo: "",
  };
}
/** 服务商已绑定职员（用于把承办职员 id 显示成姓名）。 */
export type { ProviderStaffOption } from "@/app/contracts/_components/contract-dialogs";
