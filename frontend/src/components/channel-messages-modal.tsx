"use client";

import { MessageOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Space } from "antd";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ChannelMessage=import('@enterprise/contracts').ChannelMessage;

/** 需求方本人的发起会话标识（本地台账切分段），不计入「回复方家数」。 */
export const LEAD_CONVERSATION_ID = "local-lead";

/** 一条需求下的一位回复方会话（多轮）。 */
export type ChannelConversation=import('@enterprise/contracts').ChannelConversation;

/** 需求内容明细项：列表收敛为最小集合后，其余需求字段在弹窗内可见。 */
export type ChannelDetail = {
  label: string;
  value?: ReactNode;
};

/** 需求详情明细（各板块同一套字段与版式）。 */
export function ChannelDetails({ items }: { items: ChannelDetail[] }) {
  return (
    <div className="channel-details">
      {items.map((item) => {
        const value = typeof item.value === "string" ? item.value : "";
        return (
          <div
            className={`channel-detail ${value.length > 24 ? "channel-detail-wide" : ""}`}
            key={item.label}
          >
            <span className="channel-detail-label">{item.label}</span>
            <span className="channel-detail-value">{item.value || "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 需求消息弹窗（需求消息通道）：一条需求下每个回复方一条会话，
 * 先选会话，再读该会话的多轮消息并在其中回复。
 */
export function ChannelMessagesModal({
  open,
  title,
  description,
  details,
  conversations,
  replyLabel = "回复",
  onReply,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  details?: ChannelDetail[];
  conversations: ChannelConversation[];
  replyLabel?: string;
  onReply?: (conversationId: string, text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [activeId, setActiveId] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const active =
    conversations.find((item) => item.id === activeId) || conversations[0] || null;
  const activeMessages = active?.messages;
  const messages = useMemo(() => activeMessages || [], [activeMessages]);
  /** 与列表按钮「查看消息（n）」同一口径：回复方家数，不含需求方本人会话。 */
  const partyCount = conversations.filter(
    (item) => item.id !== LEAD_CONVERSATION_ID,
  ).length;

  useEffect(() => {
    if (open) {
      setText("");
      setActiveId("");
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, active?.id, open]);

  return (
    <Modal
      open={open}
      title={`需求消息 · ${title}`}
      onCancel={onClose}
      footer={null}
      width={720}
    >
      {description ? (
        <p className="text-12" style={{ marginTop: 0 }}>
          {description}
        </p>
      ) : null}
      {details?.length ? <ChannelDetails items={details} /> : null}
      <div className="channel-thread-head">
        <span>回复方会话（{partyCount}）</span>
        <span className="text-12">选择一家查看并回复其多轮对话</span>
      </div>
      <div className="channel-thread-list">
        {conversations.map((conversation) => {
          const items = conversation.messages || [];
          const last = items[items.length - 1];
          return (
            <button
              type="button"
              key={conversation.id}
              className={`channel-thread ${
                conversation.id === active?.id ? "channel-thread-active" : ""
              }`}
              onClick={() => setActiveId(conversation.id)}
            >
              <span className="channel-thread-name">{conversation.name}</span>
              <span className="channel-thread-summary">
                {last ? `${last.name}：${last.text}` : "暂无消息"}
              </span>
              <span className="channel-thread-count">
                {items.length} 条{last?.time ? ` · ${last.time}` : ""}
              </span>
            </button>
          );
        })}
        {!conversations.length ? (
          <div className="channel-thread-empty">暂无回复方会话</div>
        ) : null}
      </div>
      <div ref={listRef} className="channel-list">
        {messages.length ? (
          messages.map((message, index) => {
            const role = String(message.role || "").toUpperCase();
            if (role === "SYSTEM") {
              return (
                <div key={index} className="channel-system">
                  {message.text}
                  <span className="text-12"> · {message.time}</span>
                </div>
              );
            }
            const mine = role === "ENTERPRISE";
            return (
              <div
                key={index}
                className={`channel-row ${mine ? "channel-row-mine" : ""}`}
              >
                <div className="channel-bubble">
                  <div className="channel-meta">
                    {message.name} · {message.time}
                  </div>
                  <div>{message.text}</div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty">
            <div className="empty-ico"><MessageOutlined aria-hidden /></div>
            <div>{active ? "该会话暂无消息" : "暂无消息"}</div>
          </div>
        )}
      </div>
      {onReply ? (
        <Space orientation="vertical" style={{ width: "100%", marginTop: 12 }}>
          <Input.TextArea
            rows={3}
            value={text}
            placeholder={`回复「${active?.name || "需求方"}」…`}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            type="primary"
            loading={sending}
            disabled={!text.trim() || !active}
            onClick={async () => {
              setSending(true);
              try {
                await onReply(active?.id || "", text.trim());
                setText("");
              } finally {
                setSending(false);
              }
            }}
          >
            {replyLabel}
          </Button>
        </Space>
      ) : null}
    </Modal>
  );
}