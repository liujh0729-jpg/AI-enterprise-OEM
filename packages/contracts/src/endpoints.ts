import {
  serviceViewSchema,
  marketingViewSchema,
  logisticsViewSchema,
  smartViewSchema,
  assetViewSchema,
  legalRequestViewSchema,
  ipRequestViewSchema,
  flexWorkOrderViewSchema,
  thinkTankExpertViewSchema,
  thinkTankRequestViewSchema,
} from "./views";
import { providerApplicationSchema } from "./directory";
// Public DTO schemas migrated from the existing interface baseline. Maintain these alongside route changes.
import { z } from "zod";
import { directoryProviderSchema, overseasProviderSchema } from "./directory";
import { pageQuerySchema, pageSchema, cursorPageSchema } from "./pagination";
import { adminPageEndpoints } from "./admin";
import { automationEndpoints } from "./automation";
import { agentEndpoints } from "./agent";
import { ContentEndpoints as contentEndpoints } from "./content";
import { mailEndpoints } from "./mail";
import { notificationsEndpoints } from "./notifications";
import { orgStaffEndpoints } from "./org-staff";
import { serviceDeskEndpoints } from "./service-desk";
import { livecodeEndpoints } from "./livecode";
import { crmEndpoints } from "./crm";
import { biEndpoints } from "./bi";
import { lowcodeEndpoints } from "./lowcode";
import { okrEndpoints } from "./okr";
import { partyEndpoints } from "./party";
import { oaEndpoints } from "./oa";
import { questionHallEndpoints } from "./question-hall";
import { distributionEndpoints } from "./distribution";
import { helpEndpoints } from "./help";
import { imEndpoints } from "./im";
import { skillHubEndpoints } from "./skillhub";
import { communityEndpoints, communityAdminEndpoints } from "./community";
import { videoTemplateEndpoints } from "./video-templates";
import { governanceEndpoints } from "./governance";
import { kbEndpoints } from "./kb";
import { hrmEndpoints } from "./hrm";
import { skillGeneratorEndpoints } from "./skill-generator";
import { surveyEndpoints } from "./survey";
import { moderationEndpoints } from "./moderation";
import { storageEndpoints } from "./storage";
import { mechanismsEndpoints } from "./mechanisms";
import { projectEndpoints } from "./project";
import { growthEndpoints } from "./growth";
import { erpEndpoints } from "./erp";
import { mktEndpoints } from "./mkt";
import { recruitEndpoints } from "./recruit";
import { seoEndpoints } from "./seo";
import { acquisitionEndpoints } from "./acquisition";
import { collabEndpoints } from "./collab";
import { scrmEndpoints } from "./wecom-scrm";
import { enterpriseGapEndpoints } from "./enterprise-gaps";
import { aiEndpoints } from "./ai";
import { modelPlazaEndpoints, modelPlazaAdminEndpoints } from "./model-plaza";
import { hardwareEndpoints } from "./hardware";
const jsonValueSchema = z.union([
  z.null(),
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
const marketingRowSchema = marketingViewSchema;
const logisticsRowSchema = logisticsViewSchema;
const smartServiceRowSchema = smartViewSchema;
const assetRowSchema = assetViewSchema;
const legalRowSchema = legalRequestViewSchema;
const ipRowSchema = ipRequestViewSchema;
const flexRowSchema = flexWorkOrderViewSchema;
const thinkTankExpertRowSchema = thinkTankExpertViewSchema;
const thinkTankRowSchema = thinkTankRequestViewSchema;
export const overseasClaimRowSchema = z
  .object({
    status: z.string(),
    id: z.number(),
    contactName: z.string(),
    contactPhone: z.string(),
    createdAt: z.string(),
    contractId: z.number(),
    enterpriseId: z.number(),
    updatedAt: z.string(),
    providerUserId: z.string(),
    serviceType: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    staffUserId: z.string(),
    title: z.string(),
    remark: z.string(),
    amount: z.union([z.string(), z.number()]),
    claimNo: z.string(),
    country: z.string(),
  })
  .passthrough();
export const flexOnboardingRowSchema = z
  .object({
    status: z.string(),
    id: z.number(),
    contactName: z.string(),
    contactPhone: z.string(),
    attachments: z.array(
      z
        .object({
          key: z.string().optional(),
          name: z.string().optional(),
          requirement: z.string().optional(),
          ready: z.boolean().optional(),
          files: z
            .array(
              z
                .object({
                  id: z.string().optional(),
                  name: z.string(),
                  size: z.number().optional(),
                  url: z.string(),
                  uploaded_at: z.string().optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
    createdAt: z.string(),
    auditedAt: z.union([z.null(), z.string()]),
    contractId: z.number(),
    enterpriseId: z.number(),
    providerUserId: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    staffUserId: z.string(),
    onboardingNo: z.string(),
    agentName: z.string(),
    form: z.record(z.string(), z.string()),
    rejectNote: z.string(),
  })
  .passthrough();
export const flexPayrollRowSchema = z
  .object({
    status: z.string(),
    id: z.number(),
    contactName: z.string(),
    contactPhone: z.string(),
    createdAt: z.string(),
    auditedAt: z.union([z.null(), z.string()]),
    contractId: z.number(),
    enterpriseId: z.number(),
    note: z.string(),
    providerUserId: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    period: z.string(),
    agentName: z.string(),
    rejectNote: z.string(),
    payrollNo: z.string(),
    employees: z.array(
      z
        .object({
          name: z.string().optional(),
          id_no: z.string().optional(),
          bank_name: z.string().optional(),
          bank_account: z.string().optional(),
          amount: z.union([z.number(), z.string()]).optional(),
        })
        .passthrough(),
    ),
    totalAmount: z.union([z.string(), z.number()]),
  })
  .passthrough();
export const supplyOrderRowSchema = z
  .object({
    status: z.string(),
    id: z.number(),
    contactName: z.string(),
    contactPhone: z.string(),
    createdAt: z.string(),
    enterpriseId: z.number(),
    updatedAt: z.string(),
    providerUserId: z.string(),
    enterpriseName: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    createdBy: z.string(),
    staffUserId: z.string(),
    remark: z.string(),
    orderNo: z.string(),
    totalAmount: z.union([z.string(), z.number()]),
    expectedDate: z.string(),
    stationId: z.number(),
    stationName: z.string(),
    revision: z.number(),
    quotedAt: z.union([z.null(), z.string()]),
    promisedShipDate: z.string(),
    quoteNote: z.string(),
    productAmount: z.union([z.string(), z.number()]),
    otherFees: z.array(
      z
        .object({
          name: z.string().optional(),
          amount: z.union([z.number(), z.string()]).optional(),
          note: z.string().optional(),
        })
        .passthrough(),
    ),
    feeAmount: z.union([z.string(), z.number()]),
    confirmNote: z.string(),
    confirmedAt: z.union([z.null(), z.string()]),
    items: z.array(
      z
        .object({
          id: z.number(),
          createdAt: z.string(),
          updatedAt: z.string(),
          amount: z.union([z.string(), z.number()]),
          quantity: z.union([z.string(), z.number()]),
          price: z.union([z.string(), z.number()]),
          unit: z.string(),
          productId: z.number(),
          specName: z.string(),
          orderId: z.number(),
          skuId: z.number(),
          productName: z.string(),
          stockState: z.string(),
          shortageNote: z.string(),
          restockCycle: z.string(),
        })
        .passthrough(),
    ),
    staffName: z.string(),
  })
  .passthrough();
export const supplyBookingRowSchema = z
  .object({
    status: z.string(),
    id: z.number(),
    contactName: z.string(),
    contactPhone: z.string(),
    createdAt: z.string(),
    enterpriseId: z.number(),
    updatedAt: z.string(),
    providerUserId: z.string(),
    enterpriseName: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    createdBy: z.string(),
    staffUserId: z.string(),
    remark: z.string(),
    totalAmount: z.union([z.string(), z.number()]),
    stationId: z.number(),
    priceUnit: z.string(),
    stationName: z.string(),
    revision: z.number(),
    quotedAt: z.union([z.null(), z.string()]),
    quoteNote: z.string(),
    otherFees: z.array(
      z
        .object({
          name: z.string().optional(),
          amount: z.union([z.number(), z.string()]).optional(),
          note: z.string().optional(),
        })
        .passthrough(),
    ),
    feeAmount: z.union([z.string(), z.number()]),
    confirmNote: z.string(),
    confirmedAt: z.union([z.null(), z.string()]),
    bookingNo: z.string(),
    serviceId: z.number(),
    serviceName: z.string(),
    planDate: z.string(),
    siteAddress: z.string(),
    scale: z.string(),
    baseAmount: z.union([z.string(), z.number()]),
    staffName: z.string(),
  })
  .passthrough();
export const taxDeclarationRowSchema = z
  .object({
    status: z.string(),
    id: z.number(),
    contactName: z.string(),
    contactPhone: z.string(),
    createdAt: z.string(),
    taxAmount: z.union([z.string(), z.number()]),
    contractId: z.number(),
    enterpriseId: z.number(),
    materialId: z.number(),
    updatedAt: z.string(),
    providerUserId: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    staffUserId: z.string(),
    title: z.string(),
    period: z.string(),
    taxType: z.string(),
    receiptNo: z.string(),
    declNo: z.string(),
    formData: z.record(z.string(), z.unknown()),
    aiSteps: z.array(
      z
        .object({
          step: z.number().optional(),
          text: z.string().optional(),
          status: z.string().optional(),
          note: z.string().optional(),
          at: z.string().optional(),
        })
        .passthrough(),
    ),
    advisorConfirms: z.array(z.string()),
    qcStatus: z.string(),
    qcNote: z.string(),
  })
  .passthrough();
export const taxAccountSetRowSchema = z
  .object({
    plan_stats: z
      .object({ due: z.number(), in_progress: z.number(), done: z.number() })
      .passthrough(),
    decl_summary: z.object({ count: z.number() }).passthrough(),
    status: z.string(),
    id: z.number(),
    createdAt: z.string(),
    name: z.string(),
    enterpriseId: z.number(),
    providerUserId: z.string(),
    staffUserId: z.string(),
  })
  .passthrough();

export const taxMaterialPackRowSchema = z
  .object({
    payload: z
      .object({
        payroll: z.array(
          z.record(z.string(), z.union([z.string(), z.number()]).optional()),
        ),
        invoices: z.array(
          z.record(z.string(), z.union([z.string(), z.number()]).optional()),
        ),
        bank: z.array(
          z.record(z.string(), z.union([z.string(), z.number()]).optional()),
        ),
      })
      .passthrough(),
    created_at: z.string(),
    submitted_at: z.union([z.null(), z.string()]),
    analyzed_at: z.union([z.null(), z.string()]),
    counts: z
      .object({ payroll: z.number(), invoices: z.number(), bank: z.number() })
      .passthrough(),
    id: z.number(),
    packNo: z.string(),
    period: z.string(),
    title: z.string(),
    status: z.string(),
    providerUserId: z.string(),
    staffUserId: z.string(),
    enterpriseId: z.number(),
    updatedAt: z.string(),
    contactName: z.string(),
    contactPhone: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    createdAt: z.string(),
    submittedAt: z.union([z.null(), z.string()]).optional().optional(),
    analyzedAt: z.union([z.null(), z.string()]).optional().optional(),
  })
  .passthrough();

const invoiceRequestRowSchema = z
  .object({
    id: z.number(),
    reqNo: z.string(),
    enterpriseId: z.number(),
    enterpriseName: z.string(),
    buyerName: z.string(),
    buyerTaxNo: z.string(),
    invoiceType: z.string(),
    buyerType: z.string(),
    orderNo: z.string(),
    remark: z.string(),
    status: z.string(),
    rejectReason: z.string(),
    issueCode: z.string(),
    issueMessage: z.string(),
    issueTaskId: z.string(),
    contactName: z.string(),
    contactPhone: z.string(),
    providerContactName: z.string(),
    providerContactPhone: z.string(),
    createdAt: z.string(),
    staffName: z.string(),
    requesterName: z.string(),
    statusLabel: z.string(),
    canReview: z.boolean(),
    items: z.array(
      z
        .object({
          goodsCode: z.string().optional().optional(),
          goodsName: z.string().optional().optional(),
          spec: z.string().optional().optional(),
          quantity: z.number().optional().optional(),
          price: z.number().optional().optional(),
          taxRate: z.string().optional().optional(),
        })
        .passthrough(),
    ),
    amount: z.number(),
    tax: z.number(),
  })
  .passthrough();
const taxRecordRowSchema = z
  .object({
    id: z.number(),
    userId: z.string(),
    createdAt: z.string(),
    title: z.string(),
    kind: z.string(),
    snapshot: z.record(z.string(), z.unknown()),
  })
  .passthrough();
/** 应用市场：条目来自外部公开目录，字段由后端归一成驼峰，本站不建表。 */
const appItemSchema = z
  .object({
    clientId: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    scopes: z.array(z.string()),
    homepageUrl: z.string(),
  })
  .passthrough();
const appDetailSchema = appItemSchema.extend({
  publishedAt: z.string().nullable(),
});
const appReviewSchema = z
  .object({
    id: z.string(),
    author: z.string(),
    rating: z.number(),
    content: z.string(),
    createdAt: z.string().nullable(),
  })
  .passthrough();
/**
 * 本文件里直接写出的接口清单。
 * 各模块自有的清单在各自文件中登记，由下面的 `endpoints` 交叉引用后合并。
 */
const localEndpoints = {
  Invoice_page: {
    method: "get",
    path: "/enterprise/invoice-requests/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      enterpriseId: z.coerce.number().int().positive().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(invoiceRequestRowSchema).nullable(),
    }),
  },
  Invoice_stats: {
    method: "get",
    path: "/enterprise/invoice-requests/stats",
    params: z.object({}),
    query: z.object({
      enterpriseId: z.coerce.number().int().positive().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Tax_recordPage: {
    method: "get",
    path: "/enterprise/tax/records/page",
    params: z.object({}),
    query: pageQuerySchema.extend({ kind: z.string().optional() }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(taxRecordRowSchema).nullable(),
    }),
  },

  Services_page: {
    method: "get",
    path: "/enterprise/services/page",
    params: z.object({}),
    query: pageQuerySchema.extend({ domain: z.string().optional() }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(serviceViewSchema).nullable(),
    }),
  },
  Services_detail: {
    method: "get",
    path: "/enterprise/services/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: serviceViewSchema.nullable(),
    }),
  },

  Tax_setPage: {
    method: "get",
    path: "/enterprise/tax/account-sets/page",
    params: z.object({}),
    query: pageQuerySchema,
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(taxAccountSetRowSchema).nullable(),
    }),
  },
  Tax_setDetail: {
    method: "get",
    path: "/enterprise/tax/account-sets/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: taxAccountSetRowSchema.nullable(),
    }),
  },
  Tax_materialPage: {
    method: "get",
    path: "/enterprise/tax/material-packs/page",
    params: z.object({}),
    query: pageQuerySchema,
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(taxMaterialPackRowSchema).nullable(),
    }),
  },

  Overseas_claimPage: {
    method: "get",
    path: "/enterprise/overseas/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      stationId: z.string().optional(),
      provider: z.string().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(overseasClaimRowSchema).nullable(),
    }),
  },
  Overseas_claimStats: {
    method: "get",
    path: "/enterprise/overseas/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Overseas_claimDetail: {
    method: "get",
    path: "/enterprise/overseas/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: overseasClaimRowSchema.nullable(),
    }),
  },
  Flex_onboardingPage: {
    method: "get",
    path: "/enterprise/flex/onboardings/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      stationId: z.string().optional(),
      provider: z.string().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(flexOnboardingRowSchema).nullable(),
    }),
  },
  Flex_onboardingStats: {
    method: "get",
    path: "/enterprise/flex/onboardings/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Flex_onboardingDetail: {
    method: "get",
    path: "/enterprise/flex/onboardings/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: flexOnboardingRowSchema.nullable(),
    }),
  },
  Flex_payrollPage: {
    method: "get",
    path: "/enterprise/flex/payrolls/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      stationId: z.string().optional(),
      provider: z.string().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(flexPayrollRowSchema).nullable(),
    }),
  },
  Flex_payrollStats: {
    method: "get",
    path: "/enterprise/flex/payrolls/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Flex_payrollDetail: {
    method: "get",
    path: "/enterprise/flex/payrolls/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: flexPayrollRowSchema.nullable(),
    }),
  },
  Supply_orderPage: {
    method: "get",
    path: "/enterprise/supply/orders/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      stationId: z.string().optional(),
      provider: z.string().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(supplyOrderRowSchema).nullable(),
    }),
  },
  Supply_orderStats: {
    method: "get",
    path: "/enterprise/supply/orders/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Supply_orderDetail: {
    method: "get",
    path: "/enterprise/supply/orders/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: supplyOrderRowSchema.nullable(),
    }),
  },
  Supply_bookingPage: {
    method: "get",
    path: "/enterprise/supply/bookings/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      stationId: z.string().optional(),
      provider: z.string().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(supplyBookingRowSchema).nullable(),
    }),
  },
  Supply_bookingStats: {
    method: "get",
    path: "/enterprise/supply/bookings/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Supply_bookingDetail: {
    method: "get",
    path: "/enterprise/supply/bookings/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: supplyBookingRowSchema.nullable(),
    }),
  },
  Tax_declarationPage: {
    method: "get",
    path: "/enterprise/tax/decls/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      status: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      enterpriseId: z.coerce.number().int().positive().optional(),
      provider: z.string().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(taxDeclarationRowSchema).nullable(),
    }),
  },
  Tax_declarationStats: {
    method: "get",
    path: "/enterprise/tax/decls/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Marketing_page: {
    method: "get",
    path: "/enterprise/marketing/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      province: z.string().optional(),
      city: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      status: z.string().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(marketingRowSchema).nullable(),
    }),
  },
  Marketing_stats: {
    method: "get",
    path: "/enterprise/marketing/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Marketing_detail: {
    method: "get",
    path: "/enterprise/marketing/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: marketingRowSchema.nullable(),
    }),
  },
  Logistics_page: {
    method: "get",
    path: "/enterprise/logistics/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      province: z.string().optional(),
      city: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      status: z.string().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(logisticsRowSchema).nullable(),
    }),
  },
  Logistics_stats: {
    method: "get",
    path: "/enterprise/logistics/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Logistics_detail: {
    method: "get",
    path: "/enterprise/logistics/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: logisticsRowSchema.nullable(),
    }),
  },
  SmartService_page: {
    method: "get",
    path: "/enterprise/smart/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      province: z.string().optional(),
      city: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      status: z.string().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(smartServiceRowSchema).nullable(),
    }),
  },
  SmartService_stats: {
    method: "get",
    path: "/enterprise/smart/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  SmartService_detail: {
    method: "get",
    path: "/enterprise/smart/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: smartServiceRowSchema.nullable(),
    }),
  },
  Asset_page: {
    method: "get",
    path: "/enterprise/asset/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      province: z.string().optional(),
      city: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      status: z.string().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(assetRowSchema).nullable(),
    }),
  },
  Asset_stats: {
    method: "get",
    path: "/enterprise/asset/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Asset_detail: {
    method: "get",
    path: "/enterprise/asset/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: assetRowSchema.nullable(),
    }),
  },
  Legal_page: {
    method: "get",
    path: "/enterprise/legal/requests/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      province: z.string().optional(),
      city: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      status: z.string().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(legalRowSchema).nullable(),
    }),
  },
  Legal_stats: {
    method: "get",
    path: "/enterprise/legal/requests/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Legal_detail: {
    method: "get",
    path: "/enterprise/legal/requests/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: legalRowSchema.nullable(),
    }),
  },
  Ip_page: {
    method: "get",
    path: "/enterprise/ip/requests/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      province: z.string().optional(),
      city: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      status: z.string().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(ipRowSchema).nullable(),
    }),
  },
  Ip_stats: {
    method: "get",
    path: "/enterprise/ip/requests/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Ip_detail: {
    method: "get",
    path: "/enterprise/ip/requests/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: ipRowSchema.nullable(),
    }),
  },
  Flex_page: {
    method: "get",
    path: "/enterprise/flex/work-orders/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      province: z.string().optional(),
      city: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      status: z.string().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(flexRowSchema).nullable(),
    }),
  },
  Flex_stats: {
    method: "get",
    path: "/enterprise/flex/work-orders/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  Flex_detail: {
    method: "get",
    path: "/enterprise/flex/work-orders/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: flexRowSchema.nullable(),
    }),
  },
  MarketBoard_demandDetail: {
    method: "get",
    path: "/enterprise/market/:domain/demands/:id",
    params: z.object({ domain: z.string(), id: z.string().uuid() }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          id: z.string(),
          listingId: z.string(),
          mine: z.boolean(),
          status: z.string(),
          subCategoryId: z.string(),
          category1: z.string(),
          category2: z.string(),
          title: z.string(),
          description: z.string(),
          tags: z.string(),
          budget: z.string(),
          expectedOutcome: z.string(),
          mustHaves: z.string(),
          startAt: z.string(),
          deadline: z.string(),
          regionScope: z.string(),
          regionMode: z.string(),
          province: z.string(),
          city: z.string(),
          longitude: z.union([z.null(), z.number()]),
          latitude: z.union([z.null(), z.number()]),
          radiusKm: z.union([z.null(), z.number()]),
          contactName: z.string(),
          contactPhone: z.string(),
          contactWechat: z.string(),
          contactEmail: z.string(),
          emailSync: z.number(),
          conversationCount: z.number().nullable(),
          createdAt: z.string(),
        })
        .passthrough()
        .nullable(),
    }),
  },
  MarketBoard_serviceDetail: {
    method: "get",
    path: "/enterprise/market/:domain/services/:id",
    params: z.object({ domain: z.string(), id: z.string().uuid() }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          id: z.string(),
          listingId: z.string(),
          mine: z.boolean(),
          status: z.string(),
          subCategoryId: z.string(),
          category1: z.string(),
          category2: z.string(),
          credentialTypes: z.string(),
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
          highlights: z.array(z.string()),
          cases: z.string(),
          referenceLinks: z.array(z.string()),
          contactName: z.string(),
          contactPhone: z.string(),
          contactWechat: z.string(),
          contactEmail: z.string(),
          createdAt: z.string(),
        })
        .passthrough()
        .nullable(),
    }),
  },
  MarketBoard_marketplaceDetail: {
    method: "get",
    path: "/enterprise/market/:domain/marketplace/:id",
    params: z.object({ domain: z.string(), id: z.string().uuid() }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          id: z.string(),
          listingId: z.string(),
          mine: z.boolean(),
          status: z.string(),
          subCategoryId: z.string(),
          category1: z.string(),
          category2: z.string(),
          credentialTypes: z.string(),
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
          highlights: z.array(z.string()),
          cases: z.string(),
          referenceLinks: z.array(z.string()),
          contactName: z.string(),
          contactPhone: z.string(),
          contactWechat: z.string(),
          contactEmail: z.string(),
          createdAt: z.string(),
        })
        .passthrough()
        .nullable(),
    }),
  },
  Health_health: {
    method: "get",
    path: "/health",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ status: z.string(), service: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Health_version: {
    method: "get",
    path: "/health/version",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              service: z.string(),
              commit: z.string(),
              aiworkin_enabled: z.boolean(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Health_ready: {
    method: "get",
    path: "/health/ready",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              checks: z
                .object({
                  database: z.union([z.literal("up"), z.literal("down")]),
                })
                .passthrough(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_stats: {
    method: "get",
    path: "/enterprise/admin/stats",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              enterprises: z.number(),
              users: z.number(),
              providers: z.number(),
              pendingProvider: z.number(),
              activeContracts: z.number(),
              pendingContracts: z.number(),
              declarations: z.number(),
              taxAmountTotal: z.number(),
              overseas: z.number(),
              legalRequests: z.number(),
              ipRequests: z.number(),
              flexOrders: z.number(),
              marketingOrders: z.number(),
              logistics: z.number(),
              smartOrders: z.number(),
              lawyers: z.number(),
              ipAgencies: z.number(),
              flexProviders: z.number(),
              servicesByType: z.record(z.string(), z.number()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_enterprises: {
    method: "get",
    path: "/enterprise/admin/enterprises",
    params: z.object({}),
    query: z.object({ status: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                userId: z.string(),
                uscc: z.string(),
                province: z.string(),
                city: z.string(),
                auditNote: z.string(),
                subjectType: z.string(),
                idCard: z.string(),
                createdAt: z.string(),
                auditedAt: z.union([z.null(), z.string()]),
                name: z.string(),
                taxpayerType: z.string(),
                industry: z.string(),
                legalPerson: z.string(),
                phone: z.string(),
                address: z.string(),
                qxyOrgId: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Admin_apps: {
    method: "get",
    path: "/enterprise/admin/provider-applications",
    params: z.object({}),
    query: z.object({ status: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .array(
          providerApplicationSchema.extend({
            owner_name: z.string(),
            username: z.string(),
            account_status: z.string().optional(),
            account_status_label: z.string().optional(),
            itemAudits: z
              .array(
                z.object({
                  item: z.string().optional(),
                  status: z.string().optional(),
                  note: z.string().optional(),
                }),
              )
              .optional(),
          }),
        )
        .nullable(),
    }),
  },
  Admin_auditApp: {
    method: "post",
    path: "/enterprise/admin/provider-applications/:id/audit",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        action: z
          .union([z.literal("APPROVE"), z.literal("REJECT")])
          .optional()
          .optional(),
        note: z.string().optional().optional(),
        items: z
          .array(
            z
              .object({
                item: z.string().optional().optional(),
                status: z.string().optional().optional(),
                note: z.string().optional().optional(),
              })
              .passthrough(),
          )
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_providers: {
    method: "get",
    path: "/enterprise/admin/providers",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .array(
          providerApplicationSchema.extend({
            owner_name: z.string(),
            username: z.string(),
            account_status: z.string().optional(),
            account_status_label: z.string().optional(),
            itemAudits: z
              .array(
                z.object({
                  item: z.string().optional(),
                  status: z.string().optional(),
                  note: z.string().optional(),
                }),
              )
              .optional(),
          }),
        )
        .nullable(),
    }),
  },
  Admin_revoke: {
    method: "post",
    path: "/enterprise/admin/providers/:userId/services/:type/revoke",
    params: z.object({ userId: z.string(), type: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              providerUserId: z.string(),
              type: z.string(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_restore: {
    method: "post",
    path: "/enterprise/admin/providers/:userId/services/:type/restore",
    params: z.object({ userId: z.string(), type: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              providerUserId: z.string(),
              type: z.string(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_capabilityRequests: {
    method: "get",
    path: "/enterprise/admin/capabilities",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                label: z.union([
                  z.literal("电子报税（自动申报）"),
                  z.literal("电子开票（自动开票）"),
                ]),
                enterpriseName: z.string(),
                requestedByName: z.string(),
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                enterpriseId: z.number(),
                code: z.string(),
                note: z.string(),
                requestedBy: z.string(),
                openedBy: z.string(),
                updatedAt: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Admin_capabilityMatrix: {
    method: "get",
    path: "/enterprise/admin/enterprises/capabilities",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                enterpriseId: z.number(),
                name: z.string(),
                taxFiling: z.string(),
                invoicing: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Admin_capabilities: {
    method: "get",
    path: "/enterprise/admin/enterprises/:id/capabilities",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                code: z.string(),
                label: z.union([
                  z.literal("电子报税（自动申报）"),
                  z.literal("电子开票（自动开票）"),
                ]),
                status: z.string(),
                statusLabel: z.string(),
                note: z.string(),
                requestedByName: z.string(),
                updatedAt: z.union([z.null(), z.string()]),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Admin_setCapability: {
    method: "post",
    path: "/enterprise/admin/enterprises/:id/capabilities/:code",
    params: z.object({ id: z.string(), code: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        action: z.string().optional().optional(),
        note: z.string().optional().optional(),
        /** 审核通过时匹配的企享云账号 ID：写入企业税号绑定后能力生效。 */
        qxyAccountId: z.string().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              code: z.union([
                z.literal("E_TAX_FILING"),
                z.literal("E_INVOICING"),
              ]),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_settings: {
    method: "get",
    path: "/enterprise/admin/settings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.record(z.string(), z.string())]),
      })
      .passthrough(),
  },
  Admin_saveSettings: {
    method: "put",
    path: "/enterprise/admin/settings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.record(z.string(), z.string())]),
      })
      .passthrough(),
  },
  Geo_settings: {
    method: "get",
    path: "/enterprise/geo/settings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              providers: z.array(
                z
                  .object({
                    code: z.string(),
                    platform: z.string(),
                    label: z.string(),
                    purpose: z.string(),
                    modelHint: z.string(),
                    defaultBaseUrl: z.string(),
                    model: z.string(),
                    baseUrl: z.string(),
                    configured: z.boolean(),
                    source: z.union([z.literal("db"), z.literal("none")]),
                    updatedBy: z.string(),
                    updatedAt: z.union([z.null(), z.string()]),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_saveSettings: {
    method: "put",
    path: "/enterprise/geo/settings/:code",
    params: z.object({ code: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        apiKey: z.string().optional().optional(),
        model: z.string().optional().optional(),
        baseUrl: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              providers: z.array(
                z
                  .object({
                    code: z.string(),
                    platform: z.string(),
                    label: z.string(),
                    purpose: z.string(),
                    modelHint: z.string(),
                    defaultBaseUrl: z.string(),
                    model: z.string(),
                    baseUrl: z.string(),
                    configured: z.boolean(),
                    source: z.union([z.literal("db"), z.literal("none")]),
                    updatedBy: z.string(),
                    updatedAt: z.union([z.null(), z.string()]),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_clearSettings: {
    method: "delete",
    path: "/enterprise/geo/settings/:code",
    params: z.object({ code: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              providers: z.array(
                z
                  .object({
                    code: z.string(),
                    platform: z.string(),
                    label: z.string(),
                    purpose: z.string(),
                    modelHint: z.string(),
                    defaultBaseUrl: z.string(),
                    model: z.string(),
                    baseUrl: z.string(),
                    configured: z.boolean(),
                    source: z.union([z.literal("db"), z.literal("none")]),
                    updatedBy: z.string(),
                    updatedAt: z.union([z.null(), z.string()]),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_testSettings: {
    method: "post",
    path: "/enterprise/geo/settings/:code/test",
    params: z.object({ code: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              ok: z.boolean(),
              code: z.string(),
              label: z.string(),
              platform: z.string(),
              model: z.string(),
              baseUrl: z.string(),
              source: z.union([z.literal("db"), z.literal("none")]),
              elapsedMs: z.number(),
              reply: z.string(),
              promptTokens: z.number(),
              completionTokens: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_geoCollectionStats: {
    method: "get",
    path: "/enterprise/admin/geo-collection/stats",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              weekStart: z.string(),
              weekLabel: z.string(),
              windowStart: z.union([z.null(), z.string()]),
              windowEnd: z.union([z.null(), z.string()]),
              inWindow: z.boolean(),
              totals: z
                .object({
                  projects: z.number(),
                  planned: z.number(),
                  done: z.number(),
                  failed: z.number(),
                  pending: z.number(),
                })
                .passthrough(),
              runs: z.array(
                z
                  .object({
                    brand: z.string(),
                    industry: z.string(),
                    enabled: z.boolean(),
                    id: z.number(),
                    projectId: z.number(),
                    weekStart: z.string(),
                    periodLabel: z.string(),
                    status: z.string(),
                    planned: z.number(),
                    done: z.number(),
                    failed: z.number(),
                    pending: z.number(),
                    deferred: z.boolean(),
                    batchId: z.number(),
                    startedAt: z.union([z.null(), z.string()]),
                    finishedAt: z.union([z.null(), z.string()]),
                    windowStart: z.union([z.null(), z.string()]),
                    windowEnd: z.union([z.null(), z.string()]),
                    lastError: z.string(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_flexPayroll: {
    method: "get",
    path: "/enterprise/admin/flex-payroll",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ enabled: z.boolean(), updatedAt: z.string() })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_saveFlexPayroll: {
    method: "post",
    path: "/enterprise/admin/flex-payroll",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        enabled: z
          .union([z.literal(false), z.literal(true)])
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ enabled: z.boolean(), updatedAt: z.string() })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Admin_contracts: {
    method: "get",
    path: "/enterprise/admin/contracts",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                createdAt: z.string(),
                enterpriseId: z.number(),
                note: z.string(),
                updatedAt: z.string(),
                contractNo: z.string(),
                providerUserId: z.string(),
                providerOrg: z.string(),
                enterpriseName: z.string(),
                serviceType: z.string(),
                startDate: z.string(),
                endDate: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                designatedStaff: jsonValueSchema,
                designatedAgentId: z.number(),
                designatedAgentName: z.string(),
                designatedAgentOrg: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Aiworkin_status: {
    method: "get",
    path: "/enterprise/aiworkin/status",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ enabled: z.boolean(), baseUrl: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Aiworkin_categories: {
    method: "get",
    path: "/enterprise/aiworkin/categories",
    params: z.object({}),
    query: z.object({ domain: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              modules: z.array(
                z
                  .object({
                    domain: z.union([
                      z.literal("LOGISTICS"),
                      z.literal("IP"),
                      z.literal("LEGAL"),
                      z.literal("FLEX"),
                      z.literal("MARKETING"),
                      z.literal("ASSET"),
                      z.literal("SMART"),
                      z.literal("TAX"),
                      z.literal("SUPPLY"),
                      z.literal("OVERSEAS"),
                      z.literal("THINK_TANK"),
                    ]),
                    label: z.string(),
                    category1: z.string(),
                    category1Id: z.string(),
                    category2Options: z.array(
                      z
                        .object({
                          id: z.string(),
                          key: z.string(),
                          label: z.string(),
                          credentialTypes: z.array(z.string()),
                          manualOnly: z.boolean(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Aiworkin_myDemands: {
    method: "get",
    path: "/enterprise/aiworkin/demands",
    params: z.object({}),
    query: z
      .object({
        page: z.string().optional(),
        pageSize: z.string().optional(),
        direction: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(z.record(z.string(), z.unknown())),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Aiworkin_marketListings: {
    method: "get",
    path: "/enterprise/aiworkin/market/listings",
    params: z.object({}),
    query: z
      .object({
        page: z.string().optional(),
        pageSize: z.string().optional(),
        direction: z.string().optional(),
        keyword: z.string().optional(),
        category: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        status: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(z.record(z.string(), z.unknown())),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Aiworkin_demandDetail: {
    method: "get",
    path: "/enterprise/aiworkin/demands/:listingId",
    params: z.object({ listingId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.record(z.string(), z.unknown())]),
      })
      .passthrough(),
  },
  Aiworkin_publishDemand: {
    method: "post",
    path: "/enterprise/aiworkin/demands",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        title: z.string(),
        description: z.string(),
        direction: z
          .union([z.literal("SUPPLY"), z.literal("DEMAND")])
          .optional()
          .optional(),
        subcategoryId: z.string().optional().optional(),
        demandMode: z
          .union([z.literal("STANDARD"), z.literal("BOUNTY")])
          .optional()
          .optional(),
        moneyMode: z
          .union([
            z.literal("FIXED"),
            z.literal("STARTING"),
            z.literal("RANGE"),
            z.literal("NEGOTIABLE"),
          ])
          .optional()
          .optional(),
        currency: z.string().optional().optional(),
        amountMin: z.number().optional().optional(),
        amountMax: z.number().optional().optional(),
        unitLabel: z.string().optional().optional(),
        tags: z.array(z.string()).optional().optional(),
        expectedOutcome: z.string().optional().optional(),
        mustHaves: z.array(z.string()).optional().optional(),
        startAt: z.string().optional().optional(),
        deadline: z.string().optional().optional(),
        deliverables: z.string().optional().optional(),
        acceptanceCriteria: z.string().optional().optional(),
        referenceLinks: z.array(z.string()).optional().optional(),
        attributes: z.record(z.string(), z.unknown()).optional().optional(),
        a2aConfig: z
          .object({
            geoMatchMode: z.union([
              z.literal("NONE"),
              z.literal("REGION"),
              z.literal("RADIUS"),
            ]),
            province: z.string().optional().optional(),
            city: z.string().optional().optional(),
            addressDetail: z.string().optional().optional(),
            longitude: z.number().optional().optional(),
            latitude: z.number().optional().optional(),
            radiusKm: z.number().optional().optional(),
          })
          .passthrough()
          .optional()
          .optional(),
        contactName: z.string().optional().optional(),
        contactPhone: z.string().optional().optional(),
        contactWechat: z.string().optional().optional(),
        contactEmail: z.string().optional().optional(),
        replyEmailEnabled: z
          .union([z.literal(false), z.literal(true)])
          .optional()
          .optional(),
        replyEmail: z.string().optional().optional(),
        expiresAt: z.string().optional().optional(),
        publishAction: z
          .union([z.literal("DRAFT"), z.literal("PUBLISH")])
          .optional()
          .optional(),
        priceDescription: z.string().optional().optional(),
        highlights: z.array(z.string()).optional().optional(),
        cases: z.string().optional().optional(),
        deliveryMode: z
          .union([
            z.literal("REMOTE"),
            z.literal("ONSITE"),
            z.literal("HYBRID"),
          ])
          .optional()
          .optional(),
        responseTime: z.string().optional().optional(),
        qualifications: z.string().optional().optional(),
        serviceArea: z
          .object({
            mode: z.union([
              z.literal("REGION"),
              z.literal("RADIUS"),
              z.literal("REMOTE"),
              z.literal("NATIONWIDE"),
            ]),
            province: z.string().optional().optional(),
            city: z.string().optional().optional(),
            addressDetail: z.string().optional().optional(),
            longitude: z.number().optional().optional(),
            latitude: z.number().optional().optional(),
            radiusKm: z.number().optional().optional(),
          })
          .passthrough()
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              listing: z.record(z.string(), z.unknown()),
              initialMatchRunId: z
                .union([z.null(), z.string()])
                .optional()
                .optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Aiworkin_removeDemand: {
    method: "delete",
    path: "/enterprise/aiworkin/demands/:listingId",
    params: z.object({ listingId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.record(z.string(), z.unknown())]),
      })
      .passthrough(),
  },
  Aiworkin_demandConversations: {
    method: "get",
    path: "/enterprise/aiworkin/demands/:listingId/conversations",
    params: z.object({ listingId: z.string() }),
    query: z
      .object({ page: z.string().optional(), pageSize: z.string().optional() })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(z.record(z.string(), z.unknown())),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Aiworkin_conversations: {
    method: "get",
    path: "/enterprise/aiworkin/conversations",
    params: z.object({}),
    query: z
      .object({
        page: z.string().optional(),
        pageSize: z.string().optional(),
        matchRunId: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(z.record(z.string(), z.unknown())),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Aiworkin_conversation: {
    method: "get",
    path: "/enterprise/aiworkin/conversations/:conversationId",
    params: z.object({ conversationId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.record(z.string(), z.unknown())]),
      })
      .passthrough(),
  },
  Aiworkin_reply: {
    method: "post",
    path: "/enterprise/aiworkin/conversations/:conversationId/replies",
    params: z.object({ conversationId: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        content: z.string().optional().optional(),
        idempotencyKey: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.record(z.string(), z.unknown())]),
      })
      .passthrough(),
  },
  Aiworkin_profile: {
    method: "get",
    path: "/enterprise/aiworkin/profile",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.record(z.string(), z.unknown())]),
      })
      .passthrough(),
  },
  Aiworkin_saveProfile: {
    method: "put",
    path: "/enterprise/aiworkin/profile",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        primaryLocale: z.string().optional().optional(),
        publicNameZh: z.string().optional().optional(),
        publicNameEn: z.string().optional().optional(),
        headlineZh: z.string().optional().optional(),
        headlineEn: z.string().optional().optional(),
        introductionZh: z.string().optional().optional(),
        introductionEn: z.string().optional().optional(),
        tagsZh: z.array(z.string()).optional().optional(),
        tagsEn: z.array(z.string()).optional().optional(),
        avatarOrLogoUrl: z.string().optional().optional(),
        province: z.string().optional().optional(),
        city: z.string().optional().optional(),
        contactEmail: z.string().optional().optional(),
        contactPhone: z.string().optional().optional(),
        contactWechat: z.string().optional().optional(),
        emailVisible: z
          .union([z.literal(false), z.literal(true)])
          .optional()
          .optional(),
        phoneVisible: z
          .union([z.literal(false), z.literal(true)])
          .optional()
          .optional(),
        wechatVisible: z
          .union([z.literal(false), z.literal(true)])
          .optional()
          .optional(),
        identityDetails: z
          .object({
            kind: z.union([z.literal("personal"), z.literal("company")]),
            occupationTitle: z.string().optional().optional(),
            experienceRange: z.string().optional().optional(),
            organizationName: z.string().optional().optional(),
            industryKey: z.string().optional().optional(),
            companySizeKey: z.string().optional().optional(),
            foundedYear: z.number().optional().optional(),
            websiteUrl: z.string().optional().optional(),
          })
          .passthrough()
          .optional()
          .optional(),
        capabilities: z
          .array(
            z
              .object({
                kind: z.string().optional().optional(),
                titleZh: z.string().optional().optional(),
                titleEn: z.string().optional().optional(),
                descriptionZh: z.string().optional().optional(),
                descriptionEn: z.string().optional().optional(),
                proofUrl: z.string().optional().optional(),
                url: z.string().optional().optional(),
                sortOrder: z.number().optional().optional(),
              })
              .passthrough(),
          )
          .optional()
          .optional(),
        credentials: z
          .array(
            z
              .object({
                kind: z.string().optional().optional(),
                titleZh: z.string().optional().optional(),
                titleEn: z.string().optional().optional(),
                descriptionZh: z.string().optional().optional(),
                descriptionEn: z.string().optional().optional(),
                proofUrl: z.string().optional().optional(),
                url: z.string().optional().optional(),
                sortOrder: z.number().optional().optional(),
              })
              .passthrough(),
          )
          .optional()
          .optional(),
        cases: z
          .array(
            z
              .object({
                kind: z.string().optional().optional(),
                titleZh: z.string().optional().optional(),
                titleEn: z.string().optional().optional(),
                descriptionZh: z.string().optional().optional(),
                descriptionEn: z.string().optional().optional(),
                proofUrl: z.string().optional().optional(),
                url: z.string().optional().optional(),
                sortOrder: z.number().optional().optional(),
              })
              .passthrough(),
          )
          .optional()
          .optional(),
        links: z
          .array(
            z
              .object({
                kind: z.string().optional().optional(),
                titleZh: z.string().optional().optional(),
                titleEn: z.string().optional().optional(),
                descriptionZh: z.string().optional().optional(),
                descriptionEn: z.string().optional().optional(),
                proofUrl: z.string().optional().optional(),
                url: z.string().optional().optional(),
                sortOrder: z.number().optional().optional(),
              })
              .passthrough(),
          )
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.record(z.string(), z.unknown())]),
      })
      .passthrough(),
  },
  Connections_resources: {
    method: "get",
    path: "/enterprise/connections/resources",
    params: z.object({}),
    query: z.object({}).catchall(z.unknown()),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(z.record(z.string(), z.unknown())),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
              source: z.literal("AIWORKIN"),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_locations: {
    method: "get",
    path: "/enterprise/connections/resources/locations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(
                z
                  .object({
                    label: z.string(),
                    value: z.string(),
                    children: z
                      .array(
                        z
                          .object({ label: z.string(), value: z.string() })
                          .passthrough(),
                      )
                      .default([]),
                  })
                  .passthrough(),
              ),
              // LOCAL：未配置平台 AIPDD Key / 上游通道关闭时回落的本地内置省市字典
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_contact: {
    method: "get",
    path: "/enterprise/connections/resources/:sourceType/:resourceId/contact",
    params: z.object({ sourceType: z.string(), resourceId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              wechat: z.string().optional(),
              phone: z.string().optional(),
              email: z.string().optional(),
              source: z.literal("AIWORKIN"),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_dictionary: {
    method: "get",
    path: "/enterprise/connections/dictionaries/:code/items",
    params: z.object({ code: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(
                z.object({ key: z.string(), label: z.string() }).passthrough(),
              ),
              source: z.literal("AIWORKIN"),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_favorites: {
    method: "get",
    path: "/enterprise/connections/favorites/marketing",
    params: z.object({}),
    query: z
      .object({ page: z.string().optional(), pageSize: z.string().optional() })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(z.record(z.string(), z.unknown())),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
              source: z.literal("AIWORKIN"),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_profileFavorites: {
    method: "get",
    path: "/enterprise/connections/favorites/profiles",
    params: z.object({}),
    query: z.object({}).catchall(z.unknown()),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              list: z.array(z.record(z.string(), z.unknown())),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
              source: z.literal("AIWORKIN"),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_addFavorite: {
    method: "post",
    path: "/enterprise/connections/favorites/talent/:resourceId",
    params: z.object({ resourceId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ favorited: z.boolean(), source: z.literal("AIWORKIN") })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_removeFavorite: {
    method: "delete",
    path: "/enterprise/connections/favorites/talent/:resourceId",
    params: z.object({ resourceId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ favorited: z.boolean(), source: z.literal("AIWORKIN") })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_addProfileFavorite: {
    method: "post",
    path: "/enterprise/connections/favorites/profile/:resourceId",
    params: z.object({ resourceId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ favorited: z.boolean(), source: z.literal("AIWORKIN") })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Connections_removeProfileFavorite: {
    method: "delete",
    path: "/enterprise/connections/favorites/profile/:resourceId",
    params: z.object({ resourceId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ favorited: z.boolean(), source: z.literal("AIWORKIN") })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Asset_list: {
    method: "get",
    path: "/enterprise/asset",
    params: z.object({}),
    query: z
      .object({ province: z.string().optional(), city: z.string().optional() })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                messages: z.array(
                  z
                    .object({
                      role: z.union([
                        z.literal("ENTERPRISE"),
                        z.literal("PROVIDER"),
                        z.literal("SYSTEM"),
                      ]),
                      name: z.string(),
                      time: z.string(),
                      text: z.string(),
                      reply_to: z.string().optional().optional(),
                    })
                    .passthrough(),
                ),
                events: z.array(
                  z
                    .object({
                      time: z.string(),
                      status: z.string(),
                      text: z.string(),
                    })
                    .passthrough(),
                ),
                conversationCount: z.number(),
                feedback: z
                  .object({ n: z.number(), m: z.number(), label: z.string() })
                  .passthrough(),
                status: z.string(),
                category1: z.string(),
                category2: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Asset_create: {
    method: "post",
    path: "/enterprise/asset",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              request_no: z.string(),
              status: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Asset_accept: {
    method: "post",
    path: "/enterprise/asset/:id/accept",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              provider_id: z.string(),
              provider_name: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Asset_update: {
    method: "patch",
    path: "/enterprise/asset/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Asset_remove: {
    method: "delete",
    path: "/enterprise/asset/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Asset_messages: {
    method: "get",
    path: "/enterprise/asset/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              requestId: z.number(),
              request_no: z.string(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Asset_postMessage: {
    method: "post",
    path: "/enterprise/asset/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        text: z.string().optional().optional(),
        conversation_id: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              requestId: z.number(),
              request_no: z.string(),
              messages: z.array(
                z
                  .object({
                    role: z.union([
                      z.literal("ENTERPRISE"),
                      z.literal("PROVIDER"),
                      z.literal("SYSTEM"),
                    ]),
                    name: z.string(),
                    time: z.string(),
                    text: z.string(),
                    reply_to: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              aiworkin_sync: z.boolean(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Asset_updateContacts: {
    method: "post",
    path: "/enterprise/asset/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Capability_mine: {
    method: "get",
    path: "/enterprise/capabilities",
    params: z.object({}),
    query: z.object({ enterpriseId: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                code: z.string(),
                label: z.union([
                  z.literal("电子报税（自动申报）"),
                  z.literal("电子开票（自动开票）"),
                ]),
                status: z.string(),
                statusLabel: z.string(),
                note: z.string(),
                requestedByName: z.string(),
                updatedAt: z.union([z.null(), z.string()]),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Capability_served: {
    method: "get",
    path: "/enterprise/capabilities/served",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                enterpriseId: z.number(),
                name: z.string(),
                canConfigure: z.boolean(),
                /** 企业税号：平台按此匹配企享云 API Key。 */
                taxNo: z.string().optional(),
                capabilities: z.array(
                  z
                    .object({
                      code: z.string(),
                      label: z.union([
                        z.literal("电子报税（自动申报）"),
                        z.literal("电子开票（自动开票）"),
                      ]),
                      status: z.string(),
                      statusLabel: z.string(),
                      note: z.string(),
                      requestedByName: z.string(),
                      updatedAt: z.union([z.null(), z.string()]),
                    })
                    .passthrough(),
                ),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Capability_request: {
    method: "post",
    path: "/enterprise/capabilities/:code/request",
    params: z.object({ code: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        note: z.string().optional().optional(),
        enterpriseId: z.number().optional().optional(),
        /** 开通时间（YYYY-MM-DD）：服务商提交审核时必填，平台后台可见。 */
        opensAt: z.string().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              enterpriseId: z.number(),
              code: z.union([
                z.literal("E_TAX_FILING"),
                z.literal("E_INVOICING"),
              ]),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Capability_cancel: {
    method: "post",
    path: "/enterprise/capabilities/:code/cancel",
    params: z.object({ code: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({ enterpriseId: z.number().optional().optional() })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              enterpriseId: z.number(),
              code: z.union([
                z.literal("E_TAX_FILING"),
                z.literal("E_INVOICING"),
              ]),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Contracts_list: {
    method: "get",
    path: "/enterprise/contracts",
    params: z.object({}),
    query: pageQuerySchema,
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          pageSchema(
            z
              .object({
                contact_name: z.string(),
                contact_phone: z.string(),
                provider_contact_name: z.string(),
                provider_contact_phone: z.string(),
                provider_name: z.string(),
                business_staff: z.array(
                  z
                    .object({
                      name: z.string(),
                      title: z.string(),
                      phone: z.string(),
                      email: z.string(),
                    })
                    .passthrough(),
                ),
                designated_staff: z.record(z.string(), z.unknown()),
                designated_agent: z.union([
                  z.null(),
                  z
                    .object({
                      id: z.number(),
                      name: z.string(),
                      org: z.string(),
                    })
                    .passthrough(),
                ]),
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                createdAt: z.string(),
                enterpriseId: z.number(),
                note: z.string(),
                updatedAt: z.string(),
                contractNo: z.string(),
                providerUserId: z.string(),
                providerOrg: z.string(),
                enterpriseName: z.string(),
                serviceType: z.string(),
                startDate: z.string(),
                endDate: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                designatedStaff: z
                  .object({
                    name: z.string().optional(),
                    title: z.string().optional(),
                    phone: z.string().optional(),
                    email: z.string().optional(),
                  })
                  .passthrough()
                  .nullable(),
                designatedAgentId: z.number(),
                designatedAgentName: z.string(),
                designatedAgentOrg: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Contracts_stats: {
    method: "get",
    path: "/enterprise/contracts/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({ total: z.number(), active: z.number(), pending: z.number() })
        .nullable(),
    }),
  },
  Contracts_options: {
    method: "get",
    path: "/enterprise/contracts/options",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                contact_name: z.string(),
                contact_phone: z.string(),
                provider_contact_name: z.string(),
                provider_contact_phone: z.string(),
                provider_name: z.string(),
                business_staff: z.array(
                  z
                    .object({
                      name: z.string(),
                      title: z.string(),
                      phone: z.string(),
                      email: z.string(),
                    })
                    .passthrough(),
                ),
                designated_staff: z.record(z.string(), z.unknown()),
                designated_agent: z.union([
                  z.null(),
                  z
                    .object({
                      id: z.number(),
                      name: z.string(),
                      org: z.string(),
                    })
                    .passthrough(),
                ]),
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                createdAt: z.string(),
                enterpriseId: z.number(),
                note: z.string(),
                updatedAt: z.string(),
                contractNo: z.string(),
                providerUserId: z.string(),
                providerOrg: z.string(),
                enterpriseName: z.string(),
                serviceType: z.string(),
                startDate: z.string(),
                endDate: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                designatedStaff: z
                  .object({
                    name: z.string().optional(),
                    title: z.string().optional(),
                    phone: z.string().optional(),
                    email: z.string().optional(),
                  })
                  .passthrough()
                  .nullable(),
                designatedAgentId: z.number(),
                designatedAgentName: z.string(),
                designatedAgentOrg: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Contracts_candidates: {
    method: "get",
    path: "/enterprise/contracts/candidates",
    params: z.object({}),
    query: z.object({ serviceType: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                providerUserId: z.string(),
                org_name: z.string(),
                provider_type: z.string(),
                service_items: z.string(),
                contact_name: z.string(),
                contact_phone: z.string(),
                contact_email: z.string(),
                intro: z.string(),
                business_staff: z.array(z.unknown()),
                display_name: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Contracts_providers: {
    method: "get",
    path: "/enterprise/contracts/providers",
    params: z.object({}),
    query: z
      .object({
        serviceType: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(directoryProviderSchema)]),
      })
      .passthrough(),
  },
  Contracts_enterprises: {
    method: "get",
    path: "/enterprise/contracts/my-enterprises",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                staffUserId: z.string(),
                status: z.string(),
                id: z.number(),
                userId: z.string(),
                uscc: z.string(),
                province: z.string(),
                city: z.string(),
                auditNote: z.string(),
                subjectType: z.string(),
                idCard: z.string(),
                createdAt: z.string(),
                auditedAt: z.union([z.null(), z.string()]),
                name: z.string(),
                taxpayerType: z.string(),
                industry: z.string(),
                legalPerson: z.string(),
                phone: z.string(),
                address: z.string(),
                qxyOrgId: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Contracts_create: {
    method: "post",
    path: "/enterprise/contracts",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              reused: z.boolean(),
              designated_agent: z.union([
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    staffUserId: z.string(),
                    phone: z.string(),
                  })
                  .passthrough(),
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    phone: z.string(),
                    staffUserId: z.unknown().optional(),
                  })
                  .passthrough(),
              ]),
            })
            .passthrough(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              status: z.string(),
              service_type: z.string(),
              provider_name: z.string(),
              designated_agent: z.union([
                z.null(),
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    staffUserId: z.string(),
                    phone: z.string(),
                  })
                  .passthrough(),
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    phone: z.string(),
                    staffUserId: z.unknown().optional(),
                  })
                  .passthrough(),
              ]),
              reused: z.unknown().optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Contracts_updateTerms: {
    method: "patch",
    path: "/enterprise/contracts/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              start_date: z.string(),
              end_date: z.string(),
              note: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Contracts_remove: {
    method: "delete",
    path: "/enterprise/contracts/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), removed: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Contracts_updateContacts: {
    method: "post",
    path: "/enterprise/contracts/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Contracts_confirm: {
    method: "post",
    path: "/enterprise/contracts/:id/confirm",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Contracts_terminate: {
    method: "post",
    path: "/enterprise/contracts/:id/terminate",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Contracts_staff: {
    method: "post",
    path: "/enterprise/contracts/:id/designate-staff",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              designated_staff: z
                .object({
                  name: z.string(),
                  title: z.string(),
                  phone: z.string(),
                  email: z.string(),
                })
                .passthrough(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Contracts_agent: {
    method: "post",
    path: "/enterprise/contracts/:id/designate-agent",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              designated_agent: z.union([
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    staffUserId: z.string(),
                    phone: z.string(),
                  })
                  .passthrough(),
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    phone: z.string(),
                    staffUserId: z.unknown().optional(),
                  })
                  .passthrough(),
              ]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_channels: {
    method: "get",
    path: "/enterprise/external/channels",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                code: z.string(),
                name: z.string(),
                bizType: z.string(),
                enabled: z.boolean(),
                implemented: z.boolean(),
                config: jsonValueSchema,
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  External_submissions: {
    method: "get",
    path: "/enterprise/external/submissions",
    params: z.object({}),
    query: z
      .object({
        status: z.string().optional(),
        bizType: z.string().optional(),
        refType: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                taxTypeLabel: z.string(),
                statusLabel: z.union([
                  z.literal("待报送"),
                  z.literal("报送中"),
                  z.literal("已受理"),
                  z.literal("已取得回执"),
                  z.literal("已完税"),
                  z.literal("已退回"),
                  z.literal("已作废"),
                ]),
                enterpriseName: z.string(),
                canAct: z.boolean(),
                id: z.number(),
                bizType: z.string(),
                refType: z.string(),
                refId: z.number(),
                refNo: z.string(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                staffUserId: z.string(),
                channelCode: z.string(),
                period: z.string(),
                taxType: z.string(),
                targetSystem: z.string(),
                payload: z.record(z.string(), z.unknown()),
                payloadHash: z.string(),
                status: z.string(),
                acceptNo: z.string(),
                receiptNo: z.string(),
                errorCode: z.string(),
                errorMsg: z.string(),
                attempts: z.number(),
                guide: z
                  .object({
                    system: z.string().optional(),
                    entry: z.string().optional(),
                    credential: z.string().optional(),
                    steps: z.array(z.string()).optional(),
                    fields: z
                      .array(
                        z.object({
                          key: z.string(),
                          label: z.string(),
                          required: z.boolean(),
                        }),
                      )
                      .optional(),
                    notice: z.string().optional(),
                  })
                  .passthrough(),
                timeline: z.array(
                  z
                    .object({
                      at: z.string(),
                      action: z.string(),
                      text: z.string(),
                      actorId: z.string(),
                      from: z.string().optional().optional(),
                      to: z.string().optional().optional(),
                      acceptNo: z.string().optional().optional(),
                      receiptNo: z.string().optional().optional(),
                    })
                    .passthrough(),
                ),
                submittedBy: z.string(),
                submittedAt: z.union([z.null(), z.string()]),
                createdAt: z.string(),
                updatedAt: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  External_byRef: {
    method: "get",
    path: "/enterprise/external/submissions/by-ref",
    params: z.object({}),
    query: z
      .object({ refType: z.string().optional(), refId: z.string().optional() })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                taxTypeLabel: z.string(),
                statusLabel: z.union([
                  z.literal("待报送"),
                  z.literal("报送中"),
                  z.literal("已受理"),
                  z.literal("已取得回执"),
                  z.literal("已完税"),
                  z.literal("已退回"),
                  z.literal("已作废"),
                ]),
                enterpriseName: z.string(),
                canAct: z.boolean(),
                id: z.number(),
                bizType: z.string(),
                refType: z.string(),
                refId: z.number(),
                refNo: z.string(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                staffUserId: z.string(),
                channelCode: z.string(),
                period: z.string(),
                taxType: z.string(),
                targetSystem: z.string(),
                payload: z.record(z.string(), z.unknown()),
                payloadHash: z.string(),
                status: z.string(),
                acceptNo: z.string(),
                receiptNo: z.string(),
                errorCode: z.string(),
                errorMsg: z.string(),
                attempts: z.number(),
                guide: z
                  .object({
                    system: z.string().optional(),
                    entry: z.string().optional(),
                    credential: z.string().optional(),
                    steps: z.array(z.string()).optional(),
                    fields: z
                      .array(
                        z.object({
                          key: z.string(),
                          label: z.string(),
                          required: z.boolean(),
                        }),
                      )
                      .optional(),
                    notice: z.string().optional(),
                  })
                  .passthrough(),
                timeline: z.array(
                  z
                    .object({
                      at: z.string(),
                      action: z.string(),
                      text: z.string(),
                      actorId: z.string(),
                      from: z.string().optional().optional(),
                      to: z.string().optional().optional(),
                      acceptNo: z.string().optional().optional(),
                      receiptNo: z.string().optional().optional(),
                    })
                    .passthrough(),
                ),
                submittedBy: z.string(),
                submittedAt: z.union([z.null(), z.string()]),
                createdAt: z.string(),
                updatedAt: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  External_detail: {
    method: "get",
    path: "/enterprise/external/submissions/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              callbacks: z.array(
                z
                  .object({
                    id: z.number(),
                    source: z.string(),
                    rawBody: z.string(),
                    signatureValid: z.boolean(),
                    receivedAt: z.string(),
                  })
                  .passthrough(),
              ),
              canAct: z.boolean(),
              taxTypeLabel: z.string(),
              statusLabel: z.union([
                z.literal("待报送"),
                z.literal("报送中"),
                z.literal("已受理"),
                z.literal("已取得回执"),
                z.literal("已完税"),
                z.literal("已退回"),
                z.literal("已作废"),
              ]),
              enterpriseName: z.string(),
              id: z.number(),
              bizType: z.string(),
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              enterpriseId: z.number(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              channelCode: z.string(),
              period: z.string(),
              taxType: z.string(),
              targetSystem: z.string(),
              payload: z.record(z.string(), z.unknown()),
              payloadHash: z.string(),
              status: z.string(),
              acceptNo: z.string(),
              receiptNo: z.string(),
              errorCode: z.string(),
              errorMsg: z.string(),
              attempts: z.number(),
              guide: z
                .object({
                  system: z.string().optional(),
                  entry: z.string().optional(),
                  credential: z.string().optional(),
                  steps: z.array(z.string()).optional(),
                  fields: z
                    .array(
                      z.object({
                        key: z.string(),
                        label: z.string(),
                        required: z.boolean(),
                      }),
                    )
                    .optional(),
                  notice: z.string().optional(),
                })
                .passthrough(),
              timeline: z.array(
                z
                  .object({
                    at: z.string(),
                    action: z.string(),
                    text: z.string(),
                    actorId: z.string(),
                    from: z.string().optional().optional(),
                    to: z.string().optional().optional(),
                    acceptNo: z.string().optional().optional(),
                    receiptNo: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              submittedBy: z.string(),
              submittedAt: z.union([z.null(), z.string()]),
              createdAt: z.string(),
              updatedAt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_preview: {
    method: "get",
    path: "/enterprise/external/declarations/:declId/preview",
    params: z.object({ declId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              taxType: z.string(),
              taxTypeLabel: z.string(),
              period: z.string(),
              payload: z.record(z.string(), z.unknown()),
              payloadHash: z.string(),
              guide: z
                .object({
                  system: z.string(),
                  entry: z.string(),
                  credential: z.string(),
                  steps: z.array(z.string()),
                  fields: z.array(
                    z
                      .object({
                        key: z.string(),
                        label: z.string(),
                        required: z.boolean(),
                      })
                      .passthrough(),
                  ),
                  notice: z.string(),
                })
                .passthrough(),
              targetSystem: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_create: {
    method: "post",
    path: "/enterprise/external/declarations/:declId/submission",
    params: z.object({ declId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              enterpriseId: z.number(),
              updatedAt: z.string(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              bizType: z.string(),
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              channelCode: z.string(),
              period: z.string(),
              taxType: z.string(),
              targetSystem: z.string(),
              payload: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              payloadHash: z.string(),
              acceptNo: z.string(),
              receiptNo: z.string(),
              errorCode: z.string(),
              errorMsg: z.string(),
              attempts: z.number(),
              guide: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              timeline: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              submittedBy: z.string(),
              submittedAt: z.union([z.null(), z.string()]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_submit: {
    method: "post",
    path: "/enterprise/external/submissions/:id/submit",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({ acceptNo: z.string().optional().optional() })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              taxTypeLabel: z.string(),
              statusLabel: z.union([
                z.literal("待报送"),
                z.literal("报送中"),
                z.literal("已受理"),
                z.literal("已取得回执"),
                z.literal("已完税"),
                z.literal("已退回"),
                z.literal("已作废"),
              ]),
              enterpriseName: z.string(),
              canAct: z.boolean(),
              id: z.number(),
              bizType: z.string(),
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              enterpriseId: z.number(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              channelCode: z.string(),
              period: z.string(),
              taxType: z.string(),
              targetSystem: z.string(),
              payload: z.unknown(),
              payloadHash: z.string(),
              status: z.string(),
              acceptNo: z.string(),
              receiptNo: z.string(),
              errorCode: z.string(),
              errorMsg: z.string(),
              attempts: z.number(),
              guide: z
                .object({
                  system: z.string().optional(),
                  entry: z.string().optional(),
                  credential: z.string().optional(),
                  steps: z.array(z.string()).optional(),
                  fields: z
                    .array(
                      z.object({
                        key: z.string(),
                        label: z.string(),
                        required: z.boolean(),
                      }),
                    )
                    .optional(),
                  notice: z.string().optional(),
                })
                .passthrough(),
              timeline: z.array(
                z
                  .object({
                    at: z.string(),
                    action: z.string(),
                    text: z.string(),
                    actorId: z.string(),
                    from: z.string().optional().optional(),
                    to: z.string().optional().optional(),
                    acceptNo: z.string().optional().optional(),
                    receiptNo: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              submittedBy: z.string(),
              submittedAt: z.union([z.null(), z.string()]),
              createdAt: z.string(),
              updatedAt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_receipt: {
    method: "post",
    path: "/enterprise/external/submissions/:id/receipt",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        receiptNo: z.string().optional().optional(),
        rawBody: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              taxTypeLabel: z.string(),
              statusLabel: z.union([
                z.literal("待报送"),
                z.literal("报送中"),
                z.literal("已受理"),
                z.literal("已取得回执"),
                z.literal("已完税"),
                z.literal("已退回"),
                z.literal("已作废"),
              ]),
              enterpriseName: z.string(),
              canAct: z.boolean(),
              id: z.number(),
              bizType: z.string(),
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              enterpriseId: z.number(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              channelCode: z.string(),
              period: z.string(),
              taxType: z.string(),
              targetSystem: z.string(),
              payload: z.unknown(),
              payloadHash: z.string(),
              status: z.string(),
              acceptNo: z.string(),
              receiptNo: z.string(),
              errorCode: z.string(),
              errorMsg: z.string(),
              attempts: z.number(),
              guide: z
                .object({
                  system: z.string().optional(),
                  entry: z.string().optional(),
                  credential: z.string().optional(),
                  steps: z.array(z.string()).optional(),
                  fields: z
                    .array(
                      z.object({
                        key: z.string(),
                        label: z.string(),
                        required: z.boolean(),
                      }),
                    )
                    .optional(),
                  notice: z.string().optional(),
                })
                .passthrough(),
              timeline: z.array(
                z
                  .object({
                    at: z.string(),
                    action: z.string(),
                    text: z.string(),
                    actorId: z.string(),
                    from: z.string().optional().optional(),
                    to: z.string().optional().optional(),
                    acceptNo: z.string().optional().optional(),
                    receiptNo: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              submittedBy: z.string(),
              submittedAt: z.union([z.null(), z.string()]),
              createdAt: z.string(),
              updatedAt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_pay: {
    method: "post",
    path: "/enterprise/external/submissions/:id/pay",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              taxTypeLabel: z.string(),
              statusLabel: z.union([
                z.literal("待报送"),
                z.literal("报送中"),
                z.literal("已受理"),
                z.literal("已取得回执"),
                z.literal("已完税"),
                z.literal("已退回"),
                z.literal("已作废"),
              ]),
              enterpriseName: z.string(),
              canAct: z.boolean(),
              id: z.number(),
              bizType: z.string(),
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              enterpriseId: z.number(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              channelCode: z.string(),
              period: z.string(),
              taxType: z.string(),
              targetSystem: z.string(),
              payload: z.unknown(),
              payloadHash: z.string(),
              status: z.string(),
              acceptNo: z.string(),
              receiptNo: z.string(),
              errorCode: z.string(),
              errorMsg: z.string(),
              attempts: z.number(),
              guide: z
                .object({
                  system: z.string().optional(),
                  entry: z.string().optional(),
                  credential: z.string().optional(),
                  steps: z.array(z.string()).optional(),
                  fields: z
                    .array(
                      z.object({
                        key: z.string(),
                        label: z.string(),
                        required: z.boolean(),
                      }),
                    )
                    .optional(),
                  notice: z.string().optional(),
                })
                .passthrough(),
              timeline: z.array(
                z
                  .object({
                    at: z.string(),
                    action: z.string(),
                    text: z.string(),
                    actorId: z.string(),
                    from: z.string().optional().optional(),
                    to: z.string().optional().optional(),
                    acceptNo: z.string().optional().optional(),
                    receiptNo: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              submittedBy: z.string(),
              submittedAt: z.union([z.null(), z.string()]),
              createdAt: z.string(),
              updatedAt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_reject: {
    method: "post",
    path: "/enterprise/external/submissions/:id/reject",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        errorCode: z.string().optional().optional(),
        errorMsg: z.string().optional().optional(),
        rawBody: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              taxTypeLabel: z.string(),
              statusLabel: z.union([
                z.literal("待报送"),
                z.literal("报送中"),
                z.literal("已受理"),
                z.literal("已取得回执"),
                z.literal("已完税"),
                z.literal("已退回"),
                z.literal("已作废"),
              ]),
              enterpriseName: z.string(),
              canAct: z.boolean(),
              id: z.number(),
              bizType: z.string(),
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              enterpriseId: z.number(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              channelCode: z.string(),
              period: z.string(),
              taxType: z.string(),
              targetSystem: z.string(),
              payload: z.unknown(),
              payloadHash: z.string(),
              status: z.string(),
              acceptNo: z.string(),
              receiptNo: z.string(),
              errorCode: z.string(),
              errorMsg: z.string(),
              attempts: z.number(),
              guide: z
                .object({
                  system: z.string().optional(),
                  entry: z.string().optional(),
                  credential: z.string().optional(),
                  steps: z.array(z.string()).optional(),
                  fields: z
                    .array(
                      z.object({
                        key: z.string(),
                        label: z.string(),
                        required: z.boolean(),
                      }),
                    )
                    .optional(),
                  notice: z.string().optional(),
                })
                .passthrough(),
              timeline: z.array(
                z
                  .object({
                    at: z.string(),
                    action: z.string(),
                    text: z.string(),
                    actorId: z.string(),
                    from: z.string().optional().optional(),
                    to: z.string().optional().optional(),
                    acceptNo: z.string().optional().optional(),
                    receiptNo: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              submittedBy: z.string(),
              submittedAt: z.union([z.null(), z.string()]),
              createdAt: z.string(),
              updatedAt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_retry: {
    method: "post",
    path: "/enterprise/external/submissions/:id/retry",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              taxTypeLabel: z.string(),
              statusLabel: z.union([
                z.literal("待报送"),
                z.literal("报送中"),
                z.literal("已受理"),
                z.literal("已取得回执"),
                z.literal("已完税"),
                z.literal("已退回"),
                z.literal("已作废"),
              ]),
              enterpriseName: z.string(),
              canAct: z.boolean(),
              id: z.number(),
              bizType: z.string(),
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              enterpriseId: z.number(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              channelCode: z.string(),
              period: z.string(),
              taxType: z.string(),
              targetSystem: z.string(),
              payload: z.unknown(),
              payloadHash: z.string(),
              status: z.string(),
              acceptNo: z.string(),
              receiptNo: z.string(),
              errorCode: z.string(),
              errorMsg: z.string(),
              attempts: z.number(),
              guide: z
                .object({
                  system: z.string().optional(),
                  entry: z.string().optional(),
                  credential: z.string().optional(),
                  steps: z.array(z.string()).optional(),
                  fields: z
                    .array(
                      z.object({
                        key: z.string(),
                        label: z.string(),
                        required: z.boolean(),
                      }),
                    )
                    .optional(),
                  notice: z.string().optional(),
                })
                .passthrough(),
              timeline: z.array(
                z
                  .object({
                    at: z.string(),
                    action: z.string(),
                    text: z.string(),
                    actorId: z.string(),
                    from: z.string().optional().optional(),
                    to: z.string().optional().optional(),
                    acceptNo: z.string().optional().optional(),
                    receiptNo: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              submittedBy: z.string(),
              submittedAt: z.union([z.null(), z.string()]),
              createdAt: z.string(),
              updatedAt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_cancel: {
    method: "post",
    path: "/enterprise/external/submissions/:id/cancel",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              taxTypeLabel: z.string(),
              statusLabel: z.union([
                z.literal("待报送"),
                z.literal("报送中"),
                z.literal("已受理"),
                z.literal("已取得回执"),
                z.literal("已完税"),
                z.literal("已退回"),
                z.literal("已作废"),
              ]),
              enterpriseName: z.string(),
              canAct: z.boolean(),
              id: z.number(),
              bizType: z.string(),
              refType: z.string(),
              refId: z.number(),
              refNo: z.string(),
              enterpriseId: z.number(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              channelCode: z.string(),
              period: z.string(),
              taxType: z.string(),
              targetSystem: z.string(),
              payload: z.unknown(),
              payloadHash: z.string(),
              status: z.string(),
              acceptNo: z.string(),
              receiptNo: z.string(),
              errorCode: z.string(),
              errorMsg: z.string(),
              attempts: z.number(),
              guide: z
                .object({
                  system: z.string().optional(),
                  entry: z.string().optional(),
                  credential: z.string().optional(),
                  steps: z.array(z.string()).optional(),
                  fields: z
                    .array(
                      z.object({
                        key: z.string(),
                        label: z.string(),
                        required: z.boolean(),
                      }),
                    )
                    .optional(),
                  notice: z.string().optional(),
                })
                .passthrough(),
              timeline: z.array(
                z
                  .object({
                    at: z.string(),
                    action: z.string(),
                    text: z.string(),
                    actorId: z.string(),
                    from: z.string().optional().optional(),
                    to: z.string().optional().optional(),
                    acceptNo: z.string().optional().optional(),
                    receiptNo: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              submittedBy: z.string(),
              submittedAt: z.union([z.null(), z.string()]),
              createdAt: z.string(),
              updatedAt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_callbacks: {
    method: "get",
    path: "/enterprise/external/submissions/:id/callbacks",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                id: z.number(),
                source: z.string(),
                rawBody: z.string(),
                signatureValid: z.boolean(),
                receivedAt: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  External_recordCallback: {
    method: "post",
    path: "/enterprise/external/submissions/:id/callbacks",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        rawBody: z.string().optional().optional(),
        source: z.string().optional().optional(),
        signatureValid: z
          .union([z.literal(false), z.literal(true)])
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), receivedAt: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_listCredentials: {
    method: "get",
    path: "/enterprise/external/credentials",
    params: z.object({}),
    query: z.object({ enterpriseId: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                id: z.number(),
                enterpriseId: z.number(),
                channelCode: z.string(),
                credType: z.string(),
                label: z.string(),
                extra: jsonValueSchema,
                expiresAt: z.union([z.null(), z.string()]),
                createdAt: z.string(),
                updatedAt: z.string(),
                configured: z.boolean(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  External_saveCredential: {
    method: "post",
    path: "/enterprise/external/credentials",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        enterpriseId: z.number().optional().optional(),
        channelCode: z.string().optional().optional(),
        credType: z.string().optional().optional(),
        label: z.string().optional().optional(),
        secret: z.string().optional().optional(),
        extra: z.record(z.string(), z.unknown()).optional().optional(),
        expiresAt: z.union([z.null(), z.string()]).optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ id: z.number(), credType: z.string(), label: z.string() })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  External_removeCredential: {
    method: "delete",
    path: "/enterprise/external/credentials/:id",
    params: z.object({ id: z.string() }),
    query: z.object({ enterpriseId: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), removed: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_providers: {
    method: "get",
    path: "/enterprise/flex/providers",
    params: z.object({}),
    query: z
      .object({
        recordType: z.string().optional(),
        record_type: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        keyword: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                province: z.string(),
                city: z.string(),
                intro: z.string(),
                auditNote: z.string(),
                createdAt: z.string(),
                name: z.string(),
                providerUserId: z.string(),
                cases: jsonValueSchema,
                region: z.string(),
                kind: z.string(),
                organization: z.string(),
                licenseNo: z.string(),
                fields: jsonValueSchema,
                agents: jsonValueSchema,
                recordType: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Flex_createProvider: {
    method: "post",
    path: "/enterprise/flex/providers",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              province: z.string(),
              city: z.string(),
              intro: z.string(),
              auditNote: z.string(),
              createdAt: z.string(),
              name: z.string(),
              providerUserId: z.string(),
              cases: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              region: z.string(),
              kind: z.string(),
              organization: z.string(),
              licenseNo: z.string(),
              fields: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              agents: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              recordType: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_updateProvider: {
    method: "patch",
    path: "/enterprise/flex/providers/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              province: z.string(),
              city: z.string(),
              intro: z.string(),
              auditNote: z.string(),
              createdAt: z.string(),
              name: z.string(),
              providerUserId: z.string(),
              cases: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              region: z.string(),
              kind: z.string(),
              organization: z.string(),
              licenseNo: z.string(),
              fields: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              agents: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              recordType: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_removeProvider: {
    method: "delete",
    path: "/enterprise/flex/providers/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_onboardings: {
    method: "get",
    path: "/enterprise/flex/onboardings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(flexOnboardingRowSchema)]),
      })
      .passthrough(),
  },
  Flex_createOnboarding: {
    method: "post",
    path: "/enterprise/flex/onboardings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_uploadOnboardingAttachments: {
    method: "post",
    path: "/enterprise/flex/onboardings/attachments",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        files: z
          .array(
            z
              .object({
                name: z.string().optional().optional(),
                size: z.number().optional().optional(),
                contentType: z.string().optional().optional(),
                contentBase64: z.string().optional().optional(),
              })
              .passthrough(),
          )
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              files: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    size: z.number(),
                    url: z.string(),
                    uploaded_at: z.string(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_auditOnboarding: {
    method: "post",
    path: "/enterprise/flex/onboardings/:id/audit",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_workOrders: {
    method: "get",
    path: "/enterprise/flex/work-orders",
    params: z.object({}),
    query: z
      .object({ province: z.string().optional(), city: z.string().optional() })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                conversationCount: z.number(),
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                contactEmail: z.string(),
                province: z.string(),
                city: z.string(),
                createdAt: z.string(),
                description: z.string(),
                contractId: z.number(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                createdBy: z.string(),
                staffUserId: z.string(),
                subCategoryId: z.string(),
                title: z.string(),
                tags: z.string(),
                budget: z.string(),
                expectedResult: z.string(),
                mustConditions: z.string(),
                expectStart: z.string(),
                deadline: z.string(),
                regionScope: z.string(),
                regionMode: z.string(),
                longitude: z.union([z.null(), z.number()]),
                latitude: z.union([z.null(), z.number()]),
                radiusKm: z.union([z.null(), z.number()]),
                emailSync: z.number(),
                contactWechat: z.string(),
                aiworkinPublished: z.number(),
                platformListingId: z.string(),
                platformMatchRunId: z.string(),
                aiworkinSyncStatus: z.string(),
                aiworkinSyncError: z.string(),
                messages: jsonValueSchema,
                agentName: z.string(),
                orderNo: z.string(),
                position: z.string(),
                headcount: z.number(),
                cycle: z.string(),
                skills: z.string(),
                workType: z.string(),
                candidates: jsonValueSchema,
                settlements: jsonValueSchema,
                flexId: z.number(),
                category1: z.string(),
                category2: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Flex_createWorkOrder: {
    method: "post",
    path: "/enterprise/flex/work-orders",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              order_no: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_match: {
    method: "post",
    path: "/enterprise/flex/work-orders/:id/match",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_messages: {
    method: "get",
    path: "/enterprise/flex/work-orders/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_postMessage: {
    method: "post",
    path: "/enterprise/flex/work-orders/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        text: z.string().optional().optional(),
        conversation_id: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              messages: z.array(
                z
                  .object({
                    role: z.union([
                      z.literal("ENTERPRISE"),
                      z.literal("PROVIDER"),
                      z.literal("SYSTEM"),
                    ]),
                    name: z.string(),
                    time: z.string(),
                    text: z.string(),
                    reply_to: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              aiworkin_sync: z.boolean(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_candidates: {
    method: "post",
    path: "/enterprise/flex/work-orders/:id/candidates",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({ candidates: z.array(z.unknown()).optional().optional() })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              candidates: z.array(z.unknown()),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_settlements: {
    method: "post",
    path: "/enterprise/flex/work-orders/:id/settlements",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              settlements: z.array(z.unknown()),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_publish: {
    method: "post",
    path: "/enterprise/flex/work-orders/:id/publish",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_updateWorkOrder: {
    method: "patch",
    path: "/enterprise/flex/work-orders/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_removeWorkOrder: {
    method: "delete",
    path: "/enterprise/flex/work-orders/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_updateWorkOrderContacts: {
    method: "post",
    path: "/enterprise/flex/work-orders/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_updateOnboardingContacts: {
    method: "post",
    path: "/enterprise/flex/onboardings/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_updatePayrollContacts: {
    method: "post",
    path: "/enterprise/flex/payrolls/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_payrolls: {
    method: "get",
    path: "/enterprise/flex/payrolls",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(flexPayrollRowSchema)]),
      })
      .passthrough(),
  },
  Flex_createPayroll: {
    method: "post",
    path: "/enterprise/flex/payrolls",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              total_amount: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Flex_auditPayroll: {
    method: "post",
    path: "/enterprise/flex/payrolls/:id/audit",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_meta: {
    method: "get",
    path: "/enterprise/geo/meta",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              platforms: z.array(
                z.union([
                  z.literal("DeepSeek"),
                  z.literal("豆包"),
                  z.literal("元宝"),
                  z.literal("Kimi"),
                  z.literal("千问"),
                  z.literal("GLM"),
                  z.literal("MiMo"),
                  z.literal("MiniMax"),
                  z.literal("GPT"),
                  z.literal("Claude"),
                  z.literal("Gemini"),
                  z.literal("Grok"),
                ]),
              ),
              availablePlatforms: z.array(z.string()),
              questionTypes: z.array(
                z.union([
                  z
                    .object({
                      type: z.literal("品类词"),
                      target: z.literal(12),
                      share: z.literal(40),
                    })
                    .passthrough(),
                  z
                    .object({
                      type: z.literal("决策词"),
                      target: z.literal(8),
                      share: z.literal(25),
                    })
                    .passthrough(),
                  z
                    .object({
                      type: z.literal("竞品对比词"),
                      target: z.literal(8),
                      share: z.literal(25),
                    })
                    .passthrough(),
                  z
                    .object({
                      type: z.literal("品牌词"),
                      target: z.literal(2),
                      share: z.literal(10),
                    })
                    .passthrough(),
                ]),
              ),
              sentiments: z.array(
                z.union([
                  z.literal("正面"),
                  z.literal("中性"),
                  z.literal("负面"),
                  z.literal("未提及"),
                ]),
              ),
              citationGenres: z.array(
                z.union([
                  z.literal("报告"),
                  z.literal("官网"),
                  z.literal("评测"),
                  z.literal("百科"),
                  z.literal("社区"),
                  z.literal("无"),
                ]),
              ),
              gapTypes: z.array(
                z.union([
                  z.literal("引用真空点"),
                  z.literal("竞品覆盖点"),
                  z.literal("弱覆盖点"),
                  z.literal("名次缺口"),
                  z.literal("品牌被错误描述点"),
                ]),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_projects: {
    method: "get",
    path: "/enterprise/geo/projects",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                competitors: z.array(z.string()),
                platforms: z.array(z.string()),
                brandAliasList: z.array(z.string()),
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                enterpriseId: z.number(),
                industry: z.string(),
                note: z.string(),
                updatedAt: z.string(),
                ownerUserId: z.string(),
                enterpriseUserId: z.string(),
                brand: z.string(),
                brandAliases: z.string(),
                autoCollect: z.number(),
                autoCollectBy: z.string(),
                autoCollectAt: z.union([z.null(), z.string()]),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Geo_createProject: {
    method: "post",
    path: "/enterprise/geo/projects",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              enterpriseId: z.number(),
              industry: z.string(),
              note: z.string(),
              updatedAt: z.string(),
              ownerUserId: z.string(),
              enterpriseUserId: z.string(),
              brand: z.string(),
              brandAliases: z.string(),
              competitors: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              platforms: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              autoCollect: z.number(),
              autoCollectBy: z.string(),
              autoCollectAt: z.union([z.null(), z.string()]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_updateProject: {
    method: "patch",
    path: "/enterprise/geo/projects/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              enterpriseId: z.number(),
              industry: z.string(),
              note: z.string(),
              updatedAt: z.string(),
              ownerUserId: z.string(),
              enterpriseUserId: z.string(),
              brand: z.string(),
              brandAliases: z.string(),
              competitors: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              platforms: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              autoCollect: z.number(),
              autoCollectBy: z.string(),
              autoCollectAt: z.union([z.null(), z.string()]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_removeProject: {
    method: "delete",
    path: "/enterprise/geo/projects/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.object({ id: z.number() }).passthrough()]),
      })
      .passthrough(),
  },
  Geo_report: {
    method: "get",
    path: "/enterprise/geo/projects/:id/report",
    params: z.object({ id: z.string() }),
    query: z.object({ batchId: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              metrics: z.null(),
              prevMetrics: z.null(),
              platforms: z.array(z.unknown()).max(0),
              competitors: z.array(z.unknown()).max(0),
              gaps: z.array(z.unknown()).max(0),
              actions: z.array(z.unknown()).max(0),
              summary: z.array(z.unknown()).max(0),
              project: z
                .object({
                  competitors: z.array(z.string()),
                  platforms: z.array(z.string()),
                  brandAliasList: z.array(z.string()),
                  status: z.string(),
                  id: z.number(),
                  createdAt: z.string(),
                  enterpriseId: z.number(),
                  industry: z.string(),
                  note: z.string(),
                  updatedAt: z.string(),
                  ownerUserId: z.string(),
                  enterpriseUserId: z.string(),
                  brand: z.string(),
                  brandAliases: z.string(),
                  autoCollect: z.number(),
                  autoCollectBy: z.string(),
                  autoCollectAt: z.union([z.null(), z.string()]),
                })
                .passthrough(),
              questions: z.array(
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    createdAt: z.string(),
                    updatedAt: z.string(),
                    projectId: z.number(),
                    text: z.string(),
                    seq: z.string(),
                    type: z.string(),
                    scenario: z.string(),
                    expectedAnswerForm: z.string(),
                    priority: z.string(),
                  })
                  .passthrough(),
              ),
              batches: z.array(
                z
                  .object({
                    platforms: z.array(z.string()),
                    observationCount: z.number(),
                    id: z.number(),
                    createdAt: z.string(),
                    note: z.string(),
                    updatedAt: z.string(),
                    projectId: z.number(),
                    periodLabel: z.string(),
                    createdBy: z.string(),
                    channel: z.string(),
                    dataNature: z.string(),
                  })
                  .passthrough(),
              ),
              current: z
                .object({
                  id: z.number(),
                  createdAt: z.string(),
                  note: z.string(),
                  updatedAt: z.string(),
                  projectId: z.number(),
                  periodLabel: z.string(),
                  platforms: z.array(z.string()),
                  createdBy: z.string(),
                  channel: z.string(),
                  dataNature: z.string(),
                })
                .passthrough(),
              baseline: z.union([
                z.null(),
                z
                  .object({
                    id: z.number(),
                    createdAt: z.string(),
                    note: z.string(),
                    updatedAt: z.string(),
                    projectId: z.number(),
                    periodLabel: z.string(),
                    platforms: z.array(z.string()),
                    createdBy: z.string(),
                    channel: z.string(),
                    dataNature: z.string(),
                  })
                  .passthrough(),
              ]),
            })
            .passthrough(),
          z
            .object({
              metrics: z
                .object({
                  total: z.number(),
                  mentioned: z.number(),
                  listed: z.number(),
                  negative: z.number(),
                  mentionRate: z.number(),
                  listRate: z.number(),
                  avgRank: z.union([z.null(), z.number()]),
                  negativeRate: z.number(),
                  citationQuality: z.number(),
                  exposureScore: z.number(),
                  tier: z.string(),
                })
                .passthrough(),
              prevMetrics: z.union([
                z.null(),
                z
                  .object({
                    total: z.number(),
                    mentioned: z.number(),
                    listed: z.number(),
                    negative: z.number(),
                    mentionRate: z.number(),
                    listRate: z.number(),
                    avgRank: z.union([z.null(), z.number()]),
                    negativeRate: z.number(),
                    citationQuality: z.number(),
                    exposureScore: z.number(),
                    tier: z.string(),
                  })
                  .passthrough(),
              ]),
              platforms: z.array(
                z
                  .object({
                    platform: z.string(),
                    total: z.number(),
                    mentioned: z.number(),
                    listed: z.number(),
                    avgRank: z.union([z.null(), z.number()]),
                    topCitation: z.string(),
                    tip: z.string(),
                  })
                  .passthrough(),
              ),
              competitors: z.array(
                z
                  .object({
                    name: z.string(),
                    mentionRate: z.number(),
                    coverGap: z.number(),
                    listRate: z.null(),
                    avgRank: z.null(),
                    exposureScore: z.null(),
                  })
                  .passthrough(),
              ),
              gaps: z.array(
                z
                  .object({
                    questionId: z.number(),
                    type: z.string(),
                    priority: z.string(),
                    text: z.string(),
                    gapType: z.string(),
                    detail: z.string(),
                    platforms: z.array(z.string()),
                    suggestForm: z.string(),
                  })
                  .passthrough(),
              ),
              actions: z.array(
                z
                  .object({
                    action: z.string(),
                    skill: z.string(),
                    owner: z.string(),
                    priority: z.string(),
                    due: z.string(),
                  })
                  .passthrough(),
              ),
              summary: z.array(z.string()),
              project: z
                .object({
                  competitors: z.array(z.string()),
                  platforms: z.array(z.string()),
                  brandAliasList: z.array(z.string()),
                  status: z.string(),
                  id: z.number(),
                  createdAt: z.string(),
                  enterpriseId: z.number(),
                  industry: z.string(),
                  note: z.string(),
                  updatedAt: z.string(),
                  ownerUserId: z.string(),
                  enterpriseUserId: z.string(),
                  brand: z.string(),
                  brandAliases: z.string(),
                  autoCollect: z.number(),
                  autoCollectBy: z.string(),
                  autoCollectAt: z.union([z.null(), z.string()]),
                })
                .passthrough(),
              questions: z.array(
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    createdAt: z.string(),
                    updatedAt: z.string(),
                    projectId: z.number(),
                    text: z.string(),
                    seq: z.string(),
                    type: z.string(),
                    scenario: z.string(),
                    expectedAnswerForm: z.string(),
                    priority: z.string(),
                  })
                  .passthrough(),
              ),
              batches: z.array(
                z
                  .object({
                    platforms: z.array(z.string()),
                    observationCount: z.number(),
                    id: z.number(),
                    createdAt: z.string(),
                    note: z.string(),
                    updatedAt: z.string(),
                    projectId: z.number(),
                    periodLabel: z.string(),
                    createdBy: z.string(),
                    channel: z.string(),
                    dataNature: z.string(),
                  })
                  .passthrough(),
              ),
              current: z
                .object({
                  id: z.number(),
                  createdAt: z.string(),
                  note: z.string(),
                  updatedAt: z.string(),
                  projectId: z.number(),
                  periodLabel: z.string(),
                  platforms: z.array(z.string()),
                  createdBy: z.string(),
                  channel: z.string(),
                  dataNature: z.string(),
                })
                .passthrough(),
              baseline: z.union([
                z.null(),
                z
                  .object({
                    id: z.number(),
                    createdAt: z.string(),
                    note: z.string(),
                    updatedAt: z.string(),
                    projectId: z.number(),
                    periodLabel: z.string(),
                    platforms: z.array(z.string()),
                    createdBy: z.string(),
                    channel: z.string(),
                    dataNature: z.string(),
                  })
                  .passthrough(),
              ]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_autoCollect: {
    method: "get",
    path: "/enterprise/geo/projects/:id/auto-collect",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              enabled: z.boolean(),
              updatedBy: z.string(),
              updatedAt: z.union([z.null(), z.string()]),
              weekStart: z.string(),
              weekLabel: z.string(),
              windowStart: z.union([z.null(), z.string()]),
              windowEnd: z.union([z.null(), z.string()]),
              inWindow: z.boolean(),
              questionCount: z.number(),
              usablePlatforms: z.array(z.string()),
              skippedPlatforms: z.array(z.string()),
              plannedPerRun: z.number(),
              currentRun: z.union([
                z.null(),
                z
                  .object({
                    id: z.number(),
                    projectId: z.number(),
                    weekStart: z.string(),
                    periodLabel: z.string(),
                    status: z.string(),
                    planned: z.number(),
                    done: z.number(),
                    failed: z.number(),
                    pending: z.number(),
                    deferred: z.boolean(),
                    batchId: z.number(),
                    startedAt: z.union([z.null(), z.string()]),
                    finishedAt: z.union([z.null(), z.string()]),
                    windowStart: z.union([z.null(), z.string()]),
                    windowEnd: z.union([z.null(), z.string()]),
                    lastError: z.string(),
                  })
                  .passthrough(),
              ]),
              recentRuns: z.array(
                z
                  .object({
                    id: z.number(),
                    projectId: z.number(),
                    weekStart: z.string(),
                    periodLabel: z.string(),
                    status: z.string(),
                    planned: z.number(),
                    done: z.number(),
                    failed: z.number(),
                    pending: z.number(),
                    deferred: z.boolean(),
                    batchId: z.number(),
                    startedAt: z.union([z.null(), z.string()]),
                    finishedAt: z.union([z.null(), z.string()]),
                    windowStart: z.union([z.null(), z.string()]),
                    windowEnd: z.union([z.null(), z.string()]),
                    lastError: z.string(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_setAutoCollect: {
    method: "put",
    path: "/enterprise/geo/projects/:id/auto-collect",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              enabled: z.boolean(),
              updatedBy: z.string(),
              updatedAt: z.union([z.null(), z.string()]),
              weekStart: z.string(),
              weekLabel: z.string(),
              windowStart: z.union([z.null(), z.string()]),
              windowEnd: z.union([z.null(), z.string()]),
              inWindow: z.boolean(),
              questionCount: z.number(),
              usablePlatforms: z.array(z.string()),
              skippedPlatforms: z.array(z.string()),
              plannedPerRun: z.number(),
              currentRun: z.union([
                z.null(),
                z
                  .object({
                    id: z.number(),
                    projectId: z.number(),
                    weekStart: z.string(),
                    periodLabel: z.string(),
                    status: z.string(),
                    planned: z.number(),
                    done: z.number(),
                    failed: z.number(),
                    pending: z.number(),
                    deferred: z.boolean(),
                    batchId: z.number(),
                    startedAt: z.union([z.null(), z.string()]),
                    finishedAt: z.union([z.null(), z.string()]),
                    windowStart: z.union([z.null(), z.string()]),
                    windowEnd: z.union([z.null(), z.string()]),
                    lastError: z.string(),
                  })
                  .passthrough(),
              ]),
              recentRuns: z.array(
                z
                  .object({
                    id: z.number(),
                    projectId: z.number(),
                    weekStart: z.string(),
                    periodLabel: z.string(),
                    status: z.string(),
                    planned: z.number(),
                    done: z.number(),
                    failed: z.number(),
                    pending: z.number(),
                    deferred: z.boolean(),
                    batchId: z.number(),
                    startedAt: z.union([z.null(), z.string()]),
                    finishedAt: z.union([z.null(), z.string()]),
                    windowStart: z.union([z.null(), z.string()]),
                    windowEnd: z.union([z.null(), z.string()]),
                    lastError: z.string(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_questions: {
    method: "get",
    path: "/enterprise/geo/projects/:id/questions",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                updatedAt: z.string(),
                projectId: z.number(),
                text: z.string(),
                seq: z.string(),
                type: z.string(),
                scenario: z.string(),
                expectedAnswerForm: z.string(),
                priority: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Geo_createQuestion: {
    method: "post",
    path: "/enterprise/geo/projects/:id/questions",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
              projectId: z.number(),
              text: z.string(),
              seq: z.string(),
              type: z.string(),
              scenario: z.string(),
              expectedAnswerForm: z.string(),
              priority: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_updateQuestion: {
    method: "patch",
    path: "/enterprise/geo/questions/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
              projectId: z.number(),
              text: z.string(),
              seq: z.string(),
              type: z.string(),
              scenario: z.string(),
              expectedAnswerForm: z.string(),
              priority: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_removeQuestion: {
    method: "delete",
    path: "/enterprise/geo/questions/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.object({ id: z.number() }).passthrough()]),
      })
      .passthrough(),
  },
  Geo_batches: {
    method: "get",
    path: "/enterprise/geo/projects/:id/batches",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                platforms: z.array(z.string()),
                observationCount: z.number(),
                id: z.number(),
                createdAt: z.string(),
                note: z.string(),
                updatedAt: z.string(),
                projectId: z.number(),
                periodLabel: z.string(),
                createdBy: z.string(),
                channel: z.string(),
                dataNature: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Geo_createBatch: {
    method: "post",
    path: "/enterprise/geo/projects/:id/batches",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              createdAt: z.string(),
              note: z.string(),
              updatedAt: z.string(),
              projectId: z.number(),
              periodLabel: z.string(),
              platforms: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              createdBy: z.string(),
              channel: z.string(),
              dataNature: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_updateBatch: {
    method: "patch",
    path: "/enterprise/geo/batches/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              createdAt: z.string(),
              note: z.string(),
              updatedAt: z.string(),
              projectId: z.number(),
              periodLabel: z.string(),
              platforms: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              createdBy: z.string(),
              channel: z.string(),
              dataNature: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_removeBatch: {
    method: "delete",
    path: "/enterprise/geo/batches/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.object({ id: z.number() }).passthrough()]),
      })
      .passthrough(),
  },
  Geo_observations: {
    method: "get",
    path: "/enterprise/geo/batches/:id/observations",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                questionText: z.string(),
                questionType: z.string(),
                id: z.number(),
                createdAt: z.string(),
                updatedAt: z.string(),
                batchId: z.number(),
                questionId: z.number(),
                platform: z.string(),
                brandMentioned: z.number(),
                rankPosition: z.union([z.null(), z.number()]),
                sentiment: z.string(),
                citationGenre: z.string(),
                citationDomains: z.string(),
                modelVersion: z.string(),
                answerExcerpt: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Geo_createObservation: {
    method: "post",
    path: "/enterprise/geo/batches/:id/observations",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
              batchId: z.number(),
              questionId: z.number(),
              platform: z.string(),
              brandMentioned: z.number(),
              rankPosition: z.union([z.null(), z.number()]),
              sentiment: z.string(),
              citationGenre: z.string(),
              citationDomains: z.string(),
              modelVersion: z.string(),
              answerExcerpt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_updateObservation: {
    method: "patch",
    path: "/enterprise/geo/observations/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
              batchId: z.number(),
              questionId: z.number(),
              platform: z.string(),
              brandMentioned: z.number(),
              rankPosition: z.union([z.null(), z.number()]),
              sentiment: z.string(),
              citationGenre: z.string(),
              citationDomains: z.string(),
              modelVersion: z.string(),
              answerExcerpt: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_removeObservation: {
    method: "delete",
    path: "/enterprise/geo/observations/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.object({ id: z.number() }).passthrough()]),
      })
      .passthrough(),
  },
  Geo_topics: {
    method: "get",
    path: "/enterprise/geo/projects/:id/topics",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                note: z.string(),
                updatedAt: z.string(),
                projectId: z.number(),
                title: z.string(),
                questionId: z.number(),
                gapType: z.string(),
                platformCount: z.number(),
                gapScore: z.number(),
                citableScore: z.number(),
                businessScore: z.number(),
                supplyScore: z.number(),
                styleBonus: z.number(),
                totalScore: z.number(),
                blacklisted: z.number(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Geo_createTopic: {
    method: "post",
    path: "/enterprise/geo/projects/:id/topics",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              note: z.string(),
              updatedAt: z.string(),
              projectId: z.number(),
              title: z.string(),
              questionId: z.number(),
              gapType: z.string(),
              platformCount: z.number(),
              gapScore: z.number(),
              citableScore: z.number(),
              businessScore: z.number(),
              supplyScore: z.number(),
              styleBonus: z.number(),
              totalScore: z.number(),
              blacklisted: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_updateTopic: {
    method: "patch",
    path: "/enterprise/geo/topics/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              note: z.string(),
              updatedAt: z.string(),
              projectId: z.number(),
              title: z.string(),
              questionId: z.number(),
              gapType: z.string(),
              platformCount: z.number(),
              gapScore: z.number(),
              citableScore: z.number(),
              businessScore: z.number(),
              supplyScore: z.number(),
              styleBonus: z.number(),
              totalScore: z.number(),
              blacklisted: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Geo_removeTopic: {
    method: "delete",
    path: "/enterprise/geo/topics/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.object({ id: z.number() }).passthrough()]),
      })
      .passthrough(),
  },
  Identity_me: {
    method: "get",
    path: "/enterprise/me",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              userId: z.string(),
              username: z.string(),
              displayName: z.string(),
              email: z.union([z.null(), z.string()]).optional(),
              avatarUrl: z.union([z.null(), z.string()]),
              javaRole: z.string(),
              roles: z.array(z.string()),
              currentIdentity: z.string(),
              identities: z.array(z.string()),
              enterprise: z.union([
                z.null(),
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    userId: z.string(),
                    uscc: z.string(),
                    province: z.string(),
                    city: z.string(),
                    auditNote: z.string(),
                    subjectType: z.string(),
                    idCard: z.string(),
                    createdAt: z.string(),
                    auditedAt: z.union([z.null(), z.string()]),
                    name: z.string(),
                    taxpayerType: z.string(),
                    industry: z.string(),
                    legalPerson: z.string(),
                    phone: z.string(),
                    address: z.string(),
                    qxyOrgId: z.string(),
                  })
                  .passthrough(),
              ]),
              providerApps: z.array(
                z
                  .object({
                    attachments: z.array(z.unknown()),
                    business_staff: z.array(z.unknown()),
                    businessStaff: z.union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      z.record(
                        z.string(),
                        z
                          .union([
                            z.null(),
                            z.string(),
                            z.number(),
                            z.literal(false),
                            z.literal(true),
                            jsonValueSchema,
                          ])
                          .optional(),
                      ),
                      z.array(jsonValueSchema),
                    ]),
                  })
                  .passthrough(),
              ),
              staffProfile: z.union([
                z.null(),
                z
                  .object({
                    categories: z.array(z.string()),
                    id: z.number(),
                    userId: z.string(),
                    qualification: z.string(),
                    province: z.string(),
                    city: z.string(),
                    intro: z.string(),
                    createdAt: z.string(),
                    phone: z.string(),
                    updatedAt: z.string(),
                    realName: z.string(),
                    email: z.string(),
                    region: z.string(),
                  })
                  .passthrough(),
              ]),
              staffOf: z.array(
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    createdAt: z.string(),
                    providerUserId: z.string(),
                    staffUserId: z.string(),
                    roles: z.union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      z.record(
                        z.string(),
                        z
                          .union([
                            z.null(),
                            z.string(),
                            z.number(),
                            z.literal(false),
                            z.literal(true),
                            jsonValueSchema,
                          ])
                          .optional(),
                      ),
                      z.array(jsonValueSchema),
                    ]),
                  })
                  .passthrough(),
              ),
              providerKind: z.union([
                z.literal("NONE"),
                z.literal("STANDARD"),
                z.literal("MICRO"),
              ]),
              qualified: z
                .object({
                  ENTERPRISE_USER: z.boolean(),
                  SERVICE_PROVIDER: z.boolean(),
                  PROVIDER_STAFF: z.boolean(),
                })
                .passthrough(),
              platformFlags: z
                .object({ flexPayrollEnabled: z.boolean() })
                .passthrough(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_switchIdentity: {
    method: "post",
    path: "/enterprise/me/identity",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({ identity: z.string().optional().optional() })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              currentIdentity: z.string(),
              identities: z.array(z.string()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_enterprise: {
    method: "get",
    path: "/enterprise/identity/enterprise",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              userId: z.string(),
              uscc: z.string(),
              province: z.string(),
              city: z.string(),
              auditNote: z.string(),
              subjectType: z.string(),
              idCard: z.string(),
              createdAt: z.string(),
              auditedAt: z.union([z.null(), z.string()]),
              name: z.string(),
              taxpayerType: z.string(),
              industry: z.string(),
              legalPerson: z.string(),
              phone: z.string(),
              address: z.string(),
              qxyOrgId: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_submitEnterprise: {
    method: "post",
    path: "/enterprise/identity/enterprise",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_updateEnterprise: {
    method: "patch",
    path: "/enterprise/identity/enterprise",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              name: z.string(),
              uscc: z.string(),
              subject_type: z.string(),
              taxpayer_type: z.string(),
              updated: z.boolean(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_removeEnterprise: {
    method: "delete",
    path: "/enterprise/identity/enterprise",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), removed: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_providerApplication: {
    method: "get",
    path: "/enterprise/identity/provider-application",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: providerApplicationSchema
        .extend({ items: z.array(providerApplicationSchema) })
        .nullable(),
    }),
  },
  Identity_submitProvider: {
    method: "post",
    path: "/enterprise/identity/provider-application",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              ids: z.array(z.number()),
              status: z.string(),
              submitted: z.array(z.string()),
              skipped: z.array(
                z
                  .object({ type: z.string(), reason: z.string() })
                  .passthrough(),
              ),
              attachments: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    size: z.number(),
                    url: z.string(),
                    uploaded_at: z.string(),
                  })
                  .passthrough(),
              ),
              business_staff: z.array(
                z
                  .object({
                    name: z.string(),
                    title: z.string(),
                    phone: z.string(),
                    email: z.string(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_upload: {
    method: "post",
    path: "/enterprise/identity/provider-application/attachments",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        files: z
          .array(
            z
              .object({
                name: z.string().optional().optional(),
                size: z.number().optional().optional(),
                contentType: z.string().optional().optional(),
                contentBase64: z.string().optional().optional(),
              })
              .passthrough(),
          )
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              files: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    size: z.number(),
                    url: z.string(),
                    uploaded_at: z.string(),
                  })
                  .passthrough(),
              ),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_updateProvider: {
    method: "patch",
    path: "/enterprise/identity/provider-application/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              attachments: z.array(z.unknown()),
              business_staff: z.array(z.unknown()),
              businessStaff: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_removeProvider: {
    method: "delete",
    path: "/enterprise/identity/provider-application/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), removed: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_staffProfile: {
    method: "get",
    path: "/enterprise/identity/staff-profile",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              categories: z.array(z.string()),
              id: z.number(),
              userId: z.string(),
              qualification: z.string(),
              province: z.string(),
              city: z.string(),
              intro: z.string(),
              createdAt: z.string(),
              phone: z.string(),
              updatedAt: z.string(),
              realName: z.string(),
              email: z.string(),
              region: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_submitStaff: {
    method: "post",
    path: "/enterprise/identity/staff-profile",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              real_name: z.string(),
              categories: z.array(z.string()),
              updated: z.boolean(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_staff: {
    method: "get",
    path: "/enterprise/staff",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                staff_name: z.string(),
                username: z.string(),
                display_name: z.string(),
                email: z.string(),
                profile: z.union([
                  z.null(),
                  z
                    .object({
                      categories: z.array(z.string()),
                      id: z.number(),
                      userId: z.string(),
                      qualification: z.string(),
                      province: z.string(),
                      city: z.string(),
                      intro: z.string(),
                      createdAt: z.string(),
                      phone: z.string(),
                      updatedAt: z.string(),
                      realName: z.string(),
                      email: z.string(),
                      region: z.string(),
                    })
                    .passthrough(),
                ]),
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                providerUserId: z.string(),
                staffUserId: z.string(),
                roles: z.array(z.string()),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Identity_search: {
    method: "get",
    path: "/enterprise/staff/search",
    params: z.object({}),
    query: z.object({ q: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                userId: z.string(),
                nickname: z.string().optional(),
                username: z.string().optional(),
                bound: z.boolean().optional(),
                has_profile: z.boolean().optional(),
                real_name: z.string(),
                phone: z.string(),
                categories: z.array(z.string()),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Identity_roles: {
    method: "get",
    path: "/enterprise/staff/roles",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                role: z.string(),
                category: z.string(),
                code: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Identity_inviteStaff: {
    method: "post",
    path: "/enterprise/staff/invite",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        staffUserId: z.string().optional().optional(),
        categories: z.array(z.string()).optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_myInvitations: {
    method: "get",
    path: "/enterprise/staff/invitations/mine",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                provider_name: z.string(),
                role_labels: z.array(z.string()),
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                auditedAt: z.union([z.null(), z.string()]),
                note: z.string(),
                providerUserId: z.string(),
                direction: z.string(),
                category: z.string(),
                staffUserId: z.string(),
                roles: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Identity_respondInvitation: {
    method: "post",
    path: "/enterprise/staff/invitations/:id/respond",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ action: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_cancelInvitation: {
    method: "post",
    path: "/enterprise/staff/invitations/:id/cancel",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_bind: {
    method: "post",
    path: "/enterprise/staff",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        staffUserId: z.string().optional().optional(),
        roles: z.array(z.string()).optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), staffUserId: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_unbind: {
    method: "post",
    path: "/enterprise/staff/:staffUserId/unbind",
    params: z.object({ staffUserId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ staffUserId: z.string(), status: z.string() })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_selfUnbind: {
    method: "post",
    path: "/enterprise/staff/self-unbind/:providerUserId",
    params: z.object({ providerUserId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ providerUserId: z.string(), status: z.string() })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_joinable: {
    method: "get",
    path: "/enterprise/staff/joinable",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              hasProfile: z.boolean(),
              declared: z.array(z.string()),
              sections: z.array(
                z
                  .object({
                    code: z.string(),
                    label: z.string(),
                    providerCount: z.number(),
                    providers: z.array(
                      z
                        .object({
                          providerUserId: z.string(),
                          orgName: z.string(),
                          nickname: z.string(),
                          qualification: z.string(),
                          province: z.string(),
                          city: z.string(),
                          intro: z.string(),
                          serviceItems: z.array(z.string()),
                          applicationStatus: z.string(),
                          applicationId: z.number(),
                          bound: z.boolean(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_myAffiliations: {
    method: "get",
    path: "/enterprise/staff/affiliations/mine",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                provider_name: z.string(),
                category_label: z.string(),
                role_labels: z.array(z.string()),
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                auditedAt: z.union([z.null(), z.string()]),
                note: z.string(),
                providerUserId: z.string(),
                direction: z.string(),
                category: z.string(),
                staffUserId: z.string(),
                roles: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Identity_inbox: {
    method: "get",
    path: "/enterprise/staff/affiliations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                applicant_name: z.string(),
                applicant_username: z.string(),
                applicant_email: z.string(),
                applicant_phone: z.string(),
                position: z.string(),
                category_label: z.string(),
                role_labels: z.array(z.string()),
                profile: z.union([
                  z.null(),
                  z
                    .object({
                      realName: z.string(),
                      phone: z.string(),
                      email: z.string(),
                      region: z.string(),
                      qualification: z.string(),
                      categories: z.array(z.string()),
                    })
                    .passthrough(),
                ]),
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                auditedAt: z.union([z.null(), z.string()]),
                note: z.string(),
                providerUserId: z.string(),
                direction: z.string(),
                category: z.string(),
                staffUserId: z.string(),
                roles: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Identity_apply: {
    method: "post",
    path: "/enterprise/staff/affiliations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        providerUserId: z.string().optional().optional(),
        category: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_cancelAffiliation: {
    method: "delete",
    path: "/enterprise/staff/affiliations/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_auditAff: {
    method: "post",
    path: "/enterprise/staff/affiliations/:id/audit",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        action: z
          .union([z.literal("APPROVE"), z.literal("REJECT")])
          .optional()
          .optional(),
        note: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_assign: {
    method: "post",
    path: "/enterprise/staff/assignments",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        enterpriseId: z.number().optional().optional(),
        staffUserId: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), staffUserId: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_myWork: {
    method: "get",
    path: "/enterprise/staff/my-work",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              assignments: z.array(
                z
                  .object({
                    id: z.number(),
                    createdAt: z.string(),
                    enterpriseId: z.number(),
                    providerUserId: z.string(),
                    staffUserId: z.string(),
                  })
                  .passthrough(),
              ),
              binds: z.array(
                z
                  .object({
                    provider_name: z.string(),
                    org_name: z.string(),
                    status: z.string(),
                    id: z.number(),
                    createdAt: z.string(),
                    providerUserId: z.string(),
                    staffUserId: z.string(),
                    roles: z.union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      z.record(
                        z.string(),
                        z
                          .union([
                            z.null(),
                            z.string(),
                            z.number(),
                            z.literal(false),
                            z.literal(true),
                            jsonValueSchema,
                          ])
                          .optional(),
                      ),
                      z.array(jsonValueSchema),
                    ]),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_apiKeys: {
    method: "get",
    path: "/enterprise/api-keys",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                userId: z.string(),
                createdAt: z.string(),
                masked: z.string(),
                lastUsedAt: z.string().nullable(),
                /** 积分额度（调用模型广场累计消耗上限）；null = 不限额度。 */
                pointsQuota: z.number().nullable(),
                /** 该 Key 累计已消耗积分（对外调用按实际用量记账）。 */
                pointsUsed: z.number(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Identity_createKey: {
    method: "post",
    path: "/enterprise/api-keys",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              plainKey: z.string(),
              masked: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_resetKey: {
    method: "post",
    path: "/enterprise/api-keys/:id/reset",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              plainKey: z.string(),
              masked: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_revokeKey: {
    method: "post",
    path: "/enterprise/api-keys/:id/revoke",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_keyUsage: {
    method: "get",
    path: "/enterprise/api-keys/:id/usage",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                id: z.number(),
                createdAt: z.string(),
                action: z.string(),
                detail: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Identity_updateKeyQuota: {
    method: "post",
    path: "/enterprise/api-keys/:id/quota",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({
      /** 积分额度（须大于 0）；null = 不限额度。 */
      pointsQuota: z.number().positive().nullable(),
    }),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              pointsQuota: z.number().nullable(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Identity_revealKey: {
    method: "post",
    path: "/enterprise/api-keys/:id/reveal",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              plainKey: z.string(),
              masked: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Invoice_create: {
    method: "post",
    path: "/enterprise/invoice-requests",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        enterpriseId: z.coerce.number().int().positive(),
        invoiceType: z.string().optional(),
        buyerType: z.string().optional(),
        buyerName: z.string().optional(),
        buyerTaxNo: z.string().optional(),
        orderNo: z.string().optional(),
        remark: z.string().optional(),
        items: z
          .array(
            z
              .object({
                goodsCode: z.string().optional(),
                goodsName: z.string().optional(),
                spec: z.string().optional(),
                quantity: z.number().optional(),
                price: z.number().optional(),
                taxRate: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              staffName: z.string(),
              statusLabel: z.string(),
              canReview: z.boolean(),
              items: z.array(
                z
                  .object({
                    goodsCode: z.string().optional().optional(),
                    goodsName: z.string().optional().optional(),
                    spec: z.string().optional().optional(),
                    quantity: z.number().optional().optional(),
                    price: z.number().optional().optional(),
                    taxRate: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              amount: z.number(),
              tax: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Invoice_list: {
    method: "get",
    path: "/enterprise/invoice-requests",
    params: z.object({}),
    query: z.object({ status: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                id: z.number(),
                reqNo: z.string(),
                enterpriseId: z.number(),
                enterpriseName: z.string(),
                buyerName: z.string(),
                buyerTaxNo: z.string(),
                invoiceType: z.string(),
                buyerType: z.string(),
                orderNo: z.string(),
                remark: z.string(),
                status: z.string(),
                rejectReason: z.string(),
                issueCode: z.string(),
                issueMessage: z.string(),
                issueTaskId: z.string(),
                contactName: z.string(),
                contactPhone: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                createdAt: z.string(),
                staffName: z.string(),
                requesterName: z.string(),
                statusLabel: z.string(),
                canReview: z.boolean(),
                items: z.array(
                  z
                    .object({
                      goodsCode: z.string().optional().optional(),
                      goodsName: z.string().optional().optional(),
                      spec: z.string().optional().optional(),
                      quantity: z.number().optional().optional(),
                      price: z.number().optional().optional(),
                      taxRate: z.string().optional().optional(),
                    })
                    .passthrough(),
                ),
                amount: z.number(),
                tax: z.number(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Invoice_detail: {
    method: "get",
    path: "/enterprise/invoice-requests/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              reqNo: z.string(),
              enterpriseId: z.number(),
              enterpriseName: z.string(),
              buyerName: z.string(),
              buyerTaxNo: z.string(),
              invoiceType: z.string(),
              buyerType: z.string(),
              orderNo: z.string(),
              remark: z.string(),
              status: z.string(),
              rejectReason: z.string(),
              issueCode: z.string(),
              issueMessage: z.string(),
              issueTaskId: z.string(),
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              createdAt: z.string(),
              staffName: z.string(),
              statusLabel: z.string(),
              canReview: z.boolean(),
              items: z.array(
                z
                  .object({
                    goodsCode: z.string().optional().optional(),
                    goodsName: z.string().optional().optional(),
                    spec: z.string().optional().optional(),
                    quantity: z.number().optional().optional(),
                    price: z.number().optional().optional(),
                    taxRate: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              amount: z.number(),
              tax: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Invoice_approve: {
    method: "post",
    path: "/enterprise/invoice-requests/:id/approve",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              staffName: z.string(),
              statusLabel: z.string(),
              canReview: z.boolean(),
              items: z.array(
                z
                  .object({
                    goodsCode: z.string().optional().optional(),
                    goodsName: z.string().optional().optional(),
                    spec: z.string().optional().optional(),
                    quantity: z.number().optional().optional(),
                    price: z.number().optional().optional(),
                    taxRate: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              amount: z.number(),
              tax: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Invoice_reject: {
    method: "post",
    path: "/enterprise/invoice-requests/:id/reject",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              staffName: z.string(),
              statusLabel: z.string(),
              canReview: z.boolean(),
              items: z.array(
                z
                  .object({
                    goodsCode: z.string().optional().optional(),
                    goodsName: z.string().optional().optional(),
                    spec: z.string().optional().optional(),
                    quantity: z.number().optional().optional(),
                    price: z.number().optional().optional(),
                    taxRate: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              amount: z.number(),
              tax: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Invoice_updateContacts: {
    method: "post",
    path: "/enterprise/invoice-requests/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Invoice_cancel: {
    method: "post",
    path: "/enterprise/invoice-requests/:id/cancel",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              staffName: z.string(),
              statusLabel: z.string(),
              canReview: z.boolean(),
              items: z.array(
                z
                  .object({
                    goodsCode: z.string().optional().optional(),
                    goodsName: z.string().optional().optional(),
                    spec: z.string().optional().optional(),
                    quantity: z.number().optional().optional(),
                    price: z.number().optional().optional(),
                    taxRate: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              amount: z.number(),
              tax: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_agencies: {
    method: "get",
    path: "/enterprise/ip/agencies",
    params: z.object({}),
    query: z
      .object({
        kind: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        keyword: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                qualification: z.string(),
                province: z.string(),
                city: z.string(),
                intro: z.union([z.null(), z.string()]),
                auditNote: z.string(),
                createdAt: z.string(),
                name: z.string(),
                phone: z.string(),
                note: z.string(),
                ownerUserId: z.string(),
                cases: jsonValueSchema,
                region: z.string(),
                kind: z.string(),
                organization: z.string(),
                licenseNo: z.string(),
                fields: jsonValueSchema,
                agents: jsonValueSchema,
                ownerType: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Ip_createAgency: {
    method: "post",
    path: "/enterprise/ip/agencies",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              qualification: z.string(),
              province: z.string(),
              city: z.string(),
              intro: z.union([z.null(), z.string()]),
              auditNote: z.string(),
              createdAt: z.string(),
              name: z.string(),
              phone: z.string(),
              note: z.string(),
              ownerUserId: z.string(),
              cases: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              region: z.string(),
              kind: z.string(),
              organization: z.string(),
              licenseNo: z.string(),
              fields: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              agents: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              ownerType: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_updateAgency: {
    method: "patch",
    path: "/enterprise/ip/agencies/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              qualification: z.string(),
              province: z.string(),
              city: z.string(),
              intro: z.union([z.null(), z.string()]),
              auditNote: z.string(),
              createdAt: z.string(),
              name: z.string(),
              phone: z.string(),
              note: z.string(),
              ownerUserId: z.string(),
              cases: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              region: z.string(),
              kind: z.string(),
              organization: z.string(),
              licenseNo: z.string(),
              fields: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              agents: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              ownerType: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_removeAgency: {
    method: "delete",
    path: "/enterprise/ip/agencies/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_list: {
    method: "get",
    path: "/enterprise/ip/requests",
    params: z.object({}),
    query: z
      .object({ province: z.string().optional(), city: z.string().optional() })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                conversationCount: z.number(),
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                province: z.string(),
                city: z.string(),
                createdAt: z.string(),
                contractId: z.number(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                category: z.string(),
                requestNo: z.string(),
                createdBy: z.string(),
                staffUserId: z.string(),
                subCategoryId: z.string(),
                title: z.string(),
                regionMode: z.string(),
                longitude: z.union([z.null(), z.number()]),
                latitude: z.union([z.null(), z.number()]),
                radiusKm: z.union([z.null(), z.number()]),
                aiworkinPublished: z.number(),
                platformListingId: z.string(),
                platformMatchRunId: z.string(),
                aiworkinSyncStatus: z.string(),
                aiworkinSyncError: z.string(),
                messages: jsonValueSchema,
                kind: z.string(),
                fields: jsonValueSchema,
                agentName: z.string(),
                agencyId: z.number(),
                category1: z.string(),
                category2: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Ip_create: {
    method: "post",
    path: "/enterprise/ip/requests",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_consult: {
    method: "post",
    path: "/enterprise/ip/consultations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_messages: {
    method: "get",
    path: "/enterprise/ip/requests/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_postMessage: {
    method: "post",
    path: "/enterprise/ip/requests/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        text: z.string().optional().optional(),
        conversation_id: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              messages: z.array(
                z
                  .object({
                    role: z.union([
                      z.literal("ENTERPRISE"),
                      z.literal("PROVIDER"),
                      z.literal("SYSTEM"),
                    ]),
                    name: z.string(),
                    time: z.string(),
                    text: z.string(),
                    reply_to: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              aiworkin_sync: z.boolean(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_publish: {
    method: "post",
    path: "/enterprise/ip/requests/:id/publish",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_updateContacts: {
    method: "post",
    path: "/enterprise/ip/requests/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_updateRequest: {
    method: "patch",
    path: "/enterprise/ip/requests/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Ip_removeRequest: {
    method: "delete",
    path: "/enterprise/ip/requests/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  ThinkTank_experts: {
    method: "get",
    path: "/enterprise/think-tank/experts",
    params: z.object({}),
    query: z
      .object({
        kind: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        keyword: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(thinkTankExpertRowSchema)]),
      })
      .passthrough(),
  },
  ThinkTank_createExpert: {
    method: "post",
    path: "/enterprise/think-tank/experts",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), thinkTankExpertRowSchema]),
      })
      .passthrough(),
  },
  ThinkTank_updateExpert: {
    method: "patch",
    path: "/enterprise/think-tank/experts/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), thinkTankExpertRowSchema]),
      })
      .passthrough(),
  },
  ThinkTank_removeExpert: {
    method: "delete",
    path: "/enterprise/think-tank/experts/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  ThinkTank_page: {
    method: "get",
    path: "/enterprise/think-tank/requests/page",
    params: z.object({}),
    query: pageQuerySchema.extend({
      province: z.string().optional(),
      city: z.string().optional(),
      keyword: z.string().trim().max(200).optional(),
      status: z.string().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: pageSchema(thinkTankRowSchema).nullable(),
    }),
  },
  ThinkTank_stats: {
    method: "get",
    path: "/enterprise/think-tank/requests/stats",
    params: z.object({}),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          byStatus: z.record(z.string(), z.number()),
        })
        .nullable(),
    }),
  },
  ThinkTank_detail: {
    method: "get",
    path: "/enterprise/think-tank/requests/:id",
    params: z.object({ id: z.string().regex(/^[1-9]\d*$/) }),
    query: z.object({}),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: thinkTankRowSchema.nullable(),
    }),
  },
  ThinkTank_create: {
    method: "post",
    path: "/enterprise/think-tank/requests",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  ThinkTank_update: {
    method: "patch",
    path: "/enterprise/think-tank/requests/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  ThinkTank_remove: {
    method: "delete",
    path: "/enterprise/think-tank/requests/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  ThinkTank_updateContacts: {
    method: "post",
    path: "/enterprise/think-tank/requests/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  ThinkTank_messages: {
    method: "get",
    path: "/enterprise/think-tank/requests/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  ThinkTank_postMessage: {
    method: "post",
    path: "/enterprise/think-tank/requests/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        text: z.string().optional().optional(),
        conversation_id: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              messages: z.array(
                z
                  .object({
                    role: z.union([
                      z.literal("ENTERPRISE"),
                      z.literal("PROVIDER"),
                      z.literal("SYSTEM"),
                    ]),
                    name: z.string(),
                    time: z.string(),
                    text: z.string(),
                    reply_to: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              aiworkin_sync: z.boolean(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  ThinkTank_publish: {
    method: "post",
    path: "/enterprise/think-tank/requests/:id/publish",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_lawyers: {
    method: "get",
    path: "/enterprise/legal/lawyers",
    params: z.object({}),
    query: z
      .object({
        kind: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        keyword: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                qualification: z.string(),
                province: z.string(),
                city: z.string(),
                intro: z.union([z.null(), z.string()]),
                auditNote: z.string(),
                createdAt: z.string(),
                name: z.string(),
                ownerUserId: z.string(),
                providerUserId: z.string(),
                staffUserId: z.string(),
                cases: jsonValueSchema,
                region: z.string(),
                kind: z.string(),
                organization: z.string(),
                areas: jsonValueSchema,
                score: z.union([z.string(), z.number()]),
                licenseNo: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Legal_createLawyer: {
    method: "post",
    path: "/enterprise/legal/lawyers",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              qualification: z.string(),
              province: z.string(),
              city: z.string(),
              intro: z.union([z.null(), z.string()]),
              auditNote: z.string(),
              createdAt: z.string(),
              name: z.string(),
              ownerUserId: z.string(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              cases: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              region: z.string(),
              kind: z.string(),
              organization: z.string(),
              areas: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              score: z.union([z.string(), z.number()]),
              licenseNo: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_updateLawyer: {
    method: "patch",
    path: "/enterprise/legal/lawyers/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              qualification: z.string(),
              province: z.string(),
              city: z.string(),
              intro: z.union([z.null(), z.string()]),
              auditNote: z.string(),
              createdAt: z.string(),
              name: z.string(),
              ownerUserId: z.string(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              cases: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              region: z.string(),
              kind: z.string(),
              organization: z.string(),
              areas: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              score: z.union([z.string(), z.number()]),
              licenseNo: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_removeLawyer: {
    method: "delete",
    path: "/enterprise/legal/lawyers/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_list: {
    method: "get",
    path: "/enterprise/legal/requests",
    params: z.object({}),
    query: z
      .object({ province: z.string().optional(), city: z.string().optional() })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                conversationCount: z.number(),
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                province: z.string(),
                city: z.string(),
                createdAt: z.string(),
                contractId: z.number(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                category: z.string(),
                requestNo: z.string(),
                createdBy: z.string(),
                staffUserId: z.string(),
                subCategoryId: z.string(),
                title: z.string(),
                regionMode: z.string(),
                longitude: z.union([z.null(), z.number()]),
                latitude: z.union([z.null(), z.number()]),
                radiusKm: z.union([z.null(), z.number()]),
                aiworkinPublished: z.number(),
                platformListingId: z.string(),
                platformMatchRunId: z.string(),
                aiworkinSyncStatus: z.string(),
                aiworkinSyncError: z.string(),
                messages: jsonValueSchema,
                fields: jsonValueSchema,
                lawyerId: z.number(),
                category1: z.string(),
                category2: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Legal_create: {
    method: "post",
    path: "/enterprise/legal/requests",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_messages: {
    method: "get",
    path: "/enterprise/legal/requests/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_postMessage: {
    method: "post",
    path: "/enterprise/legal/requests/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        text: z.string().optional().optional(),
        conversation_id: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              messages: z.array(
                z
                  .object({
                    role: z.union([
                      z.literal("ENTERPRISE"),
                      z.literal("PROVIDER"),
                      z.literal("SYSTEM"),
                    ]),
                    name: z.string(),
                    time: z.string(),
                    text: z.string(),
                    reply_to: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              aiworkin_sync: z.boolean(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_publish: {
    method: "post",
    path: "/enterprise/legal/requests/:id/publish",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_updateContacts: {
    method: "post",
    path: "/enterprise/legal/requests/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_updateRequest: {
    method: "patch",
    path: "/enterprise/legal/requests/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Legal_removeRequest: {
    method: "delete",
    path: "/enterprise/legal/requests/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Logistics_list: {
    method: "get",
    path: "/enterprise/logistics",
    params: z.object({}),
    query: z
      .object({
        as: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                messages: z.array(
                  z
                    .object({
                      role: z.union([
                        z.literal("ENTERPRISE"),
                        z.literal("PROVIDER"),
                        z.literal("SYSTEM"),
                      ]),
                      name: z.string(),
                      time: z.string(),
                      text: z.string(),
                      reply_to: z.string().optional().optional(),
                    })
                    .passthrough(),
                ),
                events: z.array(
                  z
                    .object({
                      time: z.string(),
                      status: z.string(),
                      text: z.string(),
                    })
                    .passthrough(),
                ),
                conversationCount: z.number(),
                feedback: z
                  .object({ n: z.number(), m: z.number(), label: z.string() })
                  .passthrough(),
                status: z.string(),
                category1: z.string(),
                category2: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Logistics_create: {
    method: "post",
    path: "/enterprise/logistics",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              provider_id: z.string(),
              provider_name: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Logistics_accept: {
    method: "post",
    path: "/enterprise/logistics/:id/accept",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              provider_id: z.string(),
              provider_name: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Logistics_update: {
    method: "patch",
    path: "/enterprise/logistics/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Logistics_remove: {
    method: "delete",
    path: "/enterprise/logistics/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Logistics_messages: {
    method: "get",
    path: "/enterprise/logistics/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              orderId: z.number(),
              order_no: z.string(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Logistics_postMessage: {
    method: "post",
    path: "/enterprise/logistics/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        text: z.string().optional().optional(),
        conversation_id: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              orderId: z.number(),
              order_no: z.string(),
              messages: z.array(
                z
                  .object({
                    role: z.union([
                      z.literal("ENTERPRISE"),
                      z.literal("PROVIDER"),
                      z.literal("SYSTEM"),
                    ]),
                    name: z.string(),
                    time: z.string(),
                    text: z.string(),
                    reply_to: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              aiworkin_sync: z.boolean(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Logistics_updateContacts: {
    method: "post",
    path: "/enterprise/logistics/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Logistics_advance: {
    method: "post",
    path: "/enterprise/logistics/:id/advance",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_demands: {
    method: "get",
    path: "/enterprise/market/:domain/demands",
    params: z.object({ domain: z.string() }),
    query: z
      .object({
        province: z.string().optional(),
        city: z.string().optional(),
        // 二级类目筛选（供需市场跨板块公开池用；其余板块由板块本身收窄，不传）。
        subCategoryId: z.string().optional(),
        // 取数范围：all＝只读 AIworkin 公开池；mine＝只读本地发布台账（「我发布的」）。
        // 供需市场用它切「全部 / 我发布的」；其余板块不传＝既有口径。
        scope: z.enum(["all", "mine"]).optional(),
        cursor: z.string().uuid().optional(),
        pageSize: z.coerce.number().int().positive().max(200).default(20),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          cursorPageSchema(
            z
              .object({
                id: z.string(),
                listingId: z.string(),
                mine: z.boolean(),
                status: z.string(),
                subCategoryId: z.string(),
                category1: z.string(),
                category2: z.string(),
                title: z.string(),
                description: z.string(),
                tags: z.string(),
                budget: z.string(),
                expectedOutcome: z.string(),
                mustHaves: z.string(),
                startAt: z.string(),
                deadline: z.string(),
                regionScope: z.string(),
                regionMode: z.string(),
                province: z.string(),
                city: z.string(),
                longitude: z.union([z.null(), z.number()]),
                latitude: z.union([z.null(), z.number()]),
                radiusKm: z.union([z.null(), z.number()]),
                contactName: z.string(),
                contactPhone: z.string(),
                contactWechat: z.string(),
                contactEmail: z.string(),
                emailSync: z.number(),
                conversationCount: z.number().nullable(),
                createdAt: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_createDemand: {
    method: "post",
    path: "/enterprise/market/:domain/demands",
    params: z.object({ domain: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.string(),
              listing_id: z.string(),
              status: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_demandMessages: {
    method: "get",
    path: "/enterprise/market/:domain/demands/:id/messages",
    params: z.object({ domain: z.string(), id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              listingId: z.string(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_updateDemand: {
    method: "patch",
    path: "/enterprise/market/:domain/demands/:id",
    params: z.object({ domain: z.string(), id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.string(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_removeDemand: {
    method: "delete",
    path: "/enterprise/market/:domain/demands/:id",
    params: z.object({ domain: z.string(), id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.string(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_services: {
    method: "get",
    path: "/enterprise/market/:domain/services",
    params: z.object({ domain: z.string() }),
    query: z
      .object({
        province: z.string().optional(),
        city: z.string().optional(),
        // 二级类目筛选（供需市场跨板块公开池用；其余板块由板块本身收窄，不传）。
        subCategoryId: z.string().optional(),
        // 取数范围：all＝只读 AIworkin 公开池；mine＝只读本地发布台账（「我发布的」）。
        // 供需市场用它切「全部 / 我发布的」；其余板块不传＝既有口径。
        scope: z.enum(["all", "mine"]).optional(),
        cursor: z.string().uuid().optional(),
        pageSize: z.coerce.number().int().positive().max(200).default(20),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          cursorPageSchema(
            z
              .object({
                id: z.string(),
                listingId: z.string(),
                mine: z.boolean(),
                status: z.string(),
                subCategoryId: z.string(),
                category1: z.string(),
                category2: z.string(),
                credentialTypes: z.string(),
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
                highlights: z.array(z.string()),
                cases: z.string(),
                referenceLinks: z.array(z.string()),
                contactName: z.string(),
                contactPhone: z.string(),
                contactWechat: z.string(),
                contactEmail: z.string(),
                createdAt: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_marketplace: {
    method: "get",
    path: "/enterprise/market/:domain/marketplace",
    params: z.object({ domain: z.string() }),
    query: z
      .object({
        province: z.string().optional(),
        city: z.string().optional(),
        cursor: z.string().uuid().optional(),
        pageSize: z.coerce.number().int().positive().max(200).default(20),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          cursorPageSchema(
            z
              .object({
                id: z.string(),
                listingId: z.string(),
                mine: z.boolean(),
                status: z.string(),
                subCategoryId: z.string(),
                category1: z.string(),
                category2: z.string(),
                credentialTypes: z.string(),
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
                highlights: z.array(z.string()),
                cases: z.string(),
                referenceLinks: z.array(z.string()),
                contactName: z.string(),
                contactPhone: z.string(),
                contactWechat: z.string(),
                contactEmail: z.string(),
                createdAt: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_createService: {
    method: "post",
    path: "/enterprise/market/:domain/services",
    params: z.object({ domain: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.string(),
              platform_listing_id: z.string(),
              status: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_updateService: {
    method: "patch",
    path: "/enterprise/market/:domain/services/:id",
    params: z.object({ domain: z.string(), id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.string(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  MarketBoard_removeService: {
    method: "delete",
    path: "/enterprise/market/:domain/services/:id",
    params: z.object({ domain: z.string(), id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.string(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Marketing_list: {
    method: "get",
    path: "/enterprise/marketing",
    params: z.object({}),
    query: z
      .object({
        as: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                messages: z.array(
                  z
                    .object({
                      role: z.union([
                        z.literal("ENTERPRISE"),
                        z.literal("PROVIDER"),
                        z.literal("SYSTEM"),
                      ]),
                      name: z.string(),
                      time: z.string(),
                      text: z.string(),
                      reply_to: z.string().optional().optional(),
                    })
                    .passthrough(),
                ),
                events: z.array(
                  z
                    .object({
                      time: z.string(),
                      status: z.string(),
                      text: z.string(),
                    })
                    .passthrough(),
                ),
                conversationCount: z.number(),
                feedback: z
                  .object({ n: z.number(), m: z.number(), label: z.string() })
                  .passthrough(),
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                contactEmail: z.string(),
                province: z.string(),
                city: z.string(),
                createdAt: z.string(),
                description: z.string(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                createdBy: z.string(),
                staffUserId: z.string(),
                subCategoryId: z.string(),
                title: z.string(),
                tags: z.string(),
                budget: z.string(),
                expectedResult: z.string(),
                mustConditions: z.string(),
                expectStart: z.string(),
                deadline: z.string(),
                regionScope: z.string(),
                regionMode: z.string(),
                longitude: z.union([z.null(), z.number()]),
                latitude: z.union([z.null(), z.number()]),
                radiusKm: z.union([z.null(), z.number()]),
                emailSync: z.number(),
                contactWechat: z.string(),
                aiworkinPublished: z.number(),
                platformListingId: z.string(),
                platformMatchRunId: z.string(),
                aiworkinSyncStatus: z.string(),
                aiworkinSyncError: z.string(),
                orderNo: z.string(),
                orderType: z.string(),
                providerName: z.string(),
                category1: z.string(),
                category2: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Marketing_create: {
    method: "post",
    path: "/enterprise/marketing",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Marketing_accept: {
    method: "post",
    path: "/enterprise/marketing/:id/accept",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Marketing_update: {
    method: "patch",
    path: "/enterprise/marketing/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Marketing_remove: {
    method: "delete",
    path: "/enterprise/marketing/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Marketing_messages: {
    method: "get",
    path: "/enterprise/marketing/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              orderId: z.number(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Marketing_postMessage: {
    method: "post",
    path: "/enterprise/marketing/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        text: z.string().optional().optional(),
        conversation_id: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              orderId: z.number(),
              messages: z.array(
                z
                  .object({
                    role: z.union([
                      z.literal("ENTERPRISE"),
                      z.literal("PROVIDER"),
                      z.literal("SYSTEM"),
                    ]),
                    name: z.string(),
                    time: z.string(),
                    text: z.string(),
                    reply_to: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              aiworkin_sync: z.boolean(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Marketing_updateContacts: {
    method: "post",
    path: "/enterprise/marketing/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Marketing_confirm: {
    method: "post",
    path: "/enterprise/marketing/:id/confirm",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_me: {
    method: "get",
    path: "/api/v1/users/me",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              userId: z.string(),
              username: z.string(),
              displayName: z.string(),
              email: z.union([z.null(), z.string()]).optional(),
              avatarUrl: z.union([z.null(), z.string()]),
              javaRole: z.string(),
              roles: z.array(z.string()),
              currentIdentity: z.string(),
              identities: z.array(z.string()),
              enterprise: z.union([
                z.null(),
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    userId: z.string(),
                    uscc: z.string(),
                    province: z.string(),
                    city: z.string(),
                    auditNote: z.string(),
                    subjectType: z.string(),
                    idCard: z.string(),
                    createdAt: z.string(),
                    auditedAt: z.union([z.null(), z.string()]),
                    name: z.string(),
                    taxpayerType: z.string(),
                    industry: z.string(),
                    legalPerson: z.string(),
                    phone: z.string(),
                    address: z.string(),
                    qxyOrgId: z.string(),
                  })
                  .passthrough(),
              ]),
              providerApps: z.array(
                z
                  .object({
                    attachments: z.array(z.unknown()),
                    business_staff: z.array(z.unknown()),
                    businessStaff: z.union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      z.record(
                        z.string(),
                        z
                          .union([
                            z.null(),
                            z.string(),
                            z.number(),
                            z.literal(false),
                            z.literal(true),
                            jsonValueSchema,
                          ])
                          .optional(),
                      ),
                      z.array(jsonValueSchema),
                    ]),
                  })
                  .passthrough(),
              ),
              staffProfile: z.union([
                z.null(),
                z
                  .object({
                    categories: z.array(z.string()),
                    id: z.number(),
                    userId: z.string(),
                    qualification: z.string(),
                    province: z.string(),
                    city: z.string(),
                    intro: z.string(),
                    createdAt: z.string(),
                    phone: z.string(),
                    updatedAt: z.string(),
                    realName: z.string(),
                    email: z.string(),
                    region: z.string(),
                  })
                  .passthrough(),
              ]),
              staffOf: z.array(
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    createdAt: z.string(),
                    providerUserId: z.string(),
                    staffUserId: z.string(),
                    roles: z.union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      z.record(
                        z.string(),
                        z
                          .union([
                            z.null(),
                            z.string(),
                            z.number(),
                            z.literal(false),
                            z.literal(true),
                            jsonValueSchema,
                          ])
                          .optional(),
                      ),
                      z.array(jsonValueSchema),
                    ]),
                  })
                  .passthrough(),
              ),
              providerKind: z.union([
                z.literal("NONE"),
                z.literal("STANDARD"),
                z.literal("MICRO"),
              ]),
              qualified: z
                .object({
                  ENTERPRISE_USER: z.boolean(),
                  SERVICE_PROVIDER: z.boolean(),
                  PROVIDER_STAFF: z.boolean(),
                })
                .passthrough(),
              platformFlags: z
                .object({ flexPayrollEnabled: z.boolean() })
                .passthrough(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_roles: {
    method: "get",
    path: "/api/v1/users/me/roles",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ roles: z.array(z.string()), currentIdentity: z.string() })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_switchRole: {
    method: "post",
    path: "/api/v1/users/me/role/switch",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        identity: z.string().optional().optional(),
        role: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              currentIdentity: z.string(),
              identities: z.array(z.string()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_contractsList: {
    method: "get",
    path: "/api/v1/contracts",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                provider_name: z.string(),
                business_staff: z.array(
                  z
                    .object({
                      name: z.string(),
                      title: z.string(),
                      phone: z.string(),
                      email: z.string(),
                    })
                    .passthrough(),
                ),
                designated_staff: z.record(z.string(), z.unknown()),
                designated_agent: z.union([
                  z.null(),
                  z
                    .object({
                      id: z.number(),
                      name: z.string(),
                      org: z.string(),
                    })
                    .passthrough(),
                ]),
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                createdAt: z.string(),
                enterpriseId: z.number(),
                note: z.string(),
                updatedAt: z.string(),
                contractNo: z.string(),
                providerUserId: z.string(),
                providerOrg: z.string(),
                enterpriseName: z.string(),
                serviceType: z.string(),
                startDate: z.string(),
                endDate: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                designatedStaff: jsonValueSchema,
                designatedAgentId: z.number(),
                designatedAgentName: z.string(),
                designatedAgentOrg: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_createContract: {
    method: "post",
    path: "/api/v1/contracts",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              reused: z.boolean(),
              designated_agent: z.union([
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    staffUserId: z.string(),
                    phone: z.string(),
                  })
                  .passthrough(),
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    phone: z.string(),
                    staffUserId: z.unknown().optional(),
                  })
                  .passthrough(),
              ]),
            })
            .passthrough(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              status: z.string(),
              service_type: z.string(),
              provider_name: z.string(),
              designated_agent: z.union([
                z.null(),
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    staffUserId: z.string(),
                    phone: z.string(),
                  })
                  .passthrough(),
                z
                  .object({
                    id: z.number(),
                    name: z.string(),
                    org: z.string(),
                    type: z.string(),
                    phone: z.string(),
                    staffUserId: z.unknown().optional(),
                  })
                  .passthrough(),
              ]),
              reused: z.unknown().optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_confirm: {
    method: "post",
    path: "/api/v1/contracts/:id/confirm",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_terminate: {
    method: "post",
    path: "/api/v1/contracts/:id/terminate",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_taxList: {
    method: "get",
    path: "/api/v1/tax/declarations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                createdAt: z.string(),
                taxAmount: z.union([z.string(), z.number()]),
                contractId: z.number(),
                enterpriseId: z.number(),
                materialId: z.number(),
                updatedAt: z.string(),
                providerUserId: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                staffUserId: z.string(),
                title: z.string(),
                period: z.string(),
                taxType: z.string(),
                receiptNo: z.string(),
                declNo: z.string(),
                formData: jsonValueSchema,
                aiSteps: jsonValueSchema,
                advisorConfirms: jsonValueSchema,
                qcStatus: z.string(),
                qcNote: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_taxCreate: {
    method: "post",
    path: "/api/v1/tax/declarations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              tax_amount: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_overseasList: {
    method: "get",
    path: "/api/v1/export/refund-claims",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                createdAt: z.string(),
                contractId: z.number(),
                enterpriseId: z.number(),
                updatedAt: z.string(),
                providerUserId: z.string(),
                serviceType: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                staffUserId: z.string(),
                title: z.string(),
                remark: z.string(),
                amount: z.union([z.string(), z.number()]),
                claimNo: z.string(),
                country: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_overseasCreate: {
    method: "post",
    path: "/api/v1/export/refund-claims",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.object({
      service_type: z.string(),
      title: z.string(),
      country: z.string().optional(),
      amount: z.union([z.string(), z.number()]).optional(),
      remark: z.string().optional(),
    }),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              claim_no: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_logisticsList: {
    method: "get",
    path: "/api/v1/logistics/orders",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                messages: z.array(
                  z
                    .object({
                      role: z.union([
                        z.literal("ENTERPRISE"),
                        z.literal("PROVIDER"),
                        z.literal("SYSTEM"),
                      ]),
                      name: z.string(),
                      time: z.string(),
                      text: z.string(),
                      reply_to: z.string().optional().optional(),
                    })
                    .passthrough(),
                ),
                events: z.array(
                  z
                    .object({
                      time: z.string(),
                      status: z.string(),
                      text: z.string(),
                    })
                    .passthrough(),
                ),
                conversationCount: z.number(),
                feedback: z
                  .object({ n: z.number(), m: z.number(), label: z.string() })
                  .passthrough(),
                status: z.string(),
                category1: z.string(),
                category2: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_logisticsCreate: {
    method: "post",
    path: "/api/v1/logistics/orders",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              provider_id: z.string(),
              provider_name: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_logisticsMessages: {
    method: "get",
    path: "/api/v1/logistics/orders/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              orderId: z.number(),
              order_no: z.string(),
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_lawyers: {
    method: "get",
    path: "/api/v1/legal/lawyers",
    params: z.object({}),
    query: z
      .object({
        kind: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        keyword: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                qualification: z.string(),
                province: z.string(),
                city: z.string(),
                intro: z.union([z.null(), z.string()]),
                auditNote: z.string(),
                createdAt: z.string(),
                name: z.string(),
                ownerUserId: z.string(),
                providerUserId: z.string(),
                staffUserId: z.string(),
                cases: jsonValueSchema,
                region: z.string(),
                kind: z.string(),
                organization: z.string(),
                areas: jsonValueSchema,
                score: z.union([z.string(), z.number()]),
                licenseNo: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_legalCreate: {
    method: "post",
    path: "/api/v1/legal/requests",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_agencies: {
    method: "get",
    path: "/api/v1/ip/agencies",
    params: z.object({}),
    query: z
      .object({
        kind: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        keyword: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                qualification: z.string(),
                province: z.string(),
                city: z.string(),
                intro: z.union([z.null(), z.string()]),
                auditNote: z.string(),
                createdAt: z.string(),
                name: z.string(),
                phone: z.string(),
                note: z.string(),
                ownerUserId: z.string(),
                cases: jsonValueSchema,
                region: z.string(),
                kind: z.string(),
                organization: z.string(),
                licenseNo: z.string(),
                fields: jsonValueSchema,
                agents: jsonValueSchema,
                ownerType: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_ipCreate: {
    method: "post",
    path: "/api/v1/ip/requests",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_ipConsult: {
    method: "post",
    path: "/api/v1/ip/consultations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_flexProviders: {
    method: "get",
    path: "/api/v1/flex/providers",
    params: z.object({}),
    query: z
      .object({
        record_type: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        keyword: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                province: z.string(),
                city: z.string(),
                intro: z.string(),
                auditNote: z.string(),
                createdAt: z.string(),
                name: z.string(),
                providerUserId: z.string(),
                cases: jsonValueSchema,
                region: z.string(),
                kind: z.string(),
                organization: z.string(),
                licenseNo: z.string(),
                fields: jsonValueSchema,
                agents: jsonValueSchema,
                recordType: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_flexOrder: {
    method: "post",
    path: "/api/v1/flex/work-orders",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              order_no: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_flexOrderGet: {
    method: "get",
    path: "/api/v1/flex/work-orders/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              conversationCount: z.number(),
              status: z.string(),
              id: z.number(),
              contactName: z.string(),
              contactPhone: z.string(),
              contactEmail: z.string(),
              province: z.string(),
              city: z.string(),
              createdAt: z.string(),
              description: z.string(),
              contractId: z.number(),
              enterpriseId: z.number(),
              providerUserId: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              createdBy: z.string(),
              staffUserId: z.string(),
              subCategoryId: z.string(),
              title: z.string(),
              tags: z.string(),
              budget: z.string(),
              expectedResult: z.string(),
              mustConditions: z.string(),
              expectStart: z.string(),
              deadline: z.string(),
              regionScope: z.string(),
              regionMode: z.string(),
              longitude: z.union([z.null(), z.number()]),
              latitude: z.union([z.null(), z.number()]),
              radiusKm: z.union([z.null(), z.number()]),
              emailSync: z.number(),
              contactWechat: z.string(),
              aiworkinPublished: z.number(),
              platformListingId: z.string(),
              platformMatchRunId: z.string(),
              aiworkinSyncStatus: z.string(),
              aiworkinSyncError: z.string(),
              messages: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              agentName: z.string(),
              orderNo: z.string(),
              position: z.string(),
              headcount: z.number(),
              cycle: z.string(),
              skills: z.string(),
              workType: z.string(),
              candidates: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              settlements: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              flexId: z.number(),
              category1: z.string(),
              category2: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_flexMatch: {
    method: "post",
    path: "/api/v1/flex/matches",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.object({ id: z.number().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_flexOnboard: {
    method: "post",
    path: "/api/v1/flex/onboardings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_flexOnboardList: {
    method: "get",
    path: "/api/v1/flex/onboardings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                attachments: jsonValueSchema,
                createdAt: z.string(),
                auditedAt: z.union([z.null(), z.string()]),
                contractId: z.number(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                providerContactName: z.string(),
                providerContactPhone: z.string(),
                staffUserId: z.string(),
                onboardingNo: z.string(),
                agentName: z.string(),
                form: jsonValueSchema,
                rejectNote: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_thinkTankExperts: {
    method: "get",
    path: "/api/v1/think-tank/experts",
    params: z.object({}),
    query: z
      .object({
        kind: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        keyword: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(thinkTankExpertRowSchema)]),
      })
      .passthrough(),
  },
  OpenApi_thinkTankRequests: {
    method: "get",
    path: "/api/v1/think-tank/requests",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(thinkTankRowSchema)]),
      })
      .passthrough(),
  },
  OpenApi_thinkTankCreate: {
    method: "post",
    path: "/api/v1/think-tank/requests",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_keys: {
    method: "get",
    path: "/api/v1/api-keys",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                userId: z.string(),
                createdAt: z.string(),
                masked: z.string(),
                lastUsedAt: z.string().nullable(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  OpenApi_syncKey: {
    method: "post",
    path: "/api/v1/api-keys/sync",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              plainKey: z.string(),
              masked: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OpenApi_keyUsage: {
    method: "get",
    path: "/api/v1/api-keys/:keyId/usage",
    params: z.object({ keyId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                id: z.number(),
                createdAt: z.string(),
                action: z.string(),
                detail: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Overseas_catalog: {
    method: "get",
    path: "/enterprise/overseas/catalog",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.array(overseasProviderSchema).nullable(),
      })
      .passthrough(),
  },
  Overseas_list: {
    method: "get",
    path: "/enterprise/overseas",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(overseasClaimRowSchema)]),
      })
      .passthrough(),
  },
  Overseas_create: {
    method: "post",
    path: "/enterprise/overseas",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.object({
      service_type: z.string(),
      title: z.string(),
      country: z.string().optional(),
      amount: z.union([z.string(), z.number()]).optional(),
      remark: z.string().optional(),
    }),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              claim_no: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Overseas_advance: {
    method: "post",
    path: "/enterprise/overseas/:id/advance",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              id: z.number(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Overseas_updateContacts: {
    method: "post",
    path: "/enterprise/overseas/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OssSettings_view: {
    method: "get",
    path: "/enterprise/admin/oss-settings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              configured: z.boolean(),
              source: z.string(),
              updatedAt: z.union([z.null(), z.string()]),
              bucket: z.string(),
              endpoint: z.string(),
              region: z.string(),
              dir: z.string(),
              accessKeyIdMasked: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OssSettings_save: {
    method: "put",
    path: "/enterprise/admin/oss-settings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        bucket: z.unknown().optional(),
        endpoint: z.unknown().optional(),
        region: z.unknown().optional(),
        dir: z.unknown().optional(),
        accessKeyId: z.unknown().optional(),
        accessKeySecret: z.unknown().optional(),
        securityToken: z.unknown().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              configured: z.boolean(),
              source: z.string(),
              updatedAt: z.union([z.null(), z.string()]),
              bucket: z.string(),
              endpoint: z.string(),
              region: z.string(),
              dir: z.string(),
              accessKeyIdMasked: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  OssSettings_test: {
    method: "post",
    path: "/enterprise/admin/oss-settings/test",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              key: z.string(),
              url: z.string(),
              size: z.number(),
              contentType: z.string(),
              bucket: z.string(),
              endpoint: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Qxy_status: {
    method: "get",
    path: "/enterprise/qxy/status",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              configured: z.boolean(),
              base: z.string(),
              reportMount: z.string(),
              invoiceMount: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Qxy_probe: {
    method: "get",
    path: "/enterprise/qxy/probe",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              tax: z.array(z.string().optional()),
              invoice: z.array(z.string().optional()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Qxy_options: {
    method: "get",
    path: "/enterprise/qxy/options",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              taxTypes: z.array(
                z
                  .object({
                    code: z.string(),
                    label: z.string(),
                    vat: z.boolean().optional(),
                  })
                  .passthrough(),
              ),
              invoiceTypes: z.array(
                z.object({ code: z.string(), label: z.string() }).passthrough(),
              ),
              buyerTypes: z.array(
                z.object({ code: z.string(), label: z.string() }).passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Qxy_autoFile: {
    method: "post",
    path: "/enterprise/qxy/enterprises/:id/auto-file",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        period: z.string().optional().optional(),
        yzpzzlDm: z.string().optional().optional(),
        wkpxse: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              enterpriseId: z.number(),
              state: z.string(),
              yzpzzlDm: z.string(),
              yzpzzlLabel: z.union([
                z.literal("增值税及附加税（小规模纳税人）"),
                z.literal("增值税及附加税（一般纳税人）"),
                z.literal("通用申报表（工会经费等）"),
                z.literal("非税收入通用申报表（垃圾处理费）"),
                z.literal("企业所得税A类（2021年版·查账征收）"),
              ]),
              wkpxse: z.union([z.null(), z.unknown()]),
              period: z
                .object({ start: z.string(), end: z.string() })
                .passthrough(),
              code: z.string(),
              message: z.string(),
              task: z.unknown(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Qxy_filingResult: {
    method: "get",
    path: "/enterprise/qxy/enterprises/:id/filing-result",
    params: z.object({ id: z.string() }),
    query: z.object({ taskId: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              code: z.string(),
              message: z.string(),
              task: z.unknown(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Qxy_autoInvoice: {
    method: "post",
    path: "/enterprise/qxy/enterprises/:id/auto-invoice",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        invoiceType: z.string().optional().optional(),
        buyerType: z.string().optional().optional(),
        buyerName: z.string().optional().optional(),
        buyerTaxNo: z.string().optional().optional(),
        orderNo: z.string().optional().optional(),
        remark: z.string().optional().optional(),
        items: z
          .array(
            z
              .object({
                goodsCode: z.string().optional().optional(),
                goodsName: z.string().optional().optional(),
                spec: z.string().optional().optional(),
                quantity: z.number().optional().optional(),
                price: z.number().optional().optional(),
                amount: z.number().optional().optional(),
                taxRate: z.string().optional().optional(),
                tax: z.number().optional().optional(),
              })
              .passthrough(),
          )
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              enterpriseId: z.number(),
              state: z.string(),
              orderNo: z.string(),
              code: z.string(),
              message: z.string(),
              task: z.unknown(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Qxy_invoices: {
    method: "get",
    path: "/enterprise/qxy/enterprises/:id/invoices",
    params: z.object({ id: z.string() }),
    query: z
      .object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        pageIndex: z.string().optional(),
        pageSize: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              code: z.string(),
              message: z.string(),
              list: z.unknown(),
              period: z
                .object({
                  month: z.string(),
                  quarter: z.string(),
                  year: z.string(),
                })
                .passthrough(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Services_list: {
    method: "get",
    path: "/enterprise/services",
    params: z.object({}),
    query: z.object({ domain: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                domain_label: z.string(),
                category1: z.string(),
                category2: z.string(),
                highlights: z.array(z.string()),
                reference_links: z.array(z.string()),
                domain: z.string(),
                subCategoryId: z.string(),
                referenceLinks: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Services_create: {
    method: "post",
    path: "/enterprise/services",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              service_no: z.string(),
              status: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Services_update: {
    method: "patch",
    path: "/enterprise/services/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              service_no: z.string(),
              status: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Services_publish: {
    method: "post",
    path: "/enterprise/services/:id/publish",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              service_no: z.string(),
              status: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Services_remove: {
    method: "delete",
    path: "/enterprise/services/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  SmartService_list: {
    method: "get",
    path: "/enterprise/smart",
    params: z.object({}),
    query: z
      .object({
        as: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                messages: z.array(
                  z
                    .object({
                      role: z.union([
                        z.literal("ENTERPRISE"),
                        z.literal("PROVIDER"),
                        z.literal("SYSTEM"),
                      ]),
                      name: z.string(),
                      time: z.string(),
                      text: z.string(),
                      reply_to: z.string().optional().optional(),
                    })
                    .passthrough(),
                ),
                events: z.array(
                  z
                    .object({
                      time: z.string(),
                      status: z.string(),
                      text: z.string(),
                    })
                    .passthrough(),
                ),
                conversationCount: z.number(),
                feedback: z
                  .object({ n: z.number(), m: z.number(), label: z.string() })
                  .passthrough(),
                status: z.string(),
                category1: z.string(),
                category2: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  SmartService_create: {
    method: "post",
    path: "/enterprise/smart",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.string()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              provider_id: z.string(),
              provider_name: z.string(),
              aiworkinPublished: z.number(),
              platform_listing_id: z.string(),
              aiworkin_sync_status: z.union([
                z.literal("SYNCED"),
                z.literal("SKIPPED"),
                z.literal("FAILED"),
              ]),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  SmartService_accept: {
    method: "post",
    path: "/enterprise/smart/:id/accept",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              provider_id: z.string(),
              provider_name: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  SmartService_update: {
    method: "patch",
    path: "/enterprise/smart/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  SmartService_remove: {
    method: "delete",
    path: "/enterprise/smart/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  SmartService_messages: {
    method: "get",
    path: "/enterprise/smart/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              conversations: z.array(
                z
                  .object({
                    id: z.string(),
                    name: z.string(),
                    source: z.union([
                      z.literal("AIWORKIN"),
                      z.literal("LOCAL"),
                    ]),
                    messages: z.array(
                      z
                        .object({
                          role: z.union([
                            z.literal("ENTERPRISE"),
                            z.literal("PROVIDER"),
                            z.literal("SYSTEM"),
                          ]),
                          name: z.string(),
                          time: z.string(),
                          text: z.string(),
                          reply_to: z.string().optional().optional(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ),
              source: z.union([z.literal("AIWORKIN"), z.literal("LOCAL")]),
              orderId: z.number(),
              order_no: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  SmartService_postMessage: {
    method: "post",
    path: "/enterprise/smart/:id/messages",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        text: z.string().optional().optional(),
        conversation_id: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              orderId: z.number(),
              order_no: z.string(),
              messages: z.array(
                z
                  .object({
                    role: z.union([
                      z.literal("ENTERPRISE"),
                      z.literal("PROVIDER"),
                      z.literal("SYSTEM"),
                    ]),
                    name: z.string(),
                    time: z.string(),
                    text: z.string(),
                    reply_to: z.string().optional().optional(),
                  })
                  .passthrough(),
              ),
              aiworkin_sync: z.boolean(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  SmartService_updateContacts: {
    method: "post",
    path: "/enterprise/smart/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  SmartService_advance: {
    method: "post",
    path: "/enterprise/smart/:id/advance",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_stations: {
    method: "get",
    path: "/enterprise/supply/stations",
    params: z.object({}),
    query: z.object({ provider: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                contactName: z.string(),
                contactPhone: z.string(),
                createdAt: z.string(),
                name: z.string(),
                address: z.string(),
                updatedAt: z.string(),
                providerUserId: z.string(),
                remark: z.string(),
                region: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Supply_createStation: {
    method: "post",
    path: "/enterprise/supply/stations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              contactName: z.string(),
              contactPhone: z.string(),
              createdAt: z.string(),
              name: z.string(),
              address: z.string(),
              updatedAt: z.string(),
              providerUserId: z.string(),
              remark: z.string(),
              region: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_updateStation: {
    method: "patch",
    path: "/enterprise/supply/stations/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              contactName: z.string(),
              contactPhone: z.string(),
              createdAt: z.string(),
              name: z.string(),
              address: z.string(),
              updatedAt: z.string(),
              providerUserId: z.string(),
              remark: z.string(),
              region: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_removeStation: {
    method: "delete",
    path: "/enterprise/supply/stations/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_products: {
    method: "get",
    path: "/enterprise/supply/products",
    params: z.object({}),
    query: z.object({}).catchall(z.string()),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                stations: z.array(
                  z
                    .object({
                      stationId: z.number(),
                      productId: z.number(),
                      id: z.number(),
                      status: z.string(),
                    })
                    .passthrough(),
                ),
                skus: z.array(
                  z
                    .object({
                      status: z.string(),
                      id: z.number(),
                      createdAt: z.string(),
                      updatedAt: z.string(),
                      unit: z.string(),
                      productId: z.number(),
                      specName: z.string(),
                      supplyPrice: z.union([z.string(), z.number()]),
                      scene: z.string(),
                    })
                    .passthrough(),
                ),
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                name: z.string(),
                updatedAt: z.string(),
                providerUserId: z.string(),
                category: z.string(),
                aiworkinSyncStatus: z.string(),
                basePrice: z.union([z.string(), z.number()]),
                unit: z.string(),
                attrs: z.array(
                  z
                    .object({
                      name: z.string().optional(),
                      value: z.string().optional(),
                    })
                    .passthrough(),
                ),
                marketingTitle: z.string(),
                marketingSummary: z.string(),
                marketingContent: z.string(),
                coverUrl: z.string(),
                featured: z.boolean(),
                aiworkinListingId: z.string(),
                aiworkinSyncNote: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Supply_createProduct: {
    method: "post",
    path: "/enterprise/supply/products",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_updateProduct: {
    method: "patch",
    path: "/enterprise/supply/products/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_removeProduct: {
    method: "delete",
    path: "/enterprise/supply/products/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_setProductStations: {
    method: "post",
    path: "/enterprise/supply/products/:id/stations",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        station_ids: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .optional(),
        stationIds: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              stations: z.array(
                z
                  .object({ stationId: z.number(), status: z.string() })
                  .passthrough(),
              ),
              skus: z.array(
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    createdAt: z.string(),
                    updatedAt: z.string(),
                    unit: z.string(),
                    productId: z.number(),
                    specName: z.string(),
                    supplyPrice: z.union([z.string(), z.number()]),
                    scene: z.string(),
                  })
                  .passthrough(),
              ),
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              name: z.string(),
              updatedAt: z.string(),
              providerUserId: z.string(),
              category: z.string(),
              aiworkinSyncStatus: z.string(),
              basePrice: z.union([z.string(), z.number()]),
              unit: z.string(),
              attrs: z.union([
                z.null(),
                z.string(),
                z.number(),
                z.literal(false),
                z.literal(true),
                z.record(
                  z.string(),
                  z
                    .union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      jsonValueSchema,
                      z.array(jsonValueSchema),
                    ])
                    .optional(),
                ),
                z.array(jsonValueSchema),
              ]),
              marketingTitle: z.string(),
              marketingSummary: z.string(),
              marketingContent: z.string(),
              coverUrl: z.string(),
              featured: z.boolean(),
              aiworkinListingId: z.string(),
              aiworkinSyncNote: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_setProductStationStatus: {
    method: "post",
    path: "/enterprise/supply/products/:id/stations/:stationId/status",
    params: z.object({ id: z.string(), stationId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ status: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              stationId: z.number(),
              status: z.string(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_addSku: {
    method: "post",
    path: "/enterprise/supply/products/:id/skus",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
              unit: z.string(),
              productId: z.number(),
              specName: z.string(),
              supplyPrice: z.union([z.string(), z.number()]),
              scene: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_updateSku: {
    method: "patch",
    path: "/enterprise/supply/skus/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
              unit: z.string(),
              productId: z.number(),
              specName: z.string(),
              supplyPrice: z.union([z.string(), z.number()]),
              scene: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_removeSku: {
    method: "delete",
    path: "/enterprise/supply/skus/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_services: {
    method: "get",
    path: "/enterprise/supply/services",
    params: z.object({}),
    query: z.object({}).catchall(z.string()),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                intro: z.string(),
                createdAt: z.string(),
                name: z.string(),
                updatedAt: z.string(),
                providerUserId: z.string(),
                aiworkinSyncStatus: z.string(),
                basePrice: z.union([z.string(), z.number()]),
                marketingTitle: z.string(),
                marketingSummary: z.string(),
                marketingContent: z.string(),
                coverUrl: z.string(),
                featured: z.boolean(),
                aiworkinListingId: z.string(),
                aiworkinSyncNote: z.string(),
                stationId: z.number(),
                scene: z.string(),
                priceUnit: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Supply_createService: {
    method: "post",
    path: "/enterprise/supply/services",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_updateService: {
    method: "patch",
    path: "/enterprise/supply/services/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tip: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_removeService: {
    method: "delete",
    path: "/enterprise/supply/services/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_orders: {
    method: "get",
    path: "/enterprise/supply/orders",
    params: z.object({}),
    query: z.object({}).catchall(z.string()),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(supplyOrderRowSchema)]),
      })
      .passthrough(),
  },
  Supply_createOrder: {
    method: "post",
    path: "/enterprise/supply/orders",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              order_no: z.string(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_updateOrder: {
    method: "patch",
    path: "/enterprise/supply/orders/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              revision: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_removeOrder: {
    method: "delete",
    path: "/enterprise/supply/orders/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_submitOrder: {
    method: "post",
    path: "/enterprise/supply/orders/:id/submit",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              revision: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_quoteOrder: {
    method: "post",
    path: "/enterprise/supply/orders/:id/quote",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              total_amount: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_confirmOrder: {
    method: "post",
    path: "/enterprise/supply/orders/:id/confirm",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_returnOrder: {
    method: "post",
    path: "/enterprise/supply/orders/:id/return",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_vetoOrder: {
    method: "post",
    path: "/enterprise/supply/orders/:id/veto",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_cancelOrder: {
    method: "post",
    path: "/enterprise/supply/orders/:id/cancel",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_assignOrder: {
    method: "post",
    path: "/enterprise/supply/orders/:id/assign",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        staff_user_id: z.string().optional().optional(),
        staffUserId: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), staff_user_id: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_orderLogs: {
    method: "get",
    path: "/enterprise/supply/orders/:id/logs",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                id: z.number(),
                createdAt: z.string(),
                bizType: z.string(),
                action: z.string(),
                detail: z.string(),
                bizId: z.number(),
                operatorUserId: z.string(),
                operatorName: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Supply_bookings: {
    method: "get",
    path: "/enterprise/supply/bookings",
    params: z.object({}),
    query: z.object({}).catchall(z.string()),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(supplyBookingRowSchema)]),
      })
      .passthrough(),
  },
  Supply_createBooking: {
    method: "post",
    path: "/enterprise/supply/bookings",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              booking_no: z.string(),
              status: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_updateBooking: {
    method: "patch",
    path: "/enterprise/supply/bookings/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              revision: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_removeBooking: {
    method: "delete",
    path: "/enterprise/supply/bookings/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_submitBooking: {
    method: "post",
    path: "/enterprise/supply/bookings/:id/submit",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              revision: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_quoteBooking: {
    method: "post",
    path: "/enterprise/supply/bookings/:id/quote",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              total_amount: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_confirmBooking: {
    method: "post",
    path: "/enterprise/supply/bookings/:id/confirm",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_returnBooking: {
    method: "post",
    path: "/enterprise/supply/bookings/:id/return",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_vetoBooking: {
    method: "post",
    path: "/enterprise/supply/bookings/:id/veto",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_cancelBooking: {
    method: "post",
    path: "/enterprise/supply/bookings/:id/cancel",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ note: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_assignBooking: {
    method: "post",
    path: "/enterprise/supply/bookings/:id/assign",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        staff_user_id: z.string().optional().optional(),
        staffUserId: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), staff_user_id: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Supply_bookingLogs: {
    method: "get",
    path: "/enterprise/supply/bookings/:id/logs",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                id: z.number(),
                createdAt: z.string(),
                bizType: z.string(),
                action: z.string(),
                detail: z.string(),
                bizId: z.number(),
                operatorUserId: z.string(),
                operatorName: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Supply_adminOverview: {
    method: "get",
    path: "/enterprise/supply/admin/overview",
    params: z.object({}),
    query: z.object({}).catchall(z.string()),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              orders: z.array(
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    contactName: z.string(),
                    contactPhone: z.string(),
                    createdAt: z.string(),
                    enterpriseId: z.number(),
                    updatedAt: z.string(),
                    providerUserId: z.string(),
                    enterpriseName: z.string(),
                    providerContactName: z.string(),
                    providerContactPhone: z.string(),
                    createdBy: z.string(),
                    staffUserId: z.string(),
                    remark: z.string(),
                    orderNo: z.string(),
                    totalAmount: z.union([z.string(), z.number()]),
                    expectedDate: z.string(),
                    stationId: z.number(),
                    stationName: z.string(),
                    revision: z.number(),
                    quotedAt: z.union([z.null(), z.string()]),
                    promisedShipDate: z.string(),
                    quoteNote: z.string(),
                    productAmount: z.union([z.string(), z.number()]),
                    otherFees: z.union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      z.record(
                        z.string(),
                        z
                          .union([
                            z.null(),
                            z.string(),
                            z.number(),
                            z.literal(false),
                            z.literal(true),
                            jsonValueSchema,
                          ])
                          .optional(),
                      ),
                      z.array(jsonValueSchema),
                    ]),
                    feeAmount: z.union([z.string(), z.number()]),
                    confirmNote: z.string(),
                    confirmedAt: z.union([z.null(), z.string()]),
                    items: z.array(
                      z
                        .object({
                          id: z.number(),
                          createdAt: z.string(),
                          updatedAt: z.string(),
                          amount: z.union([z.string(), z.number()]),
                          quantity: z.union([z.string(), z.number()]),
                          price: z.union([z.string(), z.number()]),
                          unit: z.string(),
                          productId: z.number(),
                          specName: z.string(),
                          orderId: z.number(),
                          skuId: z.number(),
                          productName: z.string(),
                          stockState: z.string(),
                          shortageNote: z.string(),
                          restockCycle: z.string(),
                        })
                        .passthrough(),
                    ),
                    staffName: z.string(),
                  })
                  .passthrough(),
              ),
              bookings: z.array(
                z
                  .object({
                    status: z.string(),
                    id: z.number(),
                    contactName: z.string(),
                    contactPhone: z.string(),
                    createdAt: z.string(),
                    enterpriseId: z.number(),
                    updatedAt: z.string(),
                    providerUserId: z.string(),
                    enterpriseName: z.string(),
                    providerContactName: z.string(),
                    providerContactPhone: z.string(),
                    createdBy: z.string(),
                    staffUserId: z.string(),
                    remark: z.string(),
                    totalAmount: z.union([z.string(), z.number()]),
                    stationId: z.number(),
                    priceUnit: z.string(),
                    stationName: z.string(),
                    revision: z.number(),
                    quotedAt: z.union([z.null(), z.string()]),
                    quoteNote: z.string(),
                    otherFees: z.union([
                      z.null(),
                      z.string(),
                      z.number(),
                      z.literal(false),
                      z.literal(true),
                      z.record(
                        z.string(),
                        z
                          .union([
                            z.null(),
                            z.string(),
                            z.number(),
                            z.literal(false),
                            z.literal(true),
                            jsonValueSchema,
                          ])
                          .optional(),
                      ),
                      z.array(jsonValueSchema),
                    ]),
                    feeAmount: z.union([z.string(), z.number()]),
                    confirmNote: z.string(),
                    confirmedAt: z.union([z.null(), z.string()]),
                    bookingNo: z.string(),
                    serviceId: z.number(),
                    serviceName: z.string(),
                    planDate: z.string(),
                    siteAddress: z.string(),
                    scale: z.string(),
                    baseAmount: z.union([z.string(), z.number()]),
                    staffName: z.string(),
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
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_meta: {
    method: "get",
    path: "/enterprise/tax/meta",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              forms: z.array(
                z
                  .object({
                    type: z.union([
                      z.literal("vat_general"),
                      z.literal("vat_small"),
                      z.literal("cit_quarter"),
                      z.literal("cit_annual"),
                      z.literal("stamp_duty"),
                      z.literal("surtax"),
                      z.literal("iit_withholding"),
                      z.literal("iit_operating_a"),
                      z.literal("iit_operating_b"),
                      z.literal("iit_operating_c"),
                      z.literal("ibp"),
                    ]),
                    label: z.string(),
                  })
                  .passthrough(),
              ),
              advisor_checks: z.array(z.string()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_providers: {
    method: "get",
    path: "/enterprise/tax/providers",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z
          .array(
            overseasProviderSchema.omit({ display_name: true, items: true }),
          )
          .nullable(),
      })
      .passthrough(),
  },
  Tax_decls: {
    method: "get",
    path: "/enterprise/tax/declarations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(taxDeclarationRowSchema)]),
      })
      .passthrough(),
  },
  Tax_declDetail: {
    method: "get",
    path: "/enterprise/tax/declarations/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              status: z.string(),
              id: z.number(),
              contactName: z.string(),
              contactPhone: z.string(),
              createdAt: z.string(),
              taxAmount: z.union([z.string(), z.number()]),
              contractId: z.number(),
              enterpriseId: z.number(),
              materialId: z.number(),
              updatedAt: z.string(),
              providerUserId: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              staffUserId: z.string(),
              title: z.string(),
              period: z.string(),
              taxType: z.string(),
              receiptNo: z.string(),
              declNo: z.string(),
              formData: z.record(z.string(), z.unknown()),
              aiSteps: z.array(
                z
                  .object({
                    step: z.number().optional(),
                    text: z.string().optional(),
                    status: z.string().optional(),
                    note: z.string().optional(),
                    at: z.string().optional(),
                  })
                  .passthrough(),
              ),
              advisorConfirms: z.array(z.string()),
              qcStatus: z.string(),
              qcNote: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_createDecl: {
    method: "post",
    path: "/enterprise/tax/declarations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              tax_amount: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_form: {
    method: "post",
    path: "/enterprise/tax/declarations/:id/form",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.object({
          taxpayerName: z.string().optional(),
          uscc: z.string().optional(),
          period: z.string().optional(),
        }),
      ]),
    ),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), tax_amount: z.number() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_declarationContacts: {
    method: "post",
    path: "/enterprise/tax/declarations/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_runAi: {
    method: "post",
    path: "/enterprise/tax/declarations/:id/run-ai",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              ai_steps: z.array(z.string()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_qc: {
    method: "post",
    path: "/enterprise/tax/declarations/:id/qc",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        action: z
          .union([z.literal("REJECT"), z.literal("PASS")])
          .optional()
          .optional(),
        confirms: z.array(z.string()).optional().optional(),
        note: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              receipt_no: z.string(),
              external_submission_id: z.number(),
              tip: z.string().optional(),
            })
            .passthrough(),
          z
            .object({
              id: z.number(),
              status: z.string(),
              receipt_no: z.string(),
              external_submission_id: z.number(),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_pay: {
    method: "post",
    path: "/enterprise/tax/declarations/:id/pay",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({ id: z.number(), status: z.string(), tip: z.string() })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_trial: {
    method: "post",
    path: "/enterprise/tax/trial",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        tax_type: z.string().optional().optional(),
        form: z.record(z.string(), z.number()).optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              tax_type: z.string(),
              tax_amount: z.number(),
              form: z.record(z.string(), z.number()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_saveTrial: {
    method: "post",
    path: "/enterprise/tax/trial/save",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        kind: z.string().optional().optional(),
        title: z.string().optional().optional(),
        snapshot: z.record(z.string(), z.unknown()).optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.object({ id: z.number() }).passthrough()]),
      })
      .passthrough(),
  },
  Tax_records: {
    method: "get",
    path: "/enterprise/tax/records",
    params: z.object({}),
    query: z.object({ kind: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                id: z.number(),
                userId: z.string(),
                createdAt: z.string(),
                title: z.string(),
                kind: z.string(),
                snapshot: z.record(z.string(), z.unknown()),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Tax_deleteRecord: {
    method: "delete",
    path: "/enterprise/tax/records/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), deleted: z.boolean() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_archiveSet: {
    method: "post",
    path: "/enterprise/tax/account-sets/:id/archive",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_sets: {
    method: "get",
    path: "/enterprise/tax/account-sets",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(taxAccountSetRowSchema)]),
      })
      .passthrough(),
  },
  Tax_materialPacks: {
    method: "get",
    path: "/enterprise/tax/material-packs",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), z.array(taxMaterialPackRowSchema)]),
      })
      .passthrough(),
  },
  Tax_currentMaterialPack: {
    method: "get",
    path: "/enterprise/tax/material-packs/current",
    params: z.object({}),
    query: z.object({ period: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              payload: z
                .object({
                  payroll: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                  invoices: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                  bank: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                })
                .passthrough(),
              created_at: z.string(),
              submitted_at: z.union([z.null(), z.string()]),
              analyzed_at: z.union([z.null(), z.string()]),
              counts: z
                .object({
                  payroll: z.number(),
                  invoices: z.number(),
                  bank: z.number(),
                })
                .passthrough(),
              id: z.number(),
              packNo: z.string(),
              period: z.string(),
              title: z.string(),
              status: z.string(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              enterpriseId: z.number(),
              updatedAt: z.string(),
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              createdAt: z.string(),
              submittedAt: z
                .union([z.null(), z.string()])
                .optional()
                .optional(),
              analyzedAt: z.union([z.null(), z.string()]).optional().optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_materialPackDetail: {
    method: "get",
    path: "/enterprise/tax/material-packs/:id",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              enterprise_name: z.string(),
              provider_name: z.string(),
              staff_name: z.string(),
              submitted_at: z.union([z.null(), z.string()]),
              analysis: z.union([
                z.null(),
                z
                  .object({
                    at: z.string(),
                    zero_declare: z.boolean(),
                    summary: z.string(),
                    tax_items: z.array(
                      z
                        .object({
                          tax_type: z.string(),
                          name: z.string(),
                          reason: z.string(),
                          est_amount: z.number(),
                          template: z.string(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              ]),
              decls: z.array(
                z
                  .object({
                    id: z.number(),
                    decl_no: z.string(),
                    tax_type: z.string(),
                    tax_type_name: z.string(),
                    tax_amount: z.union([z.string(), z.number()]),
                    status: z.string(),
                    receipt_no: z.string(),
                    contact_name: z.string(),
                    contact_phone: z.string(),
                    provider_contact_name: z.string(),
                    provider_contact_phone: z.string(),
                  })
                  .passthrough(),
              ),
              payload: z
                .object({
                  payroll: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                  invoices: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                  bank: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                })
                .passthrough(),
              created_at: z.string(),
              analyzed_at: z.union([z.null(), z.string()]),
              counts: z
                .object({
                  payroll: z.number(),
                  invoices: z.number(),
                  bank: z.number(),
                })
                .passthrough(),
              id: z.number(),
              packNo: z.string(),
              period: z.string(),
              title: z.string(),
              status: z.string(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              enterpriseId: z.number(),
              updatedAt: z.string(),
              contactName: z.string(),
              contactPhone: z.string(),
              providerContactName: z.string(),
              providerContactPhone: z.string(),
              createdAt: z.string(),
              submittedAt: z
                .union([z.null(), z.string()])
                .optional()
                .optional(),
              analyzedAt: z.union([z.null(), z.string()]).optional().optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_materialPackContacts: {
    method: "post",
    path: "/enterprise/tax/material-packs/:id/contacts",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              contact_name: z.string(),
              contact_phone: z.string(),
              provider_contact_name: z.string(),
              provider_contact_phone: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_addMaterialRow: {
    method: "post",
    path: "/enterprise/tax/material-packs/:id/rows",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        section: z.string().optional().optional(),
        row: z.record(z.string(), z.unknown()).optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              pack: z
                .object({
                  payload: z
                    .object({
                      payroll: z.array(
                        z.record(
                          z.string(),
                          z.union([z.string(), z.number()]).optional(),
                        ),
                      ),
                      invoices: z.array(
                        z.record(
                          z.string(),
                          z.union([z.string(), z.number()]).optional(),
                        ),
                      ),
                      bank: z.array(
                        z.record(
                          z.string(),
                          z.union([z.string(), z.number()]).optional(),
                        ),
                      ),
                    })
                    .passthrough(),
                  created_at: z.string(),
                  submitted_at: z.union([z.null(), z.string()]),
                  analyzed_at: z.union([z.null(), z.string()]),
                  counts: z
                    .object({
                      payroll: z.number(),
                      invoices: z.number(),
                      bank: z.number(),
                    })
                    .passthrough(),
                  id: z.number(),
                  packNo: z.string(),
                  period: z.string(),
                  title: z.string(),
                  status: z.string(),
                  providerUserId: z.string(),
                  staffUserId: z.string(),
                  enterpriseId: z.number(),
                  createdAt: z.string(),
                  submittedAt: z
                    .union([z.null(), z.string()])
                    .optional()
                    .optional(),
                  analyzedAt: z
                    .union([z.null(), z.string()])
                    .optional()
                    .optional(),
                })
                .passthrough(),
              row: z.record(z.string(), z.unknown()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_updateMaterialRow: {
    method: "patch",
    path: "/enterprise/tax/material-packs/:id/rows/:rowId",
    params: z.object({ id: z.string(), rowId: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        section: z.string().optional().optional(),
        patch: z.record(z.string(), z.unknown()).optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              pack: z
                .object({
                  payload: z
                    .object({
                      payroll: z.array(
                        z.record(
                          z.string(),
                          z.union([z.string(), z.number()]).optional(),
                        ),
                      ),
                      invoices: z.array(
                        z.record(
                          z.string(),
                          z.union([z.string(), z.number()]).optional(),
                        ),
                      ),
                      bank: z.array(
                        z.record(
                          z.string(),
                          z.union([z.string(), z.number()]).optional(),
                        ),
                      ),
                    })
                    .passthrough(),
                  created_at: z.string(),
                  submitted_at: z.union([z.null(), z.string()]),
                  analyzed_at: z.union([z.null(), z.string()]),
                  counts: z
                    .object({
                      payroll: z.number(),
                      invoices: z.number(),
                      bank: z.number(),
                    })
                    .passthrough(),
                  id: z.number(),
                  packNo: z.string(),
                  period: z.string(),
                  title: z.string(),
                  status: z.string(),
                  providerUserId: z.string(),
                  staffUserId: z.string(),
                  enterpriseId: z.number(),
                  createdAt: z.string(),
                  submittedAt: z
                    .union([z.null(), z.string()])
                    .optional()
                    .optional(),
                  analyzedAt: z
                    .union([z.null(), z.string()])
                    .optional()
                    .optional(),
                })
                .passthrough(),
              row: z.record(z.string(), z.unknown()),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_removeMaterialRow: {
    method: "delete",
    path: "/enterprise/tax/material-packs/:id/rows/:rowId",
    params: z.object({ id: z.string(), rowId: z.string() }),
    query: z.object({ section: z.string().optional() }).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              payload: z
                .object({
                  payroll: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                  invoices: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                  bank: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                })
                .passthrough(),
              created_at: z.string(),
              submitted_at: z.union([z.null(), z.string()]),
              analyzed_at: z.union([z.null(), z.string()]),
              counts: z
                .object({
                  payroll: z.number(),
                  invoices: z.number(),
                  bank: z.number(),
                })
                .passthrough(),
              id: z.number(),
              packNo: z.string(),
              period: z.string(),
              title: z.string(),
              status: z.string(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              enterpriseId: z.number(),
              createdAt: z.string(),
              submittedAt: z
                .union([z.null(), z.string()])
                .optional()
                .optional(),
              analyzedAt: z.union([z.null(), z.string()]).optional().optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_submitMaterialPack: {
    method: "post",
    path: "/enterprise/tax/material-packs/:id/submit",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              analyzed: z.number(),
              analysis: z
                .object({
                  at: z.string(),
                  zero_declare: z.boolean(),
                  summary: z.string(),
                  tax_items: z.array(
                    z
                      .object({
                        tax_type: z.string(),
                        name: z.string(),
                        reason: z.string(),
                        est_amount: z.number(),
                        template: z.string(),
                      })
                      .passthrough(),
                  ),
                })
                .passthrough(),
              tip: z.string(),
              payload: z
                .object({
                  payroll: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                  invoices: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                  bank: z.array(
                    z.record(
                      z.string(),
                      z.union([z.string(), z.number()]).optional(),
                    ),
                  ),
                })
                .passthrough(),
              created_at: z.string(),
              submitted_at: z.union([z.null(), z.string()]),
              analyzed_at: z.union([z.null(), z.string()]),
              counts: z
                .object({
                  payroll: z.number(),
                  invoices: z.number(),
                  bank: z.number(),
                })
                .passthrough(),
              id: z.number(),
              packNo: z.string(),
              period: z.string(),
              title: z.string(),
              status: z.string(),
              providerUserId: z.string(),
              staffUserId: z.string(),
              enterpriseId: z.number(),
              createdAt: z.string(),
              submittedAt: z
                .union([z.null(), z.string()])
                .optional()
                .optional(),
              analyzedAt: z.union([z.null(), z.string()]).optional().optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_ocrStatus: {
    method: "get",
    path: "/enterprise/tax/ocr/status",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              mode: z.string(),
              configured: z.boolean(),
              hint: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_ocrInvoice: {
    method: "post",
    path: "/enterprise/tax/material-packs/:id/ocr-invoice",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z
      .object({
        image_base64: z.string().optional().optional(),
        mime: z.string().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              kind: z.string(),
              invoiceNo: z.string(),
              counterparty: z.string(),
              amount: z.number(),
              tax: z.number(),
              date: z.string(),
              extra: z.record(z.string(), z.string()),
              mode: z.string(),
              raw: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_materialAnalysis: {
    method: "get",
    path: "/enterprise/tax/material-packs/:id/analysis",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              packId: z.number(),
              packNo: z.string(),
              period: z.string(),
              status: z.string(),
              rows: z.array(
                z
                  .object({
                    estimatedTax: z.number(),
                    declarationId: z.number(),
                    taxType: z.string(),
                    label: z.string(),
                    basis: z.string(),
                    formTemplate: z.string(),
                    form: z.record(z.string(), z.number()),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_generateDeclarations: {
    method: "post",
    path: "/enterprise/tax/material-packs/:id/generate-declarations",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.record(z.string(), z.unknown()),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              packId: z.number(),
              created: z.number(),
              declarationIds: z.array(z.number()),
              tip: z.string(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_createSet: {
    method: "post",
    path: "/enterprise/tax/account-sets",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({
        name: z.string().optional().optional(),
        enterpriseId: z.number().optional().optional(),
      })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_planList: {
    method: "get",
    path: "/enterprise/tax/plans",
    params: z.object({}),
    query: pageQuerySchema.extend({
      period: z.string().optional(),
      enterpriseId: z.coerce.number().int().positive().optional(),
      accountSetId: z.coerce.number().int().positive().optional(),
    }),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          pageSchema(
            z
              .object({
                enterprise_name: z.string(),
                staff_name: z.string(),
                account_set_name: z.string(),
                decl_no: z.string(),
                decl_status: z.string(),
                tax_type_name: z.string(),
                freq: z.string(),
                template: z.string(),
                tax_type_label: z.string(),
                declaration_no: z.string(),
                declaration_status: z.string(),
                declaration_tax_amount: z.union([
                  z.number(),
                  z.union([z.string(), z.number()]),
                ]),
                declarationId: z.number(),
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                staffUserId: z.string(),
                period: z.string(),
                taxType: z.string(),
                accountSetId: z.number(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Tax_generatePlans: {
    method: "post",
    path: "/enterprise/tax/plans/generate",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              created: z.number(),
              skipped: z.number(),
              due: z.number(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_fromPlan: {
    method: "post",
    path: "/enterprise/tax/plans/:id/create-decl",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z
            .object({
              id: z.number(),
              existing: z.boolean(),
              decl_no: z.string(),
              status: z.unknown().optional(),
            })
            .passthrough(),
          z
            .object({
              id: z.number(),
              existing: z.boolean(),
              status: z.string(),
              decl_no: z.unknown().optional(),
            })
            .passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_consultations: {
    method: "get",
    path: "/enterprise/tax/consultations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.array(
            z
              .object({
                status: z.string(),
                id: z.number(),
                createdAt: z.string(),
                contractId: z.number(),
                enterpriseId: z.number(),
                providerUserId: z.string(),
                staffUserId: z.string(),
                question: z.string(),
                answer: z.string(),
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough(),
  },
  Tax_ask: {
    method: "post",
    path: "/enterprise/tax/consultations",
    params: z.object({}),
    query: z.object({}).passthrough(),
    body: z
      .object({ question: z.string().optional().optional() })
      .passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_reply: {
    method: "post",
    path: "/enterprise/tax/consultations/:id/reply",
    params: z.object({ id: z.string() }),
    query: z.object({}).passthrough(),
    body: z.object({ answer: z.string().optional().optional() }).passthrough(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          z.object({ id: z.number(), status: z.string() }).passthrough(),
        ]),
      })
      .passthrough(),
  },
  Tax_planStats: {
    method: "get",
    path: "/enterprise/tax/plans/stats",
    params: z.object({}),
    query: z.object({
      accountSetId: z.coerce.number().int().positive().optional(),
    }),
    body: z.undefined(),
    response: z.object({
      code: z.number(),
      message: z.string(),
      data: z
        .object({
          total: z.number(),
          enterpriseCount: z.number(),
          due: z.number(),
          in_progress: z.number(),
          done: z.number(),
        })
        .nullable(),
    }),
  },
  Apps_list: {
    method: "get",
    path: "/enterprise/apps",
    params: z.object({}),
    query: z
      .object({
        category: z.string().max(60).optional(),
        q: z.string().max(100).optional(),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(12),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), pageSchema(appItemSchema)]),
      })
      .passthrough(),
  },
  Apps_detail: {
    method: "get",
    path: "/enterprise/apps/:clientId",
    params: z.object({ clientId: z.string() }),
    query: z.object({}).passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([z.null(), appDetailSchema]),
      })
      .passthrough(),
  },
  Apps_reviews: {
    method: "get",
    path: "/enterprise/apps/:clientId/reviews",
    params: z.object({ clientId: z.string() }),
    query: z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(10),
      })
      .passthrough(),
    body: z.undefined(),
    response: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.union([
          z.null(),
          pageSchema(appReviewSchema).extend({
            avgRating: z.number(),
            reviewCount: z.number(),
          }),
        ]),
      })
      .passthrough(),
  },
} as const;
/**
 * 走本站统一 `code/message/data` 信封的接口清单。
 * MCP 端点不在这张表里：它按 JSON-RPC 2.0 自成一格，登记在 `mcpEndpoints`，
 * 否则前端 `endpoint()` 的返回类型（要求响应含 `data`）会被它带坏。
 *
 * 各模块的清单用 `typeof` 交叉引用，不在这张表里再展开一遍：
 * 单个声明节点的序列化长度有上限（超限即 TS7056），全仓清单早已逼近上限。
 */
type ModuleEndpoints = typeof adminPageEndpoints &
  typeof automationEndpoints &
  typeof agentEndpoints &
  typeof contentEndpoints &
  typeof mailEndpoints &
  typeof notificationsEndpoints &
  typeof orgStaffEndpoints &
  typeof serviceDeskEndpoints &
  typeof livecodeEndpoints &
  typeof crmEndpoints &
  typeof biEndpoints &
  typeof lowcodeEndpoints &
  typeof okrEndpoints &
  typeof partyEndpoints &
  typeof oaEndpoints &
  typeof questionHallEndpoints &
  typeof distributionEndpoints &
  typeof helpEndpoints &
  typeof imEndpoints &
  typeof skillHubEndpoints &
  typeof communityEndpoints &
  typeof communityAdminEndpoints &
  typeof videoTemplateEndpoints &
  typeof governanceEndpoints &
  typeof kbEndpoints &
  typeof hrmEndpoints &
  typeof skillGeneratorEndpoints &
  typeof surveyEndpoints &
  typeof moderationEndpoints &
  typeof storageEndpoints &
  typeof mechanismsEndpoints &
  typeof projectEndpoints &
  typeof growthEndpoints &
  typeof erpEndpoints &
  typeof mktEndpoints &
  typeof recruitEndpoints &
  typeof seoEndpoints &
  typeof acquisitionEndpoints &
  typeof collabEndpoints &
  typeof scrmEndpoints &
  typeof enterpriseGapEndpoints &
  typeof aiEndpoints &
  typeof modelPlazaEndpoints &
  typeof modelPlazaAdminEndpoints &
  typeof hardwareEndpoints;
export const endpoints: ModuleEndpoints & typeof localEndpoints = {
  ...adminPageEndpoints,
  ...automationEndpoints,
  ...agentEndpoints,
  ...contentEndpoints,
  ...mailEndpoints,
  ...notificationsEndpoints,
  ...orgStaffEndpoints,
  ...serviceDeskEndpoints,
  ...livecodeEndpoints,
  ...crmEndpoints,
  ...biEndpoints,
  ...lowcodeEndpoints,
  ...okrEndpoints,
  ...partyEndpoints,
  ...oaEndpoints,
  ...questionHallEndpoints,
  ...distributionEndpoints,
  ...helpEndpoints,
  ...imEndpoints,
  ...skillHubEndpoints,
  ...communityEndpoints,
  ...communityAdminEndpoints,
  ...videoTemplateEndpoints,
  ...governanceEndpoints,
  ...kbEndpoints,
  ...hrmEndpoints,
  ...skillGeneratorEndpoints,
  ...surveyEndpoints,
  ...moderationEndpoints,
  ...storageEndpoints,
  ...mechanismsEndpoints,
  ...projectEndpoints,
  ...growthEndpoints,
  ...erpEndpoints,
  ...mktEndpoints,
  ...recruitEndpoints,
  ...seoEndpoints,
  ...acquisitionEndpoints,
  ...collabEndpoints,
  ...scrmEndpoints,
  ...enterpriseGapEndpoints,
  ...aiEndpoints,
  ...modelPlazaEndpoints,
  ...modelPlazaAdminEndpoints,
  ...hardwareEndpoints,
  ...localEndpoints,
};
export type EndpointId = keyof typeof endpoints;
export type EndpointInput<K extends EndpointId> = {
  params: z.input<(typeof endpoints)[K]["params"]>;
  query: z.input<(typeof endpoints)[K]["query"]>;
  body: z.input<(typeof endpoints)[K]["body"]>;
};
export type EndpointResponse<K extends EndpointId> = z.output<
  (typeof endpoints)[K]["response"]
>;
