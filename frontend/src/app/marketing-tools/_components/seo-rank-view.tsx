"use client";

import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { useState } from "react";
import { SEO_DEVICES, SEO_FREQUENCIES } from "@enterprise/contracts";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  useSeoActions,
  useSeoRankEstimate,
  useSeoRankHistory,
  useSeoRankKeywords,
  useSeoSettings,
  useSeoTrackers,
} from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import {
  CostHint,
  NoSourceNotice,
  deviceLabel,
  fmtNum,
  fmtPos,
  frequencyLabel,
  splitLines,
  type SeoProject,
  type SeoRankTracker,
} from "./seo-common";

/** 排名跟踪：DataForSEO SERP 实测；成本只预估不阻断；调度器在 GEO worker 凌晨窗口自动跑。 */
export function SeoRankView({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const { request, modal } = usePasswordConfirm();
  const settingsQuery = useSeoSettings();
  const providerConnected = (settingsQuery.data ?? []).some((r) => r.code === "dataforseo" && r.connected);
  const query = useSeoTrackers(project.id);
  const trackers = query.data ?? [];
  const [selected, setSelected] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SeoRankTracker | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ domain: project.domain, locationCode: project.locationCode, languageCode: project.languageCode, device: "MOBILE", depth: 20, frequency: "WEEKLY", reads: 1, enabled: true });
    setFormOpen(true);
  };
  const openEdit = (t: SeoRankTracker) => {
    setEditing(t);
    form.setFieldsValue({ domain: t.domain, locationCode: t.locationCode, languageCode: t.languageCode, device: t.device, depth: t.depth, frequency: t.frequency, reads: t.reads, enabled: t.enabled });
    setFormOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const body = {
        projectId: project.id,
        domain: values.domain,
        locationCode: values.locationCode ?? 2840,
        languageCode: values.languageCode ?? "en",
        device: values.device ?? "MOBILE",
        depth: values.depth ?? 20,
        frequency: values.frequency ?? "WEEKLY",
        reads: values.reads ?? 1,
        enabled: Boolean(values.enabled),
        ...(editing ? { id: editing.id } : {}),
      };
      if (editing) {
        const target = editing;
        setFormOpen(false);
        request({
          title: "修改排名跟踪器（需密码）",
          content: `确认修改跟踪器「${target.domain}」？`,
          okText: "保存修改",
          onOk: async () => { await actions.updateTracker.mutateAsync({ body }); message.success("已保存修改"); },
        });
      } else {
        const t = await actions.createTracker.mutateAsync({ body });
        message.success("跟踪器已创建，下一步添加关键词");
        setFormOpen(false);
        if (t?.id) setSelected(t.id);
      }
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setSaving(false);
    }
  };

  const remove = (t: SeoRankTracker) => {
    request({
      title: "删除排名跟踪器",
      danger: true,
      okText: "确认删除",
      content: `确认删除跟踪器「${t.domain}」？其关键词与历史快照一并删除，不可恢复。`,
      onOk: async () => {
        await actions.removeTracker.mutateAsync({ body: { id: t.id } });
        message.success("已删除");
        if (selected === t.id) setSelected(0);
      },
    });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {!providerConnected ? <NoSourceNotice>排名跟踪需要 DataForSEO Key（你自带、你付费）。请在右上角「数据源设置」配置后再跑检查；未配置时不造假排名。</NoSourceNotice> : null}
      <Panel title="排名跟踪器" extra={<Button type="primary" onClick={openCreate}>＋ 新建跟踪器</Button>}>
        {query.isError ? <Notice variant="warn">{query.error?.message}</Notice> : null}
        <Table
          rowKey="id"
          size="small"
          loading={query.isPending}
          dataSource={trackers}
          pagination={false}
          onRow={(r) => ({ onClick: () => setSelected(r.id), style: { cursor: "pointer", background: r.id === selected ? "var(--fill-2, #fafafa)" : undefined } })}
          columns={[
            { title: "域名", dataIndex: "domain", ellipsis: true },
            { title: "设备", dataIndex: "device", width: 80, render: deviceLabel },
            { title: "深度", dataIndex: "depth", width: 70 },
            { title: "频率", dataIndex: "frequency", width: 80, render: frequencyLabel },
            { title: "关键词", dataIndex: "keywordCount", width: 80, render: fmtNum },
            { title: "最新排名", dataIndex: "lastPosition", width: 90, render: fmtPos },
            { title: "下次运行", dataIndex: "nextRunAt", width: 160, render: (v: string | null) => (v ? fmtDateTime(v) : "—") },
            { title: "启用", dataIndex: "enabled", width: 70, render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>) },
            { title: "操作", width: 130, render: (_: unknown, t: SeoRankTracker) => (
              <Space onClick={(e) => e.stopPropagation()}>
                <Button size="small" type="link" onClick={() => openEdit(t)}>编辑</Button>
                <Button size="small" type="link" danger onClick={() => remove(t)}>删除</Button>
              </Space>
            ) },
          ]}
          locale={{ emptyText: <EmptyState text="尚无跟踪器：新建后添加关键词，即可手动或按频率自动跟踪排名" /> }}
        />
      </Panel>

      {selected > 0 ? <TrackerDetail trackerId={selected} providerConnected={providerConnected} /> : null}

      <Modal open={formOpen} title={editing ? "修改排名跟踪器（需密码）" : "新建排名跟踪器"} width={620} okText={editing ? "保存修改" : "创建"} confirmLoading={saving} onCancel={() => setFormOpen(false)} onOk={() => void save()}>
        <Form form={form} layout="vertical">
          <Form.Item name="domain" label="跟踪域名 *" rules={[{ required: true, message: "请填写域名" }]}>
            <Input placeholder="example.com" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="locationCode" label="地区码"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="languageCode" label="语言码"><Input placeholder="en" /></Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="device" label="设备"><Select options={SEO_DEVICES.map((d) => ({ value: d, label: deviceLabel(d) }))} /></Form.Item>
            <Form.Item name="frequency" label="自动频率"><Select options={SEO_FREQUENCIES.map((f) => ({ value: f, label: frequencyLabel(f) }))} /></Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="depth" label="SERP 深度（10–100）"><InputNumber min={10} max={100} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="reads" label="读取次数（1–3，取中位）"><InputNumber min={1} max={3} style={{ width: "100%" }} /></Form.Item>
          </div>
          <Form.Item name="enabled" label="启用自动跟踪" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
      {modal}
    </div>
  );
}

