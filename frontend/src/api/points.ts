import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 积分与充值：开源版本地接口（未纳入 contracts 生成表），与 platformApi 同模式，
 * 底层 http() + 轻量 zod 描述信封 data。
 */

export interface RechargeTier {
  cents: number;
  bonusPercent: number;
}

export interface PointsSettings {
  rate: number;
  rechargeMinCents: number;
  rechargeTiers: RechargeTier[];
  signupBonus: number;
  inviteRewardSignup: number;
  inviteRechargePercent: number;
  inviteRechargeCap: number;
  inviteDailyCount: number;
  rewardDailyCap: number;
  transferEnabled: boolean;
  transferMin: number;
  transferDailyCount: number;
  transferDailyPoints: number;
  transferFeePercent: number;
  arrearsGraceDays: number;
  spendDailyCap: number;
  wechatConfigured: boolean;
  wechatNotifyUrl: string;
  wechatAppId: string;
  wechatMchId: string;
}

export interface PricingRow {
  code: string;
  mode: string;
  unit: string;
  unitPriceAmount: number;
  freeQuotaAmount: number;
  minChargeAmount: number;
  enabled: boolean;
}

export interface PointsAccountRow {
  userId: string;
  username: string;
  inviteCode: string;
  balance: number;
  totalRecharge: number;
  totalEarn: number;
  totalSpend: number;
  status: string;
}

export interface PointTxRow {
  id: number;
  type: string;
  scene: string;
  amount: number;
  balanceAmount: number;
  counterparty: string;
  refType: string;
  refId: string;
  remark: string;
  createdAt: string;
}

export interface RechargeOrderRow {
  orderNo: string;
  userId: string;
  username: string;
  amountCents: number;
  pointsAmount: number;
  bonusPointsAmount: number;
  status: string;
  transactionId: string;
  createdAt: string;
  paidAt?: string | null;
}

export interface PageData<T> {
  total: number;
  page: number;
  size: number;
  list: T[];
}

export interface UsageEventRow {
  id: number;
  userId: string;
  code: string;
  quantityAmount: number;
  billed: boolean;
  occurredAt: string;
  remark: string;
  module: string;
  operation: string;
  model: string;
  tokenInAmount: number;
  tokenOutAmount: number;
  pointsAmount: number;
}

/** 统一 AI 用量事实的汇总行（按板块 + 科目）。 */
export interface AiUsageModuleRow {
  module: string;
  code: string;
  calls: number;
  quantityAmount: number;
  tokenInAmount: number;
  tokenOutAmount: number;
  pointsAmount: number;
}

export interface AiUsageSummary {
  from: string;
  to: string;
  modules: AiUsageModuleRow[];
  insights: { scope: string; count: number }[];
  totals: {
    calls: number;
    tokenInAmount: number;
    tokenOutAmount: number;
    pointsAmount: number;
    insightCount: number;
  };
}

