"use client";

import {
  DeleteOutlined,
  GlobalOutlined,
  RobotOutlined,
  SendOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { App, Button, Input, Modal, Popconfirm, Select, Space } from "antd";
import { useState } from "react";
import { EmptyState, Panel, PillTabs } from "@/components/ui/panel";
import { socialApi, type MyPostRow, type PostRow, type PersonBrief } from "@/api/social";
import { aiApi, type AiSocialCompose } from "@/api/ai";
import { AiModeTag } from "@/components/ai-result";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { useSession } from "@/lib/session";
import { PersonAvatar, fmtDateTime, fmtRelative } from "./social-ui";

/** 动态：发布纯文字短内容（公开 / 仅好友），浏览按可见性与拉黑过滤后的信息流。 */
export function FeedTab() {
  const { message } = App.useApp();
  const { me } = useSession();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "FRIENDS">("PUBLIC");
  const [composeOpen, setComposeOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("通用");
  const [tone, setTone] = useState("自然");
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<AiSocialCompose | null>(null);

  const myself: PersonBrief = {
    userId: me?.userId || "",
    username: me?.username || "",
    displayName: me?.displayName || "我",
    avatar: me?.avatarUrl || "",
  };

  const feed = useBusinessQuery("social", "feed", {}, (signal) => socialApi.feed({ signal }));
  const mine = useBusinessQuery("social", "my-posts", {}, (signal) => socialApi.myPosts({ signal }));

  const publish = useOperationMutation(
    (input: { body: string; visibility: "PUBLIC" | "FRIENDS" }) =>
      socialApi.createPost(input.body, input.visibility),
    ["social"],
  );
  const remove = useOperationMutation(
    (input: { id: number }) => socialApi.deletePost(input.id),
    ["social"],
  );

  const runCompose = async () => {
    const text = topic.trim();
    if (!text) return message.warning("请先填写要写的主题");
    setComposing(true);
    setDraft(null);
    try {
      setDraft(await aiApi.socialCompose({ body: { topic: text, platform, tone } }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "AI 生成失败");
    } finally {
      setComposing(false);
    }
  };

  const applyDraft = () => {
    if (!draft) return;
    const content = draft.content.trim();
    const tags = draft.tags.map((tag) => `#${tag}`).join(" ");
    setBody(tags ? `${content}\n\n${tags}` : content);
    setComposeOpen(false);
    setDraft(null);
  };

  const onPublish = async () => {
    const text = body.trim();
    if (!text) return message.warning("动态内容不能为空");
    await publish.mutateAsync({ body: text, visibility });
    setBody("");
    message.success("已发布");
  };

  const renderPost = (p: PostRow, deletable = false) => (
    <article key={`${deletable ? "mine" : "feed"}-${p.id}`} className="sns-post">
      <div className="sns-card-head">
        <PersonAvatar person={p.author} size={40} />
        <div className="sns-person-main">
          <div className="sns-person-name">
            <span>{p.author?.displayName || "匿名"}</span>
            {p.author?.username ? <span className="sns-muted">@{p.author.username}</span> : null}
          </div>
          <div className="sns-person-sub">
            {fmtRelative(p.createdAt)}
            {p.visibility === "FRIENDS" ? " · 仅好友可见" : " · 公开可见"}
          </div>
        </div>
        {deletable ? (
          <Popconfirm
            title="删除这条动态？"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove.mutateAsync({ id: p.id }).then(() => message.success("已删除"))}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} loading={remove.isPending}>
              删除
            </Button>
          </Popconfirm>
        ) : null}
      </div>
      <div className="sns-post-body">{p.body}</div>
      <div className="sns-post-foot">
        <span>
          {p.visibility === "FRIENDS" ? <TeamOutlined aria-hidden /> : <GlobalOutlined aria-hidden />}
          {p.visibility === "FRIENDS" ? " 仅好友" : " 公开"}
        </span>
        <span>{fmtDateTime(p.createdAt)}</span>
      </div>
    </article>
  );

  const feedRows = feed.data || [];
  const mineRows = (mine.data || []).map<PostRow>((p: MyPostRow) => ({
    id: p.id,
    body: p.body,
    visibility: p.visibility,
    createdAt: p.createdAt,
    author: myself,
  }));

  return (
    <div className="sns-wrap">
      <Panel title="发布动态" titleBadge={<span className="sns-muted">分享你的想法、需求或资源</span>}>
        <div className="sns-composer">
          <PersonAvatar person={myself} size={40} />
          <div className="sns-composer-main">
            <Input.TextArea
              rows={3}
              maxLength={5000}
              showCount
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="此刻在想什么？分享一条动态，让同行看见你…"
            />
            <div className="sns-composer-bar">
              <PillTabs
                size="small"
                value={visibility}
                onChange={(v) => setVisibility(v as "PUBLIC" | "FRIENDS")}
                items={[
                  { key: "PUBLIC", label: "公开" },
                  { key: "FRIENDS", label: "仅好友" },
                ]}
              />
              <Space size={8}>
                <Button icon={<RobotOutlined />} onClick={() => setComposeOpen(true)}>
                  AI 帮我写
                </Button>
                <Button type="primary" icon={<SendOutlined />} loading={publish.isPending} onClick={onPublish}>
                  发布动态
                </Button>
              </Space>
            </div>
          </div>
        </div>
      </Panel>
      <Modal
        open={composeOpen}
        title="AI 帮我写动态"
        okText="填入输入框"
        cancelText="取消"
        okButtonProps={{ disabled: !draft }}
        confirmLoading={composing}
        onOk={applyDraft}
        onCancel={() => {
          if (composing) return;
          setComposeOpen(false);
          setDraft(null);
        }}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              想写什么
            </div>
            <Input.TextArea
              rows={3}
              maxLength={500}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：我们刚上线了跨境独立站建站服务，想找互补的服务商合作"
            />
          </div>
          <Space size={8} wrap>
            <Select
              value={platform}
              onChange={setPlatform}
              style={{ width: 140 }}
              options={["通用", "微信", "微博", "小红书", "抖音", "领英"].map((item) => ({
                value: item,
                label: item,
              }))}
            />
            <Select
              value={tone}
              onChange={setTone}
              style={{ width: 140 }}
              options={["自然", "专业", "活泼", "克制"].map((item) => ({
                value: item,
                label: item,
              }))}
            />
            <Button loading={composing} onClick={() => void runCompose()}>
              生成文案
            </Button>
          </Space>
          {draft ? (
            <div>
              <Space size={8} align="center">
                <b>生成结果</b>
                <AiModeTag mode={draft.mode} model={draft.model} />
              </Space>
              {draft.title ? (
                <div className="text-12 muted" style={{ margin: "6px 0" }}>
                  {draft.title}
                </div>
              ) : null}
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  background: "var(--surface-2, #f7f8fa)",
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 6,
                }}
              >
                {draft.content}
              </div>
              {draft.tags.length ? (
                <div className="text-12 muted" style={{ marginTop: 6 }}>
                  {draft.tags.map((tag) => `#${tag}`).join(" ")}
                </div>
              ) : null}
            </div>
          ) : null}
        </Space>
      </Modal>

      {/* 信息流为主栏、我的动态为右侧窄栏（窄屏由 .sns-feed-layout 回落到上下堆叠） */}
      <div className="sns-feed-layout">
        <Panel title="信息流" titleBadge={<span className="sns-muted">{feedRows.length} 条动态</span>}>
          {feed.isLoading ? null : feedRows.length === 0 ? (
            <EmptyState text="还没有动态。发一条，或先去「好友」页结识同行。" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {feedRows.map((p) => renderPost(p))}
            </div>
          )}
        </Panel>

        <Panel title="我的动态" titleBadge={<span className="sns-muted">{mineRows.length} 条</span>}>
          {mineRows.length === 0 ? (
            <EmptyState text="你还没有发布过动态，在上方写下第一条吧。" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {mineRows.map((p) => renderPost(p, true))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}