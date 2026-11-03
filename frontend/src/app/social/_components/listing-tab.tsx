"use client";

import { DeleteOutlined, PlusOutlined, SyncOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Modal, Select } from "antd";
import { ApiError } from "@enterprise/contracts";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, Notice, Panel, PillTabs } from "@/components/ui/panel";
import { useAipddSyncGate } from "@/components/aipdd-sync-gate";
import { socialApi, type ListingRow } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { PersonAvatar, fmtRelative } from "./social-ui";

const MONEY_LABELS: Record<string, string> = {
  FIXED: "固定价",
  STARTING: "起步价",
  RANGE: "区间价",
  NEGOTIABLE: "面议",
};
const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  LOCAL_PUBLISHED: { bg: "#e6f4ff", color: "#0958d9", label: "本地已发布" },
  UPSTREAM_SYNCING: { bg: "#fffbe6", color: "#d48806", label: "同步中" },
  UPSTREAM_LIVE: { bg: "#f6ffed", color: "#389e0d", label: "上游已上线" },
  UPSTREAM_REJECTED: { bg: "#fff1f0", color: "#cf1322", label: "上游已撤回/驳回" },
  SYNC_FAILED: { bg: "#fff7e6", color: "#d46b08", label: "同步失败" },
};

interface UpstreamForm {
  deadline: string;
  contactName: string;
  contactPhone: string;
  contactWechat: string;
  contactEmail: string;
  priceDescription: string;
  serviceAreaMode: string;
}

const EMPTY_UPSTREAM: UpstreamForm = {
  deadline: "",
  contactName: "",
  contactPhone: "",
  contactWechat: "",
  contactEmail: "",
  priceDescription: "",
  serviceAreaMode: "NATIONWIDE",
};

/**
 * 上游同步的必填项与请求体：发布时勾选同步、发布后点「同步上游」走同一套口径，
 * 免得两处校验漂移（需求要未来截止时间 + 一种联系方式，服务要报价说明）。
 */
function buildUpstreamBody(
  kind: "DEMAND" | "SERVICE",
  province: string,
  form: UpstreamForm,
): { error: string; body: Record<string, string> } {
  const body: Record<string, string> = {};
  if (kind === "DEMAND") {
    const deadline = form.deadline.trim();
    const at = Date.parse(deadline);
    if (!deadline || Number.isNaN(at))
      return { error: "同步需填写截止时间（如 2026-12-31 或 2026-12-31T18:00）", body };
    if (at <= Date.now()) return { error: "截止时间要晚于当前时间", body };
    if (!form.contactPhone && !form.contactWechat && !form.contactEmail)
      return { error: "需求同步需至少填写一种联系方式（电话 / 微信 / 邮箱）", body };
    body.deadline = new Date(at).toISOString();
    if (form.contactName) body.contactName = form.contactName;
    if (form.contactPhone) body.contactPhone = form.contactPhone;
    if (form.contactWechat) body.contactWechat = form.contactWechat;
    if (form.contactEmail) body.contactEmail = form.contactEmail;
    return { error: "", body };
  }
  if (!form.priceDescription.trim()) return { error: "服务同步需填写报价说明", body };
  if (form.serviceAreaMode === "REGION" && !province.trim())
    return { error: "服务范围选「指定地区」需先填写省份", body };
  body.priceDescription = form.priceDescription.trim();
  body.serviceAreaMode = form.serviceAreaMode;
  return { error: "", body };
}

/** 上游同步字段：发布弹层勾选同步与「同步上游」弹窗共用一套输入项，免得两边长得不一样。 */
function upstreamFields(
  kind: "DEMAND" | "SERVICE",
  form: UpstreamForm,
  patch: (next: Partial<UpstreamForm>) => void,
) {
  if (kind === "DEMAND") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="sns-field">
          <span className="sns-field-label">截止时间（必填）</span>
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
        <Notice variant="info">需求同步需未来截止时间 + 至少一种联系方式（电话 / 微信 / 邮箱）。</Notice>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="sns-field">
        <span className="sns-field-label">报价说明（必填）</span>
        <Input.TextArea
          rows={3}
          placeholder="如：¥5,000 起 / 按项目计价，含 2 轮修改"
          value={form.priceDescription}
          onChange={(e) => patch({ priceDescription: e.target.value })}
        />
      </div>
      <div className="sns-field">
        <span className="sns-field-label">服务范围</span>
        <PillTabs
          size="small"
          value={form.serviceAreaMode}
          onChange={(v) => patch({ serviceAreaMode: v })}
          items={[
            { key: "NATIONWIDE", label: "全国" },
            { key: "REGION", label: "指定地区" },
          ]}
        />
      </div>
      <Notice variant="info">服务同步需报价说明；地区按发帖填写的省市（如为空则全国）。</Notice>
    </div>
  );
}

