import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** 组织切换：不传时按当前身份自动判定（自己在组织里 → 该组织，否则第一条 ACTIVE 关系）。 */
const orgQuery = z.object({
  orgType: z.enum(["ENTERPRISE", "PROVIDER"]).optional(),
  orgUserId: z.string().optional(),
});

export const OA_TEMPLATE_CATEGORIES = [
  "LEAVE",
  "EXPENSE",
  "PAYMENT",
  "PURCHASE",
  "SEAL",
  "GENERAL",
  "CUSTOM",
] as const;
export const OA_TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  LEAVE: "请假",
  EXPENSE: "报销",
  PAYMENT: "付款申请",
  PURCHASE: "采购申请",
  SEAL: "用章申请",
  GENERAL: "通用申请",
  CUSTOM: "自定义",
};

export const OA_APPLICATION_STATUSES = [
  "DRAFT",
  "APPROVING",
  "RETURNED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export const OA_APPLICATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  APPROVING: "审批中",
  RETURNED: "已退回",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  WITHDRAWN: "已撤销",
};

export const OA_TASK_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SKIPPED",
  "TRANSFERRED",
] as const;
export const OA_TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: "待处理",
  APPROVED: "已同意",
  REJECTED: "已驳回",
  SKIPPED: "已跳过",
  TRANSFERRED: "已转交",
};

export const OA_APPROVAL_MODES = ["ANY", "ALL", "SEQUENTIAL"] as const;
export const OA_APPROVAL_MODE_LABELS: Record<string, string> = {
  ANY: "或签",
  ALL: "会签",
  SEQUENTIAL: "依次审批",
};

export const OA_APPROVER_TYPES = [
  "MEMBER",
  "DEPT_HEAD",
  "DEPT_POSITION",
  "ROLE",
  "SUBMITTER",
  "OWNER",
] as const;
export const OA_APPROVER_TYPE_LABELS: Record<string, string> = {
  MEMBER: "指定成员",
  DEPT_HEAD: "部门负责人",
  DEPT_POSITION: "按部门与岗位",
  ROLE: "业务板块成员",
  SUBMITTER: "发起人自审",
  OWNER: "组织主账号",
};

export const OA_RECORD_ACTIONS = [
  "SUBMIT",
  "APPROVE",
  "REJECT",
  "RETURN",
  "TRANSFER",
  "ADD_SIGN",
  "WITHDRAW",
  "COMMENT",
  "SYSTEM",
] as const;
export const OA_RECORD_ACTION_LABELS: Record<string, string> = {
  SUBMIT: "提交",
  APPROVE: "同意",
  REJECT: "驳回",
  RETURN: "退回",
  TRANSFER: "转交",
  ADD_SIGN: "加签",
  WITHDRAW: "撤销",
  COMMENT: "评论",
  SYSTEM: "系统",
};

export const OA_LINKAGE_ACTIONS = ["LOG", "SET_FIELD", "SUBMIT_FLOW"] as const;
export const OA_LINKAGE_ACTION_LABELS: Record<string, string> = {
  LOG: "写审批回执",
  SET_FIELD: "改写目标字段",
  SUBMIT_FLOW: "触发目标系统审批（一期不做）",
};
/** 一期真正可执行的动作；SUBMIT_FLOW 仅占位。 */
export const OA_LINKAGE_ACTIONS_SUPPORTED = ["LOG", "SET_FIELD"] as const;

export const OA_LINK_TARGETS = [
  "CRM_CUSTOMER",
  "CRM_OPPORTUNITY",
  "CRM_CONTRACT",
  "CRM_PAYMENT_PLAN",
  "CRM_ORDER",
  "CRM_INVOICE",
  "CONTRACT",
  "LOWCODE_ROW",
  "DATA_TABLE_ROW",
] as const;
export type OaLinkTargetType = (typeof OA_LINK_TARGETS)[number];
export const OA_LINK_TARGET_LABELS: Record<string, string> = {
  CRM_CUSTOMER: "CRM 客户",
  CRM_OPPORTUNITY: "CRM 商机",
  CRM_CONTRACT: "CRM 合同",
  CRM_PAYMENT_PLAN: "CRM 回款计划",
  CRM_ORDER: "CRM 订单",
  CRM_INVOICE: "CRM 发票",
  CONTRACT: "签约管理合同",
  LOWCODE_ROW: "内建应用行",
  DATA_TABLE_ROW: "多维表格行",
};

