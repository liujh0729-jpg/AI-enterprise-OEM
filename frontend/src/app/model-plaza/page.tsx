"use client";

import {
  ApiOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MpBillingUnit,
  MpCatalog,
  MpConnection,
  MpModel,
  MpSource,
  MpTrialResult,
  MpUsageLog,
  MpUsageSummary,
} from "@enterprise/contracts";
import { modelPlazaApi } from "@/api/model-plaza";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  PillTabs,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { CallGuideDrawer } from "./_components/call-guide-drawer";
import {
  UNIT_LABEL,
  UNIT_SHORT,
  UNIT_TAG_COLOR,
  cacheShort,
  discountLabel,
  hasDiscount,
  money,
  points,
  pointsText,
  priceCells,
  priceText,
  tierChips,
} from "@/lib/model-plaza-pricing";

type Tab = "catalog" | "usage" | "connect";

const TAB_ITEMS = [
  { key: "catalog", label: "模型目录" },
  { key: "usage", label: "我的用量" },
  { key: "connect", label: "接入方式" },
];

const SOURCE_LABEL: Record<MpSource, string> = { IN_APP: "站内试用", API: "对外 API" };
const ENDPOINT_LABEL: Record<string, string> = {
  "/chat/completions": "对话",
  "/embeddings": "向量",
  "/images/generations": "文生图",
  "/images/edits": "图像编辑",
  "/audio/speech": "语音合成",
  "/audio/transcriptions": "语音识别",
  "/videos": "视频",
};
const CATEGORY_LABEL: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  embedding: "向量",
  other: "其他",
};
const CATEGORY_COLOR: Record<string, string> = {
  text: "blue",
  image: "green",
  video: "purple",
  audio: "orange",
  embedding: "cyan",
};

