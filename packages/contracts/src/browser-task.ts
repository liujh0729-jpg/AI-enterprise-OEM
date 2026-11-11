import { z } from "zod";
import {
  EXTENSION_CAPABILITY_KEYS,
  EXTENSION_EVIDENCE_KINDS,
  extensionCapabilityDefOf,
} from "./extension";

/**
 * 平台统一浏览器插件（AIPDD Enterprise）的统一通信协议（设计方案 §10.7 / §10.10）。
 *
 * 页面只发「能力标识 + 动作 + 参数」，不发任意脚本；插件只执行已登记动作，拒绝未知能力；
 * 回执统一携带「状态 + 结果 + 证据 + 错误码 + 版本」。分发、获客等能力不再各写一套
 * postMessage 消息名与回执格式，统一走本信封；存量旧消息名由前端桥接层做兼容适配。
 */

/** 协议版本：页面与插件握手时比对；插件未上报＝旧版，走兼容适配层。 */
export const BROWSER_TASK_PROTOCOL_VERSION = 2;

/**
 * 协议能力协商位：v2 起新增浏览器代理（侧边栏 Agent）。
 * 页面/插件握手时逐个比对，缺哪个能力就回落旧链路，不因为多出能力就整体降级。
 */
export const BROWSER_TASK_PROTOCOL_CAPABILITIES = [
  "task:envelope",
  "chrome:agent",
] as const;
export type BrowserTaskProtocolCapability =
  (typeof BROWSER_TASK_PROTOCOL_CAPABILITIES)[number];

/* ---------------------------------------------------------------- 回执状态 */

/** 统一任务状态口径：接单 / 执行中 / 成功 / 部分成功 / 失败 / 结果未知。 */
export const BROWSER_RECEIPT_STATUSES = [
  "ACCEPTED",
  "RUNNING",
  "SUCCESS",
  "PARTIAL",
  "FAILED",
  "UNKNOWN",
] as const;
export type BrowserReceiptStatus = (typeof BROWSER_RECEIPT_STATUSES)[number];
export const BROWSER_RECEIPT_STATUS_LABELS: Record<string, string> = {
  ACCEPTED: "已接单",
  RUNNING: "执行中",
  SUCCESS: "已完成",
  PARTIAL: "部分完成",
  FAILED: "失败",
  UNKNOWN: "结果未知",
};

/* ---------------------------------------------------------------- 逐条结果口径 */

/**
 * 逐条目/逐平台结果口径（设计方案 §17「已填充、已提交、已核实发布结果严格区分」）：
 * FILLED＝已填充待人工确认，SUBMITTED＝已提交但结果未核实，VERIFIED＝已核实发布结果，
 * FAILED＝执行失败，SKIPPED＝因前置失败/风控跳过。信封状态由这些结果汇总而来。
 */
export const BROWSER_RESULT_STATUSES = [
  "FILLED",
  "SUBMITTED",
  "VERIFIED",
  "FAILED",
  "SKIPPED",
] as const;
export type BrowserResultStatus = (typeof BROWSER_RESULT_STATUSES)[number];
export const BROWSER_RESULT_STATUS_LABELS: Record<string, string> = {
  FILLED: "已填充待确认",
  SUBMITTED: "已提交待核实",
  VERIFIED: "已核实发布",
  FAILED: "失败",
  SKIPPED: "已跳过",
};

/** 该结果是否算「业务已成功」（已提交或已核实）。仅填充待确认不计入成功。 */
export function browserResultSucceeded(status: string): boolean {
  return status === "SUBMITTED" || status === "VERIFIED";
}

/**
 * 由逐条结果汇总信封状态：无结果＝ACCEPTED（仅接单）；全部成功＝SUCCESS；
 * 全部失败＝FAILED；其余（部分成功/仅填充/含跳过）＝PARTIAL。
 */
export function aggregateBrowserReceiptStatus(
  results: readonly { status?: unknown }[],
): BrowserReceiptStatus {
  const statuses = results
    .map((item) => String(item?.status ?? ""))
    .filter((status) => status !== "");
  if (statuses.length === 0) return "ACCEPTED";
  const ok = statuses.filter(browserResultSucceeded).length;
  if (ok === statuses.length) return "SUCCESS";
  if (ok === 0 && statuses.every((status) => status === "FAILED")) return "FAILED";
  return "PARTIAL";
}

/* ---------------------------------------------------------------- 错误码 */

/**
 * 跨能力复用的统一错误码：页面据此决定提示文案与是否重试。
 * 风控类（NEED_LOGIN / CAPTCHA / RISK_CONTROL）一律停止并回报，不自动重试。
 */
