import type { DashboardStatistic } from "@/api/dashboard";
import type { EnterpriseMe } from "./session";
import { DOMAIN_TYPES, isDomainOpened, openedTypes } from "./provider-categories";
import { isPersonalSubject } from "./subject";

const STATISTIC_DOMAIN: Record<DashboardStatistic, string> = {
  declarations: "tax",
  overseas: "overseas",
  logistics: "logistics",
  smart: "smart",
  marketing: "marketing",
  supplyOrders: "supply",
  supplyBookings: "supply",
  asset: "asset",
  legal: "legal",
  ip: "ip",
  flexWo: "flex",
  onboardings: "flex",
};

/** 请求、待办卡片和合计使用同一可见范围；管理员切换业务身份保留全部类目。 */
export function dashboardScope(me: EnterpriseMe | null) {
  const identity = me?.currentIdentity || "";
  const opened = openedTypes(me, identity);
  const personal = identity === "ENTERPRISE_USER" &&
    !me?.identities.includes("PLATFORM_ADMIN") && isPersonalSubject(me?.enterprise?.subjectType);
  const domains = Object.keys(DOMAIN_TYPES).filter((domain) =>
    !!me && identity !== "PLATFORM_ADMIN" && isDomainOpened(opened, domain) &&
    !(personal && (domain === "tax" || domain === "overseas")),
  );
  const statistics = (Object.keys(STATISTIC_DOMAIN) as DashboardStatistic[]).filter((key) =>
    domains.includes(STATISTIC_DOMAIN[key]) && !(identity === "ENTERPRISE_USER" && key === "onboardings"),
  );
  return { identity, domains, statistics };
}
