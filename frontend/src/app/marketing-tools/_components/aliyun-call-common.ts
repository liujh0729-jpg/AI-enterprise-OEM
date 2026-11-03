import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/**
 * 阿里云智能外呼的界面层：选多维表格 → 映射列 → 预览校验 → 新建/追加任务组 →
 * 分批把号码提交给阿里云 OutboundBot。后端 /enterprise/aliyun-call/*（登录态），
 * AK 按登录账号各自配置（与 RPA / 飞书同口径），不与其他模块共用平台 Key。
 */

export type AliyunCallSettings = {
  configured: boolean;
  accessKeyIdMasked: string;
  hasSecret: boolean;
  region: string;
  instanceId: string;
  updatedAt: string;
};

export type AliyunCallInstance = { instanceId: string; name: string };
export type AliyunCallScript = {
  scriptId: string;
  name: string;
  status: string;
};
export type AliyunCallNumber = { number: string; bound: boolean };

export type AliyunCallTestResult = {
  ok: boolean;
  instances: AliyunCallInstance[];
  scripts: AliyunCallScript[];
  numbers: AliyunCallNumber[];
  messages: string[];
};

export type AliyunJobGroup = {
  jobGroupId: string;
  jobGroupName: string;
  jobGroupStatus: string;
  scriptId: string;
  scriptName: string;
  totalJobs: number;
  completedJobs: number;
  creationTime: number;
  appendable: boolean;
};

export type AliyunJobGroupStatus = {
  jobGroupId: string;
  jobGroupStatus: string;
  totalJobs: number;
  completedJobs: number;
  executing: number;
  scheduling: number;
  failed: number;
  paused: number;
  cancelled: number;
};

export type AliyunExtra = {
  /** 与话术里引用的变量同名（如 gender）。 */
  key: string;
  sourceType: "field" | "fixed";
  fieldKey: string;
  value: string;
};

export type AliyunHonorificMode = "none" | "field" | "gender" | "fixed";

export type AliyunMapping = {
  phoneFieldKey: string;
  nameFieldKey: string;
  honorificMode: AliyunHonorificMode;
  honorificFieldKey: string;
  honorificValue: string;
  genderFieldKey: string;
  roleFieldKey: string;
  extras: AliyunExtra[];
};

export type AliyunStrategy = {
  startMode: "now" | "scheduled";
  startTime: string;
  workingTimes: { beginTime: string; endTime: string }[];
  maxAttemptsPerDay: number;
  minAttemptInterval: number;
};

export type AliyunPreviewRow = {
  sourceRowId: number;
  name: string;
  phoneMasked: string;
  honorific: string;
  role: string;
  extras: { key: string; value: string }[];
  /** ok | invalid | duplicate | existing */
  status: string;
  message: string;
};

