"use client";

import { App, Button, Form, Input, InputNumber, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { seoApi } from "@/api/seo";
import { mktApi } from "@/api/mkt";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import { useSeoActions, useSeoProgrammaticPages, useSeoProgrammaticRuns, useSeoTables } from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { fmtNum, type SeoProgrammaticPage, type SeoProgrammaticRun, type SeoProject } from "./seo-common";

const RUN_COLOR: Record<string, string> = { DONE: "green", RUNNING: "blue", PENDING: "default", FAILED: "red" };
const RUN_LABEL: Record<string, string> = { DONE: "已完成", RUNNING: "生成中", PENDING: "排队中", FAILED: "失败" };

function downloadBase64(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** 程序化 SEO：以多维表格为数据源，模板优先批量生成落地页（≤200），可选逐行 AI 描述，导出 zip 部署到客户自有域名。 */
export function SeoProgrammaticView({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const tablesQuery = useSeoTables();
  const tables = (tablesQuery.data ?? []).filter((t) => t.can.read);
  const runsQuery = useSeoProgrammaticRuns(project.id);
  const runs = runsQuery.data ?? [];
  const [form] = Form.useForm();
  const [preview, setPreview] = useState<{ pages: SeoProgrammaticPage[]; template: string; mode: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [runId, setRunId] = useState(0);
  const pagesQuery = useSeoProgrammaticPages(runId);
  const pages = pagesQuery.data ?? [];

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (error) { if (error instanceof Error) presentMutationError(error, (t) => message.error(t)); } finally { setBusy(""); }
  };

  const readForm = async () => {
    const values = await form.validateFields();
    return {
      projectId: project.id,
      tableId: values.tableId as number,
      keywordPattern: (values.keywordPattern as string) ?? "",
      template: (values.template as string) ?? "",
    };
  };

  const doPreview = () => void run("preview", async () => {
    const base = await readForm();
    const r = await actions.programmaticPreview.mutateAsync({ body: { ...base, sampleRows: 3 } });
    setPreview(r ?? null);
  });

  const doGenerate = () => void run("generate", async () => {
    const base = await readForm();
    const maxRows = (form.getFieldValue("maxRows") as number) ?? 50;
    const r = await actions.programmaticGenerate.mutateAsync({ body: { ...base, maxRows } });
    message.success("批量生成已启动，后台逐行渲染；完成后在下方导出");
    if (r?.id) setRunId(r.id);
    setPreview(null);
  });

  const doExport = (id: number) => void run(`export${id}`, async () => {
    const r = await seoApi.programmaticExport({ query: { runId: id } });
    if (!r?.contentBase64) throw new Error("导出为空");
    downloadBase64(r.fileName, r.contentBase64);
    message.success("已下载 zip：解压后部署到你自己的域名（含 index.html 与 sitemap.xml）");
  });

  const saveAsset = (page: SeoProgrammaticPage) => void run(`asset${page.id}`, async () => {
    if (page.body.length > 20000) {
      message.warning("页面正文超过 2 万字符，无法完整存入内容资产；请先精简模板后重新生成");
      return;
    }
    await mktApi.saveArtifact({ body: { title: page.title.slice(0, 120), kind: "SEO_PAGE", body: page.body, status: "DRAFT" } });
    message.success("已存入内容资产（草稿，类型：SEO 页面）");
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Notice variant="info">程序化页面以「多维表格」为数据源：每行渲染一个落地页，模板里的 {"{{列名}}"} 会被该行值替换（HTML 转义防注入）。先预览再生成，最多 200 页；可选逐行 AI  meta 描述（计积分）。导出的 zip 部署到你自有域名，本系统不托管。</Notice>
      <Panel title="生成配置">
        {tables.length === 0 ? (
          <EmptyState text="没有可读的多维表格：先在「多维表格」里建一张含目标列（如 城市/服务/关键词）的表" />
        ) : (
          <Form form={form} layout="vertical" initialValues={{ maxRows: 50 }}>
            <div className="form-2col">
              <Form.Item name="tableId" label="数据源表 *" rules={[{ required: true, message: "请选择数据源表" }]}>
                <Select placeholder="选择多维表格" options={tables.map((t) => ({ value: t.id, label: `${t.name}（${t.rowCount} 行）` }))} />
              </Form.Item>
              <Form.Item name="maxRows" label="最多生成页数（1–200）"><InputNumber min={1} max={200} style={{ width: "100%" }} /></Form.Item>
            </div>
            <Form.Item name="keywordPattern" label="关键词模式（可选，如 {{城市}} {{服务}}）"><Input placeholder="留空则用表内关键词列或标题" /></Form.Item>
            <Form.Item name="template" label="页面模板（可选，留空用默认模板；支持 {{列名}} 占位）">
              <Input.TextArea rows={6} placeholder={"<h1>{{城市}} {{服务}}</h1>\n<p>我们在{{城市}}提供{{服务}}……</p>"} />
            </Form.Item>
            <Space>
              <Button loading={busy === "preview"} onClick={doPreview}>预览样本</Button>
              <Button type="primary" loading={busy === "generate"} onClick={doGenerate}>批量生成</Button>
            </Space>
          </Form>
        )}
      </Panel>

      {preview ? (
        <Panel title={`预览（${preview.pages.length} 页样本）`} titleExtra={<span className="text-12 muted">· {preview.mode === "llm" ? "AI 模板" : "规则模板"}</span>}>
          <div style={{ display: "grid", gap: 12 }}>
            {preview.pages.map((p, i) => (
              <div key={i} style={{ border: "1px solid var(--line, #f0f0f0)", borderRadius: 8, padding: 12 }}>
                <div className="text-12 muted">slug: <span className="mono">{p.slug}</span></div>
                <strong>{p.title}</strong>
                <p className="text-12" style={{ margin: "6px 0" }}>{p.metaDescription}</p>
                <details><summary className="text-12 muted">查看正文 HTML</summary><pre className="text-12" style={{ whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{p.body}</pre></details>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="生成任务">
        {runsQuery.isError ? <Notice variant="warn">{runsQuery.error?.message}</Notice> : null}
        <Table
          rowKey="id"
          size="small"
          loading={runsQuery.isPending}
          dataSource={runs}
          pagination={false}
          onRow={(r) => ({ onClick: () => setRunId(r.id), style: { cursor: "pointer", background: r.id === runId ? "var(--fill-2, #fafafa)" : undefined } })}
          columns={[
            { title: "数据源", dataIndex: "tableName", ellipsis: true },
            { title: "行数", dataIndex: "rowCount", width: 80, render: fmtNum },
            { title: "状态", dataIndex: "status", width: 100, render: (s: string) => <Tag color={RUN_COLOR[s]}>{RUN_LABEL[s] ?? s}</Tag> },
            { title: "创建时间", dataIndex: "createdAt", width: 160, render: fmtDateTime },
            { title: "操作", width: 160, render: (_: unknown, r: SeoProgrammaticRun) => (
              <Space onClick={(e) => e.stopPropagation()}>
                <Button size="small" type="link" onClick={() => setRunId(r.id)}>查看页面</Button>
                <Button size="small" type="link" disabled={r.status !== "DONE"} loading={busy === `export${r.id}`} onClick={() => doExport(r.id)}>导出 zip</Button>
              </Space>
            ) },
          ]}
          locale={{ emptyText: <EmptyState text="尚无生成任务：配置数据源后点「批量生成」" /> }}
        />
      </Panel>

      {runId > 0 ? (
        <Panel title={`任务 #${runId} 页面（${pages.length}）`} extra={<Button onClick={() => setRunId(0)}>关闭</Button>}>
          <Table
            rowKey="id"
            size="small"
            loading={pagesQuery.isPending}
            dataSource={pages}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              { title: "slug", dataIndex: "slug", width: 200, ellipsis: true },
              { title: "标题", dataIndex: "title", ellipsis: true },
              { title: "meta 描述", dataIndex: "metaDescription", ellipsis: true },
              { title: "操作", width: 110, render: (_: unknown, p: SeoProgrammaticPage) => (
                <Button size="small" type="link" loading={busy === `asset${p.id}`} onClick={() => saveAsset(p)}>存为资产</Button>
              ) },
            ]}
            locale={{ emptyText: "暂无页面（任务可能仍在生成中）" }}
          />
        </Panel>
      ) : null}
    </div>
  );
}