"use client";

import { App, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  manifestState,
  workbuddyApi,
  type PlanAccount,
  type WbAgentItem,
  type WbConnectorItem,
  type WbModelItem,
  type WbVersion,
} from "./common";
import { A2AStatusTag } from "./target-select";

type AgentForm = {
  agentName: string;
  description: string;
  avatarUrl: string;
  model: string;
  manifest: string;
  connectorIds: string[];
};

const EMPTY_AGENT: AgentForm = {
  agentName: "",
  description: "",
  avatarUrl: "",
  model: "",
  manifest: "",
  connectorIds: [],
};

type VersionForm = {
  manifest: string;
  model: string;
  description: string;
  sandboxTemplateId: string;
};

const EMPTY_VERSION: VersionForm = {
  manifest: "",
  model: "",
  description: "",
  sandboxTemplateId: "",
};

const PAGE_SIZE = 20;

/**
 * Agent：全部在腾讯云侧，按所选 Workbuddy Enterprise 账号（腾讯云 Key）取。
 * 名称 / 描述 / 头像可直接改；模型与 Manifest 属于版本内容，只能通过「新建版本」发布
 * （腾讯云 ModifyAgent 不接受这两项）。
 */
export function AgentPanel({ accounts }: { accounts: PlanAccount[] }) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const active = accounts.filter((item) => item.status === "active");
  const [accountId, setAccountId] = useState<number | undefined>(active[0]?.id);
  const [items, setItems] = useState<WbAgentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [models, setModels] = useState<WbModelItem[]>([]);
  const [modelError, setModelError] = useState("");
  const [connectors, setConnectors] = useState<WbConnectorItem[]>([]);
  const [connectorError, setConnectorError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<AgentForm>(EMPTY_AGENT);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<WbAgentItem | null>(null);
  const [editForm, setEditForm] = useState({
    agentName: "",
    description: "",
    avatarUrl: "",
  });

  const [versionAgent, setVersionAgent] = useState<WbAgentItem | null>(null);
  const [versions, setVersions] = useState<WbVersion[]>([]);
  const [versionTotal, setVersionTotal] = useState(0);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionForm, setVersionForm] = useState<VersionForm>(EMPTY_VERSION);
  const [versionSaving, setVersionSaving] = useState(false);

  const reload = useCallback(() => setRefreshToken((value) => value + 1), []);

  // 账号列表异步到达，或原账号被停用/删除时，自动落到第一个启用账号
  useEffect(() => {
    if (accountId && active.some((item) => item.id === accountId)) return;
    setAccountId(active[0]?.id);
    setPage(1);
    setKeyword("");
  }, [accountId, active]);

  useEffect(() => {
    if (!accountId) {
      setItems([]);
      setTotal(0);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    void workbuddyApi
      .agents({
        accountId,
        keyword,
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
      .then((result) => {
        if (!alive) return;
        setItems(result.data?.items || []);
        setTotal(result.data?.total || 0);
        setError(result.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [accountId, keyword, page, refreshToken]);

  useEffect(() => {
    setConnectors([]);
    setConnectorError("");
    if (!accountId) {
      setModels([]);
      return;
    }
    let alive = true;
    setModelError("");
    void workbuddyApi.builtinModels(accountId).then((result) => {
      if (!alive) return;
      setModels(result.data || []);
      setModelError(result.message);
    });
    return () => {
      alive = false;
    };
  }, [accountId, refreshToken]);

  const loadConnectors = async () => {
    if (!accountId) return;
    if (connectors.length && !connectorError) return;
    const result = await workbuddyApi.connectors(accountId);
    setConnectors(result.data || []);
    setConnectorError(result.message);
  };

  const loadVersions = async (agent: WbAgentItem) => {
    if (!accountId) return;
    setVersionsLoading(true);
    setVersionsError("");
    const result = await workbuddyApi.agentVersions({
      accountId,
      agentId: String(agent.AgentId || ""),
      limit: 100,
    });
    setVersions(result.data?.items || []);
    setVersionTotal(result.data?.total || 0);
    setVersionsError(result.message);
    setVersionsLoading(false);
  };

  const create = async () => {
    if (!accountId) return;
    if (!form.agentName.trim()) {
      message.error("请填写 Agent 名称");
      return;
    }
    const manifest = manifestState(form.manifest);
    if (manifest.error) {
      message.error(`Manifest ${manifest.error}`);
      return;
    }
    if (form.connectorIds.length && !form.manifest.trim()) {
      message.error("勾选了连接器就必须同时填 Manifest（连接器要写进 Manifest）");
      return;
    }
    setSaving(true);
    try {
      await workbuddyApi.createAgent({
        accountId,
        agentName: form.agentName.trim(),
        description: form.description.trim(),
        avatarUrl: form.avatarUrl.trim(),
        ...(form.model ? { model: form.model } : {}),
        ...(form.manifest.trim() ? { manifest: form.manifest } : {}),
        ...(form.connectorIds.length ? { connectorIds: form.connectorIds } : {}),
      });
      message.success("Agent 已创建");
      setCreateOpen(false);
      setForm(EMPTY_AGENT);
      reload();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = () => {
    if (!accountId || !editing) return;
    const agentId = String(editing.AgentId || "");
    const body = {
      accountId,
      agentId,
      agentName: editForm.agentName.trim(),
      description: editForm.description.trim(),
      avatarUrl: editForm.avatarUrl.trim(),
    };
    request({
      title: "修改 Agent（需密码）",
      content: `确认修改「${editForm.agentName}」？模型与 Manifest 请用「版本」发布新版本。`,
      okText: "保存修改",
      onOk: async () => {
        await workbuddyApi.updateAgent(body);
        setEditing(null);
        reload();
        message.success("Agent 已更新");
      },
    });
  };

  const remove = (row: WbAgentItem) => {
    if (!accountId) return;
    const agentId = String(row.AgentId || "");
    request({
      title: "删除 Agent",
      content: `确认删除「${row.AgentName || agentId}」？腾讯云侧会一并删除该 Agent 的版本与配置。`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await workbuddyApi.deleteAgent({ accountId, agentId });
        reload();
        message.success("Agent 已删除");
      },
    });
  };

  const createVersion = async () => {
    if (!accountId || !versionAgent) return;
    if (!versionForm.manifest.trim()) {
      message.error("请填写 Manifest");
      return;
    }
    const manifest = manifestState(versionForm.manifest);
    if (manifest.error) {
      message.error(`Manifest ${manifest.error}`);
      return;
    }
    setVersionSaving(true);
    try {
      await workbuddyApi.createAgentVersion({
        accountId,
        agentId: String(versionAgent.AgentId || ""),
        manifest: versionForm.manifest,
        model: versionForm.model,
        description: versionForm.description.trim(),
        sandboxTemplateId: versionForm.sandboxTemplateId.trim(),
      });
      message.success("新版本已发布");
      setVersionOpen(false);
      setVersionForm(EMPTY_VERSION);
      await loadVersions(versionAgent);
      reload();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setVersionSaving(false);
    }
  };

  const columns: ColumnsType<WbAgentItem> = [
    {
      title: "Agent",
      key: "agent",
      width: 220,
      render: (_, row) => (
        <div>
          <b>{row.AgentName || "未命名 Agent"}</b>
          <div className="text-12 muted">
            <Tooltip title={row.AgentId}>
              <span>{String(row.AgentId || "—").slice(0, 16)}…</span>
            </Tooltip>
          </div>
        </div>
      ),
    },
    {
      title: "描述",
      dataIndex: "Description",
      key: "Description",
      width: 240,
      ellipsis: true,
      render: (value: string) => value || "—",
    },
    {
      title: "模型",
      dataIndex: "Model",
      key: "Model",
      width: 170,
      ellipsis: true,
      render: (value: string) => value || "—",
    },
    {
      title: "最新版本",
      key: "version",
      width: 140,
      render: (_, row) => row.LatestVersionName || row.LatestVersionId || "—",
    },
    {
      title: "会话数",
      dataIndex: "SessionCount",
      key: "SessionCount",
      width: 80,
      render: (value: number) => value ?? 0,
    },
    {
      title: "A2A",
      key: "a2a",
      width: 110,
      render: (_, row) => <A2AStatusTag item={row} />,
    },
    {
      title: "创建时间",
      dataIndex: "CreatedTime",
      key: "CreatedTime",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_, row) => (
        <Space size={4}>
          <Button
            onClick={() => {
              setVersionAgent(row);
              setVersions([]);
              void loadVersions(row);
            }}
          >
            版本
          </Button>
          <Button
            onClick={() => {
              setEditing(row);
              setEditForm({
                agentName: row.AgentName || "",
                description: row.Description || "",
                avatarUrl: row.AvatarUrl || "",
              });
            }}
          >
            改
          </Button>
          <Button danger onClick={() => remove(row)}>
            删
          </Button>
        </Space>
      ),
    },
  ];

  const versionColumns: ColumnsType<WbVersion> = [
    {
      title: "版本",
      key: "version",
      width: 160,
      render: (_, row) => row.VersionName || row.VersionId || "—",
    },
    {
      title: "类型",
      dataIndex: "VersionType",
      key: "VersionType",
      width: 90,
      render: (value: string) => value || "—",
    },
    {
      title: "模型",
      dataIndex: "Model",
      key: "Model",
      width: 160,
      ellipsis: true,
      render: (value: string) => value || "—",
    },
    {
      title: "状态",
      dataIndex: "Status",
      key: "Status",
      width: 100,
      render: (value: string) => value || "—",
    },
    {
      title: "会话数",
      dataIndex: "SessionCount",
      key: "SessionCount",
      width: 80,
      render: (value: number) => value ?? 0,
    },
    {
      title: "创建时间",
      dataIndex: "CreatedTime",
      key: "CreatedTime",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
  ];

  const manifestHint = manifestState(form.manifest);
  const versionManifestHint = manifestState(versionForm.manifest);

  return (
    <Panel
      title="Agent"
      titleBadge={`${total} 个`}
      extra={
        <Space>
          <Select
            style={{ width: 220 }}
            value={accountId}
            placeholder="选择 Workbuddy Enterprise 账号"
            options={active.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onChange={(value) => {
              setAccountId(value);
              setPage(1);
              setKeyword("");
            }}
          />
          <Input.Search
            allowClear
            style={{ width: 220 }}
            placeholder="按名称搜索 Agent"
            onSearch={(value) => {
              setKeyword(value.trim());
              setPage(1);
            }}
          />
          <Button
            disabled={!accountId}
            onClick={() => {
              setForm(EMPTY_AGENT);
              setCreateOpen(true);
              void loadConnectors();
            }}
          >
            新建 Agent
          </Button>
        </Space>
      }
    >
      {active.length ? null : (
        <Notice variant="warn">
          还没有启用的 Workbuddy Enterprise 账号：先到「Workbuddy Enterprise 账号」页签绑定并启用腾讯云密钥。
        </Notice>
      )}
      {error ? (
        <div style={{ marginBottom: 10 }}>
          <Notice variant="error">{error}</Notice>
        </div>
      ) : null}
      {items.length ? (
        <Table<WbAgentItem>
          rowKey={(row) => String(row.AgentId || row.AgentName)}
          size="small"
          columns={columns}
          dataSource={items}
          loading={loading}
          scroll={{ x: "max-content" }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (value) => `共 ${value} 个`,
            onChange: setPage,
          }}
        />
      ) : (
        <EmptyState
          text={
            accountId
              ? "该账号下还没有 Agent：点右上角「新建 Agent」创建，或换一把凭据看看"
              : "选择一个 Workbuddy Enterprise 账号以查看它名下的 Agent"
          }
        />
      )}

      <Modal
        open={createOpen}
        title="新建 Agent"
        width={720}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void create()}
        okText={saving ? "创建中" : "创建"}
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Agent 名称" required>
            <Input
              value={form.agentName}
              maxLength={128}
              placeholder="如「竞品价格监控员」"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, agentName: event.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="描述">
            <Input.TextArea
              rows={2}
              value={form.description}
              maxLength={1000}
              placeholder="这个 Agent 擅长什么、什么时候用它"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="头像 URL">
            <Input
              value={form.avatarUrl}
              maxLength={500}
              placeholder="https://…（可选）"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, avatarUrl: event.target.value }))
              }
            />
          </Form.Item>
          <Form.Item
            label="内置模型"
            extra={
              modelError
                ? modelError
                : "来自腾讯云 DescribeBuiltinModelList；留空＝用默认模型"
            }
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={form.model || undefined}
              placeholder="选择模型"
              options={models.map((item) => ({
                value: String(item.ModelId || ""),
                label: `${item.Name || item.ModelId}${item.Vendor ? ` · ${item.Vendor}` : ""}`,
              }))}
              onChange={(value) =>
                setForm((prev) => ({ ...prev, model: value || "" }))
              }
            />
          </Form.Item>
          <Form.Item
            label="连接器"
            extra={
              connectorError
                ? connectorError
                : "可多选；勾选后必须在下面提供 Manifest（腾讯云要求连接器物化进 manifest）"
            }
          >
            <Select
              mode="multiple"
              value={form.connectorIds}
              placeholder="选择连接器（可选）"
              optionFilterProp="label"
              options={connectors.map((item) => ({
                value: String(item.ConnectorId || ""),
                label: `${item.Name || item.ConnectorId}${item.Type ? ` · ${item.Type}` : ""}`,
              }))}
              onChange={(values: string[]) =>
                setForm((prev) => ({ ...prev, connectorIds: values }))
              }
            />
          </Form.Item>
          <Form.Item
            label="Manifest"
            extra={
              manifestHint.error
                ? manifestHint.error
                : `Manifest v2.0 JSON 文本（可选；${manifestHint.bytes} 字节，上限 256 KiB）`
            }
          >
            <Input.TextArea
              rows={8}
              value={form.manifest}
              placeholder='{"version":"2.0", ...}'
              onChange={(event) =>
                setForm((prev) => ({ ...prev, manifest: event.target.value }))
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title={`修改 Agent${editing?.AgentName ? `（${editing.AgentName}）` : ""}`}
        width={620}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        okText="下一步（密码确认）"
        cancelText="取消"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Agent 名称" required>
            <Input
              value={editForm.agentName}
              maxLength={128}
              onChange={(event) =>
                setEditForm((prev) => ({
                  ...prev,
                  agentName: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="描述">
            <Input.TextArea
              rows={2}
              value={editForm.description}
              maxLength={1000}
              onChange={(event) =>
                setEditForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="头像 URL">
            <Input
              value={editForm.avatarUrl}
              maxLength={500}
              onChange={(event) =>
                setEditForm((prev) => ({
                  ...prev,
                  avatarUrl: event.target.value,
                }))
              }
            />
          </Form.Item>
          <div className="text-12 muted">
            模型与 Manifest 不能在这里改：用「版本」发布新版本后，腾讯云按版本生效。
          </div>
        </Form>
      </Modal>

      <Drawer
        open={Boolean(versionAgent)}
        onClose={() => setVersionAgent(null)}
        size={860}
        title={
          versionAgent
            ? `版本 · ${versionAgent.AgentName || versionAgent.AgentId}`
            : "版本"
        }
        extra={
          <Button
            onClick={() => {
              setVersionForm(EMPTY_VERSION);
              setVersionOpen(true);
            }}
          >
            新建版本
          </Button>
        }
        destroyOnHidden
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          {`共 ${versionTotal} 个版本；派发任务时选版本，留空＝用最新版本。`}
        </div>
        {versionsError ? (
          <div style={{ marginBottom: 10 }}>
            <Notice variant="error">{versionsError}</Notice>
          </div>
        ) : null}
        <Table<WbVersion>
          rowKey={(row) => String(row.VersionId || row.VersionName)}
          size="small"
          loading={versionsLoading}
          columns={versionColumns}
          dataSource={versions}
          scroll={{ x: "max-content" }}
          pagination={false}
        />
      </Drawer>

      <Modal
        open={versionOpen}
        title={`新建 Agent 版本${versionAgent?.AgentName ? ` · ${versionAgent.AgentName}` : ""}`}
        width={760}
        onCancel={() => setVersionOpen(false)}
        onOk={() => void createVersion()}
        okText={versionSaving ? "发布中" : "发布版本"}
        cancelText="取消"
        confirmLoading={versionSaving}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item
            label="Manifest"
            required
            extra={
              versionManifestHint.error
                ? versionManifestHint.error
                : `Manifest v2.0 JSON 文本（${versionManifestHint.bytes} 字节，上限 256 KiB）`
            }
          >
            <Input.TextArea
              rows={10}
              value={versionForm.manifest}
              placeholder='{"version":"2.0", ...}'
              onChange={(event) =>
                setVersionForm((prev) => ({
                  ...prev,
                  manifest: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="模型">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={versionForm.model || undefined}
              placeholder="留空＝沿用 Agent 当前模型"
              options={models.map((item) => ({
                value: String(item.ModelId || ""),
                label: `${item.Name || item.ModelId}${item.Vendor ? ` · ${item.Vendor}` : ""}`,
              }))}
              onChange={(value) =>
                setVersionForm((prev) => ({ ...prev, model: value || "" }))
              }
            />
          </Form.Item>
          <Form.Item label="版本说明">
            <Input
              value={versionForm.description}
              maxLength={500}
              placeholder="这版改了什么"
              onChange={(event) =>
                setVersionForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="沙箱模板 ID" extra="可选：指定运行沙箱模板">
            <Input
              value={versionForm.sandboxTemplateId}
              maxLength={64}
              placeholder="SandboxTemplateId"
              onChange={(event) =>
                setVersionForm((prev) => ({
                  ...prev,
                  sandboxTemplateId: event.target.value,
                }))
              }
            />
          </Form.Item>
        </Form>
      </Modal>
      {modal}
    </Panel>
  );
}
