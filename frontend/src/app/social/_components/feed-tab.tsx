"use client";

import { DeleteOutlined, GlobalOutlined, SendOutlined, TeamOutlined } from "@ant-design/icons";
import { App, Button, Input, Popconfirm } from "antd";
import { useState } from "react";
import { EmptyState, Panel, PillTabs } from "@/components/ui/panel";
import { socialApi, type MyPostRow, type PostRow, type PersonBrief } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { useSession } from "@/lib/session";
import { PersonAvatar, fmtDateTime, fmtRelative } from "./social-ui";

/** 动态：发布纯文字短内容（公开 / 仅好友），浏览按可见性与拉黑过滤后的信息流。 */
export function FeedTab() {
  const { message } = App.useApp();
  const { me } = useSession();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "FRIENDS">("PUBLIC");

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
              <Button type="primary" icon={<SendOutlined />} loading={publish.isPending} onClick={onPublish}>
                发布动态
              </Button>
            </div>
          </div>
        </div>
      </Panel>

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