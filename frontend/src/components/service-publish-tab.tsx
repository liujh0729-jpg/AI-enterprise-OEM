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
import { useState } from "react";
import { CategoryField } from "@/components/category-field";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel, type HeroTab } from "@/components/ui/panel";
import { RegionScopeFields } from "@/components/location-fields";

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
 * 「🛠️ 服务发布」顶栏页签（六个板块同一条目；与名录分栏，见需求文档 §6.10 第 7 条）。
 * 是否出现由 `canPublishService` 决定（资产交易除外）。
 */
export const SERVICE_PUBLISH_TAB: HeroTab = {
  key: "services",
  label: (
    <>
      <ToolOutlined aria-hidden /> 服务发布
    </>
  ),
};

/**
 * 「🛍️ ××服务市集」顶栏页签（2026-10-28 用户裁定：市集就是服务发布，服务发布就是市集，
 * 一个板块只出一个栏目）。页签键仍是 `services`，正文由 `ServicePublishTab pool` 渲染
 * AIworkin 公开池；七个板块把原「服务发布」改名后排到名录页签之后。
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
 * 服务发布页签（物流/知产/法律/灵工/营销/资产走本地台账 + 通道同步；
 * 财税 / 供销 / 出海用 `platform` 直连 AIworkin 挂单接口，出海的界面未开）。
 * 发布走 AIworkin direction=SUPPLY：必填二级类目、服务说明；
 * 服务发布不设价格字段（2026-11-03 用户指令）：统一按平台「面议」口径落库，金额恒为 0。
 * 发布前先校验 AIPDD API Key 绑定（写上游必须用本人 Key），未绑定直接给绑定入口。
 * 可见性：除资产交易外，只有「服务商身份 + 该板块类目备案通过」渲染本栏目（见 `canPublishService`）；
 * 「发布服务」按钮除资产交易市集（§6.9 双身份，企业与服务商均可发布）外，只对服务商账号本人渲染。
 *
 * `pool`＝七板块的「××服务市集」：列表读 AIworkin SUPPLY 公开池（全平台服务商已发布的服务），
 * 本人的服务（本地台账，含未发布草稿）排在最前并可编辑/发布/删除；增删改仍写本地台账，
 * 因为后端 `moduleOf` 只放行财税 / 供销 / 出海三板块的平台直连写操作。
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
  /** 服务市集：列表读公开池，写仍走本地台账（与 `platform` 互斥）。 */
  pool?: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { me } = useSession();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();

  const isAdmin = (me?.roles || []).includes("PLATFORM_ADMIN");
  /**
   * 「发布服务」入口口径（2026-10-28 用户裁定：按钮仅服务商可以看到）：
   * 市集栏目全站可逛，但按钮只对「服务商身份 + 该板块类目备案通过」的账号渲染，
   * 与后端 `services.create()` 同口径；资产交易市集按 §6.9 双身份保留企业与服务商的发布入口。
   */
  const canPublishEntry =
    domain === "ASSET" || canPublishService(me, domain);
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
          请打开「开放集成 → <Link href="/developer/keys">API Key 管理</Link>」
          （/developer/keys），粘贴 sk- 开头的 Key 完成绑定后再回来发布。
        </span>
      ),
      okText: "去绑定",
      cancelText: "稍后再说",
      onOk: () => router.push("/developer/keys"),
    });
    return false;
  };

  const endpoint = pool
    ? `/enterprise/market/${domain}/marketplace`
    : platform
      ? `/enterprise/market/${domain}/services`
      : "/enterprise/services";
  /** 市集的写操作落在本地台账，因此台账与市集两个读取模块都要刷新。 */
  const invalidate = pool ? [endpoint, "/enterprise/services"] : [endpoint];
  const fetchQuery = useBusinessFetchQuery(endpoint);

  const createMutation = useOperationMutation(serviceBoardApi.create, invalidate);
  const updateMutation = useOperationMutation(serviceBoardApi.update, invalidate);
  const removeMutation = useOperationMutation(serviceBoardApi.remove, invalidate);
  const publishMutation = useOperationMutation(serviceBoardApi.publish, invalidate);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const query = useBusinessInfiniteQuery<ServiceRow>(
    endpoint,
    "list",
    { domain, platform, pool },
    async (signal, cursor) => {
      return serviceBoardApi.page({ domain, platform, pool }, cursor, signal);
    },
  );
  /** 市集要把本人已发布（含草稿）的台账行并进公开池前面：读 `/enterprise/services` 一次。 */
  const ownQuery = useBusinessQuery<ServiceRow[]>(
    "/enterprise/services",
    "marketplace-own",
    { domain },
    (signal) => serviceBoardApi.ownList(domain, signal),
    "all",
    pool,
  );
  const ownRows = pool ? ownQuery.data || [] : [];
  /** 本地台账行的主键集合：市集里只有这些行可编辑/发布/删除。 */
  const ownIds = new Set(ownRows.map((row) => String(row.id)));
  /** 本人的服务已同步到平台的，公开池里那条挂单与台账行是同一单，不重复列出。 */
  const poolRows = (query.data?.pages.flatMap((page) => page.list) || []).filter(
    (row) =>
      !pool ||
      !ownRows.some(
        (item) => String(item.platformListingId || "") === String(row.id),
      ),
  );
  const rows = pool ? [...ownRows, ...poolRows] : poolRows;
  const loading = query.isPending || (pool && ownQuery.isPending);
  const listError = query.error || ownQuery.error;

  /**
   * 本地台账与后端 requireOwner 同口径（发布人或平台管理员）；平台直连行只可能是本人发的；
   * 市集里别人发的服务只是公开浏览，没有本地台账行可改，因此不开放操作。
   */
  const canOwn = (row: ServiceRow) =>
    pool
      ? ownIds.has(String(row.id))
      : platform
        ? row.mine !== false
        : isAdmin || row.providerUserId === (me?.userId || "");

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
        {pool
          ? "本栏目列出 AIworkin 平台本板块全平台服务商已发布的服务，你自己的服务排在最前；"
          : platform
            ? "本栏目直接读写平台挂单，本系统不另存台账；"
            : domain === "ASSET"
              ? "资产交易市集对企业与服务商身份均可发布（§6.9 双身份）；"
              : "本栏目只对已备案通过该板块类目的服务商账号开放；"}
        发布人即该服务的承办人，联系方式按本人档案自动带出（临时换人可改）。
      </Notice>

      {listError && (
        <Notice variant="error">
          {listError.message}{" "}
          <Button
            onClick={() => {
              void query.refetch();
              void ownQuery.refetch();
            }}
          >
            重试
          </Button>
        </Notice>
      )}
      <Panel
        title={pool ? "全平台已发布的服务" : "我已发布的服务"}
        titleBadge={`${rows.length} 条`}
        extra={
          canPublishEntry ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              发布服务
            </Button>
          ) : undefined
        }
      >
        <div className="table-wrap">
          <Table<ServiceRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={false}
            size="middle"
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={
                    pool ? (
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
                        // 市集里的他人挂单没有本地台账行，其平台单号就是行 id
                        const listing =
                          row.platformListingId ||
                          (pool && !ownIds.has(String(row.id))
                            ? String(row.id)
                            : "");
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
                width: 200,
                render: (_, row) =>
                  canOwn(row) ? (
                    <Space size={6}>
                      <Button onClick={() => openEdit(row)}>编辑</Button>
                      {/* 平台直连：保存修改即写入平台挂单，不需要单独的发布动作 */}
                      {platform ? null : (
                        <Button
                          type="primary"
                          onClick={() => void publish(row)}
                        >
                          {row.status === "ONLINE" ? "重新发布" : "发布"}
                        </Button>
                      )}
                      <Button danger onClick={() => remove(row)}>
                        删除
                      </Button>
                    </Space>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        </div>
        {query.hasNextPage && (
          <Button
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            继续加载
          </Button>
        )}
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

      {passwordModal}
    </>
  );
}
