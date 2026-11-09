"use client";

import { Empty, Skeleton, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { gapsApi, type ChangelogEntry } from "@/api/gaps";
import { Notice } from "@/components/ui/panel";
import { gapError, zhDay } from "@/app/gaps/_components/gaps-common";

/** B3#28 产品更新日志（帮助中心公开页签）：仅展示已发布条目。 */
export function GapsChangelogList() {
  const [rows, setRows] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gapsApi.changelogEntries({
        query: { page: 1, pageSize: 50, status: "PUBLISHED" },
      });
      setRows(data?.list || []);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (error) return <Notice variant="error">{error}</Notice>;
  if (!rows.length) return <Empty description="暂无更新日志" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            background: "var(--ant-color-bg-container, #fff)",
            borderRadius: 8,
            padding: "18px 24px",
            border: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Tag color="blue">{row.version}</Tag>
            <Tag>{row.categoryLabel}</Tag>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {row.title}
            </Typography.Text>
            <span className="text-12 muted" style={{ marginLeft: "auto" }}>
              {zhDay(row.releasedAt || row.createdAt)}
            </span>
          </div>
          {row.summary ? (
            <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
              {row.summary}
            </Typography.Paragraph>
          ) : null}
          {row.body ? (
            <div
              className="text-12"
              style={{ whiteSpace: "pre-wrap", marginTop: 8, lineHeight: 1.8 }}
            >
              {row.body}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
