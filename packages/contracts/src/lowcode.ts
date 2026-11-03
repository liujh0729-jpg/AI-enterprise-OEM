import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

export const LOWCODE_PROJECT_TYPES = [
  "BLANK",
  "OA",
  "CRMISH",
  "TASK",
  "ASSET",
] as const;
export const LOWCODE_PROJECT_TYPE_LABELS: Record<string, string> = {
  BLANK: "空白项目",
  OA: "OA 审批",
  CRMISH: "客户登记",
  TASK: "任务台账",
  ASSET: "资产台账",
};

export const LOWCODE_BUILTIN_ROLES = [
  "OWNER",
  "ADMIN",
  "MEMBER",
  "VIEWER",
] as const;
export const LOWCODE_BUILTIN_ROLE_LABELS: Record<string, string> = {
  OWNER: "所有者",
  ADMIN: "管理员",
  MEMBER: "成员",
  VIEWER: "只读",
};

export const LOWCODE_PAGE_TYPES = [
  "LIST",
  "FORM",
  "DETAIL",
  "KANBAN",
  "APPROVAL_INBOX",
  "DASHBOARD",
  "CUSTOM",
] as const;
export const LOWCODE_PAGE_TYPE_LABELS: Record<string, string> = {
  LIST: "列表页",
  FORM: "表单页",
  DETAIL: "详情页",
  KANBAN: "看板页",
  APPROVAL_INBOX: "审批待办",
  DASHBOARD: "数据看板",
  CUSTOM: "自由画布",
};

export const LOWCODE_RULE_OPS = [
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "IN",
  "LIKE",
  "BETWEEN",
] as const;
export const LOWCODE_RULE_VARS = ["#{me}", "#{myDept}", "#{myOrg}"] as const;
export const LOWCODE_RULE_VAR_LABELS: Record<string, string> = {
  "#{me}": "当前用户",
  "#{myDept}": "我的部门",
  "#{myOrg}": "我的组织",
};

export const LOWCODE_ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "export",
  "approve",
  "design",
] as const;
export const LOWCODE_ACTION_LABELS: Record<string, string> = {
  read: "查看",
  create: "新建",
  update: "编辑",
  delete: "删除",
  export: "导出",
  approve: "审批",
  design: "设计",
};

export const LOWCODE_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "url",
  "email",
  "json",
  "select",
] as const;
export const LOWCODE_FIELD_TYPE_LABELS: Record<string, string> = {
  text: "单行文本",
  number: "数字",
  boolean: "开关",
  date: "日期",
  url: "链接",
  email: "邮箱",
  json: "JSON",
  select: "单选",
};

/** 自由画布可用的组件（拖拽设计器）。 */
export const LOWCODE_CANVAS_COMPONENTS = [
  "HEADING",
  "TEXT",
  "DIVIDER",
  "IMAGE",
  "BUTTON",
  "METRIC",
  "ENTITY_LIST",
  "ENTITY_FORM",
  "ENTITY_DETAIL",
  "KANBAN",
  "APPROVAL_INBOX",
  "SPACER",
] as const;
export const LOWCODE_CANVAS_COMPONENT_LABELS: Record<string, string> = {
  HEADING: "标题",
  TEXT: "说明文字",
  DIVIDER: "分割线",
  IMAGE: "图片",
  BUTTON: "按钮",
  METRIC: "指标卡",
  ENTITY_LIST: "数据列表",
  ENTITY_FORM: "数据表单",
  ENTITY_DETAIL: "数据详情",
  KANBAN: "看板",
  APPROVAL_INBOX: "审批待办",
  SPACER: "留白",
};

/** 新建项目时的模板。 */
export const LOWCODE_TEMPLATES = [
  {
    key: "BLANK",
    type: "BLANK",
    name: "空白项目",
    description: "从零开始，自己建实体与页面",
    icon: "appstore",
  },
  {
    key: "OA_LEAVE",
    type: "OA",
    name: "OA 审批",
    description: "请假 / 报销 / 用章 / 采购，含审批链与员工范围",
    icon: "audit",
  },
  {
    key: "CRM_LITE",
    type: "CRMISH",
    name: "客户登记",
    description: "客户档案 + 跟进记录",
    icon: "team",
  },
  {
    key: "TASK_BOARD",
    type: "TASK",
    name: "任务与项目台账",
    description: "任务、负责人、状态看板",
    icon: "project",
  },
  {
    key: "ASSET_LEDGER",
    type: "ASSET",
    name: "资产 / 设备台账",
    description: "资产编号、保管人、状态",
    icon: "database",
  },
] as const;

