"use client";

import { Button, Input, Select, Spin, Tag } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  LOWCODE_PROJECT_TYPES,
  LOWCODE_PROJECT_TYPE_LABELS,
  type LowCodeProjectView,
} from "@enterprise/contracts";
import { appsApi } from "@/api/apps";
import { lowcodeApi } from "@/api/lowcode";
import { EmptyState, PageHero, Panel } from "@/components/ui/panel";
import { ToolCardGrid } from "@/components/ui/tool-card";
import {
  CreateProjectButton,
  ProjectGrid,
} from "./_components/project-panels";
import {
  MarketAppCards,
  MarketPanel,
  type MarketApp,
} from "./_components/market-panel";

type TabKey = "search" | "enterprise" | "mine" | "joined" | "market";

const TABS = [
  { key: "search", label: "应用搜索" },
  { key: "market", label: "应用市场" },
  { key: "enterprise", label: "企业创建" },
  { key: "mine", label: "我创建的" },
  { key: "joined", label: "我加入的" },
];

const TAB_KEYS = new Set(TABS.map((item) => item.key));
const RECOMMEND_SIZE = 16;
const SEARCH_PAGE_SIZE = 20;

function errText(error: unknown) {
  return (error as Error)?.message || "读取失败";
}

function SectionHead({
  title,
  count,
  extra,
}: {
  title: string;
  count: number;
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "20px 0 10px",
      }}
    >
      <span style={{ fontWeight: 600 }}>{title}</span>
      <span className="text-12 muted">{count} 个</span>
      {extra ? <span style={{ marginLeft: "auto" }}>{extra}</span> : null}
    </div>
  );
}

/**
 * 应用中心：把原「内建应用」与「应用市场」收成一个栏目。
 * 首页是跨来源搜索（我构建的 / 本企业构建的 / 应用市场），其余页签分别看各类应用。
 */
export default function AppCenterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabKey>("search");

  useEffect(() => {
    const next = searchParams.get("tab") || "search";
    setTab(TAB_KEYS.has(next) ? (next as TabKey) : "search");
  }, [searchParams]);

  const changeTab = useCallback(
    (key: string) => {
      const next = TAB_KEYS.has(key) ? (key as TabKey) : "search";
      setTab(next);
      router.replace(`/app-center?tab=${next}`, { scroll: false });
    },
    [router],
  );

  return (
    <>
      <PageHero
        title="应用中心"
        desc="内建应用与应用市场合并后的统一入口：首页直接看应用市场的应用，输入关键词后同时搜我创建的、此企业构建的和应用市场上的应用，结果按来源标注。"
        tabs={TABS}
        activeTab={tab}
        onTabChange={changeTab}
      />
      {tab === "search" ? (
        <AppSearchPanel
          onOpenTab={(next) => changeTab(next)}
        />
      ) : tab === "market" ? (
        <MarketPanel />
      ) : (
        <ProjectTab
          scope={tab === "enterprise" ? "enterprise" : tab === "mine" ? "mine" : "joined"}
          title={
            tab === "enterprise"
              ? "企业创建"
              : tab === "mine"
                ? "我创建的"
                : "我加入的"
          }
          desc={
            tab === "enterprise"
              ? "本企业 / 本服务商组织成员创建的应用。"
              : tab === "mine"
                ? "你创建的应用，包含个人应用与归属组织的应用。"
                : "被邀请加入、按角色协作的应用。"
          }
          allowCreate={tab !== "joined"}
          emptyText={
            tab === "enterprise"
              ? "本组织还没有创建应用。"
              : tab === "mine"
                ? "你还没有创建应用，点右上角「新建应用」开始。"
                : "还没有被加入的应用。"
          }
        />
      )}
    </>
  );
}

