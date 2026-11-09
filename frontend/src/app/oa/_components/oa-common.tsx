"use client";

import { PaperClipOutlined } from "@ant-design/icons";
import { Button, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState, type ReactNode } from "react";
import { contentApi } from "@/api/content";
import { EmptyState } from "@/components/ui/panel";
import type {
  OaAttachment,
  OaCondition,
  OaField,
  OaFlowNode,
  OaLinkTarget,
  OaOrg,
  OaSettings,
} from "@enterprise/contracts";
import {
  OA_APPLICATION_STATUS_LABELS,
  OA_APPROVER_TYPE_LABELS,
  OA_CONDITION_OP_LABELS,
  OA_LINK_TARGET_LABELS,
  OA_TASK_STATUS_LABELS,
  ORG_BUSINESS_SCOPE_LABELS,
} from "@enterprise/contracts";

export { fmtDateTime, fmtTime } from "@/lib/datetime";

export type OaMember = OaSettings["members"][number];
export type { OaOrg };

export function oaError(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

export function money(value: unknown) {
  const n = Number(value || 0);
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const APPLICATION_COLORS: Record<string, string> = {
  DRAFT: "default",
  APPROVING: "processing",
  RETURNED: "orange",
  APPROVED: "green",
  REJECTED: "red",
  WITHDRAWN: "default",
};

export function ApplicationStatusTag({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return (
    <Tag color={APPLICATION_COLORS[status] || "default"}>
      {label || OA_APPLICATION_STATUS_LABELS[status] || status}
    </Tag>
  );
}

export function TaskStatusTag({ status }: { status: string }) {
  return (
    <Tag
      color={
        status === "PENDING"
          ? "gold"
          : status === "APPROVED"
            ? "green"
            : status === "REJECTED"
              ? "red"
              : "default"
      }
    >
      {OA_TASK_STATUS_LABELS[status] || status}
    </Tag>
  );
}

const LINK_STATUS_COLORS: Record<string, string> = {
  PENDING: "gold",
  DONE: "green",
  FAILED: "red",
  SKIPPED: "default",
};

export function LinkStatusTag({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return (
    <Tag color={LINK_STATUS_COLORS[status] || "default"}>
      {label || status}
    </Tag>
  );
}

export function LinkTargetLabel({ targetType }: { targetType: string }) {
  return <>{OA_LINK_TARGET_LABELS[targetType] || targetType}</>;
}

/**
 * 把注册表里的 detailPath 占位（{0}、{1}…）换成 targetId 的分段。
 * targetId 对内建应用/多维表格是 `a:b:c` 形式的复合键，其余对象只有一段。
 */
export function oaDetailPath(
  targets: OaLinkTarget[],
  targetType: string,
  targetId: string,
) {
  const target = targets.find((item) => item.key === targetType);
  if (!target?.detailPath) return "";
  const parts = String(targetId || "").split(":");
  return target.detailPath.replace(/\{(\d+)\}/g, (_, index: string) =>
    encodeURIComponent(parts[Number(index)] ?? ""),
  );
}

export function memberLabel(member: OaMember) {
  return [
    member.name || member.userId,
    member.department,
    member.memberKindLabel,
    member.roleLabels.filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function memberOptions(members: OaMember[]) {
  return members.map((member) => ({
    value: member.userId,
    label: memberLabel(member),
  }));
}

/** 组织成员选择：转交/加签/抄送/字段 user 共用同一份选项与展示口径。 */
export function MemberSelect({
  members,
  value,
  onChange,
  mode,
  placeholder = "选择成员",
  disabled,
  style,
}: {
  members: OaMember[];
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
  mode?: "multiple";
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <Select
      mode={mode}
      showSearch
      optionFilterProp="label"
      style={{ minWidth: 200, ...style }}
      value={value}
      onChange={(next) => onChange?.(next as string | string[])}
      placeholder={placeholder}
      disabled={disabled}
      options={memberOptions(members)}
    />
  );
}

/** 附件大小：落库的 size 以 MB 计（数字资产的 fileSize），不足 1 MB 换 KB 显示。 */
export function sizeLabel(size: number) {
  const mb = Number(size) || 0;
  if (mb <= 0) return "大小未知";
  return mb < 1 ? `${Math.max(1, Math.round(mb * 1024))} KB` : `${mb.toFixed(2)} MB`;
}

/** 附件存数字资产 id + 名称 + 大小 + 直链（服务端从发起人台账取的）。 */
export async function assetUrlOf(attachment: OaAttachment) {
  if (attachment.url) return attachment.url;
  // 历史单据没落直链：只能在查看者自己的资产里按名称碰运气，查不到就提示。
  const data = await contentApi.digitalAssets({
    query: { page: 1, pageSize: 100, keyword: attachment.name },
  });
  const hit = (data?.list || []).find(
    (item) => String(item.id) === String(attachment.id),
  );
  return hit?.url || "";
}

export function AttachmentList({
  items,
}: {
  items: OaAttachment[];
}) {
  const [busyId, setBusyId] = useState("");
  const [failed, setFailed] = useState("");
  if (!items?.length) return <span className="muted text-12">无</span>;
  return (
    <Space orientation="vertical" size={4}>
      {items.map((item) => (
        <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <PaperClipOutlined aria-hidden />
          <span>{item.name}</span>
          <span className="muted text-12">{sizeLabel(item.size)}</span>
          <Button
            type="link"
            loading={busyId === item.id}
            onClick={async () => {
              setBusyId(item.id);
              setFailed("");
              try {
                const url = await assetUrlOf(item);
                if (url) window.open(url, "_blank", "noopener,noreferrer");
                else setFailed(`未在数字资产里找到「${item.name}」`);
              } catch (error) {
                setFailed(oaError(error));
              } finally {
                setBusyId("");
              }
            }}
          >
            查看
          </Button>
        </div>
      ))}
      {failed ? <div className="text-12" style={{ color: "var(--danger)" }}>{failed}</div> : null}
    </Space>
  );
}

/**
 * 条件的一句话：`单据金额 大于等于 5000`。流程预览与流程编辑器共用一份写法。
 */
export function oaConditionText(
  condition: OaCondition | null | undefined,
  fields: OaField[],
) {
  if (!condition?.field) return "";
  const label =
    condition.field === "amount"
      ? "单据金额"
      : fields.find((item) => item.key === condition.field)?.label ||
        condition.field;
  const op = OA_CONDITION_OP_LABELS[condition.op] || condition.op;
  return `${label} ${op} ${String(condition.value ?? "")}`;
}

/** 节点审批人规则的一句话描述（指定成员列名字，业务板块列中文类目）。 */
export function oaApproverText(node: OaFlowNode, members: OaMember[]) {
  const type = OA_APPROVER_TYPE_LABELS[node.approverType] || node.approverType;
  if (node.approverType === "MEMBER") {
    const names = node.userIds.map((id) => memberNameOf(members, id));
    return names.length ? `${type}：${names.join("、")}` : `${type}（未指定）`;
  }
  if (node.approverType === "ROLE") {
    const labels = node.roles.map(
      (code) => ORG_BUSINESS_SCOPE_LABELS[code] || code,
    );
    return labels.length ? `${type}：${labels.join("、")}` : `${type}（未指定）`;
  }
  if (node.approverType === "DEPT_POSITION") {
    if (!node.department) return `${type}（未指定）`;
    return node.positions.length
      ? `${type}：${node.department} · ${node.positions.join("、")}`
      : `${type}：${node.department}（全部岗位）`;
  }
  return type;
}

export type OaOrgQuery = {
  orgType?: "ENTERPRISE" | "PROVIDER";
  orgUserId?: string;
};

/** 组织切换：折成每个请求要带的 org 参数；不传＝后端按默认规则判定当前组织。 */
export function orgQueryOf(org: OaOrg | null | undefined): OaOrgQuery {
  if (!org?.orgUserId) return {};
  return {
    orgType: org.orgType === "PROVIDER" ? "PROVIDER" : "ENTERPRISE",
    orgUserId: org.orgUserId,
  };
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

/** OA 各列表的统一表壳：中尺寸 + 横向滚动 + 外层分页，四个页签共用一份。 */
export function OaTable<T extends object>({
  columns,
  rows,
  loading,
  total,
  page,
  pageSize,
  onPage,
  empty,
}: {
  columns: ColumnsType<T>;
  rows: T[];
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  empty: string;
}) {
  return (
    <Table<T>
      rowKey={(row) => String((row as { id?: string | number }).id ?? JSON.stringify(row))}
      size="middle"
      columns={columns}
      dataSource={rows}
      loading={loading}
      scroll={{ x: "max-content" }}
      locale={{ emptyText: <EmptyState text={empty} /> }}
      pagination={
        onPage
          ? {
              current: page || 1,
              pageSize: pageSize || 20,
              total: total || 0,
              showSizeChanger: false,
              onChange: onPage,
            }
          : false
      }
    />
  );
}

export function memberNameOf(members: OaMember[], userId: string) {
  const member = members.find((item) => item.userId === userId);
  return member?.name || userId;
}
