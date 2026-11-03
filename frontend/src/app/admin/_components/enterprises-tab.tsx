"use client";

import { adminApi } from "@/api/admin";
import { BankOutlined } from "@ant-design/icons";
import { Button, Table } from "antd";
import { demandPagination } from "@/components/demand-columns";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { PermissionNotice, fmtTime, useAdminData } from "./common";

type EnterpriseRow = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Admin_enterprises">["data"]
>[number];

const SUBJECT_TYPE_LABEL: Record<string, string> = {
  COMPANY: "企业",
  INDIVIDUAL: "个体工商户",
  PERSONAL: "个人",
};

/**
 * 企业用户管理——平台管理员查看已通过企业信息认证的用户。
 * 后端：GET /enterprise/admin/enterprises。
 */
export function EnterprisesTab() {
  const { data, loading, denied, reload } = useAdminData(
    "enterprises",
    (signal) => adminApi.enterprises({}, { signal }),
  );
  const rows = data ?? [];

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="企业用户"
        titleBadge={
          <span className="text-12 muted">
            已通过企业信息认证的用户，共 {rows.length} 条
          </span>
        }
        extra={<Button onClick={() => void reload()}>刷新</Button>}
      >
        <div className="table-wrap">
          <Table<EnterpriseRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={demandPagination}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<BankOutlined aria-hidden />}
                  text="暂无企业用户"
                />
              ),
            }}
            columns={[
              {
                title: "企业名称",
                width: 200,
                render: (_, row) => (
                  <span style={{ fontWeight: 600 }}>{row.name}</span>
                ),
              },
              {
                title: "主体类型",
                width: 120,
                render: (_, row) =>
                  SUBJECT_TYPE_LABEL[row.subjectType] || row.subjectType || "—",
              },
              {
                title: "统一社会信用代码",
                width: 200,
                render: (_, row) => (
                  <span className="mono text-12">{row.uscc || "—"}</span>
                ),
              },
              {
                title: "省份",
                width: 120,
                render: (_, row) =>
                  [row.province, row.city].filter(Boolean).join(" ") || "—",
              },
              {
                title: "行业",
                width: 140,
                render: (_, row) => row.industry || "—",
              },
              {
                title: "联系人",
                width: 120,
                render: (_, row) => row.legalPerson || "—",
              },
              {
                title: "电话",
                width: 140,
                render: (_, row) => row.phone || "—",
              },
              {
                title: "状态",
                width: 100,
                render: (_, row) => <StatusBadge status={row.status} />,
              },
              {
                title: "认证时间",
                width: 160,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {fmtTime(row.createdAt)}
                  </span>
                ),
              },
              {
                title: "更新时间",
                width: 160,
                render: (_, row) => (
                  <span className="text-12 muted">{fmtTime(row.updatedAt)}</span>
                ),
              },
            ]}
            scroll={{ x: 1500 }}
          />
        </div>
      </Panel>
    </>
  );
}
