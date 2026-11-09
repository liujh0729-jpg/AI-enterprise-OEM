"use client";

import { Button, Input, Rate, Space, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import { publicDeskApi } from "@/api/collab";
import { RawImg } from "@/components/ui/raw-img";

type Message = {
  id: number;
  senderType: string;
  senderName: string;
  content: string;
  createdAt: string;
};

type Session = {
  token: string;
  site: { name: string; appearance: Record<string, unknown> };
  conversationId: number;
  settings: {
    welcomeText: string;
    queueText: string;
    offlineText: string;
    ratingEnabled: boolean;
    requireContact: boolean;
  };
  messages: Message[];
};

export default function ServiceDeskEmbedPage() {
  const [siteKey, setSiteKey] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [contact, setContact] = useState("");
  const [nickname, setNickname] = useState("");
  const [needContact, setNeedContact] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [rating, setRating] = useState(0);
  const [closed, setClosed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("key") || "";
    setSiteKey(key);
    if (!key) {
      setError("缺少站点标识");
      return;
    }
    const token = window.localStorage.getItem(`sd_${key}`) || "";
    publicDeskApi
      .session({
        siteKey: key,
        token: token || undefined,
        sourceUrl: document.referrer || "",
      })
      .then((value) => {
        const data = value as Session;
        window.localStorage.setItem(`sd_${key}`, data.token);
        setSession(data);
        setMessages(data.messages || []);
        setNeedContact(Boolean(data.settings.requireContact) && !data.token);
      })
      .catch((reason: Error) => {
        if (reason.message.includes("联系方式")) {
          setNeedContact(true);
        } else {
          setError(reason.message);
        }
      });
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      publicDeskApi
        .messages(session.conversationId, session.token)
        .then((value) => {
          const data = value as { messages: Message[] };
          if (data.messages?.length) {
            setMessages((prev) => {
              const seen = new Set(prev.map((item) => item.id));
              const next = [...prev];
              for (const item of data.messages) {
                if (!seen.has(item.id)) next.push(item);
              }
              return next;
            });
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const start = async () => {
    try {
      const data = (await publicDeskApi.session({
        siteKey,
        nickname,
        contact,
        sourceUrl: document.referrer || "",
      })) as Session;
      window.localStorage.setItem(`sd_${siteKey}`, data.token);
      setSession(data);
      setMessages(data.messages || []);
      setNeedContact(false);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const send = async () => {
    if (!session || !input.trim()) return;
    try {
      setSending(true);
      const message = (await publicDeskApi.send(session.conversationId, {
        token: session.token,
        content: input.trim(),
      })) as Message;
      setMessages((prev) => [...prev, message]);
      setInput("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSending(false);
    }
  };

  const submitRating = async () => {
    if (!session || !rating) return;
    await publicDeskApi
      .rate(session.conversationId, { token: session.token, rating })
      .catch(() => undefined);
    setClosed(true);
  };

  if (error && !session) {
    return <div className="embed-tip">{error}</div>;
  }
  if (needContact) {
    return (
      <div className="embed-intro">
        <h3>{session?.site.name || "在线咨询"}</h3>
        <p className="muted">请先留下称呼与联系方式，客服会尽快联系你。</p>
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="怎么称呼你"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
          <Input
            placeholder="手机号或邮箱"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
          <Button type="primary" block onClick={() => void start()}>
            开始咨询
          </Button>
        </Space>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="embed-tip">
        <Spin />
      </div>
    );
  }

  const appearance = session.site.appearance || {};
  const avatar =
    typeof appearance.avatar === "string" ? appearance.avatar : "";
  const title =
    (typeof appearance.title === "string" && appearance.title) ||
    session.site.name ||
    "在线咨询";

  return (
    <div className="embed-chat">
      <header>
        <div className="embed-brand">
          {avatar ? <RawImg className="embed-avatar" src={avatar} alt="" /> : null}
          <div className="embed-brand-text">
            <strong>{title}</strong>
            <span className="muted">
              {session.settings.welcomeText || "你好，请问有什么可以帮你？"}
            </span>
          </div>
        </div>
      </header>
      <div className="embed-messages">
        {messages.map((item) => (
          <div key={item.id} className={`embed-msg embed-msg-${item.senderType}`}>
            <div>{item.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {closed ? (
        <footer className="embed-closed">会话已结束，感谢你的咨询。</footer>
      ) : (
        <footer>
          <Input
            autoFocus
            value={input}
            placeholder="输入消息"
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={() => void send()}
          />
          <Button type="primary" loading={sending} onClick={() => void send()}>
            发送
          </Button>
        </footer>
      )}
      {session.settings.ratingEnabled && messages.length > 3 && !closed ? (
        <div className="embed-rate">
          <span className="muted">对本次服务评分：</span>
          <Rate value={rating} onChange={setRating} />
          <Button size="small" onClick={() => void submitRating()}>
            提交评价
          </Button>
        </div>
      ) : null}
    </div>
  );
}