"use client";

import {
  ApiOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  CONTENT_CONNECTOR_TRANSPORT_LABELS,
  CONTENT_CONNECTOR_TRANSPORTS,
  MCP_ENDPOINT_PATH,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  mcpOperations,
} from "@enterprise/contracts";
import type {
  ContentAgentConnector,
  ContentConnectorTransport,
} from "@enterprise/contracts";
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Switch,
  Tag,
} from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { contentApi } from "@/api/content";
import { Notice, Panel } from "@/components/ui/panel";
import { joinSiteUrl } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";

type ConnectorDraft = {
  name: string;
  transport: ContentConnectorTransport;
  url: string;
  headers: string;
  enabled: boolean;
};

const EMPTY_DRAFT: ConnectorDraft = {
  name: "",
  transport: "http",
  url: "",
  headers: "",
  enabled: true,
};

/** 内置连接器背后的业务能力：与 `/developer/mcp` 的「业务能力总览」同一份契约派生。 */
const BUILTIN_OPS = mcpOperations();
const BUILTIN_OP_TOTAL = BUILTIN_OPS.length;
const BUILTIN_DOMAINS = (() => {
  const byDomain = new Map<string, { label: string; total: number }>();
  for (const row of BUILTIN_OPS) {
    const item = byDomain.get(row.domain) ?? { label: row.domainLabel, total: 0 };
    item.total += 1;
    byDomain.set(row.domain, item);
  }
  return [...byDomain.values()].sort(
    (left, right) =>
      right.total - left.total || left.label.localeCompare(right.label, "zh-CN"),
  );
})();
const BUILTIN_OP_DOMAINS = BUILTIN_DOMAINS.length;
const BUILTIN_DOMAIN_BRIEF = BUILTIN_DOMAINS.slice(0, 8)
  .map((row) => `${row.label} ${row.total}`)
  .join("、");
const BUILTIN_TOOL_TITLES = MCP_TOOL_NAMES.map(
  (name) => `${MCP_TOOLS[name].title}（${name}）`,
);

/**
 * Agent 的 MCP 连接器：内置一个是本站 MCP Server（与 /api/v1/mcp 同一服务、同一条授权闸，只读不可删），
 * 其余由用户自己添加外部 MCP 服务（Streamable HTTP / 旧版 SSE）。
 * 启用后它们的工具会以 `mcp__c<id>__` 前缀发布给 Agent 调用；连不上的连接器只记录错误，不挡对话。
 */
