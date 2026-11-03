"use client";

import { Col, Form, Input, InputNumber, Modal, Row, Select, Switch, Tag, Button, message } from "antd";
import type { FormInstance } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { LowCodeEntityView, LowCodeFieldView } from "@enterprise/contracts";
import { lowcodeApi } from "@/api/lowcode";

export function errText(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

export function choicesOf(field: LowCodeFieldView): string[] {
  const raw = (field.options || {}).choices;
  return Array.isArray(raw) ? raw.map((item) => String(item)) : [];
}

export function initialValuesOf(
  fields: LowCodeFieldView[],
  data?: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const value = data?.[field.fieldKey];
    if (field.fieldType === "boolean") {
      values[field.fieldKey] = value === true || value === "true";
    } else if (field.fieldType === "date") {
      values[field.fieldKey] = value ? String(value).slice(0, 10) : undefined;
    } else if (field.fieldType === "json") {
      values[field.fieldKey] =
        value === undefined || value === null || value === ""
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value, null, 2);
    } else {
      values[field.fieldKey] = value ?? undefined;
    }
  }
  return values;
}

/** 表单值 → 落库值：JSON 列要求合法 JSON，数字列空值不写。 */
export function normalizeValues(
  fields: LowCodeFieldView[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.fieldKey];
    if (field.fieldType === "json") {
      const raw = String(value ?? "").trim();
      if (!raw) {
        data[field.fieldKey] = "";
        continue;
      }
      try {
        data[field.fieldKey] = JSON.parse(raw) as unknown;
      } catch {
        throw new Error(`${field.name} 不是合法的 JSON`);
      }
      continue;
    }
    if (field.fieldType === "number") {
      if (value === undefined || value === null || value === "") continue;
      const num = Number(value);
      if (Number.isNaN(num)) throw new Error(`${field.name} 必须是数字`);
      data[field.fieldKey] = num;
      continue;
    }
    if (field.fieldType === "boolean") {
      data[field.fieldKey] = Boolean(value);
      continue;
    }
    data[field.fieldKey] = value ?? "";
  }
  return data;
}

export function FieldInputs({
  fields,
  readonlyFields = [],
}: {
  fields: LowCodeFieldView[];
  readonlyFields?: string[];
}) {
  const readonly = useMemo(() => new Set(readonlyFields), [readonlyFields]);
  return (
    <Row gutter={16}>
      {fields.map((field) => (
        <Col span={field.fieldType === "json" ? 24 : 12} key={field.fieldKey}>
          <Form.Item
            name={field.fieldKey}
            label={
              <span>
                {field.name}
                {field.required ? <span style={{ color: "#f53f3f" }}> *</span> : null}
                {readonly.has(field.fieldKey) ? (
                  <Tag style={{ marginLeft: 6 }}>只读</Tag>
                ) : null}
              </span>
            }
            rules={
              field.required && !readonly.has(field.fieldKey)
                ? [{ required: true, message: `请填写${field.name}` }]
                : undefined
            }
            valuePropName={field.fieldType === "boolean" ? "checked" : undefined}
          >
            <FieldControl field={field} disabled={readonly.has(field.fieldKey)} />
          </Form.Item>
        </Col>
      ))}
    </Row>
  );
}

/** Form.Item 通过克隆子元素注入 value/onChange，中间包一层组件时必须原样转发，否则输入进不了表单。 */
function FieldControl({
  field,
  disabled,
  value,
  checked,
  id,
  onChange,
}: {
  field: LowCodeFieldView;
  disabled: boolean;
  value?: unknown;
  checked?: boolean;
  id?: string;
  onChange?: (...args: unknown[]) => void;
}) {
  const shared = {
    id,
    disabled,
    onChange: onChange as ((...args: unknown[]) => void) | undefined,
  };
  const textValue = value as string | number | undefined;
  switch (field.fieldType) {
    case "number":
      return (
        <InputNumber
          {...shared}
          value={value as number | string | null | undefined}
          style={{ width: "100%" }}
        />
      );
    case "boolean":
      return <Switch {...shared} checked={checked} />;
    case "date":
      return <Input {...shared} type="date" value={textValue} />;
    case "select":
      return (
        <Select
          {...shared}
          value={textValue}
          allowClear
          options={choicesOf(field).map((item) => ({ value: item, label: item }))}
        />
      );
    case "json":
      return (
        <Input.TextArea {...shared} value={textValue} rows={4} placeholder='{"key": "value"}' />
      );
    case "url":
      return <Input {...shared} value={textValue} placeholder="https://" />;
    case "email":
      return <Input {...shared} value={textValue} placeholder="name@example.com" />;
    default:
      return <Input {...shared} value={textValue} />;
  }
}

