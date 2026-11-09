"use client";

import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  TimePicker,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import {
  APPOINTMENT_PURPOSES,
  APPOINTMENT_PURPOSE_LABELS,
} from "@enterprise/contracts";
import { gapsApi, type AppointmentBooking, type AppointmentEvent } from "@/api/gaps";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import { gapError, gapStatusTag, zhDay, zhTime } from "@/app/gaps/_components/gaps-common";

type Mode = "events" | "bookings";

/** B1#7 预约 / 忙闲：活动 + 时间段生成 + 预约台账。 */
export function GapsAppointmentsTab() {
  const [mode, setMode] = useState<Mode>("events");
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [bookings, setBookings] = useState<AppointmentBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [eventOpen, setEventOpen] = useState(false);
  const [eventForm] = Form.useForm();
  const [slotOpen, setSlotOpen] = useState(false);
  const [slotEvent, setSlotEvent] = useState<AppointmentEvent | null>(null);
  const [slotForm] = Form.useForm();

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      setEvents((await gapsApi.appointmentEvents()) ?? []);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gapsApi.appointmentBookings({
        query: { page, pageSize: 20, status: status || undefined },
      });
      setBookings(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    if (mode === "events") void loadEvents();
    else void loadBookings();
  }, [mode, loadEvents, loadBookings]);

  const saveEvent = async () => {
    try {
      const values = await eventForm.validateFields();
      await gapsApi.saveAppointmentEvent({ body: values });
      message.success("预约活动已保存");
      setEventOpen(false);
      eventForm.resetFields();
      await loadEvents();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const generateSlots = async () => {
    if (!slotEvent) return;
    try {
      const values = await slotForm.validateFields();
      const date: Dayjs = values.date;
      const rows = await gapsApi.generateAppointmentSlots({
        body: {
          eventId: slotEvent.id,
          date: date.format("YYYY-MM-DD"),
          startTime: (values.start as Dayjs).format("HH:mm"),
          endTime: (values.end as Dayjs).format("HH:mm"),
          stepMin: Number(values.step || 30),
        },
      });
      message.success(`已生成 ${rows?.length || 0} 个时间段`);
      setSlotOpen(false);
      slotForm.resetFields();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const cancelBooking = async (row: AppointmentBooking) => {
    try {
      await gapsApi.cancelAppointmentBooking({ body: { id: row.id, note: "" } });
      message.success("预约已取消");
      await loadBookings();
    } catch (err) {
      message.error(gapError(err));
    }
  };

  const eventColumns: ColumnsType<AppointmentEvent> = [
    { title: "活动", dataIndex: "title" },
    {
      title: "用途",
      dataIndex: "purposeLabel",
      width: 100,
      render: (value: string) => value || "—",
    },
    {
      title: "时长",
      dataIndex: "durationMin",
      width: 90,
      render: (value: number, row) => `${value} 分钟 + 缓冲 ${row.bufferMin}`,
    },
    {
      title: "可约时间",
      width: 120,
      render: (_, row) => `${row.upcomingSlots} 个`,
    },
    {
      title: "已预约",
      width: 90,
      render: (_, row) => `${row.upcomingBookings} 单`,
    },
    {
      title: "公开链接",
      dataIndex: "publicUrl",
      render: (value: string) =>
        value ? (
          <a href={value} target="_blank" rel="noreferrer">
            打开预约页
          </a>
        ) : (
          "—"
        ),
    },
    {
      title: "状态",
      width: 80,
      render: (_, row) => (row.active ? gapStatusTag("ACTIVE") : gapStatusTag("ARCHIVED")),
    },
    {
      title: "操作",
      width: 210,
      render: (_, row) => (
        <>
          <Button
            size="small"
            type="link"
            onClick={() => {
              setSlotEvent(row);
              slotForm.setFieldsValue({ date: dayjs(), step: 30 });
              setSlotOpen(true);
            }}
          >
            生成时段
          </Button>
          <Button
            size="small"
            type="link"
            onClick={() => {
              eventForm.setFieldsValue({
                ...row,
                slug: row.slug,
              });
              setEventOpen(true);
            }}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={async () => {
              try {
                await gapsApi.removeAppointmentEvent({ body: { id: row.id } });
                message.success("已删除");
                await loadEvents();
              } catch (err) {
                message.error(gapError(err));
              }
            }}
          >
            删除
          </Button>
        </>
      ),
    },
  ];

  const bookingColumns: ColumnsType<AppointmentBooking> = [
    { title: "预约人", dataIndex: "name", width: 110 },
    { title: "活动", dataIndex: "eventTitle" },
    { title: "时间", width: 150, render: (_, row) => `${zhDay(row.startAt)} ${zhTime(row.startAt).slice(11)}` },
    { title: "联系方式", width: 180, render: (_, row) => row.phone || row.email || "—" },
    { title: "公司", dataIndex: "company", width: 140 },
    { title: "状态", width: 90, render: (_, row) => gapStatusTag(row.status) },
    { title: "备注", dataIndex: "note", ellipsis: true },
    {
      title: "操作",
      width: 90,
      render: (_, row) =>
        row.status === "BOOKED" ? (
          <Button size="small" type="link" danger onClick={() => void cancelBooking(row)}>
            取消
          </Button>
        ) : null,
    },
  ];

  return (
    <Panel
      title="预约与忙闲"
      titleExtra="公开预约页按 IP 限流；同一时段只允许一单"
      extra={
        <PillTabs
          items={[
            { key: "events", label: "预约活动" },
            { key: "bookings", label: "预约台账" },
          ]}
          value={mode}
          onChange={(key) => setMode(key as Mode)}
        />
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {mode === "events" ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Button
              type="primary"
              onClick={() => {
                eventForm.resetFields();
                setEventOpen(true);
              }}
            >
              新建预约活动
            </Button>
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={eventColumns}
            dataSource={events}
            pagination={false}
            scroll={{ x: 900 }}
          />
        </>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <Select
              allowClear
              placeholder="按状态筛选"
              style={{ width: 160 }}
              value={status || undefined}
              onChange={(value) => {
                setStatus(value || "");
                setPage(1);
              }}
              options={[
                { value: "BOOKED", label: "已预约" },
                { value: "DONE", label: "已完成" },
                { value: "CANCELED", label: "已取消" },
              ]}
            />
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={bookingColumns}
            dataSource={bookings}
            scroll={{ x: 1000 }}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              showSizeChanger: false,
              onChange: setPage,
            }}
          />
        </>
      )}

      <Modal
        open={eventOpen}
        title={eventForm.getFieldValue("id") ? "编辑预约活动" : "新建预约活动"}
        onCancel={() => setEventOpen(false)}
        onOk={() => void saveEvent()}
        destroyOnHidden
      >
        <Form form={eventForm} layout="vertical" initialValues={{ purpose: "MEETING", durationMin: 30, bufferMin: 10, horizonDays: 30, active: true }}>
          <Form.Item name="id" hidden>
            <InputNumber />
          </Form.Item>
          <Form.Item name="title" label="活动标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input maxLength={120} placeholder="如：售前方案沟通" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="公开链接标识"
            rules={[{ pattern: /^[a-z0-9-]*$/, message: "仅小写字母、数字与短横线" }]}
            extra="留空由服务端生成；生成后公开链接为 /book/<标识>"
          >
            <Input maxLength={48} placeholder="如：presales-2026" />
          </Form.Item>
          <Form.Item name="purpose" label="用途">
            <Select options={APPOINTMENT_PURPOSES.map((value) => ({ value, label: APPOINTMENT_PURPOSE_LABELS[value] }))} />
          </Form.Item>
          <Form.Item name="durationMin" label="时长（分钟）">
            <InputNumber min={10} max={480} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="bufferMin" label="缓冲（分钟）">
            <InputNumber min={0} max={120} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="horizonDays" label="可约天数">
            <InputNumber min={1} max={180} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="location" label="地点 / 会议方式">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
          <Form.Item name="active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={slotOpen}
        title={`生成时间段 · ${slotEvent?.title || ""}`}
        onCancel={() => setSlotOpen(false)}
        onOk={() => void generateSlots()}
        destroyOnHidden
      >
        <Form form={slotForm} layout="vertical">
          <Form.Item name="date" label="日期" rules={[{ required: true, message: "请选择日期" }]}>
            <DatePicker style={{ width: "100%" }} disabledDate={(value) => value.isBefore(dayjs().startOf("day"))} />
          </Form.Item>
          <Form.Item name="start" label="开始时间" rules={[{ required: true, message: "请选择开始时间" }]}>
            <TimePicker format="HH:mm" minuteStep={5} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="end" label="结束时间" rules={[{ required: true, message: "请选择结束时间" }]}>
            <TimePicker format="HH:mm" minuteStep={5} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="step" label="间隔（分钟）">
            <InputNumber min={5} max={240} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </Panel>
  );
}
