"use client";

import { DeleteOutlined, PlusOutlined, SyncOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Modal, Select } from "antd";
import { ApiError } from "@enterprise/contracts";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, Notice, Panel, PillTabs } from "@/components/ui/panel";
import { useAipddSyncGate } from "@/components/aipdd-sync-gate";
import { hiringApi, type HiringRow } from "@/api/hiring";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { PersonAvatar, fmtRelative } from "@/app/social/_components/social-ui";

const SALARY_LABELS: Record<string, string> = {
  FIXED: "固定薪",
  STARTING: "起薪",
  RANGE: "区间薪",
  NEGOTIABLE: "面议",
};
const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  LOCAL_PUBLISHED: { bg: "#e6f4ff", color: "#0958d9", label: "本地已发布" },
  UPSTREAM_SYNCING: { bg: "#fffbe6", color: "#d48806", label: "同步中" },
  UPSTREAM_LIVE: { bg: "#f6ffed", color: "#389e0d", label: "上游已上线" },
  UPSTREAM_REJECTED: { bg: "#fff1f0", color: "#cf1322", label: "上游已撤回/驳回" },
  SYNC_FAILED: { bg: "#fff7e6", color: "#d46b08", label: "同步失败" },
};

/** 同步上游只补平台必需、岗位本身不承载的信息：报名截止与对外联系方式。 */
interface SyncForm {
  deadline: string;
  contactName: string;
  contactPhone: string;
  contactWechat: string;
  contactEmail: string;
}
const EMPTY_SYNC: SyncForm = {
  deadline: "",
  contactName: "",
  contactPhone: "",
  contactWechat: "",
  contactEmail: "",
};

/**
 * 上游同步的必填项与请求体：发布时勾选同步、发布后点「同步上游」走同一套口径。
 * 截止时间优先取本次填写，留空则回落到岗位上的报名截止（后端也会回落，这里先拦住免得发完才报错）。
 */
function buildSyncBody(form: SyncForm, fallbackDeadline: string): { error: string; body: Record<string, string> } {
  const raw = form.deadline.trim() || fallbackDeadline.trim();
  const at = Date.parse(raw);
  const body: Record<string, string> = {};
  if (!raw || Number.isNaN(at))
    return { error: "同步需填写报名截止时间（如 2026-12-31 或 2026-12-31T18:00）", body };
  if (at <= Date.now()) return { error: "报名截止时间要晚于当前时间", body };
  const contactPhone = form.contactPhone.trim();
  const contactWechat = form.contactWechat.trim();
  const contactEmail = form.contactEmail.trim();
  if (!contactPhone && !contactWechat && !contactEmail)
    return { error: "同步需至少填写一种联系方式（电话 / 微信 / 邮箱）", body };
  body.deadline = new Date(at).toISOString();
  if (form.contactName.trim()) body.contactName = form.contactName.trim();
  if (contactPhone) body.contactPhone = contactPhone;
  if (contactWechat) body.contactWechat = contactWechat;
  if (contactEmail) body.contactEmail = contactEmail;
  return { error: "", body };
}

/** 薪资文案：面议 / 区间 / 单值 / 仅计价方式。 */
function salaryText(row: HiringRow) {
  if (!row.salaryMode) return "";
  const label = SALARY_LABELS[row.salaryMode] || row.salaryMode;
  if (row.salaryMode === "NEGOTIABLE") return "薪资面议";
  const hasMin = row.salaryMin != null;
  const hasMax = row.salaryMax != null;
  if (hasMin && hasMax) return `${row.salaryMin} - ${row.salaryMax}`;
  if (hasMin) return `${label} ${row.salaryMin}`;
  if (hasMax) return `${label} ${row.salaryMax}`;
  return label;
}

function deadlineText(raw: string) {
  const at = Date.parse(raw);
  return Number.isNaN(at) ? "" : new Date(at).toLocaleDateString("zh-CN");
}

