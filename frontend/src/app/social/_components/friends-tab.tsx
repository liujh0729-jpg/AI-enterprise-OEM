"use client";

import { CheckOutlined, CloseOutlined, DeleteOutlined, StopOutlined, UserAddOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Popconfirm } from "antd";
import { useState } from "react";
import { EmptyState, Panel } from "@/components/ui/panel";
import { socialApi, type SyncOutcome } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { PersonAvatar, fmtRelative } from "./social-ui";

/** 同步结果只提示用户可感知的部分：成功/排队/失败，无 Key 或关闭时保持安静。 */
function syncSuffix(sync?: SyncOutcome) {
  if (!sync || !sync.peerHasKey) return "";
  if (sync.state === "PENDING") return "，已排队同步到 AIworkin";
  if (sync.state === "SYNCED") return "，已同步到 AIworkin";
  if (sync.state === "FAILED" || sync.state === "DEAD") return "，AIworkin 同步失败，可稍后重试";
  return "";
}

const SYNC_LABELS: Record<string, string> = {
  PENDING: "待同步",
  SYNCED: "已同步",
  FAILED: "同步失败",
  DEAD: "同步失败",
  SKIPPED: "未同步",
};

/** 好友：亲密度推荐、收到的好友请求（接受/拒绝）、按用户 ID 添加、好友列表（删除/拉黑）。 */
export function FriendsTab() {
  const { message } = App.useApp();
  const [target, setTarget] = useState("");
  const [syncOutbound, setSyncOutbound] = useState<boolean | null>(null);
  const requests = useBusinessQuery("social", "friend-requests", {}, (signal) =>
    socialApi.incomingRequests({ signal }),
  );
  const friends = useBusinessQuery("social", "friends", {}, (signal) => socialApi.listFriends({ signal }));
  const overview = useBusinessQuery("social", "sync-overview", {}, (signal) =>
    socialApi.syncOverview({ signal }),
  );
  const recommendations = useBusinessQuery("social", "recommendations", {}, (signal) =>
    socialApi.recommendations(8, { signal }),
  );

  // 默认跟随用户的同步设置；用户在本页改动只影响本次操作
  const outbound = syncOutbound ?? overview.data?.preferences.friendRequestOutbound ?? true;

  const add = useOperationMutation(
    (input: { toUserId: string; syncUpstream: boolean }) =>
      socialApi.requestFriend(input.toUserId, "", { syncUpstream: input.syncUpstream }),
    ["social"],
  );
  const accept = useOperationMutation(
    (input: { id: number; syncUpstream: boolean }) =>
      socialApi.acceptFriend(input.id, { syncUpstream: input.syncUpstream }),
    ["social"],
  );
  const reject = useOperationMutation(
    (input: { id: number; syncUpstream: boolean }) =>
      socialApi.rejectFriend(input.id, { syncUpstream: input.syncUpstream }),
    ["social"],
  );
  const remove = useOperationMutation((input: { friendId: string }) => socialApi.removeFriend(input.friendId), ["social"]);
  const block = useOperationMutation((input: { userId: string }) => socialApi.block(input.userId), ["social"]);
  const dismiss = useOperationMutation(
    (input: { userId: string }) => socialApi.dismissRecommendation(input.userId),
    ["social"],
  );

  const onAdd = async (toUserId: string) => {
    const id = toUserId.trim();
    if (!id) return message.warning("请输入要添加的用户 ID");
    try {
      const res = await add.mutateAsync({ toUserId: id, syncUpstream: outbound });
      setTarget("");
      message.success(res.accepted ? "你们已经是好友了" : `好友请求已发送${syncSuffix(res.sync)}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发送失败");
    }
  };

  const onAccept = async (id: number) => {
    try {
      const res = await accept.mutateAsync({ id, syncUpstream: outbound });
      message.success(`已添加${syncSuffix(res.sync)}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  const onReject = async (id: number) => {
    try {
      const res = await reject.mutateAsync({ id, syncUpstream: outbound });
      message.success(`已拒绝${syncSuffix(res.sync)}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  const onDismiss = async (userId: string) => {
    try {
      await dismiss.mutateAsync({ userId });
      message.success("已减少此类推荐");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  const requestRows = requests.data || [];
  const friendRows = friends.data || [];
  const recommendationRows = recommendations.data?.items || [];

  return (
    <div className="sns-wrap">
      <Panel
        title="可能认识的人"
        titleBadge={
          recommendationRows.length ? (
            <span className="sns-muted">按六度人脉亲密度推荐：关系越近越靠前</span>
          ) : undefined
        }
      >
        {recommendationRows.length === 0 ? (
          <EmptyState text="平台内暂时没有可推荐的其他用户。" />
        ) : (
          <div className="sns-grid">
            {recommendationRows.map((item) => (
              <div key={item.person.userId} className="sns-card">
                <div className="sns-card-head">
                  <PersonAvatar person={item.person} size={44} />
                  <div className="sns-person-main">
                    <div className="sns-person-name">
                      <span>{item.person.displayName}</span>
                      <span className="sns-flag sns-flag-tag">匹配度 {item.score}</span>
                      {item.matchBand === "HIGH" ? (
                        <span className="sns-flag sns-flag-match">高匹配</span>
                      ) : null}
                    </div>
                    <div className="sns-person-sub">
                      {[item.person.title, item.organization, item.person.city]
                        .filter(Boolean)
                        .join(" · ") || `@${item.person.username}`}
                    </div>
                  </div>
                </div>
                <div className="sns-reasons">
                  {item.reasons.map((reason) => (
                    <span key={`${reason.kind}-${reason.label}`} className="sns-flag sns-flag-reason">
                      {reason.label}
                    </span>
                  ))}
                </div>
                <div className="sns-card-foot">
                  <span>ID {item.person.userId}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      type="primary"
                      size="small"
                      icon={<UserAddOutlined />}
                      loading={add.isPending}
                      onClick={() => void onAdd(item.person.userId)}
                    >
                      加好友
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      loading={dismiss.isPending}
                      onClick={() => void onDismiss(item.person.userId)}
                    >
                      不感兴趣
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* 好友列表为主栏；添加好友与好友请求为右侧窄栏（窄屏由 .sns-friends-layout 回落到上下堆叠并把侧栏提到前面） */}
      <div className="sns-friends-layout">
        <Panel title="我的好友" titleBadge={<span className="sns-muted">{friendRows.length} 位</span>}>
          {friendRows.length === 0 ? (
            <EmptyState text="还没有好友，输入对方的用户 ID 添加一位吧。" />
          ) : (
            <div className="sns-grid">
              {friendRows.map((f) => (
                <div key={f.userId} className="sns-card">
                  <div className="sns-card-head">
                    <PersonAvatar person={f} size={44} />
                    <div className="sns-person-main">
                      <div className="sns-person-name"><span>{f.displayName}</span></div>
                      <div className="sns-person-sub">
                        {f.username ? `@${f.username}` : "用户"} · ID {f.userId}
                      </div>
                    </div>
                  </div>
                  <div className="sns-card-foot">
                    <span>好友</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <Popconfirm
                        title="删除该好友？"
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove.mutateAsync({ friendId: f.userId }).then(() => message.success("已删除"))}
                      >
                        <Button type="text" size="small" icon={<DeleteOutlined />}>删除</Button>
                      </Popconfirm>
                      <Popconfirm
                        title="拉黑后双方关系与互动都会清除，确认？"
                        okText="拉黑"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => block.mutateAsync({ userId: f.userId }).then(() => message.success("已拉黑"))}
                      >
                        <Button danger type="text" size="small" icon={<StopOutlined />}>拉黑</Button>
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="sns-friends-side">
          <Panel title="添加好友">
            <div className="sns-add-friend">
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="对方用户 ID（可在其「资料」页查看）"
                allowClear
                onPressEnter={() => void onAdd(target)}
              />
              <Button block type="primary" icon={<UserAddOutlined />} loading={add.isPending} onClick={() => void onAdd(target)}>
                发送请求
              </Button>
              <Checkbox checked={outbound} onChange={(e) => setSyncOutbound(e.target.checked)}>
                同时发送到 AIworkin
              </Checkbox>
              {!overview.data?.keyBound ? (
                <span className="sns-muted">
                  未绑定个人 API Key，仅在本站生效。可到「模型服务 → API Key 管理」绑定。
                </span>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="好友请求"
            titleBadge={
              requestRows.length ? <span className="sns-muted">{requestRows.length} 条待处理</span> : undefined
            }
          >
            {requestRows.length === 0 ? (
              <EmptyState text="暂无待处理的好友请求。" />
            ) : (
              <div>
                {requestRows.map((r) => (
                  <div key={r.id} className="sns-request sns-request-compact">
                    <PersonAvatar person={r.from} size={36} />
                    <div className="sns-request-main">
                      <div className="sns-person-name">
                        <span>{r.from.displayName}</span>
                        {r.from.username ? <span className="sns-muted">@{r.from.username}</span> : null}
                        {r.source === "AIWORKIN" ? (
                          <span className="sns-flag sns-flag-source">AIworkin</span>
                        ) : null}
                        {SYNC_LABELS[r.syncState] ? (
                          <span className="sns-flag sns-flag-sync">{SYNC_LABELS[r.syncState]}</span>
                        ) : null}
                      </div>
                      <div className="sns-person-sub">{`${r.message || "请求添加你为好友"} · ${fmtRelative(r.createdAt)}`}</div>
                    </div>
                    <div className="sns-request-actions">
                      <Button
                        type="primary"
                        size="small"
                        icon={<CheckOutlined />}
                        loading={accept.isPending}
                        onClick={() => void onAccept(r.id)}
                      >
                        接受
                      </Button>
                      <Button
                        size="small"
                        icon={<CloseOutlined />}
                        loading={reject.isPending}
                        onClick={() => void onReject(r.id)}
                      >
                        拒绝
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="sns-divider" />
            <Checkbox checked={outbound} onChange={(e) => setSyncOutbound(e.target.checked)}>
              接受/拒绝时同步好友关系到 AIworkin
            </Checkbox>
          </Panel>
        </div>
      </div>
    </div>
  );
}