export const OA_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "amount",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "radio",
  "checkbox",
  "user",
  "attachment",
  "ref",
  "list",
] as const;
export const OA_FIELD_TYPE_LABELS: Record<string, string> = {
  text: "单行文本",
  textarea: "多行文本",
  number: "数字",
  amount: "金额",
  date: "日期",
  datetime: "日期时间",
  select: "下拉单选",
  multiSelect: "下拉多选",
  radio: "单选按钮",
  checkbox: "勾选",
  user: "组织成员",
  attachment: "附件",
  ref: "业务对象",
  list: "明细子表",
};

export const OA_CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
] as const;
export const OA_CONDITION_OP_LABELS: Record<string, string> = {
  eq: "等于",
  neq: "不等于",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
  contains: "包含",
};

export const OA_EMPTY_ACTIONS = ["SKIP", "ERROR"] as const;
export const OA_EMPTY_ACTION_LABELS: Record<string, string> = {
  SKIP: "无人可派时跳过",
  ERROR: "提交时拦下并提示补人",
};

export const oaFieldOptionSchema = z.object({
  label: z.string().max(60).default(""),
  value: z.string().max(60).default(""),
});
export type OaFieldOption = z.infer<typeof oaFieldOptionSchema>;

export const oaListColumnSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  type: z.enum(["text", "number", "amount", "date", "select"]).default("text"),
  required: z.boolean().default(false),
  options: z.array(oaFieldOptionSchema).default([]),
});
export type OaListColumn = z.infer<typeof oaListColumnSchema>;

export const oaConditionSchema = z.object({
  field: z.string().max(40).default("amount"),
  op: z.enum(OA_CONDITION_OPS).default("gte"),
  value: z.union([z.string(), z.number()]).default(""),
});
export type OaCondition = z.infer<typeof oaConditionSchema>;

export const oaFieldSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  type: z.enum(OA_FIELD_TYPES),
  required: z.boolean().default(false),
  placeholder: z.string().max(120).default(""),
  help: z.string().max(200).default(""),
  default: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
    .optional(),
  options: z.array(oaFieldOptionSchema).default([]),
  visibleWhen: oaConditionSchema.nullable().default(null),
  /** type=ref 时限定目标对象；空＝任意 */
  refTarget: z.string().default(""),
  /** type=list 时的明细列 */
  columns: z.array(oaListColumnSchema).default([]),
});
export type OaField = z.infer<typeof oaFieldSchema>;

/** AI 预审：节点级开关 + 数字分身快照 + 审核原则；只给建议，不替审批人动作。 */
export const oaAiPreReviewSchema = z.object({
  enabled: z.boolean().default(false),
  personaId: z.number().int().min(0).default(0),
  principles: z.string().max(2000).default(""),
  /** 保存模板时从配置人的数字分身抄一份快照，运行时不跨账号读别人的分身。 */
  personaName: z.string().max(30).default(""),
  personaStyle: z.string().max(32).default(""),
  personaText: z.string().max(500).default(""),
});
export type OaAiPreReview = z.infer<typeof oaAiPreReviewSchema>;

export const OA_PRE_REVIEW_STATUSES = [
  "NONE",
  "RUNNING",
  "DONE",
  "FAILED",
] as const;
export const oaPreReviewResultSchema = z.object({
  status: z.enum(OA_PRE_REVIEW_STATUSES).default("NONE"),
  content: z.string().default(""),
  personaName: z.string().default(""),
  model: z.string().default(""),
  generatedAt: z.string().default(""),
  error: z.string().default(""),
});
export type OaPreReviewResult = z.infer<typeof oaPreReviewResultSchema>;
const emptyPreReview = {
  status: "NONE" as const,
  content: "",
  personaName: "",
  model: "",
  generatedAt: "",
  error: "",
};

