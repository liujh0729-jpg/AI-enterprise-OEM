"use client";

import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { ACQ_OUTREACH_CHANNELS } from "@enterprise/contracts";
import { Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { AcqProfilePicker } from "./acquisition-pickers";
import {
  acqApi,
  followUpStatusLabel,
  followUpTimeRuleLabel,
  followUpTimeRuleOptions,
  outreachChannelLabel,
  receiptStatusLabel,
  type AcqFollowUp,
  type AcqPlaybook,
} from "./acquisition-common";

/**
 * 跟进计划：客户说「明天/下周/等发工资」等时间点时落一条计划，
 * 调度器到点让插件按原会话渠道发一次跟进；同一客户新建计划会自动取消旧计划。
 */

const FOLLOW_UP_CHANNELS = ["XHS_DM", "EMAIL", "WECOM"].map((value) => ({
  value,
  label: outreachChannelLabel(value),
}));
const STATUS_OPTIONS = ["pending", "sent_once", "completed", "cancelled"].map((value) => ({
  value,
  label: followUpStatusLabel(value),
}));
const STATUS_COLOR: Record<string, string> = {
  pending: "processing",
  sent_once: "blue",
  completed: "success",
  cancelled: "default",
};

export function AcquisitionFollowUpsView({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AcqFollowUp[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await acqApi.followUps({
        query: {
          page,
          pageSize,
          ...(filterStatus ? { status: filterStatus } : {}),
          ...(onlyDue ? { due: true } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "跟进计划读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterStatus, onlyDue, message]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  const complete = async (row: AcqFollowUp) => {
    setBusy(row.id);
    try {
      const result = await acqApi.completeFollowUp({
        params: { id: row.id },
        body: { reason: "人工完成" },
      });
      const receipts = result?.receipts ?? [];
      message.success(
        receipts.length
          ? `已发送并完成：${receipts.map((item) => receiptStatusLabel(item.status)).join("、")}`
          : "已完成跟进",
      );
      void reload();
    } catch (error) {
      message.error((error as Error).message || "完成失败");
    } finally {
      setBusy(0);
    }
  };

  const cancel = async (row: AcqFollowUp) => {
    setBusy(row.id);
    try {
      await acqApi.cancelFollowUp({
        params: { id: row.id },
        body: { reason: "人工取消" },
      });
      message.success("已取消跟进计划");
      void reload();
    } catch (error) {
      message.error((error as Error).message || "取消失败");
    } finally {
      setBusy(0);
    }
  };

  const columns = [
    {
      title: "客户",
      dataIndex: "profileName",
      render: (value: string, row: AcqFollowUp) => (
        <Space orientation="vertical" size={0}>
          <span>{value || `档案 #${row.profileId}`}</span>
          <span className="text-12 muted">{row.channelPeerKey || "-"}</span>
        </Space>
      ),
    },
    {
      title: "渠道",
      dataIndex: "channel",
      width: 130,
      render: (value: string) => outreachChannelLabel(value),
    },
    {
      title: "计划时间",
      dataIndex: "followUpAt",
      width: 170,
      render: (value: string, row: AcqFollowUp) => {
        const overdue =
          row.status === "pending" && value && dayjs(value).isBefore(dayjs());
        return (
          <Space size={6}>
            <span>{value ? fmtTime(value) : "-"}</span>
            {overdue ? <Tag color="error">已逾期</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: "原因",
      dataIndex: "reason",
      render: (value: string, row: AcqFollowUp) => (
        <Space orientation="vertical" size={0}>
          <span className="text-12">{value || "-"}</span>
          {row.sentText ? (
            <span className="text-12 muted">已发：{row.sentText}</span>
          ) : row.contextSummary ? (
            <span className="text-12 muted">{row.contextSummary}</span>
          ) : null}
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: string, row: AcqFollowUp) => (
        <Space orientation="vertical" size={2}>
          <Tag color={STATUS_COLOR[value] || "default"}>{followUpStatusLabel(value)}</Tag>
          {row.retryCount ? (
            <span className="text-12 muted">已催 {row.retryCount} 次</span>
          ) : null}
        </Space>
      ),
    },
    {
      title: "操作",
      width: 220,
      render: (_: unknown, row: AcqFollowUp) => (
        <Space size={4} wrap>
          <Button
            type="primary"
            size="small"
            icon={<CheckCircleOutlined aria-hidden />}
            loading={busy === row.id}
            disabled={row.status !== "pending" && row.status !== "sent_once"}
            onClick={() => void complete(row)}
          >
            立即完成并发送
          </Button>
          <Popconfirm
            title="取消这条跟进计划？"
            onConfirm={() => void cancel(row)}
            disabled={!["pending", "sent_once"].includes(row.status)}
          >
            <Button
              size="small"
              danger
              icon={<StopOutlined aria-hidden />}
              disabled={!["pending", "sent_once"].includes(row.status)}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="跟进计划"
        titleExtra="到点由插件按原会话渠道发送；发完可继续约下一轮（受最大轮次限制）"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => setModalOpen(true)}>
              新建跟进
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
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
          <Space size={6}>
            <Switch
              checked={onlyDue}
              onChange={(value) => {
                setPage(1);
                setOnlyDue(value);
              }}
            />
            <span className="text-12">只看已到期</span>
          </Space>
        </Space>
        <Table<AcqFollowUp>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 960 }}
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
          locale={{ emptyText: "还没有跟进计划：客户说明天/下周再聊时建一条，或从客户档案直接建" }}
        />
      </Panel>

      <AcqFollowUpModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          void reload();
        }}
      />
    </Space>
  );
}

/**
 * 新建跟进的唯一入口：跟进页与客户档案抽屉共用。
 * profileId 传入时锁定客户；否则显示客户搜索选择器。
 */
export function AcqFollowUpModal({
  open,
  profileId,
  playbooks = [],
  onClose,
  onCreated,
}: {
  open: boolean;
  profileId?: number;
  playbooks?: AcqPlaybook[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [lockedProfile, setLockedProfile] = useState<number | undefined>(profileId);
  const timeRule = Form.useWatch("timeRule", form);

  useEffect(() => {
    if (!open) return;
    setLockedProfile(profileId);
    form.resetFields();
    form.setFieldsValue({
      profileId,
      channel: "XHS_DM",
      timeRule: "TOMORROW",
    });
  }, [open, profileId, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await acqApi.createFollowUp({
        body: {
          profileId: Number(values.profileId),
          channel: ACQ_OUTREACH_CHANNELS.find((item) => item === values.channel) ?? "XHS_DM",
          accountId: values.accountId ?? "",
          timeRule: values.timeRule,
          followUpAt:
            values.timeRule === "EXPLICIT" && values.followUpAt
              ? values.followUpAt.format("YYYY-MM-DD HH:mm:ss")
              : "",
          reason: values.reason,
          contextSummary: values.contextSummary ?? "",
          ...(values.playbookId ? { playbookId: values.playbookId } : {}),
        },
      });
      message.success("已创建跟进计划（同一客户的旧待办自动取消）");
      onCreated();
    } catch (error) {
      message.error((error as Error).message || "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="新建跟进计划"
      open={open}
      confirmLoading={saving}
      okText="创建"
      onOk={() => void submit()}
      onCancel={onClose}
      width={600}
    >
      <Form form={form} layout="vertical">
        {lockedProfile ? null : (
          <Form.Item
            name="profileId"
            label="客户档案"
            rules={[{ required: true, message: "请选择客户档案" }]}
          >
            <AcqProfilePicker />
          </Form.Item>
        )}
        <div className="form-2col">
          <Form.Item name="channel" label="渠道">
            <Select options={FOLLOW_UP_CHANNELS} />
          </Form.Item>
          <Form.Item name="timeRule" label="跟进时间">
            <Select options={followUpTimeRuleOptions} />
          </Form.Item>
        </div>
        {timeRule === "EXPLICIT" ? (
          <Form.Item
            name="followUpAt"
            label="具体时间"
            rules={[{ required: true, message: "请选择具体时间" }]}
          >
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
        ) : null}
        <Form.Item
          name="reason"
          label="跟进原因"
          rules={[{ required: true, message: "请写明客户约定的时间/事项" }]}
        >
          <Input placeholder="如：客户说下周预算下来再聊" maxLength={300} />
        </Form.Item>
        <Form.Item name="contextSummary" label="上下文摘要（选填）">
          <Input.TextArea rows={3} maxLength={4000} placeholder="上次聊到哪一步、客户关注点、已承诺事项" />
        </Form.Item>
        {playbooks.length ? (
          <Form.Item name="playbookId" label="销售剧本（选填）">
            <Select
              allowClear
              options={playbooks.map((item) => ({ value: item.id, label: item.name }))}
              placeholder="默认用系统默认剧本"
            />
          </Form.Item>
        ) : null}
        <Notice variant="info">
          跟进到点后由插件在原会话渠道发送一次；回复仍走服务台。客户再次约定时间时，新计划会自动取代旧的待办。
          当前时间规则：{followUpTimeRuleLabel(timeRule || "TOMORROW")}。
        </Notice>
        <Typography.Text type="secondary" className="text-12">
          <ClockCircleOutlined aria-hidden /> 评论渠道不做回访，因此这里只列私信 / 邮件 / 企微。
        </Typography.Text>
      </Form>
    </Modal>
  );
}
