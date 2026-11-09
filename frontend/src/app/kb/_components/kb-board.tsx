"use client";

import { App, Button, Drawer, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  kbApi,
  type KbIngestJob,
  type KbPageDetail,
  type KbPageRow,
  type KbSource,
  type KbSpace,
} from "@/api/kb";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import {
  KB_PAGE_TYPE_LABELS,
  KB_SCOPE_LABELS,
  KB_SOURCE_KIND_LABELS,
  KB_VISIBILITY_LABELS,
  jobStatusTag,
  pageStatusTag,
  sourceStatusTag,
  timeText,
} from "./kb-ui";
import { ConsumersPane, GraphPane, QaPane, TimelinePane } from "./kb-panels";
import { MemoryPane } from "./memory-pane";

export type KbTab =
  | "spaces"
  | "sources"
  | "pages"
  | "qa"
  | "graph"
  | "consumers"
  | "memory"
  | "timeline";

const PAGE_SIZE = 20;
const KB_PAGE_STATUS_FILTER: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审",
  PUBLISHED: "已发布",
};
const selectOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/**
 * 知识库主板：持有「当前空间」上下文（会话绑定），除空间管理外所有分区都围着它转。
 * 空间选不到就不发请求——后端读闸对不可见空间一律 404，这里保持同样的收口口径。
 */
export function KbBoard({ tab }: { tab: KbTab }) {
  const { message } = App.useApp();
  const [spaces, setSpaces] = useState<KbSpace[]>([]);
  const [spaceId, setSpaceId] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, current] = await Promise.all([
        kbApi.listSpaces(),
        kbApi.currentSpace().catch(() => null),
      ]);
      const rows = list || [];
      setSpaces(rows);
      const next = current?.id || rows[0]?.id || 0;
      setSpaceId((prev) => (rows.some((s) => s.id === prev) ? prev : next));
      setError("");
    } catch (caught) {
      setSpaces([]);
      setError((caught as Error).message || "知识空间读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectSpace = async (id: number) => {
    setSpaceId(id);
    try {
      await kbApi.selectSpace({ body: { spaceId: id } });
    } catch {
      // 绑定失败不阻塞浏览：仅影响 Agent 侧的默认上下文
      message.warning("会话绑定失败，页面内操作不受影响");
    }
  };

  if (tab === "spaces") {
    return <SpacesPane spaces={spaces} loading={loading} error={error} onChanged={() => void reload()} onEnter={(id) => void selectSpace(id)} />;
  }

  const active = spaces.find((s) => s.id === spaceId) || null;
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel title="当前知识空间" titleExtra={active ? `${active.name} · ${KB_SCOPE_LABELS[active.scopeType] || active.scopeType} · ${KB_VISIBILITY_LABELS[active.visibility] || active.visibility} · 页 ${active.pageCount} / 源 ${active.sourceCount}` : "请选择一个可见的空间"}>
        {spaces.length ? (
          <Select
            style={{ width: 320 }}
            value={spaceId || undefined}
            placeholder="切换知识空间"
            onChange={(v) => void selectSpace(v)}
            options={spaces.map((s) => ({ value: s.id, label: `${s.name}（${KB_SCOPE_LABELS[s.scopeType] || s.scopeType}）` }))}
          />
        ) : (
          <Notice variant="warn">
            还没有可用的知识空间：先到「空间」页签创建一个（个人空间人人可建）。
          </Notice>
        )}
      </Panel>
      {error ? <Notice variant="warn">{error}</Notice> : null}
      {loading ? <Panel title="加载中">…</Panel> : null}
      {!loading && spaceId > 0 ? (
        <>
          {tab === "sources" ? <SourcesPane key={spaceId} spaceId={spaceId} /> : null}
          {tab === "pages" ? <PagesPane key={spaceId} spaceId={spaceId} /> : null}
          {tab === "qa" ? <QaPane key={spaceId} spaceId={spaceId} /> : null}
          {tab === "graph" ? <GraphPane key={spaceId} spaceId={spaceId} /> : null}
          {tab === "consumers" ? <ConsumersPane key={spaceId} spaceId={spaceId} /> : null}
          {tab === "memory" ? <MemoryPane key={spaceId} spaceId={spaceId} /> : null}
          {tab === "timeline" ? <TimelinePane key={spaceId} spaceId={spaceId} /> : null}
        </>
      ) : null}
    </Space>
  );
}