const tierSchema = z.object({ cents: z.number(), bonusPercent: z.number() });
const settingsSchema = apiEnvelope(
  z.object({
    rate: z.number(),
    rechargeMinCents: z.number(),
    rechargeTiers: z.array(tierSchema),
    signupBonus: z.number(),
    inviteRewardSignup: z.number(),
    inviteRechargePercent: z.number(),
    inviteRechargeCap: z.number(),
    inviteDailyCount: z.number(),
    rewardDailyCap: z.number(),
    transferEnabled: z.boolean(),
    transferMin: z.number(),
    transferDailyCount: z.number(),
    transferDailyPoints: z.number(),
    transferFeePercent: z.number(),
    arrearsGraceDays: z.number(),
    spendDailyCap: z.number(),
    wechatConfigured: z.boolean(),
    wechatNotifyUrl: z.string(),
    wechatAppId: z.string(),
    wechatMchId: z.string(),
  }),
);
const pricingRowZod = z.object({
  code: z.string(),
  mode: z.string(),
  unit: z.string(),
  unitPriceAmount: z.number(),
  freeQuotaAmount: z.number(),
  minChargeAmount: z.number(),
  enabled: z.boolean(),
});
const pricingSchema = apiEnvelope(pricingRowZod);
const pricingListSchema = apiEnvelope(z.array(pricingRowZod));
const accountRowZod = z.object({
  userId: z.string(),
  username: z.string(),
  inviteCode: z.string(),
  balance: z.number(),
  totalRecharge: z.number(),
  totalEarn: z.number(),
  totalSpend: z.number(),
  status: z.string(),
});
const accountsSchema = apiEnvelope(
  z.object({ list: z.array(accountRowZod), total: z.number() }),
);
const txRowZod = z.object({
  id: z.number(),
  type: z.string(),
  scene: z.string(),
  amount: z.number(),
  balanceAmount: z.number(),
  counterparty: z.string(),
  refType: z.string(),
  refId: z.string(),
  remark: z.string(),
  createdAt: z.string(),
});
const txPageSchema = apiEnvelope(
  z.object({
    total: z.number(),
    page: z.number(),
    size: z.number(),
    list: z.array(txRowZod),
  }),
);
const orderRowZod = z.object({
  orderNo: z.string(),
  userId: z.string(),
  username: z.string(),
  amountCents: z.number(),
  pointsAmount: z.number(),
  bonusPointsAmount: z.number(),
  status: z.string(),
  transactionId: z.string(),
  createdAt: z.string(),
  paidAt: z.string().nullish(),
});
const ordersSchema = apiEnvelope(
  z.object({
    total: z.number(),
    page: z.number(),
    size: z.number(),
    list: z.array(orderRowZod),
  }),
);
const usagePageSchema = apiEnvelope(
  z.object({
    total: z.number(),
    page: z.number(),
    size: z.number(),
    list: z.array(
      z.object({
        id: z.number(),
        userId: z.string(),
        code: z.string(),
        quantityAmount: z.number(),
        billed: z.boolean(),
        occurredAt: z.string(),
        remark: z.string(),
        module: z.string(),
        operation: z.string(),
        model: z.string(),
        tokenInAmount: z.number(),
        tokenOutAmount: z.number(),
        pointsAmount: z.number(),
      }),
    ),
  }),
);
const aiUsageSummarySchema = apiEnvelope(
  z.object({
    from: z.string(),
    to: z.string(),
    modules: z.array(
      z.object({
        module: z.string(),
        code: z.string(),
        calls: z.number(),
        quantityAmount: z.number(),
        tokenInAmount: z.number(),
        tokenOutAmount: z.number(),
        pointsAmount: z.number(),
      }),
    ),
    insights: z.array(z.object({ scope: z.string(), count: z.number() })),
    totals: z.object({
      calls: z.number(),
      tokenInAmount: z.number(),
      tokenOutAmount: z.number(),
      pointsAmount: z.number(),
      insightCount: z.number(),
    }),
  }),
);
const summarySchema = apiEnvelope(
  z.object({
    points: z.object({
      balance: z.number(),
      totalRecharge: z.number(),
      totalEarn: z.number(),
      totalSpend: z.number(),
      status: z.string(),
      arrearsSince: z.string().nullish(),
    }),
    awcoin: z.object({
      value: z.number().nullish(),
      source: z.string(),
    }),
  }),
);
const adjustSchema = apiEnvelope(
  z.object({ balance: z.number(), txId: z.number() }),
);

const userOrdersSchema = apiEnvelope(
  z.object({
    total: z.number(),
    page: z.number(),
    size: z.number(),
    list: z.array(
      z.object({
        orderNo: z.string(),
        amountCents: z.number(),
        pointsAmount: z.number(),
        bonusPointsAmount: z.number(),
        status: z.string(),
        channel: z.string(),
        createdAt: z.string(),
        paidAt: z.string().nullish(),
      }),
    ),
  }),
);

