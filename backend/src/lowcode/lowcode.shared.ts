import { Prisma } from '../../generated/prisma';
import { text } from '../common/api';
import { CurrentUser } from '../auth/current-user';

export type LowCodeProjectRow = {
  id: number;
  ownerUserId: string;
  orgType: string;
  orgUserId: string;
  name: string;
  description: string;
  icon: string;
  type: string;
  status: string;
  settings: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export type LowCodeMemberRow = {
  id: number;
  projectId: number;
  memberUserId: string;
  roleId: number;
  department: string;
  title: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type LowCodeRoleRow = {
  id: number;
  projectId: number;
  key: string;
  name: string;
  builtin: boolean;
  description: string;
  createdAt: Date;
};

export type PermissionView = {
  resourceType: string;
  resourceId: string;
  actions: string[];
};

export type AccessContext = {
  project: LowCodeProjectRow;
  member: LowCodeMemberRow | null;
  isOwner: boolean;
  canManage: boolean;
  roleId: number;
  roleKey: string;
  roleName: string;
  department: string;
  permissions: PermissionView[];
  dataRules: Array<{
    id: number;
    entityId: number;
    roleId: number;
    field: string;
    op: string;
    value: string;
  }>;
};

export type FieldRuleState = 'hidden' | 'readonly' | null;

export const BUILTIN_ROLE_DEFS = [
  { key: 'OWNER', name: '所有者', description: '创建者，拥有全部权限' },
  { key: 'ADMIN', name: '管理员', description: '可配置页面、实体、成员与权限' },
  { key: 'MEMBER', name: '成员', description: '可查看、录入与修改本项目数据' },
  { key: 'VIEWER', name: '只读', description: '只能查看与导出' },
] as const;

export const ROLE_LABELS: Record<string, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  MEMBER: '成员',
  VIEWER: '只读',
};

export const PAGE_TYPE_LABELS: Record<string, string> = {
  LIST: '列表页',
  FORM: '表单页',
  DETAIL: '详情页',
  KANBAN: '看板页',
  APPROVAL_INBOX: '审批待办',
  DASHBOARD: '数据看板',
  CUSTOM: '自由画布',
};

const DEFAULT_ENTITY_ACTIONS: Record<string, string[]> = {
  MEMBER: ['read', 'create', 'update', 'export'],
  VIEWER: ['read', 'export'],
  OWNER: ['read', 'create', 'update', 'delete', 'export', 'approve'],
  ADMIN: ['read', 'create', 'update', 'delete', 'export', 'approve'],
};

export function projectTypeLabel(type: string) {
  return (
    {
      BLANK: '空白项目',
      OA: 'OA 审批',
      CRMISH: '客户登记',
      TASK: '任务台账',
      ASSET: '资产台账',
    }[type] || type
  );
}

export function actionsOf(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map((item) => text(item)).filter(Boolean);
  return [];
}

export function hasEntityAction(
  access: AccessContext,
  entityId: number,
  action: string,
) {
  if (access.isOwner || access.roleKey === 'ADMIN') return true;
  const rows = access.permissions.filter(
    (item) => item.resourceType === 'ENTITY',
  );
  const specific = rows.find((item) => item.resourceId === String(entityId));
  const wildcard = rows.find((item) => item.resourceId === '');
  const actions =
    specific?.actions ??
    wildcard?.actions ??
    DEFAULT_ENTITY_ACTIONS[access.roleKey] ??
    [];
  return actions.includes(action);
}

export function pageVisible(
  access: AccessContext,
  page: { id: number; visible: boolean },
) {
  if (!page.visible) return false;
  if (access.isOwner || access.roleKey === 'ADMIN') return true;
  const rows = access.permissions.filter(
    (item) => item.resourceType === 'PAGE',
  );
  if (!rows.length) return true;
  const specific = rows.find((item) => item.resourceId === String(page.id));
  const wildcard = rows.find((item) => item.resourceId === '');
  return (specific ?? wildcard)?.actions.includes('read') ?? false;
}

export function fieldRuleState(
  access: AccessContext,
  entityId: number,
  fieldKey: string,
): FieldRuleState {
  if (access.isOwner || access.roleKey === 'ADMIN') return null;
  const row = access.permissions.find(
    (item) =>
      item.resourceType === 'FIELD' &&
      item.resourceId === `${entityId}:${fieldKey}`,
  );
  if (!row) return null;
  if (row.actions.includes('hidden')) return 'hidden';
  if (row.actions.includes('readonly')) return 'readonly';
  return null;
}

const RULE_VARS = new Set(['#{me}', '#{myDept}', '#{myOrg}']);

export function resolveRuleValue(value: string, access: AccessContext) {
  if (!RULE_VARS.has(value)) return value;
  if (value === '#{me}')
    return access.member?.memberUserId || access.project.ownerUserId;
  if (value === '#{myDept}') return access.department;
  return access.project.orgUserId || access.project.ownerUserId;
}

const numeric = (value: unknown) => {
  const num = Number(typeof value === 'string' ? value.trim() : value);
  return Number.isFinite(num) ? num : null;
};

function compareValues(left: unknown, right: string, op: string) {
  const leftNum = numeric(left);
  const rightNum = numeric(right);
  const bothNumeric = leftNum !== null && rightNum !== null;
  const a = text(left);
  const b = right;
  const order = (): number => {
    if (bothNumeric) return leftNum - rightNum;
    return a.localeCompare(b, 'zh-CN');
  };
  switch (op) {
    case '=':
      return bothNumeric ? leftNum === rightNum : a === b;
    case '!=':
      return bothNumeric ? leftNum !== rightNum : a !== b;
    case '>':
      return order() > 0;
    case '>=':
      return order() >= 0;
    case '<':
      return order() < 0;
    case '<=':
      return order() <= 0;
    default:
      return true;
  }
}

/** 行级数据规则：规则全部命中才可见；支持固定会话变量，不做表达式求值。 */
export function ruleMatches(
  rule: { field: string; op: string; value: string },
  data: Record<string, unknown>,
  createdBy: string,
  access: AccessContext,
): boolean {
  const actual = rule.field === 'createdBy' ? createdBy : data[rule.field];
  const expected = resolveRuleValue(rule.value, access);
  switch (rule.op) {
    case 'IN':
      return expected
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .some((item) => text(actual) === item);
    case 'BETWEEN': {
      const [from, to] = expected.split(',').map((item) => item.trim());
      if (!from || !to) return true;
      return (
        compareValues(actual, from, '>=') && compareValues(actual, to, '<=')
      );
    }
    case 'LIKE':
      return text(actual).toLowerCase().includes(expected.toLowerCase());
    default:
      return compareValues(actual, expected, rule.op);
  }
}

export function rulesForEntity(access: AccessContext, entityId: number) {
  if (access.isOwner || access.roleKey === 'ADMIN') return [];
  return access.dataRules.filter(
    (rule) => rule.entityId === 0 || rule.entityId === entityId,
  );
}

export function rowAllowed(
  access: AccessContext,
  entityId: number,
  row: { data: unknown; createdBy: string },
) {
  const rules = rulesForEntity(access, entityId);
  if (!rules.length) return true;
  const data = (row.data || {}) as Record<string, unknown>;
  return rules.every((rule) => ruleMatches(rule, data, row.createdBy, access));
}

export const ownerUser = (project: LowCodeProjectRow) =>
  new CurrentUser(project.ownerUserId, '', '');

/** 组织归属校验：只允许以自己的企业 / 服务商账号作为项目组织。 */
export type OrgQualification = {
  orgType: string;
  orgUserId: string;
  orgName: string;
};

// ---------------------------------------------------------------------------
// 模板：新建项目时按模板生成实体（多维表格表）+ 页面 + 审批流
// ---------------------------------------------------------------------------

export type TemplateField = {
  key: string;
  name: string;
  type:
    | 'text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'url'
    | 'email'
    | 'json'
    | 'select';
  required?: boolean;
  choices?: string[];
};

export type TemplateEntity = {
  name: string;
  icon: string;
  fields: TemplateField[];
  kanbanField?: string;
  listColumns?: string[];
};

export type TemplatePage = {
  type: string;
  name: string;
  entityIndex?: number;
  config?: Record<string, unknown>;
};

export type TemplateDef = {
  key: string;
  type: string;
  name: string;
  description: string;
  icon: string;
  entities: TemplateEntity[];
  pages: TemplatePage[];
  approval?: {
    entityIndex: number;
    name: string;
    nodes: Array<Record<string, unknown>>;
  };
};

const statusChoices = ['待处理', '进行中', '已完成'];

export const TEMPLATES: TemplateDef[] = [
  {
    key: 'BLANK',
    type: 'BLANK',
    name: '空白项目',
    description: '从零开始，自己建实体与页面',
    icon: 'appstore',
    entities: [],
    pages: [],
  },
  {
    key: 'OA_LEAVE',
    type: 'OA',
    name: 'OA 审批',
    description: '请假 / 报销 / 用章 / 采购，含审批链与员工范围',
    icon: 'audit',
    entities: [
      {
        name: '申请单',
        icon: 'audit',
        fields: [
          { key: 'title', name: '申请事由', type: 'text', required: true },
          {
            key: 'kind',
            name: '申请类型',
            type: 'select',
            required: true,
            choices: ['请假', '报销', '用章', '采购'],
          },
          { key: 'applicant', name: '申请人', type: 'text', required: true },
          { key: 'days', name: '数量 / 天数', type: 'number' },
          { key: 'start_date', name: '开始日期', type: 'date' },
          { key: 'end_date', name: '结束日期', type: 'date' },
          { key: 'amount', name: '金额（元）', type: 'number' },
          { key: 'reason', name: '说明', type: 'text' },
          {
            key: 'status',
            name: '状态',
            type: 'select',
            choices: ['草稿', '审批中', '已通过', '已驳回'],
          },
        ],
        kanbanField: 'status',
      },
    ],
    pages: [
      { type: 'APPROVAL_INBOX', name: '我的审批' },
      {
        type: 'LIST',
        name: '申请列表',
        entityIndex: 0,
        config: {
          columns: ['title', 'kind', 'applicant', 'days', 'status'],
          sort: { fieldKey: 'start_date', dir: 'desc' },
        },
      },
      { type: 'FORM', name: '新建申请', entityIndex: 0 },
      {
        type: 'KANBAN',
        name: '申请看板',
        entityIndex: 0,
        config: { groupField: 'status' },
      },
    ],
    approval: {
      entityIndex: 0,
      name: '申请审批',
      nodes: [
        {
          type: 'APPROVE',
          name: '直属主管审批',
          assigneeType: 'MANAGER',
          userIds: [],
          mode: 'ANY',
        },
        {
          type: 'APPROVE',
          name: '部门负责人审批',
          assigneeType: 'DEPT_LEADER',
          userIds: [],
          mode: 'ANY',
        },
      ],
    },
  },
  {
    key: 'CRM_LITE',
    type: 'CRMISH',
    name: '客户登记',
    description: '客户档案 + 跟进记录',
    icon: 'team',
    entities: [
      {
        name: '客户',
        icon: 'team',
        fields: [
          { key: 'name', name: '客户名称', type: 'text', required: true },
          { key: 'contact', name: '联系人', type: 'text' },
          { key: 'phone', name: '联系电话', type: 'text' },
          {
            key: 'industry',
            name: '行业',
            type: 'select',
            choices: ['制造', '贸易', '服务', '互联网', '其他'],
          },
          {
            key: 'level',
            name: '客户等级',
            type: 'select',
            choices: ['A', 'B', 'C'],
          },
          { key: 'notes', name: '备注', type: 'text' },
        ],
        kanbanField: 'level',
      },
      {
        name: '跟进记录',
        icon: 'message',
        fields: [
          { key: 'customer', name: '客户', type: 'text', required: true },
          {
            key: 'follow_date',
            name: '跟进日期',
            type: 'date',
            required: true,
          },
          {
            key: 'channel',
            name: '跟进方式',
            type: 'select',
            choices: ['电话', '拜访', '微信', '邮件'],
          },
          { key: 'result', name: '跟进结果', type: 'text' },
        ],
      },
    ],
    pages: [
      {
        type: 'LIST',
        name: '客户列表',
        entityIndex: 0,
        config: { columns: ['name', 'contact', 'phone', 'industry', 'level'] },
      },
      { type: 'FORM', name: '新建客户', entityIndex: 0 },
      {
        type: 'LIST',
        name: '跟进记录',
        entityIndex: 1,
        config: { columns: ['customer', 'follow_date', 'channel', 'result'] },
      },
      { type: 'FORM', name: '记录跟进', entityIndex: 1 },
    ],
  },
  {
    key: 'TASK_BOARD',
    type: 'TASK',
    name: '任务与项目台账',
    description: '任务、负责人、状态看板',
    icon: 'project',
    entities: [
      {
        name: '任务',
        icon: 'project',
        fields: [
          { key: 'title', name: '任务名称', type: 'text', required: true },
          { key: 'owner', name: '负责人', type: 'text' },
          {
            key: 'status',
            name: '状态',
            type: 'select',
            choices: statusChoices,
          },
          {
            key: 'priority',
            name: '优先级',
            type: 'select',
            choices: ['高', '中', '低'],
          },
          { key: 'due_date', name: '截止日期', type: 'date' },
          { key: 'progress', name: '进度（%）', type: 'number' },
          { key: 'remarks', name: '备注', type: 'text' },
        ],
        kanbanField: 'status',
      },
    ],
    pages: [
      {
        type: 'LIST',
        name: '任务列表',
        entityIndex: 0,
        config: {
          columns: ['title', 'owner', 'status', 'priority', 'due_date'],
        },
      },
      { type: 'FORM', name: '新建任务', entityIndex: 0 },
      {
        type: 'KANBAN',
        name: '任务看板',
        entityIndex: 0,
        config: { groupField: 'status' },
      },
    ],
  },
  {
    key: 'ASSET_LEDGER',
    type: 'ASSET',
    name: '资产 / 设备台账',
    description: '资产编号、保管人、状态',
    icon: 'database',
    entities: [
      {
        name: '资产',
        icon: 'database',
        fields: [
          { key: 'code', name: '资产编号', type: 'text', required: true },
          { key: 'name', name: '资产名称', type: 'text', required: true },
          {
            key: 'category',
            name: '资产类别',
            type: 'select',
            choices: ['办公设备', '生产设备', '车辆', '房产', '其他'],
          },
          { key: 'keeper', name: '保管人', type: 'text' },
          { key: 'location', name: '存放位置', type: 'text' },
          {
            key: 'status',
            name: '状态',
            type: 'select',
            choices: ['在用', '闲置', '维修', '报废'],
          },
          { key: 'purchase_date', name: '购置日期', type: 'date' },
          { key: 'value', name: '原值（元）', type: 'number' },
        ],
        kanbanField: 'status',
      },
    ],
    pages: [
      {
        type: 'LIST',
        name: '资产清单',
        entityIndex: 0,
        config: { columns: ['code', 'name', 'category', 'keeper', 'status'] },
      },
      { type: 'FORM', name: '新增资产', entityIndex: 0 },
      {
        type: 'KANBAN',
        name: '状态看板',
        entityIndex: 0,
        config: { groupField: 'status' },
      },
    ],
  },
];

export function templateByKey(key: string) {
  return (
    TEMPLATES.find((item) => item.key === key) ||
    TEMPLATES.find((item) => item.type === key) ||
    null
  );
}

/** 画布组件白名单：拖拽设计器只存这些类型，渲染端也只认它们。 */
export const CANVAS_COMPONENTS = new Set([
  'HEADING',
  'TEXT',
  'DIVIDER',
  'IMAGE',
  'BUTTON',
  'METRIC',
  'ENTITY_LIST',
  'ENTITY_FORM',
  'ENTITY_DETAIL',
  'KANBAN',
  'APPROVAL_INBOX',
  'SPACER',
]);
