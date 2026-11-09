"use client";

import { App, Button, Input, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { EmptyState, Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { useSeoActions, useSeoCompetitorOverview, useSeoSettings } from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { NoSourceNotice, domainOf, fmtNum, fmtPos, type SeoProject } from "./seo-common";

/** 竞品洞察：DataForSEO 竞品自然词/流量/外链 + 关键词重叠 + 页面结构对比（AI 差距分析）。 */
export function SeoCompetitorsView({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const settingsQuery = useSeoSettings();
  const providerConnected = (settingsQuery.data ?? []).some((r) => r.code === "dataforseo" && r.connected);
  const [domain, setDomain] = useState(project.competitors[0] ?? "");
  const [manual, setManual] = useState("");
  const overviewQuery = useSeoCompetitorOverview(project.id, domain);
  const overview = overviewQuery.data;
  const [pages, setPages] = useState<{ domain: string; pages: { url: string; title: string; wordCount: number; h2Count: number; hasJsonLd: boolean; internalLinks: number; images: number }[]; aiAnalysis: string } | null>(null);
  const [comparing, setComparing] = useState(false);

  const compare = async () => {
    if (!domain) return;
    setComparing(true);
    try {
      const r = await actions.competitorPages.mutateAsync({ body: { projectId: project.id, domain } });
      setPages(r ?? null);
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setComparing(false);
    }
  };

  const options = project.competitors.map((c) => ({ value: c, label: c }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {!providerConnected ? <NoSourceNotice>竞品洞察需要 DataForSEO Key。未配置时不造假竞品数据；可在「数据源设置」配置。</NoSourceNotice> : null}
      <Panel title="选择竞品">
        <Space wrap>
          {options.length > 0 ? (
            <Select style={{ minWidth: 240 }} value={domain || undefined} placeholder="项目预设竞品" options={options} onChange={setDomain} />
          ) : null}
          <Input.Search
            placeholder="或输入竞品域名"
            allowClear
            style={{ width: 260 }}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onSearch={(v) => { const d = domainOf(v); if (d.length >= 3) { setDomain(d); setPages(null); } }}
            enterButton="查看"
          />
        </Space>
        {project.competitors.length === 0 ? <p className="text-12 muted" style={{ marginTop: 8 }}>项目未预设竞品：可在「项目设置」里补充，或直接输入域名查看。</p> : null}
      </Panel>

      {domain.length >= 3 ? (
        overviewQuery.isError ? (
          <Notice variant="warn">{overviewQuery.error?.message}</Notice>
        ) : !overview ? (
          <EmptyState text={overviewQuery.isPending ? "正在查询竞品…" : "暂无数据"} />
        ) : !overview.available ? (
          <NoSourceNotice />
        ) : (
          <>
            <StatGrid>
              <StatCard label="自然关键词" value={fmtNum(overview.organicKeywords)} />
              <StatCard label="自然流量（估）" value={fmtNum(overview.organicTraffic)} />
              <StatCard label="外链" value={fmtNum(overview.backlinks)} />
              <StatCard label="引用域" value={fmtNum(overview.referringDomains)} />
            </StatGrid>
            <Panel title={`关键词重叠（${overview.overlap.length}）`} titleExtra={<span className="text-12 muted">· 我也排名的词，对比双方位置</span>}>
              <Table
                rowKey="keyword"
                size="small"
                dataSource={overview.overlap}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                columns={[
                  { title: "关键词", dataIndex: "keyword", ellipsis: true },
                  { title: "我的排名", dataIndex: "myPosition", width: 110, render: fmtPos },
                  { title: "竞品排名", dataIndex: "theirPosition", width: 110, render: fmtPos },
                ]}
                locale={{ emptyText: "无重叠词" }}
              />
            </Panel>
            <Panel title={`竞品热门自然词（${overview.rankedKeywords.length}）`}>
              <Table
                rowKey="keyword"
                size="small"
                dataSource={overview.rankedKeywords}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                columns={[
                  { title: "关键词", dataIndex: "keyword", ellipsis: true },
                  { title: "排名", dataIndex: "position", width: 90, render: fmtPos },
                  { title: "搜索量", dataIndex: "volume", width: 100, render: fmtNum },
                ]}
                locale={{ emptyText: "无数据" }}
              />
            </Panel>
            <Panel title="页面结构对比" extra={<Button type="primary" loading={comparing} onClick={() => void compare()}>抓取并 AI 分析</Button>}>
              {!pages ? (
                <EmptyState text="点「抓取并 AI 分析」抓竞品首页/热门页结构，并与本站做差距分析（AI 计积分，无 Key 时规则降级）" />
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {pages.aiAnalysis ? <Notice variant="info"><div style={{ whiteSpace: "pre-wrap" }}>{pages.aiAnalysis}</div></Notice> : null}
                  <Table
                    rowKey="url"
                    size="small"
                    dataSource={pages.pages}
                    pagination={false}
                    scroll={{ x: 800 }}
                    columns={[
                      { title: "URL", dataIndex: "url", ellipsis: true, width: 260 },
                      { title: "标题", dataIndex: "title", ellipsis: true },
                      { title: "字数", dataIndex: "wordCount", width: 70 },
                      { title: "H2", dataIndex: "h2Count", width: 60 },
                      { title: "内链", dataIndex: "internalLinks", width: 70 },
                      { title: "图片", dataIndex: "images", width: 70 },
                      { title: "JSON-LD", dataIndex: "hasJsonLd", width: 90, render: (v: boolean) => (v ? <Tag color="green">有</Tag> : <Tag>无</Tag>) },
                    ]}
                  />
                </div>
              )}
            </Panel>
          </>
        )
      ) : (
        <EmptyState text="选择或输入一个竞品域名开始洞察" />
      )}
    </div>
  );
}