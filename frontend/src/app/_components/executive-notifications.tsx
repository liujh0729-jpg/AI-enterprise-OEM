"use client";

import { BellOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { NotificationRow } from "@enterprise/contracts";
import { useRouter } from "next/navigation";
import { EmptyState, Panel } from "@/components/ui/panel";

const CATEGORY_COLOR: Record<string, string> = {
  service_desk: "#3370ff",
  demand: "#00a870",
  identity: "#ff7d00",
  tax: "#722ed1",
  automation: "#14c9c9",
  account: "#f53f3f",
  platform: "#86909c",
};

/** 驾驶舱「新消息概览」：只列未读消息，点击标记已读并跳到对应模块处理。 */
export function ExecutiveNotifications({
  rows,
  count,
  loading,
  failed,
  onOpen,
}: {
  rows: NotificationRow[];
  count: number;
  loading: boolean;
  failed: boolean;
  onOpen: (row: NotificationRow) => Promise<void> | void;
}) {
  const router = useRouter();
  return (
    <Panel
      title="新消息概览"
      titleBadge={
        count > 0 ? (
          <span className="badge badge-orange">{count} 条未读</span>
        ) : (
          <span className="text-12 muted">暂无未读消息</span>
        )
      }
      extra={<Button onClick={() => router.push("/notifications")}>全部消息</Button>}
    >
      {failed ? (
        <EmptyState icon={<BellOutlined aria-hidden />} text="消息加载失败，请稍后刷新" />
      ) : loading && !rows.length ? (
        <EmptyState icon={<BellOutlined aria-hidden />} text="正在加载消息…" />
      ) : rows.length ? (
        <div className="exec-list">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="exec-msg"
              onClick={() => void onOpen(row)}
            >
              <i
                className="exec-dot"
                style={{ background: CATEGORY_COLOR[row.category] || "#86909c" }}
              />
              <span className="exec-msg-main">
                <span className="exec-msg-title">{row.title}</span>
                {row.body ? <span className="exec-msg-body">{row.body}</span> : null}
              </span>
              <span className="exec-msg-time">
                {row.createdAt.replace("T", " ").slice(5, 16)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<BellOutlined aria-hidden />}
          text="暂无未读消息，历史消息可在右上角消息中心查看"
        />
      )}
    </Panel>
  );
}