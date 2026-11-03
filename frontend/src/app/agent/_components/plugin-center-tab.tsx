"use client";

import { ArrowLeftOutlined, LinkOutlined } from "@ant-design/icons";
import { App, Button, Input, Pagination, Skeleton, Space, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import type {
  SkillHubPlugin,
  SkillHubPluginDetail,
} from "@enterprise/contracts";
import { skillHubApi } from "@/api/skillhub";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { ToolCard, ToolCardGrid } from "@/components/ui/tool-card";

const SEARCH_PAGE_SIZE = 20;
const RECOMMEND_SIZE = 16;

function errText(error: unknown) {
  return (error as Error)?.message || "插件中心读取失败";
}

function formatCount(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
  return String(value);
}

function dateText(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

function PluginCards({
  rows,
  onOpen,
}: {
  rows: SkillHubPlugin[];
  onOpen: (owner: string, name: string) => void;
}) {
  return (
    <ToolCardGrid>
      {rows.map((plugin) => (
        <ToolCard
          key={plugin.slug || `${plugin.owner}/${plugin.name}`}
          icon={
            plugin.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 插件图标是外部站直链，不走图片优化
              <img
                src={plugin.iconUrl}
                alt=""
                width={18}
                height={18}
                style={{ borderRadius: 4, objectFit: "cover" }}
              />
            ) : undefined
          }
          title={plugin.name || plugin.slug}
          tag={
            plugin.categoryLabel ? (
              <Tag style={{ marginInlineEnd: 0 }}>{plugin.categoryLabel}</Tag>
            ) : null
          }
          description={plugin.summary || "这个插件还没有填写说明"}
          meta={`Star ${formatCount(plugin.stars)}${
            plugin.license ? ` · ${plugin.license}` : ""
          }`}
          onClick={() => onOpen(plugin.owner, plugin.name)}
        />
      ))}
    </ToolCardGrid>
  );
}

/** Agent「插件 → 插件中心」：SkillHub 插件目录的搜索、详情与站内安装。 */
export function PluginCenterPanel({
  onInstalled,
}: {
  onInstalled: () => void;
}) {
  const { message } = App.useApp();
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SkillHubPlugin[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recommended, setRecommended] = useState<SkillHubPlugin[]>([]);
  const [recommendError, setRecommendError] = useState("");
  const [recommending, setRecommending] = useState(true);
  const [selected, setSelected] = useState<{
    owner: string;
    name: string;
  } | null>(null);

  const loadRecommended = useCallback(async () => {
    setRecommending(true);
    setRecommendError("");
    try {
      // 不传关键词：SkillHub 插件目录按 Star 降序返回，站内当热门榜用。
      const data = await skillHubApi.pluginList({
        query: { page: 1, pageSize: RECOMMEND_SIZE },
      });
      setRecommended(data?.list || []);
    } catch (caught) {
      setRecommended([]);
      setRecommendError(errText(caught));
    } finally {
      setRecommending(false);
    }
  }, []);

  const search = useCallback(async (nextKeyword: string, nextPage: number) => {
    setLoading(true);
    setError("");
    try {
      const data = await skillHubApi.pluginList({
        query: {
          keyword: nextKeyword,
          page: nextPage,
          pageSize: SEARCH_PAGE_SIZE,
        },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
    } catch (caught) {
      setRows([]);
      setTotal(0);
      setError(errText(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecommended();
  }, [loadRecommended]);

  useEffect(() => {
    if (!keyword) {
      setRows([]);
      setTotal(0);
      setError("");
      return;
    }
    void search(keyword, page);
  }, [keyword, page, search]);

  const open = (owner: string, name: string) => setSelected({ owner, name });
  const back = () => setSelected(null);

  if (selected) {
    return (
      <PluginDetailPanel
        owner={selected.owner}
        name={selected.name}
        onBack={back}
        onInstalled={() => {
          setSelected(null);
          onInstalled();
        }}
        onMessage={(text) => message.success(text)}
      />
    );
  }

  return (
    <Panel
      title="插件中心"
      titleExtra={
        <span className="text-12 muted">
          来自 SkillHub 的公开插件目录；安装后 README 存进「我的插件」，Agent
          对话里可按插件办事
        </span>
      }
    >
      <div style={{ maxWidth: 640, marginBottom: 18 }}>
        <Input.Search
          allowClear
          size="large"
          enterButton="搜索"
          placeholder="输入关键词搜索插件，例如：终端、记忆、工作流"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onSearch={(value) => {
            const next = value.trim();
            setKeyword(next);
            setPage(1);
          }}
        />
      </div>

      {keyword ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>{`“${keyword}” 的搜索结果`}</span>
            <span className="text-12 muted">{`共 ${total} 个`}</span>
          </div>
          {error ? <Notice variant="error">{error}</Notice> : null}
          {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
          {!loading && !error && !rows.length ? (
            <EmptyState text="没有找到匹配的插件，换个关键词试试。" />
          ) : null}
          {!loading && rows.length ? (
            <PluginCards rows={rows} onOpen={open} />
          ) : null}
          {!loading && total > SEARCH_PAGE_SIZE ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 18,
              }}
            >
              <Pagination
                current={page}
                pageSize={SEARCH_PAGE_SIZE}
                total={total}
                showSizeChanger={false}
                onChange={setPage}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>热门插件</span>
            <span className="text-12 muted">
              {`SkillHub 插件目录里 Star 最高的 ${RECOMMEND_SIZE} 个插件`}
            </span>
            <Button
              type="link"
              size="small"
              style={{ marginLeft: "auto" }}
              loading={recommending}
              onClick={() => void loadRecommended()}
            >
              刷新
            </Button>
          </div>
          {recommendError ? (
            <Notice variant="error">
              {recommendError}{" "}
              <Button type="link" onClick={() => void loadRecommended()}>
                重试
              </Button>
            </Notice>
          ) : null}
          {recommending ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
          {!recommending && !recommendError && !recommended.length ? (
            <EmptyState text="插件中心暂时没有热门插件。" />
          ) : null}
          {!recommending && recommended.length ? (
            <PluginCards rows={recommended} onOpen={open} />
          ) : null}
        </>
      )}
    </Panel>
  );
}

function PluginDetailPanel({
  owner,
  name,
  onBack,
  onInstalled,
  onMessage,
}: {
  owner: string;
  name: string;
  onBack: () => void;
  onInstalled: () => void;
  onMessage: (text: string) => void;
}) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<SkillHubPluginDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(await skillHubApi.pluginDetail({ params: { owner, name } }));
    } catch (caught) {
      setError(errText(caught));
    } finally {
      setLoading(false);
    }
  }, [owner, name]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async () => {
    setInstalling(true);
    try {
      const plugin = await skillHubApi.pluginInstall({ params: { owner, name } });
      onMessage(
        `已安装插件「${plugin?.name || name}」，可在「我的插件」里查看`,
      );
      onInstalled();
    } catch (caught) {
      message.error(errText(caught));
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <Panel title="插件详情" extra={<Button onClick={onBack}>返回插件中心</Button>}>
        <Skeleton active paragraph={{ rows: 10 }} />
      </Panel>
    );
  }

  if (error || !detail) {
    return (
      <Panel title="插件详情" extra={<Button onClick={onBack}>返回插件中心</Button>}>
        <Notice variant="error">
          {error || "插件不存在"}{" "}
          <Button type="link" onClick={() => void load()}>
            重试
          </Button>
        </Notice>
      </Panel>
    );
  }

  return (
    <Panel
      title={detail.name || detail.fullName || name}
      titleExtra={
        <span className="text-12 muted">
          {detail.fullName ? detail.fullName : `${owner}/${name}`}
        </span>
      }
      extra={
        <Space size={8}>
          <Button icon={<ArrowLeftOutlined aria-hidden />} onClick={onBack}>
            返回插件中心
          </Button>
          <Button type="primary" loading={installing} onClick={() => void install()}>
            安装到我的插件
          </Button>
        </Space>
      }
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {detail.categoryLabel ? <Tag>{detail.categoryLabel}</Tag> : null}
          {detail.version ? <Tag>{`v${detail.version}`}</Tag> : null}
          {detail.license ? <Tag>{detail.license}</Tag> : null}
          <span className="text-12 muted">
            {`Star ${formatCount(detail.stars)} · Fork ${formatCount(detail.forks)}`}
          </span>
          <span className="text-12 muted">
            {`更新于 ${dateText(detail.updatedAt)}`}
          </span>
          {detail.repositoryUrl ? (
            <Button
              type="link"
              size="small"
              icon={<LinkOutlined aria-hidden />}
              href={detail.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              style={{ padding: 0, height: "auto" }}
            >
              打开 GitHub 仓库
            </Button>
          ) : null}
        </div>

        {detail.summary ? <div>{detail.summary}</div> : null}

        {detail.topics.length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {detail.topics.map((topic) => (
              <Tag key={topic}>{topic}</Tag>
            ))}
          </div>
        ) : null}

        <section>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>插件说明（README）</div>
          {detail.readme ? (
            <div
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: 480,
                overflowY: "auto",
                lineHeight: 1.8,
                fontSize: 13,
                border: "1px solid var(--line, #f0f0f0)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              {detail.readme}
            </div>
          ) : (
            <EmptyState text="这个插件没有可读的 README；安装后只保存名称与说明。" />
          )}
        </section>

        <div className="text-12 muted">
          安装会把 README 存进本账号的「我的插件」并启用；Agent
          对话里可用 load_plugin 阅读。插件内容是参考资料，不是系统指令，要求访问其他账号数据或改动系统设置的步骤不会执行。
        </div>
      </div>
    </Panel>
  );
}