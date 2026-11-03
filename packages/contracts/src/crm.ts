import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const money = z.union([z.string(), z.number()]);
const idParam = z.object({ id: z.string() });
const childParam = (name: string) =>
  z.object({ id: z.string(), [name]: z.string() });

/** CRM 角色固定五种；成员来自现有「职员/代理人管理」，同一账号企业/服务商共用同一套人。 */
export const CRM_ROLES = [
  "ADMIN",
  "MANAGER",
  "SALES",
  "FINANCE",
  "READONLY",
] as const;
export const CRM_ROLE_LABELS: Record<string, string> = {
  ADMIN: "负责人",
  MANAGER: "主管",
  SALES: "销售",
  FINANCE: "财务",
  READONLY: "只读",
};
export const CRM_SCOPES = ["ALL", "DEPT", "SELF"] as const;
export const CRM_SCOPE_LABELS: Record<string, string> = {
  ALL: "本账号全部",
  DEPT: "本部门",
  SELF: "本人负责",
};
export const CRM_LEAD_STAGES = [
  "NEW",
  "FOLLOWING",
  "INTERESTED",
  "SUCCESS",
  "FAIL",
] as const;
export const CRM_LEAD_STAGE_LABELS: Record<string, string> = {
  NEW: "新建",
  FOLLOWING: "跟进中",
  INTERESTED: "感兴趣",
  SUCCESS: "成功",
  FAIL: "失败",
};
export const CRM_APPROVAL_STATUS_LABELS: Record<string, string> = {
  PENDING: "待提交",
  APPROVING: "审批中",
  APPROVED: "已通过",
  UNAPPROVED: "已驳回",
  REVOKED: "已撤回",
  "": "未提交",
};
export const CRM_FORM_TYPES = [
  "LEAD",
  "CUSTOMER",
  "OPPORTUNITY",
  "QUOTATION",
  "CONTRACT",
  "INVOICE",
  "ORDER",
  "CUSTOM",
] as const;
export const CRM_FORM_TYPE_LABELS: Record<string, string> = {
  LEAD: "线索",
  CUSTOMER: "客户",
  OPPORTUNITY: "商机",
  QUOTATION: "报价",
  CONTRACT: "销售合同",
  INVOICE: "发票",
  ORDER: "订单",
  CUSTOM: "自定义",
};
export const CRM_FOLLOW_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
};
export const CRM_POOL_OPERATORS = ["lt", "lte", "gt", "gte", "eq"] as const;

