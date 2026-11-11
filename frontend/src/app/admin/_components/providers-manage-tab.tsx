"use client";

import { SolutionOutlined } from "@ant-design/icons";
import { App, Button, Modal, Space, Table } from "antd";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { adminApi } from "@/api/admin";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { MICRO_DIRECT_TYPES } from "@/lib/provider-categories";
import {
  MICRO_TYPE,
  PermissionNotice,
  PROVIDER_TYPE_LABEL,
  SERVICE_CATEGORY_ORDER,
  fmtDate,
  providerTypeBadge,
  useAdminData,
  type ProviderManagedRow,
} from "./common";

type ServiceEntry = {
  type: string;
  service?: ProviderManagedRow["services"][number];
};

/** 服务类目行（本商已备案的带 service，未备案的为 undefined），顺序与备案表单一致。 */
function categoryEntries(row: ProviderManagedRow | null): ServiceEntry[] {
  const byType = new Map(
    (row?.services || [])
      .filter((service) => service.type !== MICRO_TYPE)
      .map((service) => [service.type, service]),
  );
  return SERVICE_CATEGORY_ORDER.map((type) => ({
    type,
    service: byType.get(type),
  }));
}

/** 小微服务商（MICRO 已生效）按直营口径覆盖的类目：物流 / 供销。 */
function directTypesOf(row: ProviderManagedRow | null): string[] {
  const active = (row?.services || []).some(
    (service) => service.type === MICRO_TYPE && service.status === "APPROVED",
  );
  return active ? MICRO_DIRECT_TYPES : [];
}

/**
 * 服务商管理（demo admin.js：renderProvidersMgmt）——一家服务商可开通一项或多项
 * 服务类目，可逐项停用/恢复（停用仅拦截该类目的新建业务）。
 * `MICRO`（小微服务商）是服务商类型（个人主体直营）、不是服务类目，单独展示与停用/恢复。
 * 后端：GET /enterprise/admin/providers、
 * POST /enterprise/admin/providers/:userId/services/:type/{revoke,restore}。
 */