// ---------- 空间管理 ----------
function SpacesPane({
  spaces,
  loading,
  error,
  onChanged,
  onEnter,
}: {
  spaces: KbSpace[];
  loading: boolean;
  error: string;
  onChanged: () => void;
  onEnter: (id: number) => void;
}) {
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    scopeType: "PERSONAL",
    visibility: "PRIVATE",
  });
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!draft.name.trim()) {
      message.warning("请填写空间名称");
      return;
    }
    setSaving(true);
    try {
      const orgScope = draft.scopeType === "ENTERPRISE" || draft.scopeType === "PROVIDER";
      await kbApi.createSpace({
        body: {
          name: draft.name.trim(),
          description: draft.description,
          scopeType: draft.scopeType as KbSpace["scopeType"],
          ...(orgScope ? { orgType: draft.scopeType as "ENTERPRISE" | "PROVIDER" } : {}),
          orgUserId: "",
          visibility: draft.visibility as KbSpace["visibility"],
        },
      });
      message.success("空间已创建");
      setCreateOpen(false);
      setDraft({ name: "", description: "", scopeType: "PERSONAL", visibility: "PRIVATE" });
      onChanged();
    } catch (caught) {
      message.error((caught as Error).message || "创建失败（组织空间要求组织主账号）");
    } finally {
      setSaving(false);
    }
  };

  const archive = async (row: KbSpace) => {
    try {
      await kbApi.updateSpace({
        body: { id: row.id, status: row.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" },
      });
      message.success(row.status === "ARCHIVED" ? "已恢复" : "已归档");
      onChanged();
    } catch (caught) {
      message.error((caught as Error).message || "操作失败（仅 owner 或组织管理员可操作）");
    }
  };

  return (
    <Panel
      title="知识空间"
      titleExtra="三层结构的顶层：原始资料（不可变）→ 编译页面 → 维护规范。可见性决定读面，WRITE 消费者决定写面。"
      extra={
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建空间
        </Button>
      }
    >
      {error ? <Notice variant="warn">{error}</Notice> : null}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={spaces}
        pagination={false}
        columns={[
          { title: "名称", dataIndex: "name", render: (_, row) => (
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onEnter(row.id)}>
              {row.name}
            </Button>
          ) },
          { title: "说明", dataIndex: "description", ellipsis: true },
          { title: "归属", dataIndex: "scopeType", width: 90, render: (v: string) => KB_SCOPE_LABELS[v] || v },
          { title: "可见性", dataIndex: "visibility", width: 80, render: (v: string) => KB_VISIBILITY_LABELS[v] || v },
          { title: "页 / 源", width: 90, render: (_, row) => `${row.pageCount} / ${row.sourceCount}` },
          {
            title: "状态",
            dataIndex: "status",
            width: 80,
            render: (v: string) => <Tag color={v === "ARCHIVED" ? "default" : "green"}>{v === "ARCHIVED" ? "已归档" : "在用"}</Tag>,
          },
          { title: "更新时间", dataIndex: "updatedAt", width: 170, render: (v: string) => timeText(v) },
          {
            title: "操作",
            width: 130,
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => onEnter(row.id)}>进入</Button>
                <Button size="small" danger={row.status !== "ARCHIVED"} onClick={() => void archive(row)}>
                  {row.status === "ARCHIVED" ? "恢复" : "归档"}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal title="新建知识空间" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void create()} confirmLoading={saving}>
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="空间名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input.TextArea rows={2} placeholder="一句话说明用途（可空）" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <Select
            style={{ width: "100%" }}
            value={draft.scopeType}
            onChange={(v) => setDraft({ ...draft, scopeType: v })}
            options={selectOptions(KB_SCOPE_LABELS).filter((o) => ["PERSONAL", "ENTERPRISE", "PROVIDER", "AGENT"].includes(o.value))}
          />
          <Select
            style={{ width: "100%" }}
            value={draft.visibility}
            onChange={(v) => setDraft({ ...draft, visibility: v })}
            options={selectOptions(KB_VISIBILITY_LABELS)}
          />
        </Space>
      </Modal>
    </Panel>
  );
}

