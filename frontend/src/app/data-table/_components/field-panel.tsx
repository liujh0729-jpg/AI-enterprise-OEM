"use client";

import { EditOutlined, HolderOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Form, Input, Modal, Select, Space, Tag } from "antd";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Panel } from "@/components/ui/panel";
import {
  FIELD_TYPE_OPTIONS,
  fieldTypeLabel,
  parseChoices,
  tableApi,
  type DataTableField,
  type DataTableTable,
} from "./common";

type FieldForm = {
  name: string;
  field_key: string;
  field_type: string;
  required: boolean;
  choices: string;
};

const EMPTY_FORM: FieldForm = {
  name: "",
  field_key: "",
  field_type: "text",
  required: false,
  choices: "",
};

/**
 * 列定义： chips 可拖拽排序（提交全量列键排列）、加列 / 改列 / 删列。
 * 列键建列后不可改（它是已存行数据的键），删列重建才能换键。
 */
export function FieldPanel({
  table,
  onChanged,
}: {
  table: DataTableTable;
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DataTableField | null>(null);
  const [form] = Form.useForm<FieldForm>();
  const [busy, setBusy] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const fields = [...table.fields].sort((a, b) => a.sortOrder - b.sortOrder);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (field: DataTableField) => {
    setEditing(field);
    form.setFieldsValue({
      name: field.name,
      field_key: field.fieldKey,
      field_type: field.fieldType,
      required: field.required,
      choices: (field.options?.choices || []).join(","),
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const body: Record<string, unknown> = {
      name: values.name.trim(),
      field_type: values.field_type,
      required: values.required,
      choices: parseChoices(values.choices || ""),
    };
    /** 新增免密；修改列走密码确认（与全站改删口径一致）。 */
    if (editing) {
      const target = editing;
      request({
        title: "修改列（需密码）",
        content: `确认修改「${target.name}」（列键 ${target.fieldKey}）？`,
        okText: "保存修改",
        onOk: async () => {
          await tableApi.updateField(table.id, target.id, body);
          setOpen(false);
          form.resetFields();
          await onChanged();
        },
      });
      return;
    }
    setBusy(true);
    try {
      await tableApi.addField(table.id, {
        ...body,
        field_key: values.field_key.trim(),
      });
      setOpen(false);
      form.resetFields();
      await onChanged();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeField = (field: DataTableField) => {
    request({
      title: "删除列",
      content: (
        <span>
          删除列「{field.name}」（列键 <code>{field.fieldKey}</code>）后，已存行里该列的值不再显示。确定删除吗？
        </span>
      ),
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await tableApi.deleteField(table.id, field.id);
        await onChanged();
      },
    });
  };

  /** 拖拽换位：本地先改序（界面即时无跳变），失败再回读真实列序。 */
  const dropOn = async (targetKey: string) => {
    const source = dragKey;
    setDragKey(null);
    if (!source || source === targetKey) return;
    const keys = fields.map((field) => field.fieldKey);
    const from = keys.indexOf(source);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    keys.splice(to, 0, ...keys.splice(from, 1));
    try {
      await tableApi.reorderFields(table.id, keys);
      await onChanged();
    } catch (error) {
      message.error((error as Error).message);
      await onChanged();
    }
  };

  return (
    <Panel
      title="列定义"
      titleBadge={`${fields.length} 列`}
      extra={<Button onClick={openCreate}>添加列</Button>}
    >
      {fields.length ? (
        <Space size={[8, 8]} wrap>
          {fields.map((field) => (
            <Tag
              key={field.id}
              draggable
              icon={<HolderOutlined />}
              className="data-table-chip"
              title="按住拖拽可调整列序"
              onDragStart={() => setDragKey(field.fieldKey)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => void dropOn(field.fieldKey)}
              onClose={() => removeField(field)}
              closable
              style={{
                padding: "4px 8px",
                borderColor: dragKey === field.fieldKey ? "var(--primary)" : undefined,
              }}
            >
              <b>{field.name}</b>
              <span className="text-12 muted" style={{ marginLeft: 6 }}>
                {fieldTypeLabel(field.fieldType)}
                {field.required ? " · 必填" : ""}
              </span>
              <Button
                type="link"
                icon={<EditOutlined />}
                style={{ padding: "0 4px", marginLeft: 6 }}
                onClick={() => openEdit(field)}
              >
                改
              </Button>
            </Tag>
          ))}
        </Space>
      ) : (
        <>
          <EmptyState text="该表还没有列，先添加列再录入数据" />
          <Button onClick={openCreate}>添加列</Button>
        </>
      )}

      <Modal
        open={open}
        title={editing ? "修改列" : "添加列"}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText={busy ? "提交中" : "保存"}
        cancelText="取消"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_FORM}>
          <Form.Item
            name="name"
            label="列名"
            rules={[{ required: true, message: "请填写列名" }]}
          >
            <Input placeholder="如 客户名称" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="field_key"
            label="列键"
            extra={
              editing
                ? "列键建列后不可修改（已存行数据以它为键），要换键请删列重建"
                : "行数据与机器通道写入用的键：小写字母、数字、下划线，表内唯一"
            }
            rules={
              editing
                ? []
                : [
                    { required: true, message: "请填写列键" },
                    {
                      pattern: /^[a-z0-9_]+$/,
                      message: "只能用小写字母、数字与下划线",
                    },
                  ]
            }
          >
            <Input
              placeholder="如 customer_name"
              disabled={Boolean(editing)}
              maxLength={64}
            />
          </Form.Item>
          <Form.Item name="field_type" label="类型">
            <Select options={FIELD_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="choices"
            label="候选项（仅单选列）"
            extra="逗号分隔，如 待联系,已签约,已终止"
          >
            <Input placeholder="待联系,已签约,已终止" />
          </Form.Item>
          <Form.Item name="required" valuePropName="checked">
            <Checkbox>必填（录入与机器通道写入都校验）</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
      {modal}
    </Panel>
  );
}
