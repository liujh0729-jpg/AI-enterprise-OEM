"use client";

import { adminApi } from "@/api/admin";
import { TeamOutlined } from "@ant-design/icons";
import { Button, Table } from "antd";
import { demandPagination } from "@/components/demand-columns";
import { EmptyState, Panel } from "@/components/ui/panel";
import {
  PermissionNotice,
  fmtDate,
  fmtTime,
  useAdminData,
} from "./common";

type UserRow = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Admin_users">["data"]
>[number];

/**
 * 注册用户管理——平台管理员查看本系统已识别的全部账号。
 * 后端：GET /enterprise/admin/users。
 */
export function UsersTab() {
  const { data, loading, denied, reload } = useAdminData("users", (signal) =>
    adminApi.users({}, { signal }),
  );
  const rows = data ?? [];

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="注册用户"
        titleBadge={
          <span className="text-12 muted">
            本系统已识别的全部账号，共 {rows.length} 条
          </span>
        }
        extra={<Button onClick={() => void reload()}>刷新</Button>}
      >
        <div className="table-wrap">
          <Table<UserRow>
            rowKey="userId"
            loading={loading}
            dataSource={rows}
            pagination={demandPagination}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<TeamOutlined aria-hidden />}
                  text="暂无注册用户"
                />
              ),
            }}
            columns={[
              {
                title: "用户名",
                width: 160,
                render: (_, row) => (
                  <span className="mono text-12">{row.username || "—"}</span>
                ),
              },
              {
                title: "昵称",
                width: 160,
                render: (_, row) => (
                  <span style={{ fontWeight: 600 }}>
                    {row.displayName || "—"}
                  </span>
                ),
              },
              {
                title: "邮箱",
                width: 200,
                render: (_, row) => row.email || "—",
              },
              {
                title: "邀请码",
                width: 110,
                render: (_, row) => (
                  <span className="mono text-12">{row.inviteCode || "—"}</span>
                ),
              },
              {
                title: "邀请人",
                width: 140,
                render: (_, row) => (
                  <span className="text-12">
                    {row.invitedByUsername || "—"}
                  </span>
                ),
              },
              {
                title: "角色",
                width: 120,
                render: (_, row) => row.role || "—",
              },
              {
                title: "状态",
                width: 100,
                render: (_, row) => (
                  <span
                    className={`badge ${row.enabled ? "badge-green" : "badge-gray"}`}
                  >
                    {row.enabled ? "启用" : "停用"}
                  </span>
                ),
              },
              {
                title: "注册时间",
                width: 160,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {fmtTime(row.createdAt)}
                  </span>
                ),
              },
              {
                title: "最近同步",
                width: 140,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {row.syncedAt ? fmtDate(row.syncedAt) : "—"}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}
