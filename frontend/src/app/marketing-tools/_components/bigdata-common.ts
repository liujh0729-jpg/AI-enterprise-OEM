import { endpoints, BIGDATA_DATASETS } from "@enterprise/contracts";
import type { BigdataDatasetKey } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";
import type { ResultTableOptions } from "./table-picker";

/**
 * 大数据查询的界面层（营销工具里的五个独立数据集工具）。
 * 后端：/enterprise/bigdata/:dataset/*（登录态）；上游 https://bigdata.aiworkin.com 通道开放，
 * 用户不需要自带第三方 Key，设置只剩「结果承载表 + 分析模型（模型 Key 用「API Key 管理」那把 sk-）」。
 * 归属＝账号 × 数据集：五个工具各有各的设置、对话、任务与结果表，互不共用。
 */

export type BigdataSpec = {
  /** 上游请求体的筛选条件；键限该数据集的 filters。 */
  filters: Record<string, unknown>;
  /** 本次写入结果表的行数上限。 */
  limit: number;
  /** 用户这轮需求的场景说明。 */
  scene: string;
};

export type BigdataSettings = {
  dataset: string;
  label: string;
  dataTableId: number;
  dataTableExists: boolean;
  /** 模板表名（该数据集默认结果表应该叫什么）。 */
  tableName: string;
  /** 默认结果表在多维表格里的实际表名（可能与模板名不同）。 */
  dataTableActualName: string;
  /** 结果表已建时的列数。 */
  columnCount: number;
  model: string;
  keyConfigured: boolean;
  keyMasked: string;
  /** 平台 Key 状态读取失败时的原因（空＝读取正常）。 */
  keyStatusError: string;
  ready: boolean;
};

export type BigdataTableResult = {
  created: boolean;
  dataTableId: number;
  name: string;
  fields: string[];
};

export type BigdataChatResult = {
  reply: string;
  spec: BigdataSpec | null;
  done: boolean;
  elapsedMs: number;
};

export type BigdataMessage = {
  id: number;
  role: string;
  content: string;
  createdAt: string;
};

export type BigdataTask = {
  id: number;
  dataset: string;
  spec: Record<string, unknown>;
  rawIntent: string;
  status: string;
  totalFound: number;
  totalSaved: number;
  totalSkipped: number;
  dataTableId: number;
  /** 该任务这一轮写入的多维表格表名（表已删除时为空串）。 */
  dataTableName: string;
  error: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  success: "已完成",
  failed: "失败",
};

export const TASK_STATUS_COLOR: Record<string, string> = {
  pending: "default",
  running: "processing",
  success: "success",
  failed: "error",
};

const api = {
  settings: endpoint(endpoints.Bigdata_settings),
  saveSettings: endpoint(endpoints.Bigdata_saveSettings),
  createTable: endpoint(endpoints.Bigdata_createTable),
  tables: endpoint(endpoints.Bigdata_tables),
  models: endpoint(endpoints.Bigdata_models),
  // 后端把需求解析成查询参数单次调用最长 90s，前端超时要盖过默认 30s
  chat: endpoint(endpoints.Bigdata_chat, { timeoutMs: 120000 }),
  messages: endpoint(endpoints.Bigdata_messages),
  tasks: endpoint(endpoints.Bigdata_tasks),
  createTask: endpoint(endpoints.Bigdata_createTask),
  startTask: endpoint(endpoints.Bigdata_startTask),
  updateTaskTable: endpoint(endpoints.Bigdata_updateTaskTable),
  removeTask: endpoint(endpoints.Bigdata_removeTask),
};

/** 取数：失败不抛错，交页面提示（与 lead-common.ts 同口径）。 */
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

/** 绑定数据集的接口集合：五个工具各自调用，互不串数据。 */
export function bigdataApi(dataset: BigdataDatasetKey) {
  return {
    settings: () =>
      load<BigdataSettings>(api.settings({ params: { dataset } })),
    saveSettings: (body: { model?: string; dataTableId?: number }) =>
      mutate<BigdataSettings>(api.saveSettings({ params: { dataset }, body })),
    /** 不传名字＝幂等生成/复用默认结果表；传名字＝新建一张（setDefault 才同时设为默认）。 */
    createTable: (body: { name?: string; setDefault?: boolean } = {}) =>
      mutate<BigdataTableResult>(api.createTable({ params: { dataset }, body })),
    tableOptions: () =>
      load<ResultTableOptions>(api.tables({ params: { dataset } })),
    models: () => load<{ baseUrl: string; models: string[] }>(api.models({})),
    chat: (body: { messages: ChatMsg[] }) =>
      mutate<BigdataChatResult>(api.chat({ params: { dataset }, body })),
    messages: () =>
      load<BigdataMessage[]>(api.messages({ params: { dataset } })),
    tasks: () =>
      load<{
        list: BigdataTask[];
        total: number;
        page: number;
        pageSize: number;
      }>(api.tasks({ params: { dataset }, query: { page: 1, pageSize: 50 } })),
    createTask: (body: {
      spec: BigdataSpec;
      rawIntent?: string;
      dataTableId?: number;
    }) => mutate<BigdataTask>(api.createTask({ params: { dataset }, body })),
    startTask: (id: number) =>
      mutate<BigdataTask>(
        api.startTask({ params: { dataset, id: String(id) } }),
      ),
    updateTaskTable: (id: number, dataTableId: number) =>
      mutate<BigdataTask>(
        api.updateTaskTable({
          params: { dataset, id: String(id) },
          body: { dataTableId },
        }),
      ),
    removeTask: (id: number) =>
      mutate<{ id: number; deleted: boolean }>(
        api.removeTask({ params: { dataset, id: String(id) } }),
      ),
  };
}

/** 任务列表里的 spec 可能是历史脏数据，取值一律走这个收窄。 */
export function taskSpec(task: BigdataTask): BigdataSpec | null {
  const raw = task.spec as Partial<BigdataSpec> | null;
  if (!raw || typeof raw !== "object") return null;
  const filters =
    raw.filters && typeof raw.filters === "object" && !Array.isArray(raw.filters)
      ? (raw.filters as Record<string, unknown>)
      : {};
  return {
    filters,
    limit: Number(raw.limit) || 0,
    scene: String(raw.scene || ""),
  };
}

/** 上游字段名 → 该数据集声明的中文标签（未知键原样显示，便于发现脏数据）。 */
export function filterLabel(
  dataset: BigdataDatasetKey,
  key: string,
): string {
  return (
    BIGDATA_DATASETS[dataset].filters.find((item) => item.key === key)?.label ||
    key
  );
}

/** 筛选条件的可读文案：`省=广东 · 市=广州`。 */
export function filterSummary(
  dataset: BigdataDatasetKey,
  filters: Record<string, unknown>,
): string {
  const parts = Object.entries(filters).map(
    ([key, value]) => `${filterLabel(dataset, key)}=${String(value ?? "")}`,
  );
  return parts.length ? parts.join(" · ") : "—";
}