function TrackerDetail({ trackerId, providerConnected }: { trackerId: number; providerConnected: boolean }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const keywordsQuery = useSeoRankKeywords(trackerId);
  const estimateQuery = useSeoRankEstimate(trackerId);
  const historyQuery = useSeoRankHistory(trackerId);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState("");
  const keywords = keywordsQuery.data ?? [];
  const estimate = estimateQuery.data;
  const history = historyQuery.data;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (error) { if (error instanceof Error) presentMutationError(error, (t) => message.error(t)); } finally { setBusy(""); }
  };

  const addKeywords = () => {
    const list = splitLines(raw);
    if (list.length === 0) { message.warning("请至少填一个关键词"); return; }
    void run("add", async () => {
      const r = await actions.addRankKeywords.mutateAsync({ body: { trackerId, keywords: list } });
      message.success(`已添加 ${r?.added ?? list.length} 个关键词`);
      setRaw("");
    });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel
        title={`跟踪器 #${trackerId} · 关键词（${keywords.length}）`}
        extra={
          <Space>
            <Button loading={busy === "run"} disabled={!providerConnected || keywords.length === 0} onClick={() => void run("run", async () => {
              const r = await actions.runRankCheck.mutateAsync({ body: { trackerId } });
              message.success(r?.status === "FAILED" ? `检查失败：${r.errorCode}` : "排名检查已完成");
            })}>立即检查</Button>
            <Button onClick={() => { void keywordsQuery.refetch(); void historyQuery.refetch(); void estimateQuery.refetch(); }}>刷新</Button>
          </Space>
        }
      >
        {estimate ? <CostHint calls={estimate.calls} estimatedUsd={estimate.estimatedUsd} note={estimate.note} /> : null}
        <Space.Compact style={{ width: "100%", marginTop: 12 }}>
          <Input.TextArea rows={2} placeholder="批量添加关键词（每行一个，或逗号分隔）" value={raw} onChange={(e) => setRaw(e.target.value)} />
          <Button type="primary" loading={busy === "add"} onClick={addKeywords}>添加</Button>
        </Space.Compact>
        <Table
          rowKey="id"
          size="small"
          style={{ marginTop: 12 }}
          dataSource={keywords}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: "关键词", dataIndex: "keyword", ellipsis: true },
            { title: "最新排名", dataIndex: "lastPosition", width: 100, render: fmtPos },
            { title: "置顶", dataIndex: "pinned", width: 70, render: (v: boolean) => (v ? <Tag>置顶</Tag> : null) },
            { title: "操作", width: 70, render: (_: unknown, r: { id: number }) => <Button danger size="small" type="link" loading={busy === `rm${r.id}`} onClick={() => void run(`rm${r.id}`, async () => { await actions.removeRankKeyword.mutateAsync({ body: { id: r.id } }); message.success("已删除"); })}>删除</Button> },
          ]}
          locale={{ emptyText: "尚未添加关键词" }}
        />
      </Panel>

      <Panel title="排名历史">
        {!history ? (
          <EmptyState text={historyQuery.isPending ? "正在加载历史…" : "暂无历史：跑一次检查后显示快照与趋势"} />
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={history.runs}
              pagination={{ pageSize: 5, showSizeChanger: false }}
              columns={[
                { title: "状态", dataIndex: "status", width: 90, render: (s: string) => <Tag color={s === "DONE" ? "green" : s === "FAILED" ? "red" : "blue"}>{s}</Tag> },
                { title: "触发", dataIndex: "trigger", width: 100 },
                { title: "预估成本", dataIndex: "costEstimate", width: 100, render: (v: number) => `$${v.toFixed(4)}` },
                { title: "开始", dataIndex: "startedAt", width: 160, render: fmtDateTime },
                { title: "错误", dataIndex: "errorCode", ellipsis: true },
              ]}
              locale={{ emptyText: "暂无运行记录" }}
            />
            <Table
              rowKey={(r) => `${r.keyword}|${r.checkedAt}`}
              size="small"
              dataSource={history.snapshots}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                { title: "关键词", dataIndex: "keyword", ellipsis: true },
                { title: "设备", dataIndex: "device", width: 80, render: deviceLabel },
                { title: "排名", dataIndex: "position", width: 90, render: fmtPos },
                { title: "URL", dataIndex: "url", ellipsis: true },
                { title: "检查时间", dataIndex: "checkedAt", width: 160, render: fmtDateTime },
              ]}
              locale={{ emptyText: "暂无快照" }}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}