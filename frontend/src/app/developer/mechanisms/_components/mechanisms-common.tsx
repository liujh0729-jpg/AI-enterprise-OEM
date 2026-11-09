"use client";

import { Tag } from "antd";
import { WEBHOOK_EVENT_LABELS } from "@enterprise/contracts";
import { mechanismsApi } from "@/api/mechanisms";

export type Webhook = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.webhooks>>
>[number];
export type WebhookDelivery = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.deliveries>>
>["list"][number];
export type ImportMap = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.importMaps>>
>[number];
export type ImportJob = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.importJobs>>
>["list"][number];
export type ExportModule = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.exportModules>>
>[number];
export type ExportJob = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.exportJobs>>
>["list"][number];
export type ReportCatalog = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.reports>>
>[number];
export type Rule = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.rules>>
>["list"][number];
export type Share = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.shares>>
>["list"][number];
export type OidcProvider = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.oidcProviders>>
>[number];
export type AssetSharePolicy = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.assetSharePolicy>>
>;
export type SyncBinding = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.syncBindings>>
>[number];
export type SyncOverview = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.syncOverview>>
>;
export type MechanismOverview = NonNullable<
  Awaited<ReturnType<typeof mechanismsApi.overview>>
>;

export function mechError(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

export function eventLabel(event: string) {
  return WEBHOOK_EVENT_LABELS[event] || event;
}

const DELIVERY_COLORS: Record<string, string> = {
  PENDING: "gold",
  DELIVERING: "processing",
  DONE: "green",
  FAILED: "red",
  SKIPPED: "default",
};
const DELIVERY_LABELS: Record<string, string> = {
  PENDING: "待投递",
  DELIVERING: "投递中",
  DONE: "已送达",
  FAILED: "失败",
  SKIPPED: "已跳过",
};

export function deliveryStatusTag(status: string) {
  return (
    <Tag color={DELIVERY_COLORS[status] || "default"}>
      {DELIVERY_LABELS[status] || status}
    </Tag>
  );
}

const WEBHOOK_COLORS: Record<string, string> = {
  ACTIVE: "green",
  PAUSED: "gold",
  DISABLED: "default",
};
const WEBHOOK_LABELS: Record<string, string> = {
  ACTIVE: "启用中",
  PAUSED: "已暂停",
  DISABLED: "已停用",
};

export function webhookStatusTag(status: string) {
  return (
    <Tag color={WEBHOOK_COLORS[status] || "default"}>
      {WEBHOOK_LABELS[status] || status}
    </Tag>
  );
}

const JOB_COLORS: Record<string, string> = {
  PENDING: "gold",
  RUNNING: "processing",
  DONE: "green",
  FAILED: "red",
};
const JOB_LABELS: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "执行中",
  DONE: "已完成",
  FAILED: "失败",
};

export function jobStatusTag(status: string) {
  return (
    <Tag color={JOB_COLORS[status] || "default"}>
      {JOB_LABELS[status] || status}
    </Tag>
  );
}

export const IMPORT_MODULES = [
  { value: "erp_product", label: "产品", columns: ["code", "name", "unit", "spec", "purchasePrice", "salePrice", "taxRate", "note"] },
  { value: "erp_vendor", label: "供应商", columns: ["code", "name", "contactName", "phone", "email", "taxNo", "address", "note"] },
  { value: "hrm_profile", label: "员工档案", columns: ["memberUserId", "employeeNo", "department", "employmentType", "hourlyRate", "joinedAt"] },
  { value: "pj_task", label: "项目任务", columns: ["projectId", "title", "type", "priority", "status", "assigneeId", "estimateHours", "dueDate"] },
];

export const IMPORT_MODULE_LABELS: Record<string, string> = Object.fromEntries(
  IMPORT_MODULES.map((item) => [item.value, item.label]),
);

export const SHARE_KIND_LABELS: Record<string, string> = {
  REPORT: "报表",
  PROJECT: "项目",
  BOARD: "看板",
  DOC: "文档",
};

export const SYNC_DOMAIN_LABELS: Record<string, string> = {
  CONTACT: "通讯录",
  ATTENDANCE: "考勤",
  APPROVAL: "审批",
  MESSAGE: "消息",
};

export const SYNC_CHANNEL_LABELS: Record<string, string> = {
  FEISHU: "飞书",
  WECOM: "企微",
};

export const RULE_OPERATOR_LABELS: Record<string, string> = {
  eq: "等于",
  neq: "不等于",
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
  contains: "包含",
  in: "属于",
  exists: "存在",
};

export const RULE_ACTION_LABELS: Record<string, string> = {
  webhook: "调 Webhook",
  notify: "发通知",
  insight: "记洞察",
  task: "建任务",
};
