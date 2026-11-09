"use client";

import {
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StarOutlined,
  StopOutlined,
  TableOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  acqApi,
  platformLabel,
  runStatusLabel,
  RUN_STATUS_COLOR,
  sourceModeLabel,
  sourceModeOptions,
  platformOptions,
  splitTerms,
  INTENT_COLOR,
  LEAD_STATUS_COLOR,
  intentLevelLabel,
  leadStatusLabel,
  evidenceSourceLabel,
  outreachChannelLabel,
  outreachStatusLabel,
  type AcqLead,
  type AcqLeadDetail,
  type AcqMeta,
  type AcqRun,
  type AcqSource,
} from "./acquisition-common";
import {
  ACQ_PLATFORMS,
  ACQ_SOURCE_MODES,
  ACQ_SOURCE_STATUSES,
  ACQ_TIME_WINDOWS,
} from "@enterprise/contracts";

/**
 * 线索雷达：监控源（关键词/竞品/话题/账号/链接）→ 采集批次 → 线索池。
 * 采集不在服务器跑：插件领取批次后在用户本机已登录的平台页抓取并回写，
 * 因此「运行」只是把批次放进队列，需在上方启动采集循环。
 */

const LEAD_STATUS_OPTIONS = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "QUALIFIED",
  "PROMOTED",
  "IGNORED",
].map((value) => ({ value, label: leadStatusLabel(value) }));
const INTENT_OPTIONS = ["HOT", "WARM", "COLD"].map((value) => ({
  value,
  label: intentLevelLabel(value),
}));
const TIME_WINDOW_OPTIONS = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "90d", label: "近 90 天" },
  { value: "all", label: "不限时间" },
];

type SourceFormValues = {
  name: string;
  platform: string;
  mode: string;
  cron: string;
  dailyLimit: number;
  status: string;
  terms: string;
  timeWindow: string;
  excludeWords: string;
  minComments: number;
  regions: string;
  excludeCustomers: boolean;
};