/** 同步字段区：发布弹层与「同步上游」弹窗共用一套输入项。 */
function syncFields(form: SyncForm, patch: (next: Partial<SyncForm>) => void) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="sns-field">
        <span className="sns-field-label">报名截止（同步必填）</span>
        <Input placeholder="如 2026-12-31 或 2026-12-31T18:00" value={form.deadline} onChange={(e) => patch({ deadline: e.target.value })} />
      </div>
      <div className="sns-field">
        <span className="sns-field-label">联系人姓名（选填）</span>
        <Input placeholder="选填" value={form.contactName} onChange={(e) => patch({ contactName: e.target.value })} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="sns-field">
          <span className="sns-field-label">联系电话</span>
          <Input placeholder="选填" value={form.contactPhone} onChange={(e) => patch({ contactPhone: e.target.value })} />
        </div>
        <div className="sns-field">
          <span className="sns-field-label">联系微信</span>
          <Input placeholder="选填" value={form.contactWechat} onChange={(e) => patch({ contactWechat: e.target.value })} />
        </div>
      </div>
      <div className="sns-field">
        <span className="sns-field-label">联系邮箱</span>
        <Input placeholder="选填" value={form.contactEmail} onChange={(e) => patch({ contactEmail: e.target.value })} />
      </div>
      <Notice variant="info">
        岗位在平台上是「用工需求」：同步需未来报名时间 + 至少一种联系方式（电话 / 微信 / 邮箱）。
      </Notice>
    </div>
  );
}

/**
 * 招聘广场（商务人脉 → 招聘，移植 SNS 招聘专区）：岗位本地免 Key 发布进信息流，
 * 沟通走站内私信（候选人在对话里可附 HTML 简历投递），本系统不做 ATS 简历库与筛选；
 * 勾选同步则把岗位发成 AIworkin 的用工需求。
 */
