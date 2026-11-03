"use client";

import { CheckOutlined, CloseOutlined, DeleteOutlined, StopOutlined, UserAddOutlined } from "@ant-design/icons";
import { App, Button, Input, Popconfirm } from "antd";
import { useState } from "react";
import { EmptyState, Panel } from "@/components/ui/panel";
import { socialApi } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { PersonAvatar, fmtRelative } from "./social-ui";

/** 好友：收到的好友请求（接受/拒绝）、按用户 ID 添加、好友列表（删除/拉黑）。 */
export function FriendsTab() {
  const { message } = App.useApp();
  const [target, setTarget] = useState("");
  const requests = useBusinessQuery("social", "friend-requests", {}, (signal) =>
    socialApi.incomingRequests({ signal }),
  );
  const friends = useBusinessQuery("social", "friends", {}, (signal) => socialApi.listFriends({ signal }));

  const add = useOperationMutation(
    (input: { toUserId: string }) => socialApi.requestFriend(input.toUserId, ""),
    ["social"],
  );
  const accept = useOperationMutation((input: { id: number }) => socialApi.acceptFriend(input.id), ["social"]);
  const reject = useOperationMutation((input: { id: number }) => socialApi.rejectFriend(input.id), ["social"]);
  const remove = useOperationMutation((input: { friendId: string }) => socialApi.removeFriend(input.friendId), ["social"]);
  const block = useOperationMutation((input: { userId: string }) => socialApi.block(input.userId), ["social"]);

  const onAdd = async () => {
    const id = target.trim();
    if (!id) return message.warning("请输入要添加的用户 ID");
    const res = await add.mutateAsync({ toUserId: id });
    setTarget("");
    message.success(res.accepted ? "你们已经是好友了" : "好友请求已发送");
  };

  const requestRows = requests.data || [];
  const friendRows = friends.data || [];

  return (
    <div className="sns-wrap">
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
                onPressEnter={onAdd}
              />
              <Button block type="primary" icon={<UserAddOutlined />} loading={add.isPending} onClick={onAdd}>
                发送请求
              </Button>
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
                      </div>
                      <div className="sns-person-sub">{`${r.message || "请求添加你为好友"} · ${fmtRelative(r.createdAt)}`}</div>
                    </div>
                    <div className="sns-request-actions">
                      <Button
                        type="primary"
                        size="small"
                        icon={<CheckOutlined />}
                        loading={accept.isPending}
                        onClick={() => accept.mutateAsync({ id: r.id }).then(() => message.success("已添加"))}
                      >
                        接受
                      </Button>
                      <Button
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={() => reject.mutateAsync({ id: r.id }).then(() => message.success("已拒绝"))}
                      >
                        拒绝
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}