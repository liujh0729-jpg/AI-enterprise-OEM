"use client";

import {
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState, type ReactNode } from "react";
import type {
  CrmMemberRow,
  CrmFieldDef,
} from "@enterprise/contracts";

export type MemberRow = CrmMemberRow;
export type FieldDef = CrmFieldDef;

export type FieldSpec = {
  name: string;
  label: string;
  kind?:
    | "text"
    | "textarea"
    | "number"
    | "money"
    | "date"
    | "select"
    | "member"
    | "customer"
    | "switch";
  required?: boolean;
  options?: { value: string | number; label: string }[];
  placeholder?: string;
  span?: number;
  min?: number;
  max?: number;
  precision?: number;
};

export function errText(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

export function Money({ value }: { value: unknown }) {
  const n = Number(value || 0);
  return <span>{n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

const STATUS_COLORS: Record<string, string> = {
  NEW: "blue",
  FOLLOWING: "processing",
  INTERESTED: "gold",
  SUCCESS: "green",
  FAIL: "red",
  APPROVING: "processing",
  APPROVED: "green",
  UNAPPROVED: "red",
  REVOKED: "default",
  PENDING: "orange",
  PARTIAL: "gold",
  DONE: "green",
};

export function StatusTag({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  if (!value) return <Tag>未提交</Tag>;
  return <Tag color={STATUS_COLORS[value] || "default"}>{label || value}</Tag>;
}

export function EntityModal({
  open,
  title,
  fields,
  initial,
  members,
  customers,
  onClose,
  onSubmit,
  width = 720,
  extra,
  formKey,
}: {
  open: boolean;
  title: string;
  fields: FieldSpec[];
  initial?: Record<string, unknown>;
  members?: MemberRow[];
  customers?: { id: number; name: string }[];
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  width?: number;
  extra?: ReactNode;
  formKey?: string;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const customDefs = useFieldDefs(formKey);

  useEffect(() => {
    if (open) {
      form.setFieldsValue(initial || {});
    }
  }, [open, initial, form]);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await onSubmit(values as Record<string, unknown>);
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
      title={title}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      width={width}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          {fields.map((item) => (
            <Col span={item.span || 12} key={item.name}>
              <Form.Item
                name={item.name}
                label={item.label}
                rules={item.required ? [{ required: true, message: `请填写${item.label}` }] : undefined}
                valuePropName={item.kind === "switch" ? "checked" : undefined}
              >
                {item.kind === "textarea" ? (
                  <Input.TextArea rows={3} placeholder={item.placeholder} />
                ) : item.kind === "number" || item.kind === "money" ? (
                  <InputNumber
                    style={{ width: "100%" }}
                    min={item.min}
                    max={item.max}
                    precision={item.kind === "money" ? (item.precision ?? 2) : item.precision}
                    placeholder={item.placeholder}
                  />
                ) : item.kind === "select" ? (
                  <Select options={item.options || []} placeholder={item.placeholder} allowClear />
                ) : item.kind === "member" ? (
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={(members || []).map((row) => ({
                      value: row.memberUserId,
                      label: row.memberName,
                    }))}
                    placeholder={item.placeholder || "选择成员"}
                    allowClear
                  />
                ) : item.kind === "customer" ? (
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={(customers || []).map((row) => ({
                      value: row.id,
                      label: row.name,
                    }))}
                    placeholder={item.placeholder || "选择客户"}
                    allowClear
                  />
                ) : item.kind === "date" ? (
                  <Input type="date" />
                ) : item.kind === "switch" ? (
                  <Select
                    options={[
                      { value: true, label: "启用" },
                      { value: false, label: "停用" },
                    ]}
                  />
                ) : (
                  <Input placeholder={item.placeholder} />
                )}
              </Form.Item>
            </Col>
          ))}
        </Row>
        {formKey ? (
          <CustomFields formKey={formKey} defs={customDefs} />
        ) : null}
        {extra}
      </Form>
    </Modal>
  );
}

const CUSTOM_FORMS: Record<string, string> = {
  lead: "lead",
  customer: "customer",
  contact: "contact",
  opportunity: "opportunity",
  quotation: "quotation",
  contract: "contract",
  payment: "payment",
  invoice: "invoice",
  order: "order",
};

export function CustomFields({
  formKey,
  defs,
}: {
  formKey: string;
  defs: FieldDef[];
}) {
  const list = defs.filter(
    (item) => item.formKey === (CUSTOM_FORMS[formKey] || formKey) && item.visible,
  );
  if (!list.length) return null;
  return (
    <Row gutter={16}>
      {list.map((item) => (
        <Col span={12} key={item.id}>
          <Form.Item
            name={["custom", item.fieldKey]}
            label={item.name}
            rules={item.required ? [{ required: true, message: `请填写${item.name}` }] : undefined}
          >
            {item.type === "textarea" ? (
              <Input.TextArea rows={2} />
            ) : item.type === "number" ? (
              <InputNumber style={{ width: "100%" }} />
            ) : item.type === "select" || item.type === "multiselect" ? (
              <Select
                mode={item.type === "multiselect" ? "multiple" : undefined}
                options={(item.options || []).map((value) => ({ value, label: value }))}
              />
            ) : item.type === "date" ? (
              <Input type="date" />
            ) : (
              <Input />
            )}
          </Form.Item>
        </Col>
      ))}
    </Row>
  );
}

export function SearchBar({
  value,
  onChange,
  placeholder = "搜索",
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div className="crm-toolbar">
      <Input.Search
        allowClear
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onSearch={() => undefined}
        style={{ width: 240 }}
      />
      {children}
    </div>
  );
}

export function TableShell<T extends object>({
  columns,
  rows,
  loading,
  total,
  page,
  pageSize,
  onPage,
  rowKey = "id",
  empty = "暂无数据",
}: {
  columns: ColumnsType<T>;
  rows: T[];
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  rowKey?: string;
  empty?: string;
}) {
  return (
    <Table<T>
      rowKey={rowKey}
      size="middle"
      columns={columns}
      dataSource={rows}
      loading={loading}
      locale={{ emptyText: empty }}
      scroll={{ x: "max-content" }}
      pagination={
        onPage
          ? {
              current: page || 1,
              pageSize: pageSize || 20,
              total: total || 0,
              showSizeChanger: false,
              onChange: onPage,
            }
          : false
      }
    />
  );
}

export function ActionButton({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button type="link" size="small" danger={danger} onClick={onClick}>
      {children}
    </Button>
  );
}

export function useFieldDefs(formKey?: string) {
  const [defs, setDefs] = useState<FieldDef[]>([]);
  useEffect(() => {
    void import("@/api/crm").then(({ crmApi }) =>
      crmApi
        .fieldDefs({ query: formKey ? { formKey } : {} })
        .then((data) => setDefs((data || []) as FieldDef[]))
        .catch(() => undefined),
    );
  }, [formKey]);
  return defs;
}