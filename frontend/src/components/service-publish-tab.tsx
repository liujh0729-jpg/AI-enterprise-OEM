"use client";

import {
  BulbOutlined,
  PlusOutlined,
  ShopOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
} from "antd";
import { useState, type ReactNode } from "react";
import { CategoryField, HubCategoryFilter } from "@/components/category-field";
import { ChannelDetails } from "@/components/channel-messages-modal";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { StatusBadge } from "@/components/status-badge";
import {
  EmptyState,
  Notice,
  Panel,
  PillTabs,
  type HeroTab,
} from "@/components/ui/panel";
import { TablePager, useCursorPages } from "@/components/ui/pager";
import {
  RegionScopeFields,
  RegionScopeFilter,
  type LocationValue,
} from "@/components/location-fields";

import {
  useBusinessInfiniteQuery,
  useBusinessFetchQuery,
  useBusinessQuery,
  useOperationMutation,
} from "@/query/business";
import { aipddKeyApi } from "@/api/aipdd-key";
import { serviceBoardApi } from "@/api/service-board";
import { presentMutationError } from "@/query/errors";
import { fmtDateTime } from "@/lib/datetime";
import { canPublishService } from "@/lib/provider-categories";
import { useSession } from "@/lib/session";

/**
 * 「🛍️ ××服务市集」顶栏页签（2026-10-28 用户裁定：市集就是服务发布，服务发布就是市集，
 * 一个板块只出一个栏目）。页签键是 `services`（供销网络页被经营性栏目占用时改为 `publish`），
 * 正文由 `ServicePublishTab pool` 渲染：全部服务读 AIworkin 公开池 + 我发布的服务读本地台账；
 * 各板块把原「服务发布」改名后排到名录页签之后。
 */
export function serviceMarketTab(label: string): HeroTab {
  return {
    key: "services",
    label: (
      <>
        <ShopOutlined aria-hidden /> {label}
      </>
    ),
  };
}

/** 后端服务发布行：`/enterprise/services`（本地台账）与平台直连看板两种来源共用。 */
type ServiceRow = import("@enterprise/contracts").ServiceRow;

/**
 * 服务范围三态（与需求侧同一口径）：「不限制」在服务侧的取值是平台的 `NATIONWIDE`。
 * 存量 `REMOTE`（远程交付）界面已不提供，按后端 `regionFromServiceBody` 的语义归入「不限制」。
 */
const SERVICE_AREA_OPTIONS = [
  { value: "NATIONWIDE", label: "不限制" },
  { value: "REGION", label: "指定地区" },
  { value: "RADIUS", label: "经纬度坐标" },
];

const DELIVERY_MODE_OPTIONS = [
  { value: "REMOTE", label: "线上远程" },
  { value: "ONSITE", label: "上门服务" },
  { value: "HYBRID", label: "线上线下结合" },
];

/** 「服务范围」三态 → 中文（存量 `REMOTE` 归入「不限制」；公开池的「不限制」取值是 `NONE`）。 */
export function serviceAreaLabel(value: string): string {
  if (value === "REMOTE" || value === "NONE") return "不限制";
  return (
    SERVICE_AREA_OPTIONS.find((item) => item.value === value)?.label || value
  );
}

/** 「服务范围」列文案：指定地区带省市、经纬度带坐标与半径（省市由后端按坐标解析）。 */
export function serviceAreaText(row: ServiceRow): string {
  const label = serviceAreaLabel(row.serviceAreaMode);
  if (row.serviceAreaMode === "REGION") {
    const place = [row.province, row.city].filter(Boolean).join(" ");
    return place ? `${label} · ${place}` : label;
  }
  if (row.serviceAreaMode === "RADIUS") {
    const place = [row.province, row.city].filter(Boolean).join(" ");
    const point =
      row.longitude !== null && row.latitude !== null
        ? `（${row.longitude}, ${row.latitude} · 半径 ${row.radiusKm} 公里）`
        : "";
    return `${label}${point}${place ? ` · ${place}` : ""}`;
  }
  return label;
}