// ---------- 资料（Raw 层） ----------
function SourcesPane({ spaceId }: { spaceId: number }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<KbSource[]>([]);
  const [jobs, setJobs] = useState<KbIngestJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ kind: "meeting", title: "", text: "" });
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [src, job] = await Promise.all([
        kbApi.listSources({ query: { spaceId, page, pageSize: PAGE_SIZE } }),
        kbApi.ingestJobs({ query: { spaceId, page: 1, pageSize: 5 } }),
      ]);
      setRows(src?.list || []);
      setTotal(src?.total || 0);
      setJobs(job?.list || []);
      setError("");
    } catch (caught) {
      setRows([]);
      setError((caught as Error).message || "资料列表读取失败");
    } finally {
      setLoading(false);
    }
  }, [spaceId, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = async () => {
    if (!draft.title.trim() || !draft.text.trim()) {
      message.warning("标题与正文都必填");
      return;
    }
    setSaving(true);
    try {
      const row = await kbApi.addSource({
        body: {
          spaceId,
          kind: draft.kind as KbSource["kind"],
          title: draft.title.trim(),
          text: draft.text,
          assetId: 0,
          type: "TEXT",
          url: "",
        },
      });
      message.success(row?.status === "PENDING" ? "投料成功，等待摄取" : "同内容已存在（hash 去重复用）");
      setAddOpen(false);
      setDraft({ kind: "meeting", title: "", text: "" });
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "投料失败");
    } finally {
      setSaving(false);
    }
  };

  const ingest = async (row: KbSource) => {
    setIngesting(row.id);
    try {
      const job = await kbApi.ingest({ body: { spaceId, sourceId: row.id } });
      if (job?.status === "DONE") message.success(`摄取完成，产出 ${job.pagesAffected.length} 个页面`);
      else message.warning(job?.error || "摄取未完成，请查看作业台账");
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "摄取失败");
    } finally {
      setIngesting(0);
    }
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="原始资料"
        titleExtra="不可变 Raw 层：同内容 hash 去重；摄取（Ingest）将其编译为摘要页与实体。"
        extra={
          <Button type="primary" onClick={() => setAddOpen(true)}>
            投料
          </Button>
        }
      >
        {error ? <Notice variant="warn">{error}</Notice> : null}
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: "标题", dataIndex: "title", ellipsis: true },
            { title: "种类", dataIndex: "kind", width: 100, render: (v: string) => KB_SOURCE_KIND_LABELS[v] || v },
            { title: "状态", dataIndex: "status", width: 110, render: (v: string) => sourceStatusTag(v) },
            { title: "字数", dataIndex: "chars", width: 90 },
            { title: "摘要", dataIndex: "excerpt", ellipsis: true },
            { title: "投料时间", dataIndex: "createdAt", width: 170, render: (v: string) => timeText(v) },
            {
              title: "操作",
              width: 100,
              render: (_, row) => (
                <Button size="small" loading={ingesting === row.id} disabled={row.status === "INGESTED"} onClick={() => void ingest(row)}>
                  {row.status === "INGESTED" ? "已摄取" : "摄取"}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <Panel title="最近摄取作业" titleExtra="LLM 未配置时自动走规则式摘要（确定性回落），台账如实记录口径。">
        {jobs.length ? (
          <Table
            rowKey="id"
            size="small"
            dataSource={jobs}
            pagination={false}
            columns={[
              { title: "源", dataIndex: "sourceId", width: 70 },
              { title: "状态", dataIndex: "status", width: 100, render: (v: string) => jobStatusTag(v) },
              { title: "口径", dataIndex: "model", width: 150 },
              { title: "产出页", dataIndex: "pagesAffected", width: 90, render: (v: number[]) => v.length },
              { title: "时间", dataIndex: "createdAt", width: 170, render: (v: string) => timeText(v) },
            ]}
          />
        ) : (
          <EmptyState text="还没有摄取记录" />
        )}
      </Panel>
      <Modal title="投料（文本直投）" open={addOpen} onCancel={() => setAddOpen(false)} onOk={() => void add()} confirmLoading={saving} width={640}>
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Select style={{ width: 200 }} value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} options={selectOptions(KB_SOURCE_KIND_LABELS)} />
          <Input placeholder="资料标题" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Input.TextArea rows={8} placeholder="粘贴纪要 / 文章 / 通话逐字稿原文" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        </Space>
      </Modal>
    </Space>
  );
}

