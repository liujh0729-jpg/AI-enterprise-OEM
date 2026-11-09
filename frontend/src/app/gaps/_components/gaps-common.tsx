"use client";

import { Tag } from "antd";
import type { ReactNode } from "react";

/** 附录 B 面板共用的小工具：错误文案、状态标签、时间格式化。 */

export const gapError = (error: unknown) =>
  (error as Error)?.message || "操作失败，请稍后重试";

export const zhDay = (value?: string | null) =>
  value ? value.slice(0, 10) : "—";

export const zhTime = (value?: string | null) =>
  value ? value.replace("T", " ").slice(0, 16) : "—";

const STATUS: Record<string, { color: string; label: string }> = {
  ACTIVE: { color: "green", label: "启用" },
  DRAFT: { color: "default", label: "草稿" },
  ARCHIVED: { color: "default", label: "已归档" },
  PUBLISHED: { color: "green", label: "已发布" },
  BOOKED: { color: "processing", label: "已预约" },
  DONE: { color: "green", label: "已完成" },
  CANCELED: { color: "default", label: "已取消" },
  PENDING: { color: "gold", label: "待处理" },
  REVIEWING: { color: "processing", label: "审核中" },
  APPROVED: { color: "green", label: "已通过" },
  REJECTED: { color: "red", label: "已驳回" },
  RECEIVED: { color: "cyan", label: "已收货" },
  SHIPPED: { color: "blue", label: "已发货" },
  COMPLETED: { color: "green", label: "已完成" },
  VISIBLE: { color: "green", label: "展示中" },
  HIDDEN: { color: "default", label: "已隐藏" },
  TODO: { color: "default", label: "待办" },
  SKIPPED: { color: "default", label: "已跳过" },
  OPEN: { color: "green", label: "进行中" },
  CLOSED: { color: "default", label: "已关闭" },
  UPDATE: { color: "processing", label: "修改" },
  DELETE: { color: "red", label: "删除" },
  APPROVE: { color: "green", label: "审批通过" },
  REJECT: { color: "red", label: "审批驳回" },
};

export function gapStatusTag(status?: string | null): ReactNode {
  if (!status) return <Tag>—</Tag>;
  const item = STATUS[status];
  return <Tag color={item?.color || "default"}>{item?.label || status}</Tag>;
}