export const oaFlowNodeSchema = z.object({
  name: z.string().max(60).default("审批"),
  approverType: z.enum(OA_APPROVER_TYPES).default("MEMBER"),
  userIds: z.array(z.string()).default([]),
  roles: z.array(z.string()).default([]),
  /** 按部门与岗位派单：department 为部门名，positions 为岗位名（取自本组织职能目录）。 */
  department: z.string().max(64).default(""),
  positions: z.array(z.string().max(64)).default([]),
  aiPreReview: oaAiPreReviewSchema.default({
    enabled: false,
    personaId: 0,
    principles: "",
    personaName: "",
    personaStyle: "",
    personaText: "",
  }),
  mode: z.enum(OA_APPROVAL_MODES).default("ANY"),
  condition: oaConditionSchema.nullable().default(null),
  emptyAction: z.enum(OA_EMPTY_ACTIONS).default("SKIP"),
  ccUserIds: z.array(z.string()).default([]),
  remindAfterHours: z.number().int().min(0).max(720).default(24),
});
export type OaFlowNode = z.infer<typeof oaFlowNodeSchema>;

export const oaLinkageRuleSchema = z.object({
  on: z.enum(["APPROVED", "REJECTED"]).default("APPROVED"),
  /** LINKED＝单据上挂的关联对象；也可指定具体 targetType */
  target: z.string().default("LINKED"),
  action: z.enum(OA_LINKAGE_ACTIONS).default("LOG"),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type OaLinkageRule = z.infer<typeof oaLinkageRuleSchema>;

export const oaAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  /** 数字资产直链：由服务端从发起人台账取出后落库，审批人/抄送人回看用同一个值。 */
  url: z.string().default(""),
});
export type OaAttachment = z.infer<typeof oaAttachmentSchema>;

export const oaTemplateSummarySchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  description: z.string(),
  icon: z.string(),
  numberPrefix: z.string(),
  version: z.number(),
  builtin: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number(),
  nodeCount: z.number(),
  linkageCount: z.number(),
  openCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OaTemplateSummary = z.infer<typeof oaTemplateSummarySchema>;

export const oaTemplateSchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  description: z.string(),
  icon: z.string(),
  numberPrefix: z.string(),
  fields: z.array(oaFieldSchema),
  flow: z.array(oaFlowNodeSchema),
  linkage: z.array(oaLinkageRuleSchema),
  version: z.number(),
  builtin: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OaTemplate = z.infer<typeof oaTemplateSchema>;

export const oaApproverSchema = z.object({
  userId: z.string(),
  name: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  actedAt: z.string(),
  comment: z.string(),
});
export type OaApprover = z.infer<typeof oaApproverSchema>;

export const oaFlowStepSchema = z.object({
  index: z.number(),
  name: z.string(),
  mode: z.string(),
  modeLabel: z.string(),
  status: z.enum(["PENDING", "ACTIVE", "DONE", "SKIPPED"]),
  statusLabel: z.string(),
  approvers: z.array(oaApproverSchema),
  ccNames: z.array(z.string()),
  /** 该节点是否启用了 AI 预审，以及配置的分身名称（审批人打开详情时自动预审）。 */
  aiPreReviewEnabled: z.boolean().default(false),
  aiPreReviewPersona: z.string().default(""),
});
export type OaFlowStep = z.infer<typeof oaFlowStepSchema>;

export const oaRecordSchema = z.object({
  id: z.number(),
  nodeIndex: z.number(),
  action: z.string(),
  actionLabel: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  comment: z.string(),
  attachments: z.array(oaAttachmentSchema),
  createdAt: z.string(),
});
export type OaRecord = z.infer<typeof oaRecordSchema>;

export const oaLinkSchema = z.object({
  id: z.number(),
  targetType: z.string(),
  targetLabel: z.string(),
  targetId: z.string(),
  targetTitle: z.string(),
  action: z.string(),
  actionLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  error: z.string(),
  executedAt: z.string(),
});
export type OaLink = z.infer<typeof oaLinkSchema>;