function ProjectTab({
  scope,
  title,
  desc,
  allowCreate,
  emptyText,
}: {
  scope: "enterprise" | "mine" | "joined";
  title: string;
  desc: string;
  allowCreate: boolean;
  emptyText: string;
}) {
  const [type, setType] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<LowCodeProjectView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    lowcodeApi
      .projects({
        query: {
          scope,
          type: type || undefined,
          keyword: query.trim() || undefined,
        },
      })
      .then((rows) => setProjects((rows || []) as LowCodeProjectView[]))
      .catch((caught: unknown) => setError(errText(caught)))
      .finally(() => setLoading(false));
  }, [scope, type, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel
      title={title}
      titleExtra={<span className="text-12 muted">{desc}</span>}
      extra={
        <div className="lowcode-toolbar">
          <Select
            allowClear
            placeholder="全部类型"
            style={{ width: 150 }}
            value={type}
            options={LOWCODE_PROJECT_TYPES.map((item) => ({
              value: item,
              label: LOWCODE_PROJECT_TYPE_LABELS[item] || item,
            }))}
            onChange={(value) => setType(value)}
          />
          <Input.Search
            allowClear
            placeholder="搜索应用名称或说明"
            style={{ width: 260 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={(value) => setQuery(value.trim())}
          />
          {allowCreate ? <CreateProjectButton /> : null}
        </div>
      }
    >
      <ProjectGrid
        projects={projects}
        loading={loading}
        error={error}
        emptyText={emptyText}
        onRetry={load}
      />
    </Panel>
  );
}

type SearchSource = "mine" | "enterprise" | "market";

const SOURCE_LABELS: Record<SearchSource, string> = {
  mine: "我创建的",
  enterprise: "此企业构建的",
  market: "应用市场",
};

const SOURCE_COLORS: Record<SearchSource, string> = {
  mine: "blue",
  enterprise: "geekblue",
  market: "gold",
};

type SearchResult = {
  key: string;
  title: string;
  description: string;
  source: SearchSource;
  href: string;
  meta: string;
  score: number;
};

/** 关键词命中强度：名称完全一致 > 名称前缀 > 名称包含 > 说明包含，用于混合结果排序。 */
function matchScore(title: string, description: string, keyword: string) {
  const key = keyword.trim().toLowerCase();
  if (!key) return 0;
  const name = (title || "").toLowerCase();
  if (name === key) return 4;
  if (name.startsWith(key)) return 3;
  if (name.includes(key)) return 2;
  return (description || "").toLowerCase().includes(key) ? 1 : 0;
}

function SearchResultCard({
  item,
  onOpen,
}: {
  item: SearchResult;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        textAlign: "left",
        border: "1px solid var(--line, #f0f0f0)",
        borderRadius: 12,
        padding: "16px 18px",
        background: "#fff",
        cursor: "pointer",
        display: "grid",
        gap: 8,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </strong>
        <Tag color={SOURCE_COLORS[item.source]} style={{ marginInlineEnd: 0 }}>
          {SOURCE_LABELS[item.source]}
        </Tag>
      </span>
      <span
        className="text-12 muted"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {item.description}
      </span>
      {item.meta ? <span className="text-12 muted">{item.meta}</span> : null}
    </button>
  );
}

function AppSearchPanel({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [recommended, setRecommended] = useState<MarketApp[]>([]);
  const [recommending, setRecommending] = useState(true);
  const [recommendError, setRecommendError] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const loadRecommended = useCallback(() => {
    setRecommending(true);
    setRecommendError("");
    appsApi
      .list({ query: { page: 1, pageSize: RECOMMEND_SIZE } })
      .then((data) => setRecommended((data?.list || []) as MarketApp[]))
      .catch((caught: unknown) => {
        setRecommended([]);
        setRecommendError(errText(caught));
      })
      .finally(() => setRecommending(false));
  }, []);

  useEffect(() => {
    void loadRecommended();
  }, [loadRecommended]);

  const search = useCallback(async (keyword: string) => {
    setSearching(true);
    setSearchError("");
    const settled = await Promise.allSettled([
      lowcodeApi.projects({ query: { scope: "mine", keyword } }),
      lowcodeApi.projects({ query: { scope: "enterprise", keyword } }),
      appsApi.list({ query: { page: 1, pageSize: SEARCH_PAGE_SIZE, q: keyword } }),
    ]);
    const mineRows =
      settled[0].status === "fulfilled"
        ? ((settled[0].value || []) as LowCodeProjectView[])
        : [];
    const orgRows =
      settled[1].status === "fulfilled"
        ? ((settled[1].value || []) as LowCodeProjectView[])
        : [];
    const marketRows =
      settled[2].status === "fulfilled"
        ? ((settled[2].value?.list || []) as MarketApp[])
        : [];
    const mineIds = new Set(mineRows.map((item) => item.id));
    const projectResult = (
      row: LowCodeProjectView,
      source: SearchSource,
    ): SearchResult => ({
      key: `${source}:${row.id}`,
      title: row.name,
      description: row.description || "暂无说明",
      source,
      href: `/lowcode/p/${row.id}`,
      meta: [
        row.orgName || "仅本人",
        row.typeLabel || LOWCODE_PROJECT_TYPE_LABELS[row.type] || row.type,
      ]
        .filter(Boolean)
        .join(" · "),
      score: matchScore(row.name, row.description || "", keyword),
    });
    const marketResult = (app: MarketApp): SearchResult => ({
      key: `market:${app.clientId}`,
      title: app.name || "未命名应用",
      description: app.description || "该应用还没有填写简介",
      source: "market",
      href: `/apps/${encodeURIComponent(app.clientId)}`,
      meta: app.category ? `分类：${app.category}` : "外部应用",
      score: matchScore(app.name || "", app.description || "", keyword),
    });
    const merged = [
      ...mineRows.map((row) => projectResult(row, "mine")),
      ...orgRows
        .filter((row) => !mineIds.has(row.id))
        .map((row) => projectResult(row, "enterprise")),
      ...marketRows.map(marketResult),
    ];
    merged.sort(
      (left, right) =>
        right.score - left.score ||
        left.title.localeCompare(right.title, "zh-CN"),
    );
    setResults(merged);
    if (settled.some((item) => item.status === "rejected")) {
      setSearchError("部分来源读取失败，结果可能不完整。");
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    if (!query) {
      setResults([]);
      setSearchError("");
      return;
    }
    void search(query);
  }, [query, search]);

  return (
    <Panel
      title="应用搜索"
      titleExtra={
        <span className="text-12 muted">
          一个关键词同时搜我构建的、本企业构建的和应用市场的应用
        </span>
      }
    >
      <div style={{ maxWidth: 640, margin: "0 auto 20px" }}>
        <Input.Search
          allowClear
          size="large"
          enterButton="搜索"
          placeholder="输入应用名称或关键词，例如：审批、客户、请购"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onSearch={(value) => setQuery(value.trim())}
        />
      </div>

      {query ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>{`“${query}” 的搜索结果`}</span>
            <span className="text-12 muted">{`共 ${results.length} 个`}</span>
          </div>
          {searchError ? (
            <div style={{ margin: "8px 0" }} className="text-12 muted">
              {searchError}
            </div>
          ) : null}
          <Spin spinning={searching}>
            {!searching && !results.length ? (
              <EmptyState text="没有找到相关应用，换个关键词试试。" />
            ) : (
              <ToolCardGrid>
                {results.map((item) => (
                  <SearchResultCard
                    key={item.key}
                    item={item}
                    onOpen={() => router.push(item.href)}
                  />
                ))}
              </ToolCardGrid>
            )}
          </Spin>
        </>
      ) : (
        <>
          <SectionHead
            title="应用市场"
            count={recommended.length}
            extra={
              <Button type="link" size="small" onClick={() => onOpenTab("market")}>
                查看更多
              </Button>
            }
          />
          {recommendError ? (
            <div style={{ margin: "8px 0" }} className="text-12 muted">
              {recommendError}
            </div>
          ) : null}
          {recommending ? (
            <Spin spinning>
              <div style={{ minHeight: 120 }} />
            </Spin>
          ) : recommended.length ? (
            <MarketAppCards apps={recommended} />
          ) : (
            <div className="text-12 muted">应用市场暂时没有可展示的应用。</div>
          )}
        </>
      )}
    </Panel>
  );
}