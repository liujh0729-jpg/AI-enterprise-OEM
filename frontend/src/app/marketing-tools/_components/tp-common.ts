import {
  TP_ACTION_LABELS,
  TP_DATASET_LABELS,
  TP_PRODUCT_LABELS,
  TP_STATUS_LABELS,
  dataTableFieldSchema,
  dataTableSchema,
  tpAccountSchema,
  tpCrmImportResultSchema,
  tpMappingSchema,
  tpRowsSchema,
  tpTaskDetailSchema,
  tpTaskPageSchema,
  tpTaskSchema,
  tpTestResultSchema,
  z,
} from "@enterprise/contracts";

/**
 * 腾讯企点营销云工具的界面层公共口径：类型、中文标签、取数与写操作的错误处理。
 * 三张卡（客户数据 / 企微运营 / 会员与触达）共用，同一动作只在这里解释一次。
 */

export type TpAccount = z.infer<typeof tpAccountSchema>;
export type TpTestResult = z.infer<typeof tpTestResultSchema>;
export type TpRows = z.infer<typeof tpRowsSchema>;
export type TpTask = z.infer<typeof tpTaskSchema>;
export type TpTaskPage = z.infer<typeof tpTaskPageSchema>;
export type TpTaskDetail = z.infer<typeof tpTaskDetailSchema>;
export type TpMapping = z.infer<typeof tpMappingSchema>;
export type TpCrmImportResult = z.infer<typeof tpCrmImportResultSchema>;
/** 企点返回的任意对象（详情、单对象写入的回应）。 */
export type TpObject = Record<string, unknown>;
/** 列映射：企点字段 ← 多维表格列键；导出结果时反过来＝结果表列 ← 企点字段。 */
export type TpColumnMap = Record<string, string>;
/** 名单来源的多维表格（列表接口已带回列与行数，不用再读单表）。 */
export type TpTable = z.infer<typeof dataTableSchema>;
export type TpField = z.infer<typeof dataTableFieldSchema>;

export {
  TP_ACTION_LABELS,
  TP_DATASET_LABELS,
  TP_PRODUCT_LABELS,
  TP_STATUS_LABELS,
  tpProducts,
} from "@enterprise/contracts";

/** 单次名单上限（花钱与真触达动作同用这一个闸，与后端 TP_MAX_ROWS 一致）。 */
export const TP_MAX_ROWS = 10_000;

/** 腾讯企点营销云控制台：平台里做不了/不代理的配置都在这里完成。 */
export const TP_CONSOLE_URL = "https://tmc.qidian.qq.com";

/** 花钱或真实触达的动作：提交前必须显示人数并勾选确认（与后端 COST_GATED 同清单）。 */
const COST_GATED_ACTIONS = new Set([
  "Tp_lmIssuePoints",
  "Tp_lmCouponIssue",
  "Tp_scrmSaveMassTask",
  "Tp_maMassSend",
  "Tp_rtaUploadAudience",
  "Tp_crmImport",
]);

export function isCostGatedAction(action: string): boolean {
  return COST_GATED_ACTIONS.has(action);
}

export const TP_STATUS_COLOR: Record<string, string> = {
  PENDING: "default",
  RUNNING: "processing",
  SUCCEEDED: "success",
  PARTIAL: "warning",
  FAILED: "error",
};

export function tpProductLabel(product: string): string {
  return TP_PRODUCT_LABELS[product] || product;
}

export function tpActionLabel(action: string): string {
  return TP_ACTION_LABELS[action] || action;
}

export function tpStatusLabel(status: string): string {
  return TP_STATUS_LABELS[status] || status;
}

export function tpDatasetLabel(key: string): string {
  return TP_DATASET_LABELS[key] || key;
}

/**
 * 各名单数据集的默认「企点字段」列名：只是把映射一次填满的起点，
 * 真实字段名以企点控制台/接口文档为准，可逐条改（联调阶段只改这一处默认值）。
 */
export const TP_MAPPING_FIELDS: Record<string, { key: string; label: string }[]> =
  {
    cdp_customer_import: [
      { key: "name", label: "客户名称" },
      { key: "mobile", label: "手机号" },
      { key: "province", label: "省份" },
      { key: "city", label: "城市" },
    ],
    cdp_tag_apply: [{ key: "oneid", label: "客户唯一标识 oneid" }],
    cdp_segment_create: [{ key: "oneid", label: "客户唯一标识 oneid" }],
    crm_customer_import: [
      { key: "name", label: "姓名或公司名" },
      { key: "industry", label: "行业" },
      { key: "province", label: "省份" },
      { key: "city", label: "城市" },
      { key: "remark", label: "备注" },
    ],
    lm_point_issue: [{ key: "memberId", label: "会员ID" }],
    lm_coupon_issue: [{ key: "memberId", label: "会员ID" }],
    ma_mass_send: [
      { key: "mobile", label: "手机号（短信）" },
      { key: "email", label: "邮箱（邮件）" },
    ],
    rta_audience_upload: [{ key: "mobile", label: "手机号" }],
    cdp_segment_export: [
      { key: "oneid", label: "客户唯一标识 oneid" },
      { key: "name", label: "客户名称" },
    ],
  };

/** 写入本系统 CRM 只能落这些列（与后端 CRM 客户导入的可写字段一致）。 */
export const TP_CRM_IMPORT_FIELDS: {
  key: string;
  label: string;
  required?: boolean;
}[] = [
  { key: "name", label: "客户名称", required: true },
  { key: "industry", label: "行业" },
  { key: "province", label: "省份" },
  { key: "city", label: "城市" },
  { key: "remark", label: "备注" },
];

/** 批量动作的受理文案：接口没回任务时也不吞掉提交成功这件事。 */
export function taskText(task: { id: number } | null): string {
  return task ? `已受理任务 #${task.id}` : "已受理，请在任务台账查看";
}

/** 取数：失败不抛错，交页面提示（与 aliyun-mail / bigdata 同口径）。 */
export async function load<T>(work: Promise<T>): Promise<{
  data: T | null;
  message: string;
}> {
  try {
    return { data: await work, message: "" };
  } catch (error) {
    return { data: null, message: (error as Error).message || "加载失败" };
  }
}

/** 企点行的键集合：按前若干行的并集出表头，避免某一行的额外键撑爆列。 */
export function tpRowKeys(rows: TpObject[], sample = 20): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(0, sample)) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** 单元格值收成一行文本；对象与数组收成紧凑 JSON，超过长度交给展开查看。 */
export function tpCellText(value: unknown, limit = 120): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const json = JSON.stringify(value);
  return json.length > limit ? `${json.slice(0, limit)}…` : json;
}

/** 从企点行里按候选键取第一个非空值（ID、名称这类字段各产品写法不同）。 */
export function tpPick(row: TpObject, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") {
      return tpCellText(value, 60);
    }
  }
  return "";
}

export const TP_ID_KEYS = ["id", "codeId", "taskId", "crowdId", "memberId", "cardId", "oneid"];
export const TP_NAME_KEYS = ["name", "title", "crowdName", "labelName", "codeName", "senderName"];

/** 该产品的凭据里可用的那些（未配置时界面只给一句去设置页的指引）。 */
export function tpActiveAccounts(
  accounts: TpAccount[],
  product: string,
): TpAccount[] {
  return accounts.filter(
    (item) => item.product === product && item.status === "active",
  );
}

export function tpAccountText(account: TpAccount): string {
  const name = account.label || account.corporationId;
  return `${name} · 空间 ${account.bizId}`;
}