/** 编辑态回填的三态与地域明细；存量 `REMOTE` 按「不限制」显示，数据不动。 */
function serviceRegionFormValues(row: ServiceRow) {
  const mode =
    row.serviceAreaMode === "REGION" || row.serviceAreaMode === "RADIUS"
      ? row.serviceAreaMode
      : "NATIONWIDE";
  return {
    service_area_mode: mode,
    province: mode === "REGION" ? row.province || undefined : undefined,
    city: mode === "REGION" ? row.city || undefined : undefined,
    longitude: mode === "RADIUS" ? (row.longitude ?? undefined) : undefined,
    latitude: mode === "RADIUS" ? (row.latitude ?? undefined) : undefined,
    radius_km: mode === "RADIUS" ? (row.radiusKm ?? undefined) : undefined,
  };
}

/** 交付方式 → 中文。 */
export function deliveryModeLabel(value: string): string {
  return (
    DELIVERY_MODE_OPTIONS.find((item) => item.value === value)?.label || value
  );
}

function joinList(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return String(value || "");
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return String(value || "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 服务市集页签（全站口径：市集＝服务发布，一个板块只出一个栏目；物流 / 营销 / 出海 / 灵工 /
 * IT / 知产 / 法律 / 智库 / 资产 / 供销 / 财税均走本地台账 + 通道同步）。
 * 发布走 AIworkin direction=SUPPLY：必填二级类目、服务说明；
 * 服务发布不设价格字段（2026-11-03 用户指令）：统一按平台「面议」口径落库，金额恒为 0。
 * 发布前先校验 AIPDD API Key 绑定（写上游必须用本人 Key），未绑定直接给绑定入口。
 * 可见性：除资产交易外，只有「服务商身份 + 该板块类目备案通过」渲染本栏目（见 `canPublishService`）；
 * 「发布服务」按钮除资产交易市集（§6.9 双身份，企业与服务商均可发布）外，只对服务商账号本人渲染。
 *
 * `pool`＝各板块的「××服务市集」：切换「全部服务 / 我发布的服务」两个筛选——「全部服务」读
 * AIworkin SUPPLY 公开池（全平台服务商已发布的服务），「我发布的服务」读本系统台账
 * （发布后落库并记平台内容 ID）。「我发布的服务」只对服务商身份渲染（企业身份只有「全部服务」）。
 * 增删改写本地台账（发布动作把挂单推给 AIworkin）。
 * `platform`＝平台直连看板（仅供需市场在用），出海的界面未开。
 */
export function ServicePublishTab({
  domain,
  platform = false,
  pool = false,
}: {
  domain: string;
  /**
   * 平台直连：列表与增删改直接打 `/enterprise/market/<DOMAIN>/services`
   * （本系统零落库，行里没有本地单号与「发布 AIworkin」留痕）。
   */
  platform?: boolean;
  /** 服务市集：切换「全部服务（公开池）/ 我发布的服务（本地台账）」，写仍走本地台账（与 `platform` 互斥）。 */
  pool?: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { me } = useSession();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();

  const isAdmin = (me?.roles || []).includes("PLATFORM_ADMIN");
  /** 供需市场（跨板块公开市集）：读写都走平台挂单，不做单一板块的备案门控。 */
  const hub = domain.toUpperCase() === "HUB";
  /**
   * 「发布服务」入口口径（2026-10-28 用户裁定：按钮仅服务商可以看到）：
   * 市集栏目全站可逛，但按钮只对「服务商身份 + 该板块类目备案通过」的账号渲染，
   * 与后端 `services.create()` 同口径；资产交易市集按 §6.9 双身份保留企业与服务商的发布入口；
   * 供需市场是跨板块公开市集，全部登录账号都可发布。
   */
  const canPublishEntry =
    hub || domain === "ASSET" || canPublishService(me, domain);
  /**
   * 发布服务是上游写动作（创建 / 保存 / 发布都要用本人绑定的 AIPDD APIKey）：
   * 点按钮先校验绑定，绝不等到填完表单才被 403 打回；未绑定时给可点击的绑定入口。
   */
  const keyStatus = useBusinessQuery(
    "social",
    "aipdd-key-status",
    {},
    (signal) => aipddKeyApi.status({ signal }),
    "all",
    true,
    { staleTime: 60_000 },
  );
  const ensureAipddBound = async () => {
    let bound = !!keyStatus.data?.bound;
    // 缓存可能来自绑定之前：未绑定时再取一次最新状态，避免误拦刚绑完的用户
    if (!bound) bound = !!(await keyStatus.refetch()).data?.bound;
    if (bound) return true;
    modal.confirm({
      title: "发布服务前需绑定 AIPDD API Key",
      content: (
        <span>
          发布服务会把服务登记到 AIworkin 平台，需先绑定本账号自己的 AIPDD API Key。
          请打开「模型服务 → <Link href="/developer/keys">API Key 管理</Link>」
          （/developer/keys），粘贴 sk- 开头的 Key 完成绑定后再回来发布。
        </span>
      ),
      okText: "去绑定",
      cancelText: "稍后再说",
      onOk: () => router.push("/developer/keys"),
    });
    return false;
  };

  /**
   * 服务市场（市集 / 供需市场的服务栏目）＝有「全部服务 / 我发布的服务」两个筛选的栏目。
   * 2026-11-09 用户口径：「我发布的服务」只对服务商身份渲染，企业身份一律不渲染
   * （单选不出控件 → 企业身份连筛选控件都不渲染，只看到「全部服务」＝平台公开池）。
   */
  const isMarket = pool || hub;
  const showScope = isMarket && me?.currentIdentity === "SERVICE_PROVIDER";
  const [scope, setScope] = useState<"all" | "mine">("all");
  /** 实际取数范围：非市场栏目（财税 / 供销的服务发布）恒读本地台账。 */
  const activeScope: "all" | "mine" = showScope
    ? scope
    : isMarket
      ? "all"
      : "mine";
  /** 地域 / 类目筛选只对平台通道（平台直连看板 / 市集公开池）生效，本地台账页不展示。 */
  const filtersApply = platform || (pool && activeScope === "all");
  const endpoint =
    activeScope === "mine" && !platform
      ? "/enterprise/services"
      : pool
        ? `/enterprise/market/${domain}/marketplace`
        : `/enterprise/market/${domain}/services`;
  /** 市集的写操作落在本地台账，因此台账与市集两个读取模块都要刷新。 */
  const invalidate = Array.from(
    new Set(pool ? [endpoint, "/enterprise/services"] : [endpoint]),
  );
  const fetchQuery = useBusinessFetchQuery(endpoint);

  const createMutation = useOperationMutation(serviceBoardApi.create, invalidate);
  const updateMutation = useOperationMutation(serviceBoardApi.update, invalidate);
  const removeMutation = useOperationMutation(serviceBoardApi.remove, invalidate);
  const publishMutation = useOperationMutation(serviceBoardApi.publish, invalidate);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [viewing, setViewing] = useState<ServiceRow | null>(null);
  /** 类目筛选（二级类目 id）：只有供需市场渲染该控件，其余场景恒为空串。 */
  const [categoryId, setCategoryId] = useState("");
  /** 地域筛选（省 / 市）：与需求列表同口径，只对读公开池的两个分支（平台直连 / 服务市集）生效。 */
  const [region, setRegion] = useState<LocationValue>({
    province: "",
    city: "",
  });
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const query = useBusinessInfiniteQuery<ServiceRow>(
    endpoint,
    "list",
    { domain, platform, pool, categoryId, region, scope: activeScope },
    async (signal, cursor) => {
      return serviceBoardApi.page(
        { domain, platform, pool, categoryId, region, scope: activeScope },
        cursor,
        signal,
      );
    },
  );
  const rows = query.data?.pages.flatMap((page) => page.list) || [];
  const loading = query.isPending;
  const listError = query.error;
  /** 列表分页：过滤器变化回第一页，翻到未加载页时自动取下一段游标页。 */
  const pager = useCursorPages<ServiceRow>({
    rows,
    hasMore: !!query.hasNextPage,
    fetchNext: query.fetchNextPage,
    isFetchingNext: query.isFetchingNextPage,
    resetKey: `${domain}|${activeScope}|${categoryId}|${region.province}|${region.city}`,
  });

  /**
   * 行归属与后端 requireOwner 同口径（发布人或平台管理员）：「我发布的服务」整页都是本人的行；
   * 供需市场（HUB）的「全部服务」读的是平台公开池，行一律非本账号；市集里别人发的服务只是
   * 公开浏览，没有本地台账行可改。
   */
  const canOwn = (row: ServiceRow) => {
    if (activeScope === "mine") return row.mine !== false;
    if (hub) return false;
    return isAdmin || row.providerUserId === (me?.userId || "");
  };
  /**
   * 行是否已正式同步到 AIworkin：平台 REST 写（PATCH / DELETE）对 API Key 一律 401、
   * MCP 也没有改删工具，因此这类行在本系统只留「查看」（2026-11-09 用户裁定）；
   * 本地台账里尚未发布的草稿（status 非 ONLINE）仍可编辑 / 发布 / 删除。
   */
  const synced = (row: ServiceRow) => platform || row.status === "ONLINE";

  /** 列表「服务编号」列与弹窗标题用的单号：平台行没有本地单号，显示挂单 id。 */
  const noOf = (row: ServiceRow) => row.serviceNo || String(row.id);

  const openCreate = () => {
    void (async () => {
      if (!(await ensureAipddBound())) return;
      setEditing(null);
      form.resetFields();
      form.setFieldsValue({
        service_area_mode: "NATIONWIDE",
        delivery_mode: "REMOTE",
      });
      setOpen(true);
    })();
  };

  const openEdit = (row: ServiceRow) => {
    const apply = async () => {
      try {
        row = await fetchQuery(
          "detail",
          { domain, platform, id: row.id },
          (signal) =>
            serviceBoardApi.detail({ domain, platform }, row.id, signal),
        );
        // 平台直连：保存修改即写平台挂单，打开编辑前也要确认已绑定本人的 Key
        if (platform && !(await ensureAipddBound())) return;
        setEditing(row);
        form.setFieldsValue({
          sub_category_id: row.subCategoryId,
          title: row.title,
          description: row.description,
          tags: row.tags,
          ...serviceRegionFormValues(row),
          delivery_mode: row.deliveryMode || "REMOTE",
          response_time: row.responseTime,
          qualifications: row.qualifications,
          highlights: joinList(row.highlights),
          cases: row.cases,
          reference_links: joinList(row.reference_links ?? row.referenceLinks),
          contact_name: row.contactName,
          contact_phone: row.contactPhone,
          contact_wechat: row.contactWechat,
          contact_email: row.contactEmail,
        });
        setOpen(true);
      } catch (error) {
        presentMutationError(error, (text) => message.error(text));
      }
    };
    void apply();
  };

  /** 查看详情：公开池与自有行都读平台明细（AIworkin 服务详情接口）。 */
  const openView = (row: ServiceRow) => {
    void (async () => {
      try {
        setViewing(
          await fetchQuery(
            "detail",
            { domain, platform, id: row.id },
            (signal) =>
              serviceBoardApi.detail({ domain, platform }, row.id, signal),
          ),
        );
      } catch (error) {
        presentMutationError(error, (text) => message.error(text));
      }
    })();
  };

  const bodyOf = (values: Record<string, unknown>) => ({
    domain,
    sub_category_id: values.sub_category_id,
    title: String(values.title || "").trim(),
    description: String(values.description || "").trim(),
    tags: String(values.tags || "").trim(),
    // 服务发布不设价格字段（2026-11-03 用户指令）：统一按平台「面议」口径落库，金额恒为 0。
    money_mode: "NEGOTIABLE",
    service_area_mode: values.service_area_mode,
    province: String(values.province || "").trim(),
    city: String(values.city || "").trim(),
    longitude: values.longitude ?? null,
    latitude: values.latitude ?? null,
    radius_km: values.radius_km ?? null,
    delivery_mode: values.delivery_mode || "",
    response_time: String(values.response_time || "").trim(),
    qualifications: String(values.qualifications || "").trim(),
    highlights: splitList(values.highlights).join(","),
    cases: String(values.cases || "").trim(),
    reference_links: splitList(values.reference_links).join(","),
    contact_name: String(values.contact_name || "").trim(),
    contact_phone: String(values.contact_phone || "").trim(),
    contact_wechat: String(values.contact_wechat || "").trim(),
    contact_email: String(values.contact_email || "").trim(),
  });

  const submit = async (publishAction: "DRAFT" | "PUBLISH") => {
    const values = (await form.validateFields()) as Record<string, unknown>;
    const body = { ...bodyOf(values), publish_action: publishAction };
    if (editing) {
      const target = editing;
      requestPassword({
        title: "修改服务（需密码）",
        content: platform
          ? `确认修改「${target.title}」？保存即写入 AIworkin 平台挂单。`
          : `确认修改「${target.title}」？已发布至 AIworkin 的服务，修改后需重新发布才在平台生效。`,
        okText: "保存修改",
        onOk: async () => {
          const payload = await updateMutation.mutateAsync({
            domain,
            platform,
            id: target.id,
            body,
          });
          message.success(payload?.tip || "已保存修改");
          setOpen(false);
          setEditing(null);
        },
      });
      return;
    }
    setSubmitting(true);
    try {
      const payload = await createMutation.mutateAsync({
        domain,
        platform,
        body,
      });
      const tip = payload?.tip;
      message.success(
        publishAction === "PUBLISH" ? "服务已提交发布" : "服务草稿已保存",
      );
      if (tip) message.info(tip);
      setOpen(false);
      form.resetFields();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    } finally {
      setSubmitting(false);
    }
  };

  const publish = async (row: ServiceRow) => {
    if (!(await ensureAipddBound())) return;
    let payload;
    try {
      payload = await publishMutation.mutateAsync(row.id);
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
      return;
    }
    const tip = payload?.tip;
    message.success("已提交 AIworkin 平台通道");
    if (tip) message.info(tip);
  };

  const remove = (row: ServiceRow) => {
    requestPassword({
      title: "删除服务",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.title}」？删除后平台侧服务同步下架且不可恢复。`,
      onOk: async () => {
        await removeMutation.mutateAsync({ domain, platform, id: row.id });
        message.success("已删除");
      },
    });
  };

  return (
    <>
      <Notice variant="info">
        发布服务即向 AIworkin
        平台登记服务能力（供需双向自动匹配）：需先选择二级类目、填好服务说明；
        需资质的类目在平台侧核验通过后才会参与匹配展示（发布内容的资质由平台核验，本系统不审核）。
        {hub
          ? "本栏目两个筛选：「全部服务」读 AIworkin 平台公开池（全平台服务商已发布的服务，读取走平台通道，未绑定 Key 也能浏览）；「我发布的服务」读本系统台账（发布后落库并记平台内容 ID），仅服务商身份可见。已正式发布到平台的挂单不可在本系统改删，只留「查看」；"
          : pool
            ? "本栏目两个筛选：「全部服务」读 AIworkin 平台本板块全平台服务商已发布的服务；「我发布的服务」读本系统台账（发布后落库并记平台内容 ID），仅服务商身份可见。已正式发布到平台的挂单不可在本系统改删，只留「查看」；"
            : platform
              ? "本栏目读本系统台账（我发布的服务）；发布时同步到 AIworkin 平台挂单，并把平台内容 ID 记回本地台账。已发布的挂单不可在本系统改删，只留「查看」；"
              : domain === "ASSET"
                ? "资产交易市集对企业与服务商身份均可发布（§6.9 双身份）；"
                : "本栏目只对已备案通过该板块类目的服务商账号开放；"}
        发布人即该服务的承办人，联系方式按本人档案自动带出（临时换人可改）。
      </Notice>

      {listError && (
        <Notice variant="error">
          {listError.message}{" "}
          <Button onClick={() => void query.refetch()}>重试</Button>
        </Notice>
      )}
      <Panel
        title={activeScope === "all" ? "全平台已发布的服务" : "我已发布的服务"}
        titleBadge={`${rows.length} 条`}
        extra={
          canPublishEntry ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              发布服务
            </Button>
          ) : undefined
        }
      >
        {showScope || filtersApply ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            {showScope ? (
              <PillTabs
                size="small"
                variant="soft"
                items={[
                  { key: "all", label: "全部服务" },
                  { key: "mine", label: "我发布的服务" },
                ]}
                value={scope}
                onChange={(key) => setScope(key === "mine" ? "mine" : "all")}
              />
            ) : null}
            {filtersApply ? (
              <RegionScopeFilter value={region} onChange={setRegion} />
            ) : null}
            {filtersApply && hub ? (
              <HubCategoryFilter value={categoryId} onChange={setCategoryId} />
            ) : null}
          </div>
        ) : null}
        <div className="table-wrap">
          <Table<ServiceRow>
            rowKey="id"
            loading={loading || query.isFetchingNextPage}
            dataSource={pager.rows}
            pagination={false}
            size="middle"
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={
                    pool || hub ? (
                      <ShopOutlined aria-hidden />
                    ) : (
                      <ToolOutlined aria-hidden />
                    )
                  }
                  text={
                    canPublishEntry
                      ? "暂无已发布服务，点击右上角发布服务"
                      : "暂无已发布服务"
                  }
                />
              ),
            }}
            columns={[
              {
                title: "服务编号",
                width: platform || pool ? 300 : 140,
                render: (_, row) => <span className="mono">{noOf(row)}</span>,
              },
              {
                title: "一级类目",
                dataIndex: "category1",
                width: 160,
                render: (value: string) => value || "—",
              },
              {
                title: "二级类目",
                dataIndex: "category2",
                width: 160,
                render: (value: string) => value || "—",
              },
              {
                title: "服务标题",
                dataIndex: "title",
                width: 240,
                render: (value: string) => value || "—",
              },
              {
                title: "服务范围",
                width: 190,
                render: (_, row) => serviceAreaText(row),
              },
              {
                title: "交付方式",
                width: 120,
                render: (_, row) =>
                  row.deliveryMode ? deliveryModeLabel(row.deliveryMode) : "—",
              },
              {
                title: "资质要求",
                dataIndex: "credentialTypes",
                width: 170,
                render: (value: string) => value || "无需资质",
              },
              {
                title: "状态",
                width: 110,
                render: (_, row) => (
                  <StatusBadge domain="supplyListing" status={row.status} />
                ),
              },
              // 平台直连行本身就是平台挂单，没有「是否已发布到平台」这一层留痕
              ...(platform
                ? []
                : [
                    {
                      title: "发布 AIworkin",
                      width: 160,
                      render: (_: unknown, row: ServiceRow) => {
                        // 市集 / 供需市场的挂单本身就是平台挂单，其平台单号就是行 id
                        const listing =
                          row.platformListingId ||
                          (pool || hub ? String(row.id) : "");
                        return (
                          <span className="text-12">
                            {listing ? (
                              <span className="mono">{listing}</span>
                            ) : (
                              "未发布"
                            )}
                          </span>
                        );
                      },
                    },
                  ]),
              {
                title: "创建时间",
                dataIndex: "createdAt",
                width: 170,
                render: (value: string) => (
                  <span className="text-12">{fmtDateTime(value)}</span>
                ),
              },
              {
                title: "操作",
                width: hub ? 240 : 200,
                render: (_, row) => {
                  const ops: ReactNode[] = [];
                  const own = canOwn(row);
                  // 供需市场「全部服务」是他人的平台挂单：只给「查看」（读平台明细）。
                  if (hub && !own)
                    ops.push(
                      <Button key="view" onClick={() => openView(row)}>
                        查看
                      </Button>,
                    );
                  if (own) {
                    if (synced(row)) {
                      // 已同步 AIworkin 的行不可在本系统改删，只留「查看」。
                      ops.push(
                        <Button key="view" onClick={() => openView(row)}>
                          查看
                        </Button>,
                      );
                    } else {
                      // 尚未发布的本地草稿：可编辑、发布、删除。
                      ops.push(
                        <Button key="edit" onClick={() => openEdit(row)}>
                          编辑
                        </Button>,
                        <Button
                          key="publish"
                          type="primary"
                          onClick={() => void publish(row)}
                        >
                          {row.status === "ONLINE" ? "重新发布" : "发布"}
                        </Button>,
                        <Button key="remove" danger onClick={() => remove(row)}>
                          删除
                        </Button>,
                      );
                    }
                  }
                  return ops.length ? (
                    <Space size={6} wrap>
                      {ops}
                    </Space>
                  ) : (
                    <span className="text-12 muted">—</span>
                  );
                },
              },
            ]}
          />
        </div>
        <TablePager
          page={pager.page}
          pageSize={pager.pageSize}
          total={pager.total}
          loaded={pager.loaded}
          hasMore={!!query.hasNextPage}
          onChange={pager.setPage}
        />
      </Panel>

      <Modal
        open={open}
        title={
          editing
            ? `修改服务 · ${noOf(editing)}`
            : "发布服务（发布人 → 平台匹配）"
        }
        width={720}
        confirmLoading={submitting}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        footer={
          editing
            ? [
                <Button
                  key="cancel"
                  onClick={() => {
                    setOpen(false);
                    setEditing(null);
                  }}
                >
                  取消
                </Button>,
                <Button
                  key="save"
                  type="primary"
                  onClick={() => void submit("PUBLISH")}
                >
                  保存修改
                </Button>,
              ]
            : [
                <Button
                  key="cancel"
                  onClick={() => {
                    setOpen(false);
                    setEditing(null);
                  }}
                >
                  取消
                </Button>,
                <Button key="draft" onClick={() => void submit("DRAFT")}>
                  存草稿
                </Button>,
                <Button
                  key="publish"
                  type="primary"
                  onClick={() => void submit("PUBLISH")}
                >
                  提交发布
                </Button>,
              ]
        }
      >
        <Form form={form} layout="vertical">
          <CategoryField domain={domain} showCredentialHint />
          <Form.Item
            name="title"
            label="服务标题 *"
            rules={[{ required: true, message: "请填写服务标题" }]}
          >
            <Input placeholder="如：跨境电商小包专线（美线 7-12 日达）" />
          </Form.Item>
          <Form.Item
            name="description"
            label="服务说明 *"
            rules={[{ required: true, message: "请填写服务说明" }]}
          >
            <Input.TextArea
              rows={3}
              placeholder="服务内容、覆盖范围、时效与结算方式等"
            />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="逗号分隔，如：美线,小包,含清关" />
          </Form.Item>
          <RegionScopeFields
            label="服务范围"
            modeField="service_area_mode"
            modeOptions={SERVICE_AREA_OPTIONS}
            required
          />
          <div className="form-2col">
            <Form.Item name="delivery_mode" label="交付方式">
              <Select allowClear options={DELIVERY_MODE_OPTIONS} />
            </Form.Item>
            <Form.Item name="response_time" label="响应时效">
              <Input placeholder="如：2 小时内响应报价" />
            </Form.Item>
          </div>
          <Form.Item name="qualifications" label="服务资质">
            <Input placeholder="如：一级货代资质 / 无船承运人 NVOCC" />
          </Form.Item>
          <Form.Item name="highlights" label="服务亮点">
            <Input placeholder="逗号分隔，如：全程可视化,自有报关行" />
          </Form.Item>
          <Form.Item name="cases" label="服务案例">
            <Input placeholder="如：某家电企业美线年发 300 柜，准时率 98%" />
          </Form.Item>
          <Form.Item name="reference_links" label="参考链接">
            <Input placeholder="逗号分隔，如：https://example.com/case1" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="contact_name" label="联系人">
              <Input placeholder="留空按本人档案自动带出" />
            </Form.Item>
            <Form.Item name="contact_phone" label="手机">
              <Input placeholder="留空按本人档案自动带出" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="contact_wechat" label="微信">
              <Input placeholder="微信（选填）" />
            </Form.Item>
            <Form.Item name="contact_email" label="邮箱">
              <Input placeholder="邮箱（选填）" />
            </Form.Item>
          </div>
        </Form>
        <p className="text-12 muted" style={{ marginBottom: 0 }}>
          <BulbOutlined aria-hidden /> 服务不设价格字段，具体报价由双方沟通确定；
          服务归属由平台按本人企业档案自动绑定。
        </p>
      </Modal>

      <Modal
        open={viewing !== null}
        title={`服务详情 · ${viewing ? noOf(viewing) : ""}`}
        width={720}
        footer={null}
        onCancel={() => setViewing(null)}
      >
        {viewing ? (
          <ChannelDetails
            items={[
              { label: "服务编号", value: noOf(viewing) },
              { label: "一级类目", value: viewing.category1 },
              { label: "二级类目", value: viewing.category2 },
              { label: "服务标题", value: viewing.title },
              { label: "服务说明", value: viewing.description },
              { label: "标签", value: viewing.tags },
              { label: "服务范围", value: serviceAreaText(viewing) },
              {
                label: "交付方式",
                value: viewing.deliveryMode
                  ? deliveryModeLabel(viewing.deliveryMode)
                  : "",
              },
              { label: "响应时效", value: viewing.responseTime },
              { label: "服务资质", value: viewing.qualifications },
              { label: "服务亮点", value: joinList(viewing.highlights) },
              { label: "服务案例", value: viewing.cases },
              {
                label: "参考链接",
                value: joinList(viewing.reference_links ?? viewing.referenceLinks),
              },
              { label: "联系人", value: viewing.contactName },
              { label: "手机", value: viewing.contactPhone },
              { label: "微信", value: viewing.contactWechat },
              { label: "邮箱", value: viewing.contactEmail },
              { label: "创建时间", value: fmtDateTime(viewing.createdAt) },
            ]}
          />
        ) : null}
      </Modal>

      {passwordModal}
    </>
  );
}
