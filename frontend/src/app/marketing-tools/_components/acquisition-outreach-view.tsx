"use client";

import {
  AuditOutlined,
  FileSearchOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { AcqLeadPicker } from "./acquisition-pickers";
import {
  acqApi,
  outreachActionLabel,
  outreachChannelLabel,
  outreachStatusLabel,
  OUTREACH_STATUS_COLOR,
  receiptStatusLabel,
  platformLabel,
  type AcqOutreach,
  type AcqPlaybook,
} from "./acquisition-common";

/**
 * 触达编排：先产草稿（AI/规则/人工），再审核入队；插件执行后逐条回执。
 * 风控顺序：退订/黑名单/竞品/已成交 → 频控 → 内容安全 → 入队，任一拦截都留原因。
 */

const CHANNELS = [
  { value: "XHS_DM", label: "小红书私信", action: "DM", executor: "插件" },
  { value: "DOUYIN_COMMENT", label: "抖音评论", action: "COMMENT", executor: "插件" },
  { value: "EMAIL", label: "邮件", action: "EMAIL", executor: "服务端" },
  { value: "WECOM", label: "企业微信", action: "FRIEND_REQUEST", executor: "服务端" },
];
const CHANNEL_OPTIONS = CHANNELS.map((item) => ({ value: item.value, label: item.label }));
const STATUS_OPTIONS = [
  "DRAFT",
  "APPROVED",
  "QUEUED",
  "SENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
  "SKIPPED",
].map((value) => ({ value, label: outreachStatusLabel(value) }));
const RECEIPT_OPTIONS = ["submitted", "succeeded", "failed", "unknown"].map((value) => ({
  value,
  label: receiptStatusLabel(value),
}));

type Draft = { angle: string; text: string; why: string };

export function AcquisitionOutreachView({
  tick,
  playbooks,
}: {
  tick: number;
  playbooks: AcqPlaybook[];
}) {
  const { message } = App.useApp();

  const [rows, setRows] = useState<AcqOutreach[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filterChannel, setFilterChannel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterReceipt, setFilterReceipt] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const channel = Form.useWatch("channel", createForm) as string | undefined;

  const [approveTarget, setApproveTarget] = useState<AcqOutreach | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [approveText, setApproveText] = useState("");
  const [scheduled, setScheduled] = useState<dayjs.Dayjs | null>(null);
  const [wecomPayload, setWecomPayload] = useState("");
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [approving, setApproving] = useState(false);

  const [logTarget, setLogTarget] = useState<AcqOutreach | null>(null);
  const [logs, setLogs] = useState<{ at: string; step: string; result: string; detail: string }[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await acqApi.outreach({
        query: {
          page,
          pageSize,
          ...(filterChannel ? { channel: filterChannel } : {}),
          ...(filterStatus ? { status: filterStatus } : {}),
          ...(filterReceipt ? { receiptStatus: filterReceipt } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "触达任务读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterChannel, filterStatus, filterReceipt, message]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  const openCreate = () => {
    createForm.resetFields();
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const created = await acqApi.createOutreach({
        body: {
          leadId: Number(values.leadId),
          channel: values.channel,
          targetUrl: values.targetUrl ?? "",
          externalUserId: values.externalUserId ?? "",
          ...(values.playbookId ? { playbookId: values.playbookId } : {}),
          text: values.text ?? "",
          generate: values.generate !== false,
          scheduledAt: values.scheduledAt
            ? values.scheduledAt.format("YYYY-MM-DD HH:mm:ss")
            : "",
          autoApprove: Boolean(values.autoApprove),
        },
      });
      if (!created) {
        message.error("创建触达失败：接口未返回任务");
        return;
      }
      setCreateOpen(false);
      void reload();
      if (created.blocked) {
        message.warning(`已生成草稿但被风控拦截：${created.blocked}`);
        return;
      }
      if (created.status === "QUEUED") {
        message.success("草稿已按自动审核入队，等待插件执行");
        return;
      }
      // 新建只产草稿：直接把生成的多版草稿带进审核弹窗，少走一步。
      setApproveTarget(created);
      setDrafts(created.drafts ?? []);
      setApproveText(created.drafts?.[0]?.text || created.finalText || created.draft);
      setScheduled(null);
      setWecomPayload("");
      setCostConfirmed(false);
      message.success(
        `已生成 ${created.drafts?.length ?? 1} 版草稿（${created.mode === "llm" ? "AI" : "规则"}），请审核后入队`,
      );
    } catch (error) {
      message.error((error as Error).message || "创建触达失败");
    } finally {
      setCreating(false);
    }
  };

  const openApprove = (row: AcqOutreach) => {
    setApproveTarget(row);
    setDrafts([
      {
        angle: "当前草稿",
        text: row.finalText || row.draft,
        why: row.blockedReason ? `当前拦截原因：${row.blockedReason}` : "",
      },
    ]);
    setApproveText(row.finalText || row.draft);
    setScheduled(row.scheduledAt ? dayjs(row.scheduledAt) : null);
    setWecomPayload("");
    setCostConfirmed(false);
  };

  const submitApprove = async () => {
    if (!approveTarget) return;
    if (!approveText.trim()) {
      message.warning("审核正文不能为空");
      return;
    }
    let payload: Record<string, unknown> = {};
    if (approveTarget.channel === "WECOM") {
      try {
        payload = wecomPayload.trim() ? JSON.parse(wecomPayload) : {};
      } catch {
        message.error("企微群发字段必须是合法 JSON");
        return;
      }
      if (!Object.keys(payload).length) {
        message.warning("企微群发需要填写企点「群发任务」接口字段");
        return;
      }
      if (!costConfirmed) {
        message.warning("请勾选确认：企微群发会产生真实发送与额度消耗");
        return;
      }
    }
    setApproving(true);
    try {
      const result = await acqApi.approveOutreach({
        params: { id: approveTarget.id },
        body: {
          finalText: approveText,
          scheduledAt: scheduled ? scheduled.format("YYYY-MM-DD HH:mm:ss") : "",
          payload,
          confirmCost: costConfirmed,
        },
      });
      if (!result) {
        message.error("审核失败：接口未返回结果");
        return;
      }
      if (result.status === "SKIPPED") {
        message.warning(`审核被风控拦截：${result.blockedReason || "请查看日志"}`);
      } else {
        message.success(
          result.status === "QUEUED"
            ? "已审核入队：插件会在活跃时段按随机间隔执行"
            : `已更新为${outreachStatusLabel(result.status)}`,
        );
      }
      setApproveTarget(null);
      void reload();
    } catch (error) {
      message.error((error as Error).message || "审核失败");
    } finally {
      setApproving(false);
    }
  };

  const cancel = async (row: AcqOutreach) => {
    try {
      await acqApi.cancelOutreach({
        params: { id: row.id },
        body: { reason: "人工取消" },
      });
      message.success("已取消任务");
      void reload();
    } catch (error) {
      message.error((error as Error).message || "取消失败");
    }
  };

  const openLogs = async (row: AcqOutreach) => {
    setLogTarget(row);
    setLogsOpen(true);
    try {
      const result = await acqApi.outreachLogs({ params: { id: row.id } });
      setLogs(result ?? []);
    } catch (error) {
      message.error((error as Error).message || "日志读取失败");
    }
  };

  const columns = [
    {
      title: "线索",
      dataIndex: "leadNickname",
      render: (value: string, row: AcqOutreach) => (
        <Space orientation="vertical" size={0}>
          <span>{value || `线索 #${row.leadId}`}</span>
          <span className="text-12 muted">{platformLabel(row.platform)}</span>
        </Space>
      ),
    },
    {
      title: "渠道",
      dataIndex: "channel",
      width: 150,
      render: (value: string, row: AcqOutreach) => (
        <Space orientation="vertical" size={0}>
          <span>{outreachChannelLabel(value)}</span>
          <span className="text-12 muted">{outreachActionLabel(row.action)}</span>
        </Space>
      ),
    },
    {
      title: "正文",
      dataIndex: "finalText",
      ellipsis: true,
      render: (value: string, row: AcqOutreach) => (
        <span className="text-12">{value || row.draft || "-"}</span>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (value: string, row: AcqOutreach) => (
        <Space orientation="vertical" size={2}>
          <Tag color={OUTREACH_STATUS_COLOR[value] || "default"}>
            {outreachStatusLabel(value)}
          </Tag>
          {row.blockedReason ? (
            <span className="text-12" style={{ color: "var(--danger, #d4380d)" }}>
              {row.blockedReason}
            </span>
          ) : null}
        </Space>
      ),
    },
    {
      title: "回执",
      dataIndex: "receiptStatus",
      width: 110,
      render: (value: string) =>
        value ? <Tag>{receiptStatusLabel(value)}</Tag> : <span className="muted">-</span>,
    },
    {
      title: "计划 / 发送",
      width: 160,
      render: (_: unknown, row: AcqOutreach) => (
        <Space orientation="vertical" size={0}>
          {row.scheduledAt ? (
            <span className="text-12">计划 {fmtTime(row.scheduledAt)}</span>
          ) : null}
          {row.sentAt ? <span className="text-12">发送 {fmtTime(row.sentAt)}</span> : null}
          {!row.scheduledAt && !row.sentAt ? <span className="muted">-</span> : null}
        </Space>
      ),
    },
    {
      title: "操作",
      width: 260,
      render: (_: unknown, row: AcqOutreach) => {
        const canApprove = ["DRAFT", "FAILED", "APPROVED"].includes(row.status);
        const canCancel = ["DRAFT", "APPROVED", "QUEUED", "FAILED"].includes(row.status);
        return (
          <Space size={4} wrap>
            <Button
              type="primary"
              size="small"
              icon={<AuditOutlined aria-hidden />}
              disabled={!canApprove}
              onClick={() => openApprove(row)}
            >
              审核
            </Button>
            <Button size="small" icon={<FileSearchOutlined aria-hidden />} onClick={() => void openLogs(row)}>
              日志
            </Button>
            <Popconfirm
              title="取消这条触达任务？"
              description="取消后不再执行；已经发出的消息无法撤回。"
              onConfirm={() => void cancel(row)}
              disabled={!canCancel}
            >
              <Button size="small" danger icon={<StopOutlined aria-hidden />} disabled={!canCancel} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="触达任务"
        titleExtra="草稿 → 审核 → 入队 → 插件执行 → 回执；私信类默认必须人工审核"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={openCreate}>
              新建触达
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="渠道"
            style={{ width: 140 }}
            value={filterChannel || undefined}
            options={CHANNEL_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setFilterChannel(value ?? "");
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 140 }}
            value={filterStatus || undefined}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setFilterStatus(value ?? "");
            }}
          />
          <Select
            allowClear
            placeholder="回执状态"
            style={{ width: 130 }}
            value={filterReceipt || undefined}
            options={RECEIPT_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setFilterReceipt(value ?? "");
            }}
          />
        </Space>
        <Table<AcqOutreach>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 1080 }}
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
          locale={{ emptyText: "还没有触达任务：从线索池选一条线索新建，或先完成采集" }}
        />
      </Panel>

      <Modal
        title="新建触达"
        open={createOpen}
        width={680}
        confirmLoading={creating}
        okText="生成草稿"
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ channel: "XHS_DM", generate: true, autoApprove: false }}
        >
          <Form.Item name="leadId" label="线索" rules={[{ required: true, message: "请选择线索" }]}>
            <AcqLeadPicker />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="channel" label="渠道">
              <Select
                options={CHANNELS.map((item) => ({
                  value: item.value,
                  label: `${item.label}（${item.executor}执行）`,
                }))}
              />
            </Form.Item>
            <Form.Item name="playbookId" label="销售剧本（选填）">
              <Select
                allowClear
                placeholder="默认用系统默认剧本"
                options={playbooks.map((item) => ({
                  value: item.id,
                  label: `${item.name}（${item.status === "PUBLISHED" ? "已发布" : "草稿"}）`,
                }))}
              />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item
              name="targetUrl"
              label="目标链接（评论必填）"
              tooltip="私信留空时用线索主页或首条证据；评论必须落到具体内容页"
            >
              <Input placeholder="https://..." maxLength={500} />
            </Form.Item>
            <Form.Item
              name="externalUserId"
              label="平台 / 企微用户 ID（选填）"
              tooltip="留空时用线索的平台用户 ID"
            >
              <Input maxLength={160} />
            </Form.Item>
          </div>
          <Form.Item
            name="text"
            label="触达正文（选填）"
            extra="留空则由 AI 按线索证据与销售剧本生成 3 版草稿；填写则原样使用（不再改写）"
          >
            <Input.TextArea rows={4} maxLength={4000} showCount />
          </Form.Item>
          <Form.Item
            name="scheduledAt"
            label="计划发送时间（选填）"
            extra="留空按频控自动排到下一个可用时间；插件执行时仍会在活跃时段内"
          >
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="generate" label="自动生成草稿" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="autoApprove"
              label="自动审核入队"
              valuePropName="checked"
              tooltip="仅对非私信、非人工确认渠道生效；默认人工审核"
            >
              <Switch />
            </Form.Item>
          </div>
          {channel === "WECOM" ? (
            <Notice variant="warn">
              企微渠道是「群发任务」：审核时需要填写企点接口字段并确认额度消耗；
              客户名单与员工范围在企点侧生效，请先在「腾讯企点·企微运营」核对人群。
            </Notice>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title={`审核触达 · ${approveTarget ? outreachChannelLabel(approveTarget.channel) : ""}`}
        open={!!approveTarget}
        width={680}
        confirmLoading={approving}
        okText="审核并入队"
        onOk={() => void submitApprove()}
        onCancel={() => setApproveTarget(null)}
      >
        {approveTarget ? (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "lead",
                  label: "线索",
                  children: `${approveTarget.leadNickname || `#${approveTarget.leadId}`}（${platformLabel(approveTarget.platform)}）`,
                },
                {
                  key: "channel",
                  label: "渠道",
                  children: `${outreachChannelLabel(approveTarget.channel)} · ${outreachActionLabel(approveTarget.action)}`,
                },
                {
                  key: "moderation",
                  label: "内容审核",
                  children:
                    approveTarget.moderation === "pass"
                      ? "通过"
                      : approveTarget.moderation === "off"
                        ? "未开启"
                        : `${approveTarget.moderation}${
                            approveTarget.moderationNote ? `：${approveTarget.moderationNote}` : ""
                          }`,
                },
              ]}
            />
            {drafts.length > 1 ? (
              <Radio.Group
                value={approveText}
                onChange={(event) => setApproveText(event.target.value)}
                style={{ display: "grid", gap: 8 }}
              >
                {drafts.map((draft, index) => (
                  <Radio key={`${draft.angle}-${index}`} value={draft.text}>
                    <Space orientation="vertical" size={0}>
                      <span>
                        {index + 1}. {draft.angle}
                      </span>
                      <span className="text-12">{draft.text}</span>
                      {draft.why ? <span className="text-12 muted">{draft.why}</span> : null}
                    </Space>
                  </Radio>
                ))}
              </Radio.Group>
            ) : null}
            <Input.TextArea
              rows={4}
              value={approveText}
              onChange={(event) => setApproveText(event.target.value)}
              maxLength={4000}
              showCount
            />
            <DatePicker
              showTime
              style={{ width: "100%" }}
              placeholder="计划发送时间（留空按频控自动排队）"
              value={scheduled}
              onChange={setScheduled}
            />
            {approveTarget.channel === "WECOM" ? (
              <>
                <Input.TextArea
                  rows={4}
                  value={wecomPayload}
                  onChange={(event) => setWecomPayload(event.target.value)}
                  placeholder='企点「群发任务」接口字段（JSON），如 {"taskName":"...","templateId":"..."}'
                />
                <Checkbox
                  checked={costConfirmed}
                  onChange={(event) => setCostConfirmed(event.target.checked)}
                >
                  我确认：会创建真实的企微群发任务并消耗额度
                </Checkbox>
              </>
            ) : null}
            <Typography.Text type="secondary" className="text-12">
              审核会依次做退订/黑名单/竞品/已成交、频控、冷却与内容安全检查；被拦截会落 SKIPPED 并写明原因。
            </Typography.Text>
          </Space>
        ) : null}
      </Modal>

      <Drawer
        title={`触达日志 · ${logTarget ? `#${logTarget.id}` : ""}`}
        open={logsOpen}
        size={560}
        onClose={() => setLogsOpen(false)}
      >
        <Table
          rowKey={(row) => `${row.at}-${row.step}-${row.result}`}
          size="small"
          dataSource={logs}
          pagination={false}
          columns={[
            { title: "时间", dataIndex: "at", width: 150, render: (value: string) => fmtTime(value) },
            { title: "步骤", dataIndex: "step", width: 90 },
            { title: "结果", dataIndex: "result", width: 110 },
            { title: "说明", dataIndex: "detail" },
          ]}
          locale={{ emptyText: "暂无日志" }}
        />
      </Drawer>
    </Space>
  );
}