const memberRow = z
  .object({
    id: z.number(),
    memberUserId: z.string(),
    memberName: z.string(),
    role: z.string(),
    roleLabel: z.string(),
    dataScope: z.string(),
    dataScopeLabel: z.string(),
    department: z.string(),
    status: z.string(),
    isSelf: z.boolean(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmMemberRow = z.infer<typeof memberRow>;

export const fieldDefRow = z
  .object({
    id: z.number(),
    formKey: z.string(),
    fieldKey: z.string(),
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    options: z.array(z.string()),
    visible: z.boolean(),
    editable: z.boolean(),
    sort: z.number(),
  })
  .passthrough();

export type CrmFieldDef = z.infer<typeof fieldDefRow>;

export type CrmLeadRow = z.infer<typeof leadRow>;

const leadRow = z
  .object({
    id: z.number(),
    name: z.string(),
    contactName: z.string(),
    phone: z.string(),
    maskedPhone: z.string(),
    email: z.string(),
    maskedEmail: z.string(),
    source: z.string(),
    stage: z.string(),
    stageLabel: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    poolId: z.number(),
    poolName: z.string(),
    inPool: z.boolean(),
    products: z.array(z.string()),
    transitionType: z.string(),
    transitionId: z.number(),
    lastFollowerId: z.string(),
    lastFollowerName: z.string(),
    lastFollowAt: z.string(),
    frozen: z.boolean(),
    freezeReason: z.string(),
    approvalStatus: z.string(),
    approvalStatusLabel: z.string(),
    custom: z.record(z.string(), z.unknown()),
    remark: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export type CrmCustomerRow = z.infer<typeof customerRow>;

const customerRow = z
  .object({
    id: z.number(),
    name: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    poolId: z.number(),
    poolName: z.string(),
    inPool: z.boolean(),
    collectionAt: z.string(),
    lastFollowAt: z.string(),
    frozen: z.boolean(),
    freezeReason: z.string(),
    approvalStatus: z.string(),
    approvalStatusLabel: z.string(),
    industry: z.string(),
    province: z.string(),
    city: z.string(),
    contactCount: z.number(),
    opportunityCount: z.number(),
    contractAmount: money,
    custom: z.record(z.string(), z.unknown()),
    remark: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmContactRow = z.infer<typeof contactRow>;

const contactRow = z
  .object({
    id: z.number(),
    customerId: z.number(),
    name: z.string(),
    phone: z.string(),
    email: z.string(),
    title: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    enabled: z.boolean(),
    disableReason: z.string(),
    custom: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmOpportunityRow = z.infer<typeof opportunityRow>;

const opportunityRow = z
  .object({
    id: z.number(),
    customerId: z.number(),
    customerName: z.string(),
    name: z.string(),
    amount: money,
    possible: money,
    stageId: z.number(),
    stageName: z.string(),
    stageType: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    contactId: z.number(),
    contactName: z.string(),
    expectedEndAt: z.string(),
    actualEndAt: z.string(),
    failureReason: z.string(),
    lastFollowAt: z.string(),
    approvalStatus: z.string(),
    approvalStatusLabel: z.string(),
    custom: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmQuotationRow = z.infer<typeof quotationRow>;

const quotationRow = z
  .object({
    id: z.number(),
    opportunityId: z.number(),
    opportunityName: z.string(),
    customerId: z.number(),
    customerName: z.string(),
    name: z.string(),
    untilAt: z.string(),
    amount: money,
    approvalStatus: z.string(),
    approvalStatusLabel: z.string(),
    invalid: z.boolean(),
    version: z.number(),
    items: z.array(
      z
        .object({
          id: z.number(),
          productId: z.number(),
          nameSnapshot: z.string(),
          qty: money,
          price: money,
          amount: money,
        })
        .passthrough(),
    ),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmContractRow = z.infer<typeof contractRow>;

const contractRow = z
  .object({
    id: z.number(),
    number: z.string(),
    name: z.string(),
    customerId: z.number(),
    customerName: z.string(),
    opportunityId: z.number(),
    quotationId: z.number(),
    amount: money,
    paidAmount: money,
    stageId: z.number(),
    stageName: z.string(),
    approvalStatus: z.string(),
    approvalStatusLabel: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    startAt: z.string(),
    endAt: z.string(),
    voidReason: z.string(),
    remark: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmPaymentPlanRow = z.infer<typeof paymentPlanRow>;

const paymentPlanRow = z
  .object({
    id: z.number(),
    contractId: z.number(),
    contractNumber: z.string(),
    contractName: z.string(),
    customerName: z.string(),
    name: z.string(),
    planAmount: money,
    paidAmount: money,
    planEndAt: z.string(),
    status: z.string(),
    statusLabel: z.string(),
    overdue: z.boolean(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmPaymentRecordRow = z.infer<typeof paymentRecordRow>;

const paymentRecordRow = z
  .object({
    id: z.number(),
    contractId: z.number(),
    contractNumber: z.string(),
    customerName: z.string(),
    paymentPlanId: z.number(),
    planName: z.string(),
    name: z.string(),
    no: z.string(),
    recordAmount: money,
    recordEndAt: z.string(),
    attachmentKey: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmInvoiceRow = z.infer<typeof invoiceRow>;

const invoiceRow = z
  .object({
    id: z.number(),
    contractId: z.number(),
    contractNumber: z.string(),
    businessTitleId: z.number(),
    businessTitleName: z.string(),
    name: z.string(),
    amount: money,
    invoiceType: z.string(),
    invoiceTypeLabel: z.string(),
    taxRate: money,
    approvalStatus: z.string(),
    approvalStatusLabel: z.string(),
    attachmentKey: z.string(),
    remark: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmBusinessTitleRow = z.infer<typeof businessTitleRow>;

const businessTitleRow = z
  .object({
    id: z.number(),
    customerId: z.number(),
    customerName: z.string(),
    name: z.string(),
    taxNo: z.string(),
    bank: z.string(),
    account: z.string(),
    address: z.string(),
    phone: z.string(),
    capital: z.string(),
    scale: z.string(),
    province: z.string(),
    city: z.string(),
    industry: z.string(),
    isDefault: z.boolean(),
    remark: z.string(),
  })
  .passthrough();

export type CrmOrderRow = z.infer<typeof orderRow>;

const orderRow = z
  .object({
    id: z.number(),
    number: z.string(),
    name: z.string(),
    customerId: z.number(),
    customerName: z.string(),
    contractId: z.number(),
    contractNumber: z.string(),
    amount: money,
    stageId: z.number(),
    stageName: z.string(),
    approvalStatus: z.string(),
    approvalStatusLabel: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    remark: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmProductRow = z.infer<typeof productRow>;

const productRow = z
  .object({
    id: z.number(),
    name: z.string(),
    code: z.string(),
    price: money,
    status: z.boolean(),
    sort: z.number(),
    description: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmApprovalRow = z.infer<typeof approvalRow>;

const approvalRow = z
  .object({
    id: z.number(),
    formType: z.string(),
    formTypeLabel: z.string(),
    targetId: z.number(),
    title: z.string(),
    status: z.string(),
    statusLabel: z.string(),
    submitter: z.string(),
    submitterName: z.string(),
    currentNode: z.number(),
    submittedAt: z.string(),
    finishedAt: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmPoolRow = z.infer<typeof poolRow>;

const poolRow = z
  .object({
    id: z.number(),
    name: z.string(),
    description: z.string(),
    adminId: z.string(),
    adminName: z.string(),
    auto: z.boolean(),
    enabled: z.boolean(),
    scopeIds: z.array(z.string()),
    pickRule: z.record(z.string(), z.unknown()),
    recycleRule: z.array(z.record(z.string(), z.unknown())),
    leadCount: z.number(),
  })
  .passthrough();

export type CrmStageRow = z.infer<typeof stageRow>;

const stageRow = z
  .object({
    id: z.number(),
    name: z.string(),
    type: z.string(),
    sort: z.number(),
    winRate: z.number(),
    count: z.number(),
    amount: money,
  })
  .passthrough();

export type CrmFollowRow = z.infer<typeof followRow>;

const followRow = z
  .object({
    id: z.number(),
    targetType: z.string(),
    targetId: z.number(),
    type: z.string(),
    content: z.string(),
    result: z.string(),
    nextAt: z.string(),
    createdBy: z.string(),
    createdByName: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmPlanRow = z.infer<typeof planRow>;

const planRow = z
  .object({
    id: z.number(),
    targetType: z.string(),
    targetId: z.number(),
    planAt: z.string(),
    status: z.string(),
    statusLabel: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    content: z.string(),
    reminderAt: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type CrmApprovalFlowRow = z.infer<typeof flowRow>;

const flowRow = z
  .object({
    id: z.number(),
    formType: z.string(),
    formTypeLabel: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    currentVersion: z.number(),
    nodes: z.array(z.record(z.string(), z.unknown())),
    updatedAt: z.string(),
  })
  .passthrough();

export type CrmApprovalTaskRow = z.infer<typeof taskRow>;

const taskRow = z
  .object({
    id: z.number(),
    instanceId: z.number(),
    nodeIndex: z.number(),
    nodeName: z.string(),
    approverId: z.string(),
    approverName: z.string(),
    status: z.string(),
    action: z.string(),
    comment: z.string(),
    actedAt: z.string(),
    formType: z.string(),
    formTypeLabel: z.string(),
    targetId: z.number(),
    title: z.string(),
    submitterName: z.string(),
    submittedAt: z.string(),
    instanceStatus: z.string(),
  })
  .passthrough();

export type CrmChangeLogRow = z.infer<typeof logRow>;

const logRow = z
  .object({
    id: z.number(),
    targetType: z.string(),
    targetId: z.number(),
    action: z.string(),
    operator: z.string(),
    operatorName: z.string(),
    channel: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

const aiDraft = z
  .object({
    fields: z.record(z.string(), z.unknown()),
    confidence: z.number(),
    notes: z.string(),
  })
  .passthrough();

const approvalTodoQuery = pageQuerySchema.extend({
  status: z.string().optional(),
  formType: z.string().optional(),
});

export const crmEndpoints = {
  // ---------- 工作台 / 搜索 / 报表 ----------
  Crm_workbench: {
    method: "get" as const,
    path: "/enterprise/crm/workbench",
    params: z.object({}),
    query: z.object({
      range: z.enum(["today", "week", "month", "year"]).default("month"),
    }),
    body: z.undefined(),
    response: envelope(
      z
        .object({
          isMember: z.boolean(),
          role: z.string(),
          roleLabel: z.string(),
          stats: z.array(
            z.object({
              key: z.string(),
              label: z.string(),
              value: z.string(),
              hint: z.string(),
            }),
          ),
          todo: z.object({
            follow: z.number(),
            approval: z.number(),
            receivable: z.number(),
            overdue: z.number(),
          }),
          quickAccess: z.array(
            z.object({ key: z.string(), label: z.string(), path: z.string() }),
          ),
        })
        .passthrough(),
    ),
  },
  Crm_globalSearch: {
    method: "get" as const,
    path: "/enterprise/crm/search",
    params: z.object({}),
    query: z.object({ keyword: z.string().min(1) }),
    body: z.undefined(),
    response: envelope(
      z.object({
        groups: z.array(
          z.object({
            module: z.string(),
            label: z.string(),
            rows: z.array(z.record(z.string(), z.unknown())),
          }),
        ),
      }),
    ),
  },
  Crm_duplicateCheck: {
    method: "get" as const,
    path: "/enterprise/crm/duplicates",
    params: z.object({}),
    query: z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(
      z.object({
        candidates: z.array(
          z.object({
            module: z.string(),
            label: z.string(),
            id: z.number(),
            title: z.string(),
            detail: z.string(),
            exact: z.boolean(),
          }),
        ),
      }),
    ),
  },
  Crm_saveQuickAccess: {
    method: "post" as const,
    path: "/enterprise/crm/quick-access",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ items: z.array(z.string()).max(8) }),
    response: envelope(z.object({ saved: z.boolean() })),
  },
  Crm_statsOverview: {
    method: "get" as const,
    path: "/enterprise/crm/reports/overview",
    params: z.object({}),
    query: z.object({ range: z.string().default("month") }),
    body: z.undefined(),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_statsFunnel: {
    method: "get" as const,
    path: "/enterprise/crm/reports/funnel",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        stages: z.array(
          z.object({ name: z.string(), count: z.number(), amount: money }),
        ),
      }),
    ),
  },
  Crm_statsReceivables: {
    method: "get" as const,
    path: "/enterprise/crm/reports/receivables",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        total: money,
        paid: money,
        overdue: money,
        rows: z.array(z.record(z.string(), z.unknown())),
      }),
    ),
  },
  Crm_changeLogs: {
    method: "get" as const,
    path: "/enterprise/crm/change-logs",
    params: z.object({}),
    query: pageQuerySchema.extend({
      targetType: z.string().optional(),
      targetId: z.coerce.number().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(logRow)),
  },

  // ---------- 设置 / 成员 / 字段 ----------
  Crm_settings: {
    method: "get" as const,
    path: "/enterprise/crm/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          currency: z.string(),
          maskPhone: z.boolean(),
          maskEmail: z.boolean(),
          titleFields: z.record(z.string(), z.unknown()),
          aiAnalysisGuide: z.string(),
          role: z.string(),
          roleLabel: z.string(),
          isAdmin: z.boolean(),
        })
        .passthrough(),
    ),
  },
  Crm_saveSettings: {
    method: "post" as const,
    path: "/enterprise/crm/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      currency: z.string().max(8).optional(),
      maskPhone: z.boolean().optional(),
      maskEmail: z.boolean().optional(),
      titleFields: z.record(z.string(), z.unknown()).optional(),
      aiAnalysisGuide: z.string().max(4000).optional(),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_members: {
    method: "get" as const,
    path: "/enterprise/crm/members",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        rows: z.array(memberRow),
        candidates: z.array(
          z.object({
            memberUserId: z.string(),
            name: z.string(),
            memberKind: z.string(),
            memberKindLabel: z.string(),
            department: z.string(),
            roles: z.array(z.string()),
          }),
        ),
        isAdmin: z.boolean(),
      }),
    ),
  },
  Crm_saveMember: {
    method: "post" as const,
    path: "/enterprise/crm/members",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      memberUserId: z.string().min(1),
      role: z.enum(CRM_ROLES),
      dataScope: z.enum(CRM_SCOPES).default("SELF"),
      department: z.string().max(64).default(""),
    }),
    response: envelope(memberRow),
  },
  Crm_removeMember: {
    method: "delete" as const,
    path: "/enterprise/crm/members/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_fieldDefs: {
    method: "get" as const,
    path: "/enterprise/crm/fields",
    params: z.object({}),
    query: z.object({ formKey: z.string().optional() }),
    body: z.undefined(),
    response: envelope(z.array(fieldDefRow)),
  },
  Crm_saveFieldDef: {
    method: "post" as const,
    path: "/enterprise/crm/fields",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      formKey: z.string().min(1),
      fieldKey: z.string().min(1).max(48),
      name: z.string().min(1).max(60),
      type: z.string().min(1),
      required: z.boolean().default(false),
      options: z.array(z.string()).default([]),
      visible: z.boolean().default(true),
      editable: z.boolean().default(true),
      sort: z.number().int().default(0),
    }),
    response: envelope(fieldDefRow),
  },
  Crm_removeFieldDef: {
    method: "delete" as const,
    path: "/enterprise/crm/fields/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_customModules: {
    method: "get" as const,
    path: "/enterprise/crm/custom-modules",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Crm_saveCustomModule: {
    method: "post" as const,
    path: "/enterprise/crm/custom-modules",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      name: z.string().min(1).max(60),
      dataTableId: z.number().int().min(1),
      roleIds: z.array(z.string()).default([]),
      enabled: z.boolean().default(true),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_removeCustomModule: {
    method: "delete" as const,
    path: "/enterprise/crm/custom-modules/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 线索 ----------
  Crm_leads: {
    method: "get" as const,
    path: "/enterprise/crm/leads",
    params: z.object({}),
    query: pageQuerySchema.extend({
      view: z.enum(["all", "mine", "pool"]).default("all"),
      stage: z.string().optional(),
      keyword: z.string().optional(),
      poolId: z.coerce.number().optional(),
      ownerId: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(leadRow)),
  },
  Crm_lead: {
    method: "get" as const,
    path: "/enterprise/crm/leads/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(leadRow),
  },
  Crm_createLead: {
    method: "post" as const,
    path: "/enterprise/crm/leads",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        name: z.string().min(1).max(120),
        contactName: z.string().max(60).default(""),
        phone: z.string().max(40).default(""),
        email: z.string().max(120).default(""),
        source: z.string().max(60).default(""),
        stage: z.string().default("NEW"),
        ownerId: z.string().default(""),
        poolId: z.number().int().default(0),
        products: z.array(z.string()).default([]),
        remark: z.string().max(2000).default(""),
        custom: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
    response: envelope(leadRow),
  },
  Crm_updateLead: {
    method: "patch" as const,
    path: "/enterprise/crm/leads/:id",
    params: idParam,
    query: emptyQuery,
    body: z.record(z.string(), z.unknown()),
    response: envelope(leadRow),
  },
  Crm_updateLeadStage: {
    method: "post" as const,
    path: "/enterprise/crm/leads/:id/stage",
    params: idParam,
    query: emptyQuery,
    body: z.object({ stage: z.string().min(1) }),
    response: envelope(leadRow),
  },
  Crm_removeLead: {
    method: "delete" as const,
    path: "/enterprise/crm/leads/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_transferLead: {
    method: "post" as const,
    path: "/enterprise/crm/leads/:id/transfer",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      ownerId: z.string().min(1),
      reason: z.string().max(200).default(""),
    }),
    response: envelope(leadRow),
  },
  Crm_batchTransferLead: {
    method: "post" as const,
    path: "/enterprise/crm/leads/batch-transfer",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      ids: z.array(z.number().int()).min(1).max(200),
      ownerId: z.string().min(1),
    }),
    response: envelope(z.object({ updated: z.number() })),
  },
  Crm_toPool: {
    method: "post" as const,
    path: "/enterprise/crm/leads/:id/pool",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      poolId: z.number().int().min(1),
      reason: z.string().max(200).default(""),
    }),
    response: envelope(leadRow),
  },
  Crm_pickLead: {
    method: "post" as const,
    path: "/enterprise/crm/leads/:id/pick",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(leadRow),
  },
  Crm_assignLead: {
    method: "post" as const,
    path: "/enterprise/crm/leads/:id/assign",
    params: idParam,
    query: emptyQuery,
    body: z.object({ ownerId: z.string().min(1) }),
    response: envelope(leadRow),
  },
  Crm_freezeLead: {
    method: "post" as const,
    path: "/enterprise/crm/leads/:id/freeze",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      reason: z.string().max(200).default(""),
      unfreezeAt: z.string().optional(),
    }),
    response: envelope(leadRow),
  },
  Crm_unfreezeLead: {
    method: "post" as const,
    path: "/enterprise/crm/leads/:id/unfreeze",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(leadRow),
  },
  Crm_convertLead: {
    method: "post" as const,
    path: "/enterprise/crm/leads/:id/convert",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      customerId: z.number().int().default(0),
      createOpportunity: z.boolean().default(true),
      opportunityName: z.string().max(120).default(""),
      amount: money.optional(),
    }),
    response: envelope(
      z.object({
        lead: leadRow,
        customer: customerRow,
        opportunity: opportunityRow.nullable(),
        linkedExisting: z.boolean(),
      }),
    ),
  },
  Crm_leadOwnerHistory: {
    method: "get" as const,
    path: "/enterprise/crm/leads/:id/owner-history",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.array(
        z.object({
          id: z.number(),
          fromOwner: z.string(),
          fromOwnerName: z.string(),
          toOwner: z.string(),
          toOwnerName: z.string(),
          reason: z.string(),
          createdAt: z.string(),
        }),
      ),
    ),
  },
  Crm_leadPools: {
    method: "get" as const,
    path: "/enterprise/crm/lead-pools",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(poolRow)),
  },
  Crm_saveLeadPool: {
    method: "post" as const,
    path: "/enterprise/crm/lead-pools",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(60),
        description: z.string().max(200).default(""),
        adminId: z.string().default(""),
        auto: z.boolean().default(false),
        enabled: z.boolean().default(true),
        scopeIds: z.array(z.string()).default([]),
        pickRule: z.record(z.string(), z.unknown()).default({}),
        recycleRule: z.array(z.record(z.string(), z.unknown())).default([]),
      })
      .passthrough(),
    response: envelope(poolRow),
  },
  Crm_removeLeadPool: {
    method: "delete" as const,
    path: "/enterprise/crm/lead-pools/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_capacities: {
    method: "get" as const,
    path: "/enterprise/crm/capacities",
    params: z.object({}),
    query: z.object({
      targetType: z.enum(["LEAD", "CUSTOMER"]).default("LEAD"),
    }),
    body: z.undefined(),
    response: envelope(
      z.array(
        z.object({
          id: z.number(),
          targetType: z.string(),
          scopeType: z.string(),
          scopeId: z.string(),
          scopeName: z.string(),
          capacity: z.number(),
          used: z.number(),
        }),
      ),
    ),
  },
  Crm_saveCapacity: {
    method: "post" as const,
    path: "/enterprise/crm/capacities",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      targetType: z.enum(["LEAD", "CUSTOMER"]),
      scopeType: z.enum(["ORG", "DEPT", "MEMBER"]),
      scopeId: z.string().default(""),
      capacity: z.number().int().min(0).max(100000),
    }),
    response: envelope(z.object({ saved: z.boolean() })),
  },

  // ---------- 客户 / 联系人 / 协作 / 关系 ----------
  Crm_customers: {
    method: "get" as const,
    path: "/enterprise/crm/customers",
    params: z.object({}),
    query: pageQuerySchema.extend({
      view: z.enum(["all", "mine", "pool"]).default("all"),
      keyword: z.string().optional(),
      poolId: z.coerce.number().optional(),
      ownerId: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(customerRow)),
  },
  Crm_customer360: {
    method: "get" as const,
    path: "/enterprise/crm/customers/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          customer: customerRow,
          contacts: z.array(contactRow),
          collaborations: z.array(
            z.object({
              id: z.number(),
              userId: z.string(),
              userName: z.string(),
              type: z.string(),
              typeLabel: z.string(),
            }),
          ),
          relations: z.array(
            z.object({
              id: z.number(),
              customerId: z.number(),
              customerName: z.string(),
              type: z.string(),
              typeLabel: z.string(),
            }),
          ),
          opportunities: z.array(opportunityRow),
          contracts: z.array(contractRow),
          paymentPlans: z.array(paymentPlanRow),
          paymentRecords: z.array(paymentRecordRow),
          invoices: z.array(invoiceRow),
          orders: z.array(orderRow),
          follows: z.array(followRow),
          plans: z.array(planRow),
          ownerHistory: z.array(z.record(z.string(), z.unknown())),
          titles: z.array(businessTitleRow),
        })
        .passthrough(),
    ),
  },
  Crm_createCustomer: {
    method: "post" as const,
    path: "/enterprise/crm/customers",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        name: z.string().min(1).max(120),
        ownerId: z.string().default(""),
        industry: z.string().max(60).default(""),
        province: z.string().max(40).default(""),
        city: z.string().max(40).default(""),
        remark: z.string().max(2000).default(""),
        custom: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
    response: envelope(customerRow),
  },
  Crm_updateCustomer: {
    method: "patch" as const,
    path: "/enterprise/crm/customers/:id",
    params: idParam,
    query: emptyQuery,
    body: z.record(z.string(), z.unknown()),
    response: envelope(customerRow),
  },
  Crm_removeCustomer: {
    method: "delete" as const,
    path: "/enterprise/crm/customers/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_transferCustomer: {
    method: "post" as const,
    path: "/enterprise/crm/customers/:id/transfer",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      ownerId: z.string().min(1),
      reason: z.string().max(200).default(""),
    }),
    response: envelope(customerRow),
  },
  Crm_customerMergePreview: {
    method: "get" as const,
    path: "/enterprise/crm/customers/merge-preview",
    params: z.object({}),
    query: z.object({
      primaryId: z.coerce.number(),
      secondaryId: z.coerce.number(),
    }),
    body: z.undefined(),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_mergeCustomers: {
    method: "post" as const,
    path: "/enterprise/crm/customers/merge",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      primaryId: z.number().int(),
      secondaryId: z.number().int(),
    }),
    response: envelope(customerRow),
  },
  Crm_customerToPool: {
    method: "post" as const,
    path: "/enterprise/crm/customers/:id/pool",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      poolId: z.number().int().min(1),
      reason: z.string().max(200).default(""),
    }),
    response: envelope(customerRow),
  },
  Crm_pickCustomer: {
    method: "post" as const,
    path: "/enterprise/crm/customers/:id/pick",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(customerRow),
  },
  Crm_assignCustomer: {
    method: "post" as const,
    path: "/enterprise/crm/customers/:id/assign",
    params: idParam,
    query: emptyQuery,
    body: z.object({ ownerId: z.string().min(1) }),
    response: envelope(customerRow),
  },
  Crm_freezeCustomer: {
    method: "post" as const,
    path: "/enterprise/crm/customers/:id/freeze",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      reason: z.string().max(200).default(""),
      unfreezeAt: z.string().optional(),
    }),
    response: envelope(customerRow),
  },
  Crm_unfreezeCustomer: {
    method: "post" as const,
    path: "/enterprise/crm/customers/:id/unfreeze",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(customerRow),
  },
  Crm_customerPools: {
    method: "get" as const,
    path: "/enterprise/crm/customer-pools",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(poolRow)),
  },
  Crm_saveCustomerPool: {
    method: "post" as const,
    path: "/enterprise/crm/customer-pools",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(60),
        description: z.string().max(200).default(""),
        adminId: z.string().default(""),
        auto: z.boolean().default(false),
        enabled: z.boolean().default(true),
        scopeIds: z.array(z.string()).default([]),
        pickRule: z.record(z.string(), z.unknown()).default({}),
        recycleRule: z.array(z.record(z.string(), z.unknown())).default([]),
      })
      .passthrough(),
    response: envelope(poolRow),
  },
  Crm_removeCustomerPool: {
    method: "delete" as const,
    path: "/enterprise/crm/customer-pools/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_contacts: {
    method: "get" as const,
    path: "/enterprise/crm/contacts",
    params: z.object({}),
    query: z.object({ customerId: z.coerce.number() }),
    body: z.undefined(),
    response: envelope(z.array(contactRow)),
  },
  Crm_saveContact: {
    method: "post" as const,
    path: "/enterprise/crm/contacts",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        customerId: z.number().int(),
        name: z.string().min(1).max(60),
        phone: z.string().max(40).default(""),
        email: z.string().max(120).default(""),
        title: z.string().max(60).default(""),
        ownerId: z.string().default(""),
        custom: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
    response: envelope(contactRow),
  },
  Crm_toggleContact: {
    method: "post" as const,
    path: "/enterprise/crm/contacts/:id/toggle",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      enabled: z.boolean(),
      reason: z.string().max(200).default(""),
    }),
    response: envelope(contactRow),
  },
  Crm_removeContact: {
    method: "delete" as const,
    path: "/enterprise/crm/contacts/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_collaborations: {
    method: "get" as const,
    path: "/enterprise/crm/collaborations",
    params: z.object({}),
    query: z.object({ customerId: z.coerce.number() }),
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Crm_saveCollaboration: {
    method: "post" as const,
    path: "/enterprise/crm/collaborations",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      customerId: z.number().int(),
      userId: z.string().min(1),
      type: z.enum(["READ_ONLY", "COLLABORATION"]).default("COLLABORATION"),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_removeCollaboration: {
    method: "delete" as const,
    path: "/enterprise/crm/collaborations/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_customerRelations: {
    method: "get" as const,
    path: "/enterprise/crm/customer-relations",
    params: z.object({}),
    query: z.object({ customerId: z.coerce.number() }),
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Crm_saveCustomerRelation: {
    method: "post" as const,
    path: "/enterprise/crm/customer-relations",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      sourceCustomerId: z.number().int(),
      targetCustomerId: z.number().int(),
      type: z.enum(["GROUP", "SUBSIDIARY"]),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_removeCustomerRelation: {
    method: "delete" as const,
    path: "/enterprise/crm/customer-relations/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 跟进 ----------
  Crm_followRecords: {
    method: "get" as const,
    path: "/enterprise/crm/follows",
    params: z.object({}),
    query: z.object({ targetType: z.string(), targetId: z.coerce.number() }),
    body: z.undefined(),
    response: envelope(z.array(followRow)),
  },
  Crm_saveFollowRecord: {
    method: "post" as const,
    path: "/enterprise/crm/follows",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        targetType: z.enum(["LEAD", "CUSTOMER", "OPPORTUNITY"]),
        targetId: z.number().int(),
        type: z.string().max(32).default(""),
        content: z.string().min(1).max(4000),
        result: z.string().max(200).default(""),
        nextAt: z.string().optional(),
      })
      .passthrough(),
    response: envelope(followRow),
  },
  Crm_followPlans: {
    method: "get" as const,
    path: "/enterprise/crm/follow-plans",
    params: z.object({}),
    query: z.object({
      targetType: z.string().optional(),
      targetId: z.coerce.number().optional(),
      status: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(planRow)),
  },
  Crm_saveFollowPlan: {
    method: "post" as const,
    path: "/enterprise/crm/follow-plans",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        targetType: z.enum(["LEAD", "CUSTOMER", "OPPORTUNITY"]),
        targetId: z.number().int(),
        planAt: z.string().min(1),
        ownerId: z.string().default(""),
        content: z.string().max(2000).default(""),
        reminderAt: z.string().optional(),
      })
      .passthrough(),
    response: envelope(planRow),
  },
  Crm_updateFollowPlan: {
    method: "patch" as const,
    path: "/enterprise/crm/follow-plans/:id",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      status: z.enum(["NOT_STARTED", "IN_PROGRESS", "DONE", "CANCELLED"]),
    }),
    response: envelope(planRow),
  },
  Crm_followComments: {
    method: "get" as const,
    path: "/enterprise/crm/follow-comments",
    params: z.object({}),
    query: z.object({ targetType: z.string(), targetId: z.coerce.number() }),
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Crm_saveFollowComment: {
    method: "post" as const,
    path: "/enterprise/crm/follow-comments",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      targetType: z.string(),
      targetId: z.number().int(),
      content: z.string().min(1).max(2000),
      mentions: z.array(z.string()).default([]),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },

  // ---------- 商机 / 报价 ----------
  Crm_opportunities: {
    method: "get" as const,
    path: "/enterprise/crm/opportunities",
    params: z.object({}),
    query: pageQuerySchema.extend({
      view: z.enum(["all", "mine"]).default("all"),
      stageId: z.coerce.number().optional(),
      customerId: z.coerce.number().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(opportunityRow)),
  },
  Crm_opportunity: {
    method: "get" as const,
    path: "/enterprise/crm/opportunities/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          opportunity: opportunityRow,
          items: z.array(z.record(z.string(), z.unknown())),
          quotations: z.array(quotationRow),
          follows: z.array(followRow),
          plans: z.array(planRow),
          contracts: z.array(contractRow),
        })
        .passthrough(),
    ),
  },
  Crm_createOpportunity: {
    method: "post" as const,
    path: "/enterprise/crm/opportunities",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        customerId: z.number().int(),
        name: z.string().min(1).max(120),
        amount: money.default("0"),
        stageId: z.number().int().default(0),
        contactId: z.number().int().default(0),
        ownerId: z.string().default(""),
        expectedEndAt: z.string().optional(),
        products: z.array(z.string()).default([]),
        items: z
          .array(
            z.object({
              productId: z.number().int().default(0),
              nameSnapshot: z.string().default(""),
              qty: money.default("1"),
              price: money.default("0"),
            }),
          )
          .default([]),
        custom: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
    response: envelope(opportunityRow),
  },
  Crm_updateOpportunity: {
    method: "patch" as const,
    path: "/enterprise/crm/opportunities/:id",
    params: idParam,
    query: emptyQuery,
    body: z.record(z.string(), z.unknown()),
    response: envelope(opportunityRow),
  },
  Crm_updateOpportunityStage: {
    method: "post" as const,
    path: "/enterprise/crm/opportunities/:id/stage",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      stageId: z.number().int(),
      failureReason: z.string().max(200).default(""),
      actualEndAt: z.string().optional(),
    }),
    response: envelope(opportunityRow),
  },
  Crm_removeOpportunity: {
    method: "delete" as const,
    path: "/enterprise/crm/opportunities/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_opportunityStages: {
    method: "get" as const,
    path: "/enterprise/crm/opportunity-stages",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(stageRow)),
  },
  Crm_saveOpportunityStage: {
    method: "post" as const,
    path: "/enterprise/crm/opportunity-stages",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      name: z.string().min(1).max(60),
      type: z.enum(["AFOOT", "END"]).default("AFOOT"),
      sort: z.number().int().default(0),
      winRate: z.number().int().min(0).max(100).default(0),
    }),
    response: envelope(stageRow),
  },
  Crm_removeOpportunityStage: {
    method: "delete" as const,
    path: "/enterprise/crm/opportunity-stages/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_opportunityRules: {
    method: "get" as const,
    path: "/enterprise/crm/opportunity-rules",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Crm_saveOpportunityRule: {
    method: "post" as const,
    path: "/enterprise/crm/opportunity-rules",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(60),
        scopeIds: z.array(z.string()).default([]),
        auto: z.boolean().default(false),
        conditions: z.array(z.record(z.string(), z.unknown())).default([]),
      })
      .passthrough(),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_quotations: {
    method: "get" as const,
    path: "/enterprise/crm/quotations",
    params: z.object({}),
    query: pageQuerySchema.extend({
      opportunityId: z.coerce.number().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(quotationRow)),
  },
  Crm_saveQuotation: {
    method: "post" as const,
    path: "/enterprise/crm/quotations",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        opportunityId: z.number().int(),
        name: z.string().max(120).default(""),
        untilAt: z.string().optional(),
        items: z
          .array(
            z.object({
              productId: z.number().int().default(0),
              nameSnapshot: z.string().default(""),
              qty: money.default("1"),
              price: money.default("0"),
            }),
          )
          .default([]),
      })
      .passthrough(),
    response: envelope(quotationRow),
  },
  Crm_voidQuotation: {
    method: "post" as const,
    path: "/enterprise/crm/quotations/:id/void",
    params: idParam,
    query: emptyQuery,
    body: z.object({ reason: z.string().max(200).default("") }),
    response: envelope(quotationRow),
  },
  Crm_removeQuotation: {
    method: "delete" as const,
    path: "/enterprise/crm/quotations/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 合同 / 回款 / 发票 / 抬头 ----------
  Crm_contracts: {
    method: "get" as const,
    path: "/enterprise/crm/contracts",
    params: z.object({}),
    query: pageQuerySchema.extend({
      view: z.enum(["all", "mine"]).default("all"),
      stageId: z.coerce.number().optional(),
      customerId: z.coerce.number().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(contractRow)),
  },
  Crm_contract: {
    method: "get" as const,
    path: "/enterprise/crm/contracts/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          contract: contractRow,
          items: z.array(z.record(z.string(), z.unknown())),
          plans: z.array(paymentPlanRow),
          records: z.array(paymentRecordRow),
          invoices: z.array(invoiceRow),
          titles: z.array(businessTitleRow),
          orders: z.array(orderRow),
          snapshot: z.record(z.string(), z.unknown()),
          approvals: z.array(approvalRow),
        })
        .passthrough(),
    ),
  },
  Crm_createContract: {
    method: "post" as const,
    path: "/enterprise/crm/contracts",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        customerId: z.number().int(),
        opportunityId: z.number().int().default(0),
        quotationId: z.number().int().default(0),
        name: z.string().min(1).max(160),
        amount: money.default("0"),
        stageId: z.number().int().default(0),
        ownerId: z.string().default(""),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
        remark: z.string().max(2000).default(""),
        items: z
          .array(
            z.object({
              productId: z.number().int().default(0),
              nameSnapshot: z.string().default(""),
              qty: money.default("1"),
              price: money.default("0"),
            }),
          )
          .default([]),
      })
      .passthrough(),
    response: envelope(contractRow),
  },
  Crm_updateContract: {
    method: "patch" as const,
    path: "/enterprise/crm/contracts/:id",
    params: idParam,
    query: emptyQuery,
    body: z.record(z.string(), z.unknown()),
    response: envelope(contractRow),
  },
  Crm_updateContractStage: {
    method: "post" as const,
    path: "/enterprise/crm/contracts/:id/stage",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      stageId: z.number().int(),
      reason: z.string().max(200).default(""),
    }),
    response: envelope(contractRow),
  },
  Crm_voidContract: {
    method: "post" as const,
    path: "/enterprise/crm/contracts/:id/void",
    params: idParam,
    query: emptyQuery,
    body: z.object({ reason: z.string().min(1).max(200) }),
    response: envelope(contractRow),
  },
  Crm_removeContract: {
    method: "delete" as const,
    path: "/enterprise/crm/contracts/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_contractStages: {
    method: "get" as const,
    path: "/enterprise/crm/contract-stages",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(stageRow)),
  },
  Crm_saveContractStage: {
    method: "post" as const,
    path: "/enterprise/crm/contract-stages",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      name: z.string().min(1).max(60),
      sort: z.number().int().default(0),
    }),
    response: envelope(stageRow),
  },
  Crm_removeContractStage: {
    method: "delete" as const,
    path: "/enterprise/crm/contract-stages/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_paymentPlans: {
    method: "get" as const,
    path: "/enterprise/crm/payment-plans",
    params: z.object({}),
    query: pageQuerySchema.extend({
      view: z.enum(["all", "overdue", "mine"]).default("all"),
      contractId: z.coerce.number().optional(),
      customerId: z.coerce.number().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(paymentPlanRow)),
  },
  Crm_savePaymentPlan: {
    method: "post" as const,
    path: "/enterprise/crm/payment-plans",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      contractId: z.number().int(),
      name: z.string().min(1).max(120),
      planAmount: money,
      planEndAt: z.string().optional(),
    }),
    response: envelope(paymentPlanRow),
  },
  Crm_removePaymentPlan: {
    method: "delete" as const,
    path: "/enterprise/crm/payment-plans/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_paymentRecords: {
    method: "get" as const,
    path: "/enterprise/crm/payment-records",
    params: z.object({}),
    query: pageQuerySchema.extend({
      contractId: z.coerce.number().optional(),
      customerId: z.coerce.number().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(paymentRecordRow)),
  },
  Crm_savePaymentRecord: {
    method: "post" as const,
    path: "/enterprise/crm/payment-records",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      contractId: z.number().int(),
      paymentPlanId: z.number().int().default(0),
      name: z.string().max(120).default(""),
      no: z.string().max(48).default(""),
      recordAmount: money,
      recordEndAt: z.string().optional(),
      attachmentKey: z.string().max(255).default(""),
    }),
    response: envelope(paymentRecordRow),
  },
  Crm_removePaymentRecord: {
    method: "delete" as const,
    path: "/enterprise/crm/payment-records/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean(), contractPaid: money })),
  },
  Crm_invoices: {
    method: "get" as const,
    path: "/enterprise/crm/invoices",
    params: z.object({}),
    query: pageQuerySchema.extend({
      contractId: z.coerce.number().optional(),
      customerId: z.coerce.number().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(invoiceRow)),
  },
  Crm_saveInvoice: {
    method: "post" as const,
    path: "/enterprise/crm/invoices",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        contractId: z.number().int().default(0),
        businessTitleId: z.number().int().default(0),
        name: z.string().max(160).default(""),
        amount: money.default("0"),
        invoiceType: z.enum(["SPECIAL", "NORMAL"]).default("SPECIAL"),
        taxRate: money.default("0"),
        attachmentKey: z.string().max(255).default(""),
        remark: z.string().max(500).default(""),
      })
      .passthrough(),
    response: envelope(invoiceRow),
  },
  Crm_removeInvoice: {
    method: "delete" as const,
    path: "/enterprise/crm/invoices/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_businessTitles: {
    method: "get" as const,
    path: "/enterprise/crm/business-titles",
    params: z.object({}),
    query: z.object({
      customerId: z.coerce.number().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(businessTitleRow)),
  },
  Crm_saveBusinessTitle: {
    method: "post" as const,
    path: "/enterprise/crm/business-titles",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        customerId: z.number().int().default(0),
        name: z.string().min(1).max(160),
        taxNo: z.string().max(40).default(""),
        bank: z.string().max(120).default(""),
        account: z.string().max(60).default(""),
        address: z.string().max(200).default(""),
        phone: z.string().max(40).default(""),
        capital: z.string().max(60).default(""),
        scale: z.string().max(60).default(""),
        province: z.string().max(40).default(""),
        city: z.string().max(40).default(""),
        industry: z.string().max(60).default(""),
        isDefault: z.boolean().default(false),
        remark: z.string().max(500).default(""),
      })
      .passthrough(),
    response: envelope(businessTitleRow),
  },
  Crm_removeBusinessTitle: {
    method: "delete" as const,
    path: "/enterprise/crm/business-titles/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 订单 ----------
  Crm_orders: {
    method: "get" as const,
    path: "/enterprise/crm/orders",
    params: z.object({}),
    query: pageQuerySchema.extend({
      stageId: z.coerce.number().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(orderRow)),
  },
  Crm_order: {
    method: "get" as const,
    path: "/enterprise/crm/orders/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          order: orderRow,
          items: z.array(z.record(z.string(), z.unknown())),
          snapshot: z.record(z.string(), z.unknown()),
          approvals: z.array(approvalRow),
        })
        .passthrough(),
    ),
  },
  Crm_createOrder: {
    method: "post" as const,
    path: "/enterprise/crm/orders",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        name: z.string().min(1).max(160),
        customerId: z.number().int().default(0),
        contractId: z.number().int().default(0),
        amount: money.default("0"),
        stageId: z.number().int().default(0),
        ownerId: z.string().default(""),
        remark: z.string().max(2000).default(""),
        items: z
          .array(
            z.object({
              productId: z.number().int().default(0),
              nameSnapshot: z.string().default(""),
              qty: money.default("1"),
              price: money.default("0"),
            }),
          )
          .default([]),
        custom: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough(),
    response: envelope(orderRow),
  },
  Crm_updateOrder: {
    method: "patch" as const,
    path: "/enterprise/crm/orders/:id",
    params: idParam,
    query: emptyQuery,
    body: z.record(z.string(), z.unknown()),
    response: envelope(orderRow),
  },
  Crm_updateOrderStage: {
    method: "post" as const,
    path: "/enterprise/crm/orders/:id/stage",
    params: idParam,
    query: emptyQuery,
    body: z.object({ stageId: z.number().int() }),
    response: envelope(orderRow),
  },
  Crm_removeOrder: {
    method: "delete" as const,
    path: "/enterprise/crm/orders/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_orderStages: {
    method: "get" as const,
    path: "/enterprise/crm/order-stages",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(stageRow)),
  },
  Crm_saveOrderStage: {
    method: "post" as const,
    path: "/enterprise/crm/order-stages",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      name: z.string().min(1).max(60),
      sort: z.number().int().default(0),
    }),
    response: envelope(stageRow),
  },
  Crm_removeOrderStage: {
    method: "delete" as const,
    path: "/enterprise/crm/order-stages/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 产品 / 价格 ----------
  Crm_products: {
    method: "get" as const,
    path: "/enterprise/crm/products",
    params: z.object({}),
    query: pageQuerySchema.extend({ keyword: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(productRow)),
  },
  Crm_saveProduct: {
    method: "post" as const,
    path: "/enterprise/crm/products",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      name: z.string().min(1).max(120),
      code: z.string().max(60).default(""),
      price: money.default("0"),
      status: z.boolean().default(true),
      sort: z.number().int().default(0),
      description: z.string().max(2000).default(""),
    }),
    response: envelope(productRow),
  },
  Crm_removeProduct: {
    method: "delete" as const,
    path: "/enterprise/crm/products/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_productPrices: {
    method: "get" as const,
    path: "/enterprise/crm/product-prices",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Crm_saveProductPrice: {
    method: "post" as const,
    path: "/enterprise/crm/product-prices",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(120),
        status: z.boolean().default(true),
        sort: z.number().int().default(0),
        items: z.array(z.record(z.string(), z.unknown())).default([]),
      })
      .passthrough(),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_removeProductPrice: {
    method: "delete" as const,
    path: "/enterprise/crm/product-prices/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 审批 ----------
  Crm_approvalFlows: {
    method: "get" as const,
    path: "/enterprise/crm/approval-flows",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(flowRow)),
  },
  Crm_approvalFlow: {
    method: "get" as const,
    path: "/enterprise/crm/approval-flows/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(flowRow),
  },
  Crm_saveApprovalFlow: {
    method: "post" as const,
    path: "/enterprise/crm/approval-flows",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        id: z.number().int().optional(),
        formType: z.enum(CRM_FORM_TYPES),
        name: z.string().min(1).max(80),
        enabled: z.boolean().default(true),
        nodes: z.array(z.record(z.string(), z.unknown())).default([]),
      })
      .passthrough(),
    response: envelope(flowRow),
  },
  Crm_removeApprovalFlow: {
    method: "delete" as const,
    path: "/enterprise/crm/approval-flows/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Crm_submitApproval: {
    method: "post" as const,
    path: "/enterprise/crm/approvals/submit",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      formType: z.enum(CRM_FORM_TYPES),
      targetId: z.number().int(),
    }),
    response: envelope(approvalRow),
  },
  Crm_approvalInstances: {
    method: "get" as const,
    path: "/enterprise/crm/approvals/instances",
    params: z.object({}),
    query: approvalTodoQuery.extend({
      view: z.enum(["mine", "submitted", "cc", "all"]).default("all"),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(approvalRow)),
  },
  Crm_approvalInstance: {
    method: "get" as const,
    path: "/enterprise/crm/approvals/instances/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          instance: approvalRow,
          tasks: z.array(taskRow),
          records: z.array(z.record(z.string(), z.unknown())),
          snapshot: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
    ),
  },
  Crm_approvalTodo: {
    method: "get" as const,
    path: "/enterprise/crm/approvals/todo",
    params: z.object({}),
    query: approvalTodoQuery,
    body: z.undefined(),
    response: envelope(pageSchema(taskRow)),
  },
  Crm_approvalDone: {
    method: "get" as const,
    path: "/enterprise/crm/approvals/done",
    params: z.object({}),
    query: approvalTodoQuery,
    body: z.undefined(),
    response: envelope(pageSchema(taskRow)),
  },
  Crm_approve: {
    method: "post" as const,
    path: "/enterprise/crm/approvals/:id/approve",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      taskId: z.number().int().default(0),
      comment: z.string().max(1000).default(""),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_reject: {
    method: "post" as const,
    path: "/enterprise/crm/approvals/:id/reject",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      taskId: z.number().int().default(0),
      comment: z.string().min(1).max(1000),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_addSign: {
    method: "post" as const,
    path: "/enterprise/crm/approvals/:id/add-sign",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      userId: z.string().min(1),
      position: z.enum(["BEFORE", "AFTER"]).default("AFTER"),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_returnBack: {
    method: "post" as const,
    path: "/enterprise/crm/approvals/:id/return",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      nodeIndex: z.number().int().default(0),
      comment: z.string().min(1).max(1000),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_revokeApproval: {
    method: "post" as const,
    path: "/enterprise/crm/approvals/:id/revoke",
    params: idParam,
    query: emptyQuery,
    body: z.object({ comment: z.string().max(1000).default("") }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_approvalComments: {
    method: "get" as const,
    path: "/enterprise/crm/approvals/:id/comments",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Crm_saveApprovalComment: {
    method: "post" as const,
    path: "/enterprise/crm/approvals/:id/comments",
    params: idParam,
    query: emptyQuery,
    body: z.object({ content: z.string().min(1).max(2000) }),
    response: envelope(z.record(z.string(), z.unknown())),
  },

  // ---------- 导入导出 / 多维表格 ----------
  Crm_exportTasks: {
    method: "get" as const,
    path: "/enterprise/crm/export-tasks",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.array(
        z
          .object({
            id: z.number(),
            module: z.string(),
            status: z.string(),
            fileName: z.string(),
            rowCount: z.number(),
            createdAt: z.string(),
            expiresAt: z.string(),
          })
          .passthrough(),
      ),
    ),
  },
  Crm_createExport: {
    method: "post" as const,
    path: "/enterprise/crm/export-tasks",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      module: z.enum([
        "leads",
        "customers",
        "opportunities",
        "contracts",
        "payment-plans",
        "orders",
      ]),
      filters: z.record(z.string(), z.unknown()).default({}),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Crm_importPrecheck: {
    method: "post" as const,
    path: "/enterprise/crm/imports/precheck",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      module: z.enum(["leads", "customers"]),
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
    }),
    response: envelope(
      z.object({
        total: z.number(),
        valid: z.number(),
        duplicates: z.number(),
        errors: z.array(z.object({ index: z.number(), message: z.string() })),
        rows: z.array(z.record(z.string(), z.unknown())),
      }),
    ),
  },
  Crm_importCommit: {
    method: "post" as const,
    path: "/enterprise/crm/imports",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      module: z.enum(["leads", "customers"]),
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
      skipDuplicates: z.boolean().default(true),
    }),
    response: envelope(z.object({ created: z.number(), skipped: z.number() })),
  },
  Crm_exportToDataTable: {
    method: "post" as const,
    path: "/enterprise/crm/data-table/export",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      module: z.enum([
        "leads",
        "customers",
        "opportunities",
        "contracts",
        "payment-plans",
        "orders",
      ]),
      dataTableId: z.number().int().default(0),
      tableName: z.string().max(60).default(""),
      filters: z.record(z.string(), z.unknown()).default({}),
    }),
    response: envelope(
      z.object({
        dataTableId: z.number(),
        rows: z.number(),
        created: z.boolean(),
      }),
    ),
  },

  // ---------- AI ----------
  Crm_aiDraftLead: {
    method: "post" as const,
    path: "/enterprise/crm/ai/draft-lead",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ text: z.string().min(1).max(8000) }),
    response: envelope(aiDraft),
  },
  Crm_aiSummarize: {
    method: "post" as const,
    path: "/enterprise/crm/ai/summarize",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      targetType: z.enum(["LEAD", "CUSTOMER", "OPPORTUNITY"]),
      targetId: z.number().int(),
    }),
    response: envelope(
      z.object({
        summary: z.string(),
        nextStep: z.string(),
        nextAt: z.string(),
      }),
    ),
  },
  Crm_aiRisk: {
    method: "post" as const,
    path: "/enterprise/crm/ai/risk",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ opportunityId: z.number().int() }),
    response: envelope(
      z.object({
        level: z.string(),
        reasons: z.array(z.string()),
        advice: z.string(),
      }),
    ),
  },
  Crm_analyzeOpportunity: {
    method: "post" as const,
    path: "/enterprise/crm/ai/analyze-opportunity",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ opportunityId: z.number().int() }),
    response: envelope(
      z.object({
        valueScore: z.number(),
        valueLevel: z.string(),
        winRate: z.number(),
        stageWinRate: z.number(),
        reasons: z.array(z.string()),
        advice: z.string(),
        nextStep: z.string(),
      }),
    ),
  },
  Crm_aiCollectionDraft: {
    method: "post" as const,
    path: "/enterprise/crm/ai/collection-draft",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      contractId: z.number().int(),
      channel: z.enum(["email", "wechat"]).default("email"),
    }),
    response: envelope(z.object({ subject: z.string(), content: z.string() })),
  },
  Crm_aiReport: {
    method: "post" as const,
    path: "/enterprise/crm/ai/report",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({ range: z.string().default("week") }),
    response: envelope(z.object({ title: z.string(), content: z.string() })),
  },
  Crm_aiDuplicateExplain: {
    method: "post" as const,
    path: "/enterprise/crm/ai/duplicate-explain",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      input: z.record(z.string(), z.unknown()),
      candidates: z
        .array(z.record(z.string(), z.unknown()))
        .max(20)
        .default([]),
    }),
    response: envelope(
      z.object({ explanation: z.string(), suggestion: z.string() }),
    ),
  },
};

export type CrmEndpoints = typeof crmEndpoints;
