"use client";

import { Button, Form, Input, InputNumber, Modal, Select, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { erpApi } from "@/api/erp";
import { projectApi } from "@/api/project";
import { Notice, Panel, PillTabs, TabStrip } from "@/components/ui/panel";
import {
  ErpEntityModal,
  Toolbar,
  day,
  erpError,
  money,
  purchaseStatusTag,
  variantOptions,
  type ErpPurchaseOrder,
  type ErpReceipt,
  type ErpVariant,
  type ErpVendor,
  type ErpWarehouse,
} from "./erp-common";

type Mode = "orders" | "vendors" | "receipts";

export function ErpPurchaseTab() {
  const [mode, setMode] = useState<Mode>("orders");
  const [vendors, setVendors] = useState<ErpVendor[]>([]);
  const [warehouses, setWarehouses] = useState<ErpWarehouse[]>([]);
  const [variants, setVariants] = useState<ErpVariant[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [orders, setOrders] = useState<ErpPurchaseOrder[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [orderStatus, setOrderStatus] = useState("");
  const [receipts, setReceipts] = useState<ErpReceipt[]>([]);
  const [receiptTotal, setReceiptTotal] = useState(0);
  const [receiptPage, setReceiptPage] = useState(1);
  const [vendorRows, setVendorRows] = useState<ErpVendor[]>([]);
  const [vendorTotal, setVendorTotal] = useState(0);
  const [vendorPage, setVendorPage] = useState(1);
  const [vendorQ, setVendorQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [vendorEditing, setVendorEditing] = useState<Record<string, unknown> | null>(null);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [orderForm] = Form.useForm();
  const [receiptForm] = Form.useForm();

  const loadBase = useCallback(async () => {
    try {
      const [vendorData, warehouseRows, variantRows, projectData] = await Promise.all([
        erpApi.vendors({ query: { page: 1, pageSize: 200 } }),
        erpApi.warehouses(),
        erpApi.variants({ query: {} }),
        projectApi.projects({ query: { page: 1, pageSize: 200 } }),
      ]);
      setVendors(vendorData?.list || []);
      setWarehouses(warehouseRows || []);
      setVariants(variantRows || []);
      setProjects((projectData?.list || []).map((row) => ({ id: row.id, name: row.name })));
    } catch (err) {
      setError(erpError(err));
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.purchaseOrders({ query: { page: orderPage, pageSize: 20, status: orderStatus || undefined } });
      setOrders(data?.list || []);
      setOrderTotal(data?.total || 0);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [orderPage, orderStatus]);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.receipts({ query: { page: receiptPage, pageSize: 20 } });
      setReceipts(data?.list || []);
      setReceiptTotal(data?.total || 0);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [receiptPage]);

  const loadVendors = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.vendors({ query: { page: vendorPage, pageSize: 20, q: vendorQ || undefined } });
      setVendorRows(data?.list || []);
      setVendorTotal(data?.total || 0);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [vendorPage, vendorQ]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (mode === "orders") void loadOrders();
    if (mode === "receipts") void loadReceipts();
    if (mode === "vendors") void loadVendors();
  }, [mode, loadOrders, loadReceipts, loadVendors]);

  const saveVendor = async (values: Record<string, unknown>) => {
    await erpApi.saveVendor({
      body: {
        id: vendorEditing?.id ? Number(vendorEditing.id) : undefined,
        code: String(values.code),
        name: String(values.name),
        partyId: Number(values.partyId || 0),
        contactName: String(values.contactName || ""),
        phone: String(values.phone || ""),
        email: String(values.email || ""),
        taxNo: String(values.taxNo || ""),
        address: String(values.address || ""),
        status: (values.status || "ACTIVE") as "ACTIVE",
        note: String(values.note || ""),
      },
    });
    message.success("已保存");
    await loadVendors();
    await loadBase();
  };

  const saveOrder = async () => {
    try {
      const values = await orderForm.validateFields();
      await erpApi.savePurchaseOrder({
        body: {
          vendorId: Number(values.vendorId),
          projectId: Number(values.projectId || 0),
          sourceType: values.sourceType || "MANUAL",
          sourceNo: values.sourceNo || "",
          warehouseId: Number(values.warehouseId),
          items: (values.items || []).map((item: { variantId: number; quantity: number; price: number }) => ({
            variantId: Number(item.variantId),
            quantity: Number(item.quantity),
            price: Number(item.price || 0),
          })),
          expectedAt: values.expectedAt || "",
          note: values.note || "",
        },
      });
      message.success("采购单已保存");
      setOrderOpen(false);
      orderForm.resetFields();
      await loadOrders();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(erpError(err));
    }
  };

  const decideOrder = async (row: ErpPurchaseOrder, decision: "approve" | "reject" | "cancel" | "receive") => {
    try {
      await erpApi.decidePurchaseOrder({ body: { id: row.id, decision, note: "" } });
      await loadOrders();
    } catch (err) {
      message.error(erpError(err));
    }
  };

  const createReceipt = async () => {
    try {
      const values = await receiptForm.validateFields();
      await erpApi.createReceipt({
        body: {
          purchaseOrderId: Number(values.purchaseOrderId),
          items: (values.items || []).map((item: { variantId: number; quantity: number }) => ({
            variantId: Number(item.variantId),
            quantity: Number(item.quantity),
          })),
          note: values.note || "",
        },
      });
      message.success("入库单已创建");
      setReceiptOpen(false);
      receiptForm.resetFields();
      await loadReceipts();
      await loadOrders();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(erpError(err));
    }
  };

  const decideReceipt = async (row: ErpReceipt, decision: "receive" | "reject") => {
    try {
      await erpApi.decideReceipt({ body: { id: row.id, decision, note: "" } });
      await loadReceipts();
    } catch (err) {
      message.error(erpError(err));
    }
  };

  const orderColumns: ColumnsType<ErpPurchaseOrder> = [
    { title: "采购单号", dataIndex: "orderNo", width: 170 },
    {
      title: "来源单",
      dataIndex: "sourceNo",
      width: 160,
      render: (v: string, row) =>
        v
          ? `${row.sourceType === "OA_PURCHASE" ? "OA " : row.sourceType === "STOCK_LOW" ? "补货 " : ""}${v}`
          : "—",
    },
    { title: "供应商", dataIndex: "vendorName" },
    { title: "归属项目", dataIndex: "projectName", width: 150, render: (v: string) => v || "—" },
    { title: "仓库", dataIndex: "warehouseId", width: 80, render: (v: number) => `#${v}` },
    { title: "金额", dataIndex: "amount", width: 120, render: (v: string) => money(v) },
    { title: "税额", dataIndex: "taxAmount", width: 100, render: (v: string) => money(v) },
    { title: "状态", dataIndex: "status", width: 100, render: (v: string) => purchaseStatusTag(v) },
    { title: "预计到货", dataIndex: "expectedAt", width: 110, render: (v: string) => day(v) },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_: unknown, row) => (
        <>
          {row.status === "DRAFT" || row.status === "PENDING" ? (
            <Button type="link" size="small" onClick={() => void decideOrder(row, "approve")}>批准</Button>
          ) : null}
          {row.status === "APPROVED" ? (
            <Button type="link" size="small" onClick={() => void decideOrder(row, "receive")}>收货</Button>
          ) : null}
          {row.status !== "DONE" && row.status !== "CANCELED" ? (
            <Button type="link" size="small" danger onClick={() => void decideOrder(row, "cancel")}>取消</Button>
          ) : null}
        </>
      ),
    },
  ];

  const vendorColumns: ColumnsType<ErpVendor> = [
    { title: "编码", dataIndex: "code", width: 130 },
    { title: "供应商", dataIndex: "name" },
    { title: "联系人", dataIndex: "contactName", width: 110, render: (v: string) => v || "—" },
    { title: "电话", dataIndex: "phone", width: 130, render: (v: string) => v || "—" },
    { title: "税号", dataIndex: "taxNo", width: 170, render: (v: string) => v || "—" },
    { title: "状态", dataIndex: "status", width: 80, render: (v: string) => (v === "ACTIVE" ? "合作中" : "停用") },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { setVendorEditing(row); setVendorOpen(true); }}>编辑</Button>
          <Button type="link" size="small" danger onClick={() => void erpApi.removeVendor({ body: { id: row.id } }).then(() => Promise.all([loadVendors(), loadBase()])).catch((err) => message.error(erpError(err)))}>删除</Button>
        </>
      ),
    },
  ];

  const receiptColumns: ColumnsType<ErpReceipt> = [
    { title: "入库单号", dataIndex: "receiptNo", width: 170 },
    { title: "采购单", dataIndex: "orderNo", width: 160 },
    { title: "仓库", dataIndex: "warehouseName", width: 130 },
    { title: "金额", dataIndex: "amount", width: 120, render: (v: string) => money(v) },
    { title: "状态", dataIndex: "status", width: 100, render: (v: string) => ({ PENDING: "待收货", RECEIVED: "已入库", REJECTED: "已驳回" } as Record<string, string>)[v] || v },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_: unknown, row) =>
        row.status === "PENDING" ? (
          <>
            <Button type="link" size="small" onClick={() => void decideReceipt(row, "receive")}>确认入库</Button>
            <Button type="link" size="small" danger onClick={() => void decideReceipt(row, "reject")}>驳回</Button>
          </>
        ) : null,
    },
  ];

  return (
    <Panel
      title="采购"
      extra={
        <>
          <TabStrip
            items={[
              { key: "orders", label: "采购单" },
              { key: "receipts", label: "入库单" },
              { key: "vendors", label: "供应商" },
            ]}
            value={mode}
            onChange={(key) => setMode(key as Mode)}
          />
          <Button
            type="primary"
            onClick={() => {
              if (mode === "vendors") {
                setVendorEditing(null);
                setVendorOpen(true);
              } else if (mode === "receipts") setReceiptOpen(true);
              else setOrderOpen(true);
            }}
          >
            {mode === "vendors" ? "新建供应商" : mode === "receipts" ? "新建入库单" : "新建采购单"}
          </Button>
        </>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}

      {mode === "orders" ? (
        <>
          <Toolbar hint={`共 ${orderTotal} 张采购单`}>
            <PillTabs
              items={[
                { key: "", label: "全部" },
                { key: "PENDING", label: "待审批" },
                { key: "APPROVED", label: "已批准" },
                { key: "RECEIVING", label: "收货中" },
                { key: "DONE", label: "已完成" },
              ]}
              value={orderStatus}
              onChange={(key) => { setOrderStatus(key); setOrderPage(1); }}
              size="small"
              variant="soft"
            />
          </Toolbar>
          <Table<ErpPurchaseOrder>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={orderColumns}
            dataSource={orders}
            scroll={{ x: "max-content" }}
            pagination={{ current: orderPage, pageSize: 20, total: orderTotal, showSizeChanger: false, onChange: setOrderPage }}
            locale={{ emptyText: "暂无采购单" }}
          />
        </>
      ) : null}

      {mode === "vendors" ? (
        <>
          <Toolbar hint={`共 ${vendorTotal} 家供应商`}>
            <Input.Search
              allowClear
              placeholder="搜索供应商"
              style={{ width: 240 }}
              value={vendorQ}
              onChange={(event) => { setVendorQ(event.target.value); setVendorPage(1); }}
            />
          </Toolbar>
          <Table<ErpVendor>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={vendorColumns}
            dataSource={vendorRows}
            pagination={{ current: vendorPage, pageSize: 20, total: vendorTotal, showSizeChanger: false, onChange: setVendorPage }}
            locale={{ emptyText: "暂无供应商" }}
          />
        </>
      ) : null}

      {mode === "receipts" ? (
        <Table<ErpReceipt>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={receiptColumns}
          dataSource={receipts}
          scroll={{ x: "max-content" }}
          pagination={{ current: receiptPage, pageSize: 20, total: receiptTotal, showSizeChanger: false, onChange: setReceiptPage }}
          locale={{ emptyText: "暂无入库单" }}
        />
      ) : null}

      <ErpEntityModal
        open={vendorOpen}
        title={vendorEditing?.id ? "编辑供应商" : "新建供应商"}
        onClose={() => setVendorOpen(false)}
        initial={vendorEditing || { status: "ACTIVE" }}
        onSubmit={saveVendor}
        fields={[
          { name: "code", label: "供应商编码", required: true },
          { name: "name", label: "供应商名称", required: true },
          { name: "contactName", label: "联系人" },
          { name: "phone", label: "电话" },
          { name: "email", label: "邮箱" },
          { name: "taxNo", label: "税号" },
          { name: "address", label: "地址" },
          { name: "status", label: "状态", kind: "select", options: [{ value: "ACTIVE", label: "合作中" }, { value: "INACTIVE", label: "停用" }] },
          { name: "note", label: "备注", kind: "textarea", span: 24 },
        ]}
      />

      <Modal
        open={orderOpen}
        title="新建采购单"
        onCancel={() => setOrderOpen(false)}
        onOk={() => void saveOrder()}
        width={760}
        destroyOnHidden
      >
        <Form form={orderForm} layout="vertical">
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item name="vendorId" label="供应商" rules={[{ required: true, message: "请选择供应商" }]} style={{ flex: 1 }}>
              <Select options={vendors.map((row) => ({ value: row.id, label: row.name }))} />
            </Form.Item>
            <Form.Item name="warehouseId" label="收货仓库" rules={[{ required: true, message: "请选择仓库" }]} style={{ flex: 1 }}>
              <Select options={warehouses.map((row) => ({ value: row.id, label: row.name }))} />
            </Form.Item>
            <Form.Item name="expectedAt" label="预计到货" style={{ width: 170 }}>
              <Input type="date" />
            </Form.Item>
          </div>
          <Form.Item
            name="projectId"
            label="归属项目"
            tooltip="选项目后，入库即自动归集项目成本并生成应付；留空则不计入项目"
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="不归集到项目"
              options={projects.map((row) => ({ value: row.id, label: row.name }))}
            />
          </Form.Item>
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item
              name="sourceType"
              label="来源"
              initialValue="MANUAL"
              tooltip="OA 采购申请已审批通过后转采购时选「OA 采购申请」，并填申请单号，便于逐单追溯"
              style={{ width: 200 }}
            >
              <Select
                options={[
                  { value: "MANUAL", label: "直接下单" },
                  { value: "OA_PURCHASE", label: "OA 采购申请" },
                ]}
              />
            </Form.Item>
            <Form.Item name="sourceNo" label="来源单号" style={{ flex: 1 }}>
              <Input placeholder="如 OA 采购申请单号 CG2026…" />
            </Form.Item>
          </div>
          <Form.List name="items" initialValue={[{ quantity: 1, price: 0 }]}>
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div key={field.key} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <Form.Item name={[field.name, "variantId"]} rules={[{ required: true, message: "选择变体" }]} style={{ flex: 1 }}>
                      <Select showSearch optionFilterProp="label" placeholder="变体" options={variantOptions(variants)} />
                    </Form.Item>
                    <Form.Item name={[field.name, "quantity"]} rules={[{ required: true, message: "数量" }]} style={{ width: 110 }}>
                      <InputNumber min={1} placeholder="数量" />
                    </Form.Item>
                    <Form.Item name={[field.name, "price"]} style={{ width: 130 }}>
                      <InputNumber min={0} placeholder="单价" />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
                <Button onClick={() => add({ quantity: 1, price: 0 })}>添加明细</Button>
              </>
            )}
          </Form.List>
          <Form.Item name="note" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={receiptOpen}
        title="新建入库单"
        onCancel={() => setReceiptOpen(false)}
        onOk={() => void createReceipt()}
        width={640}
        destroyOnHidden
      >
        <Form form={receiptForm} layout="vertical">
          <Form.Item name="purchaseOrderId" label="采购单" rules={[{ required: true, message: "请选择采购单" }]}>
            <Select
              options={orders
                .filter((row) => row.status === "APPROVED" || row.status === "RECEIVING")
                .map((row) => ({ value: row.id, label: `${row.orderNo} · ${row.vendorName}` }))}
              onChange={(value) => {
                const order = orders.find((row) => row.id === value);
                receiptForm.setFieldsValue({
                  items: (order?.items || []).map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
                });
              }}
            />
          </Form.Item>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div key={field.key} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <Form.Item name={[field.name, "variantId"]} rules={[{ required: true, message: "选择变体" }]} style={{ flex: 1 }}>
                      <Select showSearch optionFilterProp="label" placeholder="变体" options={variantOptions(variants)} />
                    </Form.Item>
                    <Form.Item name={[field.name, "quantity"]} rules={[{ required: true, message: "数量" }]} style={{ width: 130 }}>
                      <InputNumber min={1} placeholder="数量" />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
                <Button onClick={() => add({ quantity: 1 })}>添加明细</Button>
              </>
            )}
          </Form.List>
          <Form.Item name="note" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Panel>
  );
}
