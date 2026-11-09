"use client";

import { DeleteOutlined, PlusOutlined, SendOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Switch, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { WEBHOOK_EVENTS } from "@enterprise/contracts";
import { mechanismsApi } from "@/api/mechanisms";
import { EmptyState, Panel } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  deliveryStatusTag,
  eventLabel,
  mechError,
  webhookStatusTag,
  type Webhook,
  type WebhookDelivery,
} from "./mechanisms-common";

const EVENT_OPTIONS = WEBHOOK_EVENTS.map((event) => ({
  value: event,
  label: eventLabel(event),
}));

export function WebhookPanel() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryTitle, setDeliveryTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await mechanismsApi.webhooks()) || []);
    } catch (err) {
      message.error(mechError(err));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row: Webhook | null) => {
    setEditing(row);
    form.setFieldsValue(
      row
        ? {
            name: row.name,
            url: row.url,
            secret: "",
            events: row.events,
            enabled: row.enabled,
          }
        : { name: "", url: "", secret: "", events: [], enabled: true },
    );
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      await mechanismsApi.saveWebhook({
        body: {
          ...(editing ? { id: editing.id } : {}),
          name: values.name,
          url: values.url,
          secret: values.secret || "",
          events: values.events,
          enabled: Boolean(values.enabled),
        },
      });
      message.success(editing ? "Webhook 已更新" : "Webhook 已创建");
      setOpen(false);
      await load();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const remove = async (row: Webhook) => {
    try {
      await mechanismsApi.removeWebhook({ body: { id: row.id } });
      message.success("已删除");
      await load();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const test = async (row: Webhook) => {
    try {
      const result = await mechanismsApi.testWebhook({ body: { id: row.id } });
      if (result?.ok) message.success(result.message || "测试事件已送达");
      else message.error(result?.message || "投递失败");
      await load();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const openDeliveries = async (row: Webhook | null) => {
    try {
      const data = await mechanismsApi.deliveries({
        query: { page: 1, pageSize: 50, subscriptionId: row?.id || 0 },
      });
      setDeliveries(data?.list || []);
      setDeliveryTitle(row ? `投递记录 · ${row.name}` : "全部投递记录");
      setDeliveryOpen(true);
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const replay = async (row: WebhookDelivery) => {
    try {
      await mechanismsApi.replayDelivery({ body: { id: row.id } });
      message.success("已重新投递");
      await openDeliveries(null);
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const columns: ColumnsType<Webhook> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (_value, row) => (
        <div>
          <div>{row.name}</div>
          <div className="muted text-12">{row.url}</div>
        </div>
      ),
    },
    {
      title: "订阅事件",
      dataIndex: "events",
      render: (values: string[]) =>
        values.length ? values.map((event) => eventLabel(event)).join("、") : "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => webhookStatusTag(value),
    },
    {
      title: "最近投递",
      dataIndex: "lastDeliveredAt",
      width: 160,
      render: (value: string, row) => (
        <div>
          <div className="text-12">{value ? fmtDateTime(value) : "尚未投递"}</div>
          {row.lastError ? <div className="text-12" style={{ color: "#cf1322" }}>{row.lastError}</div> : null}
        </div>
      ),
    },
    {
      title: "签名密钥",
      dataIndex: "secretMasked",
      width: 120,
      render: (value: string) => value || "未设置",
    },
    {
      title: "操作",
      width: 280,
      render: (_value, row) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="small" onClick={() => openEditor(row)}>
            编辑
          </Button>
          <Button size="small" icon={<SendOutlined aria-hidden />} onClick={() => void test(row)}>
            测试
          </Button>
          <Button size="small" onClick={() => void openDeliveries(row)}>
            投递记录
          </Button>
          <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void remove(row)} />
        </div>
      ),
    },
  ];

  const deliveryColumns: ColumnsType<WebhookDelivery> = [
    { title: "事件", dataIndex: "event", render: (value: string) => eventLabel(value) },
    { title: "状态", dataIndex: "status", width: 100, render: (value: string) => deliveryStatusTag(value) },
    { title: "尝试次数", dataIndex: "attempts", width: 90 },
    { title: "时间", dataIndex: "createdAt", width: 160, render: (value: string) => fmtDateTime(value) },
    {
      title: "结果",
      dataIndex: "error",
      render: (value: string, row) => value || (row.deliveredAt ? fmtDateTime(row.deliveredAt) : "—"),
    },
    {
      title: "操作",
      width: 100,
      render: (_value, row) =>
        row.status === "FAILED" || row.status === "SKIPPED" ? (
          <Button size="small" onClick={() => void replay(row)}>
            重投
          </Button>
        ) : null,
    },
  ];

  return (
    <Panel
      title="Webhook 订阅"
      extra={
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => void openDeliveries(null)}>
            全部投递记录
          </Button>
          <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => openEditor(null)}>
            新建 Webhook
          </Button>
        </div>
      }
    >
      {rows.length ? (
        <Table rowKey="id" size="small" loading={loading} columns={columns} dataSource={rows} pagination={false} />
      ) : (
        <EmptyState text="还没有 Webhook 订阅：事件会先进 Outbox，再按订阅投递到你指定的地址" />
      )}

      <Modal
        open={open}
        title={editing ? "编辑 Webhook" : "新建 Webhook"}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
            <Input placeholder="如：订单同步到 ERP" />
          </Form.Item>
          <Form.Item
            name="url"
            label="回调地址"
            rules={[
              { required: true, message: "请填写回调地址" },
              { type: "url", message: "请填写完整的 http(s) 地址" },
            ]}
          >
            <Input placeholder="https://example.com/hooks/enterprise" />
          </Form.Item>
          <Form.Item name="events" label="订阅事件" rules={[{ required: true, message: "请至少选择一个事件" }]}>
            <Select mode="multiple" options={EVENT_OPTIONS} placeholder="选择要推送的事件" />
          </Form.Item>
          <Form.Item name="secret" label="签名密钥" extra={editing ? "留空表示不修改现有密钥" : "用于请求头签名校验，可留空"}>
            <Input.Password placeholder="选填" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={deliveryOpen}
        title={deliveryTitle}
        width={860}
        onCancel={() => setDeliveryOpen(false)}
        footer={<Button onClick={() => setDeliveryOpen(false)}>关闭</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          columns={deliveryColumns}
          dataSource={deliveries}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: "还没有投递记录" }}
        />
      </Modal>
    </Panel>
  );
}