// ---------- 页面（编译制品层） ----------
function PagesPane({ spaceId }: { spaceId: number }) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<KbPageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<KbPageDetail | null>(null);
  const [writeOpen, setWriteOpen] = useState(false);
  const [draft, setDraft] = useState({ slug: "", title: "", type: "CONCEPT", body: "" });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await kbApi.listPages({
        query: {
          spaceId,
          page,
          pageSize: PAGE_SIZE,
          type: type || undefined,
          status: status || undefined,
          q: keyword.trim() || undefined,
        },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (caught) {
      setRows([]);
      setError((caught as Error).message || "页面列表读取失败");
    } finally {
      setLoading(false);
    }
  }, [spaceId, page, type, status, keyword]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openDetail = async (id: number) => {
    try {
      setDetail(await kbApi.readPage({ params: { id } }));
    } catch (caught) {
      message.error((caught as Error).message || "页面读取失败");
    }
  };

  const write = async () => {
    if (!draft.title.trim() || !draft.slug.trim()) {
      message.warning("slug 与标题都必填");
      return;
    }
    setSaving(true);
    try {
      const row = await kbApi.writePage({
        body: {
          spaceId,
          slug: draft.slug.trim(),
          type: draft.type as KbPageRow["type"],
          title: draft.title.trim(),
          body: draft.body,
          frontmatter: {},
          sourceIds: [],
        },
      });
      message.success(`已保存 v${row?.version ?? 1}（wikilink 出链 ${row?.outLinks.length ?? 0} 条）`);
      setWriteOpen(false);
      setDraft({ slug: "", title: "", type: "CONCEPT", body: "" });
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "写页失败");
    } finally {
      setSaving(false);
    }
  };

  const review = async (row: KbPageRow, decision: "publish" | "reject") => {
    try {
      await kbApi.reviewPage({ body: { id: row.id, decision, note: "" } });
      message.success(decision === "publish" ? "已放行发布" : "已驳回回落草稿");
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "评审失败（仅待审页可操作）");
    }
  };

  const remove = (row: KbPageRow) => {
    modal.confirm({
      title: `删除页面「${row.title}」？`,
      content: "正文、分块与溯源关系一并清理；图谱实体保留（其他页可能仍引用）",
      okButtonProps: { danger: true },
      onOk: async () => {
        await kbApi.deletePage({ body: { id: row.id } });
        await reload();
      },
    });
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="知识页面"
        titleExtra="slug 幂等 upsert、版本自增；正文 [[链接]] 驱动图谱，发布态才可被检索/召回。"
        extra={
          <Button type="primary" onClick={() => setWriteOpen(true)}>
            写页
          </Button>
        }
      >
        {error ? <Notice variant="warn">{error}</Notice> : null}
        <Space style={{ marginBottom: 12 }} wrap>
          <Select style={{ width: 140 }} allowClear placeholder="类型" value={type || undefined} onChange={(v) => { setType(v || ""); setPage(1); }} options={selectOptions(KB_PAGE_TYPE_LABELS)} />
          <Select style={{ width: 140 }} allowClear placeholder="状态" value={status || undefined} onChange={(v) => { setStatus(v || ""); setPage(1); }} options={selectOptions(KB_PAGE_STATUS_FILTER)} />
          <Input.Search style={{ width: 260 }} placeholder="标题 / slug 关键词" allowClear onSearch={(v) => { setKeyword(v); setPage(1); }} />
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: "标题", dataIndex: "title", render: (_, row) => (
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openDetail(row.id)}>
                {row.title}
              </Button>
            ) },
            { title: "slug", dataIndex: "slug", width: 180, ellipsis: true },
            { title: "类型", dataIndex: "type", width: 80, render: (v: string) => KB_PAGE_TYPE_LABELS[v] || v },
            { title: "状态", dataIndex: "status", width: 90, render: (v: string) => pageStatusTag(v) },
            { title: "版本", dataIndex: "version", width: 70 },
            { title: "源", dataIndex: "sourceCount", width: 60 },
            { title: "摘要", dataIndex: "excerpt", ellipsis: true },
            {
              title: "操作",
              width: 210,
              render: (_, row) => (
                <Space>
                  {row.status === "PENDING_REVIEW" ? (
                    <>
                      <Button size="small" type="primary" onClick={() => void review(row, "publish")}>放行</Button>
                      <Button size="small" onClick={() => void review(row, "reject")}>驳回</Button>
                    </>
                  ) : null}
                  <Button size="small" danger onClick={() => remove(row)}>删除</Button>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Drawer title={detail?.title || "页面详情"} size={720} open={!!detail} onClose={() => setDetail(null)}>
        {detail ? (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <div>
              <Tag>{KB_PAGE_TYPE_LABELS[detail.type] || detail.type}</Tag>
              {pageStatusTag(detail.status)}
              <span> v{detail.version} · {detail.slug} · 更新 {timeText(detail.updatedAt)}</span>
            </div>
            {detail.reviewNote ? <Notice variant="warn">评审备注：{detail.reviewNote}</Notice> : null}
            <div style={{ whiteSpace: "pre-wrap", background: "rgba(0,0,0,0.02)", padding: 12, borderRadius: 8 }}>{detail.body}</div>
            <div>
              <b>溯源资料：</b>
              {detail.sources.length ? detail.sources.map((s) => <Tag key={s.id}>{s.title}</Tag>) : "（无）"}
            </div>
            <div>
              <b>出链：</b>
              {detail.outLinks.length ? detail.outLinks.map((l) => <Tag color="blue" key={l.slug}>{l.title}</Tag>) : "（无）"}
            </div>
            <div>
              <b>入链：</b>
              {detail.inLinks.length ? detail.inLinks.map((l) => <Tag color="purple" key={l.slug}>{l.title}</Tag>) : "（无）"}
            </div>
          </Space>
        ) : null}
      </Drawer>

      <Modal title="写页（slug 幂等）" open={writeOpen} onCancel={() => setWriteOpen(false)} onOk={() => void write()} confirmLoading={saving} width={680}>
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Space style={{ width: "100%" }} wrap>
            <Input style={{ width: 220 }} placeholder="slug（小写字母/中文/-）" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
            <Input style={{ width: 240 }} placeholder="页面标题" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Select style={{ width: 130 }} value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} options={selectOptions(KB_PAGE_TYPE_LABELS)} />
          </Space>
          <Input.TextArea rows={8} placeholder={'正文，用 [[目标]] 建立交叉引用，保存后图谱与检索自动更新'} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        </Space>
      </Modal>
    </Space>
  );
}