export function AgentConnectorsTab() {
  const { message } = App.useApp();
  // 内置连接器的完整地址：外部 MCP 客户端要绝对 URL，域名跟站点配置走
  const siteBase = useSiteBase();
  const [rows, setRows] = useState<ContentAgentConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContentAgentConnector | null>(null);
  const [draft, setDraft] = useState<ConnectorDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    tools: string[];
  } | null>(null);
  const [toggling, setToggling] = useState(0);
  const [testingRow, setTestingRow] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await contentApi.connectors();
      setRows(list || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "MCP 连接器加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchDraft = (patch: Partial<ConnectorDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setTestResult(null);
  };

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setTestResult(null);
    setOpen(true);
  };

  const openEdit = (row: ContentAgentConnector) => {
    setEditing(row);
    setDraft({
      name: row.name,
      transport:
        row.transport === "sse" ? "sse" : ("http" as ContentConnectorTransport),
      url: row.url,
      // 请求头的值只进不出：留空＝保持原值，重新填写＝整体替换
      headers: "",
      enabled: row.enabled,
    });
    setTestResult(null);
    setOpen(true);
  };

  const draftBody = () => ({
    name: draft.name.trim(),
    transport: draft.transport,
    url: draft.url.trim(),
    enabled: draft.enabled,
    // 编辑时不传 headers ＝ 保留已存的请求头
    ...(draft.headers.trim() ? { headers: draft.headers } : {}),
    ...(!editing && !draft.headers.trim() ? { headers: "" } : {}),
  });

  const test = async () => {
    if (!draft.url.trim()) {
      message.warning("请先填写服务地址");
      return;
    }
    setTesting(true);
    try {
      const result = await contentApi.testConnector(
        {
          body: {
            ...(editing ? { id: editing.id } : {}),
            transport: draft.transport,
            url: draft.url.trim(),
            ...(draft.headers.trim() ? { headers: draft.headers } : {}),
          },
        },
        { timeoutMs: 60000 },
      );
      setTestResult({
        ok: Boolean(result?.ok),
        message: result?.message || "",
        tools: result?.tools || [],
      });
    } catch (caught) {
      setTestResult({
        ok: false,
        message: (caught as Error).message || "测试连接失败",
        tools: [],
      });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const body = draftBody();
    if (!body.name) {
      message.warning("请填写连接器名称");
      return;
    }
    if (!body.url) {
      message.warning("请填写服务地址");
      return;
    }
    setSaving(true);
    try {
      const row = editing
        ? await contentApi.updateConnector(
            { params: { id: String(editing.id) }, body },
            { timeoutMs: 60000 },
          )
        : await contentApi.createConnector({ body }, { timeoutMs: 60000 });
      if (!row) throw new Error("保存没有返回结果");
      setOpen(false);
      await load();
      message.success(
        editing ? `连接器「${row.name}」已保存` : `已添加连接器「${row.name}」`,
      );
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: ContentAgentConnector, enabled: boolean) => {
    setToggling(row.id);
    try {
      const updated = await contentApi.updateConnector({
        params: { id: String(row.id) },
        body: { enabled },
      });
      if (updated) {
        setRows((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
    } catch (caught) {
      message.error((caught as Error).message || "操作失败");
    } finally {
      setToggling(0);
    }
  };

  const testSaved = async (row: ContentAgentConnector) => {
    setTestingRow(row.id);
    try {
      const result = await contentApi.testConnector(
        { body: { id: row.id } },
        { timeoutMs: 60000 },
      );
      if (result?.ok) {
        message.success(
          result.message || `连接成功，发现 ${result.toolCount} 个工具`,
        );
      } else {
        message.error(result?.message || "连接失败");
      }
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "测试连接失败");
    } finally {
      setTestingRow(0);
    }
  };

  const remove = async (row: ContentAgentConnector) => {
    try {
      await contentApi.removeConnector({ params: { id: String(row.id) } });
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      message.success("连接器已删除");
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  const builtin = rows.find((row) => row.id === 0);
  const custom = rows.filter((row) => row.id > 0);

  const copyClientConfig = async () => {
    const endpoint = joinSiteUrl(siteBase, builtin?.url || MCP_ENDPOINT_PATH);
    const text = `{
  "mcpServers": {
    "aiworkin-enterprise": {
      "type": "http",
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer ek_你的Key" }
    }
  }
}`;
    try {
      await navigator.clipboard.writeText(text);
      message.success("客户端配置已复制，把 ek_你的Key 换成自己的 Key 即可连接");
    } catch {
      message.error("复制失败：浏览器未开放剪贴板权限");
    }
  };

  return (
    <Panel
      title="MCP 连接器"
      titleExtra={
        <span className="text-12 muted">
          内置本站 MCP Server；添加外部 MCP 后，它的工具会直接交给 Agent
          调用（工具名带 mcp__ 前缀），连不上只记录错误不耽误对话
        </span>
      }
      extra={
        <Button icon={<PlusOutlined aria-hidden />} onClick={openCreate}>
          添加MCP
        </Button>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}

      {!loading && builtin ? (
        <div
          style={{
            border: "1px solid #ececf0",
            borderRadius: 10,
            padding: "12px 14px",
            display: "grid",
            gap: 8,
            background: "#fafbfc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong>{builtin.name}</strong>
            <Tag color="processing">内置</Tag>
            <Tag color="success">启用中</Tag>
            <Tag>{builtin.toolCount} 个元工具</Tag>
            <Tag>{BUILTIN_OP_TOTAL} 个业务接口</Tag>
            <Tag>{BUILTIN_OP_DOMAINS} 个业务域</Tag>
            <span style={{ flex: 1 }} />
            <Button
              icon={<CopyOutlined aria-hidden />}
              onClick={() => void copyClientConfig()}
            >
              复制配置
            </Button>
            <Link href="/developer/mcp" className="text-12">
              <LinkOutlined aria-hidden /> 接入说明
            </Link>
          </div>
          <span className="text-12 muted">
            地址：<span className="mono">{joinSiteUrl(siteBase, builtin.url) || builtin.url}</span>
            （外部客户端用本站 API Key 连接；与 Agent 内部调用同一套业务接口和授权闸）
          </span>
          <span className="text-12 muted">
            元工具：{BUILTIN_TOOL_TITLES.join("、")}
          </span>
          <span className="text-12 muted">
            覆盖：{BUILTIN_DOMAIN_BRIEF}
            {BUILTIN_OP_DOMAINS > 8 ? ` 等 ${BUILTIN_OP_DOMAINS} 个业务域` : ""}
          </span>
          <span className="text-12 muted">
            {BUILTIN_OP_TOTAL} 个业务接口由「接口清单」按业务域发现、用「接口详情」取参数结构，再交给「读取数据」/「写入数据」执行；
            写动作未获授权的只返回草案，不会落库。读/写明细见「接入说明」里的业务能力总览。
          </span>
        </div>
      ) : null}

      {!loading && !custom.length ? (
        <div style={{ marginTop: builtin ? 16 : 0 }}>
          <Empty
            image={
              <ApiOutlined
                style={{ fontSize: 40, color: "#bfbfbf" }}
                aria-hidden
              />
            }
            description="还没有自定义 MCP：点「添加MCP」，填外部 MCP 服务的地址和请求头即可接入"
          />
        </div>
      ) : null}

      {!loading && custom.length ? (
        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          {custom.map((row) => (
            <div
              key={row.id}
              style={{
                border: "1px solid var(--line, #f0f0f0)",
                borderRadius: 10,
                padding: "10px 12px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{row.name}</strong>
                <Tag>{CONTENT_CONNECTOR_TRANSPORT_LABELS[row.transport === "sse" ? "sse" : "http"]}</Tag>
                <Tag color={row.enabled ? "success" : "default"}>
                  {row.enabled ? "启用中" : "已停用"}
                </Tag>
                <Tag>{row.toolCount} 个工具</Tag>
                <span style={{ flex: 1 }} />
                <Button
                  icon={<ThunderboltOutlined aria-hidden />}
                  loading={testingRow === row.id}
                  onClick={() => void testSaved(row)}
                >
                  测试连接
                </Button>
                <Button
                  icon={<EditOutlined aria-hidden />}
                  onClick={() => openEdit(row)}
                >
                  编辑
                </Button>
                <Switch
                  size="small"
                  checked={row.enabled}
                  loading={toggling === row.id}
                  onChange={(enabled) => void toggle(row, enabled)}
                />
                <Popconfirm
                  title="删除这个连接器？"
                  description="删除后它发布的工具会从 Agent 里移除。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => void remove(row)}
                >
                  <Button danger icon={<DeleteOutlined aria-hidden />}>
                    删除
                  </Button>
                </Popconfirm>
              </div>
              <span className="text-12 muted">
                地址：<span className="mono">{row.url}</span>
                {row.headerNames.length
                  ? ` · 请求头：${row.headerNames.join("、")}`
                  : ""}
              </span>
              {row.tools.length ? (
                <span className="text-12 muted">
                  工具：{row.tools.slice(0, 12).join("、")}
                  {row.tools.length > 12 ? ` 等 ${row.tools.length} 个` : ""}
                </span>
              ) : null}
              {row.lastError ? (
                <span className="text-12" style={{ color: "var(--danger, #d4380d)" }}>
                  最近一次连接失败：{row.lastError}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <Modal
        title={editing ? `编辑连接器 · ${editing.name}` : "添加 MCP"}
        open={open}
        onCancel={() => {
          if (!saving && !testing) setOpen(false);
        }}
        maskClosable={!saving && !testing}
        width={600}
        footer={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button
              icon={<ThunderboltOutlined aria-hidden />}
              loading={testing}
              onClick={() => void test()}
            >
              测试连接
            </Button>
            <span style={{ flex: 1 }} />
            <Button
              onClick={() => setOpen(false)}
              disabled={saving || testing}
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={testing}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="text-12 muted">名称</span>
            <Input
              value={draft.name}
              maxLength={60}
              placeholder="例如：公司知识库"
              onChange={(event) => patchDraft({ name: event.target.value })}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="text-12 muted">接入方式</span>
            <Select
              value={draft.transport}
              onChange={(value) => patchDraft({ transport: value })}
              options={CONTENT_CONNECTOR_TRANSPORTS.map((value) => ({
                value,
                label: CONTENT_CONNECTOR_TRANSPORT_LABELS[value],
              }))}
              style={{ width: 220 }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="text-12 muted">服务地址</span>
            <Input
              value={draft.url}
              maxLength={500}
              placeholder="https://example.com/mcp"
              onChange={(event) => patchDraft({ url: event.target.value })}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="text-12 muted">
              请求头（每行一个 <span className="mono">Name: value</span>，可留空）
            </span>
            <Input.TextArea
              value={draft.headers}
              autoSize={{ minRows: 3, maxRows: 6 }}
              placeholder={
                editing
                  ? "留空＝保持已保存的请求头；填写＝整体替换"
                  : "Authorization: Bearer xxx"
              }
              onChange={(event) => patchDraft({ headers: event.target.value })}
            />
            <span className="text-12 muted">
              请求头的值加密保存在本系统，保存后只显示名字，不再回显。
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Switch
              size="small"
              checked={draft.enabled}
              onChange={(enabled) => patchDraft({ enabled })}
            />
            <span className="text-12 muted">
              启用后把这个服务的工具交给 Agent 调用
            </span>
          </label>
          {testResult ? (
            <Notice variant={testResult.ok ? "success" : "error"}>
              {testResult.message}
              {testResult.tools.length
                ? `：${testResult.tools.slice(0, 12).join("、")}${testResult.tools.length > 12 ? "…" : ""}`
                : ""}
            </Notice>
          ) : null}
        </div>
      </Modal>
    </Panel>
  );
}
