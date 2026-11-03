"use client";

import {
  DeleteOutlined,
  LikeOutlined,
  PlusOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { App, Badge, Button, Checkbox, Input, Modal, Popconfirm, Select, Tag } from "antd";
import { useState } from "react";
import { EmptyState, Panel, PillTabs } from "@/components/ui/panel";
import { socialApi, type GroupMemberRow, type GroupRow, type ReplyRow, type TopicRow } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { PersonAvatar, fmtDateTime, fmtRelative } from "./social-ui";

/** 小组封面/头像：有 avatar 用图片，否则用名称首字占位。 */
function GroupAvatar({ name, avatar, size = 40 }: { name: string; avatar: string; size?: number }) {
  return <PersonAvatar name={name} size={size} shape="square" person={avatar ? { userId: "", username: "", displayName: name, avatar } : null} />;
}

const BLANK_GROUP = { name: "", description: "", avatar: "", rules: "", category: "", visibility: "PUBLIC", joinPolicy: "FREE" };

/** 小组内的角色徽标 */
function RoleFlag({ role, joined }: { role: string | null; joined: boolean }) {
  if (role === "OWNER") return <span className="sns-flag sns-flag-role" style={{ background: "rgba(255,255,255,.24)", color: "#fff" }}>组长</span>;
  if (role === "ADMIN") return <span className="sns-flag sns-flag-role" style={{ background: "rgba(255,255,255,.24)", color: "#fff" }}>管理员</span>;
  if (joined) return <span className="sns-flag" style={{ background: "rgba(255,255,255,.2)", color: "#fff" }}>已加入</span>;
  return null;
}

/**
 * 小组：对标豆瓣讨论组。发现/我的 → 组内主题（置顶·加精·分类·匿名·推荐）→ 楼层回复（推荐·删除）。
 * 组长/管理员：入组审批、任命管理员/移除成员、置顶/加精/删帖、小组设置（简介·头像·组规·分类·可见性·加入方式）。
 */
export function GroupsTab() {
  const { message } = App.useApp();
  const [scope, setScope] = useState<"discover" | "mine">("discover");
  const [keyword, setKeyword] = useState("");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [topicFilter, setTopicFilter] = useState({ featured: false, tag: "" });
  const [topicId, setTopicId] = useState<number | null>(null);

  // 表单草稿
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState({ ...BLANK_GROUP });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({ ...BLANK_GROUP });
  const [topicDraft, setTopicDraft] = useState({ title: "", body: "", tag: "", anonymous: false });
  const [replyDraft, setReplyDraft] = useState({ body: "", anonymous: false });
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberStatus, setMemberStatus] = useState<"ACTIVE" | "PENDING">("ACTIVE");

  // 数据
  const groups = useBusinessQuery("social", "groups", { scope, keyword }, (signal) =>
    socialApi.listGroups({ scope, keyword: keyword || undefined }, { signal }),
  );
  const detail = useBusinessQuery("social", "group-detail", { groupId }, (signal) => socialApi.getGroup(groupId as number, { signal }), "all", groupId != null);
  const topics = useBusinessQuery(
    "social",
    "group-topics",
    { groupId, topicFilter },
    (signal) => socialApi.listTopics(groupId as number, topicFilter, { signal }),
    "all",
    groupId != null,
  );
  const topic = useBusinessQuery("social", "topic", { topicId }, (signal) => socialApi.getTopic(topicId as number, { signal }), "all", topicId != null);
  const replies = useBusinessQuery("social", "topic-replies", { topicId }, (signal) => socialApi.listReplies(topicId as number, { signal }), "all", topicId != null);
  const members = useBusinessQuery(
    "social",
    "group-members",
    { groupId, memberStatus },
    (signal) => socialApi.listMembers(groupId as number, memberStatus, { signal }),
    "all",
    membersOpen && groupId != null,
  );

  // 变更
  const createGroup = useOperationMutation((body: typeof creating) => socialApi.createGroup(body), ["social"]);
  const updateGroup = useOperationMutation((input: { id: number; body: typeof settings }) => socialApi.updateGroup(input.id, input.body), ["social"]);
  const join = useOperationMutation((id: number) => socialApi.joinGroup(id), ["social"]);
  const leave = useOperationMutation((id: number) => socialApi.leaveGroup(id), ["social"]);
  const review = useOperationMutation((input: { id: number; memberId: number; approve: boolean }) => socialApi.reviewJoin(input.id, input.memberId, input.approve), ["social"]);
  const setRole = useOperationMutation((input: { id: number; userId: string; role: "ADMIN" | "MEMBER" }) => socialApi.setMemberRole(input.id, input.userId, input.role), ["social"]);
  const kick = useOperationMutation((input: { id: number; userId: string }) => socialApi.removeMember(input.id, input.userId), ["social"]);
  const createTopic = useOperationMutation((input: { groupId: number; body: typeof topicDraft }) => socialApi.createTopic(input.groupId, input.body), ["social"]);
  const delTopic = useOperationMutation((id: number) => socialApi.deleteTopic(id), ["social"]);
  const flags = useOperationMutation((input: { id: number; pinned?: boolean; featured?: boolean }) => socialApi.setTopicFlags(input.id, input), ["social"]);
  const likeTopic = useOperationMutation((id: number) => socialApi.likeTopic(id), ["social"]);
  const reply = useOperationMutation((input: { topicId: number; body: typeof replyDraft }) => socialApi.replyTopic(input.topicId, input.body), ["social"]);
  const delReply = useOperationMutation((id: number) => socialApi.deleteReply(id), ["social"]);
  const likeReply = useOperationMutation((id: number) => socialApi.likeReply(id), ["social"]);

  // 动作
  const openGroup = (id: number) => { setGroupId(id); setTopicId(null); setTopicFilter({ featured: false, tag: "" }); };
  const onCreateGroup = async () => {
    if (!creating.name.trim()) return message.warning("小组名称必填");
    const r = await createGroup.mutateAsync({ ...creating, name: creating.name.trim() });
    setCreateOpen(false);
    setCreating({ ...BLANK_GROUP });
    message.success("小组已创建");
    openGroup(r.id);
  };
  const openSettings = () => {
    if (!detail.data) return;
    const g = detail.data;
    setSettings({ name: g.name, description: g.description, avatar: g.avatar, rules: g.rules, category: g.category, visibility: g.visibility, joinPolicy: g.joinPolicy });
    setSettingsOpen(true);
  };
  const onSaveSettings = async () => {
    if (groupId == null) return;
    await updateGroup.mutateAsync({ id: groupId, body: settings });
    setSettingsOpen(false);
    message.success("小组已更新");
  };
  const onJoin = async () => {
    if (groupId == null || !detail.data) return;
    const r = await join.mutateAsync(groupId);
    message.success(r.status === "ACTIVE" ? "已加入小组" : "申请已提交，待组长审批");
  };
  const onCreateTopic = async () => {
    if (groupId == null) return;
    if (!topicDraft.title.trim() || !topicDraft.body.trim()) return message.warning("标题与正文必填");
    await createTopic.mutateAsync({ groupId, body: { ...topicDraft, title: topicDraft.title.trim(), body: topicDraft.body.trim() } });
    setTopicDraft({ title: "", body: "", tag: "", anonymous: false });
    message.success("已发布");
  };
  const onReply = async () => {
    if (topicId == null) return;
    if (!replyDraft.body.trim()) return message.warning("回复内容不能为空");
    await reply.mutateAsync({ topicId, body: replyDraft });
    setReplyDraft({ body: "", anonymous: false });
    message.success("已回复");
  };

  // ---------- 三级下钻 ----------
  // 主题详情（楼层）
  if (topicId != null && topic.data) {
    const t = topic.data;
    const canMod = t.canModerate;
    const replyRows = replies.data || [];
    return (
      <div className="sns-wrap">
        <article className="sns-article">
          <div className="sns-toolbar" style={{ marginBottom: 12 }}>
            <Button type="text" size="small" onClick={() => setTopicId(null)}>← 返回主题列表</Button>
            <Button type="text" size="small" onClick={() => { setTopicId(null); setGroupId(t.groupId); }}>回到「{t.groupName}」</Button>
          </div>
          <h3 className="sns-article-title">{t.title}</h3>
          <div className="sns-article-meta">
            {t.pinned ? <span className="sns-flag sns-flag-pin">置顶</span> : null}
            {t.featured ? <span className="sns-flag sns-flag-feature">加精</span> : null}
            {t.tag ? <span className="sns-flag sns-flag-tag">{t.tag}</span> : null}
            <span className="sns-person" style={{ gap: 8 }}>
              <PersonAvatar person={t.anonymous ? null : t.author} name={t.anonymous ? "匿" : undefined} size={24} />
              <span>{t.anonymous ? "匿名" : t.author?.displayName}</span>
            </span>
            <span>{fmtDateTime(t.createdAt)}</span>
            <span>{t.replyCount} 回复 · {t.likeCount} 推荐</span>
          </div>
          <div className="sns-article-body">{t.body}</div>
          <div className="sns-divider" />
          <div className="sns-toolbar">
            <Button size="small" type={t.likedByMe ? "primary" : "default"} icon={<LikeOutlined />} loading={likeTopic.isPending} onClick={() => likeTopic.mutateAsync(t.id)}>
              推荐 {t.likeCount > 0 ? t.likeCount : ""}
            </Button>
            {canMod ? (
              <>
                <Button size="small" loading={flags.isPending} onClick={() => flags.mutateAsync({ id: t.id, pinned: !t.pinned }).then(() => message.success(t.pinned ? "已取消置顶" : "已置顶"))}>
                  {t.pinned ? "取消置顶" : "置顶"}
                </Button>
                <Button size="small" loading={flags.isPending} onClick={() => flags.mutateAsync({ id: t.id, featured: !t.featured }).then(() => message.success(t.featured ? "已取消加精" : "已加精"))}>
                  {t.featured ? "取消加精" : "加精"}
                </Button>
              </>
            ) : null}
            {t.canDelete ? (
              <Popconfirm title="删除该主题及其全部回复？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => delTopic.mutateAsync(t.id).then(() => { message.success("已删除"); setTopicId(null); })}>
                <Button size="small" danger icon={<DeleteOutlined />}>删除主题</Button>
              </Popconfirm>
            ) : null}
          </div>
        </article>

        <Panel title="全部回复" titleBadge={<span className="sns-muted">{replyRows.length} 条</span>}>
          {replyRows.length === 0 ? (
            <EmptyState text="还没有回复，来占个沙发。" />
          ) : (
            <div>
              {replyRows.map((r: ReplyRow) => (
                <div key={r.id} className="sns-floor">
                  <div className="sns-floor-badge">#{r.floor + 1}</div>
                  <div className="sns-floor-main">
                    <div className="sns-floor-head">
                      <div className="sns-person" style={{ gap: 8, flex: "1 1 auto" }}>
                        <PersonAvatar person={r.anonymous ? null : r.author} name={r.anonymous ? "匿" : undefined} size={26} />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{r.anonymous ? "匿名" : r.author?.displayName}</span>
                        <span className="sns-muted">{fmtRelative(r.createdAt)}</span>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <Button
                          size="small"
                          type={r.likedByMe ? "primary" : "text"}
                          icon={<LikeOutlined />}
                          loading={likeReply.isPending}
                          onClick={() => likeReply.mutateAsync(r.id)}
                        >
                          {r.likeCount > 0 ? r.likeCount : "推荐"}
                        </Button>
                        {r.canDelete ? (
                          <Popconfirm title="删除该回复？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => delReply.mutateAsync(r.id).then(() => message.success("已删除"))}>
                            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                          </Popconfirm>
                        ) : null}
                      </div>
                    </div>
                    <div className="sns-floor-body">{r.body}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {detail.data?.joined || topic.data?.canModerate ? (
            <>
              <div className="sns-divider" />
              <div className="sns-composer">
                <PersonAvatar name="我" size={36} />
                <div className="sns-composer-main">
                  <Input.TextArea
                    placeholder="写下你的回复…"
                    rows={2}
                    maxLength={20000}
                    value={replyDraft.body}
                    onChange={(e) => setReplyDraft({ ...replyDraft, body: e.target.value })}
                  />
                  <div className="sns-composer-bar">
                    <Checkbox checked={replyDraft.anonymous} onChange={(e) => setReplyDraft({ ...replyDraft, anonymous: e.target.checked })}>
                      匿名回复
                    </Checkbox>
                    <Button type="primary" loading={reply.isPending} onClick={onReply}>发表回复</Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <EmptyState text="加入小组后才能参与回复。" />
          )}
        </Panel>
      </div>
    );
  }

  // 组内视图
  if (groupId != null && detail.data) {
    const g = detail.data;
    const topicRows = topics.data || [];
    // 发布主题 / 组规进右栏；两者都不显示时主栏单列铺满
    const showSide = Boolean(g.rules) || g.joined;
    return (
      <div className="sns-wrap">
        <div className="sns-cover">
          <div className="sns-cover-row">
            <div className="sns-cover-frame">
              <GroupAvatar name={g.name} avatar={g.avatar} size={44} />
            </div>
            <div className="sns-cover-main">
              <div className="sns-cover-name">
                {g.name}
                <RoleFlag role={g.myRole} joined={g.joined} />
                {g.visibility === "PRIVATE" ? (
                  <span className="sns-flag" style={{ background: "rgba(255,255,255,.2)", color: "#fff" }}>私密</span>
                ) : null}
              </div>
              <div className="sns-cover-desc">{g.description || "这个小组还没有简介。"}</div>
              <div className="sns-cover-stats">
                <span><b>{g.memberCount}</b> 成员</span>
                <span><b>{g.topicCount}</b> 主题</span>
                {g.category ? <span>{g.category}</span> : null}
                <span>{g.joinPolicy === "APPROVE" ? "组长审批加入" : "自由加入"}</span>
              </div>
            </div>
            <div className="sns-cover-actions">
              <Button size="small" onClick={() => setGroupId(null)}>← 全部小组</Button>
              {!g.joined && !g.applying ? (
                <Button size="small" type="primary" loading={join.isPending} onClick={onJoin} style={{ background: "#fff", borderColor: "#fff", color: "#1677ff" }}>
                  {g.joinPolicy === "APPROVE" ? "申请加入" : "加入小组"}
                </Button>
              ) : null}
              {g.applying ? <Tag color="orange">申请待审批</Tag> : null}
              {g.canManage ? (
                <>
                  <Button size="small" onClick={openSettings}>小组设置</Button>
                  <Badge count={g.pendingCount} size="small">
                    <Button size="small" onClick={() => { setMemberStatus(g.pendingCount ? "PENDING" : "ACTIVE"); setMembersOpen(true); }}>成员管理</Button>
                  </Badge>
                </>
              ) : null}
              {g.joined && g.myRole !== "OWNER" ? (
                <Popconfirm title="确定退出该小组？" okText="退出" okButtonProps={{ danger: true }} onConfirm={() => leave.mutateAsync(groupId).then(() => { message.success("已退出"); setGroupId(null); })}>
                  <Button size="small" danger loading={leave.isPending}>退出小组</Button>
                </Popconfirm>
              ) : null}
            </div>
          </div>
        </div>

        <div className={showSide ? "sns-group-layout" : "sns-group-layout single"}>
          <div className="sns-group-main">
            <Panel
              title="全部主题"
              titleBadge={<span className="sns-muted">{topicRows.length} 篇 · 置顶优先</span>}
              extra={<Tag.CheckableTag checked={topicFilter.featured} onChange={(checked) => setTopicFilter({ ...topicFilter, featured: checked })}>只看加精</Tag.CheckableTag>}
            >
              {topicRows.length === 0 ? (
                <EmptyState text={g.joined || g.visibility === "PUBLIC" ? "还没有主题，发布第一条吧。" : "该小组暂无可见主题。"} />
              ) : (
                <div>
                  {topicRows.map((t: TopicRow) => (
                    <div
                      key={t.id}
                      className="sns-topic"
                      role="button"
                      tabIndex={0}
                      onClick={() => setTopicId(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setTopicId(t.id);
                        }
                      }}
                    >
                      <div className="sns-topic-main">
                        <div className="sns-topic-title">
                          {t.pinned ? <span className="sns-flag sns-flag-pin">置顶</span> : null}
                          {t.featured ? <span className="sns-flag sns-flag-feature">加精</span> : null}
                          {t.tag ? <span className="sns-flag sns-flag-tag">{t.tag}</span> : null}
                          <span>{t.title}</span>
                        </div>
                        <div className="sns-topic-excerpt sns-clamp-2">{t.body}</div>
                        <div className="sns-topic-meta">
                          <span>{t.anonymous ? "匿名" : t.author?.displayName}</span>
                          <span>{fmtRelative(t.createdAt)}</span>
                          <span>{t.likeCount} 推荐</span>
                          {t.canModerate || t.canDelete ? (
                            <span style={{ display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                              {t.canModerate ? (
                                <>
                                  <Button size="small" type="text" onClick={() => flags.mutateAsync({ id: t.id, pinned: !t.pinned }).then(() => message.success(t.pinned ? "已取消置顶" : "已置顶"))}>
                                    {t.pinned ? "取消置顶" : "置顶"}
                                  </Button>
                                  <Button size="small" type="text" onClick={() => flags.mutateAsync({ id: t.id, featured: !t.featured }).then(() => message.success(t.featured ? "已取消加精" : "已加精"))}>
                                    {t.featured ? "取消加精" : "加精"}
                                  </Button>
                                </>
                              ) : null}
                              {t.canDelete ? (
                                <Popconfirm title="删除该主题及其全部回复？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => delTopic.mutateAsync(t.id).then(() => message.success("已删除"))}>
                                  <Button size="small" danger type="text">删除</Button>
                                </Popconfirm>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="sns-topic-count"><b>{t.replyCount}</b>回复</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="sns-group-side">
            {g.joined ? (
              <Panel title="发布主题" titleBadge={<span className="sns-muted">匿名发布不显示你的昵称</span>}>
                <Input
                  placeholder="主题标题（一句话说清楚）"
                  maxLength={120}
                  showCount
                  value={topicDraft.title}
                  onChange={(e) => setTopicDraft({ ...topicDraft, title: e.target.value })}
                />
                <div style={{ marginTop: 10 }}>
                  <Input.TextArea
                    placeholder="正文：背景、你的观点、希望得到的回应…"
                    rows={3}
                    maxLength={20000}
                    value={topicDraft.body}
                    onChange={(e) => setTopicDraft({ ...topicDraft, body: e.target.value })}
                  />
                </div>
                <div className="sns-composer-bar">
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <Input
                      placeholder="分类标签（选填，如：闲聊 / 求助 / 分享）"
                      maxLength={30}
                      style={{ width: 260 }}
                      value={topicDraft.tag}
                      onChange={(e) => setTopicDraft({ ...topicDraft, tag: e.target.value })}
                    />
                    <Checkbox checked={topicDraft.anonymous} onChange={(e) => setTopicDraft({ ...topicDraft, anonymous: e.target.checked })}>
                      匿名发布
                    </Checkbox>
                  </div>
                  <Button type="primary" loading={createTopic.isPending} onClick={onCreateTopic}>发布主题</Button>
                </div>
              </Panel>
            ) : null}

            {g.rules ? (
              <Panel title="小组组规" titleBadge={<span className="sns-muted">加入即视为同意</span>}>
                <div className="sns-rules">{g.rules}</div>
              </Panel>
            ) : null}
          </div>
        </div>

        <MembersModal
          open={membersOpen}
          groupId={groupId}
          memberStatus={memberStatus}
          onStatusChange={setMemberStatus}
          isOwner={g.myRole === "OWNER"}
          data={members.data || []}
          loading={members.isLoading}
          onClose={() => setMembersOpen(false)}
          onReview={(memberId, approve) => review.mutateAsync({ id: groupId, memberId, approve }).then(() => message.success(approve ? "已通过" : "已拒绝"))}
          onSetRole={(userId, role) => setRole.mutateAsync({ id: groupId, userId, role }).then(() => message.success(role === "ADMIN" ? "已任命为管理员" : "已取消管理员"))}
          onKick={(userId) => kick.mutateAsync({ id: groupId, userId }).then(() => message.success("已移除成员"))}
        />
      </div>
    );
  }

  // 一级：小组发现 / 我的
  const groupRows = groups.data || [];
  return (
    <div className="sns-wrap">
      <Panel
        title="商务小组"
        titleBadge={<span className="sns-muted">找到你的同行圈子</span>}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建小组</Button>}
      >
        <div className="sns-toolbar" style={{ marginBottom: 14 }}>
          <PillTabs
            variant="soft"
            value={scope}
            onChange={(v) => setScope(v as "discover" | "mine")}
            items={[
              { key: "discover", label: "发现小组" },
              { key: "mine", label: "我的小组" },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索小组名称 / 简介"
            style={{ width: 260 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(v) => setKeyword(v)}
          />
          <span className="sns-muted" style={{ marginLeft: "auto" }}>{groupRows.length} 个小组</span>
        </div>

        {groupRows.length === 0 ? (
          <EmptyState text={scope === "mine" ? "你还没有加入任何小组，去「发现小组」看看。" : "还没有公开小组，创建一个吧。"} />
        ) : (
          <div className="sns-grid">
            {groupRows.map((g: GroupRow) => (
              <div
                key={g.id}
                className="sns-card hoverable"
                role="button"
                tabIndex={0}
                onClick={() => openGroup(g.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openGroup(g.id);
                  }
                }}
              >
                <div className="sns-card-head">
                  <GroupAvatar name={g.name} avatar={g.avatar} size={46} />
                  <div className="sns-person-main">
                    <div className="sns-person-name"><span>{g.name}</span></div>
                    <div className="sns-person-sub">
                      {g.category || "综合"} · {g.memberCount} 人 · {g.topicCount} 主题
                    </div>
                  </div>
                </div>
                <div className="sns-listing-desc sns-clamp-2" style={{ minHeight: 38 }}>
                  {g.description || "这个小组还没有简介。"}
                </div>
                <div className="sns-tags">
                  {g.myRole === "OWNER" ? <span className="sns-flag sns-flag-tag">组长</span> : null}
                  {g.myRole === "ADMIN" ? <span className="sns-flag sns-flag-role">管理员</span> : null}
                  {g.joined && !g.myRole ? <span className="sns-tag">已加入</span> : null}
                  {g.applying ? <span className="sns-flag sns-flag-feature">申请中</span> : null}
                  {g.visibility === "PRIVATE" ? <span className="sns-flag sns-flag-pin">私密</span> : null}
                  {!g.joined && !g.applying && g.joinPolicy === "APPROVE" ? <span className="sns-tag">需审批</span> : null}
                </div>
                <div className="sns-card-foot">
                  <span>
                    {g.pendingCount > 0 ? (
                      <span style={{ color: "#d46b08" }}>有 {g.pendingCount} 条申请待处理</span>
                    ) : (
                      <><TeamOutlined aria-hidden /> {g.memberCount} 位成员</>
                    )}
                  </span>
                  <span style={{ color: "var(--primary)", fontWeight: 500 }}>进入 ›</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* 创建小组 */}
      <Modal title="创建小组" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={onCreateGroup} confirmLoading={createGroup.isPending} okText="创建">
        <div className="sns-form-grid" style={{ paddingTop: 4 }}>
          <div className="sns-form-full">
            <div className="sns-section-title">基本信息</div>
            <Input placeholder="小组名称（1-30 字，全站唯一）" maxLength={30} value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
            <div style={{ height: 10 }} />
            <Input placeholder="头像图片 URL（选填）" maxLength={500} value={creating.avatar} onChange={(e) => setCreating({ ...creating, avatar: e.target.value })} />
            <div style={{ height: 10 }} />
            <Input placeholder="小组分类（选填，如：职场 / 技术 / 生活）" maxLength={30} value={creating.category} onChange={(e) => setCreating({ ...creating, category: e.target.value })} />
            <div style={{ height: 10 }} />
            <Input.TextArea placeholder="简介：这个小组聊什么" rows={2} maxLength={2000} value={creating.description} onChange={(e) => setCreating({ ...creating, description: e.target.value })} />
            <div style={{ height: 10 }} />
            <Input.TextArea placeholder="组规（选填，展示在小组首页）" rows={2} maxLength={2000} value={creating.rules} onChange={(e) => setCreating({ ...creating, rules: e.target.value })} />
          </div>
          <div className="sns-form-full" style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <Select
              value={creating.joinPolicy}
              style={{ flex: 1 }}
              onChange={(v) => setCreating({ ...creating, joinPolicy: v })}
              options={[{ value: "FREE", label: "自由加入" }, { value: "APPROVE", label: "组长审批" }]}
            />
            <Select
              value={creating.visibility}
              style={{ flex: 1 }}
              onChange={(v) => setCreating({ ...creating, visibility: v })}
              options={[{ value: "PUBLIC", label: "公开可浏览" }, { value: "PRIVATE", label: "私密小组" }]}
            />
          </div>
        </div>
      </Modal>

      {/* 小组设置 */}
      <Modal
        title="小组设置"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onOk={onSaveSettings}
        confirmLoading={updateGroup.isPending}
        okText="保存"
        okButtonProps={{ icon: <SettingOutlined /> }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          <Input placeholder="小组名称" maxLength={30} value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} />
          <Input placeholder="头像图片 URL" maxLength={500} value={settings.avatar} onChange={(e) => setSettings({ ...settings, avatar: e.target.value })} />
          <Input placeholder="小组分类" maxLength={30} value={settings.category} onChange={(e) => setSettings({ ...settings, category: e.target.value })} />
          <Input.TextArea placeholder="简介" rows={2} maxLength={2000} value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} />
          <Input.TextArea placeholder="组规" rows={3} maxLength={2000} value={settings.rules} onChange={(e) => setSettings({ ...settings, rules: e.target.value })} />
          <div style={{ display: "flex", gap: 10 }}>
            <Select
              value={settings.joinPolicy}
              style={{ flex: 1 }}
              onChange={(v) => setSettings({ ...settings, joinPolicy: v })}
              options={[{ value: "FREE", label: "自由加入" }, { value: "APPROVE", label: "组长审批" }]}
            />
            <Select
              value={settings.visibility}
              style={{ flex: 1 }}
              onChange={(v) => setSettings({ ...settings, visibility: v })}
              options={[{ value: "PUBLIC", label: "公开可浏览" }, { value: "PRIVATE", label: "私密小组" }]}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 成员管理弹窗：待审批（通过/拒绝）与正式成员（任命/取消管理员、移除）。仅组长/管理员可见。 */
function MembersModal(props: {
  open: boolean;
  groupId: number;
  memberStatus: "ACTIVE" | "PENDING";
  onStatusChange: (s: "ACTIVE" | "PENDING") => void;
  isOwner: boolean;
  data: GroupMemberRow[];
  loading: boolean;
  onClose: () => void;
  onReview: (memberId: number, approve: boolean) => Promise<unknown>;
  onSetRole: (userId: string, role: "ADMIN" | "MEMBER") => Promise<unknown>;
  onKick: (userId: string) => Promise<unknown>;
}) {
  const pending = props.memberStatus === "PENDING";
  return (
    <Modal title="成员管理" open={props.open} onCancel={props.onClose} footer={null} width={600}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <PillTabs
          size="small"
          value={props.memberStatus}
          onChange={(v) => props.onStatusChange(v as "ACTIVE" | "PENDING")}
          items={[
            { key: "ACTIVE", label: "小组成员" },
            { key: "PENDING", label: "待审批" },
          ]}
        />
        {props.data.length === 0 ? (
          <EmptyState text={pending ? "暂无待审批申请" : "还没有成员"} />
        ) : (
          <div style={{ maxHeight: 420, overflow: "auto" }}>
            {props.data.map((m: GroupMemberRow) => (
              <div key={m.id} className="sns-request">
                <PersonAvatar person={m.person} name={m.userId} size={36} />
                <div className="sns-request-main">
                  <div className="sns-person-name">
                    <span>{m.person?.displayName || m.userId}</span>
                    {m.role === "OWNER" ? <span className="sns-flag sns-flag-tag">组长</span> : null}
                    {m.role === "ADMIN" ? <span className="sns-flag sns-flag-role">管理员</span> : null}
                  </div>
                  <div className="sns-person-sub">{pending ? `申请于 ${fmtDateTime(m.joinedAt)}` : `加入于 ${fmtDateTime(m.joinedAt)}`}</div>
                </div>
                {pending ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button size="small" type="primary" onClick={() => props.onReview(m.id, true)}>通过</Button>
                    <Popconfirm title="拒绝该申请？" okText="拒绝" onConfirm={() => props.onReview(m.id, false)}>
                      <Button size="small">拒绝</Button>
                    </Popconfirm>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    {props.isOwner && m.role !== "OWNER" ? (
                      <Button size="small" type="text" onClick={() => props.onSetRole(m.userId, m.role === "ADMIN" ? "MEMBER" : "ADMIN")}>
                        {m.role === "ADMIN" ? "取消管理员" : "设为管理员"}
                      </Button>
                    ) : null}
                    {m.role !== "OWNER" ? (
                      <Popconfirm title="移除该成员？" okText="移除" okButtonProps={{ danger: true }} onConfirm={() => props.onKick(m.userId)}>
                        <Button size="small" danger type="text">移除</Button>
                      </Popconfirm>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}