export type AliyunPreview = {
  fields: { fieldKey: string; name: string; fieldType: string }[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  existingRows: number;
  sample: AliyunPreviewRow[];
  errors: string[];
};

export type AliyunImportRow = {
  id: number;
  sourceRowId: number;
  referenceId: string;
  name: string;
  phoneMasked: string;
  status: string;
  jobId: string;
  errorCode: string;
  errorMessage: string;
};

export type AliyunImport = {
  id: number;
  mode: string;
  tableId: number;
  tableName: string;
  instanceId: string;
  scriptId: string;
  jobGroupId: string;
  jobGroupName: string;
  status: string;
  totalRows: number;
  sentRows: number;
  failedRows: number;
  skippedRows: number;
  errorCode: string;
  errorMessage: string;
  jobGroupStatus: string;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AliyunImportDetail = AliyunImport & {
  mapping: Record<string, unknown>;
  rows: AliyunImportRow[];
  rowTotal: number;
  rowPage: number;
  rowPageSize: number;
};

/** 可作为名单来源的多维表格（只读结构，行在预览时由后端整表读取）。 */
export type AliyunSourceTable = {
  id: number;
  name: string;
  owner: boolean;
  rowCount: number;
  can: { read: boolean; create: boolean; update: boolean; delete: boolean };
  fields: { fieldKey: string; name: string; fieldType: string }[];
};

export type AliyunPreviewBody = {
  tableId: number;
  mapping: AliyunMapping;
  mode: "new" | "append";
  jobGroupId: string;
  skipExisting: boolean;
};

export type AliyunCreateImportBody = AliyunPreviewBody & {
  instanceId: string;
  scriptId: string;
  jobGroupName: string;
  strategy: AliyunStrategy;
  callingNumbers: string[];
  writeBack: boolean;
  confirmCost: true;
};

/** 阿里云智能外呼只在上海开放，其他地域的 outboundbot 域名不存在。 */
export const OUTBOUNDBOT_REGION = "cn-shanghai";
export const OUTBOUNDBOT_REGION_LABEL = "华东 2（上海）";

export const IMPORT_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "提交中",
  partial: "部分成功",
  succeeded: "已完成",
  failed: "失败",
};

export const IMPORT_STATUS_COLOR: Record<string, string> = {
  queued: "default",
  running: "processing",
  partial: "warning",
  succeeded: "success",
  failed: "error",
};

/** 阿里云任务组状态字典（界面只出现中文）。 */
export const JOB_STATUS_LABEL: Record<string, string> = {
  Draft: "草稿",
  Initializing: "初始化中",
  Scheduling: "调度中",
  Executing: "执行中",
  Paused: "已暂停",
  Succeeded: "已完成",
  Failed: "失败",
  Cancelled: "已取消",
};

export const JOB_STATUS_COLOR: Record<string, string> = {
  Draft: "default",
  Initializing: "processing",
  Scheduling: "processing",
  Executing: "processing",
  Paused: "warning",
  Succeeded: "success",
  Failed: "error",
  Cancelled: "default",
};

/** 批次行状态：pending 待提交 / sent 已提交 / failed 提交失败 / skipped 已跳过。 */
export const ROW_STATUS_LABEL: Record<string, string> = {
  pending: "待提交",
  sent: "已提交",
  failed: "提交失败",
  skipped: "已跳过",
};

export const ROW_STATUS_COLOR: Record<string, string> = {
  pending: "default",
  sent: "success",
  failed: "error",
  skipped: "warning",
};

export const CONSOLE_URL = "https://outboundbot.console.aliyun.com";

export function emptyMapping(): AliyunMapping {
  return {
    phoneFieldKey: "",
    nameFieldKey: "",
    honorificMode: "none",
    honorificFieldKey: "",
    honorificValue: "",
    genderFieldKey: "",
    roleFieldKey: "",
    extras: [],
  };
}

/** 默认时段避开早晚与午休（与后端 buildStrategy 的默认值一致）。 */
export function defaultStrategy(): AliyunStrategy {
  return {
    startMode: "now",
    startTime: "",
    workingTimes: [
      { beginTime: "09:00", endTime: "12:00" },
      { beginTime: "14:00", endTime: "20:00" },
    ],
    maxAttemptsPerDay: 1,
    minAttemptInterval: 60,
  };
}

export function defaultJobGroupName(tableName: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `营销-${tableName}-${stamp}`;
}

const api = {
  settings: endpoint(endpoints.AliyunCall_settings),
  saveSettings: endpoint(endpoints.AliyunCall_saveSettings),
  // 测试与目录都是一次请求里串多个阿里云接口，默认 30s 可能不够
  test: endpoint(endpoints.AliyunCall_test, { timeoutMs: 90000 }),
  instances: endpoint(endpoints.AliyunCall_instances, { timeoutMs: 60000 }),
  scripts: endpoint(endpoints.AliyunCall_scripts, { timeoutMs: 60000 }),
  callingNumbers: endpoint(endpoints.AliyunCall_callingNumbers, {
    timeoutMs: 60000,
  }),
  jobGroups: endpoint(endpoints.AliyunCall_jobGroups, { timeoutMs: 60000 }),
  jobGroupStatus: endpoint(endpoints.AliyunCall_jobGroupStatus, {
    timeoutMs: 60000,
  }),
  // 预览要整表读取并逐行校验（上限 2000 行）
  preview: endpoint(endpoints.AliyunCall_preview, { timeoutMs: 120000 }),
  createImport: endpoint(endpoints.AliyunCall_createImport),
  imports: endpoint(endpoints.AliyunCall_imports),
  importDetail: endpoint(endpoints.AliyunCall_import),
  retryImport: endpoint(endpoints.AliyunCall_retryImport),
  refreshImport: endpoint(endpoints.AliyunCall_refreshImport),
  tables: endpoint(endpoints.DataTable_list),
};

/** 取数：失败不抛错，交页面提示（与 bigdata-common / lead-common 同口径）。 */
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

export const aliyunCallApi = {
  settings: () => load<AliyunCallSettings>(api.settings({})),
  saveSettings: (body: {
    accessKeyId?: string;
    accessKeySecret?: string;
    region: string;
    instanceId: string;
  }) => mutate<AliyunCallSettings>(api.saveSettings({ body })),
  test: () => mutate<AliyunCallTestResult>(api.test({})),
  instances: () => load<AliyunCallInstance[]>(api.instances({})),
  scripts: (instanceId: string) =>
    load<AliyunCallScript[]>(api.scripts({ query: { instanceId } })),
  callingNumbers: (instanceId: string) =>
    load<AliyunCallNumber[]>(api.callingNumbers({ query: { instanceId } })),
  jobGroups: (input: {
    instanceId: string;
    search: string;
    page: number;
    pageSize: number;
  }) =>
    load<{
      list: AliyunJobGroup[];
      total: number;
      page: number;
      pageSize: number;
    }>(api.jobGroups({ query: input })),
  preview: (body: AliyunPreviewBody) =>
    mutate<AliyunPreview>(api.preview({ body })),
  createImport: (body: AliyunCreateImportBody) =>
    mutate<AliyunImport>(api.createImport({ body })),
  imports: (page: number, pageSize: number) =>
    load<{
      list: AliyunImport[];
      total: number;
      page: number;
      pageSize: number;
    }>(api.imports({ query: { page, pageSize } })),
  importDetail: (id: number, page: number, pageSize: number) =>
    mutate<AliyunImportDetail>(
      api.importDetail({
        params: { id: String(id) },
        query: { page, pageSize },
      }),
    ),
  retryImport: (id: number) =>
    mutate<AliyunImport>(
      api.retryImport({ params: { id: String(id) } }),
    ),
  refreshImport: (id: number) =>
    mutate<AliyunImport>(
      api.refreshImport({ params: { id: String(id) } }),
    ),
  tables: () => load<AliyunSourceTable[]>(api.tables({})),
};
