import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 官方服务套餐：开源版本地接口（未纳入 contracts 生成表），与 pointsApi 同模式，
 * 底层 http() + 轻量 zod 描述信封 data。套餐＝平台整合优质服务商的一揽子交付，
 * 积分价按官方汇率实时换算、购买时快照；购买后平台主持企业与多家服务商签约兑现。
 */

const deliveryPreviewZod = z.object({
  code: z.string(),
  label: z.string(),
  providerOrg: z.string(),
});
const deliveryConfigZod = z.object({
  code: z.string(),
  label: z.string(),
  providerUserId: z.string(),
  providerOrg: z.string(),
});
const packageRowZod = z.object({
  id: z.number(),
  serviceType: z.string(),
  name: z.string(),
  description: z.string(),
  priceCents: z.number(),
  price: z.number(),
  pointsPrice: z.number(),
  unit: z.string(),
  features: z.array(z.string()),
  deliveryItems: z.array(deliveryPreviewZod),
  deliveryDesc: z.string(),
  autoInitiate: z.boolean(),
  taxpayerType: z.string().nullish(),
  perEnterpriseLimit: z.number(),
  status: z.string(),
  sortOrder: z.number(),
  purchased: z.boolean().optional(),
  deliveryConfig: z.array(deliveryConfigZod).optional(),
});
const packageListSchema = apiEnvelope(
  z.object({ rate: z.number(), list: z.array(packageRowZod) }),
);

const orderItemZod = z.object({
  id: z.number(),
  code: z.string(),
  label: z.string(),
  providerUserId: z.string(),
  providerOrg: z.string(),
  providerName: z.string(),
  contractId: z.number(),
  contractNo: z.string(),
  contractStatus: z.string(),
  state: z.string(),
  pendingHours: z.number(),
});
const orderRowZod = z.object({
  id: z.number(),
  orderNo: z.string(),
  userId: z.string(),
  enterpriseId: z.number(),
  enterpriseName: z.string(),
  packageId: z.number(),
  packageName: z.string(),
  serviceType: z.string(),
  priceCents: z.number(),
  rate: z.number(),
  pointsAmount: z.number(),
  refundedPointsAmount: z.number(),
  refundableAmount: z.number(),
  status: z.string(),
  fulfillmentStatus: z.string(),
  createdAt: z.string(),
  items: z.array(orderItemZod),
});
const ordersPageSchema = apiEnvelope(
  z.object({
    total: z.number(),
    page: z.number(),
    size: z.number(),
    list: z.array(orderRowZod),
  }),
);
const myOrdersSchema = apiEnvelope(z.array(orderRowZod));
const orderDetailSchema = apiEnvelope(orderRowZod);

const quoteSchema = apiEnvelope(
  z.object({
    packageId: z.number(),
    name: z.string(),
    priceCents: z.number(),
    price: z.number(),
    pointsPrice: z.number(),
    rate: z.number(),
    balance: z.number(),
    sufficient: z.boolean(),
    hasEnterprise: z.boolean(),
    enterpriseId: z.number(),
    bought: z.number(),
    perEnterpriseLimit: z.number(),
    limitReached: z.boolean(),
    deliveryDesc: z.string(),
  }),
);
const purchaseSchema = apiEnvelope(
  z.object({
    orderId: z.number(),
    orderNo: z.string(),
    pointsAmount: z.number(),
    balance: z.number(),
    fulfillmentStatus: z.string(),
  }),
);
const candidateZod = z.object({
  providerUserId: z.string(),
  orgName: z.string(),
  displayName: z.string(),
  province: z.string(),
  city: z.string(),
});
const candidatesSchema = apiEnvelope(z.array(candidateZod));

async function unwrap<T>(
  schema: z.ZodType<{ code: number; message: string; data: T | null }>,
  path: string,
  options: HttpOptions = {},
): Promise<T> {
  const result = await http(path, schema, options);
  return result.data.data as T;
}

const ADMIN = "/api/backend/enterprise/admin/service-packages";
const USER = "/api/backend/enterprise/service-packages";

export type ServicePackageRow = z.infer<typeof packageRowZod>;
export type ServicePackageOrder = z.infer<typeof orderRowZod>;
export type ServicePackageOrderItem = z.infer<typeof orderItemZod>;
export type ServicePackageQuote = Awaited<ReturnType<typeof servicePackagesApi.quote>>;
export type ServicePackageCandidate = z.infer<typeof candidateZod>;