/** 自然语言一句话 → 按实体字段回填表单（AI 智能填充）。 */
export function AiFillBar({
  projectId,
  entity,
  form,
  blocked = [],
}: {
  projectId: number;
  entity: LowCodeEntityView;
  form: FormInstance;
  blocked?: string[];
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const names = useMemo(
    () => new Map(entity.fields.map((field) => [field.fieldKey, field.name])),
    [entity.fields],
  );

  const run = async () => {
    if (!text.trim()) {
      message.warning("先写一句要录入的内容");
      return;
    }
    setLoading(true);
    setNote("");
    try {
      const result = await lowcodeApi.aiFill({
        params: { id: String(projectId) },
        body: { entityId: entity.id, text: text.trim() },
      });
      if (!result) throw new Error("AI 未返回结果");
      const skip = new Set([...blocked, ...(result.skipped || [])]);
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(result.values || {})) {
        if (skip.has(key)) continue;
        const field = entity.fields.find((item) => item.fieldKey === key);
        if (field?.fieldType === "json" && typeof value === "object" && value !== null) {
          patch[key] = JSON.stringify(value, null, 2);
        } else {
          patch[key] = value;
        }
      }
      form.setFieldsValue(patch);
      const filled = Object.keys(patch).length;
      const skippedNames = (result.skipped || []).map((key) => names.get(key) || key);
      setNote(
        `已填充 ${filled} 项${skippedNames.length ? `，跳过：${skippedNames.join("、")}` : ""}${result.model ? `（模型 ${result.model}）` : ""}`,
      );
    } catch (error) {
      message.error(errText(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lowcode-ai-fill">
      <Input.TextArea
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="用一句话描述要录入的内容，例如：张三今天请假 2 天，事假，下周一到周二"
      />
      <div className="lowcode-ai-fill-actions">
        <Button onClick={() => void run()} loading={loading}>
          AI 填充表单
        </Button>
        {note ? <span className="muted text-12">{note}</span> : null}
      </div>
    </div>
  );
}

export function RowModal({
  open,
  projectId,
  entity,
  rowId,
  initial,
  readonlyFields = [],
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: number;
  entity: LowCodeEntityView;
  rowId?: number;
  initial?: Record<string, unknown>;
  readonlyFields?: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [readonly, setReadonly] = useState<string[]>(readonlyFields);
  const [data, setData] = useState<Record<string, unknown> | undefined>(initial);

  useEffect(() => {
    if (!open) return;
    setReadonly(readonlyFields);
    if (!rowId) {
      setData(initial);
      form.resetFields();
      form.setFieldsValue(initialValuesOf(entity.fields, initial));
      return;
    }
    setLoading(true);
    void lowcodeApi
      .entityRow({ params: { id: String(projectId), entityId: String(entity.id), rowId: String(rowId) } })
      .then((row) => {
        const view = row as { data?: Record<string, unknown>; readonlyFields?: string[] };
        setData(view.data || {});
        setReadonly(view.readonlyFields || []);
        form.resetFields();
        form.setFieldsValue(initialValuesOf(entity.fields, view.data || {}));
      })
      .catch((error: unknown) => message.error(errText(error)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rowId]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = normalizeValues(entity.fields, values as Record<string, unknown>);
      if (rowId) {
        await lowcodeApi.updateRow({
          params: { id: String(projectId), entityId: String(entity.id), rowId: String(rowId) },
          body: { data: payload },
        });
      } else {
        await lowcodeApi.createRow({
          params: { id: String(projectId), entityId: String(entity.id) },
          body: { data: payload },
        });
      }
      message.success(rowId ? "已保存" : "已新增");
      onSaved();
      onClose();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`${rowId ? "编辑" : "新增"}${entity.name}`}
      width={820}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => void save()}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12 }}>
        <AiFillBar projectId={projectId} entity={entity} form={form} blocked={readonly} />
      </div>
      <Form form={form} layout="vertical" disabled={loading}>
        <FieldInputs fields={entity.fields} readonlyFields={readonly} />
      </Form>
      {data && Object.keys(data).length ? (
        <div className="muted text-12">
          数据行 #{rowId} 由多维表格承载
        </div>
      ) : null}
    </Modal>
  );
}
