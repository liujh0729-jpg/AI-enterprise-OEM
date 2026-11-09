"use client";

import { App, Button, Input, Modal, Space, Table, Tag } from "antd";
import { useState } from "react";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import { downloadText } from "@/lib/download";
import { markdownToHtmlDocument } from "@/lib/markdown-html";
import { useSeoActions, useSeoReports } from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { type SeoProject, type SeoReport } from "./seo-common";

const fullShareUrl = (path: string) => (path ? `${window.location.origin}${path.startsWith("/") ? "" : "/"}${path}` : "");
const fileBase = (title: string) => title.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 80) || "seo-report";

/** SEO 报告：聚合体检/关键词/排名/GSC 生成 Markdown 报告；分享前后端脱敏（去凭据/邮箱/非公开机会词）。 */
export function SeoReportsView({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const query = useSeoReports(project.id);
  const reports = query.data ?? [];
  const [periodLabel, setPeriodLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [viewing, setViewing] = useState<SeoReport | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (error) { if (error instanceof Error) presentMutationError(error, (t) => message.error(t)); } finally { setBusy(""); }
  };

  const generate = () => void run("gen", async () => {
    const r = await actions.generateReport.mutateAsync({ body: { projectId: project.id, periodLabel } });
    message.success("报告已生成（草稿）");
    if (r) setViewing(r);
    setPeriodLabel("");
  });

  const share = (report: SeoReport) => void run(`share${report.id}`, async () => {
    const r = await actions.shareReport.mutateAsync({ body: { id: report.id } });
    const url = fullShareUrl(r?.shareUrl ?? "");
    Modal.success({
      title: "分享链接已生成（已脱敏）",
      content: (
        <div style={{ display: "grid", gap: 8 }}>
          <Notice variant="info">分享前已自动脱敏：移除凭据、原始邮箱、非公开机会词与竞品内部数据，只保留聚合口径。</Notice>
          <Input readOnly value={url} />
          <Button onClick={() => { void navigator.clipboard.writeText(url).then(() => message.success("已复制分享链接")); }}>复制链接</Button>
        </div>
      ),
    });
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="生成报告" extra={<Space><Input placeholder="周期标签（如 2026-10）" style={{ width: 180 }} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} /><Button type="primary" loading={busy === "gen"} onClick={generate}>生成报告</Button></Space>}>
        <Notice variant="info">报告聚合本站体检健康分、关键词与聚类、排名趋势、GSC 触手可及词等，由系统 LLM 撰写四段式 Markdown（计积分）；无模型 Key 时规则式产出并标注「AI 估计」。同名草稿会被新报告替换。</Notice>
      </Panel>

      <Panel title="报告列表">
        {query.isError ? <Notice variant="warn">{query.error?.message}</Notice> : null}
        <Table
          rowKey="id"
          size="small"
          loading={query.isPending}
          dataSource={reports}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: "标题", dataIndex: "title", ellipsis: true },
            { title: "状态", dataIndex: "status", width: 100, render: (s: string) => <Tag color={s === "READY" ? "green" : "default"}>{s === "READY" ? "已分享" : "草稿"}</Tag> },
            { title: "创建时间", dataIndex: "createdAt", width: 160, render: fmtDateTime },
            { title: "操作", width: 200, render: (_: unknown, r: SeoReport) => (
              <Space>
                <Button size="small" type="link" onClick={() => setViewing(r)}>查看</Button>
                <Button size="small" type="link" loading={busy === `share${r.id}`} onClick={() => share(r)}>{r.shareUrl ? "重新分享" : "分享"}</Button>
                {r.shareUrl ? <Button size="small" type="link" onClick={() => window.open(fullShareUrl(r.shareUrl), "_blank", "noopener,noreferrer")}>打开</Button> : null}
              </Space>
            ) },
          ]}
          locale={{ emptyText: <EmptyState text="尚无报告：点「生成报告」聚合当前 SEO 数据撰写交付报告" /> }}
        />
      </Panel>

      <Modal
        open={Boolean(viewing)}
        title={viewing?.title ?? "报告"}
        width={760}
        footer={
          <Space>
            <Button onClick={() => { if (viewing) void navigator.clipboard.writeText(viewing.body).then(() => message.success("已复制 Markdown")); }}>复制 Markdown</Button>
            <Button disabled={!viewing} onClick={() => { if (viewing) { downloadText(`${fileBase(viewing.title)}.md`, viewing.body, "text/markdown;charset=utf-8"); message.success("已导出 Markdown"); } }}>导出 Markdown</Button>
            <Button disabled={!viewing} onClick={() => { if (viewing) { downloadText(`${fileBase(viewing.title)}.html`, markdownToHtmlDocument(viewing.title, viewing.body), "text/html;charset=utf-8"); message.success("已导出自包含 HTML（样式内联，可直接发送或打印为 PDF）"); } }}>导出 HTML</Button>
            <Button onClick={() => setViewing(null)}>关闭</Button>
          </Space>
        }
        onCancel={() => setViewing(null)}
      >
        {viewing ? <div className="text-12" style={{ whiteSpace: "pre-wrap", maxHeight: "60vh", overflow: "auto", fontFamily: "monospace" }}>{viewing.body}</div> : null}
      </Modal>
    </div>
  );
}