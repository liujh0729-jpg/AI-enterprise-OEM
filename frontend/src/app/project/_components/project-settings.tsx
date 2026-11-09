"use client";

import { Button, Col, Form, Input, InputNumber, Row, Select, message } from "antd";
import { useEffect, useState } from "react";
import { projectApi } from "@/api/project";
import { Notice, Panel } from "@/components/ui/panel";
import { pjError, type PjSettings } from "./project-common";

export function PjSettingsTab({
  settings,
  reload,
}: {
  settings: PjSettings;
  reload: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    form.setFieldsValue({
      statuses: settings.statuses,
      taskTypes: settings.taskTypes,
      currency: settings.currency,
      standardHoursPerDay: settings.standardHoursPerDay,
    });
  }, [settings, form]);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await projectApi.saveSettings({
        body: {
          statuses: values.statuses || [],
          taskTypes: values.taskTypes || [],
          currency: values.currency || "CNY",
          standardHoursPerDay: Number(values.standardHoursPerDay || 8),
        },
      });
      message.success("设置已保存");
      reload();
      setError("");
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      setError(pjError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="项目设置">
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="currency" label="默认币种">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="standardHoursPerDay" label="标准工时（小时/天）">
              <InputNumber style={{ width: "100%" }} min={1} max={24} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="statuses" label="项目状态字典">
              <Select mode="tags" placeholder="回车添加状态" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="taskTypes" label="任务类型字典">
              <Select mode="tags" placeholder="回车添加类型" />
            </Form.Item>
          </Col>
        </Row>
        <Button type="primary" loading={saving} onClick={() => void submit()}>
          保存设置
        </Button>
      </Form>
    </Panel>
  );
}
