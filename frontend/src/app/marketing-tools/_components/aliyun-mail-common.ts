import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/**
 * 阿里云邮件推送的界面层：选多维表格 → 映射邮箱列与模板变量 → 新建/追加收件人列表 →
 * 分批把联系人交给阿里云 Direct Mail。后端 /enterprise/aliyun-mail/*（登录态），
 * AK 按登录账号各自配置；模板、发信域名与真正发送都不在本系统。
 */

export type AliyunMailSettings = {
  configured: boolean;
  accessKeyIdMasked: string;
  hasAccessKeySecret: boolean;
  region: string;
  defaultReceiverId: string;
  defaultReceiverName: string;
  updatedAt: string;
};

export type AliyunMailVariable = { key: string; fieldKey: string };

export type AliyunMailMapping = {
  emailFieldKey: string;
  variables: AliyunMailVariable[];
  writeBack: boolean;
};

export type AliyunMailSender = {
  accountName: string;
  mailAddressId: string;
  accountStatus: string;
  domainStatus: string;
  /** batch=批量（群发用） / trigger=触发 */
  sendType: string;
  dailyCount: number;
  dailyReqCount: number;
  monthCount: number;
  monthReqCount: number;
  createTime: string;
};

export type AliyunMailReceiver = {
  receiverId: string;
  receiverName: string;
  receiverAlias: string;
  count: number;
  createTime: string;
};

export type AliyunMailTestResult = {
  ok: boolean;
  receiverCount: number;
  messages: string[];
};

export type AliyunMailPreviewRow = {
  sourceRowId: number;
  emailMasked: string;
  variables: { key: string; value: string }[];
  /** ok | invalid | duplicate | existing | overflow */
  status: string;
  message: string;
};

export type AliyunMailPreview = {
  fields: { fieldKey: string; name: string; fieldType: string }[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  existingRows: number;
  overflowRows: number;
  currentCount: number;
  capacity: number;
  sample: AliyunMailPreviewRow[];
  errors: string[];
};

export type AliyunMailImportRow = {
  id: number;
  sourceRowId: number;
  emailMasked: string;
  status: string;
  errorCode: string;
  errorMessage: string;
};

export type AliyunMailImport = {
  id: number;
  mode: string;
  tableId: number;
  tableName: string;
  receiverId: string;
  receiverName: string;
  status: string;
  totalRows: number;
  sentRows: number;
  failedRows: number;
  skippedRows: number;
  errorCode: string;
  errorMessage: string;
  listCount: number;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AliyunMailImportDetail = AliyunMailImport & {
  mapping: Record<string, unknown>;
  rows: AliyunMailImportRow[];
  rowTotal: number;
  rowPage: number;
  rowPageSize: number;
};

export type AliyunMailSourceTable = {
  id: number;
  name: string;
  owner: boolean;
  rowCount: number;
  can: { read: boolean; create: boolean; update: boolean; delete: boolean };
  fields: { fieldKey: string; name: string; fieldType: string }[];
};

export type AliyunMailTarget = {
  mode: "new" | "append";
  receiverId: string;
  receiverName: string;
  receiverAlias: string;
  description: string;
};

export type AliyunMailPreviewBody = {
  tableId: number;
  mapping: AliyunMailMapping;
} & AliyunMailTarget;

export type AliyunMailCreateImportBody = AliyunMailPreviewBody;

/** 邮件推送按地域区分 Endpoint，必须与控制台区域一致（悉尼已关停）。 */
export const DIRECTMAIL_REGIONS = [
  { value: "cn-hangzhou", label: "华东 1（杭州）" },
  { value: "ap-southeast-1", label: "新加坡" },
  { value: "us-east-1", label: "美国（弗吉尼亚）" },
  { value: "eu-central-1", label: "德国（法兰克福）" },
];

/** 单个收件人列表最多 10000 个地址（阿里云账号级硬限）。 */
export const RECEIVER_CAPACITY = 10000;
/** 变量名只能是英文字母（与阿里云模板占位符一致）。 */
export const VARIABLE_KEY_PATTERN = /^[A-Za-z]+$/;
export const MAX_VARIABLES = 50;

export const CONSOLE_URL = "https://dm.console.aliyun.com";

export const IMPORT_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "同步中",
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

/** 批次行状态：pending 待提交 / success 已同步 / duplicate 已存在 / failed 失败 / skipped 跳过。 */
export const ROW_STATUS_LABEL: Record<string, string> = {
  pending: "待提交",
  success: "已同步",
  duplicate: "已存在",
  failed: "同步失败",
  skipped: "已跳过",
};

export const ROW_STATUS_COLOR: Record<string, string> = {
  pending: "default",
  success: "success",
  duplicate: "processing",
  failed: "error",
  skipped: "warning",
};

export const PREVIEW_STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: "可提交", color: "success" },
  invalid: { label: "邮箱无效", color: "error" },
  duplicate: { label: "表内重复", color: "warning" },
  existing: { label: "已推送跳过", color: "processing" },
  overflow: { label: "超出容量", color: "warning" },
};