/** 关联业务对象的搜索结果，也用作单据详情上的关联卡片。 */
export const oaLinkSearchItemSchema = z.object({
  targetType: z.string(),
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  amount: z.number(),
});
export type OaLinkSearchItem = z.infer<typeof oaLinkSearchItemSchema>;

export const oaCcSchema = z.object({
  id: z.number(),
  applicationId: z.number(),
  userId: z.string(),
  userName: z.string(),
  number: z.string(),
  title: z.string(),
  applicantName: z.string(),
  department: z.string(),
  amount: z.number(),
  status: z.string(),
  statusLabel: z.string(),
  readAt: z.string(),
  createdAt: z.string(),
});
export type OaCc = z.infer<typeof oaCcSchema>;

export const oaApplicationSummarySchema = z.object({
  id: z.number(),
  number: z.string(),
  templateId: z.number(),
  templateKey: z.string(),
  templateName: z.string(),
  title: z.string(),
  applicantId: z.string(),
  applicantName: z.string(),
  department: z.string(),
  amount: z.number(),
  status: z.string(),
  statusLabel: z.string(),
  currentNode: z.number(),
  /** 在途节点的名称（取单据冻结的流程快照）；非在途为空。 */
  currentNodeName: z.string(),
  currentApprovers: z.array(z.object({ userId: z.string(), name: z.string() })),
  submittedAt: z.string(),
  finishedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OaApplicationSummary = z.infer<typeof oaApplicationSummarySchema>;

export const oaApplicationSchema = oaApplicationSummarySchema.extend({
  formData: z.record(z.string(), z.unknown()),
  fields: z.array(oaFieldSchema),
  cc: z.array(oaCcSchema),
  /** 发起时上传的附件（数字资产 id / 名称 / 大小）。 */
  attachments: z.array(oaAttachmentSchema).default([]),
  flow: z.array(oaFlowStepSchema),
  records: z.array(oaRecordSchema),
  links: z.array(oaLinkSchema),
  /** 单据级关联的业务对象（提交时冻结的可见快照）。 */
  targets: z.array(oaLinkSearchItemSchema),
  /** 当前登录人待处理的 OA 任务 id；0＝没有 */
  myTaskId: z.number(),
  /** 当前登录人这一环的 AI 预审结果（没有任务或节点未启用时 status=NONE）。 */
  myPreReview: oaPreReviewResultSchema.default(emptyPreReview),
  canApprove: z.boolean(),
  canWithdraw: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});
export type OaApplication = z.infer<typeof oaApplicationSchema>;

export const oaTaskSchema = z.object({
  id: z.number(),
  applicationId: z.number(),
  number: z.string(),
  title: z.string(),
  templateName: z.string(),
  applicantName: z.string(),
  department: z.string(),
  amount: z.number(),
  nodeIndex: z.number(),
  nodeName: z.string(),
  mode: z.string(),
  modeLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  submittedAt: z.string(),
  createdAt: z.string(),
  remindedAt: z.string(),
});
export type OaTask = z.infer<typeof oaTaskSchema>;

export const oaLinkTargetSchema = z.object({
  key: z.string(),
  label: z.string(),
  module: z.string(),
  detailPath: z.string(),
  searchEnabled: z.boolean(),
});
export type OaLinkTarget = z.infer<typeof oaLinkTargetSchema>;

export const oaOrgSchema = z.object({
  orgType: z.string(),
  orgUserId: z.string(),
  name: z.string(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "AGENT"]),
  roleLabel: z.string(),
});
export type OaOrg = z.infer<typeof oaOrgSchema>;

export const oaWorkspaceSchema = z.object({
  orgs: z.array(oaOrgSchema),
  current: oaOrgSchema,
  isAdmin: z.boolean(),
  canApproveCount: z.number(),
  unreadCcCount: z.number(),
});
export type OaWorkspace = z.infer<typeof oaWorkspaceSchema>;

export const oaOverviewSchema = z.object({
  todoCount: z.number(),
  myApprovingCount: z.number(),
  monthDoneCount: z.number(),
  avgHandleHours: z.number(),
  overdueCount: z.number(),
  unreadCcCount: z.number(),
  otherPendingCount: z.number(),
});
export type OaOverview = z.infer<typeof oaOverviewSchema>;

export const oaInboxItemSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  link: z.string(),
  amount: z.number(),
});
export type OaInboxItem = z.infer<typeof oaInboxItemSchema>;
export const oaInboxGroupSchema = z.object({
  source: z.enum(["OA", "CRM", "LOWCODE", "OTHER"]),
  sourceLabel: z.string(),
  count: z.number(),
  link: z.string(),
  items: z.array(oaInboxItemSchema),
});
export type OaInboxGroup = z.infer<typeof oaInboxGroupSchema>;
export const oaInboxSchema = z.object({
  total: z.number(),
  groups: z.array(oaInboxGroupSchema),
});
export type OaInbox = z.infer<typeof oaInboxSchema>;