export function HiringTab() {
  const { message } = App.useApp();
  const [filterType, setFilterType] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const [committedKeyword, setCommittedKeyword] = useState("");

  // 发布弹层：页面只留一个入口按钮，表单放进弹层（与供求广场同一交互口径）。
  const [publishOpen, setPublishOpen] = useState(false);
  const [type, setType] = useState<string>("FULL_TIME");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [headCount, setHeadCount] = useState("");
  const [salaryMode, setSalaryMode] = useState<string | undefined>();
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [deadline, setDeadline] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [publishSync, setPublishSync] = useState<SyncForm>(EMPTY_SYNC);

  // 「同步到 AIworkin」：绑了 AIPDD Key 默认勾选；没绑时点勾选只做绑定引导，不会真勾上。
  const sync = useAipddSyncGate({ panelOpen: publishOpen, subject: "岗位" });

  // 同步上游弹窗
  const [syncTarget, setSyncTarget] = useState<HiringRow | null>(null);
  const [upstream, setUpstream] = useState<SyncForm>(EMPTY_SYNC);

  const types = useBusinessQuery("hiring", "types", {}, (signal) => hiringApi.types({ signal }));
  const syncCategory = useBusinessQuery("hiring", "sync-category", {}, (signal) =>
    hiringApi.syncCategory({ signal }),
  );
  const feed = useBusinessQuery(
    "hiring",
    "posts",
    { type: filterType, keyword: committedKeyword },
    (signal) =>
      hiringApi.list(
        {
          type: filterType === "ALL" ? undefined : filterType,
          keyword: committedKeyword || undefined,
        },
        { signal },
      ),
  );
  const mine = useBusinessQuery("hiring", "my-posts", {}, (signal) => hiringApi.mine({ signal }));

  const create = useOperationMutation(
    async () => {
      const t = title.trim();
      const d = description.trim();
      if (!t) return { error: "请填写岗位名称", row: null } as const;
      if (!d) return { error: "请填写职位描述与任职要求", row: null } as const;
      const count = headCount ? Number(headCount) : undefined;
      if (count != null && (!Number.isInteger(count) || count < 1 || count > 9999))
        return { error: "招聘人数需为 1-9999 的整数", row: null } as const;
      const min = salaryMin ? Number(salaryMin) : undefined;
      const max = salaryMax ? Number(salaryMax) : undefined;
      if (min != null && !Number.isInteger(min)) return { error: "薪资需为整数", row: null } as const;
      if (max != null && !Number.isInteger(max)) return { error: "薪资需为整数", row: null } as const;
      const row = await hiringApi.create({
        type,
        title: t,
        description: d,
        headCount: count,
        salaryMode,
        salaryMin: min,
        salaryMax: max,
        tags,
        province: province.trim() || undefined,
        city: city.trim() || undefined,
        contactNote: contactNote.trim() || undefined,
        deadline: deadline.trim() || undefined,
      });
      return { error: "", row } as const;
    },
    ["hiring"],
  );
  const remove = useOperationMutation((input: { id: number }) => hiringApi.remove(input.id), ["hiring"]);

  const resetForm = () => {
    setType("FULL_TIME");
    setTitle("");
    setDescription("");
    setHeadCount("");
    setSalaryMode(undefined);
    setSalaryMin("");
    setSalaryMax("");
    setProvince("");
    setCity("");
    setDeadline("");
    setContactNote("");
    setTags([]);
    setPublishSync(EMPTY_SYNC);
  };

  /** 每次打开发布弹层重选一次同步默认：绑了 Key 就默认同步，没绑就默认仅本地。 */
  const openPublish = () => {
    sync.reset();
    setPublishSync(EMPTY_SYNC);
    setPublishOpen(true);
  };

  const onCreate = async () => {
    const gate = sync.wanted ? buildSyncBody(publishSync, deadline) : { error: "", body: {} };
    if (gate.error) return message.error(gate.error);
    const res = await create.mutateAsync(undefined);
    if (res?.error) return message.error(res.error);
    const row = res.row;
    if (!sync.wanted || !row?.id) {
      message.success("已发布到招聘广场");
    } else {
      try {
        // 岗位上的报名截止已随后端落库，这里只补对外联系方式（截止时间留空时后端回落到岗位值）
        await hiringApi.publishUpstream(row.id, gate.body);
        message.success("已发布到招聘广场，并同步发布到 AIworkin");
      } catch (error) {
        // 本地岗位已经发出去了，同步失败不拖丢发布：回明原因并留出重试入口
        const text =
          error instanceof ApiError && error.status === 403
            ? "同步需先在「开放集成 → API Key 管理」绑定 AIPDD API Key"
            : error instanceof Error
              ? error.message
              : "同步发布失败";
        message.warning(`本地已发布，但同步 AIworkin 失败：${text}，可在「我的发布」里点「同步上游」重试。`);
      }
    }
    resetForm();
    sync.reset();
    setPublishOpen(false);
  };

  const openSync = (row: HiringRow) => {
    setSyncTarget(row);
    setUpstream({ ...EMPTY_SYNC, deadline: row.deadline || "" });
  };

  const submitSync = async () => {
    if (!syncTarget) return;
    const { error, body } = buildSyncBody(upstream, syncTarget.deadline || "");
    if (error) return message.warning(error);
    try {
      await hiringApi.publishUpstream(syncTarget.id, body);
      message.success("已同步发布到 AIworkin");
      setSyncTarget(null);
      void mine.refetch();
      void feed.refetch();
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        message.error("同步发布需先在「开放集成 → API Key 管理」绑定 AIPDD API Key");
      } else {
        message.error(error instanceof Error ? error.message : "同步发布失败");
      }
    }
  };

  const typeOptions = (types.data || []).map((item) => ({ value: item.value, label: item.label }));
  /** 广场顶部类型筛选：字典项是 value/label（下拉要用），页签单独映射成 key/label。 */
  const typeFilters = [
    { key: "ALL", label: "全部" },
    ...typeOptions.map((item) => ({ key: item.value, label: item.label })),
  ];
  const renderPost = (row: HiringRow, isMine: boolean) => {
    const st = STATUS_STYLE[row.status] || { bg: "#f4f6fa", color: "var(--text-2)", label: row.status };
    const salary = salaryText(row);
    const location = `${row.province || ""} ${row.city || ""}`.trim();
    const due = deadlineText(row.deadline);
    return (
      <div key={row.id} className="sns-listing">
        <div className="sns-listing-head">
          <span className="sns-flag" style={{ background: "#e6fffb", color: "#08979c" }}>{row.typeLabel}</span>
          <span className="sns-flag" style={{ background: st.bg, color: st.color }}>{st.label}</span>
          <span className="sns-muted" style={{ marginLeft: "auto" }}>{fmtRelative(row.createdAt)}</span>
        </div>
        <div className="sns-listing-title">{row.title}</div>
        <div className="sns-listing-desc sns-clamp-3">{row.description}</div>
        {salary ? (
          <div className="sns-price">
            {salary}
            {row.currency ? <small>{row.currency}</small> : null}
          </div>
        ) : null}
        <div className="sns-tags">
          {location ? <span className="sns-tag">{location}</span> : null}
          <span className="sns-tag">招 {row.headCount} 人</span>
          {due ? <span className="sns-tag">报名截止 {due}</span> : null}
          {(row.tags || []).map((t) => <span key={t} className="sns-tag">#{t}</span>)}
        </div>
        <div className="sns-listing-foot">
          <span className="sns-person" style={{ gap: 6 }}>
            <PersonAvatar person={row.author} size={22} />
            <span>{row.author?.displayName || "匿名"}</span>
          </span>
          {isMine ? (
            <span style={{ display: "flex", gap: 2 }}>
              {row.publishedUpstream ? null : (
                <Button size="small" type="link" icon={<SyncOutlined />} onClick={() => openSync(row)}>
                  同步上游
                </Button>
              )}
              <Button
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                loading={remove.isPending}
                onClick={() => remove.mutateAsync({ id: row.id }).then(() => message.success("已删除"))}
              >
                删除
              </Button>
            </span>
          ) : (
            <span className="sns-muted">{row.contactNote || "站内私信对接"}</span>
          )}
        </div>
      </div>
    );
  };

  const feedRows = feed.data || [];
  const mineRows = mine.data || [];

  return (
    <div className="sns-wrap">
      <Modal
        open={publishOpen}
        title="发布岗位"
        okText={sync.wanted ? "发布并同步到 AIworkin" : "发布到招聘广场"}
        cancelText="取消"
        width={720}
        confirmLoading={create.isPending}
        onOk={onCreate}
        onCancel={() => setPublishOpen(false)}
        destroyOnHidden
      >
        <Notice variant="info">
          本地发布免费、无需绑定 APIKey，岗位照常进招聘广场信息流（沟通走站内私信）；已绑定 AIPDD APIKey 时默认勾选同步，发布后同步为 AIworkin 的用工需求。
        </Notice>

        <div className="sns-form-grid" style={{ marginTop: 16 }}>
          <div className="sns-field">
            <span className="sns-field-label">招聘类型</span>
            <Select
              placeholder="选择招聘类型"
              style={{ width: "100%" }}
              value={type}
              onChange={setType}
              loading={types.isLoading}
              options={typeOptions}
            />
          </div>
          <div className="sns-field">
            <span className="sns-field-label">招聘人数</span>
            <Input placeholder="如：2" value={headCount} onChange={(e) => setHeadCount(e.target.value)} />
          </div>
          <div className="sns-field sns-form-full">
            <span className="sns-field-label">岗位名称</span>
            <Input placeholder="如：跨境电商运营（双休 / 五险一金）" maxLength={100} showCount value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="sns-field sns-form-full">
            <span className="sns-field-label">职位描述与任职要求</span>
            <Input.TextArea
              rows={4}
              maxLength={20000}
              showCount
              placeholder="写清楚岗位职责、任职要求、工作地点与到岗时间，候选人据此判断是否私信你…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="sns-field">
            <span className="sns-field-label">薪资计价</span>
            <Select
              placeholder="选择薪资计价方式"
              style={{ width: "100%" }}
              allowClear
              value={salaryMode}
              onChange={setSalaryMode}
              options={Object.entries(SALARY_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <div className="sns-field">
            <span className="sns-field-label">薪资区间</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
              <Input placeholder="下限" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} />
              <span className="sns-muted">至</span>
              <Input placeholder="上限" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} />
            </div>
          </div>
          <div className="sns-field">
            <span className="sns-field-label">工作省份（选填）</span>
            <Input placeholder="如：浙江" value={province} onChange={(e) => setProvince(e.target.value)} />
          </div>
          <div className="sns-field">
            <span className="sns-field-label">工作城市（选填）</span>
            <Input placeholder="如：杭州" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="sns-field">
            <span className="sns-field-label">报名截止（同步上游必填）</span>
            <Input placeholder="如 2026-12-31 或 2026-12-31T18:00" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div className="sns-field">
            <span className="sns-field-label">标签</span>
            <Select
              mode="tags"
              placeholder="回车添加，最多 10 个"
              style={{ width: "100%" }}
              value={tags}
              onChange={(v) => setTags(v.slice(0, 10))}
              tokenSeparators={[",", " "]}
            />
          </div>
          <div className="sns-field sns-form-full">
            <span className="sns-field-label">联系方式说明（选填）</span>
            <Input placeholder="如：请站内私信，或添加微信 abc123" maxLength={500} value={contactNote} onChange={(e) => setContactNote(e.target.value)} />
          </div>
        </div>

        <div className="sns-sync-head">
          <Checkbox checked={sync.wanted} onChange={(e) => sync.toggle(e.target.checked)}>
            自动同步到 AIworkin，获得更多关注
          </Checkbox>
          {!sync.bound ? (
            <span className="sns-sync-hint">
              同步需先到「开放集成 → <Link href="/developer/keys">API Key 管理</Link>」绑定 AIPDD API Key；不绑定也不影响本地发布。
            </span>
          ) : null}
        </div>
        {sync.wanted ? (
          <div className="sns-sync-block">
            {syncCategory.data ? (
              <Notice variant="info">
                上游类目：{syncCategory.data.category1} / {syncCategory.data.category2}（岗位按用工需求发布，类目固定）
              </Notice>
            ) : null}
            <div style={{ marginTop: 10 }}>
              {syncFields(publishSync, (next) => setPublishSync((prev) => ({ ...prev, ...next })))}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 招聘广场为主栏，我的发布为右侧窄栏（对齐 SNS 的中栏 + 右 rail） */}
      <div className="sns-side-layout">
        <Panel
          title="招聘广场"
          titleBadge={<span className="sns-muted">{feedRows.length} 条</span>}
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={openPublish}>
              发布岗位
            </Button>
          }
        >
          <div className="sns-toolbar" style={{ marginBottom: 14 }}>
            <PillTabs
              variant="soft"
              value={filterType}
              onChange={(v) => setFilterType(v as string)}
              items={typeFilters}
            />
            <Input.Search
              placeholder="搜索岗位名称 / 描述"
              allowClear
              style={{ width: 240 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={(v) => setCommittedKeyword(v.trim())}
            />
          </div>
          {feed.isLoading ? null : feedRows.length === 0 ? (
            <EmptyState text="还没有岗位，发布第一条试试。" />
          ) : (
            <div className="sns-grid-wide">{feedRows.map((row) => renderPost(row, false))}</div>
          )}
        </Panel>

        <div className="sns-side-col">
          <Panel title="我的发布" titleBadge={<span className="sns-muted">{mineRows.length} 条</span>}>
            {mineRows.length === 0 ? (
              <EmptyState text="你还没有发布过岗位。" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {mineRows.map((row) => renderPost(row, true))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Modal
        open={!!syncTarget}
        title={`同步发布到 AIworkin · ${syncTarget?.typeLabel || "岗位"}`}
        okText="确认同步"
        cancelText="取消"
        confirmLoading={false}
        onOk={submitSync}
        onCancel={() => setSyncTarget(null)}
        destroyOnHidden
      >
        {syncTarget ? (
          <div style={{ paddingTop: 4 }}>
            {syncFields(upstream, (next) => setUpstream({ ...upstream, ...next }))}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