export const BROWSER_TASK_ERROR_CODES = [
  "PLUGIN_UNRESPONSIVE",
  "PROTOCOL_MISMATCH",
  "UNKNOWN_CAPABILITY",
  "UNSUPPORTED_ACTION",
  "TASK_REJECTED",
  "UNTRUSTED_SITE",
  "NEED_LOGIN",
  "CAPTCHA",
  "RISK_CONTROL",
  "PLATFORM_CHANGED",
  "TIMEOUT",
  "UNKNOWN_RESULT",
  "CANCELLED",
  "INTERNAL",
] as const;
export type BrowserTaskErrorCode = (typeof BROWSER_TASK_ERROR_CODES)[number];
export const BROWSER_TASK_ERROR_LABELS: Record<string, string> = {
  PLUGIN_UNRESPONSIVE: "插件未响应",
  PROTOCOL_MISMATCH: "插件协议版本不兼容",
  UNKNOWN_CAPABILITY: "插件不支持该能力",
  UNSUPPORTED_ACTION: "插件不支持该动作",
  TASK_REJECTED: "任务被插件拒绝",
  UNTRUSTED_SITE: "该站点不在该能力的执行范围内",
  NEED_LOGIN: "目标平台需重新登录",
  CAPTCHA: "遇到验证码，需人工处理",
  RISK_CONTROL: "目标平台触发风控",
  PLATFORM_CHANGED: "目标平台页面结构变化",
  TIMEOUT: "执行超时",
  UNKNOWN_RESULT: "结果未知，请人工核对",
  CANCELLED: "已取消",
  INTERNAL: "插件内部错误",
};

/** 该错误码是否应停止任务并等待人工处理（不自动重试）。 */
export function browserErrorStopsTask(code: string): boolean {
  return (
    code === "NEED_LOGIN" ||
    code === "CAPTCHA" ||
    code === "RISK_CONTROL" ||
    code === "UNTRUSTED_SITE"
  );
}

/* ---------------------------------------------------------------- 任务生命周期（服务端持久队列） */

/**
 * 服务端浏览器任务的生命周期状态（设计 §10.3）：服务器创建 → 插件认领 → 执行中 → 终态。
 * QUEUED＝待执行，CLAIMED＝已认领（持租约），RUNNING＝执行中，
 * SUCCEEDED / PARTIAL / FAILED / UNKNOWN 为执行终态（由回执汇总），
 * CANCELLED＝业务侧取消（内容删除/改派），EXPIRED＝队列超时或租约耗尽后放弃。
 */
export const BROWSER_TASK_LIFECYCLE_STATUSES = [
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "UNKNOWN",
  "CANCELLED",
  "EXPIRED",
] as const;
export type BrowserTaskLifecycleStatus =
  (typeof BROWSER_TASK_LIFECYCLE_STATUSES)[number];
export const BROWSER_TASK_LIFECYCLE_LABELS: Record<string, string> = {
  QUEUED: "待执行",
  CLAIMED: "已认领",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  PARTIAL: "部分完成",
  FAILED: "失败",
  UNKNOWN: "结果未知",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
};

/** 该生命周期状态是否已是终态（终态不再被认领/回执，可作对账依据）。 */
export function browserTaskTerminal(status: string): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "PARTIAL" ||
    status === "FAILED" ||
    status === "UNKNOWN" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  );
}

/**
 * 回执口径 → 任务终态：ACCEPTED / RUNNING 表示尚未有结论（返回 null，不终结任务）；
 * 其余按 SUCCESS / PARTIAL / FAILED / UNKNOWN 一一对应。
 */