export const oaSettingsSchema = z.object({
  adminUserIds: z.array(z.string()),
  deptHeads: z.record(z.string(), z.string()),
  remindAfterHours: z.number(),
  allowWithdraw: z.boolean(),
  members: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      memberKind: z.string(),
      memberKindLabel: z.string(),
      department: z.string(),
      positions: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().default(""),
          }),
        )
        .default([]),
      roles: z.array(z.string()),
      roleLabels: z.array(z.string()),
    }),
  ),
  /** 本组织职能目录，供流程编辑器按部门与岗位选签批人。 */
  departments: z
    .array(z.object({ name: z.string(), description: z.string().default("") }))
    .default([]),
  positions: z
    .array(z.object({ name: z.string(), description: z.string().default("") }))
    .default([]),
  /** 当前账号的数字分身，供节点 AI 预审选择；保存模板时快照进节点。 */
  personas: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        style: z.string().default(""),
        persona: z.string().default(""),
      }),
    )
    .default([]),
  isOwner: z.boolean(),
});
export type OaSettings = z.infer<typeof oaSettingsSchema>;

export const oaEndpoints = {
  // ---------- 工作区 ----------
  Oa_workspace: {
    method: "get" as const,
    path: "/enterprise/oa/workspace",
    params: z.object({}),
    query: orgQuery,
    body: z.undefined(),
    response: envelope(oaWorkspaceSchema),
  },
  Oa_overview: {
    method: "get" as const,
    path: "/enterprise/oa/overview",
    params: z.object({}),
    query: orgQuery,
    body: z.undefined(),
    response: envelope(oaOverviewSchema),
  },

  // ---------- 模板 ----------
  Oa_templates: {
    method: "get" as const,
    path: "/enterprise/oa/templates",
    params: z.object({}),
    query: orgQuery.extend({
      category: z.string().optional(),
      enabledOnly: z.coerce.boolean().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(oaTemplateSummarySchema)),
  },
  Oa_templateDetail: {
    method: "get" as const,
    path: "/enterprise/oa/templates/:id",
    params: z.object({ id: z.string() }),
    query: orgQuery,
    body: z.undefined(),
    response: envelope(oaTemplateSchema),
  },
  Oa_saveTemplate: {
    method: "post" as const,
    path: "/enterprise/oa/templates",
    params: z.object({}),
    query: emptyQuery,
    body: orgQuery.extend({
      id: z.number().int().default(0),
      key: z.string().min(1).max(40),
      name: z.string().min(1).max(40),
      category: z.enum(OA_TEMPLATE_CATEGORIES).default("GENERAL"),
      description: z.string().max(200).default(""),
      icon: z.string().max(40).default(""),
      numberPrefix: z.string().min(1).max(8).default("OA"),
      fields: z.array(oaFieldSchema).max(60).default([]),
      flow: z.array(oaFlowNodeSchema).max(10).default([]),
      linkage: z.array(oaLinkageRuleSchema).max(10).default([]),
      enabled: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
    }),
    response: envelope(oaTemplateSchema),
  },
  Oa_deleteTemplate: {
    method: "delete" as const,
    path: "/enterprise/oa/templates/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Oa_toggleTemplate: {
    method: "post" as const,
    path: "/enterprise/oa/templates/:id/toggle",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ enabled: z.boolean() }),
    response: envelope(oaTemplateSchema),
  },
  Oa_copyTemplate: {
    method: "post" as const,
    path: "/enterprise/oa/templates/:id/copy",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      key: z.string().min(1).max(40),
      name: z.string().min(1).max(40),
    }),
    response: envelope(oaTemplateSchema),
  },

  // ---------- 单据 ----------
  Oa_applications: {
    method: "get" as const,
    path: "/enterprise/oa/applications",
    params: z.object({}),
    query: orgQuery.merge(
      pageQuerySchema.extend({
        scope: z.enum(["MINE", "ALL", "CC"]).default("MINE"),
        status: z.string().default(""),
        templateId: z.coerce.number().int().default(0),
        department: z.string().default(""),
        keyword: z.string().default(""),
        from: z.string().default(""),
        to: z.string().default(""),
      }),
    ),
    body: z.undefined(),
    response: envelope(pageSchema(oaApplicationSummarySchema)),
  },
  Oa_applicationDetail: {
    method: "get" as const,
    path: "/enterprise/oa/applications/:id",
    params: z.object({ id: z.string() }),
    query: orgQuery,
    body: z.undefined(),
    response: envelope(oaApplicationSchema),
  },
  Oa_saveDraft: {
    method: "post" as const,
    path: "/enterprise/oa/applications/draft",
    params: z.object({}),
    query: emptyQuery,
    body: orgQuery.extend({
      id: z.number().int().default(0),
      templateId: z.number().int().positive(),
      title: z.string().max(200).default(""),
      formData: z.record(z.string(), z.unknown()).default({}),
      ccUserIds: z.array(z.string()).max(50).default([]),
      attachments: z.array(oaAttachmentSchema).max(20).default([]),
      linkTargets: z
        .array(
          z.object({
            targetType: z.enum(OA_LINK_TARGETS),
            targetId: z.string().min(1),
          }),
        )
        .max(20)
        .default([]),
    }),
    response: envelope(oaApplicationSchema),
  },
  Oa_submit: {
    method: "post" as const,
    path: "/enterprise/oa/applications/:id/submit",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({}),
    response: envelope(oaApplicationSchema),
  },
  Oa_withdraw: {
    method: "post" as const,
    path: "/enterprise/oa/applications/:id/withdraw",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ comment: z.string().max(500).default("") }),
    response: envelope(oaApplicationSchema),
  },
  Oa_deleteDraft: {
    method: "delete" as const,
    path: "/enterprise/oa/applications/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  /** 当前审批人对自己这一环节做 AI 预审（按节点配置的分身与原则，用本人文本模型）。 */
  Oa_preReview: {
    method: "post" as const,
    path: "/enterprise/oa/applications/:id/pre-review",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({}),
    response: envelope(oaPreReviewResultSchema),
  },
  Oa_export: {
    method: "get" as const,
    path: "/enterprise/oa/export",
    params: z.object({}),
    query: orgQuery.extend({
      status: z.string().default(""),
      templateId: z.coerce.number().int().default(0),
      department: z.string().default(""),
      keyword: z.string().default(""),
      from: z.string().default(""),
      to: z.string().default(""),
    }),
    body: z.undefined(),
    response: envelope(
      z.object({
        filename: z.string(),
        content: z.string(),
        rows: z.number(),
        truncated: z.boolean(),
      }),
    ),
  },

  // ---------- 审批 ----------
  Oa_tasks: {
    method: "get" as const,
    path: "/enterprise/oa/tasks",
    params: z.object({}),
    query: orgQuery.merge(
      pageQuerySchema.extend({
        keyword: z.string().default(""),
        templateId: z.coerce.number().int().default(0),
      }),
    ),
    body: z.undefined(),
    response: envelope(pageSchema(oaTaskSchema)),
  },
  Oa_done: {
    method: "get" as const,
    path: "/enterprise/oa/tasks/done",
    params: z.object({}),
    query: orgQuery.merge(
      pageQuerySchema.extend({
        keyword: z.string().default(""),
      }),
    ),
    body: z.undefined(),
    response: envelope(pageSchema(oaTaskSchema)),
  },
  Oa_approve: {
    method: "post" as const,
    path: "/enterprise/oa/tasks/:id/approve",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ comment: z.string().max(500).default("") }),
    response: envelope(oaApplicationSchema),
  },
  Oa_reject: {
    method: "post" as const,
    path: "/enterprise/oa/tasks/:id/reject",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ comment: z.string().min(1).max(500) }),
    response: envelope(oaApplicationSchema),
  },
  Oa_return: {
    method: "post" as const,
    path: "/enterprise/oa/tasks/:id/return",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ comment: z.string().min(1).max(500) }),
    response: envelope(oaApplicationSchema),
  },
  Oa_transfer: {
    method: "post" as const,
    path: "/enterprise/oa/tasks/:id/transfer",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      targetUserId: z.string().min(1),
      comment: z.string().max(500).default(""),
    }),
    response: envelope(oaApplicationSchema),
  },
  Oa_addSign: {
    method: "post" as const,
    path: "/enterprise/oa/tasks/:id/add-sign",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      userIds: z.array(z.string()).min(1).max(10),
      comment: z.string().max(500).default(""),
    }),
    response: envelope(oaApplicationSchema),
  },

  // ---------- 抄送 / 评论 ----------
  Oa_cc: {
    method: "get" as const,
    path: "/enterprise/oa/cc",
    params: z.object({}),
    query: orgQuery.merge(
      pageQuerySchema.extend({ keyword: z.string().default("") }),
    ),
    body: z.undefined(),
    response: envelope(pageSchema(oaCcSchema)),
  },
  Oa_readCc: {
    method: "post" as const,
    path: "/enterprise/oa/cc/:id/read",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({}),
    response: envelope(z.object({ read: z.boolean() })),
  },
  Oa_records: {
    method: "get" as const,
    path: "/enterprise/oa/applications/:id/records",
    params: z.object({ id: z.string() }),
    query: orgQuery,
    body: z.undefined(),
    response: envelope(z.array(oaRecordSchema)),
  },
  Oa_comment: {
    method: "post" as const,
    path: "/enterprise/oa/applications/:id/comment",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      comment: z.string().min(1).max(1000),
      attachments: z.array(oaAttachmentSchema).max(20).default([]),
    }),
    response: envelope(z.array(oaRecordSchema)),
  },

  // ---------- 联动 ----------
  Oa_linkTargets: {
    method: "get" as const,
    path: "/enterprise/oa/link-targets",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(oaLinkTargetSchema)),
  },
  Oa_linkSearch: {
    method: "get" as const,
    path: "/enterprise/oa/link-search",
    params: z.object({}),
    query: orgQuery.extend({
      targetType: z.enum(OA_LINK_TARGETS),
      keyword: z.string().default(""),
      // 业务侧「发起 OA 审批」深链：按 id 精确回查一条，可见性口径与搜索一致。
      targetId: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(oaLinkSearchItemSchema)),
  },
  Oa_retryLink: {
    method: "post" as const,
    path: "/enterprise/oa/applications/:id/links/:linkId/retry",
    params: z.object({ id: z.string(), linkId: z.string() }),
    query: emptyQuery,
    body: z.object({}),
    response: envelope(z.array(oaLinkSchema)),
  },

  // ---------- 聚合 ----------
  Oa_approvalInbox: {
    method: "get" as const,
    path: "/enterprise/oa/approval-inbox",
    params: z.object({}),
    query: orgQuery,
    body: z.undefined(),
    response: envelope(oaInboxSchema),
  },

  // ---------- 设置 ----------
  Oa_settings: {
    method: "get" as const,
    path: "/enterprise/oa/settings",
    params: z.object({}),
    query: orgQuery,
    body: z.undefined(),
    response: envelope(oaSettingsSchema),
  },
  Oa_saveSettings: {
    method: "post" as const,
    path: "/enterprise/oa/settings",
    params: z.object({}),
    query: emptyQuery,
    body: orgQuery.extend({
      adminUserIds: z.array(z.string()).optional(),
      deptHeads: z.record(z.string(), z.string()).optional(),
      remindAfterHours: z.number().int().min(0).max(720).optional(),
      allowWithdraw: z.boolean().optional(),
    }),
    response: envelope(oaSettingsSchema),
  },
};
