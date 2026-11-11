"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { App, Button, Input, Spin, Tag } from "antd";
import type { ServiceDeskConversationRow, ServiceDeskMessage } from "@enterprise/contracts";
import { serviceDeskApi } from "@/api/collab";
import { MobileAuthGate, MobileShell, fmtMobileTime } from "../../_components/mobile-common";

type Thread = {
  conversation: ServiceDeskConversationRow;
  messages: ServiceDeskMessage[];
};

/** 客服会话（`/m/service/[id]`）：查看访客消息并在手机上回复。 */
export default function MobileServicePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const { message } = App.useApp();
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const data = await serviceDeskApi.conversation({ params: { id } });
        setThread(data);
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : "会话加载失败");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  useEffect(() => {
    if (!id) return;
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [id, load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      const row = await serviceDeskApi.send({
        params: { id },
        body: { content, contentType: "text" },
      });
      if (row) {
        setThread((prev) =>
          prev ? { ...prev, messages: [...prev.messages, row] } : prev,
        );
      }
      setDraft("");
      void load(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "发送失败，请稍后重试");
    } finally {
      setSending(false);
    }
  };

  const conversation = thread?.conversation;

  return (
    <MobileShell title="客服会话" sub={conversation?.visitorName || "服务台"} backHref="/m/inbox">
      <MobileAuthGate>
        {loading ? (
          <div className="m-loading">
            <Spin />
          </div>
        ) : error ? (
          <div className="m-empty">
            <div className="m-empty-title">加载失败</div>
            <p className="m-empty-text">{error}</p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        ) : !thread || !conversation ? (
          <div className="m-empty">
            <div className="m-empty-title">会话不存在</div>
            <p className="m-empty-text">该会话可能已删除，或不属于当前账号。</p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        ) : (
          <div className="m-view">
            <div className="m-card">
              <div className="m-card-title">
                <span>{conversation.subject || conversation.visitorName}</span>
                <Tag>{conversation.statusLabel || conversation.status}</Tag>
              </div>
              <div className="m-kv">
                <span>访客</span>
                <b>
                  {conversation.visitorName || "匿名"}
                  {conversation.visitorContact ? ` · ${conversation.visitorContact}` : ""}
                </b>
              </div>
              <div className="m-kv">
                <span>接待</span>
                <b>{conversation.assigneeName || "待认领"}</b>
              </div>
              <div className="m-kv">
                <span>最近消息</span>
                <b>{conversation.lastMessageAt ? fmtMobileTime(conversation.lastMessageAt) : "—"}</b>
              </div>
            </div>

            <div className="m-chat">
              {thread.messages.length === 0 ? (
                <p className="m-hint" style={{ textAlign: "center" }}>
                  暂无消息
                </p>
              ) : (
                thread.messages.map((item) => {
                  const mine = item.senderType !== "visitor";
                  return (
                    <div key={item.id} className={`m-chat-row${mine ? " is-mine" : ""}`}>
                      <div className="m-chat-bubble">
                        <div className="m-chat-name">{item.senderName || (mine ? "客服" : "访客")}</div>
                        <div className="m-chat-text">{item.content || item.attachmentName || "[附件]"}</div>
                        <div className="m-chat-time">{fmtMobileTime(item.createdAt)}</div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={endRef} />
            </div>

            <div className="m-card">
              <Input.TextArea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="输入回复内容"
                style={{ fontSize: 16 }}
              />
              <div className="m-inline-actions" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                <Button href={`/service-desk?conversation=${conversation.id}`}>打开工作台</Button>
                <Button type="primary" loading={sending} onClick={() => void send()}>
                  发送回复
                </Button>
              </div>
              <p className="m-hint">
                回复会同步到访客的会话窗口；如访客已绑定微信，也会收到服务号提醒。
              </p>
            </div>
          </div>
        )}
      </MobileAuthGate>
    </MobileShell>
  );
}
