"use client";
import { adminApi } from "@/api/admin";
import { contractsApi } from "@/api/contracts";
import { useOperationMutation } from "@/query/business";

import { FileProtectOutlined } from "@ant-design/icons";
import { App, Button, Table } from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import {
  PermissionNotice,
  fmtDate,
  fmtTime,
  useAdminData,
  type AdminContractRow,
} from "./common";

const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "ACTIVE", label: "生效中" },
  { value: "PENDING", label: "待确认" },
  { value: "TERMINATED", label: "已解约" },
  { value: "EXPIRED", label: "已到期" },
] as const;

/**
 * 签约监管（demo admin.js：renderContracts）——平台管理员查看全部签约，
 * 可按状态筛选；生效中 / 待确认的签约可由管理员解除。
 * 后端：GET /enterprise/admin/contracts/page[?status=...]。
 */
export function ContractsTab() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "";
  const [page, setPage] = useState(1);
  const [terminating, setTerminating] = useState<number | null>(null);

  const { data, loading, denied, reload } = useAdminData(
    "contracts",
    (signal) =>
      adminApi.contractPage(
        { query: { page, pageSize: 20, status: statusFilter || undefined } },
        { signal },
      ),
    { page, status: statusFilter },
  );
  const rows = data?.list ?? [];

  const terminateMutation = useOperationMutation(contractsApi.terminate, [
    "contracts",
    "admin",
  ]);

  const setStatusFilter = (value: string) => {
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("status", value);
    else params.delete("status");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const handleTerminate = (row: AdminContractRow) => {
    modal.confirm({
      title: "解除签约",
      content: `确认解除「${row.providerOrg}」与「${row.enterpriseName}」的签约（${row.contractNo}）？解除后双方将无法基于该签约开展业务。`,
      okText: "确认解除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setTerminating(row.id);
        try {
          await terminateMutation.mutateAsync({
            params: { id: String(row.id) },
          });
          message.success("已解除签约");
          void reload();
        } finally {
          setTerminating(null);
        }
      },
    });
  };

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="签约监管"
        titleBadge={
          <span className="text-12 muted">
            平台管理员可查看全部签约，生效中的签约可由管理员解除
          </span>
        }
        extra={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {STATUS_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type={statusFilter === opt.value ? "primary" : "default"}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        }
      >
        <div className="table-wrap">
          <Table<AdminContractRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            size="middle"
            scroll={{ x: 1300 }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<FileProtectOutlined aria-hidden />}
                  text="暂无签约"
                />
              ),
            }}
            columns={[
              {
                title: "合同编号",
                width: 170,
                render: (_, row) => (
                  <span className="mono text-12">{row.contractNo}</span>
                ),
              },
              {
                title: "服务商",
                width: 190,
                render: (_, row) => (
                  <span style={{ fontWeight: 600 }}>{row.providerOrg}</span>
                ),
              },
              {
                title: "服务企业",
                width: 220,
                render: (_, row) => row.enterpriseName,
              },
              {
                title: "状态",
                width: 110,
                render: (_, row) => (
                  <StatusBadge domain="contract" status={row.status} />
                ),
              },
              {
                title: "开始日期",
                width: 130,
                render: (_, row) => fmtDate(row.startDate),
              },
              {
                title: "备注",
                width: 220,
                render: (_, row) => (
                  <span className="text-12 muted">{row.note || "—"}</span>
                ),
              },
              {
                title: "更新时间",
                width: 160,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {fmtTime(row.updatedAt || row.createdAt)}
                  </span>
                ),
              },
              {
                title: "操作",
                width: 100,
                fixed: "right",
                render: (_, row) => {
                  const canTerminate =
                    row.status === "ACTIVE" || row.status === "PENDING";
                  if (!canTerminate)
                    return <span className="text-12 muted">—</span>;
                  return (
                    <Button
                      danger
                      loading={terminating === row.id}
                      onClick={() => handleTerminate(row)}
                    >
                      解除
                    </Button>
                  );
                },
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}
