"use client";

import { RobotOutlined, SendOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Input, Space, Spin, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import type { WorkflowGraph } from "@enterprise/contracts";
import { workflowApi } from "@/api/workflow";

/**
 * 编辑器里的「AI 搭建工作流」：一句话或多轮对话，在当前画布草稿上改，产出新的 DAG。
 * 只回草案不落库——用户点「应用到画布」后写回画布，再由工具栏「保存」持久化。
 */

type AiResult = {
  graph: WorkflowGraph;
  ready: boolean;
  issues: string[];
  name: string;
  description: string;
};

type AiTurn = {
  key: string;
  role: "user" | "assistant";
  content: string;
  failed?: boolean;
  result?: AiResult;
};

const SUGGESTIONS = [
  "在开头加一个每天 9 点的定时触发",
  "把中间这步改成先 AI 摘要再派给我",
  "接一个条件分支：意向分高的走人工确认，低的直接归档",
];

export function WorkflowAiBuilder({
  open,
  onClose,
  graph,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  /** 当前画布草稿：AI 在它之上改，而不是从零开始。 */
  graph: WorkflowGraph;
  onApply: (payload: {
    name: string;
    description: string;
    graph: WorkflowGraph;
  }) => void;
}) {
  const { message } = App.useApp();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<AiTurn[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 消息 key 用自增序号：时间戳 + 随机数属于渲染期不纯调用，组件内用 ref 计数更稳妥。
  const seqRef = useRef(0);

  // 每次打开都是一次新的编辑会话：上一轮的对话与草案不跨次留（画布草稿每次实时取）。
  useEffect(() => {
    if (!open) return;
    setMessages([]);
    setInput("");
    setSending(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  const patch = (key: string, next: Partial<AiTurn>) =>
    setMessages((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...next } : item)),
    );

  const send = async (raw?: string) => {
    const content = (raw ?? input).trim();
    if (!content || sending) return;
    const prior = messages;
    // 多轮迭代以「本会话上一版草案」为准，没有则拿当前画布当起点。
    const draft =
      [...prior].reverse().find((item) => item.result)?.result?.graph ?? graph;
    setSending(true);
    setInput("");
    const turn = (seqRef.current += 1);
    const userKey = `u-${turn}`;
    const botKey = `a-${turn}`;
    const history: AiTurn[] = [
      ...prior,
      { key: userKey, role: "user", content },
    ];
    setMessages([...history, { key: botKey, role: "assistant", content: "" }]);
    try {
      const result = await workflowApi.aiBuild({
        body: {
          messages: history
            .slice(-20)
            .map((item) => ({ role: item.role, content: item.content })),
          graph: draft,
        },
      });
      if (!result) throw new Error("AI 没有返回结果，请换个说法再试");
      patch(botKey, {
        content: result.reply,
        result: {
          graph: result.graph,
          ready: result.ready,
          issues: result.issues || [],
          name: result.name,
          description: result.description,
        },
      });
    } catch (error) {
      patch(botKey, { content: (error as Error).message, failed: true });
    } finally {
      setSending(false);
    }
  };

  const latest = [...messages].reverse().find((item) => item.result)?.result;

  const applyToCanvas = () => {
    if (!latest?.ready) {
      message.warning("还没有生成可用的流程图，先把改动说清楚");
      return;
    }
    onApply({
      name: latest.name,
      description: latest.description,
      graph: latest.graph,
    });
  };

  return (
    <Drawer
      open={open}
      size={560}
      onClose={onClose}
      destroyOnHidden
      title={
        <Space size={8}>
          <RobotOutlined />
          AI 搭建工作流
        </Space>
      }
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span className="text-12 muted">
            {latest?.ready
              ? `已生成 ${latest.graph.nodes.length} 个节点，应用到画布后点「保存」生效`
              : "在当前画布上改：说清「加什么、改哪步、怎么连」，我边聊边更新"}
          </span>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            disabled={!latest?.ready}
            onClick={applyToCanvas}
          >
            应用到画布
          </Button>
        </div>
      }
    >
      <div
        style={{
          height: "calc(100vh - 220px)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingRight: 4,
        }}
      >
        {!messages.length ? (
          <div className="text-12 muted">
            在<strong>当前画布</strong>的基础上改：用自然语言说明要新增、调整或重连哪些步骤，
            我会从系统已有的节点里挑出触发、条件、动作与人工步骤，拼成一张新图；不满意可以继续对话让我改，
            确认后点「应用到画布」写回，再点工具栏「保存」持久化。
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {SUGGESTIONS.map((item) => (
                <Tag
                  key={item}
                  style={{ cursor: "pointer", marginInlineEnd: 0 }}
                  onClick={() => void send(item)}
                >
                  {item}
                </Tag>
              ))}
            </div>
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
            <div
              style={{
                whiteSpace: "pre-wrap",
                color: item.failed ? "var(--danger)" : undefined,
              }}
            >
              {item.content ||
                (item.role === "assistant" && sending ? "正在生成流程图…" : "")}
            </div>
            {item.result ? (
              <div style={{ marginTop: 6 }}>
                <div className="text-12">
                  {item.result.graph.nodes
                    .map((node) => node.name || node.kind)
                    .join(" → ")}
                </div>
                {item.result.issues.length ? (
                  <div className="text-12" style={{ color: "var(--warning, #d46b08)" }}>
                    {item.result.issues.map((issue) => (
                      <div key={issue}>· {issue}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : item.role === "assistant" && sending ? (
              <Spin size="small" style={{ marginTop: 6 }} />
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <Space.Compact style={{ width: "100%", marginTop: 10 }}>
        <Input.TextArea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="例如：在「归档」前加一步派任务给我确认"
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
  );
}
