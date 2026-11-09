import { contractsApi } from "./contracts";
import { taxApi } from "./tax";
import { overseasApi } from "./overseas";
import { logisticsApi } from "./logistics";
import { smartServiceApi } from "./smart-service";
import { marketingApi } from "./marketing";
import { supplyApi } from "./supply";
import { assetApi } from "./asset";
import { legalApi } from "./legal";
import { ipApi } from "./ip";
import { flexApi } from "./flex";
import { identityApi } from "./identity";
import { adminApi } from "./admin";

export const dashboardStats = {
  declarations: taxApi.declarationStats,
  overseas: overseasApi.claimStats,
  logistics: logisticsApi.stats,
  smart: smartServiceApi.stats,
  marketing: marketingApi.stats,
  supplyOrders: supplyApi.orderStats,
  supplyBookings: supplyApi.bookingStats,
  asset: assetApi.stats,
  legal: legalApi.stats,
  ip: ipApi.stats,
  flexWo: flexApi.stats,
  onboardings: flexApi.onboardingStats,
};
export type DashboardStatistic = keyof typeof dashboardStats;

export const dashboardApi = {
  async statistic(key: DashboardStatistic, signal: AbortSignal) {
    const result = await dashboardStats[key]({}, { signal });
    if (!result) throw new Error("统计数据暂不可用，请重试");
    return result;
  },
  async overview(identity: string, signal: AbortSignal) {
    const options = { signal };
    // 职员首页没有签约统计；管理员只需要平台统计。
    const [contractStats, stats] = await Promise.all([
      identity === "ENTERPRISE_USER" || identity === "SERVICE_PROVIDER"
        ? contractsApi.stats({}, options)
        : Promise.resolve(null),
      identity === "PLATFORM_ADMIN"
        ? adminApi.stats({}, options)
        : Promise.resolve(null),
    ]);
    return { contractStats, stats };
  },
  async team(identity: string, signal: AbortSignal) {
    const options = { signal };
    const [serves, myWork, applications] = await Promise.all([
      identity === "SERVICE_PROVIDER"
        ? contractsApi.enterprises({}, options)
        : Promise.resolve([]),
      identity === "PROVIDER_STAFF"
        ? identityApi.myWork({}, options)
        : Promise.resolve(null),
      identity === "PROVIDER_STAFF"
        ? identityApi.myAffiliations({}, options)
        : Promise.resolve([]),
    ]);
    // 挂靠列表已经包含机构邀请，复用同一快照，避免重复读取与装饰。
    return {
      serves: serves || [],
      myWork,
      invitations: (applications || []).filter((row) => row.direction === "PROVIDER_INVITE" && row.status === "PENDING"),
      affiliations: (applications || []).filter((row) => row.direction !== "PROVIDER_INVITE"),
    };
  },
};
