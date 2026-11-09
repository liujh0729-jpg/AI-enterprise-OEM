"use client";

import {
  ACQ_BUSINESS_STATUS_LABELS,
  ACQ_EVIDENCE_SOURCE_LABELS,
  ACQ_FOLLOW_UP_STATUS_LABELS,
  ACQ_FOLLOW_UP_TIME_RULES,
  ACQ_INTENT_LEVEL_LABELS,
  ACQ_LEAD_STATUS_LABELS,
  ACQ_OUTREACH_ACTION_LABELS,
  ACQ_OUTREACH_CHANNEL_LABELS,
  ACQ_OUTREACH_STATUS_LABELS,
  ACQ_PLATFORM_LABELS,
  ACQ_PLATFORMS,
  ACQ_PLAYBOOK_STATUS_LABELS,
  ACQ_PLUGIN_STOP_LABELS,
  ACQ_PROFILE_EVENT_LABELS,
  ACQ_QC_DIMENSIONS,
  ACQ_RECEIPT_STATUS_LABELS,
  ACQ_RUN_STATUS_LABELS,
  ACQ_SOURCE_MODE_LABELS,
  ACQ_SOURCE_MODES,
  acqDashboardSchema,
  acqFollowUpSchema,
  acqIntentScoreSchema,
  acqLeadDetailSchema,
  acqLeadSchema,
  acqMetaSchema,
  acqOutreachSchema,
  acqPlaybookSchema,
  acqPlaybookVersionSchema,
  acqPluginTokenSchema,
  acqProfileDetailSchema,
  acqProfileSchema,
  acqQcReviewSchema,
  acqRunSchema,
  acqSettingsSchema,
  acqSourceSchema,
  endpoints,
  z,
} from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";
import {
  isTrustedExtensionMessage,
  pingExtension,
} from "./distribution-common";

/**
 * AI 获客界面层：业务数据走 /enterprise/acquisition/*（登录态）；
 * 采集/触达由 AIPDD Enterprise 插件在用户本机已登录的平台页执行，
 * 页面只负责签发 5 分钟令牌、启动任务、续期与展示进度。
 * 协议与插件 bridge.js / acquisition.js 保持同一份（见 extensions/aipdd-enterprise/README.md）。
 */

export type AcqSource = z.infer<typeof acqSourceSchema>;
export type AcqRun = z.infer<typeof acqRunSchema>;
export type AcqLead = z.infer<typeof acqLeadSchema>;
export type AcqLeadDetail = z.infer<typeof acqLeadDetailSchema>;
export type AcqIntentScore = z.infer<typeof acqIntentScoreSchema>;
export type AcqOutreach = z.infer<typeof acqOutreachSchema>;
export type AcqProfile = z.infer<typeof acqProfileSchema>;
export type AcqProfileDetail = z.infer<typeof acqProfileDetailSchema>;
export type AcqPlaybook = z.infer<typeof acqPlaybookSchema>;
export type AcqPlaybookVersion = z.infer<typeof acqPlaybookVersionSchema>;
export type AcqFollowUp = z.infer<typeof acqFollowUpSchema>;
export type AcqQcReview = z.infer<typeof acqQcReviewSchema>;
export type AcqDashboard = z.infer<typeof acqDashboardSchema>;
export type AcqMeta = z.infer<typeof acqMetaSchema>;
export type AcqSettings = z.infer<typeof acqSettingsSchema>;
export type AcqPluginToken = z.infer<typeof acqPluginTokenSchema>;

