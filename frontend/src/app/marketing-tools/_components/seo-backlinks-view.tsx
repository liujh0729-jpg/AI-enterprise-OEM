"use client";

import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { SEO_PROSPECT_STATUSES } from "@enterprise/contracts";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel, PillTabs, StatCard, StatGrid } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  useSeoActions,
  useSeoBacklinksHistory,
  useSeoBacklinksOverview,
  useSeoBacklinksProfile,
  useSeoProspects,
  useSeoSettings,
} from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { NoSourceNotice, fmtNum, prospectStatusLabel, type SeoProject, type SeoProspect } from "./seo-common";
import { aliyunMailApi, type AliyunMailReceiver } from "./aliyun-mail-common";

/** 外链：分析（DataForSEO 实测）+ 建设（潜客发现 → 提取联系方式 → 外联草稿，绝不自动群发）。 */
export function SeoBacklinksView({ project }: { project: SeoProject }) {
  const [tab, setTab] = useState("analysis");
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PillTabs items={[{ key: "analysis", label: "外链分析" }, { key: "building", label: "外链建设" }]} value={tab} onChange={setTab} variant="soft" />
      {tab === "analysis" ? <BacklinksAnalysis project={project} /> : <BacklinksBuilding project={project} />}
    </div>
  );
}

function BacklinksAnalysis({ project }: { project: SeoProject }) {
  const settingsQuery = useSeoSettings();
  const providerConnected = (settingsQuery.data ?? []).some((r) => r.code === "dataforseo" && r.connected);
  const domain = project.domain;
  const overviewQuery = useSeoBacklinksOverview(project.id, domain);
  const [page, setPage] = useState(1);
  const profileQuery = useSeoBacklinksProfile(project.id, domain, page);
  const historyQuery = useSeoBacklinksHistory(project.id);
  const overview = overviewQuery.data;
  const profile = profileQuery.data;
  const history = historyQuery.data ?? [];

  if (!providerConnected) return <NoSourceNotice>外链分析需要 DataForSEO Key（你自带、你付费）。未配置时不造假外链数据。</NoSourceNotice>;
  if (overviewQuery.isError) return <Notice variant="warn">{overviewQuery.error?.message}</Notice>;
  if (!overview) return <EmptyState text={overviewQuery.isPending ? "正在查询外链…" : "暂无数据"} />;
  if (!overview.available) return <NoSourceNotice />;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <StatGrid>
        <StatCard label="外链总数" value={fmtNum(overview.totalBacklinks)} />
        <StatCard label="引用域" value={fmtNum(overview.referringDomains)} />
        <StatCard label="follow" value={fmtNum(overview.followLinks)} />
        <StatCard label="nofollow" value={fmtNum(overview.nofollowLinks)} />
      </StatGrid>
      {overview.queriedAt ? <p className="text-12 muted">查询时间：{fmtDateTime(overview.queriedAt)}</p> : null}
      <Panel title={`锚文本分布（${overview.anchors.length}）`}>
        <Table rowKey="text" size="small" dataSource={overview.anchors} pagination={{ pageSize: 10, showSizeChanger: false }} columns={[{ title: "锚文本", dataIndex: "text", ellipsis: true }, { title: "次数", dataIndex: "count", width: 90 }]} locale={{ emptyText: "无数据" }} />
      </Panel>
      <Panel title="外链明细">
        <Table
          rowKey={(r) => `${r.urlFrom}|${r.urlTo}`}
          size="small"
          loading={profileQuery.isPending}
          dataSource={profile?.list ?? []}
          pagination={{ current: page, pageSize: 20, total: profile?.total ?? 0, onChange: setPage, showSizeChanger: false }}
          scroll={{ x: 900 }}
          columns={[
            { title: "来源页", dataIndex: "urlFrom", ellipsis: true, width: 260 },
            { title: "来源域", dataIndex: "domainFrom", width: 160, ellipsis: true },
            { title: "目标页", dataIndex: "urlTo", ellipsis: true, width: 240 },
            { title: "锚文本", dataIndex: "anchor", ellipsis: true },
            { title: "follow", dataIndex: "isFollow", width: 80, render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>) },
            { title: "首见", dataIndex: "firstSeen", width: 120, render: fmtDateTime },
          ]}
          locale={{ emptyText: "无外链明细" }}
        />
      </Panel>
      <Panel title="外链历史快照">
        <Table rowKey="id" size="small" dataSource={history} pagination={false} columns={[{ title: "外链总数", dataIndex: "totalBacklinks", width: 120 }, { title: "引用域", dataIndex: "referringDomains", width: 120 }, { title: "查询时间", dataIndex: "queriedAt", render: fmtDateTime }]} locale={{ emptyText: "暂无历史快照" }} />
      </Panel>
    </div>
  );
}

