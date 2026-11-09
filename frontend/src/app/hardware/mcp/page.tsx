"use client";

import { CopyOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { App, Button, Popconfirm, Select, Skeleton, Space, Switch, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HW_MCP_ENDPOINT_PATH,
  HW_MCP_INSTRUCTIONS,
  HW_MCP_SERVER_NAME,
  HW_MCP_SERVER_TITLE,
  HW_MCP_SERVER_VERSION,
  HW_TOOL_KIND_LABELS,
  HW_TOOL_SCOPE_LABELS,
  HW_TOOL_TRANSPORT_LABELS,
  type HwModel,
  type HwTool,
  type HwToolGrant,
  type HwToolSaveBody,
} from "@enterprise/contracts";
import { hardwareApi } from "@/api/hardware";
import { EmptyState, Notice, PageHero, Panel } from "@/components/ui/panel";
import { joinSiteUrl, SITE_BASE_PLACEHOLDER } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";
import { ToolEditorModal } from "../_components/tool-editor-modal";
import { ToolTrialModal } from "../_components/tool-trial-modal";

const codeBlockStyle = {
  margin: "8px 0 0",
  padding: "10px 12px",
  fontSize: 11,
  lineHeight: 1.6,
  color: "var(--text-2)",
  background: "var(--bg-muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  overflow: "auto",
} as const;

function jsonText(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export default function HardwareMcpPage() {
  const { message } = App.useApp();
  const base = useSiteBase();
  const endpoint = joinSiteUrl(base || SITE_BASE_PLACEHOLDER, HW_MCP_ENDPOINT_PATH);

  const [models, setModels] = useState<HwModel[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [tools, setTools] = useState<HwTool[]>([]);
  const [grantedIds, setGrantedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [error, setError] = useState("");
  const [trialTool, setTrialTool] = useState<HwTool | null>(null);

  // 用户自建工具（仅本人可见可用）：在本页按 MCP 种类新增 / 编辑 / 删除。
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HwTool | null>(null);
  const [toolSaving, setToolSaving] = useState(false);

  // 写工具授权闸：全局列出本人可见工具，勾选即允许自动执行其写动作（整份覆盖保存）。
  const [grants, setGrants] = useState<HwToolGrant[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await hardwareApi.models({ query: {} });
      const list = data?.models ?? [];
      setModels(list);
      setSelectedCode((prev) => prev || list[0]?.code || "");
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "型号加载失败";
      setError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const loadTools = useCallback(async () => {
    if (!selectedCode) {
      setTools([]);
      setGrantedIds([]);
      return;
    }
    setToolsLoading(true);
    try {
      const data = await hardwareApi.tools({ params: { code: selectedCode }, query: { kind: "MCP" } });
      setTools(data?.tools ?? []);
      setGrantedIds(data?.granted ?? []);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "工具加载失败");
    } finally {
      setToolsLoading(false);
    }
  }, [selectedCode, message]);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  const loadGrants = useCallback(async () => {
    setGrantsLoading(true);
    try {
      const data = await hardwareApi.toolGrants({ query: {} });
      const list = data?.tools ?? [];
      setGrants(list);
      setChecked(new Set(list.filter((item) => item.granted).map((item) => item.toolId)));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "授权清单加载失败");
    } finally {
      setGrantsLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const selectedModel = useMemo(
    () => models.find((item) => item.code === selectedCode),
    [models, selectedCode],
  );
  const grantedSet = useMemo(() => new Set(grantedIds), [grantedIds]);

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    } catch {
      message.warning("请手动复制");
    }
  };

  const toggleGrant = (toolId: number, value: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (value) next.add(toolId);
      else next.delete(toolId);
      return next;
    });
  };

  const saveGrants = async () => {
    setSaving(true);
    try {
      const result = await hardwareApi.toolSaveGrants({ body: { toolIds: [...checked] } });
      message.success(`授权已保存：新增 ${result?.granted ?? 0} 个、收回 ${result?.revoked ?? 0} 个`);
      await loadGrants();
      await loadTools();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "授权保存失败");
    } finally {
      setSaving(false);
    }
  };

  const submitTool = async (body: HwToolSaveBody) => {
    setToolSaving(true);
    try {
      if (editing) {
        await hardwareApi.toolUpdate({ params: { id: String(editing.id) }, body });
      } else {
        await hardwareApi.toolCreate({ params: { code: selectedCode }, body });
      }
      message.success("自建工具已保存");
      setEditorOpen(false);
      await Promise.all([loadTools(), loadGrants()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setToolSaving(false);
    }
  };

  const removeTool = async (tool: HwTool) => {
    try {
      await hardwareApi.toolRemove({ params: { id: String(tool.id) } });
      message.success("自建工具已删除");
      await Promise.all([loadTools(), loadGrants()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "删除失败");
    }
  };

  const configSnippet = `{
  "mcpServers": {
    "aiworkin-hardware": {
      "type": "http",
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer ek_你的Key" }
    }
  }
}`;

  const grantedCount = grants.filter((item) => checked.has(item.toolId)).length;

  return (
    <>
      <PageHero
        title="硬件MCP"
        desc="智能硬件独立 MCP 服务端 /api/v1/hardware/mcp，与平台 MCP 完全分开：tools/list 只返回本人可见的硬件工具。复用「开发者 → API Key」的 ek_ Key 鉴权，写动作受工具授权闸约束。"
      />

      <Panel title="接入信息">
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          <div className="text-12">
            服务端 <span className="mono">{HW_MCP_SERVER_NAME} {HW_MCP_SERVER_VERSION}</span>
            （{HW_MCP_SERVER_TITLE}）· 端点 <span className="mono">POST {HW_MCP_ENDPOINT_PATH}</span>
            {" · "}<Link href="/developer/keys">去管理 API Key</Link>
          </div>
          <pre className="mono" style={codeBlockStyle}>
            {`MCP 接入端点：${endpoint}
鉴权请求头：Authorization: Bearer <Enterprise ek_ Key>
            X-Api-Key: <Enterprise ek_ Key>（两种写法等价）`}
          </pre>
          <div className="text-12 muted">MCP 客户端配置示例（Streamable HTTP，可直接粘进 Claude Desktop / Cursor / Codex）：</div>
          <pre className="mono" style={codeBlockStyle}>{configSnippet}</pre>
          <Button icon={<CopyOutlined aria-hidden />} onClick={() => void copyText(configSnippet)}>
            复制配置
          </Button>
          <div className="text-12 muted" style={{ marginTop: 4 }}>服务端说明（initialize 返回的 instructions）：</div>
          <pre className="mono" style={{ ...codeBlockStyle, whiteSpace: "pre-wrap" }}>{HW_MCP_INSTRUCTIONS}</pre>
          <Notice variant="info">
            硬隔离：平台 MCP 在 /api/v1/mcp，硬件 MCP 在 /api/v1/hardware/mcp，两个端点各列各的工具，互不混入。
            写动作受三层授权闸约束：未授权只出草案、无人值守只出草案、dryRun 只出草案。授权在下方「写工具授权」勾选。
          </Notice>
        </Space>
      </Panel>

      <Panel
        title="MCP 工具"
        titleExtra={selectedModel ? <span className="text-12 muted">{selectedModel.name}</span> : null}
        extra={
          <Space wrap>
            <Select
              style={{ width: 240 }}
              value={selectedCode || undefined}
              placeholder="选择型号"
              onChange={setSelectedCode}
              options={models.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))}
            />
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              disabled={!selectedCode}
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              自建工具
            </Button>
          </Space>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        {loading || toolsLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
        {!loading && !toolsLoading && !tools.length ? (
          <EmptyState text="该型号暂无 MCP 工具；管理员可在后台维护型号默认工具，或自建工具后在这里查看。" />
        ) : null}
        {!loading && !toolsLoading && tools.length ? (
          <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 12 }}>
            {tools.map((tool) => {
              const isGranted = !tool.write || !tool.requiresGrant || grantedSet.has(tool.id);
              return (
                <div key={tool.id} className="card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <Space size={6} wrap>
                        <span style={{ fontWeight: 600 }}>{tool.name}</span>
                        <Tag>{HW_TOOL_SCOPE_LABELS[tool.scope]}</Tag>
                        <Tag color="blue">{HW_TOOL_TRANSPORT_LABELS[tool.transport]}</Tag>
                        {tool.write ? <Tag color="orange">写动作</Tag> : <Tag color="green">只读</Tag>}
                        {tool.write && tool.requiresGrant ? (
                          isGranted ? <Tag color="success">已授权</Tag> : <Tag color="warning">未授权</Tag>
                        ) : null}
                      </Space>
                      <div className="mono text-12 muted" style={{ marginTop: 4 }}>{tool.toolName}</div>
                      {tool.description ? <div className="text-12" style={{ marginTop: 6 }}>{tool.description}</div> : null}
                    </div>
                    <Space size={6}>
                      {tool.scope === "USER" ? (
                        <>
                          <Button
                            icon={<EditOutlined aria-hidden />}
                            onClick={() => {
                              setEditing(tool);
                              setEditorOpen(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Popconfirm
                            title={`删除自建工具「${tool.name}」？`}
                            onConfirm={() => void removeTool(tool)}
                          >
                            <Button danger icon={<DeleteOutlined aria-hidden />}>删除</Button>
                          </Popconfirm>
                        </>
                      ) : null}
                      <Button type="primary" icon={<ExperimentOutlined aria-hidden />} onClick={() => setTrialTool(tool)}>
                        试调
                      </Button>
                    </Space>
                  </div>
                  <div className="text-12 muted" style={{ marginTop: 10 }}>inputSchema</div>
                  <pre className="mono" style={{ ...codeBlockStyle, maxHeight: 200 }}>{jsonText(tool.params)}</pre>
                </div>
              );
            })}
          </Space>
        ) : null}
      </Panel>

      <Panel
        title="写工具授权"
        titleExtra={<span className="text-12 muted">已授权 {grantedCount} / 共 {grants.length} 个工具</span>}
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined aria-hidden />}
            loading={saving}
            disabled={grantsLoading}
            onClick={() => void saveGrants()}
          >
            保存授权
          </Button>
        }
      >
        <Notice variant="warn">
          授权闸只约束写动作工具（会改设备状态 / 下发指令）：勾选后，站内 Agent 与外部 MCP 客户端可在你的设备上自动执行其写动作；
          未勾选时写动作只返回草案，无人值守（定时任务 / 助理）默认也只出草案。只读工具无需授权即可调用。保存为整份覆盖。
        </Notice>
        {grantsLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
        {!grantsLoading && !grants.length ? (
          <EmptyState text="还没有可见的硬件工具；先在「硬件广场」接入设备所属型号，或自建工具。" />
        ) : null}
        {!grantsLoading && grants.length ? (
          <Space orientation="vertical" size={8} style={{ width: "100%", marginTop: 12 }}>
            {grants.map((item) => (
              <div
                key={item.toolId}
                className="card"
                style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
              >
                <div style={{ minWidth: 0 }}>
                  <Space size={6} wrap>
                    <span style={{ fontWeight: 600 }}>{item.name}</span>
                    <Tag>{item.modelCode}</Tag>
                    <Tag>{HW_TOOL_KIND_LABELS[item.kind]}</Tag>
                    <Tag color="blue">{HW_TOOL_TRANSPORT_LABELS[item.transport]}</Tag>
                  </Space>
                  <div className="mono text-12 muted" style={{ marginTop: 2 }}>{item.code}</div>
                </div>
                <Switch
                  checked={checked.has(item.toolId)}
                  onChange={(value) => toggleGrant(item.toolId, value)}
                  checkedChildren="授权"
                  unCheckedChildren="草案"
                />
              </div>
            ))}
          </Space>
        ) : null}
      </Panel>

      <ToolEditorModal
        open={editorOpen}
        initial={editing}
        lockKind="MCP"
        saving={toolSaving}
        onClose={() => setEditorOpen(false)}
        onSubmit={submitTool}
      />
      <ToolTrialModal tool={trialTool} onClose={() => setTrialTool(null)} />
    </>
  );
}