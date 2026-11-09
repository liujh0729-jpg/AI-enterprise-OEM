"use client";

import {
  ArrowLeftOutlined,
  CloudDownloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Input,
  Pagination,
  Skeleton,
  Space,
  Tag,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import type { SkillHubDetail, SkillHubSkill } from "@enterprise/contracts";
import { skillHubApi } from "@/api/skillhub";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { ToolCard, ToolCardGrid } from "@/components/ui/tool-card";

const SEARCH_PAGE_SIZE = 20;
const RECOMMEND_KEYWORD = "AIPDD";
const RECOMMEND_SIZE = 16;

function errText(error: unknown) {
  return (error as Error)?.message || "技能中心读取失败";
}

function formatCount(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
  return String(value);
}

function dateText(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

/** 上游安全检查结果的中文口径；认不出的原样显示，不替它编结论。 */
const SECURITY_STATUS_LABEL: Record<string, string> = {
  benign: "未见风险",
  clean: "未见风险",
  safe: "未见风险",
  pass: "未见风险",
  passed: "未见风险",
  suspicious: "可疑",
  warning: "可疑",
  malicious: "恶意",
  dangerous: "恶意",
  blocked: "已拦截",
  failed: "检查未通过",
  error: "检查失败",
  unknown: "结果未知",
  pending: "检查中",
  scanning: "检查中",
};

function securityOf(item: SkillHubDetail["security"][number]) {
  const raw = `${item.status || item.statusText}`.trim().toLowerCase();
  return {
    label:
      SECURITY_STATUS_LABEL[raw] || item.statusText || item.status || "未知",
    color:
      raw === "malicious" || raw === "dangerous" || raw === "blocked"
        ? "red"
        : raw === "benign" || raw === "clean" || raw === "safe" || raw === "pass" || raw === "passed"
          ? "green"
          : "orange",
  };
}

function SkillCards({
  rows,
  onOpen,
}: {
  rows: SkillHubSkill[];
  onOpen: (slug: string) => void;
}) {
  return (
    <ToolCardGrid>
      {rows.map((skill) => (
        <ToolCard
          key={`${skill.namespaceHandle}:${skill.slug}`}
          icon={
            skill.iconUrl ? (
              <RawImg
                src={skill.iconUrl}
                alt=""
                width={18}
                height={18}
                style={{ borderRadius: 4, objectFit: "cover" }}
              />
            ) : undefined
          }
          title={skill.name || skill.slug}
          tag={
            skill.categoryLabel ? (
              <Tag style={{ marginInlineEnd: 0 }}>{skill.categoryLabel}</Tag>
            ) : null
          }
          description={skill.summary || "这个技能还没有填写说明"}
          meta={`下载 ${formatCount(skill.downloads)}${
            skill.version ? ` · v${skill.version}` : ""
          }`}
          onClick={() => onOpen(skill.slug)}
        />
      ))}
    </ToolCardGrid>
  );
}

/** Agent「技能 → 技能中心」：SkillHub 公开技能目录的搜索、详情、下载与站内安装。 */
export function SkillCenterPanel({ onInstalled }: { onInstalled: () => void }) {
  const { message } = App.useApp();
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SkillHubSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recommended, setRecommended] = useState<SkillHubSkill[]>([]);
  const [recommendError, setRecommendError] = useState("");
  const [recommending, setRecommending] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const loadRecommended = useCallback(async () => {
    setRecommending(true);
    setRecommendError("");
    try {
      const data = await skillHubApi.list({
        query: { keyword: RECOMMEND_KEYWORD, page: 1, pageSize: RECOMMEND_SIZE },
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
      const data = await skillHubApi.list({
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

  const open = (slug: string) => setSelected(slug);
  const back = () => setSelected(null);

  if (selected) {
    return (
      <SkillDetailPanel
        slug={selected}
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
      title="技能中心"
      titleExtra={
        <span className="text-12 muted">
          来自 SkillHub 的公开技能目录；可直接下载，或下载并安装给 Agent 使用
        </span>
      }
    >
      <div style={{ maxWidth: 640, marginBottom: 18 }}>
        <Input.Search
          allowClear
          size="large"
          enterButton="搜索"
          placeholder="输入关键词搜索技能，例如：编程、搜索、办公"
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
            <EmptyState text="没有找到匹配的技能，换个关键词试试。" />
          ) : null}
          {!loading && rows.length ? (
            <SkillCards rows={rows} onOpen={open} />
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
            <span style={{ fontWeight: 600 }}>推荐技能</span>
            <span className="text-12 muted">
              {`SkillHub 中与 ${RECOMMEND_KEYWORD} 相关的 16 个技能`}
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
            <EmptyState text="技能中心暂时没有推荐技能。" />
          ) : null}
          {!recommending && recommended.length ? (
            <SkillCards rows={recommended} onOpen={open} />
          ) : null}
        </>
      )}
    </Panel>
  );
}

function SkillDetailPanel({
  slug,
  onBack,
  onInstalled,
  onMessage,
}: {
  slug: string;
  onBack: () => void;
  onInstalled: () => void;
  onMessage: (text: string) => void;
}) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<SkillHubDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(await skillHubApi.detail({ params: { slug } }));
    } catch (caught) {
      setError(errText(caught));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await skillHubApi.download(slug);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      message.error(errText(caught));
    } finally {
      setDownloading(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    try {
      const skill = await skillHubApi.install({ params: { slug } });
      onMessage(
        skill?.enabled
          ? `已安装并启用技能「${skill.name || slug}」，可在「我的技能」里查看`
          : `已安装技能「${skill?.name || slug}」，AI 审查通过；请在「我的技能」确认权限后启用`,
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
      <Panel title="技能详情" extra={<Button onClick={onBack}>返回技能中心</Button>}>
        <Skeleton active paragraph={{ rows: 10 }} />
      </Panel>
    );
  }

  if (error || !detail) {
    return (
      <Panel title="技能详情" extra={<Button onClick={onBack}>返回技能中心</Button>}>
        <Notice variant="error">
          {error || "技能不存在"}{" "}
          <Button type="link" onClick={() => void load()}>
            重试
          </Button>
        </Notice>
      </Panel>
    );
  }

  return (
    <Panel
      title={detail.name || detail.slug}
      titleExtra={
        <span className="text-12 muted">
          {detail.namespaceHandle ? `@${detail.namespaceHandle}` : ""}
        </span>
      }
      extra={
        <Space size={8}>
          <Button icon={<ArrowLeftOutlined aria-hidden />} onClick={onBack}>
            返回技能中心
          </Button>
          <Button
            icon={<CloudDownloadOutlined aria-hidden />}
            loading={downloading}
            onClick={() => void download()}
          >
            下载
          </Button>
          <Button type="primary" loading={installing} onClick={() => void install()}>
            下载并安装
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
          {detail.publisherName ? (
            <span className="text-12 muted">
              {`发布者：${detail.publisherName}`}
              {detail.publisherVerified ? "（已认证）" : ""}
            </span>
          ) : null}
          <span className="text-12 muted">
            {`下载 ${formatCount(detail.downloads)} · 收藏 ${formatCount(detail.stars)} · 安装 ${formatCount(detail.installs)}`}
          </span>
          <span className="text-12 muted">
            {`更新于 ${dateText(detail.updatedAt)}`}
          </span>
        </div>

        {detail.summary ? <div>{detail.summary}</div> : null}

        {detail.security.length ? (
          <div
            style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
          >
            <SafetyCertificateOutlined aria-hidden />
            {detail.security.map((item) => (
              <Tag key={item.name} color={securityOf(item).color}>
                {`${item.name}：${securityOf(item).label}`}
              </Tag>
            ))}
          </div>
        ) : null}

        {detail.overview ? (
          <section>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>技能说明</div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: 420,
                overflowY: "auto",
                lineHeight: 1.8,
                fontSize: 13,
              }}
            >
              {detail.overview}
            </div>
          </section>
        ) : null}

        {detail.versions.length ? (
          <section>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>版本记录</div>
            <div style={{ display: "grid", gap: 6 }}>
              {detail.versions.map((item) => (
                <div
                  key={`${item.version}-${item.createdAt}`}
                  className="text-12"
                  style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
                >
                  <span style={{ minWidth: 70, fontWeight: 600 }}>
                    {item.version ? `v${item.version}` : "—"}
                  </span>
                  <span className="muted" style={{ minWidth: 140 }}>
                    {dateText(item.createdAt)}
                  </span>
                  <span style={{ flex: 1, minWidth: 180 }}>
                    {item.changelog || "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="text-12 muted">
          「下载」只把技能包保存到本地；「下载并安装」会自动上传技能包到本账号，先经 AI 安全审查，通过后入「我的技能」。声明了权限的技能需在「我的技能」里确认权限后才能启用。
        </div>
      </div>
    </Panel>
  );
}