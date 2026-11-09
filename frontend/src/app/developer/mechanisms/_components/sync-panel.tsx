"use client";

import { DeleteOutlined, PlusOutlined, SendOutlined, SyncOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Table,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { mechanismsApi } from "@/api/mechanisms";
import { EmptyState, Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  SYNC_CHANNEL_LABELS,
  SYNC_DOMAIN_LABELS,
  mechError,
  type SyncBinding,
  type SyncOverview,
} from "./mechanisms-common";

const CHANNEL_OPTIONS = [
  { value: "FEISHU", label: "飞书" },
  { value: "WECOM", label: "企业微信" },
];
const DOMAIN_OPTIONS = Object.entries(SYNC_DOMAIN_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function SyncPanel() {
  const { message } = App.useApp();
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const [bindings, setBindings] = useState<SyncBinding[]>([]);
  const [bindingForm] = Form.useForm();
  const [bindingOpen, setBindingOpen] = useState(false);

  const [contactChannel, setContactChannel] = useState<"FEISHU" | "WECOM">("FEISHU");
  const [dryRun, setDryRun] = useState(true);
  const [attendanceChannel, setAttendanceChannel] = useState<"FEISHU" | "WECOM">("FEISHU");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [running, setRunning] = useState("");

  const [messageOpen, setMessageOpen] = useState(false);
  const [messageForm] = Form.useForm();

  const load = useCallback(async () => {
    const [overviewData, bindingData] = await Promise.all([
      mechanismsApi.syncOverview(),
      mechanismsApi.syncBindings({ query: {} }),
    ]);
    setOverview(overviewData);
    setBindings(bindingData || []);
  }, []);

  useEffect(() => {
    void load().catch((err) => message.error(mechError(err)));
  }, [load, message]);

  const saveBinding = async () => {
    const values = await bindingForm.validateFields();
    try {
      await mechanismsApi.saveSyncBinding({ body: values });
      message.success("绑定关系已保存");
      setBindingOpen(false);
      await load();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const removeBinding = async (row: SyncBinding) => {
    try {
      await mechanismsApi.removeSyncBinding({ body: { id: row.id } });
      message.success("已删除");
      await load();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const runContacts = async () => {
    setRunning("contacts");
    try {
      const result = await mechanismsApi.syncContacts({
        body: { channel: contactChannel, dryRun },
      });
      message.success(
        `通讯录同步${dryRun ? "预演" : ""}完成：处理 ${result?.processed ?? 0}，新增 ${result?.created ?? 0}，更新 ${result?.updated ?? 0}，跳过 ${result?.skipped ?? 0}`,
      );
      if (result?.errors?.length) message.warning(result.errors.slice(0, 3).join("；"));
      await load();
    } catch (err) {
      message.error(mechError(err));
    } finally {
      setRunning("");
    }
  };

  const runAttendance = async () => {
    if (!startDate || !endDate) {
      message.warning("请填写考勤起止日期");
      return;
    }
    setRunning("attendance");
    try {
      const result = await mechanismsApi.syncAttendance({
        body: { channel: attendanceChannel, startDate, endDate },
      });
      message.success(
        `考勤同步完成：处理 ${result?.processed ?? 0}，新增 ${result?.created ?? 0}，更新 ${result?.updated ?? 0}，跳过 ${result?.skipped ?? 0}`,
      );
      if (result?.errors?.length) message.warning(result.errors.slice(0, 3).join("；"));
      await load();
    } catch (err) {
      message.error(mechError(err));
    } finally {
      setRunning("");
    }
  };

  const sendMessage = async () => {
    const values = await messageForm.validateFields();
    try {
      const result = await mechanismsApi.sendSyncMessage({ body: values });
      if (result?.ok) {
        message.success(result.message || "消息已发送");
        setMessageOpen(false);
      } else {
        message.error(result?.message || "发送失败");
      }
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const bindingColumns: ColumnsType<SyncBinding> = [
    {
      title: "外部账号",
      dataIndex: "externalId",
      render: (_value, row) => (
        <div>
          <div>{row.label || row.externalId}</div>
          <div className="muted text-12">{row.externalId}</div>
        </div>
      ),
    },
    {
      title: "渠道 / 域",
      dataIndex: "channel",
      width: 150,
      render: (_value, row) =>
        `${SYNC_CHANNEL_LABELS[row.channel] || row.channel} · ${SYNC_DOMAIN_LABELS[row.domain] || row.domain}`,
    },
    {
      title: "本系统主体",
      dataIndex: "localId",
      render: (_value, row) => `${row.localId}${row.principalType ? `（${row.principalType}）` : ""}`,
    },
    { title: "创建时间", dataIndex: "createdAt", width: 160, render: (value: string) => fmtDateTime(value) },
    {
      title: "操作",
      width: 80,
      render: (_value, row) => (
        <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void removeBinding(row)} />
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StatGrid>
        <StatCard label="绑定关系" value={overview?.bindings ?? 0} hint="外部账号 ↔ 本系统主体" />
        <StatCard
          label="飞书"
          value={overview?.byChannel?.FEISHU ?? 0}
          hint={overview?.feishuConfigured ? "已配置应用凭据" : "未配置应用凭据"}
        />
        <StatCard
          label="企业微信"
          value={overview?.byChannel?.WECOM ?? 0}
          hint={overview?.wecomConfigured ? "已配置应用凭据" : "未配置应用凭据"}
        />
        <StatCard label="最近同步" value={overview?.lastSyncAt ? fmtDateTime(overview.lastSyncAt) : "—"} />
      </StatGrid>

      <Panel title="通讯录同步">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Select
            style={{ width: 140 }}
            value={contactChannel}
            onChange={(value) => setContactChannel(value)}
            options={CHANNEL_OPTIONS}
          />
          <Checkbox checked={dryRun} onChange={(event) => setDryRun(event.target.checked)}>
            仅预演（不写入）
          </Checkbox>
          <Button type="primary" icon={<SyncOutlined aria-hidden />} loading={running === "contacts"} onClick={() => void runContacts()}>
            同步通讯录
          </Button>
          <span className="muted text-12">把外部通讯录成员按绑定关系落成组织成员，预演只统计差异不写库。</span>
        </div>
      </Panel>

      <Panel
        title="绑定关系"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => {
              bindingForm.setFieldsValue({
                channel: "FEISHU",
                domain: "CONTACT",
                externalId: "",
                principalType: "STAFF",
                localId: "",
                label: "",
              });
              setBindingOpen(true);
            }}
          >
            添加绑定
          </Button>
        }
      >
        {bindings.length ? (
          <Table rowKey="id" size="small" columns={bindingColumns} dataSource={bindings} pagination={false} />
        ) : (
          <EmptyState text="还没有绑定关系：绑定后通讯录、考勤与消息才能对应到本系统的人" />
        )}
      </Panel>

      <Panel title="考勤同步">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Select
            style={{ width: 140 }}
            value={attendanceChannel}
            onChange={(value) => setAttendanceChannel(value)}
            options={CHANNEL_OPTIONS}
          />
          <Input style={{ width: 140 }} placeholder="开始日期 2026-11-01" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          <Input style={{ width: 140 }} placeholder="结束日期 2026-11-07" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          <Button type="primary" icon={<SyncOutlined aria-hidden />} loading={running === "attendance"} onClick={() => void runAttendance()}>
            同步考勤
          </Button>
        </div>
      </Panel>

      <Panel
        title="消息推送"
        extra={
          <Button type="primary" icon={<SendOutlined aria-hidden />} onClick={() => {
            messageForm.setFieldsValue({ channel: "FEISHU", to: "", title: "", content: "", link: "" });
            setMessageOpen(true);
          }}>
            发送消息
          </Button>
        }
      >
        <Notice variant="info">
          通过已配置的应用向绑定成员推送卡片消息；「接收人」填外部账号 ID（与绑定关系里的外部账号一致）。
        </Notice>
      </Panel>

      <Modal open={bindingOpen} title="添加绑定关系" onCancel={() => setBindingOpen(false)} onOk={() => void saveBinding()} okText="保存">
        <Form form={bindingForm} layout="vertical">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="channel" label="渠道" rules={[{ required: true, message: "请选择渠道" }]}>
              <Select options={CHANNEL_OPTIONS} />
            </Form.Item>
            <Form.Item name="domain" label="同步域" rules={[{ required: true, message: "请选择同步域" }]}>
              <Select options={DOMAIN_OPTIONS} />
            </Form.Item>
          </div>
          <Form.Item name="externalId" label="外部账号 ID" rules={[{ required: true, message: "请填写外部账号 ID" }]}>
            <Input placeholder="飞书 open_id / 企微 userid" />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="principalType" label="主体类型">
              <Select
                options={[
                  { value: "STAFF", label: "职员" },
                  { value: "ASSIGNMENT", label: "代理人" },
                ]}
              />
            </Form.Item>
            <Form.Item name="localId" label="本系统账号" rules={[{ required: true, message: "请填写本系统账号" }]}>
              <Input placeholder="memberUserId" />
            </Form.Item>
          </div>
          <Form.Item name="label" label="备注名">
            <Input placeholder="选填，便于识别" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={messageOpen} title="推送卡片消息" onCancel={() => setMessageOpen(false)} onOk={() => void sendMessage()} okText="发送">
        <Form form={messageForm} layout="vertical">
          <Form.Item name="channel" label="渠道" rules={[{ required: true, message: "请选择渠道" }]}>
            <Select options={CHANNEL_OPTIONS} />
          </Form.Item>
          <Form.Item name="to" label="接收人（外部账号 ID）" rules={[{ required: true, message: "请填写接收人" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: "请填写内容" }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="link" label="跳转链接">
            <Input placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