export function receiptStatusToTaskStatus(
  status: string,
): BrowserTaskLifecycleStatus | null {
  switch (status) {
    case "SUCCESS":
      return "SUCCEEDED";
    case "PARTIAL":
      return "PARTIAL";
    case "FAILED":
      return "FAILED";
    case "UNKNOWN":
      return "UNKNOWN";
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- 能力动作校验 */

/** 某能力已登记的动作 key 清单（来自统一能力目录）。 */
export function browserCapabilityActions(key: string): string[] {
  return extensionCapabilityDefOf(key)?.actions.map((action) => action.key) ?? [];
}

/** 校验「能力 + 动作」是否为已登记组合：插件据此拒绝未知能力/动作。 */
export function isBrowserCapabilityAction(key: string, action: string): boolean {
  return browserCapabilityActions(key).includes(action);
}

/**
 * 按能力目录校验动作入参：必填字段缺失/类型不符即返回错误文案，服务端派发前统一拦。
 * 只校验声明过的字段，未声明的参数不阻断（能力可自行扩展可选参数）。
 */
export function validateBrowserActionPayload(
  key: string,
  action: string,
  payload: Record<string, unknown>,
): string | null {
  const def = extensionCapabilityDefOf(key)?.actions.find(
    (item) => item.key === action,
  );
  if (!def) return '未登记的插件能力动作';
  for (const [field, spec] of Object.entries(def.input)) {
    const value = payload[field];
    const missing =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);
    if (spec.required && missing) return `缺少必填参数：${field}`;
    if (missing) continue;
    const typeOk =
      spec.type === 'number'
        ? typeof value === 'number'
        : spec.type === 'string'
          ? typeof value === 'string'
          : spec.type === 'string[]'
            ? Array.isArray(value)
            : typeof value === 'object';
    if (!typeOk) return `参数类型不正确：${field}`;
  }
  return null;
}

/* ---------------------------------------------------------------- 任务信封（页面 → 插件） */

/** 统一任务信封：只携带能力/动作/参数与执行上下文，不允许下发脚本。 */
export const browserTaskSchema = z.object({
  protocolVersion: z.number().int().positive(),
  capability: z.enum(EXTENSION_CAPABILITY_KEYS),
  action: z.string().min(1).max(40),
  jobId: z.string().min(1).max(80),
  /** 目标平台（能力相关）；缺省＝该能力支持的全部平台。 */
  platforms: z.array(z.string().max(40)).max(64).optional(),
  /** 业务来源（页面路径或业务单据号）：用于审计与回执关联。 */
  source: z.string().max(120).optional(),
  /** 组织归属（缺省＝用户级）。 */
  orgUserId: z.string().max(64).optional(),
  /** 一次性执行凭证：随任务透传，插件不持久化。 */
  token: z.string().max(200).optional(),
  /** 能力相关参数：结构由能力定义，服务端与插件按能力解释。 */
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type BrowserTask = z.infer<typeof browserTaskSchema>;

/* ---------------------------------------------------------------- 回执信封（插件 → 页面） */

/** 一条完成证据（结果链接 / 截图 / 文本 / 指标）。 */
export const browserEvidenceSchema = z.object({
  kind: z.enum(EXTENSION_EVIDENCE_KINDS),
  value: z.string().max(2000).default(""),
  note: z.string().max(500).default(""),
});
export type BrowserEvidence = z.infer<typeof browserEvidenceSchema>;

/** 统一回执信封：状态、逐条结果、证据、错误码与插件版本。 */
export const browserReceiptSchema = z.object({
  protocolVersion: z.number().int().positive(),
  capability: z.enum(EXTENSION_CAPABILITY_KEYS),
  action: z.string().min(1).max(40),
  jobId: z.string().min(1).max(80),
  status: z.enum(BROWSER_RECEIPT_STATUSES),
  code: z.string().max(40).default(""),
  message: z.string().max(500).default(""),
  /** 逐条目/逐平台结果：结构由能力定义，页面按能力落库。 */
  results: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
  evidence: z.array(browserEvidenceSchema).max(200).default([]),
  /**
   * 能力回执数据：能力自定义的成功口径（如获客的 runId / 新增线索数 / 触达状态）。
   * 放这里而不是塞进 results，避免「逐条结果」被业务元数据污染。
   */
  data: z.record(z.string(), z.unknown()).default({}),
  pluginVersion: z.string().max(20).default(""),
  at: z.string().max(40).default(""),
});
export type BrowserReceipt = z.infer<typeof browserReceiptSchema>;

/** 构造一条回执信封的最小完整形态（插件与测试共用，补齐默认值）。 */
export function browserReceipt(input: {
  capability: string;
  action: string;
  jobId: string;
  status?: BrowserReceiptStatus;
  code?: string;
  message?: string;
  results?: Record<string, unknown>[];
  evidence?: BrowserEvidence[];
  data?: Record<string, unknown>;
  pluginVersion?: string;
  at?: string;
}): BrowserReceipt {
  const results = input.results ?? [];
  return browserReceiptSchema.parse({
    protocolVersion: BROWSER_TASK_PROTOCOL_VERSION,
    capability: input.capability,
    action: input.action,
    jobId: input.jobId,
    status: input.status ?? aggregateBrowserReceiptStatus(results),
    code: input.code ?? "",
    message: input.message ?? "",
    results,
    evidence: input.evidence ?? [],
    data: input.data ?? {},
    pluginVersion: input.pluginVersion ?? "",
    at: input.at ?? new Date().toISOString(),
  });
}