export const acqApi = {
  sources: endpoint(endpoints.Acquisition_sources),
  saveSource: endpoint(endpoints.Acquisition_saveSource),
  removeSource: endpoint(endpoints.Acquisition_removeSource),
  runSource: endpoint(endpoints.Acquisition_runSource),
  runs: endpoint(endpoints.Acquisition_runs),
  runDetail: endpoint(endpoints.Acquisition_runDetail),
  leads: endpoint(endpoints.Acquisition_leads),
  leadDetail: endpoint(endpoints.Acquisition_leadDetail),
  updateLead: endpoint(endpoints.Acquisition_updateLead),
  scoreLead: endpoint(endpoints.Acquisition_scoreLead),
  promoteLead: endpoint(endpoints.Acquisition_promoteLead),
  leadsToTable: endpoint(endpoints.Acquisition_leadsToTable),
  exportLeads: endpoint(endpoints.Acquisition_exportLeads),
  outreach: endpoint(endpoints.Acquisition_outreach),
  createOutreach: endpoint(endpoints.Acquisition_createOutreach),
  approveOutreach: endpoint(endpoints.Acquisition_approveOutreach),
  cancelOutreach: endpoint(endpoints.Acquisition_cancelOutreach),
  outreachLogs: endpoint(endpoints.Acquisition_outreachLogs),
  profiles: endpoint(endpoints.Acquisition_profiles),
  profileDetail: endpoint(endpoints.Acquisition_profileDetail),
  updateProfile: endpoint(endpoints.Acquisition_updateProfile),
  profileEvents: endpoint(endpoints.Acquisition_profileEvents),
  playbooks: endpoint(endpoints.Acquisition_playbooks),
  savePlaybook: endpoint(endpoints.Acquisition_savePlaybook),
  publishPlaybook: endpoint(endpoints.Acquisition_publishPlaybook),
  playbookVersions: endpoint(endpoints.Acquisition_playbookVersions),
  playbookPreview: endpoint(endpoints.Acquisition_playbookPreview),
  followUps: endpoint(endpoints.Acquisition_followUps),
  createFollowUp: endpoint(endpoints.Acquisition_createFollowUp),
  cancelFollowUp: endpoint(endpoints.Acquisition_cancelFollowUp),
  completeFollowUp: endpoint(endpoints.Acquisition_completeFollowUp),
  pluginToken: endpoint(endpoints.Acquisition_pluginToken),
  qcReviews: endpoint(endpoints.Acquisition_qcReviews),
  runQc: endpoint(endpoints.Acquisition_runQc),
  qcDetail: endpoint(endpoints.Acquisition_qcDetail),
  dashboard: endpoint(endpoints.Acquisition_dashboard),
  dashboardExport: endpoint(endpoints.Acquisition_dashboardExport),
  dashboardShare: endpoint(endpoints.Acquisition_dashboardShare),
  settings: endpoint(endpoints.Acquisition_settings),
  saveSettings: endpoint(endpoints.Acquisition_saveSettings),
  meta: endpoint(endpoints.Acquisition_meta),
};

// ---------- 展示文案 ----------

export const platformLabel = (key: string) =>
  ACQ_PLATFORM_LABELS[key] ?? key;
export const sourceModeLabel = (key: string) =>
  ACQ_SOURCE_MODE_LABELS[key] ?? key;
export const runStatusLabel = (key: string) =>
  ACQ_RUN_STATUS_LABELS[key] ?? key;
export const intentLevelLabel = (key: string) =>
  ACQ_INTENT_LEVEL_LABELS[key] ?? key;
export const leadStatusLabel = (key: string) =>
  ACQ_LEAD_STATUS_LABELS[key] ?? key;
export const evidenceSourceLabel = (key: string) =>
  ACQ_EVIDENCE_SOURCE_LABELS[key] ?? key;
export const outreachChannelLabel = (key: string) =>
  ACQ_OUTREACH_CHANNEL_LABELS[key] ?? key;
export const outreachActionLabel = (key: string) =>
  ACQ_OUTREACH_ACTION_LABELS[key] ?? key;
export const outreachStatusLabel = (key: string) =>
  ACQ_OUTREACH_STATUS_LABELS[key] ?? key;
export const receiptStatusLabel = (key: string) =>
  ACQ_RECEIPT_STATUS_LABELS[key] ?? key;
export const businessStatusLabel = (key: string) =>
  ACQ_BUSINESS_STATUS_LABELS[key] ?? key;
export const playbookStatusLabel = (key: string) =>
  ACQ_PLAYBOOK_STATUS_LABELS[key] ?? key;
export const profileEventLabel = (key: string) =>
  ACQ_PROFILE_EVENT_LABELS[key] ?? key;
export const followUpStatusLabel = (key: string) =>
  ACQ_FOLLOW_UP_STATUS_LABELS[key] ?? key;
export const stopReasonLabel = (key: string) =>
  ACQ_PLUGIN_STOP_LABELS[key] ?? key;
export const followUpTimeRuleLabel = (key: string) =>
  ACQ_FOLLOW_UP_TIME_RULES.find((rule) => rule.key === key)?.label ??
  key;

export const platformOptions = ACQ_PLATFORMS.map((value) => ({
  value,
  label: platformLabel(value),
}));
export const sourceModeOptions = ACQ_SOURCE_MODES.map((value) => ({
  value,
  label: sourceModeLabel(value),
}));
export const followUpTimeRuleOptions = ACQ_FOLLOW_UP_TIME_RULES.map((rule) => ({
  value: rule.key,
  label: rule.label,
}));
export const qcDimensionLabel = (key: string) =>
  ACQ_QC_DIMENSIONS.find((dimension) => dimension.key === key)?.label ?? key;