async function unwrap<T>(
  schema: z.ZodType<{ code: number; message: string; data: T | null }>,
  path: string,
  options: HttpOptions = {},
): Promise<T> {
  const result = await http(path, schema, options);
  return result.data.data as T;
}

const ADMIN = "/api/backend/enterprise/admin/points";
const USER = "/api/backend/enterprise/points";

/** 平台管理后台「积分与充值」。 */
export const pointsAdminApi = {
  settings: (options?: HttpOptions) =>
    unwrap(settingsSchema, `${ADMIN}/settings`, options),
  saveSettings: (body: Record<string, unknown>, options?: HttpOptions) =>
    unwrap(settingsSchema, `${ADMIN}/settings`, {
      ...options,
      method: "PUT",
      body,
    }),
  saveWechat: (
    body: {
      appId?: string;
      mchId?: string;
      apiv3Key?: string;
      certSerial?: string;
      privateKey?: string;
      notifyUrl?: string;
    },
    options?: HttpOptions,
  ) =>
    unwrap(
      apiEnvelope(z.object({ wechatConfigured: z.boolean() })),
      `${ADMIN}/wechat`,
      { ...options, method: "PUT", body },
    ),
  testWechat: (options?: HttpOptions) =>
    unwrap(apiEnvelope(z.unknown()), `${ADMIN}/wechat/test`, {
      ...options,
      method: "POST",
    }),
  pricing: (options?: HttpOptions) =>
    unwrap(pricingListSchema, `${ADMIN}/pricing`, options),
  updatePricing: (
    code: string,
    body: Partial<{
      mode: string;
      unit: string;
      unitPriceAmount: number;
      freeQuotaAmount: number;
      minChargeAmount: number;
      enabled: boolean;
    }>,
    options?: HttpOptions,
  ) =>
    unwrap(pricingSchema, `${ADMIN}/pricing/${encodeURIComponent(code)}`, {
      ...options,
      method: "PUT",
      body,
    }),
  usage: (
    query: {
      code?: string;
      module?: string;
      userId?: string;
      from?: string;
      to?: string;
      page?: number;
      size?: number;
    } = {},
    options?: HttpOptions,
  ) => unwrap(usagePageSchema, `${ADMIN}/usage`, { ...options, query }),
  /** 统一 AI 用量汇总：每个板块花了多少 token / 积分（§4.4）。 */
  aiUsageSummary: (
    query: { userId?: string; from?: string; to?: string } = {},
    options?: HttpOptions,
  ) =>
    unwrap(aiUsageSummarySchema, `${ADMIN}/usage/summary`, {
      ...options,
      query,
    }),
  accounts: (
    query: { keyword?: string; page?: number; size?: number } = {},
    options?: HttpOptions,
  ) => unwrap(accountsSchema, `${ADMIN}/accounts`, { ...options, query }),
  transactions: (
    userId: string,
    query: { page?: number; size?: number } = {},
    options?: HttpOptions,
  ) =>
    unwrap(txPageSchema, `${ADMIN}/transactions/${encodeURIComponent(userId)}`, {
      ...options,
      query,
    }),
  adjust: (
    body: { userId: string; delta: number; remark?: string },
    options?: HttpOptions,
  ) =>
    unwrap(adjustSchema, `${ADMIN}/adjust`, {
      ...options,
      method: "POST",
      body,
    }),
  orders: (
    query: { status?: string; keyword?: string; page?: number; size?: number } = {},
    options?: HttpOptions,
  ) => unwrap(ordersSchema, `${ADMIN}/orders`, { ...options, query }),
};

