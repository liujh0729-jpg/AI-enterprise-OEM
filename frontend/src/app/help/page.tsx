"use client";

import {
  BookOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Breadcrumb,
  Button,
  Empty,
  Input,
  List,
  Menu,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { HelpChapter, HelpSearchHit, HelpTopicDetail } from "@enterprise/contracts";
import { PageHero } from "@/components/ui/panel";
import { useI18n } from "@/lib/i18n/i18n";
import { helpApi } from "./_components/help-common";
import { GapsChangelogList } from "./_components/gaps-changelog";

/**
 * 帮助中心（章节知识库）：左侧章节树 + 右侧正文，顶部全文搜索。
 * 内容以后端内置知识为准（与 MCP Help_* 同源），这里只做只读展示；
 * 右上角问号 icon 是主入口，深链 /help?topic=xxx 可直达某主题。
 */

/** 极简 Markdown 渲染：仅覆盖知识库正文用到的 **加粗**、无序/有序列表与段落，不引第三方库。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(
      <strong key={`${keyPrefix}-b${index}`}>{match[1]}</strong>,
    );
    cursor = match.index + match[0].length;
    index += 1;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function renderMarkdown(markdown: string): ReactNode {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listBuffer: { ordered: boolean; items: string[] } | null = null;
  let blockKey = 0;

  const flushList = () => {
    if (!listBuffer) return;
    const items = listBuffer.items.map((item, i) => (
      <li key={i} style={{ marginBottom: 4 }}>
        {renderInline(item, `li-${blockKey}-${i}`)}
      </li>
    ));
    blocks.push(
      listBuffer.ordered ? (
        <ol key={`blk-${blockKey}`} style={{ margin: "6px 0 12px 22px", paddingLeft: 0 }}>
          {items}
        </ol>
      ) : (
        <ul key={`blk-${blockKey}`} style={{ margin: "6px 0 12px 22px", paddingLeft: 0 }}>
          {items}
        </ul>
      ),
    );
    listBuffer = null;
    blockKey += 1;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    const unordered = /^[-*]\s+(.*)$/.exec(trimmed);
    const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (unordered || ordered) {
      const orderedMatch = Boolean(ordered);
      const content = (unordered?.[1] ?? ordered?.[1] ?? "").trim();
      if (!listBuffer || listBuffer.ordered !== orderedMatch) {
        flushList();
        listBuffer = { ordered: orderedMatch, items: [] };
      }
      listBuffer.items.push(content);
      continue;
    }
    flushList();
    blocks.push(
      <Typography.Paragraph key={`blk-${blockKey}`} style={{ marginBottom: 12 }}>
        {renderInline(trimmed, `p-${blockKey}`)}
      </Typography.Paragraph>,
    );
    blockKey += 1;
  }
  flushList();
  return <div>{blocks}</div>;
}

type HelpView = "docs" | "changelog";

/** 帮助中心侧栏三层节点（角色分区 → 章节 → 主题）；key 用整条路径，避免跨分区撞码。 */
type HelpMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  children?: HelpMenuItem[];
};