/** 价格文案：面议 / 区间 / 单值 / 仅计价方式 */
function priceText(row: ListingRow) {
  if (!row.moneyMode) return "";
  const label = MONEY_LABELS[row.moneyMode] || row.moneyMode;
  if (row.moneyMode === "NEGOTIABLE") return "面议";
  const hasMin = row.amountMin != null;
  const hasMax = row.amountMax != null;
  if (hasMin && hasMax) return `${row.amountMin} - ${row.amountMax}`;
  if (hasMin) return `${label} ${row.amountMin}`;
  if (hasMax) return `${label} ${row.amountMax}`;
  return label;
}

/**
 * 供求广场（M6）：社交板通用发布需求 / 服务，本地免 Key 发布进信息流；
 * 「同步发布到 AIworkin」经凭证解析器用绑定 Key 调上游，未绑定 Key 给出 403 引导。
 */
export function ListingTab() {
  const { message } = App.useApp();
  const [filterType, setFilterType] = useState<"ALL" | "DEMAND" | "SERVICE">("ALL");
  const [keyword, setKeyword] = useState("");
  const [committedKeyword, setCommittedKeyword] = useState("");

  // 发布弹层：页面只留一个入口按钮，表单放进弹层，不再在列表上方常驻整块表单。
  const [publishOpen, setPublishOpen] = useState(false);
  const [type, setType] = useState<"DEMAND" | "SERVICE">("DEMAND");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [moneyMode, setMoneyMode] = useState<string | undefined>();
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [subcategoryId, setSubcategoryId] = useState<string | undefined>();

  // 「同步到 AIworkin」：绑了 AIPDD Key 默认勾选；没绑时点勾选只做绑定引导，不会真勾上。
  // 与招聘板块共用同一个门控，免得两处口径漂移。
  const sync = useAipddSyncGate({ panelOpen: publishOpen, subject: "帖子" });
  const [publishUpstream, setPublishUpstream] = useState<UpstreamForm>(EMPTY_UPSTREAM);

  // 同步上游弹窗
  const [syncTarget, setSyncTarget] = useState<ListingRow | null>(null);
  const [upstream, setUpstream] = useState<UpstreamForm>(EMPTY_UPSTREAM);

  const categories = useBusinessQuery("social", "listing-categories", {}, (signal) =>
    socialApi.listingCategories({ signal }),
  );
  const feed = useBusinessQuery(
    "social",
    "listings",
    { type: filterType, keyword: committedKeyword },
    (signal) =>
      socialApi.listListings(
        {
          type: filterType === "ALL" ? undefined : filterType,
          keyword: committedKeyword || undefined,
        },
        { signal },
      ),
  );
  const mine = useBusinessQuery("social", "my-listings", {}, (signal) =>
    socialApi.myListings({ signal }),
  );
  const create = useOperationMutation(
    async () => {
      const t = title.trim();
      const d = description.trim();
      if (!t) return { error: "请填写标题", row: null } as const;
      if (!d) return { error: "请填写详细说明", row: null } as const;
      const min = amountMin ? Number(amountMin) : undefined;
      const max = amountMax ? Number(amountMax) : undefined;
      if (min != null && !Number.isInteger(min)) return { error: "金额需为整数", row: null } as const;
      if (max != null && !Number.isInteger(max)) return { error: "金额需为整数", row: null } as const;
      const row = await socialApi.createListing({
        type,
        title: t,
        description: d,
        tags,
        moneyMode,
        amountMin: min,
        amountMax: max,
        province: province.trim() || undefined,
        city: city.trim() || undefined,
        contactNote: contactNote.trim() || undefined,
        subcategoryId,
      });
      return { error: "", row } as const;
    },
    ["social"],
  );
  const remove = useOperationMutation((input: { id: number }) => socialApi.deleteListing(input.id), ["social"]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setTags([]);
    setMoneyMode(undefined);
    setAmountMin("");
    setAmountMax("");
    setProvince("");
    setCity("");
    setContactNote("");
    setSubcategoryId(undefined);
    setPublishUpstream(EMPTY_UPSTREAM);
  };

  /** 每次打开发布弹层重选一次默认：绑了 Key 就默认同步，没绑就默认仅本地。 */
  const openPublish = () => {
    sync.reset();
    setPublishUpstream(EMPTY_UPSTREAM);
    setPublishOpen(true);
  };

  const onCreate = async () => {
    // 同步上游硬需要二级类目（buildDraft 不认空或非法值）：勾选时就先拦住，避免发完同步失败
    if (sync.wanted && !subcategoryId) return message.error("同步到 AIworkin 需先选择二级类目");
    const precheck = sync.wanted ? buildUpstreamBody(type, province, publishUpstream) : { error: "", body: {} };
    if (precheck.error) return message.error(precheck.error);
    const res = await create.mutateAsync(undefined);
    if (res?.error) return message.error(res.error);
    const row = res.row;
    if (!sync.wanted || !row?.id) {
      message.success("已发布到供求广场");
    } else {
      try {
        await socialApi.publishListingUpstream(row.id, precheck.body);
        message.success("已发布到供求广场，并同步发布到 AIworkin");
      } catch (error) {
        // 本地帖已经发出去了，同步失败不拖丢发布：回明原因并留出重试入口
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

  const openSync = (row: ListingRow) => {
    setSyncTarget(row);
    setUpstream({
      ...EMPTY_UPSTREAM,
      serviceAreaMode: row.province ? "REGION" : "NATIONWIDE",
    });
  };

  const submitSync = async () => {
    if (!syncTarget) return;
    const { error, body } = buildUpstreamBody(
      syncTarget.type === "SERVICE" ? "SERVICE" : "DEMAND",
      syncTarget.province || "",
      upstream,
    );
    if (error) return message.warning(error);
    try {
      await socialApi.publishListingUpstream(syncTarget.id, body);
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

  const renderListing = (row: ListingRow, isMine: boolean) => {
    const st = STATUS_STYLE[row.status] || { bg: "#f4f6fa", color: "var(--text-2)", label: row.status };
    const isDemand = row.type !== "SERVICE";
    const price = priceText(row);
    const location = `${row.province || ""} ${row.city || ""}`.trim();
    const category = row.category2 ? (row.category1 ? `${row.category1} / ${row.category2}` : row.category2) : "";
    return (
      <div key={row.id} className="sns-listing">
        <div className="sns-listing-head">
          <span className="sns-flag" style={{ background: isDemand ? "#e6fffb" : "#f9f0ff", color: isDemand ? "#08979c" : "#722ed1" }}>
            {isDemand ? "需求" : "服务"}
          </span>
          <span className="sns-flag" style={{ background: st.bg, color: st.color }}>{st.label}</span>
          <span className="sns-muted" style={{ marginLeft: "auto" }}>{fmtRelative(row.createdAt)}</span>
        </div>
        <div className="sns-listing-title">{row.title}</div>
        <div className="sns-listing-desc sns-clamp-3">{row.description}</div>
        {price ? (
          <div className="sns-price">
            {price}
            {row.currency ? <small>{row.currency}</small> : null}
          </div>
        ) : null}
        <div className="sns-tags">
          {category ? <span className="sns-tag">{category}</span> : null}
          {location ? <span className="sns-tag">{location}</span> : null}
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
        title="发布需求 / 服务"
        okText={sync.wanted ? "发布并同步到 AIworkin" : "发布到供求广场"}
        cancelText="取消"
        width={720}
        confirmLoading={create.isPending}
        onOk={onCreate}
        onCancel={() => setPublishOpen(false)}
        destroyOnHidden
      >
        <Notice variant="info">
          本地发布免费、无需绑定 APIKey，帖子照常进供求广场信息流；已绑定 AIPDD APIKey 时默认勾选同步，发布后同步到 AIworkin 获得更多关注。
        </Notice>

        <div className="sns-form-grid" style={{ marginTop: 16 }}>
          <div className="sns-field sns-form-full">
            <span className="sns-field-label">发布类型</span>
            <PillTabs
              value={type}
              onChange={(v) => setType(v as "DEMAND" | "SERVICE")}
              items={[
                { key: "DEMAND", label: "发布需求" },
                { key: "SERVICE", label: "发布服务" },
              ]}
            />
          </div>
          <div className="sns-field sns-form-full">
            <span className="sns-field-label">二级类目（同步上游必填）</span>
            <Select
              placeholder="选择类目"
              style={{ width: "100%" }}
              allowClear
              value={subcategoryId}
              onChange={setSubcategoryId}
              options={(categories.data || []).map((m) => ({
                label: `${m.moduleLabel} · ${m.parentName}`,
                title: m.moduleLabel,
                options: m.options.map((o) => ({ label: o.name, value: o.id })),
              }))}
            />
          </div>
          <div className="sns-field sns-form-full">
            <span className="sns-field-label">标题</span>
            <Input placeholder="一句话说清楚你要什么 / 提供什么" maxLength={120} showCount value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="sns-field sns-form-full">
            <span className="sns-field-label">详细说明</span>
            <Input.TextArea
              rows={3}
              maxLength={20000}
              showCount
              placeholder="需求要什么 / 服务提供什么，写清楚交付内容与时间预期…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="sns-field sns-form-full">
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
          <div className="sns-field">
            <span className="sns-field-label">计价方式</span>
            <Select
              placeholder="选择计价方式"
              style={{ width: "100%" }}
              allowClear
              value={moneyMode}
              onChange={setMoneyMode}
              options={Object.entries(MONEY_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <div className="sns-field">
            <span className="sns-field-label">金额区间（元）</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
              <Input placeholder="下限" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
              <span className="sns-muted">至</span>
              <Input placeholder="上限" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
            </div>
          </div>
          <div className="sns-field">
            <span className="sns-field-label">省份（选填）</span>
            <Input placeholder="如：浙江" value={province} onChange={(e) => setProvince(e.target.value)} />
          </div>
          <div className="sns-field">
            <span className="sns-field-label">城市（选填）</span>
            <Input placeholder="如：杭州" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="sns-field sns-form-full">
            <span className="sns-field-label">联系方式说明（选填）</span>
            <Input placeholder="如：请站内私信，或添加微信 abc123" maxLength={500} value={contactNote} onChange={(e) => setContactNote(e.target.value)} />
          </div>
        </div>

        <div className="sns-sync-head">
          <Checkbox
            checked={sync.wanted}
            onChange={(e) =>
              sync.toggle(e.target.checked, () =>
                setPublishUpstream((prev) => ({
                  ...prev,
                  serviceAreaMode: province.trim() ? "REGION" : "NATIONWIDE",
                })),
              )
            }
          >
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
            {upstreamFields(type, publishUpstream, (next) =>
              setPublishUpstream((prev) => ({ ...prev, ...next })),
            )}
          </div>
        ) : null}
      </Modal>

      {/* 供求信息流为主栏，我的发布为右侧窄栏（对齐 SNS 的中栏 + 右 rail） */}
      <div className="sns-side-layout">
        <Panel
          title="供求广场"
          titleBadge={<span className="sns-muted">{feedRows.length} 条</span>}
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={openPublish}>
              发布需求 / 服务
            </Button>
          }
        >
          <div className="sns-toolbar" style={{ marginBottom: 14 }}>
            <PillTabs
              variant="soft"
              value={filterType}
              onChange={(v) => setFilterType(v as typeof filterType)}
              items={[
                { key: "ALL", label: "全部" },
                { key: "DEMAND", label: "需求" },
                { key: "SERVICE", label: "服务" },
              ]}
            />
            <Input.Search
              placeholder="搜索标题 / 内容"
              allowClear
              style={{ width: 240 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={(v) => setCommittedKeyword(v.trim())}
            />
          </div>
          {feed.isLoading ? null : feedRows.length === 0 ? (
            <EmptyState text="还没有供求帖，发布第一条试试。" />
          ) : (
            <div className="sns-grid-wide">{feedRows.map((row) => renderListing(row, false))}</div>
          )}
        </Panel>

        <div className="sns-side-col">
          <Panel title="我的发布" titleBadge={<span className="sns-muted">{mineRows.length} 条</span>}>
            {mineRows.length === 0 ? (
              <EmptyState text="你还没有发布过需求或服务。" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {mineRows.map((row) => renderListing(row, true))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Modal
        open={!!syncTarget}
        title={`同步发布到 AIworkin · ${syncTarget?.type === "SERVICE" ? "服务" : "需求"}`}
        okText="确认同步"
        cancelText="取消"
        confirmLoading={false}
        onOk={submitSync}
        onCancel={() => setSyncTarget(null)}
        destroyOnHidden
      >
        {syncTarget
          ? upstreamFields(
              syncTarget.type === "SERVICE" ? "SERVICE" : "DEMAND",
              upstream,
              (next) => setUpstream({ ...upstream, ...next }),
            )
          : null}
      </Modal>
    </div>
  );
}