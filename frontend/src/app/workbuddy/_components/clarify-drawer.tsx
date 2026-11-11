"use client";

import {
  CloseOutlined,
  RobotOutlined,
  SaveOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { App, Avatar, Button, Drawer, Input, Space, Spin, Tag, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Notice } from "@/components/ui/panel";
import {
  stripSpecMarker,
  workbuddyApi,
  type ClarifyMessage,
  type WbPlan,
  type WbPlanSpec,
} from "./common";

const EMPTY_SPEC: WbPlanSpec = {
  goal: "",
  deliverable: "",
  acceptance: "",
  steps: [],
};

/**
 * 「口水话 → 任务书」对话抽屉：左侧多轮对话，右侧实时任务书预览。
 * 每轮都把当前任务书交给模型，模型回包里的 SPEC_JSON 由后端解析成结构化任务书；
 * 用户点「保存任务书」后才写回计划（对话本身不落库，避免半成品覆盖已定稿）。
 */
export function ClarifyDrawer({
  open,
  plan,
  configured,
  model,
  initialInput,
  onClose,
  onApplied,
}: {
  open: boolean;
  plan: WbPlan | null;
  configured: boolean;
  model: string;
  initialInput: string;
  onClose: () => void;
  onApplied: (plan: WbPlan) => void;
}) {
  const { message } = App.useApp();
  const [messages, setMessages] = useState<ClarifyMessage[]>([]);
  const [spec, setSpec] = useState<WbPlanSpec>(EMPTY_SPEC);
  const [input, setInput] = useState("");
  const [specError, setSpecError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !plan) return;
    setMessages(
      plan.summary ? [{ role: "assistant", content: plan.summary }] : [],
    );
    setSpec(plan.spec || EMPTY_SPEC);
    setInput(initialInput || plan.rawInput || "");
    setSpecError("");
    setLoading(false);
    // 每次打开都以计划当前的任务书为起点，不沿用上次未保存的草稿
  }, [open, plan, initialInput]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  if (!plan) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!configured) {
      message.error("还没有 API Key，请先到「API Key 管理」生成一把");
      return;
    }
    const history: ClarifyMessage[] = [
      ...messages.filter((item) => !item.content.startsWith("出错了：")),
      { role: "user", content: text },
    ];
    setMessages(history);
    setInput("");
    setLoading(true);
    try {
      const result = await workbuddyApi.clarify({
        messages: history,
        spec,
        ...(model ? { model } : {}),
      });
      setMessages([
        ...history,
        {
          role: "assistant",
          content:
            stripSpecMarker(result.reply) ||
            "（任务书已更新，见右侧预览）",
        },
      ]);
      setSpec(result.spec);
      setSpecError(result.specError || "");
      if (result.specError) {
        message.warning(result.specError);
      } else if (result.ready) {
        message.success("任务书已就绪，可以保存后拆解任务");
      }
    } catch (error) {
      const reason = (error as Error).message;
      message.error(reason);
      setMessages([
        ...history,
        { role: "assistant", content: `出错了：${reason}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    const lastAssistant = [...messages]
      .reverse()
      .find((item) => item.role === "assistant" && !item.content.startsWith("出错了："));
    setSaving(true);
    try {
      const saved = await workbuddyApi.updatePlan(plan.id, {
        spec,
        summary: lastAssistant?.content || plan.summary,
      });
      onApplied(saved);
      message.success("任务书已保存");
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar
            icon={<RobotOutlined />}
            style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}
          />
          <div>
            <div style={{ fontWeight: 600 }}>AI 澄清任务书</div>
            <div className="text-12 muted">{plan.title}</div>
          </div>
        </div>
      }
      extra={
        <Space size={0}>
          <Tooltip title="新建会话">
            <Button
              type="text"
              onClick={() => {
                setMessages([]);
                setSpec(EMPTY_SPEC);
                setInput("");
                setSpecError("");
              }}
            >
              重置
            </Button>
          </Tooltip>
          <Tooltip title="关闭">
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={onClose}
            />
          </Tooltip>
        </Space>
      }
      size={1000}
      styles={{
        body: { padding: 0, display: "flex", minHeight: 0 },
      }}
      destroyOnHidden
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--border)",
        }}
      >
        {!configured ? (
          <div style={{ padding: "12px 16px 0" }}>
            <Notice variant="warn">
              还没有 API Key：先到「API Key 管理」生成一把，才能和 AI 对话。
              <Link href="/developer/keys"> 立即配置 API Key</Link>
            </Notice>
          </div>
        ) : null}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 20,
            background: "var(--bg-muted)",
          }}
        >
          {messages.length ? null : (
            <div
              style={{
                padding: "14px 16px",
                background: "var(--card)",
                borderRadius: "12px 12px 12px 4px",
                maxWidth: 620,
                lineHeight: 1.7,
                fontSize: 14,
              }}
            >
              用大白话说说你想让 Agent 做什么（目标、交给谁看、什么时候要）。
              我会一轮轮问清关键信息，最后给出一份可直接执行的任务书。
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {messages.map((item, index) => (
              <Bubble key={index} msg={item} />
            ))}
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar size={30} icon={<RobotOutlined />} />
                <div
                  style={{
                    padding: "10px 14px",
                    background: "var(--card)",
                    borderRadius: "12px 12px 12px 4px",
                  }}
                >
                  <Spin size="small" />
                  <span className="text-13 muted" style={{ marginLeft: 8 }}>
                    AI 思考中…
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            background: "var(--card)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Input.TextArea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：帮我把这个月上新的 30 个 SKU 整理成一份竞品价格对比表，明天下班前要"
              autoSize={{ minRows: 2, maxRows: 5 }}
              disabled={loading || !configured}
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
              loading={loading}
              disabled={!configured || !input.trim()}
              onClick={() => void send()}
            />
          </div>
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            Enter 发送，Shift + Enter 换行 · 对话仅在当前视图保留
            {model ? ` · 模型 ${model}` : " · 尚未设置默认模型"}
          </div>
        </div>
      </div>

      <div
        style={{
          width: 360,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--card)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <b>任务书预览</b>
            <div className="text-12 muted">
              {spec.goal ? `目标已成形 · ${spec.steps.length} 步` : "等 AI 收敛目标"}
            </div>
          </div>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!spec.goal && !spec.steps.length}
            onClick={() => void apply()}
          >
            保存任务书
          </Button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {specError ? (
            <div style={{ marginBottom: 10 }}>
              <Notice variant="warn">{specError}</Notice>
            </div>
          ) : null}
          <SpecBlock label="目标" value={spec.goal} />
          <SpecBlock label="交付物" value={spec.deliverable} />
          <SpecBlock label="验收标准" value={spec.acceptance} />
          <div style={{ marginTop: 14 }}>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              执行步骤（{spec.steps.length}）
            </div>
            {spec.steps.length ? (
              <ol style={{ paddingLeft: 18, margin: 0 }}>
                {spec.steps.map((step, index) => (
                  <li key={index} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {step.title || `第 ${index + 1} 步`}
                    </div>
                    <div
                      className="text-12 muted"
                      style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
                    >
                      {step.instruction}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-12 muted">还没有步骤：继续和 AI 聊，或直接手写任务。</div>
            )}
          </div>
        </div>
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <Tag color={spec.goal && spec.steps.length ? "green" : "default"}>
            {spec.goal && spec.steps.length ? "可拆解" : "未就绪"}
          </Tag>
          <span className="text-12 muted">
            保存后回计划详情，点「拆解为任务」并选账号与 Agent。
          </span>
        </div>
      </div>
    </Drawer>
  );
}

function SpecBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="text-12 muted" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
        {value || "—"}
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: ClarifyMessage }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        gap: 8,
      }}
    >
      {isUser ? null : (
        <Avatar
          size={30}
          icon={<RobotOutlined />}
          style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", flexShrink: 0 }}
        />
      )}
      <div
        style={{
          maxWidth: "calc(100% - 48px)",
          padding: "11px 14px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          background: isUser ? "var(--primary)" : "var(--card)",
          color: isUser ? "#fff" : "var(--text-1)",
          whiteSpace: "pre-wrap",
          fontSize: 14,
          lineHeight: 1.65,
        }}
      >
        {msg.content}
      </div>
      {isUser ? (
        <Avatar
          size={30}
          icon={<UserOutlined />}
          style={{ background: "var(--primary)", flexShrink: 0 }}
        />
      ) : null}
    </div>
  );
}
