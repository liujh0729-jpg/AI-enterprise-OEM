"use client";

import { App, Button, Table } from "antd";
import type { TableProps } from "antd";
import { identityApi } from "@/api/identity";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { fmtTime } from "./common";

type MyWork = NonNullable<Awaited<ReturnType<typeof identityApi.myWork>>>;
type BindRow = MyWork["binds"][number];
type AssignmentRow = MyWork["assignments"][number];

const TAXPAYER_LABEL: Record<string, string> = {
  GENERAL: "一般纳税人",
  SMALL_SCALE: "小规模纳税人",
};

function rolesText(value: unknown) {
  if (Array.isArray(value))
    return value.length ? value.map((item) => String(item)).join("、") : "—";
  return value ? String(value) : "—";
}

/**
 * 职员/代理人视角的「我的绑定」与「承办企业」。
 * 明细与解绑动作从高管驾驶舱迁入本模块统一处理。
 * 后端：GET /enterprise/staff/my-work、POST /enterprise/identity/self-unbind
 */
export function MyWorkPanels({
  binds,
  assignments,
  loading,
  onDone,
}: {
  binds: BindRow[];
  assignments: AssignmentRow[];
  loading: boolean;
  onDone: () => Promise<void>;
}) {
  const unbind = useOperationMutation(identityApi.selfUnbind, ["*"]);
  const { message, modal } = App.useApp();

  const doUnbind = (row: BindRow) => {
    modal.confirm({
      title: "取消绑定",
      content: `取消与「${String(row.org_name || row.provider_name || row.providerUserId)}」的绑定？取消后不再接收该机构的承办业务。`,
      okText: "确认解绑",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await unbind.mutateAsync({
            params: { providerUserId: String(row.providerUserId) },
          });
          message.success("已解绑");
          await onDone();
        } catch (error) {
          if (error instanceof Error)
            presentMutationError(error, (text) => message.error(text));
        }
      },
    });
  };

  const bindColumns: TableProps<BindRow>["columns"] = [
    { title: "机构", dataIndex: "org_name", render: (v) => String(v || "—") },
    { title: "服务商", dataIndex: "provider_name", render: (v) => String(v || "—") },
    {
      title: "角色",
      dataIndex: "roles",
      render: (value: unknown) => rolesText(value),
    },
    {
      title: "绑定时间",
      dataIndex: "createdAt",
      render: (v) => <span className="text-12">{fmtTime(v)}</span>,
    },
    {
      title: "操作",
      width: 110,
      render: (_, row) => (
        <Button danger onClick={() => doUnbind(row)}>
          解绑
        </Button>
      ),
    },
  ];

  const assignmentColumns: TableProps<AssignmentRow>["columns"] = [
    {
      title: "企业名称",
      dataIndex: "enterpriseName",
      render: (v) => String(v || "—"),
    },
    {
      title: "信用代码",
      dataIndex: "uscc",
      render: (v) => <span className="mono">{String(v || "—")}</span>,
    },
    {
      title: "纳税人类型",
      dataIndex: "taxpayerType",
      render: (v) => (
        <StatusBadge
          domain="taxpayer"
          status={String(v || "")}
          text={TAXPAYER_LABEL[String(v)] || "—"}
        />
      ),
    },
    { title: "产业", dataIndex: "industry", render: (v) => String(v || "—") },
    { title: "法定代表人", dataIndex: "legalPerson", render: (v) => String(v || "—") },
    { title: "联系电话", dataIndex: "phone", render: (v) => String(v || "—") },
  ];

  return (
    <>
      <Panel title="我的绑定" titleBadge={`${binds.length} 条绑定`}>
        <div className="table-wrap">
          <Table<BindRow>
            rowKey="id"
            loading={loading}
            pagination={false}
            dataSource={binds}
            columns={bindColumns}
            locale={{ emptyText: <EmptyState text="暂未被任何服务商绑定" /> }}
          />
        </div>
      </Panel>
      <Panel title="承办企业" titleBadge={`${assignments.length} 家`}>
        <div className="table-wrap">
          <Table<AssignmentRow>
            rowKey="id"
            loading={loading}
            pagination={false}
            dataSource={assignments}
            columns={assignmentColumns}
            locale={{ emptyText: <EmptyState text="暂无分配的承办企业" /> }}
          />
        </div>
      </Panel>
    </>
  );
}