export default function ModelPlazaPage() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<Tab>("catalog");
  const [catalog, setCatalog] = useState<MpCatalog | null>(null);
  const [summary, setSummary] = useState<MpUsageSummary | null>(null);
  const [connection, setConnection] = useState<MpConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [keyword, setKeyword] = useState("");
  const [provider, setProvider] = useState("ALL");
  const [vendor, setVendor] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [billingUnit, setBillingUnit] = useState("ALL");
  const [endpointFilter, setEndpointFilter] = useState("ALL");

  const [logs, setLogs] = useState<MpUsageLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [source, setSource] = useState<"ALL" | MpSource>("ALL");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // 后端未配置站点域名时只返回相对路径 /v1，这里补成当前访问域名，示例才可直接复制运行
  const baseUrl = connection
    ? /^https?:\/\//i.test(connection.baseUrl)
      ? connection.baseUrl
      : `${origin}${connection.baseUrl}`
    : "";

  const [trial, setTrial] = useState<MpModel | null>(null);
  const [guideModel, setGuideModel] = useState<MpModel | null>(null);
  const [trialForm, setTrialForm] = useState({
    prompt: "用一句话介绍一下你自己。",
    system: "",
    temperature: 0.7,
    maxTokens: 512,
  });
  const [trialRunning, setTrialRunning] = useState(false);
  const [trialResult, setTrialResult] = useState<MpTrialResult | null>(null);
  const [trialError, setTrialError] = useState("");

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextCatalog, nextSummary, nextConnection] = await Promise.all([
        modelPlazaApi.catalog(),
        modelPlazaApi.usageSummary({ query: { days: 7 } }),
        modelPlazaApi.connection(),
      ]);
      setCatalog(nextCatalog);
      setSummary(nextSummary);
      setConnection(nextConnection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型广场加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(
    async (page = 1) => {
      setLogsLoading(true);
      try {
        const result = await modelPlazaApi.usage({
          query: {
            page,
            pageSize: 20,
            source,
            modelKey: "",
            from: "",
            to: "",
          },
        });
        if (!result) throw new Error("用量返回为空");
        setLogs(result.list);
        setLogsTotal(result.total);
        setLogsPage(result.page);
        setSummary(result.summary);
      } catch (cause) {
        message.error(cause instanceof Error ? cause.message : "用量加载失败");
      } finally {
        setLogsLoading(false);
      }
    },
    [message, source],
  );

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (tab === "usage") void loadLogs(1);
  }, [tab, loadLogs]);

  const models = useMemo(() => {
    const list = catalog?.list ?? [];
    const text = keyword.trim().toLowerCase();
    return list.filter((model) => {
      if (provider !== "ALL" && model.provider !== provider) return false;
      if (vendor !== "ALL" && model.vendor !== vendor) return false;
      if (category !== "ALL" && model.category !== category) return false;
      if (billingUnit !== "ALL" && model.billingUnit !== billingUnit) return false;
      if (endpointFilter !== "ALL" && !model.endpoints.includes(endpointFilter))
        return false;
      if (!text) return true;
      return [model.displayName, model.modelKey, model.vendor, ...model.tags]
        .join(" ")
        .toLowerCase()
        .includes(text);
    });
  }, [billingUnit, catalog, category, endpointFilter, keyword, provider, vendor]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const model of catalog?.list ?? []) {
      counts[model.category] = (counts[model.category] ?? 0) + 1;
    }
    return counts;
  }, [catalog]);

  const filtersActive =
    Boolean(keyword.trim()) ||
    provider !== "ALL" ||
    vendor !== "ALL" ||
    category !== "ALL" ||
    billingUnit !== "ALL" ||
    endpointFilter !== "ALL";

  const resetFilters = () => {
    setKeyword("");
    setProvider("ALL");
    setVendor("ALL");
    setCategory("ALL");
    setBillingUnit("ALL");
    setEndpointFilter("ALL");
  };

  const openTrial = (model: MpModel) => {
    setTrial(model);
    setTrialResult(null);
    setTrialError("");
  };

  const runTrial = async () => {
    if (!trial) return;
    if (!trialForm.prompt.trim()) {
      message.warning("请填写试用的提问内容");
      return;
    }
    setTrialRunning(true);
    setTrialError("");
    try {
      const result = await modelPlazaApi.trial({
        body: {
          modelId: trial.id,
          prompt: trialForm.prompt,
          system: trialForm.system,
          temperature: trialForm.temperature,
          maxTokens: trialForm.maxTokens,
        },
      });
      if (!result) throw new Error("试用返回为空");
      setTrialResult(result);
      setCatalog((prev) =>
        prev ? { ...prev, balance: result.balance } : prev,
      );
      message.success(`试用完成，本次消耗 ${points(result.pointsCost)} 积分`);
    } catch (cause) {
      setTrialError(cause instanceof Error ? cause.message : "试用失败");
    } finally {
      setTrialRunning(false);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    } catch {
      message.error("复制失败，请手动选择复制");
    }
  };

  const logColumns: ColumnsType<MpUsageLog> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: "模型",
      dataIndex: "displayName",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <span>{value}</span>
          <span className="text-12 muted mono">{row.modelKey}</span>
        </Space>
      ),
    },
    { title: "来源", dataIndex: "source", width: 100, render: (v: MpSource) => SOURCE_LABEL[v] },
    {
      title: "端点",
      dataIndex: "endpoint",
      width: 100,
      render: (v: string) => ENDPOINT_LABEL[v] || v,
    },
    {
      title: "计费量",
      width: 150,
      render: (_: unknown, row) =>
        row.billingUnit === "token"
          ? row.totalTokens
            ? `${row.promptTokens} / ${row.completionTokens}`
            : "—"
          : `${points(row.billingQuantity, 3)} ${UNIT_SHORT[row.billingUnit as MpBillingUnit] ?? ""}`,
    },
    {
      title: "积分",
      dataIndex: "pointsCost",
      width: 110,
      render: (v: number) => points(v),
    },
    {
      title: "耗时",
      dataIndex: "elapsedMs",
      width: 90,
      render: (v: number) => `${v} ms`,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (v: string, row) =>
        v === "SUCCESS" ? (
          <Tag color="green">成功</Tag>
        ) : (
          <Tooltip title={row.message || "调用失败"}>
            <Tag color="red">失败</Tag>
          </Tooltip>
        ),
    },
  ];

  return (
    <>
      <PageHero
        title="模型广场"
        desc="平台统一上架的可用模型，计费单位与上游一致：对话/向量按 Token、图像按张、视频与语音识别按秒、语音合成按次；可在线试用，也可用平台 API Key 接入。"
        tabs={TAB_ITEMS}
        activeTab={tab}
        onTabChange={(key) => setTab(key as Tab)}
      />

      {error ? <Notice variant="error">{error}</Notice> : null}

      {tab === "catalog" ? (
        <StatGrid>
          <StatCard
            label="积分余额"
            value={catalog ? points(catalog.balance) : "—"}
            hint={<Link href="/points">去积分中心充值</Link>}
          />
          <StatCard
            label="汇率"
            value={catalog ? `1 元 = ${points(catalog.rate, 0)} 积分` : "—"}
            hint="平台统一口径，管理员可在积分设置调整"
          />
          <StatCard
            label="近 7 天调用"
            value={summary ? summary.calls : "—"}
            hint={summary ? `成功 ${summary.successCalls} 次` : ""}
          />
          <StatCard
            label="近 7 天消费"
            value={summary ? `${points(summary.pointsCost)} 积分` : "—"}
            hint={summary ? `折合 ${money(summary.rmbCost)}` : ""}
          />
        </StatGrid>
      ) : null}

      {tab === "catalog" ? (
        <Panel
          title="模型目录"
          titleExtra={
            catalog ? (
              <span className="text-12 muted">共 {catalog.total} 个模型</span>
            ) : null
          }
        >
          <div className="mp-filters">
            <PillTabs
              size="small"
              variant="soft"
              value={category}
              onChange={setCategory}
              items={[
                { key: "ALL", label: "全部", count: catalog?.list.length ?? 0 },
                ...Object.entries(CATEGORY_LABEL)
                  .filter(([key]) => categoryCounts[key])
                  .map(([key, label]) => ({
                    key,
                    label,
                    count: categoryCounts[key],
                  })),
              ]}
            />
            <div className="mp-filter-row">
              <Input.Search
                allowClear
                placeholder="搜索模型名 / 厂商"
                style={{ width: 220 }}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
              <Select
                style={{ width: 150 }}
                value={provider}
                onChange={setProvider}
                options={[
                  { value: "ALL", label: "全部渠道" },
                  ...(catalog?.providers ?? []).map((item) => ({
                    value: item.name,
                    label: `${item.name}（${item.count}）`,
                  })),
                ]}
              />
              <Select
                style={{ width: 130 }}
                value={vendor}
                onChange={setVendor}
                options={[
                  { value: "ALL", label: "全部厂商" },
                  ...(catalog?.vendors ?? []).map((item) => ({
                    value: item,
                    label: item,
                  })),
                ]}
              />
              <Select
                style={{ width: 120 }}
                value={billingUnit}
                onChange={setBillingUnit}
                options={[
                  { value: "ALL", label: "全部计费" },
                  { value: "token", label: "按 Token" },
                  { value: "image", label: "按张" },
                  { value: "second", label: "按秒" },
                  { value: "call", label: "按次" },
                ]}
              />
              <Select
                style={{ width: 120 }}
                value={endpointFilter}
                onChange={setEndpointFilter}
                options={[
                  { value: "ALL", label: "全部能力" },
                  ...Object.entries(ENDPOINT_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
              {filtersActive ? (
                <Button type="link" size="small" onClick={resetFilters}>
                  重置筛选
                </Button>
              ) : null}
              <span className="mp-filter-count">
                筛选出 {models.length} 个模型
              </span>
            </div>
          </div>

          {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
          {!loading && !models.length ? (
            <EmptyState
              icon={<ApiOutlined style={{ fontSize: 40 }} aria-hidden />}
              text="还没有符合条件的模型，换个筛选条件试试。"
            />
          ) : null}
          {!loading && models.length ? (
            <div className="mp-grid">
              {models.map((model) => {
                const price = priceCells(model);
                const chips = tierChips(model);
                const discounted = hasDiscount(model);
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`mp-card${discounted ? " mp-card-sale" : ""}${
                      model.available ? "" : " mp-card-off"
                    }`}
                    onClick={() => setGuideModel(model)}
                  >
                    {discounted ? (
                      <span className="mp-ribbon">
                        <strong>{discountLabel(model.price.discountRate)}</strong>
                        <em>
                          省 {Math.round((1 - model.price.discountRate) * 100)}%
                        </em>
                      </span>
                    ) : null}

                    <span className="mp-card-head">
                      <span className="mp-card-name">
                        {model.displayName || model.modelKey}
                      </span>
                      <span className="mp-card-key mono">{model.modelKey}</span>
                    </span>

                    <span className="mp-card-tags">
                      <Tag color={CATEGORY_COLOR[model.category]}>
                        {CATEGORY_LABEL[model.category] || model.category}
                      </Tag>
                      <Tag color={UNIT_TAG_COLOR[model.billingUnit]}>
                        {UNIT_LABEL[model.billingUnit]}
                      </Tag>
                      {discounted ? null : (
                        <span className="mp-card-official">官方价</span>
                      )}
                      {model.available ? null : (
                        <Tooltip title={model.unavailableReason || "暂不可用"}>
                          <Tag color="red">暂不可用</Tag>
                        </Tooltip>
                      )}
                      <span className="mp-card-vendor">
                        {model.vendor || model.provider}
                        {model.contextWindow
                          ? ` · 上下文 ${model.contextWindow.toLocaleString()}`
                          : ""}
                      </span>
                    </span>

                    <span className="mp-card-price">
                      <span className="mp-card-price-row">
                        {price.cells.map((cell) => (
                          <span key={cell.label ?? "unit"} className="mp-price-cell">
                            {cell.label ? <em>{cell.label}</em> : null}
                            <b>{cell.now}</b>
                            {cell.was ? <s>{cell.was}</s> : null}
                          </span>
                        ))}
                      </span>
                      <span className="mp-card-price-meta">
                        <span>{price.suffix}</span>
                        <span>{pointsText(model)}</span>
                      </span>
                    </span>

                    {chips.length ? (
                      <span className="mp-card-specs">
                        {chips.map((chip) => (
                          <span key={chip.label} className="mp-chip">
                            {chip.label}
                            <b>{chip.price}</b>
                          </span>
                        ))}
                      </span>
                    ) : null}

                    {cacheShort(model) ? (
                      <span className="mp-card-note">{cacheShort(model)}</span>
                    ) : null}

                    <span className="mp-card-eps">
                      {model.endpoints
                        .map((item) => ENDPOINT_LABEL[item] || item)
                        .join(" · ")}
                    </span>

                    <span className="mp-card-foot">
                      <span className="mp-card-usage">
                        {model.myUsage7d.calls
                          ? `近 7 天 ${model.myUsage7d.calls} 次 · ${points(model.myUsage7d.pointsCost)} 积分`
                          : "近 7 天未调用"}
                      </span>
                      <span className="mp-card-more">查看调用方式 ›</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {tab === "usage" ? (
        <>
          <Panel
            title="用量汇总"
            titleExtra={<span className="text-12 muted">统计口径与积分账本一致：按实际扣分记</span>}
            extra={
              <Select
                style={{ width: 120 }}
                value={source}
                onChange={(value) => {
                  setSource(value);
                  setLogsPage(1);
                }}
                options={[
                  { value: "ALL", label: "全部来源" },
                  { value: "IN_APP", label: "站内试用" },
                  { value: "API", label: "对外 API" },
                ]}
              />
            }
          >
            {summary ? (
              <>
                <StatGrid>
                  <StatCard label="调用次数" value={summary.calls} hint={`成功 ${summary.successCalls} 次`} />
                  <StatCard
                    label="Tokens 总量"
                    value={summary.totalTokens.toLocaleString()}
                    hint={`输入 ${summary.promptTokens.toLocaleString()} · 输出 ${summary.completionTokens.toLocaleString()}`}
                  />
                  <StatCard label="积分消耗" value={points(summary.pointsCost)} hint={money(summary.rmbCost)} />
                  <StatCard
                    label="按来源"
                    value={summary.bySource.map((item) => `${SOURCE_LABEL[item.source as MpSource] || item.source} ${item.calls}`).join(" · ") || "—"}
                    hint="站内试用与对外 API 分开统计"
                  />
                </StatGrid>
                {summary.byModel.length ? (
                  <Table
                    style={{ marginTop: 14 }}
                    size="small"
                    rowKey={(row) => `${row.provider}:${row.modelKey}`}
                    pagination={false}
                    dataSource={summary.byModel}
                    columns={[
                      { title: "模型", dataIndex: "modelKey" },
                      { title: "渠道", dataIndex: "provider", width: 140 },
                      { title: "调用", dataIndex: "calls", width: 100 },
                      {
                        title: "Tokens",
                        dataIndex: "totalTokens",
                        width: 130,
                        render: (value: number) => value.toLocaleString(),
                      },
                      {
                        title: "积分",
                        dataIndex: "pointsCost",
                        width: 110,
                        render: (value: number) => points(value),
                      },
                    ]}
                  />
                ) : null}
              </>
            ) : (
              <Skeleton active paragraph={{ rows: 3 }} />
            )}
          </Panel>

          <Panel title="调用明细" titleExtra={<span className="text-12 muted">失败调用不计费，但会留痕</span>}>
            <Table
              size="small"
              rowKey="id"
              loading={logsLoading}
              dataSource={logs}
              columns={logColumns}
              scroll={{ x: 1000 }}
              pagination={{
                current: logsPage,
                total: logsTotal,
                pageSize: 20,
                showSizeChanger: false,
                onChange: (page) => void loadLogs(page),
              }}
            />
          </Panel>
        </>
      ) : null}

      {tab === "connect" ? (
        <Panel
          title="接入方式"
          titleExtra={
            <span className="text-12 muted">
              完全兼容 OpenAI SDK：把 baseURL 指向这里，Key 用「API Key 管理」里签发的 sk- Key
            </span>
          }
        >
          {!connection ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (
            <Space orientation="vertical" size={14} style={{ width: "100%" }}>
              <div>
                <div className="text-12 muted" style={{ marginBottom: 6 }}>
                  Base URL
                </div>
                <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
                  <Input readOnly value={baseUrl} className="mono" />
                  <Button
                    icon={<CopyOutlined aria-hidden />}
                    onClick={() => void copy(baseUrl)}
                  >
                    复制
                  </Button>
                </Space.Compact>
              </div>
              <div>
                <div className="text-12 muted" style={{ marginBottom: 6 }}>
                  模型清单
                </div>
                <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
                  <Input readOnly value={`${baseUrl}${connection.modelsPath}`} className="mono" />
                  <Button
                    icon={<CopyOutlined aria-hidden />}
                    onClick={() => void copy(`${baseUrl}${connection.modelsPath}`)}
                  >
                    复制
                  </Button>
                </Space.Compact>
              </div>
              <Notice variant="info">
                单 Key 每日调用上限 {connection.dailyLimit} 次（Key 上单独设置的限额优先，0 表示不限）；
                每次调用按目录价扣积分，余额不足或欠费会被拒绝。
              </Notice>
              <div>
                <div className="text-12 muted" style={{ marginBottom: 6 }}>
                  调用示例
                </div>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    padding: 14,
                    background: "var(--bg-subtle, #f7f8fa)",
                    borderRadius: 8,
                    overflowX: "auto",
                    fontSize: 12,
                  }}
                >
{`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer <你的 API Key>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"ap-deepseek-v4-flash","messages":[{"role":"user","content":"你好"}]}'`}
                </pre>
              </div>
              <div>
                <div className="text-12 muted" style={{ marginBottom: 6 }}>
                  我的 API Key（只显示掩码，明文仅在创建时展示一次）
                </div>
                {connection.keys.length ? (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={connection.keys}
                    columns={[
                      { title: "名称", dataIndex: "name" },
                      {
                        title: "Key",
                        dataIndex: "masked",
                        render: (value: string) => <span className="mono">{value}</span>,
                      },
                      { title: "今日调用", dataIndex: "todayCalls", width: 100 },
                      { title: "累计调用", dataIndex: "callCount", width: 100 },
                      {
                        title: "日限额",
                        dataIndex: "rateLimitDay",
                        width: 100,
                        render: (value: number) => (value ? value : "不限"),
                      },
                      {
                        title: "最近使用",
                        dataIndex: "lastUsedAt",
                        width: 180,
                        render: (value: string | null) =>
                          value ? new Date(value).toLocaleString() : "—",
                      },
                    ]}
                  />
                ) : (
                  <EmptyState text="还没有可用的 API Key，先去「开放集成 → API Key 管理」创建一把。" />
                )}
                <div style={{ marginTop: 10 }}>
                  <Link href="/developer/keys">前往 API Key 管理</Link>
                </div>
              </div>
            </Space>
          )}
        </Panel>
      ) : null}

      <Modal
        open={Boolean(trial)}
        title={trial ? `在线试用 · ${trial.displayName || trial.modelKey}` : "在线试用"}
        onCancel={() => setTrial(null)}
        onOk={() => void runTrial()}
        okText={trialRunning ? "生成中…" : "开始试用"}
        confirmLoading={trialRunning}
        okButtonProps={{ disabled: trialRunning }}
        width={720}
        destroyOnHidden
      >
        {trial ? (
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            <div className="text-12 muted">
              {priceText(trial)}；余额 {catalog ? points(catalog.balance) : "—"} 积分
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                系统提示（可选）
              </div>
              <Input.TextArea
                rows={2}
                maxLength={4000}
                value={trialForm.system}
                onChange={(event) =>
                  setTrialForm((prev) => ({ ...prev, system: event.target.value }))
                }
                placeholder="例如：你是一名严谨的中文助手"
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                提问内容
              </div>
              <Input.TextArea
                rows={4}
                maxLength={20000}
                value={trialForm.prompt}
                onChange={(event) =>
                  setTrialForm((prev) => ({ ...prev, prompt: event.target.value }))
                }
              />
            </div>
            <Space size={16} wrap>
              <span>
                <span className="text-12 muted">温度 </span>
                <InputNumber
                  min={0}
                  max={2}
                  step={0.1}
                  value={trialForm.temperature}
                  onChange={(value) =>
                    setTrialForm((prev) => ({ ...prev, temperature: Number(value ?? 0.7) }))
                  }
                />
              </span>
              <span>
                <span className="text-12 muted">最大输出 tokens </span>
                <InputNumber
                  min={1}
                  max={8192}
                  value={trialForm.maxTokens}
                  onChange={(value) =>
                    setTrialForm((prev) => ({ ...prev, maxTokens: Number(value ?? 512) }))
                  }
                />
              </span>
            </Space>
            {trialError ? <Notice variant="error">{trialError}</Notice> : null}
            {trialResult ? (
              <div>
                <div className="text-12 muted" style={{ marginBottom: 4 }}>
                  返回结果 · 输入 {trialResult.promptTokens} / 输出 {trialResult.completionTokens} tokens ·
                  消耗 {points(trialResult.pointsCost)} 积分（{money(trialResult.rmbCost)}）· {trialResult.elapsedMs} ms
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 14,
                    background: "var(--bg-subtle, #f7f8fa)",
                    borderRadius: 8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 320,
                    overflowY: "auto",
                  }}
                >
                  {trialResult.content || "（模型返回了空内容）"}
                </pre>
              </div>
            ) : null}
          </Space>
        ) : null}
      </Modal>

      <CallGuideDrawer
        model={guideModel}
        baseUrl={baseUrl}
        onClose={() => setGuideModel(null)}
        onTrial={(model) => {
          setGuideModel(null);
          openTrial(model);
        }}
      />
    </>
  );
}