export interface ServicePackageSaveBody {
  id?: number;
  serviceType: string;
  name: string;
  description?: string;
  priceCents: number;
  unit?: string;
  features?: string[];
  deliveryItems?: Array<{
    code: string;
    label?: string;
    providerUserId?: string;
    providerOrg?: string;
  }>;
  deliveryDesc?: string;
  autoInitiate?: boolean;
  taxpayerType?: string | null;
  perEnterpriseLimit?: number;
  status?: "ACTIVE" | "DISABLED";
  sortOrder?: number;
}

/** 用户侧：板块套餐展示 / 实时报价 / 积分直购 / 我的套餐。 */
export const servicePackagesApi = {
  list: (serviceType: string, options?: HttpOptions) =>
    unwrap(packageListSchema, USER, { ...options, query: { serviceType } }),
  quote: (packageId: number, options?: HttpOptions) =>
    unwrap(quoteSchema, `${USER}/quote/${packageId}`, options),
  purchase: (packageId: number, options?: HttpOptions) =>
    unwrap(purchaseSchema, `${USER}/${packageId}/purchase`, {
      ...options,
      method: "POST",
    }),
  mine: (options?: HttpOptions) => unwrap(myOrdersSchema, `${USER}/mine`, options),
};

/** 平台管理后台「服务套餐」：目录 CRUD + 交付管理（匹配/主持发起/更换主体/退款）。 */
export const servicePackagesAdminApi = {
  list: (serviceType?: string, options?: HttpOptions) =>
    unwrap(packageListSchema, ADMIN, {
      ...options,
      query: serviceType ? { serviceType } : {},
    }),
  save: (body: ServicePackageSaveBody, options?: HttpOptions) =>
    unwrap(apiEnvelope(z.object({ id: z.number() })), ADMIN, {
      ...options,
      method: "POST",
      body,
    }),
  remove: (id: number, options?: HttpOptions) =>
    unwrap(
      apiEnvelope(z.object({ id: z.number(), removed: z.boolean() })),
      `${ADMIN}/${id}`,
      { ...options, method: "DELETE" },
    ),
  toggle: (id: number, status: "ACTIVE" | "DISABLED", options?: HttpOptions) =>
    unwrap(
      apiEnvelope(z.object({ id: z.number(), status: z.string() })),
      `${ADMIN}/${id}/status`,
      { ...options, method: "PUT", body: { status } },
    ),
  orders: (
    query: {
      serviceType?: string;
      fulfillmentStatus?: string;
      keyword?: string;
      page?: number;
      size?: number;
    } = {},
    options?: HttpOptions,
  ) => unwrap(ordersPageSchema, `${ADMIN}/orders`, { ...options, query }),
  orderDetail: (id: number, options?: HttpOptions) =>
    unwrap(orderDetailSchema, `${ADMIN}/orders/${id}`, options),
  candidates: (serviceType: string, options?: HttpOptions) =>
    unwrap(candidatesSchema, `${ADMIN}/candidates`, {
      ...options,
      query: { serviceType },
    }),
  assign: (itemId: number, providerUserId: string, options?: HttpOptions) =>
    unwrap(
      apiEnvelope(
        z.object({
          id: z.number(),
          providerUserId: z.string(),
          providerOrg: z.string(),
        }),
      ),
      `${ADMIN}/items/${itemId}/assign`,
      { ...options, method: "POST", body: { providerUserId } },
    ),
  initiate: (orderId: number, options?: HttpOptions) =>
    unwrap(
      apiEnvelope(
        z.object({
          initiated: z.number(),
          failed: z.array(z.object({ code: z.string(), message: z.string() })),
          fulfillmentStatus: z.string(),
        }),
      ),
      `${ADMIN}/orders/${orderId}/initiate`,
      { ...options, method: "POST" },
    ),
  replace: (itemId: number, providerUserId: string, options?: HttpOptions) =>
    unwrap(
      apiEnvelope(
        z.object({
          id: z.number(),
          contractId: z.number(),
          providerUserId: z.string(),
          fulfillmentStatus: z.string(),
        }),
      ),
      `${ADMIN}/items/${itemId}/replace`,
      { ...options, method: "POST", body: { providerUserId } },
    ),
  refund: (
    orderId: number,
    body: { amount?: number; remark?: string } = {},
    options?: HttpOptions,
  ) =>
    unwrap(
      apiEnvelope(
        z.object({
          id: z.number(),
          refunded: z.number(),
          totalRefunded: z.number(),
          remaining: z.number(),
          balance: z.number(),
          status: z.string(),
          fulfillmentStatus: z.string(),
        }),
      ),
      `${ADMIN}/orders/${orderId}/refund`,
      { ...options, method: "POST", body },
    ),
};