const fieldRow = z
  .object({
    id: z.number().optional(),
    fieldKey: z.string(),
    name: z.string(),
    fieldType: z.string(),
    required: z.boolean().default(false),
    sortOrder: z.number().default(0),
    options: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

const entityRow = z
  .object({
    id: z.number(),
    projectId: z.number(),
    dataTableId: z.number(),
    name: z.string(),
    icon: z.string(),
    formLayout: z.record(z.string(), z.unknown()).default({}),
    listLayout: z.record(z.string(), z.unknown()).default({}),
    kanbanField: z.string().default(""),
    sort: z.number().default(0),
    fields: z.array(fieldRow).default([]),
    rowCount: z.number().optional(),
  })
  .passthrough();

const pageRow = z
  .object({
    id: z.number(),
    projectId: z.number(),
    parentId: z.number().default(0),
    type: z.string(),
    typeLabel: z.string().default(""),
    name: z.string(),
    entityId: z.number().default(0),
    config: z.record(z.string(), z.unknown()).default({}),
    sort: z.number().default(0),
    visible: z.boolean().default(true),
    builtin: z.boolean().default(false),
  })
  .passthrough();

const memberRow = z
  .object({
    id: z.number(),
    memberUserId: z.string(),
    memberName: z.string().default(""),
    roleId: z.number().default(0),
    roleKey: z.string().default(""),
    roleName: z.string().default(""),
    department: z.string().default(""),
    title: z.string().default(""),
    status: z.string().default("ACTIVE"),
    createdAt: z.string().default(""),
  })
  .passthrough();

const roleRow = z
  .object({
    id: z.number(),
    key: z.string(),
    name: z.string(),
    builtin: z.boolean().default(false),
    description: z.string().default(""),
    memberCount: z.number().default(0),
    permissions: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough();

const dataRuleRow = z
  .object({
    id: z.number(),
    entityId: z.number().default(0),
    roleId: z.number().default(0),
    field: z.string(),
    op: z.string(),
    value: z.string().default(""),
    createdAt: z.string().default(""),
  })
  .passthrough();

const projectRow = z
  .object({
    id: z.number(),
    ownerUserId: z.string(),
    ownerName: z.string().default(""),
    orgType: z.string().default(""),
    orgUserId: z.string().default(""),
    orgName: z.string().default(""),
    name: z.string(),
    description: z.string().default(""),
    icon: z.string().default("appstore"),
    type: z.string(),
    typeLabel: z.string().default(""),
    status: z.string().default("ACTIVE"),
    settings: z.record(z.string(), z.unknown()).default({}),
    memberCount: z.number().default(0),
    entityCount: z.number().default(0),
    pageCount: z.number().default(0),
    myRoleKey: z.string().default(""),
    myRoleName: z.string().default(""),
    isOwner: z.boolean().default(false),
    canManage: z.boolean().default(false),
    createdAt: z.string().default(""),
    updatedAt: z.string().default(""),
  })
  .passthrough();

const rowData = z.record(z.string(), z.unknown());

const dataRow = z
  .object({
    id: z.number(),
    tableId: z.number().optional(),
    data: rowData,
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const approvalNode = z
  .object({
    type: z.enum(["APPROVE"]).default("APPROVE"),
    name: z.string().max(50).default("审批"),
    assigneeType: z.enum(["USER", "MANAGER", "DEPT_LEADER"]).default("USER"),
    userIds: z.array(z.string()).default([]),
    mode: z.enum(["ALL", "ANY"]).default("ANY"),
  })
  .passthrough();

const flowRow = z
  .object({
    id: z.number(),
    entityId: z.number(),
    name: z.string(),
    status: z.string().default("ACTIVE"),
    version: z.number().default(0),
    nodes: z.array(approvalNode).default([]),
    updatedAt: z.string().default(""),
  })
  .passthrough();

const taskRow = z
  .object({
    id: z.number(),
    instanceId: z.number(),
    projectId: z.number(),
    entityId: z.number().default(0),
    rowId: z.number().default(0),
    nodeIndex: z.number().default(0),
    nodeName: z.string().default(""),
    assigneeUserId: z.string().default(""),
    assigneeName: z.string().default(""),
    applicantUserId: z.string().default(""),
    applicantName: z.string().default(""),
    title: z.string().default(""),
    status: z.string().default("PENDING"),
    comment: z.string().default(""),
    actedAt: z.string().nullable().default(null),
    createdAt: z.string().default(""),
  })
  .passthrough();

const approvalDetail = z
  .object({
    instance: z
      .object({
        id: z.number(),
        status: z.string(),
        title: z.string().default(""),
        applicantUserId: z.string().default(""),
        applicantName: z.string().default(""),
        nodeIndex: z.number().default(0),
        createdAt: z.string().default(""),
        finishedAt: z.string().nullable().default(null),
      })
      .passthrough()
      .nullable(),
    tasks: z.array(taskRow).default([]),
    records: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough();

export const lowcodeEndpoints = {
  // ---------- 项目 ----------
  LowCode_projects: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects",
    params: z.object({}),
    query: z.object({
      /** enterprise＝当前账号所属组织（企业 / 服务商）创建的应用。 */
      scope: z.enum(["all", "mine", "joined", "enterprise"]).default("all"),
      type: z.string().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(z.array(projectRow)),
  },
  LowCode_projectTemplates: {
    method: "get" as const,
    path: "/enterprise/lowcode/templates",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        templates: z.array(
          z.object({
            key: z.string(),
            type: z.string(),
            name: z.string(),
            description: z.string(),
            icon: z.string(),
          }),
        ),
        organizations: z.array(
          z.object({
            orgType: z.string(),
            orgUserId: z.string(),
            name: z.string(),
            role: z.string().default(""),
          }),
        ),
      }),
    ),
  },
  LowCode_projectCreate: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(100),
      templateKey: z.string().max(32).default("BLANK"),
      description: z.string().max(500).default(""),
      orgType: z.string().max(16).default(""),
      orgUserId: z.string().max(64).default(""),
      icon: z.string().max(64).default(""),
    }),
    response: envelope(projectRow),
  },
  LowCode_projectDetail: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        project: projectRow,
        myRoleKey: z.string().default(""),
        myRoleName: z.string().default(""),
        permissions: z.array(z.record(z.string(), z.unknown())).default([]),
        entities: z.array(entityRow),
        pages: z.array(pageRow),
        members: z.array(memberRow),
        roles: z.array(roleRow),
        myPendingApprovals: z.number().default(0),
      }),
    ),
  },
  LowCode_projectUpdate: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      icon: z.string().max(64).optional(),
      status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
    }),
    response: envelope(projectRow),
  },
  LowCode_projectDelete: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  LowCode_availableTables: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/available-tables",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          description: z.string().default(""),
          fieldCount: z.number().default(0),
          rowCount: z.number().default(0),
          projectId: z.number().default(0),
        }),
      ),
    ),
  },

  // ---------- 成员与角色 ----------
  LowCode_members: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/members",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        rows: z.array(memberRow),
        candidates: z.array(
          z.object({
            userId: z.string(),
            name: z.string().default(""),
            department: z.string().default(""),
            title: z.string().default(""),
            source: z.string().default("ORG"),
          }),
        ),
        roles: z.array(roleRow),
        orgType: z.string().default(""),
      }),
    ),
  },
  LowCode_memberCandidates: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/member-candidates",
    params: z.object({ id: z.string() }),
    query: z.object({ keyword: z.string().optional() }),
    body: z.undefined(),
    response: envelope(
      z.array(
        z.object({
          userId: z.string(),
          name: z.string().default(""),
          department: z.string().default(""),
          title: z.string().default(""),
          source: z.string().default("ORG"),
        }),
      ),
    ),
  },
  LowCode_memberAdd: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/members",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      userIds: z.array(z.string().min(1)).min(1).max(200),
      roleId: z.number().int().min(0).default(0),
    }),
    response: envelope(z.object({ added: z.number(), skipped: z.number() })),
  },
  LowCode_memberUpdate: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/members/:memberId",
    params: z.object({ id: z.string(), memberId: z.string() }),
    query: emptyQuery,
    body: z.object({ roleId: z.number().int().min(0) }),
    response: envelope(memberRow),
  },
  LowCode_memberRemove: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id/members/:memberId",
    params: z.object({ id: z.string(), memberId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  LowCode_roles: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/roles",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(roleRow)),
  },
  LowCode_roleSave: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/roles",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      key: z.string().max(32).default(""),
      name: z.string().min(1).max(50),
      description: z.string().max(200).default(""),
    }),
    response: envelope(roleRow),
  },
  LowCode_roleDelete: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id/roles/:roleId",
    params: z.object({ id: z.string(), roleId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  LowCode_rolePermissions: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/roles/:roleId/permissions",
    params: z.object({ id: z.string(), roleId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        role: roleRow,
        permissions: z.array(z.record(z.string(), z.unknown())),
        entities: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            fields: z.array(
              z.object({ fieldKey: z.string(), name: z.string() }),
            ),
          }),
        ),
        pages: z.array(
          z.object({ id: z.number(), name: z.string(), type: z.string() }),
        ),
      }),
    ),
  },
  LowCode_rolePermissionSave: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/roles/:roleId/permissions",
    params: z.object({ id: z.string(), roleId: z.string() }),
    query: emptyQuery,
    body: z.object({
      permissions: z
        .array(
          z.object({
            resourceType: z.enum(["PAGE", "ENTITY", "FIELD", "ACTION"]),
            resourceId: z.string().max(64).default(""),
            actions: z.array(z.string().max(16)).default([]),
          }),
        )
        .default([]),
    }),
    response: envelope(z.object({ saved: z.number() })),
  },
  LowCode_dataRules: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/data-rules",
    params: z.object({ id: z.string() }),
    query: z.object({ entityId: z.coerce.number().int().optional() }),
    body: z.undefined(),
    response: envelope(z.array(dataRuleRow)),
  },
  LowCode_dataRuleSave: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/data-rules",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      entityId: z.number().int().min(0).default(0),
      roleId: z.number().int().min(0).default(0),
      field: z.string().min(1).max(64),
      op: z.enum(LOWCODE_RULE_OPS),
      value: z.string().max(200).default(""),
    }),
    response: envelope(dataRuleRow),
  },
  LowCode_dataRuleDelete: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id/data-rules/:ruleId",
    params: z.object({ id: z.string(), ruleId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 实体与页面 ----------
  LowCode_entities: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/entities",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(entityRow)),
  },
  LowCode_entitySave: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/entities",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      name: z.string().min(1).max(50),
      icon: z.string().max(64).default("table"),
      dataTableId: z.number().int().min(0).default(0),
      newTableName: z.string().max(60).default(""),
      formLayout: z.record(z.string(), z.unknown()).optional(),
      listLayout: z.record(z.string(), z.unknown()).optional(),
      kanbanField: z.string().max(64).optional(),
      sort: z.number().int().optional(),
      fields: z
        .array(
          z.object({
            fieldKey: z.string().max(64).optional(),
            name: z.string().min(1).max(200),
            fieldType: z.enum(LOWCODE_FIELD_TYPES).default("text"),
            required: z.boolean().default(false),
            options: z.record(z.string(), z.unknown()).default({}),
          }),
        )
        .optional(),
    }),
    response: envelope(entityRow),
  },
  LowCode_entityDelete: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId",
    params: z.object({ id: z.string(), entityId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  LowCode_entityFields: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/fields",
    params: z.object({ id: z.string(), entityId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(fieldRow)),
  },
  LowCode_entityFieldSave: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/fields",
    params: z.object({ id: z.string(), entityId: z.string() }),
    query: emptyQuery,
    body: z.object({
      fieldKey: z.string().max(64).default(""),
      name: z.string().min(1).max(200),
      fieldType: z.enum(LOWCODE_FIELD_TYPES).default("text"),
      required: z.boolean().default(false),
      options: z.record(z.string(), z.unknown()).default({}),
    }),
    response: envelope(fieldRow),
  },
  LowCode_entityFieldDelete: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/fields/:fieldKey",
    params: z.object({
      id: z.string(),
      entityId: z.string(),
      fieldKey: z.string(),
    }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  LowCode_pages: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/pages",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(pageRow)),
  },
  LowCode_pageSave: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/pages",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      parentId: z.number().int().min(0).default(0),
      type: z.enum(LOWCODE_PAGE_TYPES),
      name: z.string().min(1).max(50),
      entityId: z.number().int().min(0).default(0),
      config: z.record(z.string(), z.unknown()).default({}),
      sort: z.number().int().optional(),
      visible: z.boolean().default(true),
    }),
    response: envelope(pageRow),
  },
  LowCode_pageDelete: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id/pages/:pageId",
    params: z.object({ id: z.string(), pageId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  LowCode_pageReorder: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/pages/reorder",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({ ids: z.array(z.number().int().min(1)).min(1) }),
    response: envelope(z.array(pageRow)),
  },

  // ---------- 行数据 ----------
  LowCode_entityRows: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/rows",
    params: z.object({ id: z.string(), entityId: z.string() }),
    query: pageQuerySchema.extend({
      keyword: z.string().optional(),
      sort: z.string().optional(),
      sortDir: z.enum(["asc", "desc"]).optional(),
      filter: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(
      pageSchema(dataRow).extend({
        columns: z.array(
          z.object({ key: z.string(), name: z.string(), type: z.string() }),
        ),
        canCreate: z.boolean().default(false),
        canUpdate: z.boolean().default(false),
        canDelete: z.boolean().default(false),
        canExport: z.boolean().default(false),
        hiddenFields: z.array(z.string()).default([]),
        readonlyFields: z.array(z.string()).default([]),
      }),
    ),
  },
  LowCode_entityRow: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/rows/:rowId",
    params: z.object({
      id: z.string(),
      entityId: z.string(),
      rowId: z.string(),
    }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      dataRow.extend({
        canUpdate: z.boolean().default(false),
        canDelete: z.boolean().default(false),
        readonlyFields: z.array(z.string()).default([]),
        approval: approvalDetail.optional(),
      }),
    ),
  },
  LowCode_entityRowCreate: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/rows",
    params: z.object({ id: z.string(), entityId: z.string() }),
    query: emptyQuery,
    body: z.object({ data: z.record(z.string(), z.unknown()) }),
    response: envelope(dataRow),
  },
  LowCode_entityRowUpdate: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/rows/:rowId",
    params: z.object({
      id: z.string(),
      entityId: z.string(),
      rowId: z.string(),
    }),
    query: emptyQuery,
    body: z.object({ data: z.record(z.string(), z.unknown()) }),
    response: envelope(dataRow),
  },
  LowCode_entityRowDelete: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/rows/:rowId",
    params: z.object({
      id: z.string(),
      entityId: z.string(),
      rowId: z.string(),
    }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  LowCode_entityRowExport: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/export",
    params: z.object({ id: z.string(), entityId: z.string() }),
    query: emptyQuery,
    body: z.object({
      keyword: z.string().default(""),
      sort: z.string().default(""),
      sortDir: z.enum(["asc", "desc"]).default("asc"),
      filter: z.array(z.record(z.string(), z.unknown())).default([]),
    }),
    response: envelope(
      z.object({ filename: z.string(), content: z.string(), rows: z.number() }),
    ),
  },

  // ---------- 审批 ----------
  LowCode_approvalFlows: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/approval-flows",
    params: z.object({ id: z.string() }),
    query: z.object({ entityId: z.coerce.number().int().optional() }),
    body: z.undefined(),
    response: envelope(z.array(flowRow)),
  },
  LowCode_approvalFlowSave: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/approval-flows",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().min(0).default(0),
      entityId: z.number().int().min(1),
      name: z.string().min(1).max(50),
      status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
      nodes: z.array(approvalNode).min(1).max(20),
    }),
    response: envelope(flowRow),
  },
  LowCode_approvalFlowDelete: {
    method: "delete" as const,
    path: "/enterprise/lowcode/projects/:id/approval-flows/:flowId",
    params: z.object({ id: z.string(), flowId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  LowCode_approvalSubmit: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/approval-submit",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      entityId: z.number().int().min(1),
      rowId: z.number().int().min(1),
      flowId: z.number().int().min(0).default(0),
      comment: z.string().max(500).default(""),
    }),
    response: envelope(
      z.object({ instanceId: z.number(), status: z.string() }),
    ),
  },
  LowCode_approvalTasks: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/approval-tasks",
    params: z.object({ id: z.string() }),
    query: pageQuerySchema.extend({
      status: z.enum(["PENDING", "DONE"]).default("PENDING"),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(taskRow)),
  },
  LowCode_approvalAct: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/approval-act",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      taskId: z.number().int().min(1),
      action: z.enum(["APPROVE", "REJECT"]),
      comment: z.string().max(500).default(""),
    }),
    response: envelope(
      z.object({ status: z.string(), instanceStatus: z.string() }),
    ),
  },
  LowCode_recordApproval: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/entities/:entityId/rows/:rowId/approval",
    params: z.object({
      id: z.string(),
      entityId: z.string(),
      rowId: z.string(),
    }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(approvalDetail),
  },

  // ---------- AI ----------
  LowCode_aiFill: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/ai/fill",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      entityId: z.number().int().min(1),
      text: z.string().min(1).max(4000),
    }),
    response: envelope(
      z.object({
        values: z.record(z.string(), z.unknown()),
        skipped: z.array(z.string()).default([]),
        model: z.string().default(""),
      }),
    ),
  },
  LowCode_aiAsk: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/ai/ask",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      entityId: z.number().int().min(1),
      question: z.string().min(1).max(2000),
    }),
    response: envelope(
      z.object({
        answer: z.string(),
        columns: z.array(
          z.object({ key: z.string(), name: z.string(), type: z.string() }),
        ),
        rows: z.array(z.record(z.string(), z.unknown())),
        total: z.number().default(0),
        truncated: z.boolean().default(false),
      }),
    ),
  },
  LowCode_aiSettings: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/ai/settings",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        channelId: z.number().default(0),
        model: z.string().default(""),
        ownerUserId: z.string().default(""),
        channels: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            provider: z.string(),
            enabled: z.boolean().default(true),
          }),
        ),
        models: z.array(z.string()).default([]),
        configured: z.boolean().default(false),
        message: z.string().default(""),
      }),
    ),
  },
  LowCode_aiSaveSettings: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/ai/settings",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      channelId: z.number().int().min(0).default(0),
      model: z.string().max(128).default(""),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  LowCode_aiChannels: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/ai/channels",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          provider: z.string(),
          enabled: z.boolean(),
        }),
      ),
    ),
  },
  LowCode_aiModels: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/ai/models",
    params: z.object({ id: z.string() }),
    query: z.object({ channelId: z.coerce.number().int().min(0).default(0) }),
    body: z.undefined(),
    response: envelope(z.array(z.string())),
  },

  // ---------- 数字资产 ----------
  LowCode_assets: {
    method: "get" as const,
    path: "/enterprise/lowcode/projects/:id/assets",
    params: z.object({ id: z.string() }),
    query: pageQuerySchema.extend({ keyword: z.string().optional() }),
    body: z.undefined(),
    response: envelope(
      pageSchema(
        z
          .object({
            id: z.union([z.string(), z.number()]),
            name: z.string().default(""),
            url: z.string().default(""),
            type: z.string().default("file"),
            size: z.number().default(0),
            createdAt: z.string().default(""),
          })
          .passthrough(),
      ),
    ),
  },
  LowCode_uploadAsset: {
    method: "post" as const,
    path: "/enterprise/lowcode/projects/:id/assets/upload",
    params: z.object({ id: z.string() }),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(200),
      contentType: z.string().max(120).default(""),
      contentBase64: z.string().min(1),
      fieldKey: z.string().max(64).default(""),
    }),
    response: envelope(
      z
        .object({
          id: z.string(),
          name: z.string().default(""),
          url: z.string().default(""),
          type: z.string().default("file"),
          size: z.number().default(0),
        })
        .passthrough(),
    ),
  },
};

export type LowCodeProjectView = z.infer<typeof projectRow>;
export type LowCodeEntityView = z.infer<typeof entityRow>;
export type LowCodePageView = z.infer<typeof pageRow>;
export type LowCodeMemberView = z.infer<typeof memberRow>;
export type LowCodeRoleView = z.infer<typeof roleRow>;
export type LowCodeRowView = z.infer<typeof dataRow>;
export type LowCodeTaskView = z.infer<typeof taskRow>;
export type LowCodeFieldView = z.infer<typeof fieldRow>;
export type LowCodeApprovalNode = z.infer<typeof approvalNode>;
export type LowCodeApprovalDetail = z.infer<typeof approvalDetail>;
export type LowCodeDataRuleView = z.infer<typeof dataRuleRow>;
export type LowCodeFlowView = z.infer<typeof flowRow>;
