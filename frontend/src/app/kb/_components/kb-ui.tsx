import { Tag } from "antd";

/**
 * 知识库页面共享小件：枚举中文标签、状态色、时间格式化。
 * 枚举值与 @enterprise/contracts 的 kb.ts 保持一致（大写口径）。
 */

export const KB_SCOPE_LABELS: Record<string, string> = {
  PERSONAL: "个人",
  ENTERPRISE: "企业",
  PROVIDER: "服务商",
  AGENT: "智能体",
  AVATAR: "数字分身",
  SERVICE_DESK: "AI客服",
};

export const KB_VISIBILITY_LABELS: Record<string, string> = {
  PRIVATE: "私有",
  ORG: "组织",
  SHARED: "共享",
  PUBLIC: "公开",
};

export const KB_PAGE_TYPE_LABELS: Record<string, string> = {
  ENTITY: "实体",
  CONCEPT: "概念",
  SUMMARY: "摘要",
  COMPARISON: "对比",
  SYNTHESIS: "综合",
  INDEX: "索引",
  LOG: "日志",
};

export const KB_PAGE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审",
  PUBLISHED: "已发布",
};

export const KB_SOURCE_KIND_LABELS: Record<string, string> = {
  article: "文章",
  paper: "论文",
  transcript: "逐字稿",
  meeting: "会议纪要",
  "customer-call": "客户通话",
  note: "笔记",
  image: "图片",
};

export const KB_CONSUMER_TYPE_LABELS: Record<string, string> = {
  AVATAR: "数字分身",
  AGENT: "智能体",
  SERVICE_DESK: "AI客服",
  ERP: "ERP",
  CRM: "CRM",
};

const PAGE_STATUS_COLOR: Record<string, string> = {
  DRAFT: "default",
  PENDING_REVIEW: "orange",
  PUBLISHED: "green",
};

const SOURCE_STATUS_COLOR: Record<string, string> = {
  PENDING: "blue",
  INGESTED: "green",
  FAILED: "red",
};

const JOB_STATUS_COLOR: Record<string, string> = {
  PENDING: "blue",
  RUNNING: "processing",
  DONE: "green",
  FAILED: "red",
};

export function pageStatusTag(status: string) {
  return <Tag color={PAGE_STATUS_COLOR[status] || "default"}>{KB_PAGE_STATUS_LABELS[status] || status}</Tag>;
}

export function sourceStatusTag(status: string) {
  return <Tag color={SOURCE_STATUS_COLOR[status] || "default"}>{status}</Tag>;
}

export function jobStatusTag(status: string) {
  return <Tag color={JOB_STATUS_COLOR[status] || "default"}>{status}</Tag>;
}

export function timeText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
}
