"use client";

import { Form, Input, InputNumber, Modal, Select, Tag } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import {
  z,
  erpAiInsightSchema,
  erpCategorySchema,
  erpOverviewSchema,
  erpExpenseReportSchema,
  erpPayableSchema,
  erpPricePolicySchema,
  erpProductSchema,
  erpPurchaseOrderSchema,
  erpReceivableSchema,
  erpReceiptSchema,
  erpStockAlertSchema,
  erpStockMoveSchema,
  erpStockRequestSchema,
  erpStockSchema,
  erpTaxRateSchema,
  erpVariantSchema,
  erpVendorSchema,
  erpWarehouseSchema,
} from "@enterprise/contracts";
import { fmtDate } from "@/lib/datetime";

export type ErpCategory = z.infer<typeof erpCategorySchema>;
export type ErpOverview = z.infer<typeof erpOverviewSchema>;
export type ErpInsight = z.infer<typeof erpAiInsightSchema>;
export type ErpProduct = z.infer<typeof erpProductSchema>;
export type ErpVariant = z.infer<typeof erpVariantSchema>;
export type ErpWarehouse = z.infer<typeof erpWarehouseSchema>;
export type ErpStock = z.infer<typeof erpStockSchema>;
export type ErpStockAlert = z.infer<typeof erpStockAlertSchema>;
export type ErpStockMove = z.infer<typeof erpStockMoveSchema>;
export type ErpStockRequest = z.infer<typeof erpStockRequestSchema>;
export type ErpVendor = z.infer<typeof erpVendorSchema>;
export type ErpPurchaseOrder = z.infer<typeof erpPurchaseOrderSchema>;
export type ErpReceipt = z.infer<typeof erpReceiptSchema>;
export type ErpReceivable = z.infer<typeof erpReceivableSchema>;
export type ErpPayable = z.infer<typeof erpPayableSchema>;
export type ErpExpenseReport = z.infer<typeof erpExpenseReportSchema>;
export type ErpTaxRate = z.infer<typeof erpTaxRateSchema>;
export type ErpPricePolicy = z.infer<typeof erpPricePolicySchema>;

export function erpError(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

export function money(value: string | number) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function day(value: string) {
  return value ? fmtDate(value) : "—";
}

export function Toolbar({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      {children}
      {hint ? (
        <span className="muted text-12" style={{ marginLeft: "auto" }}>{hint}</span>
      ) : null}
    </div>
  );
}

const PURCHASE_LABELS: Record<string, { color: string; label: string }> = {
  DRAFT: { color: "default", label: "草稿" },
  PENDING: { color: "gold", label: "待审批" },
  APPROVED: { color: "processing", label: "已批准" },
  RECEIVING: { color: "cyan", label: "收货中" },
  DONE: { color: "green", label: "已完成" },
  CANCELED: { color: "default", label: "已取消" },
};

export function purchaseStatusTag(status: string) {
  const item = PURCHASE_LABELS[status] || PURCHASE_LABELS.DRAFT;
  return <Tag color={item.color}>{item.label}</Tag>;
}

const RECEIVABLE_LABELS: Record<string, { color: string; label: string }> = {
  OPEN: { color: "gold", label: "未收款" },
  PARTIAL: { color: "cyan", label: "部分收款" },
  PAID: { color: "green", label: "已收款" },
  OVERDUE: { color: "red", label: "已逾期" },
  CANCELED: { color: "default", label: "已取消" },
};

export function receivableStatusTag(status: string) {
  const item = RECEIVABLE_LABELS[status] || RECEIVABLE_LABELS.OPEN;
  return <Tag color={item.color}>{item.label}</Tag>;
}

const EXPENSE_LABELS: Record<string, { color: string; label: string }> = {
  DRAFT: { color: "default", label: "草稿" },
  SUBMITTED: { color: "gold", label: "待审批" },
  APPROVED: { color: "processing", label: "已通过" },
  REJECTED: { color: "red", label: "已驳回" },
  PAID: { color: "green", label: "已支付" },
};

export function expenseStatusTag(status: string) {
  const item = EXPENSE_LABELS[status] || EXPENSE_LABELS.DRAFT;
  return <Tag color={item.color}>{item.label}</Tag>;
}

export type ErpField = {
  name: string;
  label: string;
  kind?: "text" | "textarea" | "number" | "money" | "date" | "select";
  required?: boolean;
  options?: { value: string | number; label: string }[];
  span?: number;
  min?: number;
  max?: number;
  precision?: number;
  placeholder?: string;
};

/** 通用实体弹窗：ERP 主数据与单据字段形状一致，统一一套表单渲染。 */
export function ErpEntityModal({
  open,
  title,
  fields,
  initial,
  onClose,
  onSubmit,
  width = 720,
}: {
  open: boolean;
  title: string;
  fields: ErpField[];
  initial?: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  width?: number;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) form.setFieldsValue(initial || {});
  }, [open, initial, form]);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await onSubmit(values as Record<string, unknown>);
      onClose();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      throw error;
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0 16px" }}>
          {fields.map((item) => (
            <div key={item.name} style={{ width: `${((item.span || 12) / 24) * 100 - 2}%` }}>
              <Form.Item
                name={item.name}
                label={item.label}
                rules={item.required ? [{ required: true, message: `请填写${item.label}` }] : undefined}
              >
                {item.kind === "textarea" ? (
                  <Input.TextArea rows={3} placeholder={item.placeholder} />
                ) : item.kind === "number" || item.kind === "money" ? (
                  <InputNumber
                    style={{ width: "100%" }}
                    min={item.min}
                    max={item.max}
                    precision={item.kind === "money" ? 2 : item.precision}
                    placeholder={item.placeholder}
                  />
                ) : item.kind === "select" ? (
                  <Select options={item.options || []} placeholder={item.placeholder} allowClear />
                ) : item.kind === "date" ? (
                  <Input type="date" />
                ) : (
                  <Input placeholder={item.placeholder} />
                )}
              </Form.Item>
            </div>
          ))}
        </div>
      </Form>
    </Modal>
  );
}

export function productOptions(rows: ErpProduct[]) {
  return rows.map((row) => ({ value: row.id, label: `${row.name}${row.code ? `（${row.code}）` : ""}` }));
}

export function variantOptions(rows: ErpVariant[]) {
  return rows.map((row) => ({
    value: row.id,
    label: `${row.productName}${row.name ? ` / ${row.name}` : ""} · ${row.sku}`,
  }));
}
