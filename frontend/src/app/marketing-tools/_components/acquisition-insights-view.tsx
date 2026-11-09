"use client";

import {
  CloudDownloadOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { endpoint } from "@/api/endpoint";
import {
  Notice,
  Panel,
  PillTabs,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { endpoints } from "@enterprise/contracts";
import {
  acqApi,
  fmtPct,
  fmtPoints,
  platformOptions,
  qcDimensionLabel,
  type AcqDashboard,
  type AcqPlaybook,
  type AcqQcReview,
} from "./acquisition-common";

/**
 * 质检与看板：质检把服务台会话按五维打分留快照，看板把漏斗、渠道、触达、跟进与成本放在一页。
 * 两者都只读组织内的既有事实，不产生新的业务动作；导出与分享走机制模块的任务与公开链接。
 */

const serviceDeskConversations = endpoint(endpoints.ServiceDesk_conversations);

type QcDetail = AcqQcReview & {
  conversationTitle: string;
  messages: { role: string; text: string; at: string }[];
};

type ConversationOption = {
  id: number;
  subject: string;
  visitorName: string;
  statusLabel: string;
};

const ROLE_LABELS: Record<string, string> = {
  visitor: "客户",
  agent: "客服",
  ai: "AI",
  system: "系统",
};

const modeLabel = (mode: string) => (mode === "llm" ? "模型质检" : "规则质检");

const scoreColor = (score: number) =>
  score >= 85 ? "success" : score >= 70 ? "warning" : "error";

export function AcquisitionInsightsView({ tick }: { tick: number }) {
  const [tab, setTab] = useState<"qc" | "dashboard">("qc");
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <PillTabs
        items={[
          { key: "qc", label: "接待质检" },
          { key: "dashboard", label: "获客看板" },
        ]}
        value={tab}
        onChange={(key) => setTab(key as "qc" | "dashboard")}
      />
      {tab === "qc" ? <QcPanel tick={tick} /> : <DashboardPanel tick={tick} />}
    </Space>
  );
}

function QcPanel({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AcqQcReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [playbookId, setPlaybookId] = useState<number | undefined>();
  const [maxScore, setMaxScore] = useState<number | undefined>();
  const [playbooks, setPlaybooks] = useState<AcqPlaybook[]>([]);

  const [runOpen, setRunOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [conversations, setConversations] = useState<ConversationOption[]>([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [targetConversation, setTargetConversation] = useState<number | undefined>();
  const [targetPlaybook, setTargetPlaybook] = useState<number | undefined>();

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<QcDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    acqApi
      .playbooks({ query: { page: 1, pageSize: 100 } })
      .then((result) => setPlaybooks(result?.list ?? []))
      .catch(() => setPlaybooks([]));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await acqApi.qcReviews({
        query: {
          page,
          pageSize,
          ...(playbookId ? { playbookId } : {}),
          ...(maxScore !== undefined ? { maxScore } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "质检记录读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, playbookId, maxScore, message]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  const openRun = () => {
    setRunOpen(true);
    setTargetConversation(undefined);
    setTargetPlaybook(undefined);
    if (conversations.length) return;
    setConversationLoading(true);
    serviceDeskConversations({ query: { page: 1, pageSize: 50 } })
      .then((result) => {
        setConversations(
          (result?.list ?? []).map((item) => ({
            id: item.id,
            subject: item.subject,
            visitorName: item.visitorName,
            statusLabel: item.statusLabel,
          })),
        );
      })
      .catch(() => setConversations([]))
      .finally(() => setConversationLoading(false));
  };

  const run = async () => {
    if (!targetConversation) {
      message.warning("请先选择要质检的会话");
      return;
    }
    setRunning(true);
    try {
      const review = await acqApi.runQc({
        body: {
          conversationId: targetConversation,
          ...(targetPlaybook ? { playbookId: targetPlaybook } : {}),
        },
      });
      if (!review) {
        message.error("质检失败：接口未返回结果");
        return;
      }
      message.success(`质检完成，得分 ${review.score}`);
      setRunOpen(false);
      void reload();
    } catch (error) {
      message.error((error as Error).message || "质检失败");
    } finally {
      setRunning(false);
    }
  };

  const openDetail = async (row: AcqQcReview) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const result = await acqApi.qcDetail({ params: { id: row.id } });
      setDetail(result);
    } catch (error) {
      message.error((error as Error).message || "质检详情读取失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: TableProps<AcqQcReview>["columns"] = [
    { title: "记录号", dataIndex: "id", width: 80 },
    { title: "会话", dataIndex: "conversationId", width: 90 },
    {
      title: "顾问",
      dataIndex: "agentUserId",
      width: 130,
      render: (value: string) => value || "未分配",
    },
    {
      title: "剧本",
      dataIndex: "playbookId",
      width: 160,
      render: (value: number) =>
        playbooks.find((item) => item.id === value)?.name || (value ? `#${value}` : "默认"),
    },
    {
      title: "得分",
      dataIndex: "score",
      width: 100,
      render: (value: number) => <Tag color={scoreColor(value)}>{value} / 100</Tag>,
    },
    {
      title: "模式",
      dataIndex: "mode",
      width: 100,
      render: (value: string) => modeLabel(value),
    },
    {
      title: "质检时间",
      dataIndex: "createdAt",
      width: 170,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      render: (_, row) => (
        <Button size="small" onClick={() => void openDetail(row)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <Panel
      title="接待质检"
      extra={
        <Space wrap>
          <Select
            allowClear
            placeholder="按剧本筛选"
            style={{ width: 180 }}
            value={playbookId}
            onChange={(value) => {
              setPlaybookId(value);
              setPage(1);
            }}
            options={playbooks.map((item) => ({ value: item.id, label: item.name }))}
          />
          <InputNumber
            min={0}
            max={100}
            placeholder="分数上限"
            style={{ width: 120 }}
            value={maxScore}
            onChange={(value) => {
              setMaxScore(typeof value === "number" ? value : undefined);
              setPage(1);
            }}
          />
          <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined aria-hidden />}
            onClick={openRun}
          >
            发起质检
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Notice variant="info">
          质检按五维（需求识别、信息完整、边界合规、推进节奏、情绪处理）各 20 分打分，
          每次质检按「acq_qc」计费一次；有模型走模型，无模型自动回落到可解释的规则打分。
        </Notice>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (value) => `共 ${value} 条`,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
        />
      </Space>

      <Modal
        title="发起接待质检"
        open={runOpen}
        confirmLoading={running}
        okText="开始质检"
        onOk={() => void run()}
        onCancel={() => setRunOpen(false)}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Select
            showSearch
            allowClear
            loading={conversationLoading}
            placeholder="选择服务台会话（最近 50 个）"
            style={{ width: "100%" }}
            value={targetConversation}
            optionFilterProp="label"
            onChange={(value) => setTargetConversation(value)}
            options={conversations.map((item) => ({
              value: item.id,
              label: `#${item.id} ${item.subject || item.visitorName}（${item.statusLabel}）`,
            }))}
          />
          <Select
            allowClear
            placeholder="质检剧本（默认用组织默认剧本）"
            style={{ width: "100%" }}
            value={targetPlaybook}
            onChange={(value) => setTargetPlaybook(value)}
            options={playbooks.map((item) => ({ value: item.id, label: item.name }))}
          />
          <Notice>会话需要有文本消息；质检结果会落一条记录并计入组织用量。</Notice>
        </Space>
      </Modal>

      <Drawer
        title="质检详情"
        size={720}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading}
      >
        {detail ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="会话" span={2}>
                {detail.conversationTitle}（#{detail.conversationId}）
              </Descriptions.Item>
              <Descriptions.Item label="顾问">
                {detail.agentUserId || "未分配"}
              </Descriptions.Item>
              <Descriptions.Item label="剧本">
                {playbooks.find((item) => item.id === detail.playbookId)?.name ||
                  (detail.playbookId ? `#${detail.playbookId}` : "默认")}
              </Descriptions.Item>
              <Descriptions.Item label="总分">
                <Tag color={scoreColor(detail.score)}>{detail.score} / 100</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="模式">{modeLabel(detail.mode)}</Descriptions.Item>
              <Descriptions.Item label="质检时间" span={2}>
                {fmtTime(detail.createdAt)}
              </Descriptions.Item>
            </Descriptions>

            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={detail.dimensions}
              columns={[
                {
                  title: "维度",
                  dataIndex: "key",
                  width: 120,
                  render: (key: string, row) => qcDimensionLabel(key) || row.name,
                },
                {
                  title: "得分",
                  dataIndex: "score",
                  width: 200,
                  render: (value: number) => (
                    <Progress
                      percent={Math.round((value / 20) * 100)}
                      size="small"
                      format={() => `${value}/20`}
                    />
                  ),
                },
                { title: "依据", dataIndex: "note" },
              ]}
            />

            <div>
              <Typography.Title level={5}>问题与改写</Typography.Title>
              {detail.issues.length ? (
                <Table
                  rowKey={(row) => `${row.dimension}-${row.quote}`}
                  size="small"
                  pagination={false}
                  dataSource={detail.issues}
                  columns={[
                    { title: "维度", dataIndex: "dimension", width: 100 },
                    { title: "原话", dataIndex: "quote", width: 220 },
                    { title: "问题", dataIndex: "problem", width: 200 },
                    { title: "改写建议", dataIndex: "rewrite" },
                  ]}
                />
              ) : (
                <Typography.Text type="secondary">未发现问题。</Typography.Text>
              )}
            </div>

            {detail.suggestions.length ? (
              <div>
                <Typography.Title level={5}>改进建议</Typography.Title>
                {detail.suggestions.map((item, index) => (
                  <Typography.Paragraph key={index} style={{ marginBottom: 6 }}>
                    {index + 1}. {item}
                  </Typography.Paragraph>
                ))}
              </div>
            ) : null}

            <div>
              <Typography.Title level={5}>会话记录</Typography.Title>
              {detail.messages.length ? (
                detail.messages.map((item, index) => (
                  <div key={index} style={{ marginBottom: 10 }}>
                    <Tag>{ROLE_LABELS[item.role] || item.role}</Tag>
                    <span className="text-12 muted">{fmtTime(item.at)}</span>
                    <div>{item.text}</div>
                  </div>
                ))
              ) : (
                <Typography.Text type="secondary">会话没有文本消息。</Typography.Text>
              )}
            </div>
          </Space>
        ) : null}
      </Drawer>
    </Panel>
  );
}

function DashboardPanel({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [data, setData] = useState<AcqDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(29, "day"),
    dayjs(),
  ]);
  const [platform, setPlatform] = useState<string | undefined>();
  const [playbookId, setPlaybookId] = useState<number | undefined>();
  const [playbooks, setPlaybooks] = useState<AcqPlaybook[]>([]);
  const [exporting, setExporting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState<{ url: string; expiresAt: string } | null>(
    null,
  );
  const [shareForm] = Form.useForm();

  useEffect(() => {
    acqApi
      .playbooks({ query: { page: 1, pageSize: 100 } })
      .then((result) => setPlaybooks(result?.list ?? []))
      .catch(() => setPlaybooks([]));
  }, []);

  const scope = useMemo(
    () => ({
      from: range[0].format("YYYY-MM-DD"),
      to: range[1].format("YYYY-MM-DD"),
      ...(platform ? { platform } : {}),
      ...(playbookId ? { playbookId } : {}),
    }),
    [range, platform, playbookId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await acqApi.dashboard({ query: scope });
      setData(result);
    } catch (error) {
      message.error((error as Error).message || "获客看板读取失败");
    } finally {
      setLoading(false);
    }
  }, [scope, message]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  const exportData = async (format: "csv" | "json") => {
    setExporting(true);
    try {
      const job = await acqApi.dashboardExport({ body: { ...scope, format } });
      if (!job) {
        message.error("导出失败：接口未返回任务");
        return;
      }
      if (job.downloadUrl) {
        window.open(job.downloadUrl, "_blank", "noopener,noreferrer");
        message.success("导出完成，已打开下载");
      } else {
        message.success(`导出任务已创建（#${job.jobId}），生成后可到导出中心下载`);
      }
    } catch (error) {
      message.error((error as Error).message || "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const share = async () => {
    const values = await shareForm.validateFields();
    setSharing(true);
    try {
      const result = await acqApi.dashboardShare({
        body: {
          ...scope,
          expiresInDays: Number(values.expiresInDays) || 7,
          password: String(values.password || ""),
        },
      });
      if (!result) {
        message.error("生成分享链接失败：接口未返回结果");
        return;
      }
      setShareResult({ url: result.url, expiresAt: result.expiresAt });
      message.success("分享链接已生成");
    } catch (error) {
      message.error((error as Error).message || "生成分享链接失败");
    } finally {
      setSharing(false);
    }
  };

  const channelColumns: TableProps<AcqDashboard["channels"][number]>["columns"] = [
    { title: "来源", dataIndex: "label" },
    { title: "线索", dataIndex: "leads", width: 80 },
    { title: "已触达", dataIndex: "contacted", width: 90 },
    { title: "已回复", dataIndex: "replied", width: 90 },
    { title: "商机", dataIndex: "qualified", width: 80 },
    { title: "转成交", dataIndex: "promoted", width: 90 },
    {
      title: "转化率",
      dataIndex: "conversionRate",
      width: 100,
      render: (value: number) => fmtPct(value),
    },
  ];

  return (
    <Panel
      title="获客看板"
      extra={
        <Space wrap>
          <DatePicker.RangePicker
            allowClear={false}
            value={range}
            onChange={(value) => {
              if (value && value[0] && value[1]) setRange([value[0], value[1]]);
            }}
          />
          <Select
            allowClear
            placeholder="全部来源"
            style={{ width: 150 }}
            value={platform}
            onChange={(value) => setPlatform(value)}
            options={platformOptions}
          />
          <Select
            allowClear
            placeholder="全部剧本"
            style={{ width: 160 }}
            value={playbookId}
            onChange={(value) => setPlaybookId(value)}
            options={playbooks.map((item) => ({ value: item.id, label: item.name }))}
          />
          <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()}>
            刷新
          </Button>
          <Dropdown
            disabled={exporting}
            menu={{
              items: [
                { key: "csv", label: "导出 CSV" },
                { key: "json", label: "导出 JSON" },
              ],
              onClick: ({ key }) => void exportData(key as "csv" | "json"),
            }}
          >
            <Button loading={exporting} icon={<CloudDownloadOutlined aria-hidden />}>
              导出
            </Button>
          </Dropdown>
          <Button
            icon={<ShareAltOutlined aria-hidden />}
            onClick={() => {
              setShareResult(null);
              shareForm.setFieldsValue({ expiresInDays: 7, password: "" });
              setShareOpen(true);
            }}
          >
            分享
          </Button>
        </Space>
      }
    >
      {data ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Notice variant="info">
            统计区间：{data.range.from} ~ {data.range.to}。成本按组织成员在「获客」板块的用量事实汇总。
          </Notice>

          <div>
            <Typography.Title level={5}>获客漏斗</Typography.Title>
            <StatGrid>
              {data.funnel.map((item) => (
                <StatCard
                  key={item.stage}
                  label={item.label}
                  value={item.count}
                  hint={`转化 ${fmtPct(item.rate)}`}
                />
              ))}
            </StatGrid>
          </div>

          <div>
            <Typography.Title level={5}>渠道转化</Typography.Title>
            <Table
              rowKey="key"
              size="small"
              loading={loading}
              pagination={false}
              dataSource={data.channels}
              columns={channelColumns}
            />
          </div>

          <div>
            <Typography.Title level={5}>触达质量</Typography.Title>
            <StatGrid>
              <StatCard label="已发送" value={data.outreach.sent} />
              <StatCard label="成功" value={data.outreach.succeeded} />
              <StatCard label="失败" value={data.outreach.failed} />
              <StatCard label="结果未知" value={data.outreach.unknown} />
              <StatCard label="跳过" value={data.outreach.skipped} />
              <StatCard label="内容安全拦截" value={data.outreach.moderationBlocked} />
              <StatCard label="成功率" value={fmtPct(data.outreach.successRate)} />
            </StatGrid>
            {data.outreach.reasons.length ? (
              <Table
                rowKey="reason"
                size="small"
                style={{ marginTop: 12 }}
                pagination={false}
                dataSource={data.outreach.reasons}
                columns={[
                  { title: "拦截 / 失败原因", dataIndex: "reason" },
                  { title: "次数", dataIndex: "count", width: 100 },
                ]}
              />
            ) : null}
          </div>

          <div>
            <Typography.Title level={5}>跟进</Typography.Title>
            <StatGrid>
              <StatCard label="待执行" value={data.followUp.due} />
              <StatCard label="已发首轮" value={data.followUp.sentOnce} />
              <StatCard label="已完成" value={data.followUp.completed} />
              <StatCard label="已逾期" value={data.followUp.overdue} />
              <StatCard
                label="二轮占比"
                value={fmtPct(data.followUp.secondRoundRatio)}
              />
            </StatGrid>
          </div>

          <div>
            <Typography.Title level={5}>成本</Typography.Title>
            <StatGrid>
              <StatCard label="AI 调用" value={data.cost.aiCalls} />
              <StatCard label="总积分" value={fmtPoints(data.cost.points)} />
              <StatCard label="触达次数" value={data.cost.outreachCount} />
              <StatCard label="单线索积分" value={data.cost.costPerLead} />
            </StatGrid>
            {data.cost.byCode.length ? (
              <Table
                rowKey="code"
                size="small"
                style={{ marginTop: 12 }}
                pagination={false}
                dataSource={data.cost.byCode}
                columns={[
                  { title: "计费科目", dataIndex: "label" },
                  { title: "调用", dataIndex: "calls", width: 100 },
                  {
                    title: "积分",
                    dataIndex: "points",
                    width: 120,
                    render: (value: number) => fmtPoints(value),
                  },
                ]}
              />
            ) : null}
          </div>
        </Space>
      ) : (
        <Notice variant={loading ? "info" : "warn"}>
          {loading ? "正在汇总获客数据…" : "暂无数据，调整时间区间或筛选后重试。"}
        </Notice>
      )}

      <Modal
        title="分享获客看板"
        open={shareOpen}
        confirmLoading={sharing}
        okText="生成链接"
        onOk={() => void share()}
        onCancel={() => setShareOpen(false)}
      >
        <Form form={shareForm} layout="vertical">
          <Form.Item
            name="expiresInDays"
            label="有效期（天）"
            rules={[{ required: true, message: "请输入有效期" }]}
          >
            <InputNumber min={1} max={90} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="password" label="访问密码（可选）">
            <Input maxLength={60} placeholder="留空表示凭链接直接打开" />
          </Form.Item>
        </Form>
        {shareResult ? (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text copyable={{ text: shareResult.url }}>
              {shareResult.url}
            </Typography.Text>
            <Typography.Text type="secondary">
              有效期至 {fmtTime(shareResult.expiresAt)}
            </Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </Panel>
  );
}
