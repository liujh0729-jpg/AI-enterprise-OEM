"use client";

import {
  Button,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  message,
} from "antd";
import {
  CustomerServiceOutlined,
  MessageOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ServiceDeskConversationRow,
  ServiceDeskMessage,
  ServiceDeskAgent,
} from "@enterprise/contracts";
import { serviceDeskApi } from "@/api/collab";
import { Panel } from "@/components/ui/panel";

const STATUS_COLOR: Record<string, string> = {
  waiting: "orange",
  active: "blue",
  closed: "default",
};

const AGENT_STATUS_LABEL: Record<string, string> = {
  ONLINE: "在线",
  AWAY: "离开",
  OFFLINE: "离线",
};

type Overview = Awaited<ReturnType<typeof serviceDeskApi.overview>>;

export function ConversationPanel({
  overview,
  onOverview,
}: {
  overview: Overview | null;
  onOverview: () => Promise<void> | void;
}) {
  const [rows, setRows] = useState<ServiceDeskConversationRow[]>([]);
  const [status, setStatus] = useState<string>("");
  const [mine, setMine] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    conversation: ServiceDeskConversationRow;
    messages: ServiceDeskMessage[];
    visitor: { nickname: string; contact: string; firstSeenAt: string; lastSeenAt: string };
  } | null>(null);
  const [agents, setAgents] = useState<ServiceDeskAgent[]>([]);
  const [canned, setCanned] = useState<{ id: number; title: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState<string>("");

  const loadList = async () => {
    try {
      setLoading(true);
      const data = await serviceDeskApi.conversations({
        query: {
          page: 1,
          pageSize: 50,
          ...(status
            ? { status: status as "waiting" | "active" | "closed" }
            : {}),
          mine,
        },
      });
      setRows(data?.list || []);
    } catch (error) {
      message.error((error as Error).message || "会话加载失败");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    try {
      const data = await serviceDeskApi.conversation({ params: { id: String(id) } });
      setDetail(data);
    } catch (error) {
      message.error((error as Error).message || "会话详情加载失败");
    }
  };

  useEffect(() => {
    void loadList();
    void serviceDeskApi
      .agents()
      .then((data) => setAgents(data || []))
      .catch(() => undefined);
    void serviceDeskApi
      .canned()
      .then((data) =>
        setCanned(
          (data || []).map((item) => ({
            id: item.id,
            title: item.title,
            content: item.content,
          })),
        ),
      )
      .catch(() => undefined);
    const timer = setInterval(() => {
      void loadList();
      void onOverview();
    }, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mine]);

  useEffect(() => {
    if (!current) return;
    void loadDetail(current);
    const timer = setInterval(() => void loadDetail(current), 5000);
    return () => clearInterval(timer);
     
  }, [current]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  const statusOptions = useMemo(
    () => [
      { value: "", label: "全部状态" },
      { value: "waiting", label: "待接入" },
      { value: "active", label: "进行中" },
      { value: "closed", label: "已结束" },
    ],
    [],
  );

  const send = async () => {
    if (!current || !input.trim()) return;
    try {
      setSending(true);
      await serviceDeskApi.send({
        params: { id: String(current) },
        body: { content: input.trim(), contentType: "text" },
      });
      setInput("");
      await loadDetail(current);
      await loadList();
    } catch (error) {
      message.error((error as Error).message || "发送失败");
    } finally {
      setSending(false);
    }
  };

  const claim = async () => {
    if (!current) return;
    try {
      await serviceDeskApi.claim({ params: { id: String(current) } });
      message.success("已接入会话");
      await loadDetail(current);
      await loadList();
    } catch (error) {
      message.error((error as Error).message || "接入失败");
    }
  };

  const close = async () => {
    if (!current) return;
    Modal.confirm({
      title: "结束会话",
      content: "结束后访客可对本次服务评分。",
      okText: "结束会话",
      onOk: async () => {
        await serviceDeskApi.close({
          params: { id: String(current) },
          body: { inviteRating: true },
        });
        await loadDetail(current);
        await loadList();
      },
    });
  };

  const doTransfer = async () => {
    if (!current || !transferTo) return;
    try {
      await serviceDeskApi.transfer({
        params: { id: String(current) },
        body: { toUserId: transferTo },
      });
      setTransferOpen(false);
      await loadDetail(current);
      await loadList();
    } catch (error) {
      message.error((error as Error).message || "转接失败");
    }
  };

  const suggest = async () => {
    if (!current) return;
    try {
      const data = await serviceDeskApi.aiSuggest({
        params: { id: String(current) },
        body: { instruction: "" },
      });
      setInput(data?.suggestion || "");
      if (data?.summary) message.success(`摘要：${data.summary}`);
    } catch (error) {
      message.error((error as Error).message || "AI 建议失败");
    }
  };

  const changeMyStatus = async (value: string) => {
    try {
      await serviceDeskApi.setStatus({
        body: { status: value as "ONLINE" | "AWAY" | "OFFLINE" },
      });
      message.success(`已切换为${AGENT_STATUS_LABEL[value]}`);
      await onOverview();
    } catch (error) {
      message.error((error as Error).message || "状态切换失败");
    }
  };

  const renderTurn = (item: ServiceDeskMessage) => {
    const time = item.createdAt.replace("T", " ").slice(5, 16);
    if (item.senderType === "system") {
      return (
        <div key={item.id} className="text-12 muted" style={{ textAlign: "center" }}>
          {item.content}
        </div>
      );
    }
    if (item.senderType === "agent") {
      return (
        <article className="agent-turn agent-turn-user" key={item.id}>
          <div className="agent-turn-meta">
            <span className="agent-turn-name">{item.senderName || "我"}</span>
            <span className="agent-turn-time">{time}</span>
          </div>
          <div className="agent-bubble agent-bubble-user">{item.content}</div>
        </article>
      );
    }
    const isAi = item.senderType === "ai";
    return (
      <article className="agent-turn agent-turn-agent" key={item.id}>
        <div className="agent-avatar" aria-hidden>
          {isAi ? <RobotOutlined /> : <UserOutlined />}
        </div>
        <div className="agent-turn-main">
          <div className="agent-turn-meta">
            <span className="agent-turn-name">
              {item.senderName || (isAi ? "AI" : "访客")}
            </span>
            {isAi ? <span className="agent-chip agent-chip-muted">AI</span> : null}
            <span className="agent-turn-time">{time}</span>
          </div>
          <div className="agent-bubble agent-bubble-agent">{item.content}</div>
        </div>
      </article>
    );
  };

  return (
    <>
      <div className="stat-grid sd-stat-grid">
        <button
          type="button"
          className={`stat-card sd-stat-card${status === "waiting" && !mine ? " on" : ""}`}
          onClick={() => {
            setStatus("waiting");
            setMine(false);
          }}
        >
          <span className="stat-label">待接入</span>
          <b className="stat-value">{overview?.waiting ?? 0}</b>
        </button>
        <button
          type="button"
          className={`stat-card sd-stat-card${status === "active" && !mine ? " on" : ""}`}
          onClick={() => {
            setStatus("active");
            setMine(false);
          }}
        >
          <span className="stat-label">进行中</span>
          <b className="stat-value">{overview?.active ?? 0}</b>
        </button>
        <button
          type="button"
          className={`stat-card sd-stat-card${!status && !mine ? " on" : ""}`}
          onClick={() => {
            setStatus("");
            setMine(false);
          }}
        >
          <span className="stat-label">今日</span>
          <b className="stat-value">{overview?.todayConvos ?? 0}</b>
        </button>
        <button
          type="button"
          className={`stat-card sd-stat-card${status === "active" && mine ? " on" : ""}`}
          onClick={() => {
            setStatus("active");
            setMine(true);
          }}
        >
          <span className="stat-label">我的进行中</span>
          <b className="stat-value">{overview?.myActive ?? 0}</b>
        </button>
      </div>
      <Panel title="我的接待状态">
        <div className="sd-status-row">
          <Radio.Group
            value={overview?.myStatus || "OFFLINE"}
            optionType="button"
            buttonStyle="solid"
            onChange={(event) => void changeMyStatus(event.target.value)}
            options={[
              { value: "ONLINE", label: "在线" },
              { value: "AWAY", label: "离开" },
              { value: "OFFLINE", label: "离线" },
            ]}
          />
          <span className="muted">
            在线才会参与自动分配；离开仍可手动接入；离线不参与分配。
          </span>
        </div>
      </Panel>
      <div className="agent-shell">
        <Panel
          title="会话"
          extra={<Button onClick={() => void loadList()}>刷新</Button>}
        >
          <div className="sd-toolbar">
            <Select
              value={status}
              options={statusOptions}
              onChange={setStatus}
              style={{ width: 140 }}
            />
            <Button
              type={mine ? "primary" : "default"}
              onClick={() => setMine((prev) => !prev)}
            >
              只看我的
            </Button>
          </div>
          <div className="agent-conv-list">
            {loading && !rows.length ? (
              <div className="sd-empty">
                <Spin />
              </div>
            ) : rows.length ? (
              rows.map((row) => (
                <div
                  key={row.id}
                  className={`agent-conv sd-conv-item${current === row.id ? " active" : ""}`}
                  onClick={() => {
                    if (current !== row.id) setDetail(null);
                    setCurrent(row.id);
                  }}
                >
                  <div className="sd-conv-head">
                    <span className="agent-conv-title">{row.visitorName}</span>
                    <Tag color={STATUS_COLOR[row.status] || "default"}>
                      {row.statusLabel}
                    </Tag>
                  </div>
                  <div className="sd-conv-msg">
                    {row.lastMessage || row.subject || "暂无消息"}
                  </div>
                  <div className="sd-conv-meta">
                    <span>{row.siteName}</span>
                    <span>{row.lastMessageAt.replace("T", " ").slice(5, 16)}</span>
                    {row.unread ? <b>{row.unread}</b> : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-12 muted">暂无会话</div>
            )}
          </div>
        </Panel>
      <Panel
        title={detail ? detail.conversation.visitorName : "对话"}
        titleExtra={
          detail ? (
            <span className="muted">
              {detail.conversation.siteName} · {detail.conversation.statusLabel}
              {detail.visitor.contact ? ` · ${detail.visitor.contact}` : ""}
            </span>
          ) : undefined
        }
        extra={
          detail && detail.conversation.status !== "closed" ? (
            <Space size={8}>
              {!detail.conversation.assigneeUserId ? (
                <Button type="primary" onClick={() => void claim()}>
                  接入
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  setTransferTo("");
                  setTransferOpen(true);
                }}
              >
                转接
              </Button>
              <Button onClick={() => void suggest()}>AI 建议</Button>
              <Button danger onClick={() => void close()}>
                结束
              </Button>
            </Space>
          ) : undefined
        }
      >
        <div className="agent-thread">
          {!detail ? (
            <div className="agent-empty">
              <div className="agent-empty-icon">
                <CustomerServiceOutlined aria-hidden />
              </div>
              <div className="agent-empty-title">选择一个会话</div>
              <p className="agent-empty-desc">
                从左侧选择会话后查看访客消息并回复；接待状态为「在线」时会参与自动分配。
              </p>
            </div>
          ) : detail.messages.length ? (
            detail.messages.map(renderTurn)
          ) : (
            <div className="agent-empty">
              <div className="agent-empty-icon">
                <MessageOutlined aria-hidden />
              </div>
              <div className="agent-empty-title">还没有消息</div>
              <p className="agent-empty-desc">访客还没有发消息；可以先发送一条欢迎语。</p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {detail ? (
          detail.conversation.status !== "closed" ? (
            <div
              style={{
                display: "grid",
                gap: 8,
                marginTop: 16,
                padding: 12,
                background: "var(--card, #fff)",
                border: "1px solid var(--border, #f0f0f0)",
                borderRadius: 12,
              }}
            >
              <Input.TextArea
                value={input}
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder="输入回复，Enter 换行，点「发送」"
                onChange={(event) => setInput(event.target.value)}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Select
                  prefix="常用语"
                  style={{ width: 180 }}
                  placeholder="选择常用语"
                  options={canned.map((item) => ({
                    value: String(item.id),
                    label: item.title,
                  }))}
                  onChange={(value) => {
                    const hit = canned.find((item) => String(item.id) === value);
                    if (hit) setInput(hit.content);
                  }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined aria-hidden />}
                  disabled={!input.trim() || sending}
                  loading={sending}
                  style={{ marginLeft: "auto" }}
                  onClick={() => void send()}
                >
                  发送
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-12 muted" style={{ marginTop: 16, textAlign: "center" }}>
              会话已结束
              {detail.conversation.rating
                ? ` · 访客评分 ${detail.conversation.rating} 星`
                : ""}
            </div>
          )
        ) : null}
      </Panel>
      <Modal
        open={transferOpen}
        title="转接会话"
        onCancel={() => setTransferOpen(false)}
        onOk={() => void doTransfer()}
        okText="转接"
      >
        <Select
          style={{ width: "100%" }}
          value={transferTo || undefined}
          placeholder="选择接收的客服"
          onChange={setTransferTo}
          options={agents
            .filter(
              (item) =>
                item.memberUserId !== detail?.conversation.assigneeUserId,
            )
            .map((item) => ({
              value: item.memberUserId,
              label: `${item.memberName}（${item.roleLabel}）`,
            }))}
        />
      </Modal>
      </div>
    </>
  );
}