"use client";

import { FolderOpenOutlined } from "@ant-design/icons";
import { Button, Table } from "antd";
import type { TableProps } from "antd";
import { EmptyState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/status-badge";
import { fmtTime } from "./common";
import type { AccountSetRow } from "./common";

/**
 * 企业可见的「我的账套」（需求 6.3）：账套是企业账务查询依据，企业只读；
 * 创建/归档由服务商在「财税工作台 · 账套管理」完成；企业可打开查看账套详情。
 */
export function EnterpriseSetsPanel({
  sets,
  total,
  page,
  onPageChange,
  loading,
  onOpenSet,
}: {
  sets: AccountSetRow[];
  total:number;
  page:number;
  onPageChange:(page:number)=>void;
  loading?: boolean;
  onOpenSet: (id: number) => void;
}) {
  const columns: TableProps<AccountSetRow>["columns"] = [
    {
      title: "账套名称",
      dataIndex: "name",
      render: (value: string, row) => (
        <Button
          type="link"
          style={{ padding: 0, fontWeight: 600 }}
          onClick={() => onOpenSet(row.id)}
        >
          {value}
        </Button>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      title: "申报计划",
      width: 230,
      render: (_, row) => {
        const stats = row.plan_stats;
        if (!stats) return "—";
        return `待申报 ${stats.due ?? 0} · 申报中 ${stats.in_progress ?? 0} · 已完成 ${stats.done ?? 0}`;
      },
    },
    {
      title: "申报单",
      width: 100,
      render: (_, row) => `${row.decl_summary?.count ?? 0} 张`,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 160,
      render: (value: string) => (
        <span className="text-12 muted">{fmtTime(value)}</span>
      ),
    },
    {
      title: "操作",
      width: 110,
      render: (_, row) => (
        <Button onClick={() => onOpenSet(row.id)}>
          查看详情
        </Button>
      ),
    },
  ];

  return (
    <Panel
      title="我的账套"
      titleBadge={
        <span className="text-12 muted">
          账套是你企业的账务与申报依据（只读）：由签约服务商为你建账与归档，申报计划、申报单都挂在对应账套上；点账套名称或「查看详情」可打开 · 共 {total} 个
        </span>
      }
    >
      <div className="table-wrap">
        <Table<AccountSetRow>
          rowKey="id"
          loading={loading}
          pagination={{current:page,pageSize:20,total,onChange:onPageChange,showSizeChanger:false}}
          size="middle"
          scroll={{ x: "max-content" }}
          dataSource={sets}
          columns={columns}
          locale={{
            emptyText: (
              <EmptyState
                icon={<FolderOpenOutlined aria-hidden />}
                text="暂无账套：签约服务商为你建账后在此展示。"
              />
            ),
          }}
        />
      </div>
    </Panel>
  );
}
