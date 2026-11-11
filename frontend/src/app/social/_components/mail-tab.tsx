"use client";

import { EditOutlined, FileTextOutlined, LinkOutlined, SendOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Modal } from "antd";
import { useEffect, useRef, useState } from "react";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { socialApi, type SyncOutcome } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { useSession } from "@/lib/session";
import { PersonAvatar, fmtRelative } from "./social-ui";

/** 私信同步结果：只在对方也有 Key 时提示，避免无 Key 用户被无关信息打扰。 */
function syncSuffix(sync?: SyncOutcome) {
  if (!sync || !sync.peerHasKey) return "";
  if (sync.state === "PENDING") return "，已排队同步到 AIworkin";
  if (sync.state === "SYNCED") return "，已同步到 AIworkin";
  if (sync.state === "FAILED" || sync.state === "DEAD") return "，AIworkin 同步失败，可稍后在「资料 → AIworkin 同步」重试";
  return "";
}

/**
 * 私信：左会话列表 + 右气泡对话（IM 双栏）。
 * 会话内回复走同一 sendMail 接口（后端按用户对 threadKey 复用会话，不会新建线程）。
 * 简历投递也走这里：投递＝发一条带简历卡片的私信，雇主点卡片打开 HTML 简历。
 */
export function MailTab() {
  const { message } = App.useApp();
  const { me } = useSession();
  const [threadId, setThreadId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({ toUserId: "", subject: "", body: "" });
  const [withResume, setWithResume] = useState(false);
  const [syncUpstream, setSyncUpstream] = useState<boolean | null>(null);
  // 投递弹层：附言可留空（后端给默认文案）
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverNote, setDeliverNote] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const threads = useBusinessQuery("social", "mail-threads", {}, (signal) => socialApi.listThreads({ signal }));
  const overview = useBusinessQuery("social", "sync-overview", {}, (signal) =>
    socialApi.syncOverview({ signal }),
  );
  // 默认跟随「资料 → AIworkin 同步」里的私信出站设置
  const mailSync = syncUpstream ?? overview.data?.preferences.mailOutboundDefault ?? false;
  const messages = useBusinessQuery(
    "social",
    "mail-messages",
    { threadId },
    (signal) => socialApi.threadMessages(threadId as number, { signal }),
    "all",
    threadId != null,
  );
  const send = useOperationMutation(
    (input: { toUserId: string; subject?: string; body: string; syncUpstream: boolean }) =>
      socialApi.sendMail(input),
    ["social"],
  );
  const deliver = useOperationMutation(
    (input: { toUserId: string; note?: string }) => socialApi.sendResume(input),
    ["social"],
  );

  const threadRows = threads.data || [];
  const activeThread = threadRows.find((t) => t.threadId === threadId) || null;

  // 打开会话或收到新消息时滚到最新一条
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.data, threadId]);

  const onReply = async () => {
    if (!activeThread) return;
    const text = reply.trim();
    if (!text) return message.warning("回复内容不能为空");
    try {
      const res = await send.mutateAsync({
        toUserId: activeThread.peer.userId,
        subject: activeThread.subject,
        body: text,
        syncUpstream: mailSync,
      });
      setReply("");
      void threads.refetch();
      message.success(`已发送${syncSuffix(res.sync)}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发送失败");
    }
  };

  const onSendNew = async () => {
    if (!compose.toUserId.trim()) return message.warning("请填写收件人用户 ID");
    if (!compose.body.trim() && !withResume) return message.warning("私信内容不能为空");
    let res: { threadId: number; sync?: SyncOutcome };
    try {
      // 勾了「附上简历」就只发一条：正文当附言，卡片随信走，免得同一段话刷两条
      res = withResume
        ? await deliver.mutateAsync({ toUserId: compose.toUserId.trim(), note: compose.body.trim() })
        : await send.mutateAsync({
            toUserId: compose.toUserId.trim(),
            subject: compose.subject.trim(),
            body: compose.body.trim(),
            syncUpstream: mailSync,
          });
    } catch (error) {
      return message.error(error instanceof Error ? error.message : "发送失败");
    }
    setCompose({ toUserId: "", subject: "", body: "" });
    setWithResume(false);
    setComposeOpen(false);
    setThreadId(res.threadId);
    void threads.refetch();
    message.success(withResume ? "简历已投递" : `已发送${syncSuffix(res.sync)}`);
  };

  const onDeliver = async () => {
    if (!activeThread) return;
    try {
      await deliver.mutateAsync({ toUserId: activeThread.peer.userId, note: deliverNote.trim() });
    } catch (error) {
      return message.error(error instanceof Error ? error.message : "投递失败");
    }
    setDeliverOpen(false);
    setDeliverNote("");
    void threads.refetch();
    void messages.refetch();
    message.success("简历已投递，对方可在对话里直接打开");
  };

  const openCompose = (prefillTo = "") => {
    setCompose({ toUserId: prefillTo, subject: activeThread?.subject || "", body: "" });
    setWithResume(false);
    setComposeOpen(true);
  };

  return (
    <div className="sns-wrap">
      <Panel
        title="私信"
        titleBadge={<span className="sns-muted">与同行的站内一对一往来</span>}
        extra={
          <Button type="primary" icon={<EditOutlined />} onClick={() => openCompose()}>
            发起私信
          </Button>
        }
      >
        <div className="sns-mail">
          <div>
            <div className="sns-section-title">
              会话{threadRows.length ? `（${threadRows.length}）` : ""}
            </div>
            {threadRows.length === 0 ? (
              <EmptyState text="还没有私信会话，点右上角「发起私信」开始。" />
            ) : (
              <div className="sns-thread-list">
                {threadRows.map((t) => (
                  <div
                    key={t.threadId}
                    className={t.threadId === threadId ? "sns-thread active" : "sns-thread"}
                    role="button"
                    tabIndex={0}
                    onClick={() => setThreadId(t.threadId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setThreadId(t.threadId);
                      }
                    }}
                  >
                    <PersonAvatar person={t.peer} size={38} />
                    <div className="sns-thread-main">
                      <div className="sns-thread-top">
                        <span className="sns-thread-name">{t.peer.displayName}</span>
                        <span className="sns-thread-time">{fmtRelative(t.lastMessageAt)}</span>
                      </div>
                      <div className="sns-thread-preview">{t.subject || "（无主题）"}</div>
                    </div>
                    {t.unread ? <span className="sns-unread">{t.unread > 99 ? "99+" : t.unread}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sns-chat">
            {activeThread ? (
              <>
                <div className="sns-chat-head">
                  <div className="sns-person">
                    <PersonAvatar person={activeThread.peer} size={36} />
                    <div>
                      <div className="sns-thread-name">{activeThread.peer.displayName}</div>
                      <div className="sns-muted">{activeThread.subject || "（无主题）"}</div>
                    </div>
                  </div>
                  <Button type="text" size="small" icon={<FileTextOutlined />} onClick={() => { setDeliverNote(""); setDeliverOpen(true); }}>
                    投递我的简历
                  </Button>
                  <Button type="text" size="small" onClick={() => openCompose(activeThread.peer.userId)}>
                    新开话题
                  </Button>
                </div>

                <div className="sns-chat-scroll" ref={scrollRef}>
                  {(messages.data || []).length === 0 ? (
                    <div className="sns-chat-empty">
                      <EmptyState text="还没有消息，在下方输入第一条。" />
                    </div>
                  ) : (
                    (messages.data || []).map((m) => {
                      const mineMsg = Boolean(me?.userId) && m.from.userId === me?.userId;
                      return (
                        <div key={m.id} className={mineMsg ? "sns-msg mine" : "sns-msg"}>
                          <PersonAvatar person={m.from} size={34} />
                          <div className="sns-msg-main">
                            <div className="sns-msg-meta">
                              <span>{mineMsg ? "我" : m.from.displayName}</span>
                              {m.source === "AIWORKIN" ? (
                                <span className="sns-flag sns-flag-source">AIworkin</span>
                              ) : null}
                              {mineMsg && (m.syncState === "PENDING" || m.syncState === "SYNCED" || m.syncState === "FAILED" || m.syncState === "DEAD") ? (
                                <span className="sns-flag sns-flag-sync">
                                  {m.syncState === "SYNCED" ? "已同步" : m.syncState === "PENDING" ? "待同步" : "同步失败"}
                                </span>
                              ) : null}
                              <span>{fmtRelative(m.createdAt)}</span>
                            </div>
                            <div className="sns-bubble">{m.body}</div>
                            {(m.linkCards || []).map((card) =>
                              card.kind === "RESUME" ? (
                                <a
                                  key={`RESUME-${card.userId}`}
                                  className="sns-resume-card"
                                  href={`/resume/${card.userId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <span className="sns-resume-card-icon">
                                    <FileTextOutlined />
                                  </span>
                                  <span className="sns-resume-card-main">
                                    <b>{card.name || "同行"} 的简历</b>
                                    <em>{card.headline || "HTML 简历，可导出 PDF"}</em>
                                  </span>
                                  <span className="sns-resume-card-cta">打开简历</span>
                                </a>
                              ) : (
                                <a
                                  key={`LINK-${card.url}`}
                                  className="sns-resume-card"
                                  href={card.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  <span className="sns-resume-card-icon">
                                    <LinkOutlined />
                                  </span>
                                  <span className="sns-resume-card-main">
                                    <b>{card.title || "链接"}</b>
                                    <em>{card.url}</em>
                                  </span>
                                  <span className="sns-resume-card-cta">打开链接</span>
                                </a>
                              ),
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="sns-chat-reply">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Input.TextArea
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      maxLength={20000}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onPressEnter={(e) => {
                        if (!e.shiftKey) {
                          e.preventDefault();
                          void onReply();
                        }
                      }}
                      placeholder="输入回复，Enter 发送 / Shift + Enter 换行"
                    />
                    <div style={{ marginTop: 6 }}>
                      <Checkbox checked={mailSync} onChange={(e) => setSyncUpstream(e.target.checked)}>
                        同时发送到 AIworkin 私信
                      </Checkbox>
                    </div>
                  </div>
                  <Button type="primary" icon={<SendOutlined />} loading={send.isPending} onClick={onReply}>
                    发送
                  </Button>
                </div>
              </>
            ) : (
              <div className="sns-chat-empty">
                <EmptyState text="从左侧选择一个会话，或发起一条新私信。" />
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Modal
        title="发起私信"
        open={composeOpen}
        onCancel={() => setComposeOpen(false)}
        onOk={onSendNew}
        okText="发送"
        confirmLoading={send.isPending}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
          <Input
            placeholder="收件人用户 ID（好友卡片上可查看）"
            value={compose.toUserId}
            onChange={(e) => setCompose({ ...compose, toUserId: e.target.value })}
          />
          <Input
            placeholder="主题（可选）"
            maxLength={200}
            value={compose.subject}
            onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
          />
          <Input.TextArea
            placeholder="想对 TA 说什么…"
            rows={4}
            maxLength={20000}
            value={compose.body}
            onChange={(e) => setCompose({ ...compose, body: e.target.value })}
          />
          <Checkbox checked={withResume} onChange={(e) => setWithResume(e.target.checked)}>
            附上我的简历（正文作为附言，随信带一张可打开的简历卡片）
          </Checkbox>
          <Checkbox
            checked={mailSync}
            disabled={withResume}
            onChange={(e) => setSyncUpstream(e.target.checked)}
          >
            同时发送到 AIworkin 私信（简历投递暂不支持跨站同步）
          </Checkbox>
        </div>
      </Modal>

      <Modal
        title={`投递我的简历 · ${activeThread?.peer.displayName || ""}`}
        open={deliverOpen}
        onCancel={() => setDeliverOpen(false)}
        onOk={onDeliver}
        okText="投递"
        confirmLoading={deliver.isPending}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          <Input.TextArea
            rows={3}
            maxLength={2000}
            showCount
            value={deliverNote}
            onChange={(e) => setDeliverNote(e.target.value)}
            placeholder="想对 TA 说的话（留空则用默认附言）"
          />
          <Notice variant="info">
            投递后简历卡片会落在当前对话里，对方点开即打开 HTML 简历（可直接导出 PDF）；你后续对简历的改动，对方回看时就是最新版。
          </Notice>
        </div>
      </Modal>
    </div>
  );
}