export default function HelpCenterPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [view, setView] = useState<HelpView>("docs");
  const [chapters, setChapters] = useState<HelpChapter[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeCode, setActiveCode] = useState("");
  const [activeMenuKey, setActiveMenuKey] = useState("");
  const [topic, setTopic] = useState<HelpTopicDetail | null>(null);
  const [loadingTopic, setLoadingTopic] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<HelpSearchHit[] | null>(null);
  /** 首屏深链要选中的主题 code；目录菜单建好后才知道对应的叶子 key。 */
  const pendingCode = useMemo(
    () => new URLSearchParams(window.location.search).get("topic") || "",
    [],
  );

  const openTopic = useCallback(async (code: string, menuKey?: string) => {
    setActiveCode(code);
    if (menuKey !== undefined) setActiveMenuKey(menuKey);
    setLoadingTopic(true);
    setTopic(null);
    try {
      const detail = await helpApi.topic({ params: { code } });
      setTopic(detail);
      setLoadError("");
      const params = new URLSearchParams(window.location.search);
      if (params.get("topic") !== code) {
        window.history.replaceState(null, "", `?topic=${encodeURIComponent(code)}`);
      }
    } catch (error) {
      setActiveCode("");
      setLoadError(error instanceof Error ? error.message : "加载帮助主题失败");
    } finally {
      setLoadingTopic(false);
    }
  }, []);

  // 载入章节目录；默认选中深链 topic 或第一条主题。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await helpApi.chapters();
        if (cancelled) return;
        const list = data ?? [];
        setChapters(list);
        const want = pendingCode;
        const first = list[0]?.topics[0]?.code || "";
        const initial = list.some((c) => c.topics.some((x) => x.code === want)) ? want : first;
        if (initial) void openTopic(initial);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "加载帮助中心失败");
      } finally {
        if (!cancelled) setLoadingChapters(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openTopic, pendingCode]);

  const runSearch = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setHits(null);
      return;
    }
    setSearching(true);
    try {
      const data = await helpApi.search({ query: { keyword: trimmed } });
      setHits(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  }, []);

  // 输入防抖 350ms：停手再搜，避免逐字打接口。
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(keyword), 350);
    return () => clearTimeout(timer);
  }, [keyword, runSearch]);

  /**
   * 侧栏按角色分区：同一章节可归属多个角色（如「AI 获客」企业用户与服务商都可见），
   * 会在多个分区下各出现一次。菜单 key 因此不能用裸章节/主题 code——那会在分区之间撞码
   * （React 会报 Duplicated key）。这里用「分区/章节/主题」全路径做 key，再建一张
   * 「叶子 key → 主题 code」的反查表，点击时按 code 打开正文。
   */
  const { menuItems, groupKeys, codeByKey, keyByCode } = useMemo(() => {
    const groups = new Map<string, { label: string; chapters: HelpChapter[] }>();
    for (const chapter of chapters) {
      const audiences = chapter.audience.length
        ? chapter.audience
        : [{ code: "GENERAL" as const, label: "通用帮助" }];
      for (const audience of audiences) {
        const group = groups.get(audience.code) ?? { label: audience.label, chapters: [] };
        group.chapters.push(chapter);
        groups.set(audience.code, group);
      }
    }
    const codeByKey = new Map<string, string>();
    const keyByCode = new Map<string, string>();
    const groupKeys: string[] = [];
    const items: HelpMenuItem[] = [...groups.entries()].map(([code, group]) => {
      const groupKey = `audience-${code}`;
      groupKeys.push(groupKey);
      return {
        key: groupKey,
        label: group.label,
        children: group.chapters.map((chapter) => {
          const chapterKey = `${groupKey}/${chapter.code}`;
          return {
            key: chapterKey,
            icon: <BookOutlined />,
            label: chapter.title,
            children: chapter.topics.map((item) => {
              const leafKey = `${chapterKey}/${item.code}`;
              codeByKey.set(leafKey, item.code);
              if (!keyByCode.has(item.code)) keyByCode.set(item.code, leafKey);
              return { key: leafKey, label: item.title };
            }),
          };
        }),
      };
    });
    return { menuItems: items, groupKeys, codeByKey, keyByCode };
  }, [chapters]);

  // 点击用整条路径 key 精确高亮；深链进来还没点过时，回落到该主题在首个分区下的 key。
  const fallbackKey = activeCode ? keyByCode.get(activeCode) : undefined;
  const selectedKeys = [activeMenuKey || fallbackKey || ""].filter(Boolean);
  const activeChapterKey = selectedKeys[0]?.slice(0, selectedKeys[0].lastIndexOf("/"));
  const defaultOpenKeys = [
    ...groupKeys,
    ...(activeChapterKey ? [activeChapterKey] : []),
  ];

  return (
    <div style={{ padding: 0 }}>
      <PageHero
        title={t("帮助中心")}
        desc={t("按章节了解系统怎么用；也可以直接问右上角的 Agent，它会读同一份知识库回答。")}
        tabs={[
          { key: "docs", label: t("使用文档") },
          { key: "changelog", label: t("更新日志") },
        ]}
        activeTab={view}
        onTabChange={(key) => setView(key as HelpView)}
      />

      {view === "changelog" ? <GapsChangelogList /> : null}

      {view === "docs" && loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title={loadError}
          onClose={() => setLoadError("")}
          closable
        />
      )}

      {view === "docs" ? (
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ width: 280, flexShrink: 0 }}>
          <Input
            allowClear
            size="large"
            prefix={<SearchOutlined />}
            placeholder={t("搜索使用问题，如「插件」「线索转客户」")}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          {hits ? (
            <List
              size="small"
              bordered
              loading={searching}
              dataSource={hits}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有匹配的主题，换个说法试试")} /> }}
              renderItem={(item) => (
                <List.Item
                  style={{ cursor: "pointer", display: "block" }}
                  onClick={() => {
                    setKeyword("");
                    setHits(null);
                    void openTopic(item.code);
                  }}
                >
                  <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                    <Tag color="blue">{item.chapterTitle}</Tag>
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.excerpt}
                    </Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          ) : loadingChapters ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : (
            <Menu
              mode="inline"
              selectedKeys={selectedKeys}
              defaultOpenKeys={defaultOpenKeys}
              items={menuItems}
              onClick={({ key }) => {
                const code = codeByKey.get(key);
                if (code) void openTopic(code, key);
              }}
              style={{ maxHeight: "calc(100vh - 260px)", overflow: "auto" }}
            />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 320 }}>
          {loadingTopic ? (
            <Skeleton active paragraph={{ rows: 10 }} />
          ) : !topic ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("暂无可显示的主题，请从左侧目录选择")}
            />
          ) : (
            <div
              style={{
                background: "var(--ant-color-bg-container, #fff)",
                borderRadius: 8,
                padding: "20px 28px",
                border: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
              }}
            >
              <Breadcrumb
                style={{ marginBottom: 12 }}
                items={[
                  { title: <span><QuestionCircleOutlined /> {t("帮助中心")}</span> },
                  { title: topic.chapterTitle },
                  { title: topic.title },
                ]}
              />
              <Typography.Title level={3} style={{ marginTop: 0 }}>
                <FileTextOutlined /> {topic.title}
              </Typography.Title>
              <Typography.Paragraph type="secondary">{topic.summary}</Typography.Paragraph>
              {topic.routePath && (
                <Space style={{ marginBottom: 16 }}>
                  <Button
                    type="primary"
                    icon={<RightOutlined />}
                    onClick={() => router.push(topic.routePath)}
                  >
                    {t("去这个页面")}
                  </Button>
                  <Typography.Text type="secondary">{topic.routePath}</Typography.Text>
                </Space>
              )}
              <div style={{ fontSize: 14, lineHeight: 1.9 }}>{renderMarkdown(topic.content)}</div>
            </div>
          )}
        </div>
      </div>
      ) : null}
    </div>
  );
}
