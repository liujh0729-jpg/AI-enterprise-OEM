"use client";

import {
  CheckCircleOutlined,
  CloseOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { App, Avatar, Button, Drawer, Input, Space, Spin, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  paramEntries,
  rpaApi,
  type ChatMsg,
  type RpaScript,
} from "./common";

type Props = {
  open: boolean;
  script: RpaScript;
  currentParams: Record<string, string>;
  onClose: () => void;
  onApply: (params: Record<string, string>) => void;
};

type UiMessage = {
  role: 'user' | 'assistant';
  content: string;
  params?: Record<string, string>;
};

/**
 * 参数填写 Chat Drawer：用户描述意图 → AI 引导补全参数 → 提取并回填到任务表单。
 *
 * 多轮对话：每次把完整消息历史发给后端，后端拼 system prompt + history 调一次模型。
 * AI 回复里如果包含 PARAMS_JSON:{...} 标记，后端会解析出来，前端据此回填表单。
 */
export function ParamsChatDrawer({
  open,
  script,
  currentParams,
  onClose,
  onApply,
}: Props) {
  const { message } = App.useApp();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [appliedParams, setAppliedParams] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = paramEntries(script);
  const requiredKeys = entries
    .filter(([, spec]) => spec?.required)
    .map(([key]) => key);
  const filledCount = requiredKeys.filter(
    (key) => (appliedParams[key] || currentParams[key] || "").trim() !== "",
  ).length;

  useEffect(() => {
    if (open && messages.length === 0) {
      const paramList = entries
        .map(([key, spec]) => {
          const required = spec?.required ? '必填' : '选填';
          const label = spec?.label || key;
          return `• ${label}（${key}）- ${required}`;
        })
        .join('\n');
      setMessages([
        {
          role: 'assistant',
          content: `你好！我来帮你填写「${script.name}」的运行参数。\n\n该脚本需要以下参数：\n${paramList}\n\n请描述你想让这个任务做什么，我会帮你提取参数值。`,
        },
      ]);
    }
  }, [open, script, entries, messages.length, currentParams]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const history: ChatMsg[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
    history.push({ role: 'user', content: text });
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const result = await rpaApi.paramsChat({
        scriptId: script.id,
        messages: history,
        currentParams: { ...currentParams, ...appliedParams },
      });
      const uiMsg: UiMessage = {
        role: 'assistant',
        content: result.reply,
        params: result.params,
      };
      setMessages((prev) => [...prev, uiMsg]);
      if (Object.keys(result.params).length) {
        const merged = { ...appliedParams, ...result.params };
        setAppliedParams(merged);
      }
      if (result.done) {
        message.success("参数已齐全，点击「应用到表单」即可提交");
      }
    } catch (error) {
      message.error((error as Error).message);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `出错了：${(error as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, script.id, currentParams, appliedParams, message]);

  const apply = () => {
    onApply({ ...currentParams, ...appliedParams });
    message.success("参数已应用到表单");
    onClose();
  };

  const reset = () => {
    setMessages([]);
    setAppliedParams({});
    setInput("");
  };

  return (
    <Drawer
      title={null}
      open={open}
      onClose={onClose}
      size={560}
      styles={{
        header: { display: 'none' },
        body: { padding: 0, display: 'flex', flexDirection: 'column' },
      }}
      closeIcon={null}
    >
      {/* 自定义头部 */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--card)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar
              size={40}
              icon={<RobotOutlined />}
              style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
            />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>
                AI 参数助手
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {script.name} · 对话仅在当前视图保留
              </div>
            </div>
          </div>
          <Space>
            <Tooltip title="清空当前对话，重新开始">
              <Button type="text" onClick={reset}>
                重置
              </Button>
            </Tooltip>
            <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
          </Space>
        </div>
        {/* 进度指示器 */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1,
            height: 4,
            background: 'var(--border)',
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${requiredKeys.length ? (filledCount / requiredKeys.length) * 100 : 0}%`,
              background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            {filledCount}/{requiredKeys.length} 必填
          </span>
        </div>
      </div>

      {/* 消息区域 */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: '20px',
          background: 'var(--bg-muted)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map((msg, index) => (
            <MessageBubble key={index} msg={msg} />
          ))}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 16px',
                background: 'var(--card)',
                borderRadius: '12px 12px 12px 4px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
              }}>
                <Spin size="small" />
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>AI 思考中...</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* 已提取参数卡片 */}
      {Object.keys(appliedParams).length ? (
        <div style={{
          margin: '0 20px',
          padding: '12px 16px',
          background: 'var(--card)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-2)',
          }}>
            <CheckCircleOutlined style={{ color: 'var(--success)' }} />
            已提取的参数
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(appliedParams).map(([key, value]) => (
              <Tag
                key={key}
                color="green"
                style={{
                  margin: 0,
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 500 }}>{key}</span>
                <span style={{ margin: '0 4px', color: 'var(--text-4)' }}>=</span>
                <span>{value}</span>
              </Tag>
            ))}
          </div>
        </div>
      ) : null}

      {/* 输入区域 */}
      <div style={{
        padding: '16px 20px',
        borderTop: '1px solid var(--border)',
        background: 'var(--card)',
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: 'flex-end' }}>
          <Input.TextArea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="描述你的任务意图，例如：我要在抖音发布一条关于夏季促销的视频，标题是'夏日清凉特惠'，标签包括#促销 #夏季"
            autoSize={{ minRows: 2, maxRows: 4 }}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            disabled={loading}
            style={{
              borderRadius: 8,
              resize: 'none',
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => void send()}
            loading={loading}
            disabled={!input.trim()}
            style={{
              borderRadius: 8,
              height: 40,
              minWidth: 40,
            }}
          />
        </div>
      </div>

      {/* 底部操作栏 */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--border)',
        background: 'var(--card)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}>
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            disabled={!Object.keys(appliedParams).length}
            onClick={apply}
          >
            应用到表单
          </Button>
        </Space>
      </div>
    </Drawer>
  );
}

function MessageBubble({ msg }: { msg: UiMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        gap: 8,
      }}
    >
      {!isUser ? (
        <Avatar
          size={32}
          icon={<RobotOutlined />}
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            flexShrink: 0,
          }}
        />
      ) : null}
      <div
        style={{
          maxWidth: "calc(100% - 48px)",
          padding: "12px 16px",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          background: isUser
            ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
            : 'var(--card)',
          color: isUser ? "#fff" : "var(--text-1)",
          whiteSpace: "pre-wrap",
          fontSize: 14,
          lineHeight: 1.6,
          boxShadow: isUser
            ? '0 2px 8px rgba(102, 126, 234, 0.25)'
            : '0 1px 2px rgba(0,0,0,0.06)',
        }}
      >
        {msg.content}
      </div>
      {isUser ? (
        <Avatar
          size={32}
          icon={<UserOutlined />}
          style={{
            background: 'var(--primary)',
            flexShrink: 0,
          }}
        />
      ) : null}
    </div>
  );
}