export function AcquisitionLeadsView({
  tick,
  meta,
  onChanged,
}: {
  tick: number;
  meta: AcqMeta | null;
  onChanged: () => void;
}) {
  const { message } = App.useApp();

  const [sources, setSources] = useState<AcqSource[]>([]);
  const [runs, setRuns] = useState<AcqRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [leads, setLeads] = useState<AcqLead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);

  const [filterPlatform, setFilterPlatform] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterIntent, setFilterIntent] = useState("");
  const [minScore, setMinScore] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");

  const [sourceEditing, setSourceEditing] = useState<AcqSource | 0 | null>(null);
  const [sourceForm] = Form.useForm<SourceFormValues>();
  const [sourceSaving, setSourceSaving] = useState(false);
  const sourceMode = Form.useWatch("mode", sourceForm);

  const [leadDetail, setLeadDetail] = useState<AcqLeadDetail | null>(null);
  const [leadDetailOpen, setLeadDetailOpen] = useState(false);
  const [leadBusy, setLeadBusy] = useState(0);

  const [ignoreTarget, setIgnoreTarget] = useState<AcqLead | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("手动忽略");
  const [promoteTarget, setPromoteTarget] = useState<AcqLead | null>(null);
  const [promoteForm] = Form.useForm();
  const [promoting, setPromoting] = useState(false);

  const [tableOpen, setTableOpen] = useState(false);
  const [tableId, setTableId] = useState(0);
  const [writing, setWriting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [runDetail, setRunDetail] = useState<AcqRunDetail | null>(null);
  const [runDetailOpen, setRunDetailOpen] = useState(false);

  const reloadSources = useCallback(async () => {
    try {
      const result = await acqApi.sources({ query: { page: 1, pageSize: 100 } });
      setSources(result?.list ?? []);
    } catch (error) {
      message.error((error as Error).message || "监控源读取失败");
    }
  }, [message]);

  const reloadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const result = await acqApi.runs({ query: { page: 1, pageSize: 10 } });
      setRuns(result?.list ?? []);
    } catch (error) {
      message.error((error as Error).message || "采集批次读取失败");
    } finally {
      setRunsLoading(false);
    }
  }, [message]);

  const reloadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await acqApi.leads({
        query: {
          page,
          pageSize,
          ...(filterPlatform ? { platform: filterPlatform } : {}),
          ...(filterStatus ? { status: filterStatus } : {}),
          ...(filterIntent ? { intentLevel: filterIntent } : {}),
          ...(minScore !== null ? { minScore } : {}),
          ...(keyword.trim() ? { q: keyword.trim() } : {}),
        },
      });
      setLeads(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "线索读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterPlatform, filterStatus, filterIntent, minScore, keyword, message]);

  useEffect(() => {
    void reloadSources();
    void reloadRuns();
  }, [reloadSources, reloadRuns]);

  useEffect(() => {
    void reloadLeads();
  }, [reloadLeads, tick]);

  const openSourceEditor = useCallback(
    (row: AcqSource | null) => {
      setSourceEditing(row ?? 0);
      if (row) {
        sourceForm.setFieldsValue({
          name: row.name,
          platform: row.platform,
          mode: row.mode,
          cron: row.cron,
          dailyLimit: row.dailyLimit,
          status: row.status,
          terms: termsOf(row),
          timeWindow: row.filters.timeWindow,
          excludeWords: row.filters.excludeWords.join("\n"),
          minComments: row.filters.minComments,
          regions: row.filters.regions.join("\n"),
          excludeCustomers: row.filters.excludeCustomers,
        });
      } else {
        sourceForm.resetFields();
      }
    },
    [sourceForm],
  );

  const saveSource = async () => {
    const values = await sourceForm.validateFields();
    const terms = splitTerms(values.terms || "");
    if (values.mode !== "ACCOUNT" && !terms.length && values.mode !== "URL") {
      message.warning("请至少填写一个搜索词 / 话题 / 竞品名");
      return;
    }
    const query = {
      keywords: values.mode === "KEYWORD" ? terms : [],
      competitorIds: values.mode === "COMPETITOR" ? terms : [],
      topicTags: values.mode === "TOPIC" ? terms : [],
      accountUrls: values.mode === "ACCOUNT" ? terms : [],
      urls: values.mode === "URL" ? terms : [],
    };
    setSourceSaving(true);
    try {
      await acqApi.saveSource({
        body: {
          ...(typeof sourceEditing === "number" && sourceEditing > 0
            ? { id: sourceEditing }
            : {}),
          name: values.name,
          platform: ACQ_PLATFORMS.find((item) => item === values.platform) ?? "XHS",
          mode: ACQ_SOURCE_MODES.find((item) => item === values.mode) ?? "KEYWORD",
          query,
          filters: {
            timeWindow: ACQ_TIME_WINDOWS.find((item) => item === values.timeWindow) ?? "30d",
            excludeWords: splitTerms(values.excludeWords || ""),
            minComments: Number(values.minComments ?? 0),
            regions: splitTerms(values.regions || ""),
            excludeCustomers: Boolean(values.excludeCustomers),
          },
          cron: values.cron ?? "",
          dailyLimit: Number(values.dailyLimit ?? 200),
          status: ACQ_SOURCE_STATUSES.find((item) => item === values.status) ?? "ACTIVE",
        },
      });
      message.success(sourceEditing ? "监控源已更新" : "监控源已创建");
      setSourceEditing(null);
      void reloadSources();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSourceSaving(false);
    }
  };

  const removeSource = useCallback(
    async (row: AcqSource) => {
      try {
        await acqApi.removeSource({ params: { id: row.id } });
        message.success("已删除监控源");
        void reloadSources();
      } catch (error) {
        message.error((error as Error).message || "删除失败");
      }
    },
    [reloadSources, message],
  );

  const runSource = useCallback(
    async (row: AcqSource) => {
      try {
        await acqApi.runSource({ params: { id: row.id }, body: {} });
        message.success("已加入采集队列：请在上方「启动采集」让插件领取批次");
        void reloadRuns();
      } catch (error) {
        message.error((error as Error).message || "运行失败");
      }
    },
    [reloadRuns, message],
  );

  const openRunDetail = async (row: AcqRun) => {
    try {
      const result = await acqApi.runDetail({ params: { id: row.id } });
      setRunDetail(result);
      setRunDetailOpen(true);
    } catch (error) {
      message.error((error as Error).message || "批次详情读取失败");
    }
  };

  const openLead = async (row: AcqLead) => {
    try {
      const result = await acqApi.leadDetail({ params: { id: row.id } });
      setLeadDetail(result);
      setLeadDetailOpen(true);
    } catch (error) {
      message.error((error as Error).message || "线索详情读取失败");
    }
  };

  const scoreLead = async (row: AcqLead) => {
    setLeadBusy(row.id);
    try {
      const score = await acqApi.scoreLead({
        params: { id: row.id },
        body: { force: true },
      });
      if (!score) {
        message.error("评分失败：接口未返回评分结果");
        return;
      }
      message.success(
        `已${score.mode === "llm" ? "由 AI" : "按规则"}评分：${score.score} 分（${intentLevelLabel(score.level)}）`,
      );
      void reloadLeads();
      onChanged();
    } catch (error) {
      message.error((error as Error).message || "评分失败");
    } finally {
      setLeadBusy(0);
    }
  };

  const ignoreLead = async () => {
    if (!ignoreTarget) return;
    try {
      await acqApi.updateLead({
        params: { id: ignoreTarget.id },
        body: { status: "IGNORED", blockReason: ignoreReason.trim() || "手动忽略" },
      });
      message.success("已忽略该线索，后续触达会自动跳过");
      setIgnoreTarget(null);
      void reloadLeads();
    } catch (error) {
      message.error((error as Error).message || "更新失败");
    }
  };

  const promoteLead = async () => {
    if (!promoteTarget) return;
    const values = await promoteForm.validateFields();
    setPromoting(true);
    try {
      const result = await acqApi.promoteLead({
        params: { id: promoteTarget.id },
        body: {
          name: values.name ?? "",
          contactName: values.contactName ?? "",
          phone: values.phone ?? "",
          email: values.email ?? "",
          source: values.source ?? `AI获客·${platformLabel(promoteTarget.platform)}`,
          ownerId: values.ownerId ?? "",
          poolId: Number(values.poolId ?? 0),
          remark: values.remark ?? "",
        },
      });
      if (!result) {
        message.error("提升失败：接口未返回客户档案");
        return;
      }
      message.success(`已提升到 CRM 并建档（客户档案 #${result.profileId}）`);
      setPromoteTarget(null);
      promoteForm.resetFields();
      void reloadLeads();
    } catch (error) {
      message.error((error as Error).message || "提升失败");
    } finally {
      setPromoting(false);
    }
  };

  const writeToTable = async () => {
    if (!tableId) {
      message.warning("请选择目标多维表格");
      return;
    }
    if (!selected.length) {
      message.warning("请先勾选要写入的线索");
      return;
    }
    setWriting(true);
    try {
      const result = await acqApi.leadsToTable({
        body: { leadIds: selected, tableId, fieldMap: {} },
      });
      if (!result) {
        message.error("写入失败：接口未返回写入结果");
        return;
      }
      message.success(
        `已写入 ${result.written} 条${result.skipped ? `，跳过 ${result.skipped} 条` : ""}${result.failed ? `，失败 ${result.failed} 条` : ""}`,
      );
      setTableOpen(false);
      setSelected([]);
    } catch (error) {
      message.error((error as Error).message || "写入失败");
    } finally {
      setWriting(false);
    }
  };

  const exportLeads = async () => {
    setExporting(true);
    try {
      const result = await acqApi.exportLeads({
        body: {
          leadIds: selected,
          ...(filterPlatform ? { platform: filterPlatform } : {}),
          ...(filterStatus ? { status: filterStatus } : {}),
          ...(filterIntent ? { intentLevel: filterIntent } : {}),
          format: "csv",
        },
      });
      if (!result) {
        message.error("导出失败：接口未返回导出结果");
        return;
      }
      if (result.downloadUrl) {
        window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
        message.success("导出任务已完成，正在下载");
      } else {
        message.success("导出任务已创建，请稍后到导出记录下载");
      }
    } catch (error) {
      message.error((error as Error).message || "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const sourceColumns = useMemo(
    () => [
      {
        title: "监控源",
        dataIndex: "name",
        render: (value: string, row: AcqSource) => (
          <Space orientation="vertical" size={0}>
            <span>{value}</span>
            <span className="text-12 muted">
              {platformLabel(row.platform)} · {sourceModeLabel(row.mode)}
            </span>
          </Space>
        ),
      },
      {
        title: "查询条件",
        render: (_: unknown, row: AcqSource) => (
          <span className="text-12">{termsOf(row) || <span className="muted">未填写</span>}</span>
        ),
      },
      {
        title: "日限额",
        dataIndex: "dailyLimit",
        width: 80,
      },
      {
        title: "状态",
        dataIndex: "status",
        width: 90,
        render: (value: string) =>
          value === "ACTIVE" ? <Tag color="success">启用</Tag> : <Tag>暂停</Tag>,
      },
      {
        title: "上次采集",
        dataIndex: "lastRunAt",
        width: 160,
        render: (value: string) => (value ? fmtTime(value) : "-"),
      },
      {
        title: "操作",
        width: 200,
        render: (_: unknown, row: AcqSource) => (
          <Space size={4} wrap>
            <Button
              size="small"
              type="primary"
              icon={<RocketOutlined aria-hidden />}
              onClick={() => void runSource(row)}
            >
              运行
            </Button>
            <Button
              size="small"
              icon={<EditOutlined aria-hidden />}
              onClick={() => openSourceEditor(row)}
            >
              编辑
            </Button>
            <Popconfirm
              title="删除这个监控源？"
              description="已采集的线索与批次记录保留，只停止后续采集。"
              onConfirm={() => void removeSource(row)}
            >
              <Button size="small" danger icon={<DeleteOutlined aria-hidden />} />
            </Popconfirm>
          </Space>
        ),
      },
    ],
    // 依赖 stable 的两个 action：用函数内闭包即可，避免每次渲染重建列
    [runSource, openSourceEditor, removeSource],
  );

  const runColumns = [
    {
      title: "批次",
      dataIndex: "id",
      width: 80,
      render: (value: number, row: AcqRun) => (
        <Space orientation="vertical" size={0}>
          <span className="mono">#{value}</span>
          <span className="text-12 muted">{row.sourceName || `源 #${row.sourceId}`}</span>
        </Space>
      ),
    },
    {
      title: "平台",
      dataIndex: "platform",
      width: 110,
      render: (value: string) => platformLabel(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={RUN_STATUS_COLOR[value] || "default"}>{runStatusLabel(value)}</Tag>
      ),
    },
    {
      title: "统计",
      dataIndex: "stats",
      render: (_: unknown, row: AcqRun) => (
        <span className="text-12">
          扫描 {row.stats.scanned} · 新增 {row.stats.new} · 重复 {row.stats.duplicate} · 过滤{" "}
          {row.stats.filtered}
        </span>
      ),
    },
    {
      title: "时间",
      dataIndex: "finishedAt",
      width: 160,
      render: (value: string, row: AcqRun) =>
        value ? fmtTime(value) : row.startedAt ? `开始于 ${fmtTime(row.startedAt)}` : "-",
    },
    {
      title: "说明",
      dataIndex: "error",
      render: (value: string) => (value ? <span className="text-12">{value}</span> : "-"),
    },
    {
      title: "操作",
      width: 90,
      render: (_: unknown, row: AcqRun) => (
        <Button size="small" icon={<EyeOutlined aria-hidden />} onClick={() => void openRunDetail(row)}>
          详情
        </Button>
      ),
    },
  ];

  const leadColumns = [
    {
      title: "线索",
      dataIndex: "nickname",
      render: (value: string, row: AcqLead) => (
        <Space orientation="vertical" size={0}>
          <Space size={6}>
            <span>{value || row.platformUserId || "-"}</span>
            {row.profileUrl ? (
              <a href={row.profileUrl} target="_blank" rel="noreferrer" className="text-12">
                主页
              </a>
            ) : null}
          </Space>
          <span className="text-12 muted">
            {platformLabel(row.platform)} · 证据 {row.evidenceCount} 条
          </span>
        </Space>
      ),
    },
    {
      title: "意图",
      dataIndex: "intentScore",
      width: 150,
      render: (value: number, row: AcqLead) => (
        <Space size={6}>
          <Tag color={INTENT_COLOR[row.intentLevel] || "default"}>
            {intentLevelLabel(row.intentLevel)} {value}
          </Tag>
          {row.intentTags.slice(0, 2).map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: string) => (
        <Tag color={LEAD_STATUS_COLOR[value] || "default"}>{leadStatusLabel(value)}</Tag>
      ),
    },
    {
      title: "评分说明",
      dataIndex: "scoreReason",
      render: (value: string) => <span className="text-12">{value || "-"}</span>,
    },
    {
      title: "最近出现",
      dataIndex: "lastSeenAt",
      width: 160,
      render: (value: string) => (value ? fmtTime(value) : "-"),
    },
    {
      title: "操作",
      width: 300,
      render: (_: unknown, row: AcqLead) => (
        <Space size={4} wrap>
          <Button size="small" icon={<EyeOutlined aria-hidden />} onClick={() => void openLead(row)}>
            详情
          </Button>
          <Button
            size="small"
            icon={<StarOutlined aria-hidden />}
            loading={leadBusy === row.id}
            onClick={() => void scoreLead(row)}
          >
            评分
          </Button>
          <Button
            size="small"
            icon={<UserSwitchOutlined aria-hidden />}
            disabled={row.status === "PROMOTED"}
            onClick={() => {
              setPromoteTarget(row);
              promoteForm.setFieldsValue({
                name: row.nickname || row.platformUserId,
                contactName: row.nickname,
                source: `AI获客·${platformLabel(row.platform)}`,
              });
            }}
          >
            提升 CRM
          </Button>
          <Button
            size="small"
            icon={<StopOutlined aria-hidden />}
            disabled={row.status === "IGNORED"}
            onClick={() => {
              setIgnoreTarget(row);
              setIgnoreReason(row.blockReason || "手动忽略");
            }}
          />
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="监控源"
        titleExtra="按关键词 / 竞品 / 话题 / 账号 / 链接筛出潜在客户出没的内容，再交给插件采集"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => openSourceEditor(null)}
          >
            新建监控源
          </Button>
        }
      >
        <Table<AcqSource>
          rowKey="id"
          size="small"
          dataSource={sources}
          columns={sourceColumns}
          pagination={false}
          scroll={{ x: 880 }}
          locale={{ emptyText: "还没有监控源：新建一个，点「运行」后在上方启动采集" }}
        />
      </Panel>

      <Panel
        title="采集批次"
        extra={
          <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reloadRuns()} loading={runsLoading}>
            刷新
          </Button>
        }
      >
        <Table<AcqRun>
          rowKey="id"
          size="small"
          loading={runsLoading}
          dataSource={runs}
          columns={runColumns}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: "还没有采集批次：在监控源里点「运行」创建批次" }}
        />
      </Panel>

      <Panel
        title="线索池"
        titleExtra="按来源去重、按意图评分排序；触达前会再次校验黑名单与冷却"
        extra={
          <Space wrap>
            <Button
              icon={<TableOutlined aria-hidden />}
              disabled={!selected.length}
              onClick={() => {
                setTableId(meta?.tableOptions?.[0]?.id ?? 0);
                setTableOpen(true);
              }}
            >
              写入多维表格
            </Button>
            <Button
              icon={<CloudDownloadOutlined aria-hidden />}
              loading={exporting}
              onClick={() => void exportLeads()}
            >
              导出 CSV
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="平台"
            style={{ width: 130 }}
            value={filterPlatform || undefined}
            options={platformOptions}
            onChange={(value) => {
              setPage(1);
              setFilterPlatform(value ?? "");
            }}
          />
          <Select
            allowClear
            placeholder="线索状态"
            style={{ width: 130 }}
            value={filterStatus || undefined}
            options={LEAD_STATUS_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setFilterStatus(value ?? "");
            }}
          />
          <Select
            allowClear
            placeholder="意图等级"
            style={{ width: 120 }}
            value={filterIntent || undefined}
            options={INTENT_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setFilterIntent(value ?? "");
            }}
          />
          <InputNumber
            min={0}
            max={100}
            placeholder="最低分"
            style={{ width: 100 }}
            value={minScore}
            onChange={(value) => {
              setPage(1);
              setMinScore(value);
            }}
          />
          <Input.Search
            allowClear
            placeholder="按昵称 / 标签 / 评语搜索"
            style={{ width: 240 }}
            onSearch={(value) => {
              setPage(1);
              setKeyword(value);
            }}
          />
        </Space>
        <Table<AcqLead>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={leads}
          columns={leadColumns}
          scroll={{ x: 1000 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys.map(Number)),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
          locale={{ emptyText: "还没有线索：先建监控源并运行采集" }}
        />
      </Panel>

      <Modal
        title={typeof sourceEditing === "object" && sourceEditing ? "编辑监控源" : "新建监控源"}
        open={sourceEditing !== null}
        width={640}
        confirmLoading={sourceSaving}
        okText="保存"
        onOk={() => void saveSource()}
        onCancel={() => setSourceEditing(null)}
      >
        <Form form={sourceForm} layout="vertical" initialValues={{ dailyLimit: 200, status: "ACTIVE", timeWindow: "30d", minComments: 0, excludeCustomers: true }}>
          <div className="form-2col">
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写监控源名称" }]}>
              <Input placeholder="如：小红书·装修需求" maxLength={80} />
            </Form.Item>
            <Form.Item name="platform" label="平台" rules={[{ required: true, message: "请选择平台" }]}>
              <Select
                options={
                  (meta?.platforms.length
                    ? meta.platforms.map((item) => ({
                        value: item.key,
                        label: `${item.label}${item.collectable ? "" : "（插件暂不支持网页采集）"}`,
                        disabled: !item.collectable,
                      }))
                    : platformOptions) as {
                    value: string;
                    label: string;
                    disabled?: boolean;
                  }[]
                }
              />
            </Form.Item>
            <Form.Item name="mode" label="查询方式" rules={[{ required: true, message: "请选择查询方式" }]}>
              <Select options={sourceModeOptions} />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: "ACTIVE", label: "启用" },
                  { value: "PAUSED", label: "暂停" },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="terms"
            label={
              sourceMode === "KEYWORD"
                ? "搜索关键词"
                : sourceMode === "COMPETITOR"
                  ? "竞品名"
                  : sourceMode === "TOPIC"
                    ? "话题标签"
                    : sourceMode === "ACCOUNT"
                      ? "账号主页链接"
                      : "内容链接"
            }
            extra="每行一个；采集时逐个打开平台搜索页 / 评论区读取"
            rules={[{ required: sourceMode !== "URL", message: "请填写查询条件" }]}
          >
            <Input.TextArea
              rows={3}
              placeholder={
                sourceMode === "ACCOUNT"
                  ? "https://www.xiaohongshu.com/user/profile/..."
                  : sourceMode === "URL"
                    ? "https://www.xiaohongshu.com/explore/..."
                    : "每行一个"
              }
            />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="cron" label="定时（cron，选填）" tooltip="留空表示只手动运行；例如 0 9 * * * 每天 9 点">
              <Input placeholder="0 9 * * *" maxLength={60} />
            </Form.Item>
            <Form.Item name="dailyLimit" label="每日采集上限">
              <InputNumber min={1} max={2000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="timeWindow" label="内容时间范围">
              <Select options={TIME_WINDOW_OPTIONS} />
            </Form.Item>
            <Form.Item name="minComments" label="最低评论数">
              <InputNumber min={0} max={100000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="excludeWords" label="排除词（每行一个）">
              <Input.TextArea rows={2} placeholder="如：招聘、二手、广告" />
            </Form.Item>
            <Form.Item name="regions" label="地区限定（每行一个）">
              <Input.TextArea rows={2} placeholder="如：上海、杭州（选填）" />
            </Form.Item>
          </div>
          <Form.Item name="excludeCustomers" label="排除已成交客户" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={leadDetail ? `线索详情 · ${leadDetail.nickname || leadDetail.platformUserId}` : "线索详情"}
        open={leadDetailOpen}
        size={620}
        onClose={() => setLeadDetailOpen(false)}
      >
        {leadDetail ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "platform",
                  label: "平台 / 账号",
                  children: `${platformLabel(leadDetail.platform)} · ${leadDetail.platformUserId}`,
                },
                {
                  key: "intent",
                  label: "意图评分",
                  children: (
                    <Space size={6} wrap>
                      <Tag color={INTENT_COLOR[leadDetail.intentLevel] || "default"}>
                        {intentLevelLabel(leadDetail.intentLevel)} {leadDetail.intentScore}
                      </Tag>
                      {leadDetail.intentTags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                      <span className="text-12 muted">
                        {leadDetail.scoreMode === "llm" ? "AI 评分" : "规则评分"}
                      </span>
                    </Space>
                  ),
                },
                {
                  key: "status",
                  label: "状态",
                  children: leadStatusLabel(leadDetail.status),
                },
                {
                  key: "reason",
                  label: "评分说明",
                  children: leadDetail.scoreReason || "-",
                },
                {
                  key: "opening",
                  label: "建议开场",
                  children: leadDetail.opening || "-",
                },
                {
                  key: "risk",
                  label: "风险提示",
                  children: leadDetail.risk || "-",
                },
                {
                  key: "profile",
                  label: "客户档案",
                  children: leadDetail.profileId ? `#${leadDetail.profileId}` : "尚未建档",
                },
                {
                  key: "crm",
                  label: "CRM 线索",
                  children: leadDetail.crmLeadId ? `#${leadDetail.crmLeadId}` : "尚未提升",
                },
              ]}
            />
            <Panel title="证据">
              <Table
                rowKey="id"
                size="small"
                dataSource={leadDetail.evidence}
                pagination={false}
                columns={[
                  {
                    title: "来源",
                    dataIndex: "sourceType",
                    width: 90,
                    render: (value: string) => evidenceSourceLabel(value),
                  },
                  {
                    title: "链接 / 摘要",
                    render: (_: unknown, row) => (
                      <Space orientation="vertical" size={0}>
                        {row.url ? (
                          <a href={row.url} target="_blank" rel="noreferrer" className="text-12">
                            {row.url}
                          </a>
                        ) : null}
                        <span className="text-12">{row.excerpt || row.summary || "-"}</span>
                      </Space>
                    ),
                  },
                  {
                    title: "采集时间",
                    dataIndex: "capturedAt",
                    width: 150,
                    render: (value: string) => fmtTime(value),
                  },
                ]}
              />
            </Panel>
            <Panel title="触达记录">
              <Table
                rowKey="id"
                size="small"
                dataSource={leadDetail.outreach}
                pagination={false}
                columns={[
                  {
                    title: "渠道",
                    dataIndex: "channel",
                    width: 110,
                    render: (value: string) => outreachChannelLabel(value),
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 110,
                    render: (value: string) => outreachStatusLabel(value),
                  },
                  { title: "内容", dataIndex: "finalText", ellipsis: true },
                  {
                    title: "时间",
                    dataIndex: "sentAt",
                    width: 150,
                    render: (value: string) => (value ? fmtTime(value) : "-"),
                  },
                ]}
                locale={{ emptyText: "还没有触达记录" }}
              />
            </Panel>
          </Space>
        ) : null}
      </Drawer>

      <Drawer
        title={runDetail ? `采集批次 #${runDetail.id}` : "采集批次"}
        open={runDetailOpen}
        size={620}
        onClose={() => setRunDetailOpen(false)}
      >
        {runDetail ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: "source", label: "监控源", children: `${runDetail.sourceName}（${platformLabel(runDetail.platform)}）` },
                { key: "status", label: "状态", children: runStatusLabel(runDetail.status) },
                {
                  key: "stats",
                  label: "统计",
                  children: `扫描 ${runDetail.stats.scanned} · 新增 ${runDetail.stats.new} · 重复 ${runDetail.stats.duplicate} · 过滤 ${runDetail.stats.filtered}`,
                },
                { key: "error", label: "说明", children: runDetail.error || "-" },
                { key: "started", label: "开始", children: runDetail.startedAt ? fmtTime(runDetail.startedAt) : "-" },
                { key: "finished", label: "结束", children: runDetail.finishedAt ? fmtTime(runDetail.finishedAt) : "-" },
              ]}
            />
            <Table<AcqLead>
              rowKey="id"
              size="small"
              dataSource={runDetail.leads}
              pagination={false}
              columns={[
                { title: "线索", dataIndex: "nickname" },
                {
                  title: "评分",
                  dataIndex: "intentScore",
                  width: 110,
                  render: (value: number, row) => `${value} · ${intentLevelLabel(row.intentLevel)}`,
                },
                { title: "状态", dataIndex: "status", width: 100, render: (value: string) => leadStatusLabel(value) },
              ]}
              locale={{ emptyText: "本批次没有新增线索" }}
            />
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="忽略线索"
        open={!!ignoreTarget}
        okText="忽略"
        onOk={() => void ignoreLead()}
        onCancel={() => setIgnoreTarget(null)}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Notice variant="warn">
            忽略后线索保留可查，但不会再进入触达队列。请写明原因（退订、黑名单、竞品员工、已成交等）。
          </Notice>
          <Input
            value={ignoreReason}
            onChange={(event) => setIgnoreReason(event.target.value)}
            placeholder="忽略原因"
            maxLength={300}
          />
        </Space>
      </Modal>

      <Modal
        title={`提升到 CRM · ${promoteTarget?.nickname || ""}`}
        open={!!promoteTarget}
        confirmLoading={promoting}
        okText="提升并建档"
        onOk={() => void promoteLead()}
        onCancel={() => setPromoteTarget(null)}
      >
        <Form form={promoteForm} layout="vertical">
          <div className="form-2col">
            <Form.Item name="name" label="公司 / 线索名称" rules={[{ required: true, message: "请填写名称" }]}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item name="contactName" label="联系人">
              <Input maxLength={60} />
            </Form.Item>
            <Form.Item name="phone" label="电话">
              <Input maxLength={40} />
            </Form.Item>
            <Form.Item name="email" label="邮箱">
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item name="ownerId" label="负责人用户 ID（选填）">
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item name="poolId" label="线索池 ID（0＝默认池）">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item name="source" label="来源">
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="写入多维表格"
        open={tableOpen}
        confirmLoading={writing}
        okText={`写入 ${selected.length} 条`}
        onOk={() => void writeToTable()}
        onCancel={() => setTableOpen(false)}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Notice variant="info">
            按默认字段映射写入所选表格；源数据 ID 用于去重，重复线索会跳过。
          </Notice>
          <Select
            style={{ width: "100%" }}
            placeholder="选择目标多维表格"
            value={tableId || undefined}
            options={(meta?.tableOptions ?? []).map((table) => ({
              value: table.id,
              label: table.name,
            }))}
            onChange={setTableId}
          />
          {(meta?.tableOptions ?? []).length === 0 ? (
            <Typography.Text type="secondary">
              还没有可用的多维表格：先到「多维表格」创建一张表再回来。
            </Typography.Text>
          ) : null}
        </Space>
      </Modal>
    </Space>
  );
}

type AcqRunDetail = AcqRun & { leads: AcqLead[] };

/** 监控源的查询条件转展示文本：只显示当前模式下的那一组词。 */
function termsOf(row: AcqSource): string {
  const query = row.query;
  const terms =
    row.mode === "COMPETITOR"
      ? query.competitorIds
      : row.mode === "TOPIC"
        ? query.topicTags
        : row.mode === "ACCOUNT"
          ? query.accountUrls
          : row.mode === "URL"
            ? query.urls
            : query.keywords;
  return (terms || []).join("、");
}
