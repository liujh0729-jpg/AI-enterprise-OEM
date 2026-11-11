"use client";

import {
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Timeline,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  AFTER_SALES_KIND_LABELS,
  AFTER_SALES_STATUS_LABELS,
} from "@enterprise/contracts";
import { gapsApi, type AfterSalesTicket } from "@/api/gaps";
import { Notice, Panel } from "@/components/ui/panel";
import { gapError, gapStatusTag, zhTime } from "@/app/gaps/_components/gaps-common";

const TRANSITIONS: Record<string, string[]> = {
  PENDING: ["REVIEWING", "APPROVED", "REJECTED", "CANCELED"],
  REVIEWING: ["APPROVED", "REJECTED", "CANCELED"],
  APPROVED: ["RECEIVED", "SHIPPED", "CANCELED"],
  RECEIVED: ["SHIPPED", "COMPLETED", "CANCELED"],
  SHIPPED: ["COMPLETED", "CANCELED"],
  REJECTED: [],
  COMPLETED: [],
  CANCELED: [],
};

const money = (value: number) =>
  `¥${(Number(value) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** B3#22② 售后状态机：退货 / 维修 / 退款 / 换货工单，按状态机逐级推进并留事件。 */
export function GapsAfterSalesTab() {
  const [rows, setRows] = useState<AfterSalesTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [detail, setDetail] = useState<AfterSalesTicket | null>(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gapsApi.afterSalesTickets({
        query: { page, pageSize: 20, status: status || undefined },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (row: AfterSalesTicket) => {
    try {
      setDetail(await gapsApi.afterSalesTicket({ params: { id: String(row.id) } }));
    } catch (err) {
      message.error(gapError(err));
    }
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      await gapsApi.saveAfterSalesTicket({ body: values });
      message.success("售后工单已保存");
      setOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const advance = async () => {
    if (!detail) return;
    try {
      const values = await advanceForm.validateFields();
      const updated = await gapsApi.advanceAfterSales({
        params: { id: String(detail.id) },
        body: values,
      });
      message.success("状态已推进");
      setDetail(updated);
      setAdvanceOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const columns: ColumnsType<AfterSalesTicket> = [
    { title: "售后单", width: 90, render: (_, row) => `#${row.id}` },
    { title: "订单号", dataIndex: "orderNo", width: 160 },
    { title: "类型", dataIndex: "kindLabel", width: 90 },
    { title: "金额", width: 120, render: (_, row) => money(row.amount) },
    { title: "联系人", dataIndex: "contact", width: 140 },
    { title: "事由", dataIndex: "reason", ellipsis: true },
    { title: "状态", width: 100, render: (_, row) => gapStatusTag(row.status) },
    { title: "经办人", dataIndex: "assigneeUserId", width: 140, ellipsis: true },
    { title: "更新时间", width: 150, render: (_, row) => zhTime(row.updatedAt) },
    {
      title: "操作",
      width: 90,
      render: (_, row) => (
        <Button size="small" type="link" onClick={() => void openDetail(row)}>
          查看
        </Button>
      ),
    },
  ];

  const allowed = detail ? TRANSITIONS[detail.status] || [] : [];

  return (
    <Panel
      title="售后工单"
      titleExtra="退货 / 维修 / 退款 / 换货按状态机推进：每次推进都记事件与经办人，不能跳级"
      extra={
        <Space>
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 150 }}
            value={status || undefined}
            onChange={(value) => {
              setStatus(value || "");
              setPage(1);
            }}
            options={Object.entries(AFTER_SALES_STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Button
            type="primary"
            onClick={() => {
              form.resetFields();
              setOpen(true);
            }}
          >
            新建售后单
          </Button>
        </Space>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1180 }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />

      <Modal
        open={open}
        title="新建售后工单"
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ kind: "RETURN", amount: 0, conversationId: 0 }}
        >
          <Form.Item name="orderNo" label="订单号">
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item name="kind" label="售后类型">
            <Select
              options={Object.entries(AFTER_SALES_KIND_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item name="amount" label="金额">
            <InputNumber min={0} style={{ width: "100%" }} prefix="¥" />
          </Form.Item>
          <Form.Item name="contact" label="联系人 / 联系方式">
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="reason" label="事由">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
          <Form.Item name="conversationId" label="关联客服会话 ID（可选）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        open={Boolean(detail)}
        size={620}
        title={`售后工单 #${detail?.id || ""}`}
        onClose={() => setDetail(null)}
        destroyOnHidden
        extra={
          allowed.length ? (
            <Button
              type="primary"
              onClick={() => {
                advanceForm.resetFields();
                advanceForm.setFieldsValue({ toStatus: allowed[0], note: "" });
                setAdvanceOpen(true);
              }}
            >
              推进状态
            </Button>
          ) : null
        }
      >
        {detail ? (
          <>
            <Descriptions
              size="small"
              bordered
              column={2}
              items={[
                { key: "1", label: "订单号", children: detail.orderNo || "—" },
                { key: "2", label: "类型", children: detail.kindLabel },
                { key: "3", label: "金额", children: money(detail.amount) },
                { key: "4", label: "联系人", children: detail.contact || "—" },
                { key: "5", label: "状态", children: gapStatusTag(detail.status) },
                { key: "6", label: "经办人", children: detail.assigneeUserId || "—" },
                { key: "7", label: "事由", children: detail.reason || "—", span: 2 },
                { key: "8", label: "备注", children: detail.note || "—", span: 2 },
              ]}
            />
            <div style={{ fontWeight: 600, margin: "16px 0 8px" }}>处理记录</div>
            <Timeline
              items={[
                {
                  color: "blue",
                  content: (
                    <span className="text-12">
                      创建工单 · {zhTime(detail.createdAt)}
                    </span>
                  ),
                },
                ...detail.events.map((event) => ({
                  color: "green",
                  content: (
                    <span className="text-12">
                      {AFTER_SALES_STATUS_LABELS[event.fromStatus] || event.fromStatus} →{" "}
                      {AFTER_SALES_STATUS_LABELS[event.toStatus] || event.toStatus}
                      {event.note ? ` · ${event.note}` : ""} · {event.operatorId} ·{" "}
                      {zhTime(event.createdAt)}
                    </span>
                  ),
                })),
              ]}
            />
          </>
        ) : null}
      </Drawer>

      <Modal
        open={advanceOpen}
        title="推进售后状态"
        onCancel={() => setAdvanceOpen(false)}
        onOk={() => void advance()}
        destroyOnHidden
      >
        <Form form={advanceForm} layout="vertical">
          <Form.Item name="toStatus" label="推进到" rules={[{ required: true, message: "请选择状态" }]}>
            <Select
              options={allowed.map((value) => ({
                value,
                label: AFTER_SALES_STATUS_LABELS[value] || value,
              }))}
            />
          </Form.Item>
          <Form.Item name="note" label="处理说明">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Panel>
  );
}
