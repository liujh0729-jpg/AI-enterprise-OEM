"use client";

import { UnorderedListOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Space, Table } from "antd";
import type { TableProps } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState, Panel } from "@/components/ui/panel";

export type EditorRow = Record<string, unknown> & { id?: string };

export type RowField = {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "date";
  options?: { label: string; value: string }[];
  placeholder?: string;
  required?: boolean;
};

/**
 * 逐条录入的明细列表：点「＋ 添加」一次只填一条，保存后进入上方列表，
 * 每条可单独编辑 / 删除。用于员工与工资、发票、银行流水、发薪员工等明细，
 * 避免让人在一个大表单里一次填几百行。
 */
export function RowListEditor({
  title,
  tip,
  addText,
  emptyText,
  emptyIcon = <UnorderedListOutlined aria-hidden />,
  fields,
  columns,
  rows,
  loading,
  extra,
  pendingRow,
  onPendingConsumed,
  onAdd,
  onUpdate,
  onRemove,
}: {
  title: string;
  tip?: string;
  addText: string;
  emptyText: string;
  emptyIcon?: ReactNode;
  fields: RowField[];
  columns: { title: string; dataIndex?: string; render?: (row: EditorRow) => ReactNode }[];
  rows: EditorRow[];
  loading?: boolean;
  extra?: ReactNode;
  /** 外部（如发票 OCR）识别的结果：置入后自动打开「新增明细」表单并预填，仍是逐条添加。 */
  pendingRow?: EditorRow | null;
  onPendingConsumed?: () => void;
  onAdd: (row: EditorRow) => Promise<void>;
  onUpdate: (rowId: string, patch: EditorRow) => Promise<void>;
  onRemove: (rowId: string) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<EditorRow | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pendingRow) return;
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(pendingRow);
    setOpen(true);
    onPendingConsumed?.();
  }, [pendingRow, form, onPendingConsumed]);

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (row: EditorRow) => {
    setEditing(row);
    form.setFieldsValue(row);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setBusy(true);
    try {
      if (editing?.id) {
        await onUpdate(String(editing.id), values as EditorRow);
        message.success("已保存该条明细");
      } else {
        await onAdd(values as EditorRow);
        message.success("已添加，可继续添加下一条");
      }
      setOpen(false);
      form.resetFields();
      setEditing(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const tableColumns: TableProps<EditorRow>["columns"] = [
    ...columns.map((column) => ({
      title: column.title,
      dataIndex: column.dataIndex,
      render: column.render
        ? (_: unknown, row: EditorRow) => column.render?.(row)
        : undefined,
    })),
    {
      title: "操作",
      width: 130,
      render: (_: unknown, row: EditorRow) => (
        <Space size={6}>
          <Button onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button danger onClick={() => removeRow(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const removeRow = (row: EditorRow) => {
    Modal.confirm({
      title: "删除该条明细",
      content: "删除后需重新录入，确定删除吗？",
      okText: "确认删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        await onRemove(String(row.id));
        message.success("已删除该条明细");
      },
    });
  };

  return (
    <Panel
      title={title}
      titleBadge={`${rows.length} 条`}
      extra={
        <Space>
          {extra}
          <Button type="primary" onClick={openAdd}>
            {addText}
          </Button>
        </Space>
      }
    >
      {tip ? (
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          {tip}
        </div>
      ) : null}
      <div className="table-wrap">
        <Table<EditorRow>
          rowKey={(row) => String(row.id ?? JSON.stringify(row))}
          loading={loading}
          pagination={false}
          size="middle"
          dataSource={rows}
          columns={tableColumns}
          locale={{ emptyText: <EmptyState icon={emptyIcon} text={emptyText} /> }}
        />
      </div>

      <Modal
        open={open}
        title={editing ? `${title} · 编辑明细` : `${title} · 新增明细`}
        okText={editing ? "保存" : "添加"}
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setOpen(false)}
        onOk={submit}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          一次只添加一条，保存后可继续添加下一条。
        </div>
        <Form form={form} layout="vertical">
          <div className="form-2col">
            {fields.map((field) => (
              <Form.Item
                key={field.name}
                name={field.name}
                label={field.label}
                rules={
                  field.required
                    ? [{ required: true, message: `请填写${field.label}` }]
                    : undefined
                }
              >
                {field.type === "select" ? (
                  <Select
                    options={field.options}
                    placeholder={field.placeholder}
                  />
                ) : field.type === "number" ? (
                  <Input type="number" placeholder={field.placeholder} />
                ) : field.type === "date" ? (
                  <Input placeholder={field.placeholder || "YYYY-MM-DD"} />
                ) : (
                  <Input placeholder={field.placeholder} />
                )}
              </Form.Item>
            ))}
          </div>
        </Form>
      </Modal>
    </Panel>
  );
}