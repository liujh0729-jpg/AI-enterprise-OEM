import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/** 列类型与后端 data-table.service 的 FIELD_TYPES 一一对应；界面只显中文标签。 */
export const FIELD_TYPE_LABEL: Record<string, string> = {
  text: "文本",
  number: "数字",
  boolean: "是/否",
  date: "日期",
  url: "链接",
  email: "邮箱",
  json: "JSON",
  select: "单选",
};

export const FIELD_TYPE_OPTIONS = Object.entries(FIELD_TYPE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

export function fieldTypeLabel(type: string) {
  return FIELD_TYPE_LABEL[type] || type;
}

/** 字段级 AI 列配置：提示词 + 取材列（后端的 options.ai）。 */
export type FieldAi = { prompt: string; source_keys: string[] };

/** 后端 decorateField 的返回形状。 */
export type DataTableField = {
  id: number;
  tableId: number;
  name: string;
  fieldKey: string;
  fieldType: string;
  sortOrder: number;
  options?: { choices?: string[]; ai?: FieldAi | null } | null;
  required: boolean;
  createdAt: string;
};

/** 后端 decorateRow 的返回形状：值以列键为键。 */
export type DataTableRow = {
  id: number;
  tableId: number;
  data: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** 四种操作各自独立的权限位（后端 data_table_grants 的四个布尔列）。 */
export type TablePermissions = {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

export const PERMISSION_LABEL: Record<keyof TablePermissions, string> = {
  read: "访问",
  create: "新增",
  update: "修改",
  delete: "删除",
};

/** 权限位摘要：卡片上标出这个账号对这张表有哪几种操作。 */
export function permissionSummary(can: TablePermissions): string {
  const granted = (Object.keys(PERMISSION_LABEL) as (keyof TablePermissions)[])
    .filter((bit) => can[bit])
    .map((bit) => PERMISSION_LABEL[bit]);
  return granted.length ? granted.join(" / ") : "未授权";
}

export type DataTableTable = {
  id: number;
  createdBy: string;
  /** 归属＝建表账号：切企业 / 服务商 / 职员身份看到的都是同一份。 */
  owner: boolean;
  can: TablePermissions;
  name: string;
  description: string;
  fields: DataTableField[];
  rowCount: number;
  createdAt: string;
  updatedAt: string;
};

/** 可授权名单里的一名旗下成员（企业同事 / 绑定职员）。 */
export type GrantCandidate = {
  userId: string;
  name: string;
  sources: string[];
};

export type GrantRow = {
  id: number;
  tableId: number;
  userId: string;
  grantedBy: string;
  createdAt: string;
  can: TablePermissions;
};

export type GrantView = {
  candidates: GrantCandidate[];
  grants: GrantRow[];
};

export type RowPage = {
  list: DataTableRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** 视图类型：网格 / 看板 / 汇总，只影响呈现。 */
export type ViewType = "GRID" | "KANBAN" | "DASHBOARD";

export const VIEW_TYPE_LABEL: Record<string, string> = {
  GRID: "网格",
  KANBAN: "看板",
  DASHBOARD: "汇总",
};

/** 保存的表格视图（后端 data_table_views）。 */
export type DataTableView = {
  id: number;
  tableId: number;
  createdBy: string;
  name: string;
  type: ViewType;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

/** AI 列填充结果。 */
export type AiFillResult = {
  fieldKey: string;
  updated: number;
  skipped: number;
  model: string;
  mode: "llm" | "rule";
};

/** AI 问数结果：结论 + 聚合口径 + 样本行。 */
export type AiAskResult = {
  answer: string;
  mode: "llm" | "aggregate";
  model: string;
  columns: { key: string; name: string; type: string }[];
  aggregates: Record<string, unknown>;
  rows: Record<string, unknown>[];
  total: number;
  sampleSize: number;
};

/** 一句话建表的列草稿。 */
export type PlanField = {
  name: string;
  field_key: string;
  field_type: string;
  choices: string[];
  required: boolean;
  ai: FieldAi | null;
};

/** 一句话建表草稿（不落库，确认后再走新建 + 批量建列）。 */
export type PlanTable = {
  name: string;
  description: string;
  fields: PlanField[];
  model: string;
  mode: "llm" | "rule";
};

/** AI 视图草稿。 */
export type PlanView = {
  name: string;
  type: ViewType;
  config: Record<string, unknown>;
  model: string;
};

/** 看板/汇总视图能用的列（看板按单选或文本列分组，汇总只对数字列做合计）。 */
export function groupableFields(fields: DataTableField[]) {
  return fields.filter(
    (field) => field.fieldType === "select" || field.fieldType === "text",
  );
}

export function numericFields(fields: DataTableField[]) {
  return fields.filter((field) => field.fieldType === "number");
}

/** 飞书同步：本地列键 ↔ 飞书字段名。 */
export type FeishuMapping = { localKey: string; feishuName: string };

export type FeishuSync = {
  id: number;
  tableId: number;
  direction: "pull" | "push" | "both";
  directionLabel: string;
  appId: string;
  appToken: string;
  feishuTableId: string;
  verificationToken: string;
  hasAppSecret: boolean;
  hasEncryptKey: boolean;
  fieldMapping: FeishuMapping[];
  status: "active" | "paused";
  webhookPath: string;
  lastSyncAt: string | null;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type FeishuTable = { tableId: string; name: string };
export type FeishuField = { fieldId: string; fieldName: string; type: number };
export type FeishuPreview = { tables: FeishuTable[]; fields: FeishuField[] };

export type FeishuSyncLog = {
  id: number;
  trigger: string;
  status: string;
  stats: Record<string, unknown>;
  message: string;
  createdAt: string;
};

export type FeishuRunStats = {
  trigger: string;
  pulled: number;
  pushed: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
};

const api = {
  list: endpoint(endpoints.DataTable_list),
  detail: endpoint(endpoints.DataTable_get),
  create: endpoint(endpoints.DataTable_create),
  update: endpoint(endpoints.DataTable_update),
  remove: endpoint(endpoints.DataTable_remove),
  addField: endpoint(endpoints.DataTable_addField),
  addFields: endpoint(endpoints.DataTable_addFields),
  updateField: endpoint(endpoints.DataTable_updateField),
  deleteField: endpoint(endpoints.DataTable_removeField),
  reorderFields: endpoint(endpoints.DataTable_reorderFields),
  rows: endpoint(endpoints.DataTable_rows),
  createRow: endpoint(endpoints.DataTable_addRow),
  updateRow: endpoint(endpoints.DataTable_updateRow),
  deleteRow: endpoint(endpoints.DataTable_removeRow),
  grants: endpoint(endpoints.DataTable_grants),
  saveGrants: endpoint(endpoints.DataTable_saveGrants),
  aiFillColumn: endpoint(endpoints.DataTable_aiFillColumn),
  aiAsk: endpoint(endpoints.DataTable_aiAsk),
  aiPlanTable: endpoint(endpoints.DataTable_aiPlanTable),
  aiPlanView: endpoint(endpoints.DataTable_aiPlanView),
  views: endpoint(endpoints.DataTable_views),
  saveView: endpoint(endpoints.DataTable_saveView),
  removeView: endpoint(endpoints.DataTable_removeView),
  feishuSyncs: endpoint(endpoints.DataTable_feishuSyncs),
  createFeishuSync: endpoint(endpoints.DataTable_createFeishuSync),
  updateFeishuSync: endpoint(endpoints.DataTable_updateFeishuSync),
  removeFeishuSync: endpoint(endpoints.DataTable_removeFeishuSync),
  previewFeishuSync: endpoint(endpoints.DataTable_previewFeishuSync),
  testFeishuSync: endpoint(endpoints.DataTable_testFeishuSync),
  runFeishuSync: endpoint(endpoints.DataTable_runFeishuSync),
  feishuSyncLogs: endpoint(endpoints.DataTable_feishuSyncLogs),
};

/** 取数：失败不抛错，交页面提示（与 staff/_components/common.ts 同口径）。 */
async function load<T>(work: Promise<unknown>): Promise<{
  data: T | null;
  message: string;
}> {
  try {
    return { data: (await work) as T, message: "" };
  } catch (error) {
    return { data: null, message: (error as Error).message || "加载失败" };
  }
}

/** 写操作：失败抛出后端文案，由调用方 message.error。 */
async function mutate<T>(work: Promise<unknown>): Promise<T> {
  return (await work) as T;
}

export const tableApi = {
  list: () => load<DataTableTable[]>(api.list({})),
  detail: (id: number) =>
    load<DataTableTable>(api.detail({ params: { id: String(id) } })),
  create: (body: { name: string; description?: string }) =>
    mutate<DataTableTable>(api.create({ body })),
  update: (id: number, body: { name?: string; description?: string }) =>
    mutate<DataTableTable>(api.update({ params: { id: String(id) }, body })),
  remove: (id: number) =>
    mutate<{ id: number }>(api.remove({ params: { id: String(id) } })),
  addField: (id: number, body: Record<string, unknown>) =>
    mutate<DataTableField>(api.addField({ params: { id: String(id) }, body })),
  addFields: (id: number, fields: Record<string, unknown>[]) =>
    mutate<DataTableField[]>(
      api.addFields({ params: { id: String(id) }, body: { fields } }),
    ),
  updateField: (id: number, fieldId: number, body: Record<string, unknown>) =>
    mutate<DataTableField>(
      api.updateField({
        params: { id: String(id), fieldId: String(fieldId) },
        body,
      }),
    ),
  deleteField: (id: number, fieldId: number) =>
    mutate<{ id: number }>(
      api.deleteField({ params: { id: String(id), fieldId: String(fieldId) } }),
    ),
  reorderFields: (id: number, fieldKeys: string[]) =>
    mutate<{ fieldKey: string }[]>(
      api.reorderFields({
        params: { id: String(id) },
        body: { field_keys: fieldKeys },
      }),
    ),
  rows: (id: number, page: number, pageSize: number) =>
    load<RowPage>(
      api.rows({ params: { id: String(id) }, query: { page, pageSize } }),
    ),
  createRow: (id: number, data: Record<string, unknown>) =>
    mutate<DataTableRow>(
      api.createRow({ params: { id: String(id) }, body: { data } }),
    ),
  updateRow: (id: number, rowId: number, data: Record<string, unknown>) =>
    mutate<DataTableRow>(
      api.updateRow({
        params: { id: String(id), rowId: String(rowId) },
        body: { data },
      }),
    ),
  deleteRow: (id: number, rowId: number) =>
    mutate<{ id: number }>(
      api.deleteRow({ params: { id: String(id), rowId: String(rowId) } }),
    ),
  grants: (id: number) =>
    load<GrantView>(api.grants({ params: { id: String(id) } })),
  saveGrants: (
    id: number,
    grants: {
      user_id: string;
      can_read: boolean;
      can_create: boolean;
      can_update: boolean;
      can_delete: boolean;
    }[],
  ) =>
    mutate<GrantView>(
      api.saveGrants({ params: { id: String(id) }, body: { grants } }),
    ),
  exportUrl: (id: number) => `/api/backend/enterprise/data-tables/${id}/export`,
  aiFillColumn: (
    id: number,
    body: { field_key: string; prompt?: string; source_keys?: string[]; limit?: number },
  ) =>
    mutate<AiFillResult>(
      api.aiFillColumn({ params: { id: String(id) }, body }),
    ),
  aiAsk: (id: number, question: string) =>
    mutate<AiAskResult>(
      api.aiAsk({ params: { id: String(id) }, body: { question } }),
    ),
  aiPlanTable: (text: string) =>
    mutate<PlanTable>(api.aiPlanTable({ body: { text } })),
  aiPlanView: (id: number, text: string) =>
    mutate<PlanView>(
      api.aiPlanView({ params: { id: String(id) }, body: { text } }),
    ),
  views: (id: number) =>
    load<DataTableView[]>(api.views({ params: { id: String(id) } })),
  saveView: (
    id: number,
    body: { id?: number; name: string; type: ViewType; config?: Record<string, unknown> },
  ) => mutate<DataTableView>(api.saveView({ params: { id: String(id) }, body })),
  removeView: (id: number, viewId: number) =>
    mutate<{ id: number }>(
      api.removeView({ params: { id: String(id), viewId: String(viewId) } }),
    ),
  feishuSyncs: (id: number) =>
    load<FeishuSync[]>(api.feishuSyncs({ params: { id: String(id) } })),
  createFeishuSync: (id: number, body: Record<string, unknown>) =>
    mutate<FeishuSync>(api.createFeishuSync({ params: { id: String(id) }, body })),
  updateFeishuSync: (
    id: number,
    syncId: number,
    body: Record<string, unknown>,
  ) =>
    mutate<FeishuSync>(
      api.updateFeishuSync({
        params: { id: String(id), syncId: String(syncId) },
        body,
      }),
    ),
  removeFeishuSync: (id: number, syncId: number) =>
    mutate<{ id: number }>(
      api.removeFeishuSync({
        params: { id: String(id), syncId: String(syncId) },
      }),
    ),
  previewFeishuSync: (id: number, body: Record<string, unknown>) =>
    mutate<FeishuPreview>(
      api.previewFeishuSync({ params: { id: String(id) }, body }),
    ),
  testFeishuSync: (id: number, syncId: number) =>
    mutate<{ ok: boolean; fieldCount: number; fields: FeishuField[] }>(
      api.testFeishuSync({
        params: { id: String(id), syncId: String(syncId) },
      }),
    ),
  runFeishuSync: (id: number, syncId: number) =>
    mutate<FeishuRunStats>(
      api.runFeishuSync({
        params: { id: String(id), syncId: String(syncId) },
      }),
    ),
  feishuSyncLogs: (id: number, syncId: number) =>
    load<FeishuSyncLog[]>(
      api.feishuSyncLogs({
        params: { id: String(id), syncId: String(syncId) },
      }),
    ),
};

/** 成员来源（后端 grantCandidates 的 sources）：一家公司里的其他账号 / 绑定的职员。 */
export const GRANT_SOURCE_LABEL: Record<string, string> = {
  ENTERPRISE: "企业同事",
  PROVIDER_STAFF: "旗下职员",
};

export function grantSourceLabel(sources: string[]) {
  return sources
    .map((source) => GRANT_SOURCE_LABEL[source] || source)
    .join(" · ");
}

/** 单元格显示：空值显「—」，布尔显「是/否」，对象显 JSON 文本。 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 单选候选项：界面按逗号（中英文均可）输入，提交为数组。 */
export function parseChoices(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
