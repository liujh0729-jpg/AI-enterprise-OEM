"use client";

import { App, Button, Modal, Select, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { ImConnector, ImStaffDirectory } from "@enterprise/contracts";
import { imApi } from "@/api/im";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { SendMessageButton } from "./send-message-button";

type Directory = ImStaffDirectory;
type LocalRow = Directory["locals"][number];
type LocalLink = LocalRow["links"][number];
type ImOnlyRow = Directory["imOnly"][number];

const LINK_STATUS_LABELS: Record<string, string> = {
  LINKED: "已绑定",
  PENDING: "待确认",
  UNLINKED: "未绑定",
};

function statusLabel(value: string) {
  return LINK_STATUS_LABELS[value] || value;
}

function linkOf(row: LocalRow, connectorId: number) {
  return row.links.find(
    (item) => item.connectorId === connectorId && item.status === "LINKED",
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="text-12 muted">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>{value}</div>
      {sub ? <div className="text-12 muted">{sub}</div> : null}
    </div>
  );
}

/**
 * 组织 ↔ IM 的非对称映射总览：
 * 本系统在职人数、每个 IM 连接器拉到的成员数、已对应与两侧未对应都分开算，
 * 不假设「本系统 100 人＝飞书 40 人＋企微 140 人」这种一一对应。
 */
export function ImMappingOverview({
  connectors,
  reload,
}: {
  connectors: ImConnector[];
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [connectorId, setConnectorId] = useState(0);
  const [data, setData] = useState<Directory | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState("");
  const [binding, setBinding] = useState<ImOnlyRow | null>(null);
  const [targetUserId, setTargetUserId] = useState("");

  useEffect(() => {
    setConnectorId((prev) =>
      connectors.some((item) => item.id === prev) ? prev : connectors[0]?.id || 0,
    );
  }, [connectors]);

  const load = useCallback(async () => {
    if (!connectorId) {
      setData(null);
      return;
    }
    setLoading(true);
    setFailed("");
    try {
      setData(await imApi.staffDirectory({ query: { connectorId } }));
    } catch (caught) {
      setFailed((caught as Error).message || "映射总览读取失败");
    } finally {
      setLoading(false);
    }
  }, [connectorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    await load();
    await reload();
  };

  const unbind = (link: LocalLink, name: string) => {
    request({
      title: "解除 IM 绑定",
      content: `解除后「${name}」不再与 ${link.providerLabel} 的「${link.name}」对应；IM 侧账号不动，本系统账号也不动。`,
      okText: "确认解绑",
      danger: true,
      onOk: async () => {
        await imApi.unlinkMember({
          params: { id: String(link.connectorId) },
          body: { linkId: link.id },
        });
        message.success("已解除绑定");
        await refresh();
      },
    });
  };

  const openBind = (row: ImOnlyRow) => {
    setTargetUserId("");
    setBinding(row);
  };

  const bind = async () => {
    if (!binding || !targetUserId) {
      message.warning("请选择要对应的本系统职员/代理人");
      return;
    }
    try {
      await imApi.linkMember({
        params: { id: String(binding.connectorId) },
        body: {
          memberUserId: targetUserId,
          externalUserId: binding.externalUserId,
        },
      });
      message.success("已建立对应关系");
      setBinding(null);
      await refresh();
    } catch (caught) {
      message.error((caught as Error).message || "绑定失败");
    }
  };

  if (!connectors.length) {
    return (
      <Panel title="IM 映射总览">
        <EmptyState text="还没有 IM 连接器。先在「连接设置」建一个飞书或企业微信连接，再回来对照成员。" />
      </Panel>
    );
  }

  const picker =
    connectors.length > 1 ? (
      <Select
        style={{ width: 280 }}
        value={connectorId || undefined}
        options={connectors.map((item) => ({
          value: item.id,
          label: `${item.providerLabel} · ${item.name}`,
        }))}
        onChange={(value: number) => setConnectorId(value)}
      />
    ) : null;

  const locals = data?.locals || [];
  const imOnly = data?.imOnly || [];
  const localCount = locals.length;
  const linkedLocalCount = locals.filter((row) =>
    row.links.some((link) => link.status === "LINKED"),
  ).length;
  const noLinkLocalCount = localCount - linkedLocalCount;

  const localColumns: TableProps<LocalRow>["columns"] = [
    {
      title: "本系统职员 / 代理人",
      width: 200,
      render: (_value, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.memberName || row.memberUserId}</div>
          <div className="text-12 muted">
            {`${row.memberKindLabel}${row.department ? ` · ${row.department}` : ""}`}
          </div>
        </div>
      ),
    },
    {
      title: "IM 对应",
      render: (_value, row) =>
        row.links.length ? (
          <Space size={4} wrap>
            {row.links.map((link) => (
              <Tag
                key={`${link.connectorId}-${link.externalUserId}`}
                color={link.status === "LINKED" ? "green" : "default"}
                closable={link.status === "LINKED"}
                onClose={(event) => {
                  event.preventDefault();
                  unbind(link, row.memberName || row.memberUserId);
                }}
              >
                {`${link.providerLabel} · ${link.name || link.externalUserId}`}
              </Tag>
            ))}
          </Space>
        ) : (
          <span className="text-12 muted">未对应</span>
        ),
    },
    {
      title: "操作",
      width: 150,
      render: (_value, row) => (
        <SendMessageButton userId={row.memberUserId} name={row.memberName} />
      ),
    },
  ];

  const imColumns: TableProps<ImOnlyRow>["columns"] = [
    { title: "平台", dataIndex: "providerLabel", width: 100 },
    {
      title: "IM 成员",
      render: (_value, row) => (
        <div>
          <div>{row.name || row.externalUserId}</div>
          <div className="text-12 muted">{row.externalUserId}</div>
        </div>
      ),
    },
    { title: "手机", dataIndex: "mobile", width: 140 },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: string) => <Tag>{statusLabel(value)}</Tag>,
    },
    {
      title: "操作",
      width: 110,
      render: (_value, row) => (
        <Button type="link" size="small" onClick={() => openBind(row)}>
          对应到职员
        </Button>
      ),
    },
  ];

  const targetOptions = locals.map((row) => {
    const linked = Boolean(linkOf(row, binding?.connectorId || connectorId));
    return {
      value: row.memberUserId,
      disabled: linked,
      label: `${row.memberName || row.memberUserId} · ${row.memberKindLabel}${
        row.department ? ` · ${row.department}` : ""
      }${linked ? "（该连接器已绑定）" : ""}`,
    };
  });

  return (
    <Panel
      title="IM 映射总览"
      titleExtra={picker}
      extra={
        <Button loading={loading} onClick={() => void refresh()}>
          刷新
        </Button>
      }
    >
      {failed ? (
        <Notice variant="error">
          {failed} <Button onClick={() => void load()}>重试</Button>
        </Notice>
      ) : !data ? (
        <div className="text-12 muted">{loading ? "读取映射…" : "暂无映射数据"}</div>
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
          <Notice variant="info">
            两边不是一一对应：本系统在职 {localCount} 人，飞书与企业微信各自成员的集合也可能不同（有的只在飞书、有的只在企微，人数可多可少）。这里按连接器分别算「已对应」和两侧未对应；未对应不是错误，按需绑定即可。
          </Notice>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <Stat
              label="本系统在职"
              value={`${localCount} 人`}
              sub={`已对应过 ${linkedLocalCount} · 还没有任何对应 ${noLinkLocalCount}`}
            />
            {data.connectors.map((item) => {
              const localMissing = locals.filter((row) => !linkOf(row, item.id)).length;
              return (
                <Stat
                  key={item.id}
                  label={`${item.providerLabel} · ${item.name}`}
                  value={`IM ${item.counts.imMembers} 人`}
                  sub={`已对应 ${item.counts.linked} · 本系统未对应 ${localMissing} · IM 未对应 ${item.counts.imUnlinked}`}
                />
              );
            })}
            <Stat
              label="IM 未对应本系统"
              value={`${imOnly.length} 人`}
              sub="这些 IM 成员还不是本系统在职职员/代理人"
            />
          </div>

          <section>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {`本系统职员 / 代理人（${localCount}）`}
            </div>
            {locals.length ? (
              <div className="table-wrap">
                <Table<LocalRow>
                  rowKey="memberUserId"
                  size="middle"
                  loading={loading}
                  dataSource={locals}
                  columns={localColumns}
                  pagination={false}
                  scroll={{ x: "max-content" }}
                />
              </div>
            ) : (
              <EmptyState text="本组织还没有在职职员/代理人。先在「管理」页添加成员。" />
            )}
          </section>

          <section>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {`IM 有、本系统未对应（${imOnly.length}）`}
            </div>
            {imOnly.length ? (
              <div className="table-wrap">
                <Table<ImOnlyRow>
                  rowKey={(row) => `${row.connectorId}-${row.externalUserId}`}
                  size="middle"
                  loading={loading}
                  dataSource={imOnly}
                  columns={imColumns}
                  pagination={false}
                  scroll={{ x: "max-content" }}
                />
              </div>
            ) : (
              <div className="text-12 muted">IM 拉到的成员都已对应到本系统在职成员。</div>
            )}
          </section>
        </div>
      )}

      <Modal
        open={Boolean(binding)}
        title={`对应到本系统职员 · ${binding?.name || binding?.externalUserId || ""}`}
        okText="建立对应"
        destroyOnHidden
        onCancel={() => setBinding(null)}
        onOk={() => void bind()}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div className="text-12 muted">
            {`${binding?.providerLabel || ""} 成员「${binding?.name || binding?.externalUserId || ""}」对应到：`}
          </div>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: "100%" }}
            placeholder="选择本系统职员 / 代理人"
            value={targetUserId || undefined}
            options={targetOptions}
            onChange={(value: string) => setTargetUserId(value)}
          />
          <div className="text-12 muted">
            对应只建立 IM 与账号的映射，不会自动建账号；目标账号不在此列表时，先到「管理」页添加成员。
          </div>
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}