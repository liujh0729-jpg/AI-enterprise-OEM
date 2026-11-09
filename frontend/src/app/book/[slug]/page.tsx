"use client";

import { CalendarOutlined, ClockCircleOutlined, EnvironmentOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  Radio,
  Result,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { gapsPublicApi, type PublicAppointment } from "@/api/gaps";
import { PRODUCT_NAME } from "@/lib/brand";

type BookingForm = {
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  note?: string;
};

/** 公开预约页（免登录）：链接形如 /book/:slug，只读活动与可约时段并提交预约。 */
export default function PublicBookingPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug || "";
  const [form] = Form.useForm<BookingForm>();
  const [event, setEvent] = useState<PublicAppointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [slotId, setSlotId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    void gapsPublicApi
      .appointment(slug)
      .then((data) => {
        if (!alive) return;
        setEvent(data);
        setError("");
      })
      .catch((caught: unknown) => {
        if (alive) setError((caught as Error)?.message || "预约链接加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const groups = useMemo(() => {
    const map = new Map<string, { id: number; label: string; time: string }[]>();
    for (const slot of event?.slots || []) {
      const [day, time] = slot.label.split(" ");
      const list = map.get(day) || [];
      list.push({ id: slot.id, label: slot.label, time: time || slot.label });
      map.set(day, list);
    }
    return [...map.entries()];
  }, [event]);

  const submit = async (values: BookingForm) => {
    if (!slotId) return;
    setSubmitting(true);
    try {
      await gapsPublicApi.bookAppointment(slug, { ...values, slotId });
      setDone(true);
    } catch (caught) {
      setError((caught as Error)?.message || "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", padding: "48px 16px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 20, fontSize: 13, color: "#8c8c8c" }}>
          {PRODUCT_NAME}
        </div>

        {loading ? (
          <Card>
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <Spin description="正在加载预约信息…">
                <div />
              </Spin>
            </div>
          </Card>
        ) : error && !event ? (
          <Card>
            <Result status="warning" title="无法打开预约" subTitle={error} />
          </Card>
        ) : event ? (
          <Card>
            {done ? (
              <Result
                status="success"
                title="预约已提交"
                subTitle="我们会尽快与你确认具体安排，请留意电话或邮件。"
              />
            ) : (
              <>
                <Typography.Title level={3} style={{ marginTop: 0 }}>
                  {event.title}
                </Typography.Title>
                <Space size={[8, 8]} wrap style={{ marginBottom: 16 }}>
                  <Tag color="blue">{event.purposeLabel}</Tag>
                  <Tag icon={<ClockCircleOutlined />}>{event.durationMin} 分钟</Tag>
                  {event.location ? <Tag icon={<EnvironmentOutlined />}>{event.location}</Tag> : null}
                </Space>
                {event.description ? (
                  <Typography.Paragraph type="secondary">{event.description}</Typography.Paragraph>
                ) : null}

                <Typography.Title level={5}>
                  <CalendarOutlined /> 选择时间
                </Typography.Title>
                {groups.length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {groups.map(([day, slots]) => (
                      <div key={day}>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>{day}</div>
                        <Radio.Group
                          value={slotId}
                          onChange={(input) => setSlotId(input.target.value)}
                          optionType="button"
                          buttonStyle="solid"
                          options={slots.map((slot) => ({
                            value: slot.id,
                            label: slot.time,
                          }))}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty description="暂无可以预约的时间段，请稍后再来或联系我们。" />
                )}

                <Typography.Title level={5} style={{ marginTop: 28 }}>
                  填写预约信息
                </Typography.Title>
                <Form<BookingForm> form={form} layout="vertical" onFinish={(values) => void submit(values)}>
                  <Form.Item
                    name="name"
                    label="姓名"
                    rules={[{ required: true, message: "请填写姓名" }]}
                  >
                    <Input maxLength={64} placeholder="怎么称呼你" />
                  </Form.Item>
                  <Form.Item name="phone" label="电话">
                    <Input maxLength={32} placeholder="方便联系到你的手机号" />
                  </Form.Item>
                  <Form.Item
                    name="email"
                    label="邮箱"
                    rules={[{ type: "email", message: "邮箱格式不正确" }]}
                  >
                    <Input maxLength={120} placeholder="用于接收确认与提醒" />
                  </Form.Item>
                  <Form.Item name="company" label="公司">
                    <Input maxLength={120} placeholder="所在公司或机构（选填）" />
                  </Form.Item>
                  <Form.Item name="note" label="备注">
                    <Input.TextArea
                      maxLength={1000}
                      rows={3}
                      showCount
                      placeholder="想聊的主题、期望结果或其他说明（选填）"
                    />
                  </Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={submitting}
                    disabled={!slotId}
                  >
                    {slotId ? "提交预约" : "请先选择时间"}
                  </Button>
                </Form>
              </>
            )}
          </Card>
        ) : null}

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#bfbfbf" }}>
          由 {PRODUCT_NAME} 提供预约服务
        </div>
      </div>
    </div>
  );
}