/** 线索状态 → 标签色。 */
export const LEAD_STATUS_COLOR: Record<string, string> = {
  NEW: "default",
  CONTACTED: "processing",
  REPLIED: "cyan",
  QUALIFIED: "gold",
  PROMOTED: "success",
  IGNORED: "default",
};
export const INTENT_COLOR: Record<string, string> = {
  HOT: "red",
  WARM: "orange",
  COLD: "default",
};
export const OUTREACH_STATUS_COLOR: Record<string, string> = {
  DRAFT: "default",
  APPROVED: "blue",
  QUEUED: "processing",
  SENDING: "processing",
  SENT: "success",
  FAILED: "error",
  CANCELLED: "default",
  SKIPPED: "warning",
};
export const RUN_STATUS_COLOR: Record<string, string> = {
  QUEUED: "default",
  CLAIMED: "processing",
  RUNNING: "processing",
  DONE: "success",
  PARTIAL: "warning",
  FAILED: "error",
};

export const fmtPct = (value: number): string => `${(value * 100).toFixed(1)}%`;
export const fmtPoints = (value: number): string =>
  value ? value.toLocaleString("zh-CN") : "0";

/** 把多行/逗号分隔输入拆成字符串数组（监控源关键词、排除词等共用）。 */
export function splitTerms(raw: string): string[] {
  return raw
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// ---------- 浏览器插件 ----------

export type AcqTaskType = "collect" | "outreach";

/**
 * 插件请求的后端基址：同源 + /api/backend。
 * 线上 Nginx 只把 /api/* 转给 Hono，插件不能直接打 /enterprise/*。
 */
export function acqApiBase(): string {
  return `${window.location.origin}/api/backend`;
}

export type AcqState = {
  phase: string;
  taskType: string;
  jobId: string;
  done: number;
  total: number;
  newLeads: number;
  needToken: boolean;
  message: string;
  version?: string;
};

export type AcqEvent =
  | { type: "acq-state"; state: AcqState }
  | { type: "harvest"; runId: number; items: unknown[]; done: boolean; newLeads: number; status: string; stopReason: string; error: string }
  | { type: "outreach-result"; outreachId: number; status: string; receipt: string; receiptRef: string; stopReason: string; error: string }
  | { type: "acq-unknown"; runId: number; outreachId: number; error: string };

export { pingExtension };

function randomJobId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 发一条指令并等插件应答（accepted 同 jobId）。 */
function sendAcqCommand(
  type: string,
  payload: Record<string, unknown>,
  timeoutMs = 8000,
  jobId = randomJobId(type),
): Promise<{ ok: boolean; errorMsg: string; state: AcqState | null; jobId: string }> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedExtensionMessage(event)) return;
      const data = event.data as Record<string, unknown>;
      if (data.type !== "accepted" || data.jobId !== jobId) return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve({
        ok: Boolean(data.ok),
        errorMsg: String(data.errorMsg || ""),
        state: (data.state as AcqState | null) ?? null,
        jobId,
      });
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, errorMsg: "插件没有在限定时间内应答", state: null, jobId });
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "aipdd-page", type, jobId, payload },
      window.location.origin,
    );
  });
}

/** 启动采集/触达循环：payload 只需 apiBase + token（任务由服务端 pull 下发）。 */
export function startAcqTask(type: AcqTaskType, token: string) {
  return sendAcqCommand(type, { apiBase: acqApiBase(), token }, 15000);
}

/** 令牌续期：只换令牌，不重启任务、不丢已采结果。 */
export function renewAcqToken(token: string) {
  return sendAcqCommand("acq-token", { token }, 8000);
}

export function controlAcq(action: "pause" | "stop") {
  return sendAcqCommand("acq-control", { action }, 8000);
}

export function queryAcqStatus() {
  return sendAcqCommand("acq-status", {}, 5000);
}

/** 订阅插件推送的获客事件（进度、增量结果、结果未知）；返回取消订阅函数。 */
export function onAcqEvent(handler: (event: AcqEvent) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isTrustedExtensionMessage(event)) return;
    const data = event.data as Record<string, unknown>;
    const type = String(data.type || "");
    if (type === "acq-state") {
      handler({ type, state: data as AcqState });
      return;
    }
    if (type === "harvest") {
      handler({
        type,
        runId: Number(data.runId) || 0,
        items: Array.isArray(data.items) ? data.items : [],
        done: Boolean(data.done),
        newLeads: Number(data.newLeads) || 0,
        status: String(data.status || ""),
        stopReason: String(data.stopReason || ""),
        error: String(data.error || ""),
      });
      return;
    }
    if (type === "outreach-result") {
      handler({
        type,
        outreachId: Number(data.outreachId) || 0,
        status: String(data.status || ""),
        receipt: String(data.receipt || ""),
        receiptRef: String(data.receiptRef || ""),
        stopReason: String(data.stopReason || ""),
        error: String(data.error || ""),
      });
      return;
    }
    if (type === "acq-unknown") {
      handler({
        type,
        runId: Number(data.runId) || 0,
        outreachId: Number(data.outreachId) || 0,
        error: String(data.error || ""),
      });
    }
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
