"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spin, Tag } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import type { NotificationRow } from "@enterprise/contracts";
import { notificationsApi } from "@/api/collab";
import { PillTabs } from "@/components/ui/panel";
import {
  MobileAuthGate,
  MobileShell,
  fmtMobileTime,
  mobileTarget,
} from "../_components/mobile-common";

const TABS = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "oa", label: "审批" },
  { key: "service_desk", label: "客服" },
  { key: "platform", label: "平台" },
  { key: "account", label: "账号" },
];

const CATEGORY_COLOR: Record<string, string> = {
  service_desk: "#3370ff",
  oa: "#722ed1",
  account: "#f53f3f",
  platform: "#86909c",
  identity: "#ff7d00",
  tax: "#722ed1",
};

/**
 * 微信服务号消息入口 H5 收件箱（`/m/inbox`）：
 * 复用站内通知接口，未读/分类筛选，点开进详情后在手机上直接处理。
 */
export default function MobileInboxPage() {
  const router = useRouter();
  const [tab, setTab] = useState("all");
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextPage: number, replace: boolean) => {
      setLoading(true);
      setError("");
      try {
        const category = tab === "all" || tab === "unread" ? undefined : tab;
        const data = await notificationsApi.list({
          query: {
            page: nextPage,
            pageSize: 20,
            category,
            unreadOnly: tab === "unread" ? true : undefined,
          },
        });
        if (!data) return;
        setItems((prev) => {
          const merged = replace ? data.list : [...prev, ...data.list];
          const seen = new Set<number>();
          return merged.filter((row) =>
            seen.has(row.id) ? false : (seen.add(row.id), true),
          );
        });
        setTotal(data.total);
        setPage(data.page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "消息加载失败，请稍后重试");
      } finally {
        setLoading(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    setItems([]);
    setTotal(0);
    void load(1, true);
  }, [load]);

  const markAll = async () => {
    setMarking(true);
    try {
      const category = tab === "all" || tab === "unread" ? undefined : tab;
      await notificationsApi.readAll({ body: category ? { category } : {} });
      await load(1, true);
    } finally {
      setMarking(false);
    }
  };

  const open = async (row: NotificationRow) => {
    if (!row.read && row.source !== "sns") {
      try {
        await notificationsApi.read({ params: { id: String(row.id) } });
      } catch {
        // 已读上报失败不挡跳转
      }
    }
    router.push(`/m/inbox/${row.id}`);
  };

  return (
    <MobileShell title="消息中心" sub="任务、审批与客服回复都在这里处理">
      <MobileAuthGate>
        <PillTabs
          items={TABS}
          value={tab}
          size="small"
          variant="soft"
          onChange={(key) => setTab(key)}
          style={{ marginBottom: 12 }}
        />

        {error ? (
          <div className="m-empty">
            <div className="m-empty-title">加载失败</div>
            <p className="m-empty-text">{error}</p>
            <Button onClick={() => void load(1, true)}>重试</Button>
          </div>
        ) : loading && !items.length ? (
          <div className="m-loading">
            <Spin />
          </div>
        ) : items.length ? (
          <div className="m-view">
            {items.map((row) => {
              const target = mobileTarget(row.link, row.entityType, row.entityId);
              return (
                <button
                  key={`${row.source}-${row.externalId || row.id}`}
                  type="button"
                  className={row.read ? "m-card m-notice" : "m-card m-notice is-unread"}
                  onClick={() => void open(row)}
                >
                  <span
                    className="m-notice-dot"
                    style={{ background: CATEGORY_COLOR[row.category] || "#86909c" }}
                  />
                  <span className="m-notice-main">
                    <span className="m-notice-title">{row.title}</span>
                    {row.body ? <span className="m-notice-body">{row.body}</span> : null}
                    <span className="m-notice-meta">
                      <Tag>{row.categoryLabel || row.category}</Tag>
                      {target ? <span className="m-notice-hint">可在手机处理</span> : null}
                      <span className="m-card-sub">{fmtMobileTime(row.createdAt)}</span>
                    </span>
                  </span>
                </button>
              );
            })}

            <div className="m-inline-actions" style={{ padding: "4px 0 12px", flexWrap: "wrap" }}>
              {items.length < total ? (
                <Button loading={loading} onClick={() => void load(page + 1, false)}>
                  加载更多（{items.length}/{total}）
                </Button>
              ) : (
                <span className="text-12 muted">已显示全部 {total} 条</span>
              )}
              {total > 0 ? (
                <Button type="text" loading={marking} onClick={() => void markAll()}>
                  全部已读
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="m-empty">
            <div className="m-empty-icon">
              <InboxOutlined aria-hidden />
            </div>
            <div className="m-empty-title">暂无消息</div>
            <p className="m-empty-text">
              关注服务号并绑定账号后，任务派发、审批待办与客服回复会推送到这里。
            </p>
            <Button href="/m/bind">查看绑定说明</Button>
          </div>
        )}
      </MobileAuthGate>
    </MobileShell>
  );
}
