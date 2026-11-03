"use client";

import {
  ExportOutlined,
  ReadOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Empty,
  Input,
  Pagination,
  Select,
  Skeleton,
  Space,
  Tag,
} from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appsApi } from "@/api/apps";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { ToolCard, ToolCardGrid } from "@/components/ui/tool-card";

const PAGE_SIZE = 12;
const DEVELOPER_URL = "https://app.chandler.work/";
const DEVELOPER_GUIDE_URL =
  "https://aiworkin.feishu.cn/wiki/TyoqwzeKminJlokLFcYclwdgncg";

export type MarketApp = {
  clientId: string;
  name: string;
  description: string;
  category: string;
  scopes: string[];
  homepageUrl: string;
};

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function MarketAppCards({ apps }: { apps: MarketApp[] }) {
  const router = useRouter();
  return (
    <ToolCardGrid>
      {apps.map((app) => (
        <ToolCard
          key={app.clientId}
          title={app.name || "未命名应用"}
          tag={
            app.category ? (
              <Tag style={{ marginInlineEnd: 0 }}>{app.category}</Tag>
            ) : null
          }
          description={app.description || "该应用还没有填写简介"}
          meta={
            app.homepageUrl ? `首页：${hostOf(app.homepageUrl)}` : undefined
          }
          onClick={() =>
            router.push(`/apps/${encodeURIComponent(app.clientId)}`)
          }
        />
      ))}
    </ToolCardGrid>
  );
}

export function MarketPanel() {
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<MarketApp[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    appsApi
      .list({
        query: {
          page,
          pageSize: PAGE_SIZE,
          ...(category ? { category } : {}),
          ...(query ? { q: query } : {}),
        },
      })
      .then((data) => {
        setList((data?.list || []) as MarketApp[]);
        setTotal(data?.total || 0);
        setError("");
      })
      .catch((caught: unknown) => {
        setList([]);
        setTotal(0);
        setError(caught instanceof Error ? caught.message : "应用目录读取失败");
      })
      .finally(() => setLoading(false));
  }, [category, page, query]);

  useEffect(load, [load]);

  const categories = useMemo(() => {
    const values = new Set(list.map((app) => app.category).filter(Boolean));
    return [...values];
  }, [list]);

  return (
    <Panel
      title="应用市场"
      titleExtra={
        <span className="text-12 muted">
          外部公开应用目录，本站不存应用、不代上架、不代评价
        </span>
      }
      extra={
        <Space size={8}>
          <Button
            icon={<ReadOutlined aria-hidden />}
            href={DEVELOPER_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            开发说明
          </Button>
          <Button
            type="primary"
            icon={<ExportOutlined aria-hidden />}
            href={DEVELOPER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            立刻接入应用
          </Button>
        </Space>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <Input.Search
          allowClear
          placeholder="按应用名称搜索"
          style={{ width: 260 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => {
            setQuery(value.trim());
            setPage(1);
          }}
        />
        {categories.length ? (
          <Select
            allowClear
            placeholder="按分类筛选"
            style={{ width: 180 }}
            value={category || undefined}
            options={categories.map((value) => ({ value, label: value }))}
            onChange={(value) => {
              setCategory(value || "");
              setPage(1);
            }}
          />
        ) : null}
        <span className="text-12 muted" style={{ marginLeft: "auto" }}>
          共 {total} 个应用
        </span>
        <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void load()}>
          刷新
        </Button>
      </div>

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

      {!loading && !list.length ? (
        error ? (
          <EmptyState text="应用目录暂时读取不到，稍后点「刷新」重试。" />
        ) : (
          <Empty
            description={
              query || category
                ? "没有找到匹配的应用"
                : "应用目录里还没有上架的应用。"
            }
          />
        )
      ) : null}

      {!loading && list.length ? <MarketAppCards apps={list} /> : null}

      {!loading && total > PAGE_SIZE ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={total}
            showSizeChanger={false}
            onChange={setPage}
          />
        </div>
      ) : null}
    </Panel>
  );
}