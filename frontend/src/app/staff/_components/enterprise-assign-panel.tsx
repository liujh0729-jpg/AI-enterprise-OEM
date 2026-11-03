"use client";

import { BankOutlined } from "@ant-design/icons";
import { App, Button, Table } from "antd";
import { useState } from "react";
import type { TableProps } from "antd";
import { EmptyState, Panel } from "@/components/ui/panel";
import { AssignStaffModal } from "@/app/contracts/_components/contract-dialogs";
import { useProviderStaff } from "@/query/workspaces";
import type { ProviderEnterpriseRow, ProviderStaffOption } from "./common";

/**
 * 企业分配（原「签约管理 · 服务企业台账」的分配能力，按需求移到职员/代理人管理）。
 * 服务商把签约企业分配给具体职员承办（一个服务商对一家企业只指派一名主办职员）。
 */
export function EnterpriseAssignPanel({
  rows,
  loading,
  denied,
}: {
  rows: ProviderEnterpriseRow[];
  loading?: boolean;
  denied?: boolean;
}) {
  const { message, modal } = App.useApp();
  const [target, setTarget] = useState<{
    row: ProviderEnterpriseRow;
    staff: ProviderStaffOption[];
  } | null>(null);

  const staffQuery = useProviderStaff(true);
  const open = async (row: ProviderEnterpriseRow) => {
    try {
      const result = await staffQuery.refetch();
      if (result.error) throw result.error;
      const staff = result.data ?? [];
      if (!staff.length) {
        modal.confirm({
          title: "尚无职员",
          okText: "去绑定职员",
          cancelText: "取消",
          content:
            "你还没有绑定任何职员账号。请先在上方「＋ 发起添加申请」添加职员，对方确认后再把企业分配给他。",
        });
        return;
      }
      setTarget({ row, staff });
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const columns: TableProps<ProviderEnterpriseRow>["columns"] = [
    {
      title: "企业名称",
      dataIndex: "name",
      render: (value: string) => (
        <span style={{ fontWeight: 600 }}>{value}</span>
      ),
    },
    { title: "信用代码", dataIndex: "uscc", width: 200 },
    {
      title: "纳税人类型",
      dataIndex: "taxpayerType",
      width: 110,
      render: (value: string) =>
        value === "SMALL_SCALE" ? "小规模纳税人" : "一般纳税人",
    },
    { title: "产业", dataIndex: "industry", width: 120 },
    {
      title: "承办职员",
      width: 130,
      render: (_, row) =>
        row.staffUserId ? (
          <span>{row.staffName || row.staffUserId}</span>
        ) : (
          <span className="badge badge-orange">待分配</span>
        ),
    },
    {
      title: "操作",
      width: 130,
      render: (_, row) => (
        <Button
          disabled={denied}
          loading={staffQuery.isFetching}
          onClick={() => void open(row)}
        >
          {row.staffUserId ? "改派职员" : "分配职员"}
        </Button>
      ),
    },
  ];

  return (
    <Panel
      title="企业分配（服务企业列表）"
      titleBadge={`${rows.length} 家 · 待分配 ${
        rows.filter((item) => !item.staffUserId).length
      }`}
    >
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        把你服务的签约企业分配给具体职员承办：企业资料与未完结业务会流转给该职员，
        业务必须由承办职员推进（未指派不可办理）。
      </div>
      <div className="table-wrap">
        <Table<ProviderEnterpriseRow>
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          dataSource={rows}
          columns={columns}
          locale={{
            emptyText: (
              <EmptyState
                icon={<BankOutlined aria-hidden />}
                text="暂无服务企业。签约由企业发起，你在「签约管理」确认后即出现在这里。"
              />
            ),
          }}
        />
      </div>

      <AssignStaffModal
        open={Boolean(target)}
        enterpriseId={target?.row.id || 0}
        enterpriseName={target?.row.name || ""}
        staff={target?.staff || []}
        current={target?.row.staffUserId || ""}
        onCancel={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
        }}
      />
    </Panel>
  );
}
