import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 统一组织成员：企业与服务商共用同一套「职员与代理人」。
 * 服务商继续使用原有接口与页面（零改动），企业使用本组接口；两边共享 staff_profiles 与同一套组件。
 */
export const ORG_TYPES = ["ENTERPRISE", "PROVIDER"] as const;
export type OrgType = (typeof ORG_TYPES)[number];
export const ORG_TYPE_LABELS: Record<string, string> = {
  ENTERPRISE: "企业",
  PROVIDER: "服务商",
};

export const MEMBER_KINDS = ["STAFF", "AGENT"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];
export const MEMBER_KIND_LABELS: Record<string, string> = {
  STAFF: "职员",
  AGENT: "代理人",
};

export const ORG_MEMBER_STATUS_LABELS: Record<string, string> = {
  PENDING: "待确认",
  ACTIVE: "在职",
  REMOVED: "已移除",
};

export const ORG_APPLICATION_STATUS_LABELS: Record<string, string> = {
  PENDING: "待处理",
  APPROVED: "已通过",
  REJECTED: "已拒绝",
  CANCELLED: "已撤回",
};

/** 企业职员可分配的业务板块（与菜单板块一一对应；代理人只在这些范围内被指派）。 */
export const ORG_BUSINESS_SCOPES = [
  "TAX",
  "MARKETING",
  "LEGAL",
  "IP",
  "FLEX",
  "LOGISTICS",
  "SMART",
  "ASSET",
  "OVERSEAS",
  "SUPPLY",
  "THINK_TANK",
  "CONTRACT",
  "OA",
] as const;
export const ORG_BUSINESS_SCOPE_LABELS: Record<string, string> = {
  TAX: "财税服务",
  MARKETING: "营销服务",
  LEGAL: "法律服务",
  IP: "知识产权",
  FLEX: "灵活用工",
  LOGISTICS: "物流服务",
  SMART: "IT服务",
  ASSET: "资产交易",
  OVERSEAS: "跨境出海",
  SUPPLY: "供销网络",
  THINK_TANK: "智库服务",
  CONTRACT: "签约管理",
  OA: "OA 办公",
};

/** 岗位：一人多岗，岗位说明可选。 */
export const orgStaffPositionSchema = z.object({
  name: z.string().max(64).default(""),
  description: z.string().max(500).default(""),
});
export type OrgStaffPosition = z.infer<typeof orgStaffPositionSchema>;

export const orgStaffSchema = z.object({
  id: z.number(),
  orgType: z.string(),
  orgUserId: z.string(),
  memberUserId: z.string(),
  memberKind: z.string(),
  memberKindLabel: z.string(),
  roles: z.array(z.string()),
  roleLabels: z.array(z.string()),
  scope: z.array(z.string()),
  scopeLabels: z.array(z.string()),
  department: z.string(),
  positions: z.array(orgStaffPositionSchema),
  capabilities: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  realName: z.string(),
  phone: z.string(),
  email: z.string(),
  province: z.string(),
  city: z.string(),
  createdAt: z.string(),
  confirmedAt: z.string(),
});
export type OrgStaffRow = z.infer<typeof orgStaffSchema>;

export const orgApplicationSchema = z.object({
  id: z.number(),
  orgType: z.string(),
  orgUserId: z.string(),
  memberUserId: z.string(),
  memberKind: z.string(),
  memberKindLabel: z.string(),
  direction: z.string(),
  roles: z.array(z.string()),
  roleLabels: z.array(z.string()),
  department: z.string(),
  positions: z.array(orgStaffPositionSchema),
  capabilities: z.string(),
  note: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  memberName: z.string(),
  orgName: z.string(),
  createdAt: z.string(),
  decidedAt: z.string(),
});
export type OrgApplicationRow = z.infer<typeof orgApplicationSchema>;

export const orgCandidateSchema = z.object({
  userId: z.string(),
  realName: z.string(),
  phone: z.string(),
  province: z.string(),
  city: z.string(),
  inOrg: z.boolean(),
});

/** 职能目录项：部门与岗位同一形状（岗位带说明）。 */
export const orgFunctionItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  sortOrder: z.number(),
});
export type OrgFunctionItem = z.infer<typeof orgFunctionItemSchema>;

/** 职能管理里的成员行：只保留赋职能要用的字段。 */
export const orgFunctionMemberSchema = z.object({
  id: z.number(),
  memberUserId: z.string(),
  realName: z.string(),
  memberKind: z.string(),
  memberKindLabel: z.string(),
  roles: z.array(z.string()),
  roleLabels: z.array(z.string()),
  department: z.string(),
  positions: z.array(orgStaffPositionSchema),
  status: z.string(),
  statusLabel: z.string(),
});
export type OrgFunctionMember = z.infer<typeof orgFunctionMemberSchema>;

