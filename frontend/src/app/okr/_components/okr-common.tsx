"use client";

import { Progress, Select, Tag } from "antd";
import type { ReactNode } from "react";
import {
  OKR_CYCLE_KIND_LABELS,
  OKR_LEVEL_LABELS,
  OKR_METRIC_TYPE_LABELS,
  OKR_PLAN_KIND_LABELS,
  OKR_PLAN_STATUS_LABELS,
  OKR_REPORT_STATUS_LABELS,
  type OkrCycleView,
  type OkrMemberView,
  type OkrMetricSource,
  type OkrObjectiveView,
} from "@enterprise/contracts";
import { fmtDate } from "@/lib/datetime";
import { okrApi } from "@/api/okr";

/** `/okr` 页壳拿到的上下文（周期、成员、目标、我的计划、指标源、评分维度）。 */
export type OkrContextData = NonNullable<
  Awaited<ReturnType<typeof okrApi.context>>
>;
export type OkrKr = OkrObjectiveView["krs"][number];
export type OkrMetricSourceDraft = OkrMetricSource;

export const emptyMetricSource: OkrMetricSourceDraft = {
  source: "CRM_OPPORTUNITY",
  agg: "COUNT",
  field: "",
  filters: [],
  dateField: "",
  dateRange: "CYCLE",
  scope: "ACCOUNT",
  tableId: 0,
  projectId: "",
  entityId: 0,
  groupBy: "",
};

export function okrError(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

export function cycleName(cycle: OkrCycleView | null | undefined) {
  if (!cycle) return "未选择周期";
  const kind = OKR_CYCLE_KIND_LABELS[cycle.kind] || cycle.kind;
  return cycle.title || `${cycle.year} ${kind}`;
}

export function cycleOption(cycle: OkrCycleView) {
  return {
    value: cycle.id,
    label: `${cycleName(cycle)} · ${cycle.statusLabel || cycle.status}`,
  };
}

export function levelLabel(level: string) {
  return OKR_LEVEL_LABELS[level] || level;
}

export function metricTypeLabel(type: string) {
  return OKR_METRIC_TYPE_LABELS[type] || type;
}

export function planKindLabel(kind: string) {
  return OKR_PLAN_KIND_LABELS[kind] || kind;
}

export function planStatusTag(status: string) {
  const color =
    status === "DONE"
      ? "green"
      : status === "DOING"
        ? "processing"
        : status === "CANCELLED"
          ? "default"
          : "gold";
  return (
    <Tag color={color}>{OKR_PLAN_STATUS_LABELS[status] || status}</Tag>
  );
}

export function reportStatusTag(status: string) {
  return (
    <Tag color={status === "SUBMITTED" ? "green" : "gold"}>
      {OKR_REPORT_STATUS_LABELS[status] || status}
    </Tag>
  );
}

export function priorityTag(priority: string) {
  const map: Record<string, { color: string; label: string }> = {
    HIGH: { color: "red", label: "高" },
    MEDIUM: { color: "blue", label: "中" },
    LOW: { color: "default", label: "低" },
  };
  const item = map[priority] || map.MEDIUM;
  return <Tag color={item.color}>{item.label}</Tag>;
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

/** 承接人选择：'' 代表账号所有者（后端把所有者记为自键）。 */
export function MemberSelect({
  members,
  value,
  onChange,
  ownerName,
  includeOwner = true,
  placeholder = "选择承接人",
  disabled,
  mode,
  style,
}: {
  members: OkrMemberView[];
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
  ownerName?: string;
  includeOwner?: boolean;
  placeholder?: string;
  disabled?: boolean;
  mode?: "multiple";
  style?: React.CSSProperties;
}) {
  const options = [
    ...(includeOwner
      ? [{ value: "", label: `${ownerName || "账号所有者"}（所有者）` }]
      : []),
    ...members.map((item) => ({
      value: item.memberUserId,
      label: `${item.name || item.memberUserId}${
        item.department ? ` · ${item.department}` : ""
      }${item.dualKind ? "（双身份）" : ""}`,
    })),
  ];
  return (
    <Select
      mode={mode}
      style={{ minWidth: 220, ...style }}
      value={value}
      onChange={(next) => onChange?.(next as string | string[])}
      placeholder={placeholder}
      disabled={disabled}
      options={options}
      showSearch
      optionFilterProp="label"
    />
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <Progress
      percent={Math.round(Number(value) || 0)}
      size="small"
      style={{ margin: 0, minWidth: 120 }}
    />
  );
}

export function ProgressRing({ value, size = 64 }: { value: number; size?: number }) {
  return (
    <Progress
      type="circle"
      size={size}
      percent={Math.round(Number(value) || 0)}
    />
  );
}

/** 目标的 KR 摘要行：目标卡片里逐条展示。 */
export function KrLine({
  kr,
  actions,
}: {
  kr: OkrObjectiveView["krs"][number];
  actions?: ReactNode;
}) {
  const unit = kr.unit ? ` ${kr.unit}` : "";
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "6px 0",
        borderTop: "1px dashed var(--border, #eee)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span>{kr.title}</span>
          <Tag>{metricTypeLabel(kr.metricType)}</Tag>
          {kr.weight !== 1 ? <Tag>权重 {kr.weight}</Tag> : null}
        </div>
        <div className="muted text-12">
          {`当前 ${kr.currentValue}${unit} / 目标 ${kr.targetValue}${unit} · ${
            kr.direction === "DOWN" ? "越小越好" : "越大越好"
          }${kr.ownerName ? ` · ${kr.ownerName}` : ""}`}
        </div>
      </div>
      <div style={{ width: 160 }}>
        <ProgressBar value={kr.progress} />
      </div>
      {actions}
    </div>
  );
}

export function fmtRange(start: string, end: string) {
  const left = start ? fmtDate(start) : "";
  const right = end ? fmtDate(end) : "";
  if (!left && !right) return "—";
  return `${left} ~ ${right}`;
}
