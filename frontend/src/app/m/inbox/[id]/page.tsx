"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Spin, Tag } from "antd";
import type { NotificationRow } from "@enterprise/contracts";
import { notificationsApi } from "@/api/collab";
import {
  MobileAuthGate,
  MobileShell,
  fmtMobileTime,
  mobileTarget,
} from "../../_components/mobile-common";

/** 消息详情（`/m/inbox/[id]`）：正文 + 已读上报 + 手机端处理入口。 */
export default function MobileInboxDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [row, setRow] = useState<NotificationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const data = await notificationsApi.get({ params: { id } });
        if (!alive) return;
        setRow(data);
        if (data && !data.read && data.source !== "sns") {
          try {
            await notificationsApi.read({ params: { id } });
            if (alive) setRow({ ...data, read: true });
          } catch {
            // 已读上报失败不影响阅读
          }
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "消息加载失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const target = row ? mobileTarget(row.link, row.entityType, row.entityId) : "";

  return (
    <MobileShell
      title="消息详情"
      sub={row?.categoryLabel || "站内消息"}
      backHref="/m/inbox"
    >
      <MobileAuthGate>
        {loading ? (
          <div className="m-loading">
            <Spin />
          </div>
        ) : error ? (
          <div className="m-empty">
            <div className="m-empty-title">加载失败</div>
            <p className="m-empty-text">{error}</p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        ) : !row ? (
          <div className="m-empty">
            <div className="m-empty-title">消息不存在</div>
            <p className="m-empty-text">该消息可能已被删除，或不属于当前账号。</p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        ) : (
          <div className="m-view">
            <div className="m-card">
              <div className="m-card-title">
                <span>{row.title}</span>
                <span className="m-card-sub">{fmtMobileTime(row.createdAt)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <Tag>{row.categoryLabel || row.category}</Tag>
                {row.level === "warning" ? <Tag color="orange">提醒</Tag> : null}
                {row.level === "error" ? <Tag color="red">重要</Tag> : null}
                {row.read ? null : <Tag color="blue">未读</Tag>}
              </div>
              <div className="m-notice-content">{row.body || "（无正文）"}</div>
            </div>

            <div className="m-card">
              <div className="m-card-title">下一步</div>
              <div className="m-inline-actions" style={{ flexWrap: "wrap", justifyContent: "flex-start" }}>
                {target ? (
                  <Button type="primary" href={target}>
                    在手机处理
                  </Button>
                ) : null}
                {row.link ? (
                  <Button href={row.link}>打开关联页面</Button>
                ) : null}
                <Button href="/m/inbox">返回消息中心</Button>
              </div>
              {!target && row.link ? (
                <p className="m-hint">
                  该消息的关联页面暂未提供移动端处理页，可在手机浏览器打开关联页面，
                  或回到电脑端处理。
                </p>
              ) : null}
            </div>
          </div>
        )}
      </MobileAuthGate>
    </MobileShell>
  );
}
