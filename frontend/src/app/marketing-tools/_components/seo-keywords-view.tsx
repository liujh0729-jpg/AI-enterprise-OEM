"use client";

import { App, Button, Form, Input, InputNumber, Select, Space, Table, Tag, Upload } from "antd";
import type { TableProps } from "antd";
import { useState, type ReactNode } from "react";
import { InboxOutlined } from "@ant-design/icons";
import { EmptyState, Notice, Panel, PillTabs } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  useSeoActions,
  useSeoClusters,
  useSeoGscAnalysis,
  useSeoGscImports,
  useSeoKeywords,
  useSeoSettings,
} from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { fmtNum, keywordSourceLabel, SendToGeoQuestionButton, SendToTrackerButton, type SeoProject } from "./seo-common";

type ResearchRow = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  difficulty: number | null;
  intent: string;
  source: string;
  opportunity: number;
};

/** 关键词：实测扩展（DataForSEO）/ AI 估计 → 入库 → 聚类；GSC 导入与「触手可及」分析。 */
export function SeoKeywordsView({ project }: { project: SeoProject }) {
  const [tab, setTab] = useState("library");
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PillTabs
        items={[
          { key: "library", label: "关键词库" },
          { key: "research", label: "扩展研究" },
          { key: "clusters", label: "聚类" },
          { key: "gsc", label: "GSC 导入与分析" },
        ]}
        value={tab}
        onChange={setTab}
        variant="soft"
      />
      {tab === "library" ? <KeywordLibrary project={project} /> : null}
      {tab === "research" ? <KeywordResearch project={project} /> : null}
      {tab === "clusters" ? <KeywordClusters project={project} /> : null}
      {tab === "gsc" ? <GscPanel project={project} /> : null}
    </div>
  );
}

function KeywordLibrary({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const query = useSeoKeywords(project.id, q, "", page);
  const rows = query.data?.list ?? [];
  const total = query.data?.total ?? 0;
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedKeywords = rows.filter((r) => selectedIds.includes(r.id)).map((r) => r.keyword);

  const remove = async (id: number) => {
    try {
      await actions.removeKeyword.mutateAsync({ body: { id } });
      message.success("已删除关键词");
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    }
  };

  return (
    <Panel
      title="关键词库"
      extra={
        <Space>
          <SendToTrackerButton projectId={project.id} keywords={selectedKeywords} />
          <SendToGeoQuestionButton keywords={selectedKeywords} />
          <Input.Search placeholder="搜索关键词" allowClear style={{ width: 220 }} onSearch={(v) => { setQ(v); setPage(1); setSelectedIds([]); }} />
        </Space>
      }
    >
      {query.isError ? <Notice variant="warn">{query.error?.message}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={query.isPending}
        dataSource={rows}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as number[]) }}
        pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); setSelectedIds([]); }, showSizeChanger: false }}
        columns={[
          { title: "关键词", dataIndex: "keyword", ellipsis: true },
          { title: "标签", dataIndex: "tags", width: 160, render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>) },
          { title: "搜索量", dataIndex: "volume", width: 90, render: fmtNum },
          { title: "CPC", dataIndex: "cpc", width: 80, render: (v: number | null) => (v === null ? "—" : `$${v}`) },
          { title: "难度", dataIndex: "difficulty", width: 70, render: (v: number | null) => (v === null ? "—" : v) },
          { title: "意图", dataIndex: "intent", width: 90 },
          { title: "来源", dataIndex: "source", width: 110, render: (s: string) => <Tag color={s === "DATAFORSEO" ? "green" : s === "GSC" ? "blue" : "default"}>{keywordSourceLabel(s)}</Tag> },
          { title: "操作", width: 70, render: (_: unknown, r: { id: number }) => <Button danger size="small" type="link" onClick={() => void remove(r.id)}>删除</Button> },
        ]}
        locale={{ emptyText: <EmptyState text="关键词库为空：去「扩展研究」用 DataForSEO 实测或 AI 估计扩展，再勾选入库" /> }}
      />
    </Panel>
  );
}

