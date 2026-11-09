"use client";

import { Progress, Tag } from "antd";
import type { ReactNode } from "react";
import {
  z,
  PJ_PRIORITY_LABELS,
  PJ_PROJECT_STATUS_LABELS,
  PJ_TASK_STATUS_LABELS,
  PJ_TASK_TYPE_LABELS,
  pjDemandSchema,
  pjMilestoneSchema,
  pjOverviewSchema,
  pjProjectDetailSchema,
  pjProjectSchema,
  pjSettingsSchema,
  pjSprintSchema,
  pjTaskSchema,
  pjTimeLogSchema,
  pjTimesheetSchema,
} from "@enterprise/contracts";
import { fmtDate } from "@/lib/datetime";

export type PjProject = z.infer<typeof pjProjectSchema>;
export type PjProjectDetail = z.infer<typeof pjProjectDetailSchema>;
export type PjOverview = z.infer<typeof pjOverviewSchema>;
export type PjSprint = z.infer<typeof pjSprintSchema>;
export type PjMilestone = z.infer<typeof pjMilestoneSchema>;
export type PjTask = z.infer<typeof pjTaskSchema>;
export type PjDemand = z.infer<typeof pjDemandSchema>;
export type PjDemandResponse = PjDemand["responses"][number];
export type PjTimeLog = z.infer<typeof pjTimeLogSchema>;
export type PjTimesheet = z.infer<typeof pjTimesheetSchema>;
export type PjSettings = z.infer<typeof pjSettingsSchema>;

export function pjError(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

const PROJECT_COLORS: Record<string, string> = {
  PLANNING: "gold",
  ACTIVE: "processing",
  ACCEPTING: "cyan",
  CLOSED: "green",
  CANCELED: "default",
};
const TASK_COLORS: Record<string, string> = {
  TODO: "default",
  DOING: "processing",
  REVIEW: "gold",
  DONE: "green",
  CANCELED: "default",
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: "default",
  MEDIUM: "blue",
  HIGH: "orange",
  URGENT: "red",
};

export function projectStatusTag(status: string) {
  return (
    <Tag color={PROJECT_COLORS[status] || "default"}>
      {PJ_PROJECT_STATUS_LABELS[status] || status}
    </Tag>
  );
}

export function taskStatusTag(status: string) {
  return (
    <Tag color={TASK_COLORS[status] || "default"}>
      {PJ_TASK_STATUS_LABELS[status] || status}
    </Tag>
  );
}

export function taskTypeTag(type: string) {
  return <Tag>{PJ_TASK_TYPE_LABELS[type] || type}</Tag>;
}

export function priorityTag(priority: string) {
  return (
    <Tag color={PRIORITY_COLORS[priority] || "default"}>
      {PJ_PRIORITY_LABELS[priority] || priority}
    </Tag>
  );
}

export function timeStatusTag(status: string) {
  const map: Record<string, { color: string; label: string }> = {
    DRAFT: { color: "default", label: "草稿" },
    SUBMITTED: { color: "gold", label: "待审批" },
    APPROVED: { color: "green", label: "已通过" },
    REJECTED: { color: "red", label: "已驳回" },
  };
  const item = map[status] || map.DRAFT;
  return <Tag color={item.color}>{item.label}</Tag>;
}

export function money(value: string | number, currency = "CNY") {
  const n = Number(value || 0);
  return `${n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

export function hours(minutes: number) {
  const n = Number(minutes || 0);
  return `${(n / 60).toFixed(1)}h`;
}

export function day(value: string) {
  return value ? fmtDate(value) : "—";
}

export function Toolbar({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        marginBottom: 12,
      }}
    >
      {children}
      {hint ? (
        <span className="muted text-12" style={{ marginLeft: "auto" }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function ProgressInline({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Progress
      percent={percent}
      size="small"
      format={() => `${done}/${total}`}
      style={{ margin: 0, minWidth: 120 }}
    />
  );
}

export const PROJECT_STATUS_OPTIONS = Object.entries(
  PJ_PROJECT_STATUS_LABELS,
).map(([value, label]) => ({ value, label }));

export const TASK_STATUS_OPTIONS = Object.entries(PJ_TASK_STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const TASK_TYPE_OPTIONS = Object.entries(PJ_TASK_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const PRIORITY_OPTIONS = Object.entries(PJ_PRIORITY_LABELS).map(
  ([value, label]) => ({ value, label }),
);
