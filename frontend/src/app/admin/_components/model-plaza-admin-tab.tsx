"use client";

import {
  ApiOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  CONTENT_CHANNEL_PROVIDERS,
  CONTENT_CHANNEL_PROVIDER_LABELS,
  CONTENT_CHANNEL_PRESET_LABELS,
  CONTENT_CHANNEL_PRESETS,
  CONTENT_MEDIA_TYPES,
  CONTENT_MEDIA_TYPE_LABELS,
  CONTENT_PRESET_DEFAULT_MEDIA_TYPES,
  isProviderSupported,
  type ContentChannelPolicy,
  type ContentChannelPreset,
  type ContentMediaType,
  type MpAdminModel,
  type MpAipddView,
  type MpBillingUnit,
  type MpCategory,
  type MpComponent,
  type MpDiscoveredModel,
  type MpPlatformCapability,
  type MpPlatformDefaults,
  type MpPlatformLimits,
  type MpPullResult,
  type MpTier,
  type MpUpstream,
  type MpUsageLog,
} from "@enterprise/contracts";
import { modelPlazaAdminApi } from "@/api/model-plaza";
import {
  UNIT_LABEL,
  UNIT_SUFFIX,
  discountLabel,
  tierSummary,
} from "@/lib/model-plaza-pricing";
import {
  EmptyState,
  Notice,
  Panel,
  PanelTabs,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";

type Tab = "catalog" | "upstreams" | "policy" | "platform" | "usage";

type PlatformDraft = {
  enabled: boolean;
  models: Partial<Record<MpPlatformCapability, number>>;
  limits: MpPlatformLimits;
};

type Overview = {
  rate: number;
  upstreamCount: number;
  catalogTotal: number;
  catalogEnabled: number;
  aipdd: MpAipddView;
  calls7d: number;
  points7d: number;
  activeUsers7d: number;
};

const ENDPOINT_OPTIONS = [
  "/chat/completions",
  "/embeddings",
  "/images/generations",
  "/images/edits",
  "/audio/speech",
  "/audio/transcriptions",
  "/videos",
];

const ENDPOINT_LABEL: Record<string, string> = {
  "/chat/completions": "对话",
  "/embeddings": "向量",
  "/images/generations": "文生图",
  "/images/edits": "图像编辑",
  "/audio/speech": "语音合成",
  "/audio/transcriptions": "语音识别",
  "/videos": "视频",
};

const SOURCE_LABEL: Record<string, string> = {
  IN_APP: "站内试用",
  API: "对外 API",
};

const CATEGORY_LABEL: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  embedding: "向量",
  other: "其他",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(
  ([value, label]) => ({
    value,
    label,
  }),
);

const CATEGORY_COLOR: Record<string, string> = {
  text: "blue",
  image: "green",
  video: "purple",
  audio: "orange",
  embedding: "cyan",
};

const MEDIA_TYPE_OPTIONS = CONTENT_MEDIA_TYPES.map((value) => ({
  value,
  label: CONTENT_MEDIA_TYPE_LABELS[value],
}));

/** 分档维度：图像按像素尺寸 / 清晰度，视频按分辨率，都是上游 back-to-back 的规格。 */
const TIER_DIMENSIONS = [
  { value: "size", label: "像素尺寸", placeholder: "1024x1024" },
  { value: "quality", label: "清晰度", placeholder: "1K / 2K / 4K" },
  {
    value: "video_resolution",
    label: "视频分辨率",
    placeholder: "480p / 768p / 1080p",
  },
] as const;

type TierKey = (typeof TIER_DIMENSIONS)[number]["value"];
type TierRow = { key: TierKey; value: string; unitRmb: number };

/** 上游 tiers ↔ 可视化行：每行一个规格 +单价，避免管理员手写 JSON。 */
function tiersToRows(tiers: MpTier[]): TierRow[] {
  return tiers.map((tier) => {
    const entry = Object.entries(tier.match)[0] ?? ["size", ""];
    const key = TIER_DIMENSIONS.some((item) => item.value === entry[0])
      ? (entry[0] as TierKey)
      : "size";
    return { key, value: entry[1], unitRmb: tier.unitRmb };
  });
}

function rowsToTiers(rows: TierRow[]): MpTier[] {
  return rows
    .filter((row) => row.value.trim())
    .map((row) => ({
      match: { [row.key]: row.value.trim() },
      unitRmb: Number(row.unitRmb || 0),
    }));
}

type UpstreamDraft = {
  id: number;
  name: string;
  provider: string;
  baseUrl: string;
  protocol: "openai" | "anthropic";
  apiKey: string;
  enabled: boolean;
  remark: string;
};

type CatalogDraft = {
  id: number;
  upstreamId: number;
  provider: string;
  modelKey: string;
  upstreamModelKey: string;
  displayName: string;
  vendor: string;
  description: string;
  /** 与上游 aipdd.pricing.billing_unit 完全一致 */
  billingUnit: MpBillingUnit;
  /** 能力分类：文本 / 图片 / 视频 / 音频 / 向量 / 其他 */
  category: MpCategory;
  /** 官方原价：token 按每百万 tokens，媒体类按每张/每秒/每次 */
  inputRmbPrice: number;
  outputRmbPrice: number;
  callRmbPrice: number;
  cacheReadRmbPrice: number;
  cacheWriteRmbPrice: number;
  minimumRmb: number;
  tiers: MpTier[];
  components: MpComponent[];
  discountRate: number;
  contextWindow: number;
  maxOutputTokens: number;
  modalities: { input: string[]; output: string[] };
  endpoints: string[];
  tags: string[];
  enabled: boolean;
  sort: number;
  remark: string;
};

const EMPTY_UPSTREAM: UpstreamDraft = {
  id: 0,
  name: "",
  provider: "LocalAPI",
  baseUrl: "",
  protocol: "openai",
  apiKey: "",
  enabled: true,
  remark: "",
};

const EMPTY_CATALOG: CatalogDraft = {
  id: 0,
  upstreamId: 0,
  provider: "AIPDD",
  modelKey: "",
  upstreamModelKey: "",
  displayName: "",
  vendor: "",
  description: "",
  billingUnit: "token",
  category: "text",
  inputRmbPrice: 0,
  outputRmbPrice: 0,
  callRmbPrice: 0,
  cacheReadRmbPrice: 0,
  cacheWriteRmbPrice: 0,
  minimumRmb: 0,
  tiers: [],
  components: [],
  discountRate: 1,
  contextWindow: 0,
  maxOutputTokens: 0,
  modalities: { input: ["text"], output: ["text"] },
  endpoints: ["/chat/completions"],
  tags: [],
  enabled: false,
  sort: 0,
  remark: "",
};

function num(value: number, digits = 4) {
  return Number(value || 0).toFixed(digits);
}

export function ModelPlazaAdminTab() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<Tab>("catalog");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [aipdd, setAipdd] = useState<MpAipddView | null>(null);
  const [policy, setPolicy] = useState<ContentChannelPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);

  const [platformDefaults, setPlatformDefaults] =
    useState<MpPlatformDefaults | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformSaving, setPlatformSaving] = useState(false);
  const [platformDraft, setPlatformDraft] = useState<PlatformDraft>({
    enabled: false,
    models: {},
    limits: { perCallPoints: 0, dailyPoints: 0, monthlyPoints: 0 },
  });

  const [upstreams, setUpstreams] = useState<MpUpstream[]>([]);
  const [upstreamLoading, setUpstreamLoading] = useState(false);
  const [upstreamModal, setUpstreamModal] = useState(false);
  const [upstreamDraft, setUpstreamDraft] =
    useState<UpstreamDraft>(EMPTY_UPSTREAM);
  const [upstreamSaving, setUpstreamSaving] = useState(false);

  const [catalog, setCatalog] = useState<MpAdminModel[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [provider, setProvider] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | MpCategory>(
    "ALL",
  );
  const [enabledFilter, setEnabledFilter] = useState<"ALL" | "ON" | "OFF">(
    "ALL",
  );
  const [providers, setProviders] = useState<string[]>([]);
  const [upstreamOptions, setUpstreamOptions] = useState<
    { id: number; name: string; provider: string }[]
  >([]);
  const [rate, setRate] = useState(0);
  const [catalogModal, setCatalogModal] = useState(false);
  const [catalogDraft, setCatalogDraft] = useState<CatalogDraft>(EMPTY_CATALOG);
  const [catalogSaving, setCatalogSaving] = useState(false);
  /** 分档用「规格 + 单价」可视化编辑；附加组件仍是上游原样透传的 JSON。 */
  const [tierRows, setTierRows] = useState<TierRow[]>([]);
  const [componentsText, setComponentsText] = useState("[]");

  const [pullModal, setPullModal] = useState(false);
  const [pullUpstreamId, setPullUpstreamId] = useState(0);
  const [pullResult, setPullResult] = useState<MpPullResult | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullPicked, setPullPicked] = useState<Record<string, boolean>>({});
  const [pullCategory, setPullCategory] = useState("ALL");
  const [pullEnabled, setPullEnabled] = useState(false);
  const [importing, setImporting] = useState(false);

  const [usage, setUsage] = useState<MpUsageLog[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usagePage, setUsagePage] = useState(1);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageSource, setUsageSource] = useState<"ALL" | "IN_APP" | "API">(
    "ALL",
  );

  const loadOverview = useCallback(async () => {
    try {
      const data = await modelPlazaAdminApi.overview();
      if (!data) throw new Error("总览返回为空");
      setOverview(data);
      setAipdd(data.aipdd);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "总览加载失败");
    }
  }, [message]);

  const loadPolicy = useCallback(async () => {
    setPolicyLoading(true);
    try {
      const data = await modelPlazaAdminApi.channelPolicy();
      if (!data) throw new Error("渠道策略返回为空");
      setPolicy(data);
    } catch (cause) {
      message.error(
        cause instanceof Error ? cause.message : "渠道策略加载失败",
      );
    } finally {
      setPolicyLoading(false);
    }
  }, [message]);

  const loadPlatformDefaults = useCallback(async () => {
    setPlatformLoading(true);
    try {
      const data = await modelPlazaAdminApi.platformDefaults();
      if (!data) throw new Error("平台默认模型返回为空");
      setPlatformDefaults(data);
      const models: Partial<Record<MpPlatformCapability, number>> = {};
      for (const slot of data.slots) {
        if (slot.catalogId > 0) models[slot.capability] = slot.catalogId;
      }
      setPlatformDraft({ enabled: data.enabled, models, limits: data.limits });
    } catch (cause) {
      message.error(
        cause instanceof Error ? cause.message : "平台默认模型加载失败",
      );
    } finally {
      setPlatformLoading(false);
    }
  }, [message]);

  const loadUpstreams = useCallback(async () => {
    setUpstreamLoading(true);
    try {
      const data = await modelPlazaAdminApi.upstreams();
      if (!data) throw new Error("上游返回为空");
      setUpstreams(data.list);
      setAipdd(data.aipdd);
      setUpstreamOptions([
        { id: 0, name: "AIPDD（平台）", provider: "AIPDD" },
        ...data.list.map((row) => ({
          id: row.id,
          name: row.name,
          provider: row.provider,
        })),
      ]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "上游加载失败");
    } finally {
      setUpstreamLoading(false);
    }
  }, [message]);

  const loadCatalog = useCallback(
    async (page = 1) => {
      setCatalogLoading(true);
      try {
        const data = await modelPlazaAdminApi.catalog({
          query: {
            page,
            pageSize: 20,
            keyword,
            provider,
            category: categoryFilter,
            enabled: enabledFilter,
          },
        });
        if (!data) throw new Error("目录返回为空");
        setCatalog(data.list);
        setCatalogTotal(data.total);
        setCatalogPage(data.page);
        setProviders(data.providers);
        setRate(data.rate);
        setAipdd(data.aipdd);
        setUpstreamOptions([
          { id: 0, name: "AIPDD（平台）", provider: "AIPDD" },
          ...data.upstreams.map((row) => ({
            id: row.id,
            name: row.name,
            provider: row.provider,
          })),
        ]);
      } catch (cause) {
        message.error(cause instanceof Error ? cause.message : "目录加载失败");
      } finally {
        setCatalogLoading(false);
      }
    },
    [categoryFilter, enabledFilter, keyword, message, provider],
  );

  const loadUsage = useCallback(
    async (page = 1) => {
      setUsageLoading(true);
      try {
        const data = await modelPlazaAdminApi.usage({
          query: {
            page,
            pageSize: 20,
            source: usageSource,
            modelKey: "",
            from: "",
            to: "",
            userId: "",
          },
        });
        if (!data) throw new Error("用量返回为空");
        setUsage(data.list);
        setUsageTotal(data.total);
        setUsagePage(data.page);
      } catch (cause) {
        message.error(cause instanceof Error ? cause.message : "用量加载失败");
      } finally {
        setUsageLoading(false);
      }
    },
    [message, usageSource],
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (tab === "upstreams") void loadUpstreams();
  }, [tab, loadUpstreams]);

  useEffect(() => {
    if (tab === "catalog") void loadCatalog(1);
  }, [tab, loadCatalog]);

  useEffect(() => {
    if (tab === "policy") void loadPolicy();
  }, [tab, loadPolicy]);

  useEffect(() => {
    if (tab === "platform") void loadPlatformDefaults();
  }, [tab, loadPlatformDefaults]);

  useEffect(() => {
    if (tab === "usage") void loadUsage(1);
  }, [tab, loadUsage]);

  const savePolicy = async () => {
    if (!policy) return;
    setPolicySaving(true);
    try {
      const next = await modelPlazaAdminApi.saveChannelPolicy({
        body: policy,
      });
      if (next) setPolicy(next);
      message.success("用户渠道策略已保存");
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setPolicySaving(false);
    }
  };

  const savePlatformDefaults = async () => {
    setPlatformSaving(true);
    try {
      const next = await modelPlazaAdminApi.savePlatformDefaults({
        body: {
          enabled: platformDraft.enabled,
          models: platformDraft.models,
          limits: platformDraft.limits,
        },
      });
      if (next) {
        setPlatformDefaults(next);
        const models: Partial<Record<MpPlatformCapability, number>> = {};
        for (const slot of next.slots) {
          if (slot.catalogId > 0) models[slot.capability] = slot.catalogId;
        }
        setPlatformDraft({
          enabled: next.enabled,
          models,
          limits: next.limits,
        });
      }
      message.success("平台默认模型已保存");
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setPlatformSaving(false);
    }
  };

  const saveUpstream = async () => {
    if (!upstreamDraft.name.trim() || !upstreamDraft.baseUrl.trim()) {
      message.warning("请填写渠道名称与接口地址");
      return;
    }
    if (!upstreamDraft.id && !upstreamDraft.apiKey.trim()) {
      message.warning("新建渠道必须填写 API Key，保存时会先校验连通性");
      return;
    }
    setUpstreamSaving(true);
    try {
      const saved = await modelPlazaAdminApi.saveUpstream({
        body: upstreamDraft,
      });
      setUpstreamModal(false);
      await Promise.all([loadUpstreams(), loadOverview()]);
      if (saved?.id) {
        message.success("渠道已保存，正在拉取该渠道的模型…");
        void openPull(saved.id);
      } else {
        message.success("渠道已保存");
      }
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setUpstreamSaving(false);
    }
  };

  const removeUpstream = async (row: MpUpstream) => {
    try {
      const result = await modelPlazaAdminApi.removeUpstream({
        params: { id: row.id },
      });
      if (!result) throw new Error("删除返回为空");
      message.success(`渠道已删除，同时移除 ${result.removedModels} 个模型`);
      await Promise.all([loadUpstreams(), loadCatalog(1), loadOverview()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "删除失败");
    }
  };

  const saveCatalog = async () => {
    if (!catalogDraft.modelKey.trim()) {
      message.warning("请填写模型标识（model）");
      return;
    }
    const tiers = rowsToTiers(tierRows);
    let components: MpComponent[] = [];
    try {
      const parsedComponents = JSON.parse(componentsText || "[]");
      if (!Array.isArray(parsedComponents)) throw new Error("必须是数组");
      components = parsedComponents as MpComponent[];
    } catch {
      message.warning("附加组件的 JSON 格式不正确，请检查后再保存");
      return;
    }
    setCatalogSaving(true);
    try {
      await modelPlazaAdminApi.saveCatalog({
        body: { ...catalogDraft, tiers, components },
      });
      message.success("模型已保存");
      setCatalogModal(false);
      await Promise.all([loadCatalog(catalogPage), loadOverview()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setCatalogSaving(false);
    }
  };

  const toggleCatalog = async (row: MpAdminModel, enabled: boolean) => {
    try {
      await modelPlazaAdminApi.toggleCatalog({
        params: { id: row.id },
        body: { enabled },
      });
      setCatalog((prev) =>
        prev.map((item) => (item.id === row.id ? { ...item, enabled } : item)),
      );
      void loadOverview();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const removeCatalog = async (row: MpAdminModel) => {
    try {
      await modelPlazaAdminApi.removeCatalog({ params: { id: row.id } });
      message.success("模型已从目录移除");
      await Promise.all([loadCatalog(catalogPage), loadOverview()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "删除失败");
    }
  };

  const openPull = (upstreamId?: number) => {
    const target = upstreamId ?? upstreamOptions[0]?.id ?? 0;
    setPullUpstreamId(target);
    setPullResult(null);
    setPullPicked({});
    setPullCategory("ALL");
    setPullEnabled(false);
    setPullModal(true);
    void runPull(target);
  };

  const runPull = async (upstreamId = pullUpstreamId) => {
    setPulling(true);
    try {
      const result = await modelPlazaAdminApi.pull({
        body: {
          upstreamId,
          baseUrl: "",
          apiKey: "",
          protocol: "openai",
        },
      });
      if (!result) throw new Error("拉取返回为空");
      setPullResult(result);
      setPullPicked(
        Object.fromEntries(result.added.map((item) => [item.modelKey, true])),
      );
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "拉取失败");
    } finally {
      setPulling(false);
    }
  };

  const runImport = async () => {
    if (!pullResult) return;
    const picked = pullResult.added.filter((item) => pullPicked[item.modelKey]);
    if (!picked.length) {
      message.warning("请勾选要导入的模型");
      return;
    }
    setImporting(true);
    try {
      const result = await modelPlazaAdminApi.importModels({
        body: {
          upstreamId: pullResult.upstreamId,
          models: picked.map((item) => ({
            modelKey: item.modelKey,
            displayName: item.displayName,
            billingUnit: item.billingUnit,
            category: item.category,
            inputRmbPrice: item.inputRmbPrice,
            outputRmbPrice: item.outputRmbPrice,
            callRmbPrice: item.callRmbPrice,
            cacheReadRmbPrice: item.cacheReadRmbPrice,
            cacheWriteRmbPrice: item.cacheWriteRmbPrice,
            minimumRmb: item.minimumRmb,
            tiers: item.tiers,
            components: item.components,
          })),
          enabled: pullEnabled,
          disableMissing: false,
        },
      });
      if (!result) throw new Error("导入返回为空");
      message.success(
        `导入完成：新增 ${result.created}、更新 ${result.updated}${
          result.disabled ? `、下架 ${result.disabled}` : ""
        }`,
      );
      setPullModal(false);
      await Promise.all([loadCatalog(1), loadOverview()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const seed = async () => {
    try {
      const result = await modelPlazaAdminApi.seed();
      if (!result) throw new Error("初始化返回为空");
      message.success(
        `已补齐内置清单：新增 ${result.created} 个，跳过 ${result.skipped} 个`,
      );
      await Promise.all([loadCatalog(1), loadOverview()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "初始化失败");
    }
  };

  const catalogColumns: ColumnsType<MpAdminModel> = [
    {
      title: "模型",
      dataIndex: "displayName",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <span>{value || row.modelKey}</span>
          <span className="text-12 muted mono">{row.modelKey}</span>
        </Space>
      ),
    },
    { title: "渠道", dataIndex: "provider", width: 120 },
    { title: "厂商", dataIndex: "vendor", width: 110 },
    {
      title: "分类",
      dataIndex: "category",
      width: 90,
      render: (value: string) => (
        <Tag color={CATEGORY_COLOR[value]}>
          {CATEGORY_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "计费单位",
      dataIndex: "billingUnit",
      width: 100,
      render: (value: MpBillingUnit) => (
        <Tag color={value === "token" ? "blue" : "purple"}>
          {UNIT_LABEL[value]}
        </Tag>
      ),
    },
    {
      title: "像素 / 分辨率规格价（元）",
      width: 240,
      render: (_: unknown, row) => tierSummary(row, false) || "—",
    },
    {
      title: "官方价（元）",
      width: 190,
      render: (_: unknown, row) =>
        row.billingUnit === "token"
          ? `¥${num(row.price.official.inputRmb)} / ¥${num(row.price.official.outputRmb)}`
          : `¥${num(row.price.official.unitRmb)} ${UNIT_SUFFIX[row.billingUnit]}`,
    },
    {
      title: "折后价（元）",
      width: 190,
      render: (_: unknown, row) =>
        row.billingUnit === "token"
          ? `¥${num(row.price.effective.inputRmb)} / ¥${num(row.price.effective.outputRmb)}`
          : `¥${num(row.price.effective.unitRmb)} ${UNIT_SUFFIX[row.billingUnit]}`,
    },
    {
      title: "折扣",
      width: 90,
      render: (_: unknown, row) =>
        row.price.discountRate < 0.9999 ? (
          <Tag color="red">{discountLabel(row.price.discountRate)}</Tag>
        ) : (
          <span className="text-12 muted">—</span>
        ),
    },
    {
      title: "积分价",
      width: 190,
      render: (_: unknown, row) =>
        row.billingUnit === "token"
          ? `${num(row.price.points.inputPoints, 2)} / ${num(row.price.points.outputPoints, 2)}`
          : `${num(row.price.points.unitPoints, 2)} ${UNIT_SUFFIX[row.billingUnit]}`,
    },
    {
      title: "能力",
      dataIndex: "endpoints",
      render: (value: string[]) => (
        <Space size={2} wrap>
          {value.map((item) => (
            <Tag key={item}>{ENDPOINT_LABEL[item] || item}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "近 7 天",
      width: 130,
      render: (_: unknown, row) =>
        row.usage7d.calls
          ? `${row.usage7d.calls} 次 · ${num(row.usage7d.pointsCost, 2)}`
          : "—",
    },
    {
      title: "上架",
      dataIndex: "enabled",
      width: 90,
      render: (value: boolean, row) => (
        <Switch
          size="small"
          checked={value}
          onChange={(next) => void toggleCatalog(row, next)}
        />
      ),
    },
    {
      title: "操作",
      width: 130,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EditOutlined aria-hidden />}
            onClick={() => {
              setCatalogDraft({
                id: row.id,
                upstreamId: row.upstreamId,
                provider: row.provider,
                modelKey: row.modelKey,
                upstreamModelKey: row.upstreamModelKey,
                displayName: row.displayName,
                vendor: row.vendor,
                description: row.description,
                billingUnit: row.billingUnit,
                category: row.category,
                inputRmbPrice: row.price.official.inputRmb,
                outputRmbPrice: row.price.official.outputRmb,
                callRmbPrice: row.price.official.unitRmb,
                cacheReadRmbPrice: row.price.official.cacheReadRmb,
                cacheWriteRmbPrice: row.price.official.cacheWriteRmb,
                minimumRmb: row.price.official.minimumRmb,
                tiers: row.price.tiers,
                components: row.price.components,
                discountRate: row.price.discountRate,
                contextWindow: row.contextWindow,
                maxOutputTokens: row.maxOutputTokens,
                modalities: row.modalities,
                endpoints: row.endpoints,
                tags: row.tags,
                enabled: row.enabled,
                sort: row.sort,
                remark: row.remark,
              });
              setTierRows(tiersToRows(row.price.tiers));
              setComponentsText(JSON.stringify(row.price.components, null, 2));
              setCatalogModal(true);
            }}
          />
          <Popconfirm
            title="从目录移除该模型？"
            onConfirm={() => void removeCatalog(row)}
          >
            <Button size="small" danger icon={<DeleteOutlined aria-hidden />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const usageColumns: ColumnsType<
    MpUsageLog & { userId?: string; userName?: string }
  > = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: "用户",
      width: 150,
      render: (_: unknown, row) => row.userName || row.userId || "—",
    },
    { title: "模型", dataIndex: "modelKey" },
    {
      title: "来源",
      dataIndex: "source",
      width: 100,
      render: (value: string) => SOURCE_LABEL[value] || value,
    },
    {
      title: "计费量",
      width: 140,
      render: (_: unknown, row) =>
        row.billingUnit === "token"
          ? row.totalTokens
            ? row.totalTokens.toLocaleString()
            : "—"
          : `${num(row.billingQuantity, 3)} ${UNIT_SUFFIX[row.billingUnit as MpBillingUnit]?.replace("/", "") ?? ""}`,
    },
    {
      title: "积分",
      dataIndex: "pointsCost",
      width: 100,
      render: (value: number) => num(value, 2),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string, row) =>
        value === "SUCCESS" ? (
          <Tag color="green">成功</Tag>
        ) : (
          <Tooltip title={row.message || "失败"}>
            <Tag color="red">失败</Tag>
          </Tooltip>
        ),
    },
  ];

  return (
    <>
      <StatGrid>
        <StatCard
          label="上架模型"
          value={
            overview
              ? `${overview.catalogEnabled} / ${overview.catalogTotal}`
              : "—"
          }
          hint="已上架 / 目录总数"
        />
        <StatCard
          label="上游渠道"
          value={overview ? overview.upstreamCount : "—"}
          hint={
            aipdd?.configured
              ? "AIPDD 平台 Key 已配置"
              : "AIPDD 平台 Key 未配置"
          }
        />
        <StatCard
          label="近 7 天调用"
          value={overview ? overview.calls7d : "—"}
          hint={overview ? `${overview.activeUsers7d} 位用户` : ""}
        />
        <StatCard
          label="近 7 天积分"
          value={overview ? num(overview.points7d, 2) : "—"}
          hint={overview ? `汇率 1 元 = ${num(overview.rate, 0)} 积分` : ""}
        />
      </StatGrid>

      <Panel title="模型广场维护">
        <PanelTabs
          value={tab}
          onChange={(key) => setTab(key as Tab)}
          items={[
            {
              key: "catalog",
              label: "模型目录",
              children: (
                <Panel
                  title="平台上架目录"
                  titleExtra={
                    <span className="text-12 muted">
                      在「上游通道」填好 baseURL
                      后从这里拉取勾选上架；未上架的模型不会出现在用户侧与
                      /v1/models
                    </span>
                  }
                  extra={
                    <Space wrap>
                      <Input.Search
                        allowClear
                        placeholder="搜索模型标识 / 名称"
                        style={{ width: 190 }}
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        onSearch={() => void loadCatalog(1)}
                      />
                      <Select
                        style={{ width: 130 }}
                        value={provider}
                        onChange={setProvider}
                        options={[
                          { value: "ALL", label: "全部渠道" },
                          ...providers.map((item) => ({
                            value: item,
                            label: item,
                          })),
                        ]}
                      />
                      <Select
                        style={{ width: 120 }}
                        value={categoryFilter}
                        onChange={setCategoryFilter}
                        options={[
                          { value: "ALL", label: "全部分类" },
                          ...CATEGORY_OPTIONS,
                        ]}
                      />
                      <Select
                        style={{ width: 110 }}
                        value={enabledFilter}
                        onChange={setEnabledFilter}
                        options={[
                          { value: "ALL", label: "全部状态" },
                          { value: "ON", label: "已上架" },
                          { value: "OFF", label: "未上架" },
                        ]}
                      />
                      <Button
                        type="primary"
                        icon={<CloudDownloadOutlined aria-hidden />}
                        onClick={() => openPull()}
                      >
                        从上游拉取并上架
                      </Button>
                      <Button
                        icon={<ThunderboltOutlined aria-hidden />}
                        onClick={() => void seed()}
                      >
                        补齐内置清单
                      </Button>
                    </Space>
                  }
                >
                  <Table
                    size="small"
                    rowKey="id"
                    loading={catalogLoading}
                    dataSource={catalog}
                    columns={catalogColumns}
                    scroll={{ x: 1280 }}
                    pagination={{
                      current: catalogPage,
                      total: catalogTotal,
                      pageSize: 20,
                      showSizeChanger: false,
                      onChange: (page) => void loadCatalog(page),
                    }}
                  />
                </Panel>
              ),
            },
            {
              key: "upstreams",
              label: "上游通道",
              children: (
                <Panel
                  title="上游通道"
                  titleExtra={
                    <span className="text-12 muted">
                      AIPDD 渠道使用「系统设置 → AIPDD 平台
                      Key」，无需在这里配置
                    </span>
                  }
                  extra={
                    <Space>
                      <Button
                        type="primary"
                        icon={<PlusOutlined aria-hidden />}
                        onClick={() => {
                          setUpstreamDraft({ ...EMPTY_UPSTREAM });
                          setUpstreamModal(true);
                        }}
                      >
                        新增渠道
                      </Button>
                    </Space>
                  }
                >
                  <Notice variant="info">
                    AIPDD 平台 Key：
                    {aipdd?.configured
                      ? `已配置（${aipdd.source === "db" ? "后台设置" : "环境变量"}，${aipdd.masked}）`
                      : "未配置，内置模型将不可用"}
                    {aipdd ? `；接口地址 ${aipdd.baseUrl}` : ""}
                  </Notice>
                  {upstreamLoading ? (
                    <Skeleton active paragraph={{ rows: 4 }} />
                  ) : null}
                  {!upstreamLoading && !upstreams.length ? (
                    <EmptyState
                      icon={
                        <ApiOutlined style={{ fontSize: 40 }} aria-hidden />
                      }
                      text="还没有自定义上游渠道；AIPDD 渠道无需配置。"
                    />
                  ) : null}
                  {!upstreamLoading && upstreams.length ? (
                    <Table
                      style={{ marginTop: 12 }}
                      size="small"
                      rowKey="id"
                      pagination={false}
                      dataSource={upstreams}
                      columns={[
                        { title: "名称", dataIndex: "name" },
                        { title: "渠道", dataIndex: "provider", width: 130 },
                        {
                          title: "接口地址",
                          dataIndex: "baseUrl",
                          render: (value: string) => (
                            <span className="mono text-12">{value}</span>
                          ),
                        },
                        {
                          title: "协议",
                          dataIndex: "protocol",
                          width: 100,
                          render: (value: string) =>
                            value === "anthropic" ? "Anthropic" : "OpenAI",
                        },
                        { title: "Key", dataIndex: "keyMasked", width: 150 },
                        { title: "模型数", dataIndex: "modelCount", width: 90 },
                        {
                          title: "启用",
                          dataIndex: "enabled",
                          width: 80,
                          render: (value: boolean) =>
                            value ? (
                              <Tag color="green">启用</Tag>
                            ) : (
                              <Tag>停用</Tag>
                            ),
                        },
                        {
                          title: "操作",
                          width: 140,
                          render: (_: unknown, row) => (
                            <Space size={4}>
                              <Button
                                size="small"
                                icon={<EditOutlined aria-hidden />}
                                onClick={() => {
                                  setUpstreamDraft({
                                    id: row.id,
                                    name: row.name,
                                    provider: row.provider,
                                    baseUrl: row.baseUrl,
                                    protocol: row.protocol,
                                    apiKey: "",
                                    enabled: row.enabled,
                                    remark: row.remark,
                                  });
                                  setUpstreamModal(true);
                                }}
                              />
                              <Popconfirm
                                title={`删除渠道「${row.name}」及其 ${row.modelCount} 个模型？`}
                                onConfirm={() => void removeUpstream(row)}
                              >
                                <Button
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined aria-hidden />}
                                />
                              </Popconfirm>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  ) : null}
                </Panel>
              ),
            },
            {
              key: "policy",
              label: "用户渠道",
              children: (
                <Panel
                  title="用户算力渠道"
                  titleExtra={
                    <span className="text-12 muted">
                      控制用户能否在「模型设置」里接入自建网关、各预设的兜底模型类型，以及各算力渠道的支持范围
                    </span>
                  }
                  extra={
                    <Button
                      type="primary"
                      loading={policySaving}
                      disabled={!policy || policyLoading}
                      onClick={() => void savePolicy()}
                    >
                      保存策略
                    </Button>
                  }
                >
                  {policyLoading && !policy ? (
                    <Skeleton active paragraph={{ rows: 6 }} />
                  ) : null}
                  {!policyLoading && !policy ? (
                    <EmptyState
                      text="渠道策略加载失败，请检查网络后重试。"
                      action={
                        <Button onClick={() => void loadPolicy()}>
                          重新加载
                        </Button>
                      }
                    />
                  ) : null}
                  {policy ? (
                    <div style={{ display: "grid", gap: 16 }}>
                      <Space size={12}>
                        <Switch
                          checked={policy.allowCustom}
                          onChange={(checked) =>
                            setPolicy((prev) =>
                              prev ? { ...prev, allowCustom: checked } : prev,
                            )
                          }
                        />
                        <span>允许用户新增自定义 OpenAI 兼容渠道</span>
                      </Space>
                      <Notice variant={policy.allowCustom ? "info" : "warn"}>
                        {policy.allowCustom
                          ? "关闭后用户不能再新增这类渠道，已存在的渠道仍可继续使用。"
                          : "已关闭新增：用户侧「模型设置」会隐藏新增入口，后端也会拒绝新建；已存在的渠道继续可用。"}
                      </Notice>
                      <div>
                        <div style={{ marginBottom: 8 }}>
                          <span>算力渠道支持范围</span>
                          <span className="text-12 muted" style={{ marginLeft: 8 }}>
                            默认全部支持；取消勾选的渠道用户不能新增、也选不到
                          </span>
                        </div>
                        <Space size={[16, 8]} wrap>
                          {CONTENT_CHANNEL_PROVIDERS.map((provider) => (
                            <Checkbox
                              key={provider}
                              checked={isProviderSupported(policy, provider)}
                              onChange={(event) =>
                                setPolicy((prev) => {
                                  if (!prev) return prev;
                                  const disabled = new Set(
                                    prev.disabledProviders,
                                  );
                                  if (event.target.checked) {
                                    disabled.delete(provider);
                                  } else {
                                    disabled.add(provider);
                                  }
                                  return {
                                    ...prev,
                                    disabledProviders: [
                                      ...CONTENT_CHANNEL_PROVIDERS,
                                    ].filter((item) => disabled.has(item)),
                                  };
                                })
                              }
                            >
                              {CONTENT_CHANNEL_PROVIDER_LABELS[provider]}
                            </Checkbox>
                          ))}
                        </Space>
                        <div className="text-12 muted" style={{ marginTop: 8 }}>
                          关闭 AIPDD 只停用它的「算力」（模型设置 / 模型广场）；
                          其它功能（业务服务等）用同一把 AIPDD API Key 仍照常可用。
                        </div>
                      </div>
                      <Table
                        size="small"
                        rowKey="preset"
                        pagination={false}
                        dataSource={CONTENT_CHANNEL_PRESETS.map((preset) => ({
                          preset,
                          type:
                            policy.presetTypes[preset] ||
                            CONTENT_PRESET_DEFAULT_MEDIA_TYPES[preset],
                        }))}
                        columns={[
                          {
                            title: "渠道预设",
                            dataIndex: "preset",
                            width: 260,
                            render: (value: ContentChannelPreset) => (
                              <Space size={6}>
                                <span>
                                  {CONTENT_CHANNEL_PRESET_LABELS[value]}
                                </span>
                                <span className="mono text-12 muted">
                                  {value}
                                </span>
                              </Space>
                            ),
                          },
                          {
                            title: "兜底模型类型",
                            dataIndex: "type",
                            render: (
                              value: ContentMediaType,
                              row: { preset: ContentChannelPreset },
                            ) => (
                              <Select
                                style={{ width: 220 }}
                                value={value}
                                options={MEDIA_TYPE_OPTIONS}
                                onChange={(next: ContentMediaType) =>
                                  setPolicy((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          presetTypes: {
                                            ...prev.presetTypes,
                                            [row.preset]: next,
                                          },
                                        }
                                      : prev,
                                  )
                                }
                              />
                            ),
                          },
                        ]}
                      />
                      <div className="text-12 muted">
                        兜底只在用户渠道的上游 /models
                        没有声明模型类型时生效；选择「视觉理解」的模型会同时出现在文本与视觉理解两个槽位。
                      </div>
                    </div>
                  ) : null}
                </Panel>
              ),
            },
            {
              key: "platform",
              label: "默认模型",
              children: (
                <Panel
                  title="平台默认模型"
                  titleExtra={
                    <span className="text-12 muted">
                      充值到账的用户，在「模型设置」里没有单独配置的能力会自动继承这里的模型
                    </span>
                  }
                  extra={
                    <Space>
                      <Space size={6}>
                        <Switch
                          checked={platformDraft.enabled}
                          loading={platformLoading}
                          onChange={(checked) =>
                            setPlatformDraft((prev) => ({
                              ...prev,
                              enabled: checked,
                            }))
                          }
                        />
                        <span className="text-12">
                          {platformDraft.enabled ? "已开启" : "已关闭"}
                        </span>
                      </Space>
                      <Button
                        type="primary"
                        loading={platformSaving}
                        disabled={platformLoading || !platformDefaults}
                        onClick={() => void savePlatformDefaults()}
                      >
                        保存设置
                      </Button>
                    </Space>
                  }
                >
                  {platformLoading && !platformDefaults ? (
                    <Skeleton active paragraph={{ rows: 6 }} />
                  ) : null}
                  {!platformLoading && !platformDefaults ? (
                    <EmptyState
                      text="平台默认模型加载失败，请检查网络后重试。"
                      action={
                        <Button onClick={() => void loadPlatformDefaults()}>
                          重新加载
                        </Button>
                      }
                    />
                  ) : null}
                  {platformDefaults ? (
                    <div style={{ display: "grid", gap: 16 }}>
                      <Notice variant={platformDraft.enabled ? "info" : "warn"}>
                        {platformDraft.enabled
                          ? "已开启继承：已支付充值单的用户调用未单独配置的能力时，按模型广场目录价从本人积分扣费。"
                          : "未开启：没有单独配置模型的用户仍需自行在「模型设置」里接入渠道，无法使用平台默认模型。"}
                      </Notice>
                      <Table
                        size="small"
                        rowKey="capability"
                        pagination={false}
                        dataSource={platformDefaults.slots}
                        columns={[
                          {
                            title: "能力",
                            dataIndex: "label",
                            width: 150,
                            render: (value: string, row) => (
                              <Space size={6}>
                                <span>{value}</span>
                                <span className="mono text-12 muted">
                                  {row.capability}
                                </span>
                              </Space>
                            ),
                          },
                          {
                            title: "平台默认模型",
                            render: (_: unknown, row) => (
                              <Space size={8} wrap>
                                <Select
                                  style={{ width: 320 }}
                                  allowClear
                                  showSearch
                                  optionFilterProp="label"
                                  placeholder={
                                    row.candidates.length
                                      ? "选择该能力的默认模型"
                                      : "目录里暂无该能力的可用模型"
                                  }
                                  value={platformDraft.models[row.capability]}
                                  options={row.candidates.map((item) => ({
                                    value: item.id,
                                    label: `${item.displayName} · ${item.priceNote}`,
                                    disabled: !item.available,
                                    title: item.unavailableReason,
                                  }))}
                                  onChange={(value?: number) =>
                                    setPlatformDraft((prev) => {
                                      const models = { ...prev.models };
                                      if (value) models[row.capability] = value;
                                      else delete models[row.capability];
                                      return { ...prev, models };
                                    })
                                  }
                                />
                                {row.catalogId > 0 ? (
                                  row.available ? (
                                    <Tag color="green">生效中</Tag>
                                  ) : (
                                    <Tag color="red">
                                      {row.unavailableReason || "不可用"}
                                    </Tag>
                                  )
                                ) : (
                                  <Tag>未配置</Tag>
                                )}
                              </Space>
                            ),
                          },
                          {
                            title: "当前价格",
                            dataIndex: "priceNote",
                            width: 230,
                            render: (value: string) => (
                              <span className="text-12">{value || "—"}</span>
                            ),
                          },
                        ]}
                      />
                      <div>
                        <div
                          className="text-12 muted"
                          style={{ marginBottom: 8 }}
                        >
                          消费限额（单位：积分；填 0
                          表示不限，只统计平台默认模型通道）
                        </div>
                        <Space size={24} wrap>
                          {(
                            [
                              ["perCallPoints", "单次调用最多扣"],
                              ["dailyPoints", "每日上限"],
                              ["monthlyPoints", "每月上限"],
                            ] as const
                          ).map(([key, label]) => (
                            <Space key={key} size={8}>
                              <span className="text-12">{label}</span>
                              <InputNumber
                                min={0}
                                precision={0}
                                style={{ width: 120 }}
                                value={platformDraft.limits[key]}
                                onChange={(value) =>
                                  setPlatformDraft((prev) => ({
                                    ...prev,
                                    limits: {
                                      ...prev.limits,
                                      [key]: Number(value) || 0,
                                    },
                                  }))
                                }
                              />
                            </Space>
                          ))}
                        </Space>
                      </div>
                      <div>
                        <div
                          className="text-12 muted"
                          style={{ marginBottom: 8 }}
                        >
                          变更记录
                        </div>
                        {platformDefaults.history.length ? (
                          <Table
                            size="small"
                            rowKey="at"
                            pagination={false}
                            dataSource={platformDefaults.history}
                            columns={[
                              {
                                title: "时间",
                                dataIndex: "at",
                                width: 180,
                                render: (value: string) =>
                                  value
                                    ? new Date(value).toLocaleString()
                                    : "—",
                              },
                              { title: "操作人", dataIndex: "by", width: 180 },
                              { title: "变更内容", dataIndex: "summary" },
                            ]}
                          />
                        ) : (
                          <div className="text-12 muted">还没有变更记录。</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </Panel>
              ),
            },
            {
              key: "usage",
              label: "全平台用量",
              children: (
                <Panel
                  title="调用台账"
                  titleExtra={
                    <span className="text-12 muted">
                      站内试用与对外 API 同口径记录
                    </span>
                  }
                  extra={
                    <Space>
                      <Select
                        style={{ width: 120 }}
                        value={usageSource}
                        onChange={setUsageSource}
                        options={[
                          { value: "ALL", label: "全部来源" },
                          { value: "IN_APP", label: "站内试用" },
                          { value: "API", label: "对外 API" },
                        ]}
                      />
                    </Space>
                  }
                >
                  <Table
                    size="small"
                    rowKey="id"
                    loading={usageLoading}
                    dataSource={usage}
                    columns={usageColumns}
                    scroll={{ x: 1000 }}
                    pagination={{
                      current: usagePage,
                      total: usageTotal,
                      pageSize: 20,
                      showSizeChanger: false,
                      onChange: (page) => void loadUsage(page),
                    }}
                  />
                </Panel>
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        open={upstreamModal}
        title={upstreamDraft.id ? "编辑上游渠道" : "新增上游渠道"}
        onCancel={() => setUpstreamModal(false)}
        onOk={() => void saveUpstream()}
        confirmLoading={upstreamSaving}
        okText="保存并校验"
        width={620}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Notice variant="info">
            保存前会先用 Key 拉一次上游 /models
            做连通性校验；校验不通过不会入库。
          </Notice>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              渠道名称
            </div>
            <Input
              value={upstreamDraft.name}
              maxLength={64}
              placeholder="例如：自建 OpenAI 兼容网关"
              onChange={(event) =>
                setUpstreamDraft((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              渠道标识
            </div>
            <Input
              value={upstreamDraft.provider}
              maxLength={24}
              placeholder="LocalAPI / OpenAI / 火山引擎 …"
              onChange={(event) =>
                setUpstreamDraft((prev) => ({
                  ...prev,
                  provider: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              接口地址（不含 /v1）
            </div>
            <Input
              value={upstreamDraft.baseUrl}
              className="mono"
              placeholder="https://api.example.com/v1"
              onChange={(event) =>
                setUpstreamDraft((prev) => ({
                  ...prev,
                  baseUrl: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              协议
            </div>
            <Select
              style={{ width: "100%" }}
              value={upstreamDraft.protocol}
              onChange={(value) =>
                setUpstreamDraft((prev) => ({ ...prev, protocol: value }))
              }
              options={[
                {
                  value: "openai",
                  label: "OpenAI 兼容（/chat/completions、/models）",
                },
                { value: "anthropic", label: "Anthropic 原生（/messages）" },
              ]}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              API Key{upstreamDraft.id ? "（留空＝沿用已保存的 Key）" : ""}
            </div>
            <Input.Password
              value={upstreamDraft.apiKey}
              placeholder={upstreamDraft.id ? "已保存的 Key 不会回显" : "必填"}
              onChange={(event) =>
                setUpstreamDraft((prev) => ({
                  ...prev,
                  apiKey: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              备注
            </div>
            <Input
              value={upstreamDraft.remark}
              maxLength={200}
              onChange={(event) =>
                setUpstreamDraft((prev) => ({
                  ...prev,
                  remark: event.target.value,
                }))
              }
            />
          </div>
          <Space>
            <Switch
              checked={upstreamDraft.enabled}
              onChange={(value) =>
                setUpstreamDraft((prev) => ({ ...prev, enabled: value }))
              }
            />
            <span>启用该渠道</span>
          </Space>
        </Space>
      </Modal>

      <Modal
        open={catalogModal}
        title="调整模型定价"
        onCancel={() => setCatalogModal(false)}
        onOk={() => void saveCatalog()}
        confirmLoading={catalogSaving}
        okText="保存"
        width={760}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <div className="form-2col">
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                所属渠道
              </div>
              <Select
                style={{ width: "100%" }}
                value={catalogDraft.upstreamId}
                onChange={(value) => {
                  const target = upstreamOptions.find(
                    (item) => item.id === value,
                  );
                  setCatalogDraft((prev) => ({
                    ...prev,
                    upstreamId: value,
                    provider: target?.provider || prev.provider,
                  }));
                }}
                options={upstreamOptions.map((item) => ({
                  value: item.id,
                  label: `${item.name}（${item.provider}）`,
                }))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                渠道标识
              </div>
              <Input
                value={catalogDraft.provider}
                maxLength={24}
                onChange={(event) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    provider: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                模型标识（对外 model）
              </div>
              <Input
                value={catalogDraft.modelKey}
                className="mono"
                maxLength={128}
                placeholder="ap-deepseek-v4-flash"
                onChange={(event) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    modelKey: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                上游模型标识（留空＝同上）
              </div>
              <Input
                value={catalogDraft.upstreamModelKey}
                className="mono"
                maxLength={128}
                onChange={(event) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    upstreamModelKey: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                展示名称
              </div>
              <Input
                value={catalogDraft.displayName}
                maxLength={128}
                onChange={(event) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    displayName: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                厂商
              </div>
              <Input
                value={catalogDraft.vendor}
                maxLength={64}
                onChange={(event) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    vendor: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                能力分类（用于用户侧与列表筛选）
              </div>
              <Select
                style={{ width: "100%" }}
                value={catalogDraft.category}
                onChange={(value) =>
                  setCatalogDraft((prev) => ({ ...prev, category: value }))
                }
                options={CATEGORY_OPTIONS}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                计费单位（必须与上游一致）
              </div>
              <Select
                style={{ width: "100%" }}
                value={catalogDraft.billingUnit}
                onChange={(value) =>
                  setCatalogDraft((prev) => ({ ...prev, billingUnit: value }))
                }
                options={[
                  {
                    value: "token",
                    label: "Token（每百万 tokens，入/出分别计价）",
                  },
                  { value: "image", label: "按张（图像）" },
                  { value: "second", label: "按秒（视频 / 语音识别）" },
                  { value: "call", label: "按次（上游确实按次计费时）" },
                ]}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                排序（越大越靠前）
              </div>
              <InputNumber
                style={{ width: "100%" }}
                value={catalogDraft.sort}
                onChange={(value) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    sort: Number(value ?? 0),
                  }))
                }
              />
            </div>
          </div>

          <div className="form-2col">
            {catalogDraft.billingUnit === "token" ? (
              <>
                <div>
                  <div className="text-12 muted" style={{ marginBottom: 4 }}>
                    官方输入价（元 / 百万 tokens）
                  </div>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    value={catalogDraft.inputRmbPrice}
                    onChange={(value) =>
                      setCatalogDraft((prev) => ({
                        ...prev,
                        inputRmbPrice: Number(value ?? 0),
                      }))
                    }
                  />
                </div>
                <div>
                  <div className="text-12 muted" style={{ marginBottom: 4 }}>
                    官方输出价（元 / 百万 tokens）
                  </div>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    value={catalogDraft.outputRmbPrice}
                    onChange={(value) =>
                      setCatalogDraft((prev) => ({
                        ...prev,
                        outputRmbPrice: Number(value ?? 0),
                      }))
                    }
                  />
                </div>
                <div>
                  <div className="text-12 muted" style={{ marginBottom: 4 }}>
                    缓存读价（元 / 百万 tokens）
                  </div>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    value={catalogDraft.cacheReadRmbPrice}
                    onChange={(value) =>
                      setCatalogDraft((prev) => ({
                        ...prev,
                        cacheReadRmbPrice: Number(value ?? 0),
                      }))
                    }
                  />
                </div>
                <div>
                  <div className="text-12 muted" style={{ marginBottom: 4 }}>
                    缓存写价（元 / 百万 tokens）
                  </div>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    value={catalogDraft.cacheWriteRmbPrice}
                    onChange={(value) =>
                      setCatalogDraft((prev) => ({
                        ...prev,
                        cacheWriteRmbPrice: Number(value ?? 0),
                      }))
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="text-12 muted" style={{ marginBottom: 4 }}>
                    官方单价（元 {UNIT_SUFFIX[catalogDraft.billingUnit]}）
                  </div>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.001}
                    value={catalogDraft.callRmbPrice}
                    onChange={(value) =>
                      setCatalogDraft((prev) => ({
                        ...prev,
                        callRmbPrice: Number(value ?? 0),
                      }))
                    }
                  />
                </div>
                <div>
                  <div className="text-12 muted" style={{ marginBottom: 4 }}>
                    最低收费（元 / 次调用，0＝不设下限）
                  </div>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.001}
                    value={catalogDraft.minimumRmb}
                    onChange={(value) =>
                      setCatalogDraft((prev) => ({
                        ...prev,
                        minimumRmb: Number(value ?? 0),
                      }))
                    }
                  />
                </div>
              </>
            )}
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                平台折扣（0~1，1＝不打折；只允许下调）
              </div>
              <InputNumber
                style={{ width: "100%" }}
                min={0.01}
                max={1}
                step={0.01}
                value={catalogDraft.discountRate}
                onChange={(value) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    discountRate: Number(value ?? 1),
                  }))
                }
              />
              <div className="text-12 muted" style={{ marginTop: 4 }}>
                {catalogDraft.discountRate < 0.9999
                  ? `用户看到 ${discountLabel(catalogDraft.discountRate)}，按折后价扣费`
                  : "当前无折扣"}
              </div>
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                上下文窗口（tokens）
              </div>
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                value={catalogDraft.contextWindow}
                onChange={(value) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    contextWindow: Number(value ?? 0),
                  }))
                }
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                最大输出（tokens）
              </div>
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                value={catalogDraft.maxOutputTokens}
                onChange={(value) =>
                  setCatalogDraft((prev) => ({
                    ...prev,
                    maxOutputTokens: Number(value ?? 0),
                  }))
                }
              />
            </div>
          </div>

          <Notice variant="info">
            积分价 = 折后人民币价 × 系统汇率（当前 1 元 = {num(rate, 0)}{" "}
            积分），由系统设置统一决定， 此处不提供积分覆写。
          </Notice>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              规格分档价（图片按像素尺寸 /
              清晰度，视频按分辨率；不填＝用上面的基础单价）
            </div>
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              {tierRows.map((row, index) => (
                <Space key={index} align="baseline" wrap>
                  <Select
                    style={{ width: 150 }}
                    value={row.key}
                    onChange={(value) =>
                      setTierRows((prev) =>
                        prev.map((item, i) =>
                          i === index ? { ...item, key: value } : item,
                        ),
                      )
                    }
                    options={TIER_DIMENSIONS.map((item) => ({
                      value: item.value,
                      label: item.label,
                    }))}
                  />
                  <Input
                    style={{ width: 150 }}
                    className="mono"
                    value={row.value}
                    placeholder={
                      TIER_DIMENSIONS.find((item) => item.value === row.key)
                        ?.placeholder
                    }
                    onChange={(event) =>
                      setTierRows((prev) =>
                        prev.map((item, i) =>
                          i === index
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <InputNumber
                    style={{ width: 130 }}
                    min={0}
                    step={0.001}
                    suffix="元"
                    value={row.unitRmb}
                    onChange={(value) =>
                      setTierRows((prev) =>
                        prev.map((item, i) =>
                          i === index
                            ? { ...item, unitRmb: Number(value ?? 0) }
                            : item,
                        ),
                      )
                    }
                  />
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined aria-hidden />}
                    onClick={() =>
                      setTierRows((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                </Space>
              ))}
              <Button
                size="small"
                icon={<PlusOutlined aria-hidden />}
                onClick={() =>
                  setTierRows((prev) => [
                    ...prev,
                    {
                      key:
                        catalogDraft.billingUnit === "second"
                          ? "video_resolution"
                          : "size",
                      value: "",
                      unitRmb: catalogDraft.callRmbPrice,
                    },
                  ])
                }
              >
                添加规格
              </Button>
            </Space>
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              附加计费组件（JSON：如图像编辑参考图超出量）
            </div>
            <Input.TextArea
              rows={3}
              className="mono"
              value={componentsText}
              onChange={(event) => setComponentsText(event.target.value)}
              placeholder='[{"code":"reference_image_excess","freeUnits":0,"unit":"image","unitRmb":0.05,"tiers":[]}]'
            />
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              可用端点
            </div>
            <Select
              mode="multiple"
              style={{ width: "100%" }}
              value={catalogDraft.endpoints}
              onChange={(value) =>
                setCatalogDraft((prev) => ({ ...prev, endpoints: value }))
              }
              options={ENDPOINT_OPTIONS.map((item) => ({
                value: item,
                label: `${ENDPOINT_LABEL[item]}（${item}）`,
              }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              标签
            </div>
            <Select
              mode="tags"
              style={{ width: "100%" }}
              value={catalogDraft.tags}
              onChange={(value) =>
                setCatalogDraft((prev) => ({ ...prev, tags: value }))
              }
              placeholder="输入后回车添加，例如：低延迟"
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              说明
            </div>
            <Input.TextArea
              rows={2}
              maxLength={500}
              value={catalogDraft.description}
              onChange={(event) =>
                setCatalogDraft((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <Space>
            <Switch
              checked={catalogDraft.enabled}
              onChange={(value) =>
                setCatalogDraft((prev) => ({ ...prev, enabled: value }))
              }
            />
            <span>保存后立即上架</span>
          </Space>
        </Space>
      </Modal>

      <Modal
        open={pullModal}
        title="从上游拉取模型"
        onCancel={() => setPullModal(false)}
        footer={[
          <Button key="close" onClick={() => setPullModal(false)}>
            关闭
          </Button>,
          <Button key="pull" loading={pulling} onClick={() => void runPull()}>
            拉取差异
          </Button>,
          <Button
            key="import"
            type="primary"
            loading={importing}
            disabled={!pullResult}
            onClick={() => void runImport()}
          >
            导入勾选项
          </Button>,
        ]}
        width={860}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap>
            <span className="text-12 muted">上游渠道</span>
            <Select
              style={{ width: 280 }}
              value={pullUpstreamId}
              onChange={(value) => {
                setPullUpstreamId(value);
                void runPull(value);
              }}
              options={upstreamOptions.map((item) => ({
                value: item.id,
                label: `${item.name}（${item.provider}）`,
              }))}
            />
            <Select
              style={{ width: 120 }}
              value={pullCategory}
              onChange={setPullCategory}
              options={[
                { value: "ALL", label: "全部分类" },
                ...CATEGORY_OPTIONS,
              ]}
            />
            <Checkbox
              checked={pullEnabled}
              onChange={(event) => setPullEnabled(event.target.checked)}
            >
              导入后立即上架
            </Checkbox>
          </Space>
          {pullResult ? (
            <>
              <Notice variant="info">
                {pullResult.provider} · {pullResult.baseUrl}：新增{" "}
                {pullResult.added.length}、 已存在 {pullResult.existing.length}
                、上游已移除 {pullResult.removed.length}
              </Notice>
              {pullResult.added.length ? (
                <Table
                  size="small"
                  rowKey="modelKey"
                  pagination={false}
                  dataSource={pullResult.added.filter(
                    (item) =>
                      pullCategory === "ALL" || item.category === pullCategory,
                  )}
                  scroll={{ y: 260 }}
                  columns={[
                    {
                      title: "导入",
                      width: 60,
                      render: (_: unknown, row: MpDiscoveredModel) => (
                        <Checkbox
                          checked={Boolean(pullPicked[row.modelKey])}
                          onChange={(event) =>
                            setPullPicked((prev) => ({
                              ...prev,
                              [row.modelKey]: event.target.checked,
                            }))
                          }
                        />
                      ),
                    },
                    { title: "模型标识", dataIndex: "modelKey" },
                    { title: "名称", dataIndex: "displayName" },
                    {
                      title: "分类",
                      dataIndex: "category",
                      width: 90,
                      render: (value: string) => (
                        <Tag color={CATEGORY_COLOR[value]}>
                          {CATEGORY_LABEL[value] || value}
                        </Tag>
                      ),
                    },
                    {
                      title: "计费单位",
                      dataIndex: "billingUnit",
                      width: 100,
                      render: (value: MpBillingUnit) => UNIT_LABEL[value],
                    },
                    {
                      title: "上游官方价",
                      width: 220,
                      render: (_: unknown, row: MpDiscoveredModel) =>
                        row.billingUnit === "token"
                          ? `¥${num(row.inputRmbPrice)} / ¥${num(row.outputRmbPrice)} · 每百万 tokens`
                          : `¥${num(row.callRmbPrice)} ${UNIT_SUFFIX[row.billingUnit]}${
                              row.minimumRmb > 0
                                ? `（最低 ¥${num(row.minimumRmb)}）`
                                : ""
                            }`,
                    },
                    {
                      title: "能力 / 规格",
                      render: (_: unknown, row: MpDiscoveredModel) => (
                        <Space size={2} wrap>
                          {row.endpoints.map((item) => (
                            <Tag key={item}>{ENDPOINT_LABEL[item] || item}</Tag>
                          ))}
                        </Space>
                      ),
                    },
                  ]}
                />
              ) : (
                <EmptyState text="上游没有新增模型；已在目录里的模型可在「模型目录」直接编辑。" />
              )}
              {pullResult.existing.length ? (
                <div className="text-12 muted">
                  已存在：
                  {pullResult.existing.map((item) => item.modelKey).join("、")}
                </div>
              ) : null}
              {pullResult.removed.length ? (
                <div className="text-12 muted">
                  上游已不再提供（不会自动下架）：
                  {pullResult.removed.map((item) => item.modelKey).join("、")}
                </div>
              ) : null}
            </>
          ) : (
            <Notice variant="info">
              正在按新增 / 已存在 /
              已移除三桶比对上游模型；切换渠道会自动重新拉取，勾选后即可导入上架。
            </Notice>
          )}
        </Space>
      </Modal>
    </>
  );
}
