import { z } from "zod";
// 共享视图 DTO；新增字段必须同步接口契约及页面。
export const logisticsViewSchema = z
  .object({
    id: z.number(),
    orderNo: z.string(),
    orderType: z.string(),
    title: z.string(),
    origin: z.string(),
    destination: z.string(),
    regionMode: z.string().optional().optional(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    longitude: z.union([z.null(), z.number()]).optional().optional(),
    latitude: z.union([z.null(), z.number()]).optional().optional(),
    radiusKm: z.union([z.null(), z.number()]).optional().optional(),
    status: z.string(),
    createdAt: z.string(),
    createdBy: z.string().optional().optional(),
    remark: z.string().optional().optional(),
    budgetType: z.string().optional().optional(),
    expectedResult: z.string().optional().optional(),
    mustConditions: z.string().optional().optional(),
    tags: z.string().optional().optional(),
    expectedDate: z.string().optional().optional(),
    deadline: z.string().optional().optional(),
    contactName: z.string().optional().optional(),
    contactPhone: z.string().optional().optional(),
    contactWechat: z.string().optional().optional(),
    contactEmail: z.string().optional().optional(),
    providerContactName: z.string().optional().optional(),
    providerContactPhone: z.string().optional().optional(),
    emailSync: z.number().optional().optional(),
    providerUserId: z.string().optional().optional(),
    staffUserId: z.string().optional().optional(),
    platformListingId: z.string().optional().optional(),
    conversationCount: z.number().optional().optional(),
    category1: z.string().optional().optional(),
    category2: z.string().optional().optional(),
    subCategoryId: z.string().optional().optional(),
  })
  .passthrough();
export type LogisticsRow = z.infer<typeof logisticsViewSchema>;
export const smartViewSchema = z
  .object({
    id: z.number(),
    orderNo: z.string(),
    serviceItem: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
    createdBy: z.string().optional().optional(),
    description: z.string().optional().optional(),
    tags: z.string().optional().optional(),
    budget: z.string().optional().optional(),
    expectedResult: z.string().optional().optional(),
    mustConditions: z.string().optional().optional(),
    expectStart: z.string().optional().optional(),
    deadline: z.string().optional().optional(),
    regionScope: z.string().optional().optional(),
    regionMode: z.string().optional().optional(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    longitude: z.union([z.null(), z.number()]).optional().optional(),
    latitude: z.union([z.null(), z.number()]).optional().optional(),
    radiusKm: z.union([z.null(), z.number()]).optional().optional(),
    contactName: z.string().optional().optional(),
    contactPhone: z.string().optional().optional(),
    contactWechat: z.string().optional().optional(),
    contactEmail: z.string().optional().optional(),
    providerContactName: z.string().optional().optional(),
    providerContactPhone: z.string().optional().optional(),
    emailSync: z.number().optional().optional(),
    providerUserId: z.string().optional().optional(),
    staffUserId: z.string().optional().optional(),
    platformListingId: z.string().optional().optional(),
    conversationCount: z.number().optional().optional(),
    category1: z.string().optional().optional(),
    category2: z.string().optional().optional(),
    subCategoryId: z.string().optional().optional(),
  })
  .passthrough();
export type SmartRow = z.infer<typeof smartViewSchema>;
export const assetViewSchema = z
  .object({
    id: z.number(),
    requestNo: z.string(),
    title: z.string(),
    description: z.string().optional().optional(),
    tags: z.string().optional().optional(),
    budget: z.string().optional().optional(),
    expectedResult: z.string().optional().optional(),
    mustConditions: z.string().optional().optional(),
    expectStart: z.string().optional().optional(),
    deadline: z.string().optional().optional(),
    regionScope: z.string().optional().optional(),
    regionMode: z.string().optional().optional(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    longitude: z.union([z.null(), z.number()]).optional().optional(),
    latitude: z.union([z.null(), z.number()]).optional().optional(),
    radiusKm: z.union([z.null(), z.number()]).optional().optional(),
    emailSync: z.number().optional().optional(),
    contactName: z.string().optional().optional(),
    contactPhone: z.string().optional().optional(),
    contactWechat: z.string().optional().optional(),
    contactEmail: z.string().optional().optional(),
    providerContactName: z.string().optional().optional(),
    providerContactPhone: z.string().optional().optional(),
    subCategoryId: z.string().optional().optional(),
    category1: z.string().optional().optional(),
    category2: z.string().optional().optional(),
    status: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    createdBy: z.string(),
    enterpriseId: z.number(),
    aiworkinPublished: z.number().optional().optional(),
    platformListingId: z.string().optional().optional(),
    conversationCount: z.number().optional().optional(),
    messages: z.unknown().optional(),
    createdAt: z.string(),
  })
  .passthrough();
export type AssetRow = z.infer<typeof assetViewSchema>;
export const marketingViewSchema = z
  .object({
    id: z.number(),
    orderNo: z.string(),
    orderType: z.string(),
    title: z.string(),
    description: z.string().optional().optional(),
    tags: z.string(),
    budget: z.string(),
    expectedResult: z.string().optional().optional(),
    mustConditions: z.string().optional().optional(),
    expectStart: z.string(),
    deadline: z.string().optional().optional(),
    regionScope: z.string().optional().optional(),
    regionMode: z.string().optional().optional(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    longitude: z.union([z.null(), z.number()]).optional().optional(),
    latitude: z.union([z.null(), z.number()]).optional().optional(),
    radiusKm: z.union([z.null(), z.number()]).optional().optional(),
    contactName: z.string().optional().optional(),
    contactPhone: z.string().optional().optional(),
    contactWechat: z.string().optional().optional(),
    contactEmail: z.string().optional().optional(),
    providerContactName: z.string().optional().optional(),
    providerContactPhone: z.string().optional().optional(),
    emailSync: z.number().optional().optional(),
    status: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    createdBy: z.string(),
    enterpriseId: z.number(),
    createdAt: z.string(),
    platformListingId: z.string().optional().optional(),
    conversationCount: z.number().optional().optional(),
    category1: z.string().optional().optional(),
    category2: z.string().optional().optional(),
    subCategoryId: z.string().optional().optional(),
  })
  .passthrough();
export type MarketingRow = z.infer<typeof marketingViewSchema>;
export const flexWorkOrderViewSchema = z
  .object({
    id: z.number(),
    orderNo: z.string(),
    contractId: z.number(),
    enterpriseId: z.number(),
    createdBy: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    agentName: z.string(),
    title: z.string(),
    workType: z.string(),
    subCategoryId: z.string().optional().optional(),
    category1: z.string().optional().optional(),
    category2: z.string().optional().optional(),
    description: z.string(),
    tags: z.string(),
    budget: z.string(),
    expectedResult: z.string(),
    mustConditions: z.string(),
    expectStart: z.string(),
    deadline: z.string(),
    regionScope: z.string(),
    regionMode: z.string().optional().optional(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    longitude: z.union([z.null(), z.number()]).optional().optional(),
    latitude: z.union([z.null(), z.number()]).optional().optional(),
    radiusKm: z.union([z.null(), z.number()]).optional().optional(),
    emailSync: z.number(),
    contactName: z.string(),
    contactPhone: z.string(),
    contactWechat: z.string(),
    contactEmail: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    candidates: z.array(
      z
        .object({
          name: z.string().optional().optional(),
          stage: z.string().optional().optional(),
          note: z.string().optional().optional(),
          time: z.string().optional().optional(),
        })
        .passthrough(),
    ),
    settlements: z.array(
      z
        .object({
          period: z.string().optional().optional(),
          amount: z.union([z.string(), z.number()]).optional().optional(),
          invoice: z.string().optional().optional(),
          note: z.string().optional().optional(),
          time: z.string().optional().optional(),
        })
        .passthrough(),
    ),
    flexId: z.number(),
    messages: z.array(
      z
        .object({
          role: z.string().optional().optional(),
          name: z.string().optional().optional(),
          time: z.string().optional().optional(),
          text: z.string().optional().optional(),
        })
        .passthrough(),
    ),
    status: z.string(),
    aiworkinPublished: z.number(),
    platformListingId: z.string(),
    conversationCount: z.number().optional().optional(),
    createdAt: z.string(),
  })
  .passthrough();
export type FlexWorkOrder = z.infer<typeof flexWorkOrderViewSchema>;
export const legalRequestViewSchema = z
  .object({
    id: z.number(),
    requestNo: z.string(),
    contractId: z.number(),
    enterpriseId: z.number(),
    createdBy: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    lawyerId: z.number(),
    category: z.string(),
    subCategoryId: z.string().optional().optional(),
    category1: z.string().optional().optional(),
    category2: z.string().optional().optional(),
    title: z.string(),
    fields: z.unknown(),
    regionMode: z.string().optional().optional(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    longitude: z.union([z.null(), z.number()]).optional().optional(),
    latitude: z.union([z.null(), z.number()]).optional().optional(),
    radiusKm: z.union([z.null(), z.number()]).optional().optional(),
    status: z.string(),
    contactName: z.string().optional().optional(),
    contactPhone: z.string().optional().optional(),
    aiworkinPublished: z.number(),
    platformListingId: z.string().optional().optional(),
    conversationCount: z.number().optional().optional(),
    messages: z.unknown(),
    createdAt: z.string(),
  })
  .passthrough();
export type LegalRequestRow = z.infer<typeof legalRequestViewSchema>;
export const ipRequestViewSchema = z
  .object({
    id: z.number(),
    requestNo: z.string(),
    kind: z.string(),
    contractId: z.number(),
    enterpriseId: z.number(),
    createdBy: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    agencyId: z.number(),
    agentName: z.string(),
    category: z.string(),
    subCategoryId: z.string().optional().optional(),
    category1: z.string().optional().optional(),
    category2: z.string().optional().optional(),
    title: z.string(),
    fields: z.unknown(),
    regionMode: z.string().optional().optional(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    longitude: z.union([z.null(), z.number()]).optional().optional(),
    latitude: z.union([z.null(), z.number()]).optional().optional(),
    radiusKm: z.union([z.null(), z.number()]).optional().optional(),
    status: z.string(),
    contactName: z.string().optional().optional(),
    contactPhone: z.string().optional().optional(),
    aiworkinPublished: z.number(),
    platformListingId: z.string().optional().optional(),
    conversationCount: z.number().optional().optional(),
    messages: z.unknown(),
    createdAt: z.string(),
  })
  .passthrough();
export type IpRequestRow = z.infer<typeof ipRequestViewSchema>;
export const lawyerViewSchema = z
  .object({
    id: z.number(),
    kind: z.string(),
    name: z.string(),
    organization: z.string(),
    region: z.string(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    areas: z.unknown(),
    licenseNo: z.string().optional().optional(),
    qualification: z.string(),
    intro: z.string().nullable().optional().optional(),
    cases: z.unknown().optional(),
    staffName: z.string().optional().optional(),
    staffUsername: z.string().optional().optional(),
    ownerUserId: z.string().optional().optional(),
    status: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    auditNote: z.string(),
    createdAt: z.string(),
  })
  .passthrough();
export type LawyerResource = z.infer<typeof lawyerViewSchema>;
export const ipAgencyViewSchema = z
  .object({
    id: z.number(),
    kind: z.string(),
    name: z.string(),
    organization: z.string(),
    region: z.string(),
    province: z.string().optional().optional(),
    city: z.string().optional().optional(),
    fields: z.unknown(),
    qualification: z.string(),
    licenseNo: z.string(),
    phone: z.string(),
    intro: z.string().nullable().optional().optional(),
    note: z.string(),
    agents: z.unknown().optional(),
    cases: z.unknown().optional(),
    status: z.string(),
    ownerType: z.string(),
    ownerUserId: z.string(),
    auditNote: z.string(),
    createdAt: z.string(),
  })
  .passthrough();
export type IpAgency = z.infer<typeof ipAgencyViewSchema>;
/**
 * 智库资源行（机构 kind=ORGANIZATION / 专家 kind=EXPERT 同一张表，
 * GET /enterprise/think-tank/experts）：备案通过即展示，无逐行审核。
 */
export const thinkTankExpertViewSchema = z
  .object({
    id: z.number(),
    kind: z.string(),
    name: z.string(),
    organization: z.string(),
    region: z.string(),
    province: z.string().optional(),
    city: z.string().optional(),
    areas: z.unknown(),
    licenseNo: z.string().optional(),
    qualification: z.string(),
    intro: z.string().nullable().optional(),
    cases: z.unknown().optional(),
    staffName: z.string().optional(),
    staffUsername: z.string().optional(),
    ownerUserId: z.string().optional(),
    status: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    createdAt: z.string(),
  })
  .passthrough();
export type ThinkTankExpert = z.infer<typeof thinkTankExpertViewSchema>;
export type ThinkTankOrganization = ThinkTankExpert;
/** 智库咨询需求行（GET /enterprise/think-tank/requests，明细整体存 fields JSON）。 */
export const thinkTankRequestViewSchema = z
  .object({
    id: z.number(),
    requestNo: z.string(),
    contractId: z.number().optional(),
    enterpriseId: z.number(),
    createdBy: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    category: z.string(),
    subCategoryId: z.string().optional(),
    category1: z.string().optional(),
    category2: z.string().optional(),
    title: z.string(),
    fields: z.unknown(),
    regionMode: z.string().optional(),
    province: z.string().optional(),
    city: z.string().optional(),
    longitude: z.union([z.null(), z.number()]).optional(),
    latitude: z.union([z.null(), z.number()]).optional(),
    radiusKm: z.union([z.null(), z.number()]).optional(),
    status: z.string(),
    contactName: z.string().optional(),
    contactPhone: z.string().optional(),
    aiworkinPublished: z.number().optional(),
    platformListingId: z.string().optional(),
    conversationCount: z.number().optional(),
    messages: z.unknown(),
    createdAt: z.string(),
  })
  .passthrough();
export type ThinkTankRequestRow = z.infer<typeof thinkTankRequestViewSchema>;
export const serviceViewSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    serviceNo: z.string().optional().optional(),
    domain: z.string().optional().optional(),
    domain_label: z.string().optional().optional(),
    providerUserId: z.string().optional().optional(),
    staffUserId: z.string().optional().optional(),
    mine: z
      .union([z.literal(false), z.literal(true)])
      .optional()
      .optional(),
    category1: z.string().optional().optional(),
    category2: z.string().optional().optional(),
    subCategoryId: z.string(),
    title: z.string(),
    description: z.string(),
    tags: z.string(),
    moneyMode: z.string(),
    amountMin: z.number(),
    amountMax: z.number(),
    unitLabel: z.string(),
    priceDescription: z.string(),
    serviceAreaMode: z.string(),
    province: z.string(),
    city: z.string(),
    longitude: z.union([z.null(), z.number()]),
    latitude: z.union([z.null(), z.number()]),
    radiusKm: z.union([z.null(), z.number()]),
    deliveryMode: z.string(),
    responseTime: z.string(),
    qualifications: z.string(),
    credentialTypes: z.string(),
    highlights: z.union([z.string(), z.array(z.string())]),
    cases: z.string(),
    reference_links: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .optional(),
    referenceLinks: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .optional(),
    contactName: z.string(),
    contactPhone: z.string(),
    contactWechat: z.string(),
    contactEmail: z.string(),
    status: z.string(),
    aiworkinPublished: z.number().optional().optional(),
    platformListingId: z.string().optional().optional(),
    createdAt: z.string(),
  })
  .passthrough();
export type ServiceRow = z.infer<typeof serviceViewSchema>;
export const channelMessageSchema = z
  .object({
    role: z.string().optional().optional(),
    name: z.string().optional().optional(),
    time: z.string().optional().optional(),
    text: z.string().optional().optional(),
  })
  .passthrough();
export type ChannelMessage = z.infer<typeof channelMessageSchema>;
export const channelConversationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    messages: z
      .array(
        z
          .object({
            role: z.string().optional().optional(),
            name: z.string().optional().optional(),
            time: z.string().optional().optional(),
            text: z.string().optional().optional(),
          })
          .passthrough(),
      )
      .optional()
      .optional(),
  })
  .passthrough();
export type ChannelConversation = z.infer<typeof channelConversationSchema>;
export const adminStatsSchema = z
  .object({
    users: z.number().optional().optional(),
    enterprises: z.number().optional().optional(),
    providers: z.number().optional().optional(),
    activeContracts: z.number().optional().optional(),
    declarations: z.number().optional().optional(),
    taxAmountTotal: z.number().optional().optional(),
    overseas: z.number().optional().optional(),
    marketingOrders: z.number().optional().optional(),
    taxPaid: z.union([z.string(), z.number()]).optional().optional(),
    refunds: z.number().optional().optional(),
    logistics: z.number().optional().optional(),
    smartOrders: z.number().optional().optional(),
    lawyers: z.number().optional().optional(),
    legalRequests: z.number().optional().optional(),
    ipAgencies: z.number().optional().optional(),
    ipRequests: z.number().optional().optional(),
    flexProviders: z.number().optional().optional(),
    flexOrders: z.number().optional().optional(),
    flexWorkOrders: z.number().optional().optional(),
    pendingProvider: z.number().optional().optional(),
    servicesByType: z.record(z.string(), z.number()).optional().optional(),
  })
  .passthrough();
export type AdminStats = z.infer<typeof adminStatsSchema>;
export const adminContractSchema = z
  .object({
    id: z.number(),
    contractNo: z.string(),
    providerUserId: z.string(),
    providerOrg: z.string(),
    enterpriseName: z.string(),
    status: z.string(),
    startDate: z.string(),
    note: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export type AdminContractRow = z.infer<typeof adminContractSchema>;
export const supplyOverviewSchema = z
  .object({
    orders: z.array(
      z
        .object({
          id: z.number(),
          orderNo: z.string(),
          enterpriseName: z.string(),
          providerUserId: z.string(),
          staffUserId: z.string(),
          staffName: z.string().optional().optional(),
          stationId: z.number(),
          stationName: z.string(),
          expectedDate: z.string(),
          status: z.string(),
          productAmount: z.union([z.string(), z.number()]),
          feeAmount: z.union([z.string(), z.number()]),
          totalAmount: z.union([z.string(), z.number()]),
          updatedAt: z.string().optional().optional(),
          createdAt: z.string(),
        })
        .passthrough(),
    ),
    bookings: z.array(
      z
        .object({
          id: z.number(),
          bookingNo: z.string(),
          enterpriseName: z.string(),
          providerUserId: z.string(),
          staffUserId: z.string(),
          staffName: z.string().optional().optional(),
          stationId: z.number(),
          stationName: z.string(),
          serviceName: z.string(),
          planDate: z.string(),
          status: z.string(),
          baseAmount: z.union([z.string(), z.number()]),
          feeAmount: z.union([z.string(), z.number()]),
          totalAmount: z.union([z.string(), z.number()]),
          updatedAt: z.string().optional().optional(),
          createdAt: z.string(),
        })
        .passthrough(),
    ),
    station_stats: z.array(
      z
        .object({
          station_id: z.number(),
          station_name: z.string(),
          provider_user_id: z.string(),
          region: z.string(),
          status: z.string(),
          order_count: z.number(),
          booking_count: z.number(),
          product_count: z.number(),
        })
        .passthrough(),
    ),
    provider_stats: z.array(
      z
        .object({
          provider_user_id: z.string(),
          station_count: z.number(),
          order_count: z.number(),
          booking_count: z.number(),
          product_count: z.number(),
          service_count: z.number(),
        })
        .passthrough(),
    ),
    totals: z
      .object({
        orders: z.number(),
        bookings: z.number(),
        providers: z.number(),
        stations: z.number(),
        products: z.number(),
        services: z.number(),
      })
      .passthrough(),
  })
  .passthrough();
export type SupplyOverview = z.infer<typeof supplyOverviewSchema>;
export const capabilityMatrixRowSchema = z
  .object({
    enterpriseId: z.number(),
    name: z.string(),
    taxFiling: z.string(),
    invoicing: z.string(),
    /** 企业统一社会信用代码（税号）：平台按此匹配企享云报税 API Key。 */
    taxNo: z.string().optional(),
    /** 当前匹配的企享云账号名称（未匹配为空串）。 */
    qxyAccountName: z.string().optional(),
  })
  .passthrough();
export type MatrixRow = z.infer<typeof capabilityMatrixRowSchema>;