export const orgFunctionCatalogSchema = z.object({
  orgType: z.string(),
  orgName: z.string(),
  manageable: z.boolean(),
  departments: z.array(orgFunctionItemSchema),
  positions: z.array(orgFunctionItemSchema),
  members: z.array(orgFunctionMemberSchema),
});
export type OrgFunctionCatalog = z.infer<typeof orgFunctionCatalogSchema>;

export const orgStaffEndpoints = {
  OrgStaff_workspace: {
    method: "get" as const,
    path: "/enterprise/org-staff/workspace",
    params: z.object({}),
    query: z.object({ orgType: z.enum(ORG_TYPES).optional() }),
    body: z.undefined(),
    response: envelope(
      z.object({
        orgType: z.string(),
        orgName: z.string(),
        /** 本人是否可管理（企业主 / 服务商负责人 / 管理员） */
        manageable: z.boolean(),
        staff: z.array(orgStaffSchema),
        applications: z.array(orgApplicationSchema),
        myInvitations: z.array(orgApplicationSchema),
      }),
    ),
  },
  OrgStaff_search: {
    method: "get" as const,
    path: "/enterprise/org-staff/candidates",
    params: z.object({}),
    query: z.object({ q: z.string().default("") }),
    body: z.undefined(),
    response: envelope(z.array(orgCandidateSchema)),
  },
  OrgStaff_invite: {
    method: "post" as const,
    path: "/enterprise/org-staff/invite",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      orgType: z.enum(ORG_TYPES).optional(),
      memberUserId: z.string().min(1),
      memberKind: z.enum(MEMBER_KINDS).default("STAFF"),
      roles: z.array(z.string()).default([]),
      scope: z.array(z.string()).default([]),
      department: z.string().max(64).default(""),
      positions: z.array(orgStaffPositionSchema).max(5).default([]),
      capabilities: z.string().max(1000).default(""),
    }),
    response: envelope(z.object({ id: z.number(), status: z.string() })),
  },
  OrgStaff_update: {
    method: "patch" as const,
    path: "/enterprise/org-staff/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      memberKind: z.enum(MEMBER_KINDS).optional(),
      roles: z.array(z.string()).optional(),
      scope: z.array(z.string()).optional(),
      department: z.string().max(64).optional(),
      positions: z.array(orgStaffPositionSchema).max(5).optional(),
      capabilities: z.string().max(1000).optional(),
      status: z.enum(["ACTIVE", "REMOVED"]).optional(),
    }),
    response: envelope(orgStaffSchema),
  },
  OrgStaff_remove: {
    method: "delete" as const,
    path: "/enterprise/org-staff/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  OrgStaff_decide: {
    method: "post" as const,
    path: "/enterprise/org-staff/applications/:id/decide",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ action: z.enum(["APPROVE", "REJECT", "CANCEL"]) }),
    response: envelope(z.object({ id: z.number(), status: z.string() })),
  },
  // ---------- 职能管理（部门 / 岗位目录 + 赋给成员） ----------
  OrgStaff_functions: {
    method: "get" as const,
    path: "/enterprise/org-staff/functions",
    params: z.object({}),
    query: z.object({ orgType: z.enum(ORG_TYPES).optional() }),
    body: z.undefined(),
    response: envelope(orgFunctionCatalogSchema),
  },
  OrgStaff_saveDepartment: {
    method: "post" as const,
    path: "/enterprise/org-staff/functions/departments",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      orgType: z.enum(ORG_TYPES).optional(),
      id: z.number().int().positive().optional(),
      name: z.string().min(1).max(64),
      description: z.string().max(500).default(""),
      sortOrder: z.number().int().min(0).max(9999).default(0),
    }),
    response: envelope(orgFunctionItemSchema),
  },
  OrgStaff_removeDepartment: {
    method: "delete" as const,
    path: "/enterprise/org-staff/functions/departments/:id",
    params: z.object({ id: z.string() }),
    query: z.object({ orgType: z.enum(ORG_TYPES).optional() }),
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  OrgStaff_savePosition: {
    method: "post" as const,
    path: "/enterprise/org-staff/functions/positions",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      orgType: z.enum(ORG_TYPES).optional(),
      id: z.number().int().positive().optional(),
      name: z.string().min(1).max(64),
      description: z.string().max(500).default(""),
      sortOrder: z.number().int().min(0).max(9999).default(0),
    }),
    response: envelope(orgFunctionItemSchema),
  },
  OrgStaff_removePosition: {
    method: "delete" as const,
    path: "/enterprise/org-staff/functions/positions/:id",
    params: z.object({ id: z.string() }),
    query: z.object({ orgType: z.enum(ORG_TYPES).optional() }),
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  OrgStaff_assignFunctions: {
    method: "put" as const,
    path: "/enterprise/org-staff/functions/members/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      orgType: z.enum(ORG_TYPES).optional(),
      department: z.string().max(64).default(""),
      positions: z.array(orgStaffPositionSchema).max(5).default([]),
    }),
    response: envelope(orgFunctionMemberSchema),
  },
};
