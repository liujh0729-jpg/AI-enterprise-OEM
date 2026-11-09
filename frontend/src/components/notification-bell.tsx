"use client";

import { Badge, Button, Dropdown, Empty, Spin } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { NotificationRow } from "@enterprise/contracts";
import { notificationsApi } from "@/api/collab";
import { useSession } from "@/lib/session";

const COLOR: Record<string, string> = {
  service_desk: "#3370ff",
  demand: "#00a870",
  identity: "#ff7d00",
  tax: "#722ed1",
  automation: "#14c9c9",
  account: "#f53f3f",
  platform: "#86909c",
  sns: "#00b96b",
};

export function NotificationBell() {
  const router = useRouter();
  const { me } = useSession();
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      setLoading(true);
      const data = await notificationsApi.unread();
      setCount(data?.count || 0);
      setItems(data?.items || []);
    } catch {
      // 辅助数据失败不打扰用户
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const go = async (row: NotificationRow) => {
    setOpen(false);
    try {
      if (row.source === "sns") {
        await notificationsApi.readSns({
          params: { id: row.externalId || String(row.id) },
        });
      } else {
        await notificationsApi.read({ params: { id: String(row.id) } });
      }
    } catch {
      // 标记失败不影响跳转
    }
    if (row.link) router.push(row.link);
    void load();
  };

  const dropdown = (
    <div className="notification-pop">
      <div className="notification-pop-head">
        <span>系统消息</span>
        <Button
          type="link"
          size="small"
          onClick={() => {
            setOpen(false);
            router.push("/notifications");
          }}
        >
          全部消息
        </Button>
      </div>
      {loading && !items.length ? (
        <div className="notification-empty">
          <Spin size="small" />
        </div>
      ) : items.length ? (
        <div className="notification-list">
          {items.map((row) => (
            <button
              type="button"
              key={`${row.source}-${row.externalId || row.id}`}
              className="notification-item"
              onClick={() => void go(row)}
            >
              <i style={{ background: COLOR[row.category] || "#86909c" }} />
              <span className="notification-main">
                <span className="notification-title">
                  {row.source === "sns" ? "AIworkin 社交 · " : ""}
                  {row.title}
                </span>
                {row.body ? (
                  <span className="notification-body">{row.body}</span>
                ) : null}
              </span>
              <span className="notification-time">
                {row.createdAt.slice(5, 16).replace("T", " ")}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="notification-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无未读消息" />
        </div>
      )}
    </div>
  );

  return (
    <Dropdown
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
      trigger={["click"]}
      popupRender={() => dropdown}
      placement="bottomRight"
    >
      <Button
        type="text"
        size="small"
        style={{ opacity: 0.65 }}
        aria-label="系统消息"
        icon={
          <Badge count={count} size="small" offset={[2, -2]}>
            <BellOutlined />
          </Badge>
        }
      />
    </Dropdown>
  );
}