export function ProvidersManageTab() {
  const { message, modal } = App.useApp();
  const [page, setPage] = useState(1);
  const { data, loading, denied } = useAdminData(
    "providers",
    (signal) =>
      adminApi.providerPage({ query: { page, pageSize: 20 } }, { signal }),
    { page },
  );
  const stats = useAdminData("provider-stats", (signal) =>
    adminApi.providerStats({}, { signal }),
  );
  const rows = data?.list ?? [];

  const [active, setActive] = useState<ProviderManagedRow | null>(null);
  const [busy, setBusy] = useState(false);
  const toggleMutation = useOperationMutation(
    ({
      userId,
      type,
      action,
    }: {
      userId: string;
      type: string;
      action: "revoke" | "restore";
    }) => adminApi[action]({ params: { userId, type } }),
    ["*"],
  );

  const toggle = async (
    row: ProviderManagedRow,
    type: string,
    action: "revoke" | "restore",
  ) => {
    setBusy(true);
    try {
      await toggleMutation.mutateAsync({ userId: row.userId, type, action });
      message.success(
        action === "revoke" ? "已停用该服务资质" : "已恢复该服务资质",
      );
      setActive(null);
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    } finally {
      setBusy(false);
    }
  };

  const revoke = (row: ProviderManagedRow, type: string) => {
    const label =
      type === MICRO_TYPE
        ? "物流 / 供销直营"
        : PROVIDER_TYPE_LABEL[type] || type;
    modal.confirm({
      title: "停用服务资质",
      okText: "确认停用",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: `停用后「${row.nickname}」将无法新建「${label}」业务（存量业务不受影响）。确定停用吗？`,
      onOk: () => toggle(row, type, "revoke"),
    });
  };

  const byType = new Map(
    (active?.services || [])
      .filter((service) => service.type !== MICRO_TYPE)
      .map((service) => [service.type, service]),
  );
  const microService = (active?.services || []).find(
    (service) => service.type === MICRO_TYPE,
  );
  const directTypes = directTypesOf(active);
  const approvedCount = [...byType.values()].filter(
    (service) => service.status === "APPROVED",
  ).length;

  /**
   * 资质行（服务类目与 `MICRO` 服务商类型共用同一版式）。
   * `direct` ＝ 该服务商小微直营覆盖、但未单独备案的类目（不可单独停用）。
   * `emptyHint` ＝ 该行「未开通」时的说明。
   */
  const renderServiceRow = (
    type: string,
    service?: ProviderManagedRow["services"][number],
    direct = false,
    emptyHint = "待服务商提交备案申请",
  ) => (
    <div
      key={type}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
      }}
    >
      {providerTypeBadge(type)}
      {service ? (
        <StatusBadge status={service.status} />
      ) : direct ? (
        <span className="badge badge-green">直营</span>
      ) : (
        <span className="badge">未开通</span>
      )}
      <span className="text-12 muted">
        {service
          ? service.auditedAt
            ? `最近审核：${fmtDate(service.auditedAt)}${
                service.auditNote ? ` · ${service.auditNote}` : ""
              }`
            : ""
          : direct
            ? "随「小微服务商」开通：工单自动派给本人，停用见上"
            : emptyHint}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        {service?.status === "APPROVED" ? (
          <Button
            danger
            disabled={busy}
            onClick={() => active && revoke(active, type)}
          >
            停用
          </Button>
        ) : null}
        {service?.status === "DELISTED" ? (
          <Button
            disabled={busy}
            onClick={() => active && void toggle(active, type, "restore")}
          >
            恢复
          </Button>
        ) : null}
        {service?.status === "PENDING" ? (
          <span className="badge badge-orange">待审核</span>
        ) : null}
        {service?.status === "REJECTED" ? (
          <span className="text-12 muted">服务商可重新申请</span>
        ) : null}
      </span>
    </div>
  );

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="服务商管理"
        titleBadge={
          <span className="badge badge-blue">
            {`${data?.total ?? "—"} 家服务商 · ${stats.data?.serviceTotal ?? "—"} 项服务类目`}
          </span>
        }
      >
        <p className="text-12 muted" style={{ marginTop: 0 }}>
          服务商可开通一项或多项服务类目（财税 / 出海 / 物流 / 法律 / 知识产权 /
          灵活用工 / 供销 / 营销 /
          资产交易）。停用某类目后不影响存量业务，但新建业务将被系统拦截；可随时恢复。小微服务商（个人主体直营）是服务商类型、不是服务类目，在「管理资质」中单独展示与停用
          / 恢复。
        </p>
        <div className="table-wrap">
          <Table<ProviderManagedRow>
            rowKey="userId"
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
            locale={{
              emptyText: (
                <EmptyState
                  icon={<SolutionOutlined aria-hidden />}
                  text="暂无服务商"
                />
              ),
            }}
            columns={[
              {
                title: "服务商",
                width: 180,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.nickname}</div>
                    {row.services.some(
                      (service) => service.type === MICRO_TYPE,
                    ) ? (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-green">小微服务商</span>
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "账号",
                width: 190,
                render: (_, row) => (
                  <div>
                    <div className="mono text-12">{row.userId}</div>
                    <div className="text-12 muted">{row.org || ""}</div>
                  </div>
                ),
              },
              {
                title: "服务类目（状态）",
                width: 420,
                render: (_, row) => {
                  const directTypes = directTypesOf(row);
                  const categories = categoryEntries(row).filter(
                    (entry) =>
                      entry.service || directTypes.includes(entry.type),
                  );
                  return categories.length ? (
                    <div>
                      {categories.map(({ type, service }) => (
                        <div
                          key={type}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          {providerTypeBadge(type)}
                          {service ? (
                            <StatusBadge status={service.status} />
                          ) : (
                            <span className="badge badge-green">直营</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-12 muted">—</span>
                  );
                },
              },
              {
                title: "账号状态",
                width: 120,
                render: () => <span className="text-12 muted">—</span>,
              },
              {
                title: "操作",
                width: 130,
                render: (_, row) => (
                  <Space size={6} wrap>
                    <Button onClick={() => setActive(row)}>管理资质</Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        open={Boolean(active)}
        title={`服务商资质管理 · ${active?.nickname || ""}`}
        width={640}
        onCancel={() => setActive(null)}
        footer={null}
      >
        <p className="text-12 muted" style={{ marginTop: 0 }}>
          {`一个服务商可同时开通多项服务类目（当前已备案 ${approvedCount} 项）。停用仅拦截对应类目的新建业务，存量业务不受影响；「未开通」类目由服务商在驾驶舱提交备案申请，审核通过后开通。`}
        </p>
        <div className="text-12" style={{ fontWeight: 600, marginBottom: 6 }}>
          服务商类型
        </div>
        {renderServiceRow(
          MICRO_TYPE,
          microService,
          false,
          "该服务商为服务商（普通）：业务指派到职员承办，未指派不可推进",
        )}
        <p className="text-12 muted" style={{ margin: "0 0 12px" }}>
          小微服务商＝个人主体直营（本人即唯一职员，物流 /
          供销工单自动派给本人），不是服务类目；停用后无法新建物流 / 供销业务。
        </p>
        <div className="text-12" style={{ fontWeight: 600, marginBottom: 6 }}>
          服务类目
        </div>
        {categoryEntries(active).map(({ type, service }) =>
          renderServiceRow(type, service, directTypes.includes(type)),
        )}
      </Modal>
    </>
  );
}