export function emptyMapping(): AliyunMailMapping {
  return { emailFieldKey: "", variables: [], writeBack: true };
}

/** 发信地址状态：0＝正常；其余按控制台口径给中文，不猜具体含义。 */
export function senderAddressProblem(sender: AliyunMailSender): string {
  if (sender.accountStatus !== "0") return "发信地址状态异常";
  if (sender.domainStatus !== "0") return "发信域名未验证通过";
  return "";
}

const api = {
  settings: endpoint(endpoints.AliyunMail_settings),
  saveSettings: endpoint(endpoints.AliyunMail_saveSettings),
  // 测试与目录是一次请求里串多个阿里云接口
  test: endpoint(endpoints.AliyunMail_test, { timeoutMs: 60000 }),
  senderAddresses: endpoint(endpoints.AliyunMail_senderAddresses, {
    timeoutMs: 60000,
  }),
  receiverLists: endpoint(endpoints.AliyunMail_receiverLists, {
    timeoutMs: 60000,
  }),
  createReceiverList: endpoint(endpoints.AliyunMail_createReceiverList, {
    timeoutMs: 60000,
  }),
  // 预览要整表读取并逐行校验（上限 10000 行）
  preview: endpoint(endpoints.AliyunMail_preview, { timeoutMs: 180000 }),
  createImport: endpoint(endpoints.AliyunMail_createImport, {
    timeoutMs: 180000,
  }),
  imports: endpoint(endpoints.AliyunMail_imports),
  importDetail: endpoint(endpoints.AliyunMail_import),
  retryImport: endpoint(endpoints.AliyunMail_retryImport),
  refreshImport: endpoint(endpoints.AliyunMail_refreshImport),
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

export const aliyunMailApi = {
  settings: () => load<AliyunMailSettings>(api.settings({})),
  saveSettings: (body: {
    accessKeyId?: string;
    accessKeySecret?: string;
    region: string;
    /** 不传＝保持已保存的默认列表（与其他设置「只发改动项」同口径）。 */
    defaultReceiverId?: string;
    defaultReceiverName?: string;
  }) => mutate<AliyunMailSettings>(api.saveSettings({ body })),
  test: () => mutate<AliyunMailTestResult>(api.test({})),
  senderAddresses: () => load<AliyunMailSender[]>(api.senderAddresses({})),
  receiverLists: (keyWord: string) =>
    load<AliyunMailReceiver[]>(api.receiverLists({ query: { keyWord } })),
  createReceiverList: (body: {
    receiverName: string;
    receiverAlias: string;
    description: string;
  }) => mutate<AliyunMailReceiver>(api.createReceiverList({ body })),
  preview: (body: AliyunMailPreviewBody) =>
    mutate<AliyunMailPreview>(api.preview({ body })),
  createImport: (body: AliyunMailCreateImportBody) =>
    mutate<AliyunMailImport>(api.createImport({ body })),
  imports: (page: number, pageSize: number) =>
    load<{
      list: AliyunMailImport[];
      total: number;
      page: number;
      pageSize: number;
    }>(api.imports({ query: { page, pageSize } })),
  importDetail: (id: number, page: number, pageSize: number) =>
    mutate<AliyunMailImportDetail>(
      api.importDetail({
        params: { id: String(id) },
        query: { page, pageSize },
      }),
    ),
  retryImport: (id: number) =>
    mutate<AliyunMailImport>(api.retryImport({ params: { id: String(id) } })),
  refreshImport: (id: number) =>
    mutate<AliyunMailImport>(api.refreshImport({ params: { id: String(id) } })),
  tables: () => load<AliyunMailSourceTable[]>(api.tables({})),
};