/** 用户「积分中心」：余额/流水/赠送/充值。 */
export const pointsApi = {
  summary: (options?: HttpOptions) =>
    unwrap(summarySchema, `${USER}/summary`, options),
  transactions: (
    query: { page?: number; size?: number; type?: string; scene?: string } = {},
    options?: HttpOptions,
  ) => unwrap(txPageSchema, `${USER}/transactions`, { ...options, query }),
  /** 本人各板块的 AI 用量（token / 积分），与后台读同一张用量事实。 */
  aiUsage: (
    query: { from?: string; to?: string } = {},
    options?: HttpOptions,
  ) => unwrap(aiUsageSummarySchema, `${USER}/ai-usage`, { ...options, query }),
  settings: (options?: HttpOptions) =>
    unwrap(
      apiEnvelope(
        z.object({
          rate: z.number(),
          rechargeMinCents: z.number(),
          rechargeTiers: z.array(tierSchema),
          wechatConfigured: z.boolean(),
          transferEnabled: z.boolean(),
          transferMin: z.number(),
          transferFeePercent: z.number(),
        }),
      ),
      `${USER}/settings`,
      options,
    ),
  transferPreview: (body: { to: string }, options?: HttpOptions) =>
    unwrap(
      apiEnvelope(
        z.object({
          exists: z.boolean(),
          displayName: z.string(),
          userId: z.string(),
          transferMin: z.number(),
          feePercent: z.number(),
        }),
      ),
      `${USER}/transfer/preview`,
      { ...options, method: "POST", body },
    ),
  transfer: (
    body: { to: string; amount: number },
    options?: HttpOptions,
  ) =>
    unwrap(
      apiEnvelope(
        z.object({
          sent: z.number(),
          received: z.number(),
          fee: z.number(),
          fromBalance: z.number(),
          toBalance: z.number(),
          toUsername: z.string(),
        }),
      ),
      `${USER}/transfer`,
      { ...options, method: "POST", body },
    ),
  rechargeCreate: (
    body: {
      amountCents?: number;
      tierIndex?: number;
      channel?: "NATIVE" | "H5";
    },
    options?: HttpOptions,
  ) =>
    unwrap(
      apiEnvelope(
        z.object({
          orderNo: z.string(),
          amountCents: z.number(),
          pointsAmount: z.number(),
          bonusPointsAmount: z.number(),
          channel: z.string(),
          codeUrl: z.string().optional(),
          h5Url: z.string().optional(),
        }),
      ),
      `${USER}/recharge/create`,
      { ...options, method: "POST", body },
    ),
  rechargeQuery: (orderNo: string, options?: HttpOptions) =>
    unwrap(
      apiEnvelope(
        z.object({
          orderNo: z.string(),
          status: z.string(),
          pointsAmount: z.number(),
          bonusPointsAmount: z.number(),
          paidAt: z.string().nullish(),
        }),
      ),
      `${USER}/recharge/query/${encodeURIComponent(orderNo)}`,
      options,
    ),
  rechargeOrders: (
    query: { page?: number; size?: number } = {},
    options?: HttpOptions,
  ) => unwrap(userOrdersSchema, `${USER}/recharge/orders`, { ...options, query }),
};

/** 公开充值参数（SSR/首屏，不含商户敏感项）。 */
export const pointsPublicApi = {
  config: (options?: HttpOptions) =>
    unwrap(
      apiEnvelope(
        z.object({
          rate: z.number(),
          rechargeMinCents: z.number(),
          rechargeTiers: z.array(tierSchema),
          wechatConfigured: z.boolean(),
          transferEnabled: z.boolean(),
          transferMin: z.number(),
          // 邀请奖励（0 = 未开启）：/invite 页展示「邀请可得多少积分」
          signupBonus: z.number().default(0),
          inviteRewardSignup: z.number().default(0),
          inviteRechargePercent: z.number().default(0),
          inviteRechargeCap: z.number().default(0),
          inviteDailyCount: z.number().default(0),
        }),
      ),
      "/api/points-config",
      options,
    ),
};

export type PointsSummary = Awaited<ReturnType<typeof pointsApi.summary>>;
export type UserPointsSettings = Awaited<ReturnType<typeof pointsApi.settings>>;