function BacklinksBuilding({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const { request, modal } = usePasswordConfirm();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const listQuery = useSeoProspects(project.id, status, page);
  const rows = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [discoverForm] = Form.useForm();
  const [addForm] = Form.useForm();
  const [draft, setDraft] = useState<{ prospect: SeoProspect; text: string; mode: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailReady, setMailReady] = useState<{ configured: boolean; lists: AliyunMailReceiver[]; error: string } | null>(null);
  const [receiverId, setReceiverId] = useState("");

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (error) { if (error instanceof Error) presentMutationError(error, (t) => message.error(t)); } finally { setBusy(""); }
  };

  const discover = async () => {
    try {
      const values = await discoverForm.validateFields();
      setBusy("discover");
      const r = await actions.discoverProspects.mutateAsync({
        body: { projectId: project.id, query: values.query, locationCode: values.locationCode ?? project.locationCode, languageCode: values.languageCode ?? project.languageCode, limit: values.limit ?? 20 },
      });
      message.success(r?.mode === "dataforseo" ? `已发现 ${r.prospects.length} 个潜客` : "无 DataForSEO Key：已切手动模式，请用「手动添加」录入潜客");
      setDiscoverOpen(false);
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally { setBusy(""); }
  };

  const add = async () => {
    try {
      const values = await addForm.validateFields();
      await actions.addProspect.mutateAsync({ body: { projectId: project.id, domain: values.domain, url: values.url ?? "", sourceQuery: values.sourceQuery ?? "", note: values.note ?? "" } });
      message.success("已添加潜客");
      setAddOpen(false);
      addForm.resetFields();
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    }
  };

  const remove = (p: SeoProspect) => {
    request({ title: "删除潜客", danger: true, okText: "确认删除", content: `确认删除潜客「${p.domain}」？`, onOk: async () => { await actions.removeProspect.mutateAsync({ body: { id: p.id } }); message.success("已删除"); } });
  };

  const changeStatus = (p: SeoProspect, next: string) => {
    void run(`st${p.id}`, async () => { await actions.updateProspect.mutateAsync({ body: { id: p.id, status: next as SeoProspect["status"] } }); message.success("状态已更新"); });
  };

  const openMail = async () => {
    if (!selectedIds.length) return;
    setMailOpen(true);
    setMailReady(null);
    setReceiverId("");
    const settings = await aliyunMailApi.settings();
    if (!settings.data?.configured) {
      setMailReady({ configured: false, lists: [], error: settings.message || "尚未配置阿里云邮件推送" });
      return;
    }
    const lists = await aliyunMailApi.receiverLists("");
    setMailReady({ configured: true, lists: lists.data ?? [], error: lists.message });
  };

  const pushMail = async () => {
    setMailBusy(true);
    try {
      const r = await actions.pushProspectsToMail.mutateAsync({
        body: { projectId: project.id, ids: selectedIds, receiverId },
      });
      message.success(
        `已写入多维表格「${r?.tableName}」并创建同步批次 #${r?.importId}（${r?.total ?? 0} 个邮箱；实际发送在阿里云控制台，本系统不群发）`,
      );
      setMailOpen(false);
      setSelectedIds([]);
      setReceiverId("");
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setMailBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Notice variant="info">外链建设只生成草稿，绝不自动群发；联系方式靠抓取真实页面提取，绝不编造邮箱。发送由你人工完成，发完手动把状态改为「已发送」。</Notice>
      <Panel
        title="链接潜客"
        extra={
          <Space>
            <Button onClick={() => void openMail()} disabled={selectedIds.length === 0}>
              转邮件推送{selectedIds.length ? `（${selectedIds.length}）` : ""}
            </Button>
            {SEO_PROSPECT_STATUSES.length > 1 ? (
              <Select style={{ minWidth: 140 }} value={status || undefined} placeholder="全部状态" allowClear onChange={(v) => { setStatus(v ?? ""); setPage(1); setSelectedIds([]); }} options={SEO_PROSPECT_STATUSES.map((s) => ({ value: s, label: prospectStatusLabel(s) }))} />
            ) : null}
            <Button onClick={() => { addForm.resetFields(); setAddOpen(true); }}>手动添加</Button>
            <Button type="primary" onClick={() => { discoverForm.setFieldsValue({ locationCode: project.locationCode, languageCode: project.languageCode, limit: 20 }); setDiscoverOpen(true); }}>发现潜客</Button>
          </Space>
        }
      >
        {listQuery.isError ? <Notice variant="warn">{listQuery.error?.message}</Notice> : null}
        <Table
          rowKey="id"
          size="small"
          loading={listQuery.isPending}
          dataSource={rows}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as number[]) }}
          pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); setSelectedIds([]); }, showSizeChanger: false }}
          scroll={{ x: 1000 }}
          columns={[
            { title: "域名", dataIndex: "domain", width: 160, ellipsis: true },
            { title: "来源查询", dataIndex: "sourceQuery", width: 140, ellipsis: true },
            { title: "联系邮箱", dataIndex: "contactEmail", width: 180, ellipsis: true, render: (v: string) => v || <span className="muted">未提取</span> },
            { title: "状态", dataIndex: "status", width: 130, render: (s: string, p: SeoProspect) => (
              <Select size="small" style={{ width: 116 }} value={s} loading={busy === `st${p.id}`} onChange={(v) => changeStatus(p, v)} options={SEO_PROSPECT_STATUSES.map((x) => ({ value: x, label: prospectStatusLabel(x) }))} />
            ) },
            { title: "操作", width: 230, render: (_: unknown, p: SeoProspect) => (
              <Space wrap>
                <Button size="small" type="link" loading={busy === `ct${p.id}`} onClick={() => void run(`ct${p.id}`, async () => { const r = await actions.extractContact.mutateAsync({ body: { id: p.id } }); message.success(r?.contactEmail ? `已提取：${r.contactEmail}` : "页面未找到公开联系方式（不编造）"); })}>提取联系方式</Button>
                <Button size="small" type="link" loading={busy === `dr${p.id}`} onClick={() => void run(`dr${p.id}`, async () => { const r = await actions.draftOutreach.mutateAsync({ body: { id: p.id } }); if (r) setDraft({ prospect: p, text: r.draft, mode: r.mode }); })}>外联草稿</Button>
                <Button size="small" type="link" danger onClick={() => remove(p)}>删除</Button>
              </Space>
            ) },
          ]}
          locale={{ emptyText: <EmptyState text="尚无潜客：点「发现潜客」用 DataForSEO 搜索，或「手动添加」录入目标站" /> }}
        />
      </Panel>

      <Modal open={discoverOpen} title="发现链接潜客" okText="开始发现" confirmLoading={busy === "discover"} onCancel={() => setDiscoverOpen(false)} onOk={() => void discover()}>
        <Form form={discoverForm} layout="vertical">
          <Form.Item name="query" label="搜索查询 *" rules={[{ required: true, message: "请填写查询，如：best running shoes blog" }]}><Input placeholder="用于找相关站点/博主的查询" /></Form.Item>
          <div className="form-2col">
            <Form.Item name="locationCode" label="地区码"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="languageCode" label="语言码"><Input /></Form.Item>
          </div>
          <Form.Item name="limit" label="数量（1–50）"><InputNumber min={1} max={50} style={{ width: "100%" }} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={addOpen} title="手动添加潜客" okText="添加" onCancel={() => setAddOpen(false)} onOk={() => void add()}>
        <Form form={addForm} layout="vertical">
          <Form.Item name="domain" label="目标域名 *" rules={[{ required: true, message: "请填写域名" }]}><Input placeholder="example.com" /></Form.Item>
          <Form.Item name="url" label="目标页面 URL"><Input placeholder="https://example.com/page" /></Form.Item>
          <Form.Item name="sourceQuery" label="来源查询"><Input /></Form.Item>
          <Form.Item name="note" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={Boolean(draft)} title={`外联草稿 · ${draft?.prospect.domain ?? ""}`} width={680} footer={<Button onClick={() => setDraft(null)}>关闭</Button>} onCancel={() => setDraft(null)}>
        {draft ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Notice variant="warn">草稿仅供参考，请人工核对收件人与内容后自行发送；本系统不会自动发送。{draft.mode !== "llm" ? "（无模型 Key，规则式草稿）" : ""}</Notice>
            <Input.TextArea rows={12} value={draft.text} readOnly />
            <Button onClick={() => { void navigator.clipboard.writeText(draft.text).then(() => message.success("已复制草稿")); }}>复制草稿</Button>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={mailOpen}
        title="转阿里云邮件推送"
        okText="同步收件人"
        confirmLoading={mailBusy}
        okButtonProps={{ disabled: !mailReady?.configured }}
        onOk={() => void pushMail()}
        onCancel={() => setMailOpen(false)}
      >
        {!mailReady ? (
          <div className="muted">正在检查阿里云邮件推送配置…</div>
        ) : !mailReady.configured ? (
          <Notice variant="warn">
            尚未配置阿里云邮件推送（AccessKey）：请先到「阿里云邮件推送」页签完成配置，再回来推送潜客邮箱。
            {mailReady.error ? `（${mailReady.error}）` : ""}
          </Notice>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <Notice variant="info">
              只把潜客邮箱写入多维表格并同步到阿里云收件人列表；邮件模板与发送仍在阿里云控制台完成，本系统不群发、也不自动改潜客状态。未提取到邮箱的潜客会被跳过。
            </Notice>
            <Select
              style={{ width: "100%" }}
              value={receiverId}
              onChange={setReceiverId}
              options={[
                { value: "", label: `新建收件人列表（${project.domain} 外链线索）` },
                ...mailReady.lists.map((list) => ({
                  value: list.receiverId,
                  label: `追加到：${list.receiverName}（${list.count} 人）`,
                })),
              ]}
            />
            <div className="text-12 muted">
              已选 {selectedIds.length} 个潜客；同步批次在「阿里云邮件推送 → 同步记录」可查。
              {mailReady.error ? `（列表加载提示：${mailReady.error}）` : ""}
            </div>
          </div>
        )}
      </Modal>
      {modal}
    </div>
  );
}