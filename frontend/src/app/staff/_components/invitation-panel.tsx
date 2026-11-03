"use client";
import { useOperationMutation } from "@/query/business";
import { identityApi } from "@/api/identity";

import { InboxOutlined } from "@ant-design/icons";
import { App, Button, Space, Table } from "antd";
import { EmptyState, Panel } from "@/components/ui/panel";

import { applicantDisplay, fmtDate, type StaffApplicationRow } from "./common";

/** 添加申请状态文案（发起方视角：等待的是「对方确认」而非机构审批）。 */
const INVITE_STATUS: Record<string, { label: string; variant: string }> = {
  PENDING: { label: "待对方确认", variant: "orange" },
  APPROVED: { label: "对方已确认 · 已生效", variant: "green" },
  REJECTED: { label: "对方已拒绝", variant: "gray" },
  CANCELLED: { label: "已撤回", variant: "gray" },
};

/**
 * 待对方确认的添加申请（双向确认 · 服务商侧）——服务商在「＋ 添加职员」发起申请后
 * 记录仍为 PENDING，待被添加人在「职员/代理人管理」确认才生效（不是单方面绑定）。
 * 后端：GET /enterprise/staff/affiliations（含 PROVIDER_INVITE 方向行）、
 * POST /enterprise/staff/invitations/:id/cancel（发起方撤回）。
 */
export function InvitationPanel({
  rows,
  loading,
  denied,
}: {
  rows: StaffApplicationRow[];
  loading: boolean;
  denied: boolean;
}) {
  const identity_cancelInvitationMutation = useOperationMutation(
    identityApi.cancelInvitation,
    ["*"],
  );

  const { message, modal } = App.useApp();

  const inviteRows = rows.filter((row) => row.direction === "PROVIDER_INVITE");
  const pending = inviteRows.filter((row) => row.status === "PENDING");

  const cancel = (row: StaffApplicationRow) => {
    const name = applicantDisplay(row);
    modal.confirm({
      title: "撤回添加申请",
      okText: "确认撤回",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: (
        <span>
          撤回对「{name}」的添加申请？撤回后 TA
          的「我的服务商」不再显示该申请，可重新发起。
        </span>
      ),
      onOk: async () => {
        await identity_cancelInvitationMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("已撤回添加申请");
      },
    });
  };

  return (
    <Panel
      title="待对方确认的添加申请"
      titleBadge={
        <>
          {pending.length ? (
            <span className="badge badge-orange">
              {pending.length} 条待确认
            </span>
          ) : null}
          <span className="text-12 muted">
            由你在「在职职员」右上角「＋
            添加职员」发起；对方在「职员/代理人管理」确认后才建立绑定（未确认前不可分配企业、不承办任何业务）
          </span>
        </>
      }
    >
      <div className="table-wrap">
        <Table<StaffApplicationRow>
          rowKey="id"
          loading={loading}
          dataSource={inviteRows}
          pagination={false}
          size="middle"
          locale={{
            emptyText: (
              <EmptyState
                icon={<InboxOutlined aria-hidden />}
                text="暂无添加申请：点击「在职职员」右上角「＋ 添加职员」发起，对方确认后生效"
              />
            ),
          }}
          columns={[
            {
              title: "职员",
              width: 150,
              render: (_, row) => (
                <span style={{ fontWeight: 600 }}>{applicantDisplay(row)}</span>
              ),
            },
            {
              title: "AIworkin 账号",
              width: 170,
              render: (_, row) => (
                <span className="mono text-12">
                  {row.applicant_username || row.staffUserId || "—"}
                </span>
              ),
            },
            {
              title: "手机号",
              width: 130,
              render: (_, row) => (
                <span className="text-12">
                  {row.applicant_phone || row.profile?.phone || "—"}
                </span>
              ),
            },
            {
              title: "角色（与服务类目一致）",
              width: 200,
              render: (_, row) => {
                const roles = row.role_labels?.length
                  ? row.role_labels
                  : row.position
                    ? [row.position]
                    : [];
                return roles.length ? (
                  <Space size={4} wrap>
                    {roles.map((role) => (
                      <span key={role} className="badge badge-sky">
                        {role}
                      </span>
                    ))}
                  </Space>
                ) : (
                  <span className="text-12 muted">—</span>
                );
              },
            },
            {
              title: "状态",
              width: 140,
              render: (_, row) => {
                const spec = INVITE_STATUS[row.status] || {
                  label: row.status,
                  variant: "gray",
                };
                return (
                  <span className={`badge badge-${spec.variant}`}>
                    {spec.label}
                  </span>
                );
              },
            },
            {
              title: "发起时间",
              width: 120,
              render: (_, row) => (
                <span className="text-12 muted">{fmtDate(row.createdAt)}</span>
              ),
            },
            {
              title: "操作",
              width: 100,
              render: (_, row) =>
                row.status === "PENDING" ? (
                  <Space size={6} wrap>
                    <Button disabled={denied} onClick={() => cancel(row)}>
                      撤回
                    </Button>
                  </Space>
                ) : (
                  <span className="text-12 muted">—</span>
                ),
            },
          ]}
        />
      </div>
    </Panel>
  );
}
