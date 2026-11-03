import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";
import type { ResultTableOptions } from "./table-picker";

/**
 * Google 潜客线索挖掘的界面层：设置（Serper Key / 线索表 / 模型）→ AI 对话澄清意图 →
 * 挖掘任务（后台执行，写行进多维表格）。后端：/enterprise/lead-prospecting/*（登录态）。
 * 归属＝账号：与多维表格 / RPA 同口径，切身份看到的都是同一批设置与任务。
 */

export type LeadSpec = {
  keywords: string[];
  country: string;
  scene: string;
  num: number;
};

export type LeadSettings = {
  serperConfigured: boolean;
  serperMasked: string;
  dataTableId: number;
  dataTableExists: boolean;
  /** 默认线索表在多维表格里的实际表名。 */
  dataTableActualName: string;
  model: string;
  keyConfigured: boolean;
  keyMasked: string;
  /** 平台 Key 状态读取失败时的原因（空＝读取正常）。 */
  keyStatusError: string;
  countries: { code: string; label: string }[];
  ready: boolean;
};

export type LeadTableResult = {
  created: boolean;
  dataTableId: number;
  name: string;
  fields: string[];
};

export type LeadChatResult = {
  reply: string;
  spec: LeadSpec | null;
  done: boolean;
  elapsedMs: number;
};

export type LeadMessage = {
  id: number;
  role: string;
  content: string;
  createdAt: string;
};

export type LeadTask = {
  id: number;
  spec: LeadSpec | Record<string, unknown>;
  rawIntent: string;
  status: string;
  totalFound: number;
  totalSaved: number;
  totalSkipped: number;
  dataTableId: number;
  /** 该任务这一轮写入的线索表表名（表已删除时为空串）。 */
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
  settings: endpoint(endpoints.Lead_settings),
  saveSettings: endpoint(endpoints.Lead_saveSettings),
  removeSerperKey: endpoint(endpoints.Lead_removeSerperKey),
  createTable: endpoint(endpoints.Lead_createTable),
  tables: endpoint(endpoints.Lead_tables),
  models: endpoint(endpoints.Lead_models),
  // 后端意图澄清单次调用最长 90s，前端超时要盖过默认 30s
  chat: endpoint(endpoints.Lead_chat, { timeoutMs: 120000 }),
  messages: endpoint(endpoints.Lead_messages),
  tasks: endpoint(endpoints.Lead_tasks),
  createTask: endpoint(endpoints.Lead_createTask),
  task: endpoint(endpoints.Lead_task),
  startTask: endpoint(endpoints.Lead_startTask),
  updateTaskTable: endpoint(endpoints.Lead_updateTaskTable),
  removeTask: endpoint(endpoints.Lead_removeTask),
};

/** 取数：失败不抛错，交页面提示（与 rpa/_components/common.ts 同口径）。 */
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

export const leadApi = {
  settings: () => load<LeadSettings>(api.settings({})),
  saveSettings: (body: {
    serperApiKey?: string;
    model?: string;
    dataTableId?: number;
  }) => mutate<LeadSettings>(api.saveSettings({ body })),
  removeSerperKey: () => mutate<LeadSettings>(api.removeSerperKey({})),
  /** 不传名字＝幂等生成/复用默认线索表；传名字＝新建一张（setDefault 才同时设为默认）。 */
  createTable: (body: { name?: string; setDefault?: boolean } = {}) =>
    mutate<LeadTableResult>(api.createTable({ body })),
  tableOptions: () => load<ResultTableOptions>(api.tables({})),
  models: () => load<{ baseUrl: string; models: string[] }>(api.models({})),
  chat: (body: { messages: ChatMsg[] }) =>
    mutate<LeadChatResult>(api.chat({ body })),
  messages: () => load<LeadMessage[]>(api.messages({})),
  tasks: () =>
    load<{ list: LeadTask[]; total: number; page: number; pageSize: number }>(
      api.tasks({ query: { page: 1, pageSize: 50 } }),
    ),
  createTask: (body: {
    spec: LeadSpec;
    rawIntent?: string;
    dataTableId?: number;
  }) => mutate<LeadTask>(api.createTask({ body })),
  startTask: (id: number) =>
    mutate<LeadTask>(api.startTask({ params: { id: String(id) } })),
  updateTaskTable: (id: number, dataTableId: number) =>
    mutate<LeadTask>(
      api.updateTaskTable({ params: { id: String(id) }, body: { dataTableId } }),
    ),
  removeTask: (id: number) =>
    mutate<{ id: number; deleted: boolean }>(
      api.removeTask({ params: { id: String(id) } }),
    ),
};

/** 任务列表里的 spec 可能来自历史脏数据，取值一律走这个收窄。 */
export function taskSpec(task: LeadTask): LeadSpec | null {
  const raw = task.spec as Partial<LeadSpec> | null;
  if (!raw || !Array.isArray(raw.keywords)) return null;
  return {
    keywords: raw.keywords.map(String),
    country: String(raw.country || ""),
    scene: String(raw.scene || ""),
    num: Number(raw.num) || 0,
  };
}

/** 国家码 → 中文名（设置里带回的 countries 是唯一数据源）。 */
export function countryLabel(countries: { code: string; label: string }[], code: string) {
  return countries.find((item) => item.code === code)?.label || code || "—";
}