function KeywordResearch({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const settingsQuery = useSeoSettings();
  const providerConnected = (settingsQuery.data ?? []).some((r) => r.code === "dataforseo" && r.connected);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ keywords: ResearchRow[]; mode: string; reused: boolean } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const research = async () => {
    try {
      const values = await form.validateFields();
      setBusy(true);
      setSelected([]);
      const r = await actions.researchKeywords.mutateAsync({
        body: {
          projectId: project.id,
          seed: values.seed ?? "",
          competitorDomain: values.competitorDomain ?? "",
          locationCode: values.locationCode ?? project.locationCode,
          languageCode: values.languageCode ?? project.languageCode,
          limit: values.limit ?? 30,
        },
      });
      setResult(r ?? null);
      if (r?.mode === "ai") message.info("无 DataForSEO Key 或实测失败：本次为 AI 估计（已标注，非实测搜索量）");
      else if (r?.reused) message.info("命中 30 天研究缓存，未重复计费");
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result || selected.length === 0) return;
    setSaving(true);
    try {
      const picked = result.keywords.filter((k) => selected.includes(k.keyword));
      const r = await actions.saveKeywords.mutateAsync({
        body: {
          projectId: project.id,
          keywords: picked.map((k) => ({
            keyword: k.keyword,
            tags: [],
            volume: k.volume,
            cpc: k.cpc,
            difficulty: k.difficulty,
            intent: k.intent,
            source: k.source === "DATAFORSEO" ? "DATAFORSEO" : "AI",
          })),
        },
      });
      message.success(`已入库 ${r?.saved ?? picked.length} 个关键词`);
      setSelected([]);
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="扩展研究">
        {!providerConnected ? (
          <Notice variant="warn">未配置 DataForSEO：研究将降级为 AI 估计（搜索量/难度为模型推测，已标注「AI 估计」，非实测）。配 Key 后可得实测数据。</Notice>
        ) : null}
        <Form form={form} layout="vertical" style={{ marginTop: 12 }} initialValues={{ locationCode: project.locationCode, languageCode: project.languageCode, limit: 30 }}>
          <div className="form-2col">
            <Form.Item name="seed" label="种子词">
              <Input placeholder="如：running shoes" />
            </Form.Item>
            <Form.Item name="competitorDomain" label="竞品域名（挖竞品词）">
              <Input placeholder="如：competitor.com" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="locationCode" label="地区码（DataForSEO location_code）">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="languageCode" label="语言码">
              <Input placeholder="en / zh-CN" />
            </Form.Item>
          </div>
          <Form.Item name="limit" label="数量（1–100）">
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Button type="primary" loading={busy} onClick={() => void research()}>开始研究</Button>
        </Form>
      </Panel>

      {result ? (
        <Panel
          title={`研究结果（${result.keywords.length}）`}
          titleExtra={<span className="text-12 muted">· {result.mode === "dataforseo" ? "数据源实测" : "AI 估计"}{result.reused ? " · 命中缓存" : ""}</span>}
          extra={<Button type="primary" disabled={selected.length === 0} loading={saving} onClick={() => void save()}>入库选中（{selected.length}）</Button>}
        >
          <Table
            rowKey="keyword"
            size="small"
            dataSource={result.keywords}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            columns={[
              { title: "关键词", dataIndex: "keyword", ellipsis: true },
              { title: "搜索量", dataIndex: "volume", width: 90, render: fmtNum },
              { title: "CPC", dataIndex: "cpc", width: 80, render: (v: number | null) => (v === null ? "—" : `$${v}`) },
              { title: "难度", dataIndex: "difficulty", width: 70, render: (v: number | null) => (v === null ? "—" : v) },
              { title: "意图", dataIndex: "intent", width: 90 },
              { title: "机会分", dataIndex: "opportunity", width: 80, render: (v: number) => v.toFixed(2) },
              { title: "来源", dataIndex: "source", width: 110, render: (s: string) => keywordSourceLabel(s) },
            ]}
          />
        </Panel>
      ) : null}
    </div>
  );
}

function KeywordClusters({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const query = useSeoClusters(project.id);
  const [busy, setBusy] = useState(false);
  const clusters = query.data ?? [];

  const cluster = async () => {
    setBusy(true);
    try {
      const r = await actions.clusterKeywords.mutateAsync({ body: { projectId: project.id } });
      message.success(r?.mode === "llm" ? "AI 聚类完成" : "规则式聚类完成（无模型 Key 时降级）");
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="关键词聚类" extra={<Button type="primary" loading={busy} onClick={() => void cluster()}>重新聚类</Button>}>
      {query.isError ? <Notice variant="warn">{query.error?.message}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={query.isPending}
        dataSource={clusters}
        pagination={false}
        columns={[
          { title: "簇名", dataIndex: "name", ellipsis: true },
          { title: "意图", dataIndex: "intent", width: 120 },
          { title: "映射页面", dataIndex: "mappedPageUrl", ellipsis: true },
          { title: "关键词数", dataIndex: "keywordCount", width: 100 },
        ]}
        locale={{ emptyText: <EmptyState text="尚无聚类：关键词入库后点「重新聚类」按意图归簇并映射落地页" /> }}
      />
    </Panel>
  );
}

function GscPanel({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const importsQuery = useSeoGscImports(project.id);
  const [importId, setImportId] = useState(0);
  const analysisQuery = useSeoGscAnalysis(project.id, importId);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [strikingKeys, setStrikingKeys] = useState<string[]>([]);
  const imports = importsQuery.data ?? [];
  const analysis = analysisQuery.data;
  const strikingKeywords = (analysis?.strikingDistance ?? [])
    .filter((r) => strikingKeys.includes(`${r.query}|${r.page}`))
    .map((r) => r.query);

  const doImport = async () => {
    if (!csv.trim()) { message.warning("请先上传或粘贴 GSC 导出的 CSV"); return; }
    setImporting(true);
    try {
      const r = await actions.importGsc.mutateAsync({ body: { projectId: project.id, fileName, csv } });
      message.success(`已导入 ${r?.rowCount ?? 0} 行`);
      setCsv("");
      setFileName("");
      if (r?.id) setImportId(r.id);
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="导入 Search Console 数据">
        <Notice variant="info">上传 GSC「效果」报告导出的 CSV（含 查询/页面/点击/展示/CTR/排名 列），或直接粘贴。导入后自动算「触手可及」词（排名 5–20、有展示）。</Notice>
        <Space orientation="vertical" style={{ width: "100%", marginTop: 12 }}>
          <Upload.Dragger
            accept=".csv,text/csv"
            maxCount={1}
            beforeUpload={(file) => {
              void file.text().then((text) => { setCsv(text); setFileName(file.name); });
              return false;
            }}
            onRemove={() => { setCsv(""); setFileName(""); }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined aria-hidden /></p>
            <p className="ant-upload-text">点击或拖拽 CSV 到此处</p>
          </Upload.Dragger>
          <Input.TextArea rows={4} placeholder="或直接粘贴 CSV 内容" value={csv} onChange={(e) => setCsv(e.target.value)} />
          <Button type="primary" loading={importing} onClick={() => void doImport()}>导入</Button>
        </Space>
      </Panel>

      <Panel
        title="GSC 分析"
        extra={
          imports.length > 1 ? (
            <Select
              style={{ minWidth: 240 }}
              value={importId || undefined}
              placeholder="最新一次导入"
              allowClear
              onChange={(v) => { setImportId(v ?? 0); setStrikingKeys([]); }}
              options={imports.map((i) => ({ value: i.id, label: `${i.fileName || "导入"} · ${i.rowCount} 行 · ${fmtDateTime(i.createdAt)}` }))}
            />
          ) : null
        }
      >
        {imports.length === 0 ? (
          <EmptyState text="尚无 GSC 导入：先上传 CSV，或在「数据源设置」连接 Search Console 自动同步" />
        ) : !analysis ? (
          <EmptyState text={analysisQuery.isPending ? "正在分析…" : "暂无分析结果"} />
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <Space wrap>
              <Tag>点击 {fmtNum(analysis.totalClicks)}</Tag>
              <Tag>展示 {fmtNum(analysis.totalImpressions)}</Tag>
              <Tag>平均 CTR {(analysis.avgCtr * 100).toFixed(2)}%</Tag>
              <Tag>平均排名 {analysis.avgPosition.toFixed(1)}</Tag>
            </Space>
            <GscTable
              title={`触手可及（排名 5–20，${analysis.strikingDistance.length}）`}
              rows={analysis.strikingDistance}
              extra={
                <Space>
                  <SendToTrackerButton projectId={project.id} keywords={strikingKeywords} />
                  <SendToGeoQuestionButton keywords={strikingKeywords} />
                </Space>
              }
              rowSelection={{ selectedRowKeys: strikingKeys, onChange: (keys) => setStrikingKeys(keys as string[]) }}
            />
            <GscTable title={`热门查询（${analysis.topQueries.length}）`} rows={analysis.topQueries} />
            <GscTable title={`热门页面（${analysis.topPages.length}）`} rows={analysis.topPages} />
          </div>
        )}
      </Panel>
    </div>
  );
}

type GscRow = { query: string; page: string; clicks: number; impressions: number; ctr: number; position: number };

function GscTable({
  title,
  rows,
  extra,
  rowSelection,
}: {
  title: string;
  rows: GscRow[];
  extra?: ReactNode;
  rowSelection?: TableProps<GscRow>["rowSelection"];
}) {
  return (
    <Panel title={title} extra={extra}>
      <Table
        rowKey={(r) => `${r.query}|${r.page}`}
        rowSelection={rowSelection}
        size="small"
        dataSource={rows}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        columns={[
          { title: "查询", dataIndex: "query", ellipsis: true },
          { title: "页面", dataIndex: "page", ellipsis: true },
          { title: "点击", dataIndex: "clicks", width: 70 },
          { title: "展示", dataIndex: "impressions", width: 80 },
          { title: "CTR", dataIndex: "ctr", width: 80, render: (v: number) => `${(v * 100).toFixed(2)}%` },
          { title: "排名", dataIndex: "position", width: 70, render: (v: number) => v.toFixed(1) },
        ]}
        locale={{ emptyText: "无数据" }}
      />
    </Panel>
  );
}