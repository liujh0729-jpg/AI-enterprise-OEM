"use client";

import { RobotOutlined, SendOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Drawer,
  Input,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { contentApi, streamAgentMessage } from "@/api/content";

/**
 * 嵌入式业务副驾（P2-A）：业务页右下角常驻入口，打开后带着「当前模块 + 当前记录 +
 * 页面摘要」向 Agent 提问，也能在用户显式打开写开关后就地执行业务动作。
 * 权限仍由登录人与各模块服务自己判：这里只是把上下文递进去，不放宽任何权限。
 */

const TOOL_LABELS: Record<string, string> = {
  crm_create_lead: "新建线索",
  data_table_add_row: "写入表格",
  erp_check_stock: "查询库存",
  oa_start_flow: "发起审批",
  save_memory: "写入记忆",
  save_to_kb: "沉淀知识库",
  search_library: "检索资料",
  read_library: "精读资料",
  kb_retrieve: "检索知识库",
};

type ToolLine = {
  name: string;
  state: "running" | "ok" | "failed";
  text?: string;
};

type CopilotMessage = {
  key: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolLine[];
  notices: string[];
  failed?: boolean;
};

export type AiCopilotProps = {
  /** 模块标识（crm / data_table / assets / service_desk …），随上下文交给模型 */
  module: string;
  /** 面板标题里显示的模块名（中文） */
  moduleLabel: string;
  /** 当前记录编号；没有具体记录就不传 */
  recordId?: number | string;
  /** 当前记录名称，用于提示词与面板头部 */
  recordLabel?: string;
  /** 当前页面摘要（用户可见的数据，如列名、筛选条件、概览数字） */
  context?: string;
  /** 空状态下的示例问题 */
  suggestions?: string[];
};

function toolLabel(name: string) {
  return TOOL_LABELS[name] || name.replace(/^mcp__/, "MCP · ");
}

export function AiCopilot({
  module,
  moduleLabel,
  recordId,
  recordLabel,
  context,
  suggestions = [],
}: AiCopilotProps) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [allowWrite, setAllowWrite] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [model, setModel] = useState<{ channelId: number; model: string } | null>(null);
  const [modelError, setModelError] = useState("");
  const conversationRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 记录变了就开新会话：同一面板里的答案要对着当前这条记录
  useEffect(() => {
    conversationRef.current = 0;
    setMessages([]);
  }, [module, recordId]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  // 取文本槽位的默认渠道/模型；没配模型时给明确去处
  useEffect(() => {
    if (!open || model) return;
    void (async () => {
      try {
        const settings = await contentApi.settings();
        const slot = settings?.slots.find((item) => item.mediaType === "text");
        if (!slot?.model) {
          setModelError(
            "还没有可用的文本模型：请先到「开放集成 → 模型设置」为文本槽位选好渠道和模型",
          );
          return;
        }
        setModel({ channelId: slot.channelId, model: slot.model });
        setModelError("");
      } catch (caught) {
        setModelError(
          (caught as Error).message || "模型设置读取失败，请稍后再试",
        );
      }
    })();
  }, [open, model]);

  const patchAssistant = (key: string, patch: (item: CopilotMessage) => CopilotMessage) =>
    setMessages((prev) => prev.map((item) => (item.key === key ? patch(item) : item)));

  const send = async (raw?: string) => {
    const content = (raw ?? input).trim();
    if (!content || sending) return;
    if (!model) {
      message.warning(modelError || "文本模型还没有配好");
      return;
    }
    setSending(true);
    setInput("");
    const turn = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userKey = `u-${turn}`;
    const botKey = `a-${turn}`;
    setMessages((prev) => [
      ...prev,
      { key: userKey, role: "user", content, tools: [], notices: [] },
      { key: botKey, role: "assistant", content: "", tools: [], notices: [] },
    ]);
    try {
      if (!conversationRef.current) {
        const title = `副驾 · ${moduleLabel}${recordLabel ? ` · ${recordLabel}` : ""}`;
        const row = await contentApi.createConversation({ body: { title } });
        if (!row) throw new Error("创建副驾会话失败");
        conversationRef.current = row.id;
      }
      await streamAgentMessage(conversationRef.current, content, {
        channelId: model.channelId,
        model: model.model,
        mode: "text",
        copilot: {
          module,
          moduleLabel,
          recordId: recordId === undefined ? "" : String(recordId),
          recordLabel: recordLabel || "",
          context: context || "",
          allowWrite,
        },
        onEvent: ({ event, data }) => {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(data) as Record<string, unknown>;
          } catch {
            return;
          }
          if (event === "delta") {
            const chunk = String(payload.text || "");
            patchAssistant(botKey, (item) => ({
              ...item,
              content: item.content + chunk,
            }));
          } else if (event === "tool_start") {
            const name = String(payload.name || "工具");
            patchAssistant(botKey, (item) => ({
              ...item,
              tools: [...item.tools, { name, state: "running" }],
            }));
          } else if (event === "tool_progress") {
            const name = String(payload.name || "");
            const text = String(payload.text || "");
            if (!text) return;
            patchAssistant(botKey, (item) => {
              const tools = [...item.tools];
              const at = tools.map((line) => line.name).lastIndexOf(name);
              if (at >= 0) tools[at] = { ...tools[at], text };
              return { ...item, tools };
            });
          } else if (event === "tool_end") {
            const name = String(payload.name || "工具");
            const ok = payload.ok !== false;
            const text = String(payload.text || "");
            patchAssistant(botKey, (item) => {
              const tools = [...item.tools];
              const at = tools.map((line) => line.name).lastIndexOf(name);
              const line: ToolLine = {
                name,
                state: ok ? "ok" : "failed",
                text,
              };
              if (at >= 0) tools[at] = line;
              else tools.push(line);
              return { ...item, tools };
            });
          } else if (event === "notice") {
            const text = String(payload.text || "");
            if (!text) return;
            patchAssistant(botKey, (item) => ({
              ...item,
              notices: [...item.notices, text],
            }));
          } else if (event === "error") {
            const text = String(payload.message || payload.text || "执行失败");
            patchAssistant(botKey, (item) => ({
              ...item,
              content: item.content || text,
              failed: true,
            }));
          }
        },
      });
    } catch (caught) {
      patchAssistant(botKey, (item) => ({
        ...item,
        content: item.content || (caught as Error).message || "副驾执行失败",
        failed: true,
      }));
    } finally {
      setSending(false);
    }
  };

  const title = `AI 副驾 · ${moduleLabel}`;

  return (
    <>
      <Tooltip title={title}>
        <Button
          type="primary"
          shape="circle"
          icon={<RobotOutlined />}
          aria-label={title}
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 1000,
            width: 48,
            height: 48,
            boxShadow: "0 6px 18px rgba(0, 0, 0, 0.18)",
          }}
        />
      </Tooltip>
      <Drawer
        open={open}
        size={460}
        title={title}
        onClose={() => setOpen(false)}
        destroyOnHidden={false}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          {recordLabel
            ? `当前记录：${recordLabel}${recordId ? `（#${recordId}）` : ""}`
            : `当前模块：${moduleLabel}`}
        </div>
        <div
          className="text-12"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span>
            允许执行动作
            <span className="muted">
              （改数据 / 发审批；关闭时只能问答与查询）
            </span>
          </span>
          <Switch size="small" checked={allowWrite} onChange={setAllowWrite} />
        </div>

        <div
          style={{
            height: "calc(100vh - 260px)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            paddingRight: 4,
          }}
        >
          {!messages.length ? (
            <div className="text-12 muted">
              我可以结合当前页面回答、查数据，也可以在你打开写开关后执行动作。
              {suggestions.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {suggestions.map((item) => (
                    <Tag
                      key={item}
                      style={{ cursor: "pointer", marginInlineEnd: 0 }}
                      onClick={() => void send(item)}
                    >
                      {item}
                    </Tag>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {messages.map((item) => (
            <div
              key={item.key}
              style={{
                alignSelf: item.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "92%",
                background:
                  item.role === "user"
                    ? "var(--ant-color-primary-bg, #e6f4ff)"
                    : "var(--ant-color-fill-quaternary, #f5f5f5)",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              {item.tools.map((line, index) => (
                <div key={`${line.name}-${index}`} className="text-12 muted">
                  {line.state === "running" ? (
                    <Spin size="small" />
                  ) : line.state === "ok" ? (
                    "✓"
                  ) : (
                    "✗"
                  )}{" "}
                  {toolLabel(line.name)}
                  {line.text ? `：${line.text.slice(0, 160)}` : ""}
                </div>
              ))}
              {item.notices.map((note, index) => (
                <div key={`n-${index}`} className="text-12 muted">
                  {note}
                </div>
              ))}
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  color: item.failed ? "var(--danger)" : undefined,
                }}
              >
                {item.content ||
                  (item.role === "assistant" && sending ? "正在思考…" : "")}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {modelError ? (
          <div className="text-12" style={{ color: "var(--danger)", marginTop: 8 }}>
            {modelError}
          </div>
        ) : null}

        <Space.Compact style={{ width: "100%", marginTop: 10 }}>
          <Input.TextArea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              recordLabel
                ? `就「${recordLabel}」提问，或让我做点什么`
                : `就当前${moduleLabel}页面提问`
            }
            autoSize={{ minRows: 2, maxRows: 6 }}
            maxLength={2000}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={sending}
            onClick={() => void send()}
          >
            发送
          </Button>
        </Space.Compact>
      </Drawer>
    </>
  );
}
