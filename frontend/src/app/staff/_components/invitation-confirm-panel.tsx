"use client";

import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { App, Button, Space, Table } from "antd";
import type { TableProps } from "antd";
import { identityApi } from "@/api/identity";
import { EmptyState, Panel } from "@/components/ui/panel";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { fmtTime, type StaffApplicationRow } from "./common";

/**
 * 职员/代理人视角：服务商发起的添加申请（双向确认）。
 * 本页确认后才建立绑定；未确认前不建立绑定、不分配企业。
 * 后端：GET /enterprise/staff/affiliations/mine、POST /enterprise/staff/invitations/:id/respond
 */
export function InvitationConfirmPanel({
  rows,
  loading,
  onDone,
}: {
  rows: StaffApplicationRow[];
  loading: boolean;
  onDone: () => Promise<void>;
}) {
  const respond = useOperationMutation(identityApi.respondInvitation, ["*"]);
  const { message } = App.useApp();
  const pending = rows.filter(
    (row) => row.direction === "PROVIDER_INVITE" && row.status === "PENDING",
  );

  const decide = async (id: number, action: "APPROVE" | "REJECT") => {
    try {
      await respond.mutateAsync({ params: { id: String(id) }, body: { action } });
      message.success(action === "APPROVE" ? "已确认绑定" : "已拒绝该添加申请");
      await onDone();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const columns: TableProps<StaffApplicationRow>["columns"] = [
    { title: "机构", dataIndex: "provider_name", render: (v) => String(v || "—") },
    {
      title: "角色（与服务类目一致）",
      dataIndex: "role_labels",
      render: (v: unknown) =>
        Array.isArray(v) && v.length ? v.join("、") : "—",
    },
    {
      title: "发起时间",
      dataIndex: "createdAt",
      render: (v) => <span className="text-12">{fmtTime(String(v || "")) || "—"}</span>,
    },
    {
      title: "操作",
      width: 170,
      render: (_, row) => (
        <Space size={6}>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => void decide(row.id, "APPROVE")}
          >
            确认绑定
          </Button>
          <Button
            danger
            icon={<CloseOutlined />}
            onClick={() => void decide(row.id, "REJECT")}
          >
            拒绝
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Panel
      title="待我确认的绑定邀请"
      titleBadge={
        <>
          {pending.length ? (
            <span className="badge badge-orange">{pending.length} 条待确认</span>
          ) : null}
          <span className="text-12 muted">
            服务商在「职员/代理人管理」发起添加申请后在这里确认；未确认前不建立绑定
          </span>
        </>
      }
    >
      <div className="table-wrap">
        <Table<StaffApplicationRow>
          rowKey="id"
          loading={loading}
          pagination={false}
          dataSource={pending}
          columns={columns}
          locale={{
            emptyText: <EmptyState text="暂无待确认的绑定邀请" />,
          }}
        />
      </div>
    </Panel>
  );
}