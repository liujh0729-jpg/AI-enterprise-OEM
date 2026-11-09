"use client";

import { App, Button, Form, Input, InputNumber, Modal, Space, Switch, Table, Tag } from "antd";
import { useState } from "react";
import {
  SEO_FETCH_STATUS_LABELS,
  SEO_SEVERITY_LABELS,
  z,
  seoAuditDetailSchema,
} from "@enterprise/contracts";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import { useSeoAuditDetail, useSeoAudits, useSeoActions, useSeoSettings } from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { auditStatusLabel, fmtNum, type SeoProject } from "./seo-common";

type AuditDetail = z.infer<typeof seoAuditDetailSchema>;

const SEVERITY_COLOR: Record<string, string> = { CRITICAL: "red", WARNING: "orange", INFO: "blue" };
const STATUS_COLOR: Record<string, string> = { DONE: "green", RUNNING: "blue", PENDING: "default", FAILED: "red" };

/** 站点体检：免费自有抓取 + 确定性规则；Lighthouse 与 AI 解读为可选付费层。 */
export function SeoAuditView({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const settingsQuery = useSeoSettings();
  const providerConnected = (settingsQuery.data ?? []).some((r) => r.code === "dataforseo" && r.connected);
  const [page, setPage] = useState(1);
  const listQuery = useSeoAudits(project.id, page);
  const [detailId, setDetailId] = useState(0);
  const detailQuery = useSeoAuditDetail(detailId);
  const [formOpen, setFormOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [form] = Form.useForm();

  const openStart = () => {
    form.setFieldsValue({
      startUrl: `https://${project.domain}/`,
      maxPages: 50,
      includeSubdomains: false,
      runLighthouse: false,
    });
    setFormOpen(true);
  };

  const start = async () => {
    try {
      const values = await form.validateFields();
      setStarting(true);
      const audit = await actions.startAudit.mutateAsync({
        body: {
          projectId: project.id,
          startUrl: values.startUrl,
          maxPages: values.maxPages ?? 50,
          includeSubdomains: Boolean(values.includeSubdomains),
          runLighthouse: Boolean(values.runLighthouse),
        },
      });
      message.success("体检已启动，后台抓取中；稍后刷新查看结果");
      setFormOpen(false);
      if (audit?.id) setDetailId(audit.id);
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setStarting(false);
    }
  };

  const explain = async () => {
    if (!detailId) return;
    setExplaining(true);
    try {
      const r = await actions.explainAudit.mutateAsync({ body: { id: detailId } });
      message.success(r?.mode === "llm" ? "AI 解读已生成" : "已生成规则式解读（无模型 Key 时降级）");
      void detailQuery.refetch();
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setExplaining(false);
    }
  };

  const rows = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detail: AuditDetail | null = detailQuery.data ?? null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel
        title="体检任务"
        extra={<Button type="primary" onClick={openStart}>＋ 新建体检</Button>}
      >
        {listQuery.isError ? <Notice variant="warn">{listQuery.error?.message}</Notice> : null}
        <Table
          rowKey="id"
          size="small"
          loading={listQuery.isPending}
          dataSource={rows}
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
          onRow={(record) => ({ onClick: () => setDetailId(record.id), style: { cursor: "pointer" } })}
          columns={[
            { title: "起始 URL", dataIndex: "startUrl", ellipsis: true },
            { title: "状态", dataIndex: "status", width: 90, render: (s: string) => <Tag color={STATUS_COLOR[s]}>{auditStatusLabel(s)}</Tag> },
            { title: "健康分", dataIndex: "healthScore", width: 80, render: (v: number | null) => (v === null ? "—" : v) },
            { title: "页面", dataIndex: "pageCount", width: 70, render: fmtNum },
            { title: "问题", dataIndex: "issueCount", width: 70, render: fmtNum },
            { title: "严重", dataIndex: "criticalCount", width: 70, render: (v: number) => (v ? <Tag color="red">{v}</Tag> : 0) },
            { title: "创建时间", dataIndex: "createdAt", width: 160, render: fmtDateTime },
          ]}
          locale={{ emptyText: <EmptyState text="尚无体检：点「新建体检」抓取站点并跑确定性规则（免费，无需 Key）" /> }}
        />
      </Panel>

      {detailId > 0 ? (
        <Panel
          title={`体检详情 #${detailId}`}
          extra={
            <Space>
              <Button loading={explaining} onClick={() => void explain()}>AI 解读</Button>
              <Button onClick={() => setDetailId(0)}>关闭详情</Button>
            </Space>
          }
        >
          {detailQuery.isError ? <Notice variant="warn">{detailQuery.error?.message}</Notice> : null}
          {!detail ? (
            <EmptyState text={detailQuery.isPending ? "正在加载详情…" : "体检进行中或暂无详情，稍后刷新"} />
          ) : (
            <AuditDetailBody detail={detail} />
          )}
        </Panel>
      ) : null}

      <Modal
        open={formOpen}
        title="新建站点体检"
        okText="开始体检"
        confirmLoading={starting}
        onCancel={() => setFormOpen(false)}
        onOk={() => void start()}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="startUrl" label="起始 URL *" rules={[{ required: true, type: "url", message: "请填写完整的 http(s) 地址" }]}>
            <Input placeholder={`https://${project.domain}/`} />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="maxPages" label="最多抓取页面（1–200）">
              <InputNumber min={1} max={200} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="includeSubdomains" label="包含子域名" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item name="runLighthouse" label="跑 Lighthouse 性能分（DataForSEO 付费）" valuePropName="checked">
            <Switch disabled={!providerConnected} />
          </Form.Item>
          {!providerConnected ? (
            <Notice variant="warn">Lighthouse 走 DataForSEO（不在服务器装 Chrome）：需先在「数据源设置」配 Key。不勾选则只做免费抓取与规则检查。</Notice>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}

function AuditDetailBody({ detail }: { detail: AuditDetail }) {
  const perf = detail.performance;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Notice variant={perf.available ? "info" : "warn"}>{perf.note}</Notice>
      {perf.lighthouse ? (
        <Panel title="Lighthouse（移动端实测）">
          <Space wrap>
            <Tag>性能 {perf.lighthouse.performance}</Tag>
            <Tag>无障碍 {perf.lighthouse.accessibility}</Tag>
            <Tag>最佳实践 {perf.lighthouse.bestPractices}</Tag>
            <Tag>SEO {perf.lighthouse.seo}</Tag>
            {perf.lighthouse.lcp !== null ? <Tag>LCP {perf.lighthouse.lcp}ms</Tag> : null}
            {perf.lighthouse.cls !== null ? <Tag>CLS {perf.lighthouse.cls}</Tag> : null}
          </Space>
        </Panel>
      ) : null}
      {detail.aiAdvice ? (
        <Panel title="AI 解读">
          <div className="text-12" style={{ whiteSpace: "pre-wrap" }}>{detail.aiAdvice}</div>
        </Panel>
      ) : null}
      <Panel title={`问题清单（${detail.issues.length}）`}>
        <Table
          rowKey="id"
          size="small"
          dataSource={detail.issues}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: "级别", dataIndex: "severity", width: 80, render: (s: string) => <Tag color={SEVERITY_COLOR[s]}>{SEO_SEVERITY_LABELS[s] ?? s}</Tag> },
            { title: "类型", dataIndex: "typeLabel", width: 160, ellipsis: true },
            { title: "URL", dataIndex: "url", ellipsis: true },
            { title: "说明", dataIndex: "detail", ellipsis: true },
            { title: "修复建议", dataIndex: "fixHint", ellipsis: true },
          ]}
          locale={{ emptyText: "未发现问题" }}
        />
      </Panel>
      <Panel title={`抓取页面（${detail.pages.length}）`}>
        <Table
          rowKey="id"
          size="small"
          dataSource={detail.pages}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 900 }}
          columns={[
            { title: "URL", dataIndex: "url", ellipsis: true, width: 260 },
            { title: "抓取", dataIndex: "fetchStatus", width: 90, render: (s: string) => SEO_FETCH_STATUS_LABELS[s] ?? s },
            { title: "标题", dataIndex: "title", ellipsis: true },
            { title: "字数", dataIndex: "wordCount", width: 70 },
            { title: "缺 Alt 图", dataIndex: "imagesMissingAlt", width: 90 },
            { title: "内链", dataIndex: "internalLinks", width: 70 },
            { title: "JSON-LD", dataIndex: "hasJsonLd", width: 90, render: (v: boolean) => (v ? <Tag color="green">有</Tag> : <Tag>无</Tag>) },
            { title: "在 sitemap", dataIndex: "inSitemap", width: 100, render: (v: boolean) => (v ? "是" : "否") },
          ]}
        />
      </Panel>
    </div>
  );
}