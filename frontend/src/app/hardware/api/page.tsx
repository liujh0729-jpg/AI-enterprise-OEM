"use client";

import { CopyOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Popconfirm, Select, Skeleton, Space, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HW_TOOL_SCOPE_LABELS,
  HW_TOOL_TRANSPORT_LABELS,
  type HwModel,
  type HwTool,
  type HwToolSaveBody,
} from "@enterprise/contracts";
import { hardwareApi } from "@/api/hardware";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
} from "@/components/ui/panel";
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

export default function HardwareApiPage() {
  const { message } = App.useApp();
  const [origin, setOrigin] = useState("");
  const [models, setModels] = useState<HwModel[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [tools, setTools] = useState<HwTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [error, setError] = useState("");
  const [trialTool, setTrialTool] = useState<HwTool | null>(null);

  // 用户自建工具（仅本人可见可用）：在本页按 API 种类新增 / 编辑 / 删除。
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HwTool | null>(null);
  const [toolSaving, setToolSaving] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const baseUrl = origin ? `${origin}/api/v1/hardware` : "/api/v1/hardware";

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
      return;
    }
    setToolsLoading(true);
    try {
      const data = await hardwareApi.tools({ params: { code: selectedCode }, query: { kind: "API" } });
      setTools(data?.tools ?? []);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "工具加载失败");
    } finally {
      setToolsLoading(false);
    }
  }, [selectedCode, message]);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  const selectedModel = useMemo(
    () => models.find((item) => item.code === selectedCode),
    [models, selectedCode],
  );

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    } catch {
      message.warning("请手动复制");
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
      await loadTools();
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
      await loadTools();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "删除失败");
    }
  };

  const callExample = (tool: HwTool) =>
    `curl -X POST "${baseUrl}/tools/${selectedCode}/call" \\
  -H "Authorization: Bearer $ENTERPRISE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"toolCode":"${tool.code}","deviceId":<设备ID>,"args":{},"dryRun":false}'`;

  return (
    <>
      <PageHero
        title="硬件API"
        desc="硬件对外 REST 通道 /api/v1/hardware，复用「开发者 → API Key」的 ek_ Key 鉴权，与平台业务接口完全分开。按型号查看 API 工具、参数与示例，并可站内试调。"
      />

      <Panel title="接入方式">
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          <div className="text-12">
            基础地址：<span className="mono">{baseUrl}</span>
            {" · "}鉴权请求头：<span className="mono">Authorization: Bearer ek_...</span>
            {" · "}<Link href="/developer/keys">去管理 API Key</Link>
          </div>
          <div className="text-12 mono" style={{ lineHeight: 2 }}>
            <div>GET&nbsp; /api/v1/hardware/models — 型号目录</div>
            <div>GET&nbsp; /api/v1/hardware/models/:code/tools — 该型号工具（本人可见）</div>
            <div>POST /api/v1/hardware/tools/:code/call — 调用工具（body: toolCode / deviceId / args / dryRun）</div>
          </div>
          <Notice variant="info">
            写动作受三层授权闸约束：未授权只出草案、无人值守只出草案、dryRun 只出草案。MCP 接入与工具授权请到「硬件MCP」页。
          </Notice>
        </Space>
      </Panel>

      <Panel
        title="API 工具"
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
          <EmptyState text="该型号暂无 API 工具；管理员可在后台维护型号默认工具，或点右上「自建工具」添加仅本人可见的工具。" />
        ) : null}
        {!loading && !toolsLoading && tools.length ? (
          <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 12 }}>
            {tools.map((tool) => (
              <div key={tool.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <Space size={6} wrap>
                      <span style={{ fontWeight: 600 }}>{tool.name}</span>
                      <Tag>{HW_TOOL_SCOPE_LABELS[tool.scope]}</Tag>
                      <Tag color="blue">{HW_TOOL_TRANSPORT_LABELS[tool.transport]}</Tag>
                      {tool.write ? <Tag color="orange">写动作</Tag> : <Tag color="green">只读</Tag>}
                      {tool.write && tool.requiresGrant ? <Tag>需授权</Tag> : null}
                    </Space>
                    <div className="mono text-12 muted" style={{ marginTop: 4 }}>{tool.toolName}</div>
                    {tool.description ? <div className="text-12" style={{ marginTop: 6 }}>{tool.description}</div> : null}
                    <div className="text-12 muted mono" style={{ marginTop: 6 }}>
                      {tool.transport === "HTTP"
                        ? `${tool.method} ${tool.path}`
                        : `指令 ${tool.commandCode}`}
                    </div>
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
                    <Button icon={<CopyOutlined aria-hidden />} onClick={() => void copyText(callExample(tool))}>
                      复制示例
                    </Button>
                    <Button type="primary" icon={<ExperimentOutlined aria-hidden />} onClick={() => setTrialTool(tool)}>
                      试调
                    </Button>
                  </Space>
                </div>
                <div className="text-12 muted" style={{ marginTop: 10 }}>参数 Schema</div>
                <pre className="mono" style={{ ...codeBlockStyle, maxHeight: 200 }}>{jsonText(tool.params)}</pre>
                {Object.keys(tool.response ?? {}).length ? (
                  <>
                    <div className="text-12 muted" style={{ marginTop: 8 }}>响应</div>
                    <pre className="mono" style={{ ...codeBlockStyle, maxHeight: 160 }}>{jsonText(tool.response)}</pre>
                  </>
                ) : null}
                {(tool.examples ?? []).length ? (
                  <>
                    <div className="text-12 muted" style={{ marginTop: 8 }}>示例</div>
                    <pre className="mono" style={{ ...codeBlockStyle, maxHeight: 160 }}>{JSON.stringify(tool.examples, null, 2)}</pre>
                  </>
                ) : null}
                <div className="text-12 muted" style={{ marginTop: 8 }}>对外调用</div>
                <pre className="mono" style={codeBlockStyle}>{callExample(tool)}</pre>
              </div>
            ))}
          </Space>
        ) : null}
      </Panel>

      <ToolEditorModal
        open={editorOpen}
        initial={editing}
        lockKind="API"
        saving={toolSaving}
        onClose={() => setEditorOpen(false)}
        onSubmit={submitTool}
      />
      <ToolTrialModal tool={trialTool} onClose={() => setTrialTool(null)} />
    </>
  );
}