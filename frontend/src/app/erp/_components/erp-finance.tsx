"use client";

import { Button, Form, Input, InputNumber, Modal, Select, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { erpApi } from "@/api/erp";
import { Notice, Panel, PillTabs, TabStrip } from "@/components/ui/panel";
import {
  ErpEntityModal,
  Toolbar,
  day,
  erpError,
  expenseStatusTag,
  money,
  receivableStatusTag,
  type ErpExpenseReport,
  type ErpPayable,
  type ErpReceivable,
  type ErpVendor,
} from "./erp-common";

type Mode = "receivables" | "payables" | "expenses";

export function ErpFinanceTab() {
  const [mode, setMode] = useState<Mode>("receivables");
  const [vendors, setVendors] = useState<ErpVendor[]>([]);
  const [receivables, setReceivables] = useState<ErpReceivable[]>([]);
  const [receivableTotal, setReceivableTotal] = useState(0);
  const [receivablePage, setReceivablePage] = useState(1);
  const [payables, setPayables] = useState<ErpPayable[]>([]);
  const [payableTotal, setPayableTotal] = useState(0);
  const [payablePage, setPayablePage] = useState(1);
  const [expenses, setExpenses] = useState<ErpExpenseReport[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [expensePage, setExpensePage] = useState(1);
  const [expenseStatus, setExpenseStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [modal, setModal] = useState<"" | "receivable" | "payable" | "expense" | "collect" | "pay">("");
  const [collectForm] = Form.useForm();
  const [expenseForm] = Form.useForm();

  const loadBase = useCallback(async () => {
    try {
      const data = await erpApi.vendors({ query: { page: 1, pageSize: 200 } });
      setVendors(data?.list || []);
    } catch {
      setVendors([]);
    }
  }, []);

  const loadReceivables = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.receivables({ query: { page: receivablePage, pageSize: 20 } });
      setReceivables(data?.list || []);
      setReceivableTotal(data?.total || 0);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [receivablePage]);

  const loadPayables = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.payables({ query: { page: payablePage, pageSize: 20 } });
      setPayables(data?.list || []);
      setPayableTotal(data?.total || 0);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [payablePage]);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.expenses({ query: { page: expensePage, pageSize: 20, status: expenseStatus || undefined } });
      setExpenses(data?.list || []);
      setExpenseTotal(data?.total || 0);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [expensePage, expenseStatus]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (mode === "receivables") void loadReceivables();
    if (mode === "payables") void loadPayables();
    if (mode === "expenses") void loadExpenses();
  }, [mode, loadReceivables, loadPayables, loadExpenses]);

  const saveReceivable = async (values: Record<string, unknown>) => {
    await erpApi.saveReceivable({
      body: {
        id: editing?.id ? Number(editing.id) : undefined,
        code: String(values.code || ""),
        customerName: String(values.customerName),
        customerId: 0,
        contractId: 0,
        sourceType: "MANUAL",
        sourceId: 0,
        amount: Number(values.amount || 0),
        dueDate: String(values.dueDate || ""),
        note: String(values.note || ""),
      },
    });
    message.success("已保存");
    await loadReceivables();
  };

  const savePayable = async (values: Record<string, unknown>) => {
    await erpApi.savePayable({
      body: {
        id: editing?.id ? Number(editing.id) : undefined,
        code: String(values.code || ""),
        vendorId: Number(values.vendorId || 0),
        sourceType: "MANUAL",
        sourceId: 0,
        amount: Number(values.amount || 0),
        dueDate: String(values.dueDate || ""),
        recurrence: String(values.recurrence || "NONE") as
          | "NONE"
          | "MONTHLY"
          | "QUARTERLY"
          | "YEARLY",
        nextAt: String(values.nextAt || ""),
        note: String(values.note || ""),
      },
    });
    message.success("已保存");
    await loadPayables();
  };

  const saveExpense = async () => {
    try {
      const values = await expenseForm.validateFields();
      await erpApi.saveExpense({
        body: {
          projectId: 0,
          department: values.department || "",
          items: (values.items || []).map((item: { name: string; amount: number; note?: string }) => ({
            name: item.name,
            amount: Number(item.amount || 0),
            note: item.note || "",
          })),
          note: values.note || "",
          submit: Boolean(values.submit),
        },
      });
      message.success("报销单已保存");
      setModal("");
      expenseForm.resetFields();
      await loadExpenses();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(erpError(err));
    }
  };

  const collect = async () => {
    try {
      const values = await collectForm.validateFields();
      if (modal === "pay") {
        await erpApi.payPayable({ body: { id: Number(editing?.id), amount: Number(values.amount), note: values.note || "" } });
      } else {
        await erpApi.receivePayment({ body: { id: Number(editing?.id), amount: Number(values.amount), note: values.note || "" } });
      }
      message.success("已登记");
      setModal("");
      collectForm.resetFields();
      await (modal === "pay" ? loadPayables() : loadReceivables());
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(erpError(err));
    }
  };

  const decideExpense = async (row: ErpExpenseReport, decision: "approve" | "reject" | "pay") => {
    try {
      await erpApi.decideExpense({ body: { id: row.id, decision, note: "" } });
      await loadExpenses();
    } catch (err) {
      message.error(erpError(err));
    }
  };

  const receivableColumns: ColumnsType<ErpReceivable> = [
    { title: "单号", dataIndex: "code", width: 160 },
    { title: "客户", dataIndex: "customerName" },
    { title: "应收", dataIndex: "amount", width: 120, render: (v: string) => money(v) },
    { title: "已收", dataIndex: "receivedAmount", width: 120, render: (v: string) => money(v) },
    { title: "未收", dataIndex: "outstanding", width: 120, render: (v: string) => money(v) },
    { title: "到期", dataIndex: "dueDate", width: 110, render: (v: string) => day(v) },
    { title: "账龄", dataIndex: "agingDays", width: 80, render: (v: number) => `${v} 天` },
    { title: "状态", dataIndex: "status", width: 100, render: (v: string) => receivableStatusTag(v) },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_: unknown, row) =>
        row.status !== "PAID" && row.status !== "CANCELED" ? (
          <>
            <Button type="link" size="small" onClick={() => { setEditing(row); collectForm.setFieldsValue({ amount: Number(row.outstanding) }); setModal("collect"); }}>登记收款</Button>
            <Button type="link" size="small" onClick={() => { setEditing(row); setModal("receivable"); }}>编辑</Button>
          </>
        ) : null,
    },
  ];

  const payableColumns: ColumnsType<ErpPayable> = [
    { title: "单号", dataIndex: "code", width: 160 },
    { title: "供应商", dataIndex: "vendorName", render: (v: string) => v || "—" },
    { title: "应付", dataIndex: "amount", width: 120, render: (v: string) => money(v) },
    { title: "已付", dataIndex: "paidAmount", width: 120, render: (v: string) => money(v) },
    { title: "未付", dataIndex: "outstanding", width: 120, render: (v: string) => money(v) },
    { title: "到期", dataIndex: "dueDate", width: 110, render: (v: string) => day(v) },
    { title: "周期", dataIndex: "recurrence", width: 90, render: (v: string) => ({ NONE: "一次性", MONTHLY: "每月", QUARTERLY: "每季", YEARLY: "每年" } as Record<string, string>)[v] || v },
    { title: "状态", dataIndex: "status", width: 100, render: (v: string) => receivableStatusTag(v) },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_: unknown, row) =>
        row.status !== "PAID" && row.status !== "CANCELED" ? (
          <>
            <Button type="link" size="small" onClick={() => { setEditing(row); collectForm.setFieldsValue({ amount: Number(row.outstanding) }); setModal("pay"); }}>登记付款</Button>
            <Button type="link" size="small" onClick={() => { setEditing(row); setModal("payable"); }}>编辑</Button>
          </>
        ) : null,
    },
  ];

  const expenseColumns: ColumnsType<ErpExpenseReport> = [
    { title: "报销单号", dataIndex: "reportNo", width: 160 },
    { title: "申请人", dataIndex: "applicantId", width: 130 },
    { title: "部门", dataIndex: "department", width: 120, render: (v: string) => v || "—" },
    { title: "金额", dataIndex: "amount", width: 120, render: (v: string) => money(v) },
    { title: "明细", dataIndex: "items", render: (v: { name: string; amount: number }[]) => v.map((item) => `${item.name} ${money(item.amount)}`).join("；") },
    { title: "状态", dataIndex: "status", width: 100, render: (v: string) => expenseStatusTag(v) },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_: unknown, row) => (
        <>
          {row.status === "SUBMITTED" ? (
            <>
              <Button type="link" size="small" onClick={() => void decideExpense(row, "approve")}>通过</Button>
              <Button type="link" size="small" danger onClick={() => void decideExpense(row, "reject")}>驳回</Button>
            </>
          ) : null}
          {row.status === "APPROVED" ? (
            <Button type="link" size="small" onClick={() => void decideExpense(row, "pay")}>支付</Button>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <Panel
      title="应收应付"
      extra={
        <>
          <TabStrip
            items={[
              { key: "receivables", label: "应收" },
              { key: "payables", label: "应付" },
              { key: "expenses", label: "报销" },
            ]}
            value={mode}
            onChange={(key) => setMode(key as Mode)}
          />
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              setModal(mode === "receivables" ? "receivable" : mode === "payables" ? "payable" : "expense");
            }}
          >
            {mode === "receivables" ? "新建应收" : mode === "payables" ? "新建应付" : "新建报销"}
          </Button>
        </>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}

      {mode === "receivables" ? (
        <Table<ErpReceivable>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={receivableColumns}
          dataSource={receivables}
          scroll={{ x: "max-content" }}
          pagination={{ current: receivablePage, pageSize: 20, total: receivableTotal, showSizeChanger: false, onChange: setReceivablePage }}
          locale={{ emptyText: "暂无应收" }}
        />
      ) : null}

      {mode === "payables" ? (
        <Table<ErpPayable>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={payableColumns}
          dataSource={payables}
          scroll={{ x: "max-content" }}
          pagination={{ current: payablePage, pageSize: 20, total: payableTotal, showSizeChanger: false, onChange: setPayablePage }}
          locale={{ emptyText: "暂无应付" }}
        />
      ) : null}

      {mode === "expenses" ? (
        <>
          <Toolbar hint={`共 ${expenseTotal} 张报销单`}>
            <PillTabs
              items={[
                { key: "", label: "全部" },
                { key: "SUBMITTED", label: "待审批" },
                { key: "APPROVED", label: "待支付" },
                { key: "PAID", label: "已支付" },
              ]}
              value={expenseStatus}
              onChange={(key) => { setExpenseStatus(key); setExpensePage(1); }}
              size="small"
              variant="soft"
            />
          </Toolbar>
          <Table<ErpExpenseReport>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={expenseColumns}
            dataSource={expenses}
            scroll={{ x: "max-content" }}
            pagination={{ current: expensePage, pageSize: 20, total: expenseTotal, showSizeChanger: false, onChange: setExpensePage }}
            locale={{ emptyText: "暂无报销单" }}
          />
        </>
      ) : null}

      <ErpEntityModal
        open={modal === "receivable"}
        title={editing?.id ? "编辑应收" : "新建应收"}
        onClose={() => setModal("")}
        initial={editing || {}}
        onSubmit={saveReceivable}
        fields={[
          { name: "customerName", label: "客户名称", required: true },
          { name: "code", label: "单号" },
          { name: "amount", label: "应收金额", kind: "money", required: true },
          { name: "dueDate", label: "到期日期", kind: "date" },
          { name: "note", label: "备注", kind: "textarea", span: 24 },
        ]}
      />

      <ErpEntityModal
        open={modal === "payable"}
        title={editing?.id ? "编辑应付" : "新建应付"}
        onClose={() => setModal("")}
        initial={editing || { recurrence: "NONE" }}
        onSubmit={savePayable}
        fields={[
          { name: "vendorId", label: "供应商", kind: "select", options: vendors.map((row) => ({ value: row.id, label: row.name })) },
          { name: "code", label: "单号" },
          { name: "amount", label: "应付金额", kind: "money", required: true },
          { name: "dueDate", label: "到期日期", kind: "date" },
          { name: "recurrence", label: "周期性", kind: "select", options: [{ value: "NONE", label: "一次性" }, { value: "MONTHLY", label: "每月" }, { value: "QUARTERLY", label: "每季" }, { value: "YEARLY", label: "每年" }] },
          { name: "nextAt", label: "下次应付日期", kind: "date" },
          { name: "note", label: "备注", kind: "textarea", span: 24 },
        ]}
      />

      <Modal
        open={modal === "collect" || modal === "pay"}
        title={modal === "pay" ? "登记付款" : "登记收款"}
        onCancel={() => setModal("")}
        onOk={() => void collect()}
        destroyOnHidden
      >
        <Form form={collectForm} layout="vertical">
          <Form.Item name="amount" label="金额" rules={[{ required: true, message: "请填写金额" }]}>
            <InputNumber style={{ width: "100%" }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={modal === "expense"}
        title="新建报销单"
        onCancel={() => setModal("")}
        onOk={() => void saveExpense()}
        width={640}
        destroyOnHidden
      >
        <Form form={expenseForm} layout="vertical" initialValues={{ submit: true }}>
          <Form.Item name="department" label="部门">
            <Input />
          </Form.Item>
          <Form.List name="items" initialValue={[{ amount: 0 }]}>
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div key={field.key} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <Form.Item name={[field.name, "name"]} rules={[{ required: true, message: "费用名称" }]} style={{ flex: 1 }}>
                      <Input placeholder="费用名称" />
                    </Form.Item>
                    <Form.Item name={[field.name, "amount"]} rules={[{ required: true, message: "金额" }]} style={{ width: 140 }}>
                      <InputNumber min={0} precision={2} placeholder="金额" />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
                <Button onClick={() => add({ amount: 0 })}>添加明细</Button>
              </>
            )}
          </Form.List>
          <Form.Item name="note" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="submit" label="立即提交审批">
            <Select options={[{ value: true, label: "提交" }, { value: false, label: "存草稿" }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Panel>
  );
}
