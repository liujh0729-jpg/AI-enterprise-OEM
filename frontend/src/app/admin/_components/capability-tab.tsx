"use client";
import { useOperationMutation } from "@/query/business";
import { adminApi } from "@/api/admin";

import { ThunderboltOutlined } from "@ant-design/icons";
import { App, Button, Table } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";

import { PermissionNotice, useAdminData } from "./common";

type CapabilityRequest = import("@enterprise/contracts").CapabilityRequest;

/** 审核对象：企业申请行归一为企业 + 可选的税号 / 当前匹配账号。 */
type ApproveTarget = {
  enterpriseId: number;
  name: string;
  taxNo?: string;
  qxyAccountName?: string;
};

/**
 * 服务商能力开通：服务商在「财税服务 · 财税自动化」按服务企业提交付费开通申请
 * （含开通时间），请求进入本页「待审核」；企业维度的开通 / 关闭与企享云账号匹配
 * 统一在「平台管理后台 · 财税管理」处理，本页只保留服务商提交的申请审核。
 */
export function CapabilityTab() {
  const admin_setCapabilityMutation = useOperationMutation(
    adminApi.setCapability,
    ["*"],
  );

  const router = useRouter();
  const { message, modal } = App.useApp();
  const [requestPage, setRequestPage] = useState(1);
  const requestsQuery = useAdminData(
    "capability-requests",
    (signal) =>
      adminApi.requestPage(
        { query: { page: requestPage, pageSize: 20 } },
        { signal },
      ),
    { page: requestPage },
  );
  const requests = requestsQuery.data?.list ?? [];
  const [busy, setBusy] = useState("");

  /** 审核通过：必须先由平台在「财税管理」给企业税号匹配企享云账号，否则引导去匹配。 */
  const approve = (target: ApproveTarget, code: string, label: string) => {
    const needsMatch = !target.qxyAccountName;
    modal.confirm({
      title: needsMatch
        ? `「${target.name}」的税号尚未匹配财税 API Key`
        : `开通「${label}」`,
      okText: needsMatch ? "前往财税管理" : "确认开通",
      cancelText: "取消",
      content: needsMatch
        ? `请先在「财税管理」给该企业的税号「${target.taxNo || "未登记"}」匹配企享云报税 API Key（新增账号或绑定税号），再回到本页审核开通。`
        : `为「${target.name}」开通${label}？开通后该企业的财务人员即可使用对应功能。`,
      onOk: async () => {
        if (needsMatch) {
          router.push("/admin/tax-admin");
          return;
        }
        setBusy(`${target.enterpriseId}-${code}`);
        try {
          await admin_setCapabilityMutation.mutateAsync({
            params: { id: String(target.enterpriseId), code: String(code) },
            body: { action: "open" },
          });
          message.success("已开通");
          void requestsQuery.reload();
        } finally {
          setBusy("");
        }
      },
    });
  };

  return (
    <>
      <PermissionNotice denied={requestsQuery.denied} />

      <Notice variant="info">
        服务商在「财税服务 · <ThunderboltOutlined aria-hidden />
        财税自动化」按服务企业提交付费开通申请（需填开通时间），申请进入本页「待审核」；
        平台先到「财税管理 · 账号池」录入企享云报税 API Key，再给企业税号匹配账号并
        <b>审核开通</b>。企业维度的开通 / 关闭与账号匹配统一在「财税管理」处理，本页只负责
        服务商提交的申请审核。
      </Notice>

      <Panel
        title="服务商付费开通申请（待审核）"
        titleBadge={
          requestsQuery.data ? `${requestsQuery.data.total} 条` : undefined
        }
      >
        <div className="table-wrap">
          <Table<CapabilityRequest>
            rowKey="id"
            pagination={{
              current: requestPage,
              pageSize: 20,
              total: requestsQuery.data?.total ?? 0,
              onChange: setRequestPage,
              showSizeChanger: false,
            }}
            loading={requestsQuery.loading}
            size="middle"
            dataSource={requests}
            columns={[
              {
                title: "企业",
                dataIndex: "enterpriseName",
                render: (value: string) => value || "—",
              },
              {
                title: "税号",
                dataIndex: "taxNo",
                width: 190,
                render: (value?: string) => (
                  <span className={value ? "mono text-12" : "text-danger"}>
                    {value || "缺税号"}
                  </span>
                ),
              },
              {
                title: "已匹配账号",
                dataIndex: "qxyAccountName",
                width: 160,
                render: (value?: string) =>
                  value ? (
                    <span className="badge badge-green">{value}</span>
                  ) : (
                    <span className="text-danger">未匹配</span>
                  ),
              },
              { title: "能力", dataIndex: "label", width: 200 },
              {
                title: "开通时间",
                dataIndex: "opensAt",
                width: 120,
                render: (value?: string) =>
                  value ? (
                    <span className="mono text-12">{value}</span>
                  ) : (
                    <span className="muted">—</span>
                  ),
              },
              {
                title: "配置人",
                dataIndex: "requestedByName",
                width: 140,
                render: (value: string) => value || "—",
              },
              {
                title: "备注",
                dataIndex: "note",
                render: (value: string) => value || "—",
              },
              {
                title: "操作",
                width: 130,
                render: (_, row) => (
                  <Button
                    type="primary"
                    loading={busy === `${row.enterpriseId}-${row.code}`}
                    onClick={() =>
                      approve(
                        {
                          enterpriseId: row.enterpriseId,
                          name: row.enterpriseName,
                          taxNo: row.taxNo,
                          qxyAccountName: row.qxyAccountName,
                        },
                        row.code,
                        row.label,
                      )
                    }
                  >
                    审核通过
                  </Button>
                ),
              },
            ]}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<ThunderboltOutlined aria-hidden />}
                  text="暂无待审核申请：服务商在「财税服务 · 财税自动化」提交付费开通申请（含开通时间）后会出现在这里。"
                />
              ),
            }}
          />
        </div>
      </Panel>
    </>
  );
}
