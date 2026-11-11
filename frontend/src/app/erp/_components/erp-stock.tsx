"use client";

import { Button, Form, Input, InputNumber, Modal, Select, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { erpApi } from "@/api/erp";
import { Notice, Panel, PillTabs, TabStrip } from "@/components/ui/panel";
import {
  ErpEntityModal,
  Toolbar,
  day,
  erpError,
  money,
  variantOptions,
  type ErpStock,
  type ErpStockAlert,
  type ErpStockMove,
  type ErpStockRequest,
  type ErpVariant,
  type ErpWarehouse,
} from "./erp-common";

type Mode = "stock" | "moves" | "alerts" | "requests";

const MOVE_TYPES = [
  { value: "IN", label: "入库" },
  { value: "OUT", label: "出库" },
  { value: "TRANSFER", label: "调拨" },
  { value: "ADJUST", label: "盘点调整" },
];

export function ErpStockTab() {
  const [mode, setMode] = useState<Mode>("stock");
  const [warehouses, setWarehouses] = useState<ErpWarehouse[]>([]);
  const [variants, setVariants] = useState<ErpVariant[]>([]);
  const [stock, setStock] = useState<ErpStock[]>([]);
  const [stockTotal, setStockTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [warehouseId, setWarehouseId] = useState(0);
  const [lowOnly, setLowOnly] = useState(false);
  const [moves, setMoves] = useState<ErpStockMove[]>([]);
  const [moveTotal, setMoveTotal] = useState(0);
  const [movePage, setMovePage] = useState(1);
  const [alerts, setAlerts] = useState<ErpStockAlert[]>([]);
  const [requests, setRequests] = useState<ErpStockRequest[]>([]);
  const [requestTotal, setRequestTotal] = useState(0);
  const [requestPage, setRequestPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [moveOpen, setMoveOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm] = Form.useForm();

  const loadBase = useCallback(async () => {
    try {
      const [warehouseRows, variantRows] = await Promise.all([
        erpApi.warehouses(),
        erpApi.variants({ query: {} }),
      ]);
      setWarehouses(warehouseRows || []);
      setVariants(variantRows || []);
    } catch (err) {
      setError(erpError(err));
    }
  }, []);

  const loadStock = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.stock({
        query: { page, pageSize: 20, warehouseId: warehouseId || undefined, lowOnly: lowOnly || undefined },
      });
      setStock(data?.list || []);
      setStockTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [page, warehouseId, lowOnly]);

  const loadMoves = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.moves({ query: { page: movePage, pageSize: 20, warehouseId: warehouseId || undefined } });
      setMoves(data?.list || []);
      setMoveTotal(data?.total || 0);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [movePage, warehouseId]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts((await erpApi.stockAlerts()) || []);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.stockRequests({ query: { page: requestPage, pageSize: 20 } });
      setRequests(data?.list || []);
      setRequestTotal(data?.total || 0);
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [requestPage]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (mode === "stock") void loadStock();
    if (mode === "moves") void loadMoves();
    if (mode === "alerts") void loadAlerts();
    if (mode === "requests") void loadRequests();
  }, [mode, loadStock, loadMoves, loadAlerts, loadRequests]);

  const saveMove = async (values: Record<string, unknown>) => {
    await erpApi.saveMove({
      body: {
        type: (values.type || "IN") as "IN",
        warehouseId: Number(values.warehouseId),
        toWarehouseId: Number(values.toWarehouseId || 0),
        variantId: Number(values.variantId),
        quantity: Number(values.quantity || 0),
        unitCost: Number(values.unitCost || 0),
        note: String(values.note || ""),
      },
    });
    message.success("库存已更新");
    await loadStock();
    await loadAlerts();
  };

  const submitRequest = async () => {
    try {
      const values = await requestForm.validateFields();
      const items = (values.items || []).map((item: { variantId: number; quantity: number }) => ({
        variantId: Number(item.variantId),
        quantity: Number(item.quantity),
      }));
      await erpApi.saveStockRequest({
        body: {
          warehouseId: Number(values.warehouseId),
          projectId: 0,
          items,
          note: values.note || "",
        },
      });
      message.success("领用申请已提交");
      setRequestOpen(false);
      requestForm.resetFields();
      await loadRequests();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(erpError(err));
    }
  };

  const decideRequest = async (row: ErpStockRequest, decision: "approve" | "reject" | "issue") => {
    try {
      await erpApi.decideStockRequest({ body: { id: row.id, decision, note: "" } });
      await loadRequests();
      if (decision === "issue") await loadStock();
    } catch (err) {
      message.error(erpError(err));
    }
  };

  const stockColumns: ColumnsType<ErpStock> = [
    { title: "仓库", dataIndex: "warehouseName", width: 130 },
    { title: "SKU", dataIndex: "sku", width: 130 },
    { title: "商品", dataIndex: "productName" },
    { title: "在库", dataIndex: "onHand", width: 90 },
    { title: "在途", dataIndex: "inTransit", width: 90 },
    { title: "锁定", dataIndex: "locked", width: 90 },
    { title: "补货点", dataIndex: "reorderPoint", width: 90 },
    {
      title: "状态",
      key: "state",
      width: 100,
      render: (_: unknown, row) => {
        const low = Number(row.onHand) <= Number(row.reorderPoint);
        return <Tag color={low ? "red" : "green"}>{low ? "低库存" : "正常"}</Tag>;
      },
    },
    { title: "更新", dataIndex: "updatedAt", width: 170, render: (v: string) => v || "—" },
  ];

  const moveColumns: ColumnsType<ErpStockMove> = [
    { title: "单号", dataIndex: "moveNo", width: 160 },
    { title: "类型", dataIndex: "type", width: 90, render: (v: string) => MOVE_TYPES.find((item) => item.value === v)?.label || v },
    { title: "仓库", dataIndex: "warehouseName", width: 120 },
    { title: "目标仓", dataIndex: "toWarehouseId", width: 90, render: (v: number) => (v ? `#${v}` : "—") },
    { title: "SKU", dataIndex: "sku", width: 130 },
    { title: "商品", dataIndex: "productName" },
    { title: "数量", dataIndex: "quantity", width: 90 },
    { title: "成本", dataIndex: "unitCost", width: 100, render: (v: string) => money(v) },
    { title: "时间", dataIndex: "createdAt", width: 170 },
  ];

  const alertColumns: ColumnsType<ErpStockAlert> = [
    { title: "仓库", dataIndex: "warehouseName", width: 130 },
    { title: "SKU", dataIndex: "sku", width: 130 },
    { title: "商品", dataIndex: "productName" },
    { title: "在库", dataIndex: "onHand", width: 90 },
    { title: "补货点", dataIndex: "reorderPoint", width: 90 },
    { title: "缺口", dataIndex: "gap", width: 90 },
  ];

  const requestColumns: ColumnsType<ErpStockRequest> = [
    { title: "单号", dataIndex: "requestNo", width: 160 },
    { title: "仓库", dataIndex: "warehouseName", width: 130 },
    { title: "明细", dataIndex: "items", render: (v: { sku: string; quantity: number }[]) => v.map((item) => `${item.sku}×${item.quantity}`).join("；") },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => (
        <Tag color={v === "PENDING" ? "gold" : v === "APPROVED" ? "processing" : v === "ISSUED" ? "green" : "red"}>
          {({ PENDING: "待审批", APPROVED: "已批准", REJECTED: "已驳回", ISSUED: "已出库" } as Record<string, string>)[v] || v}
        </Tag>
      ),
    },
    { title: "时间", dataIndex: "createdAt", width: 170, render: (v: string) => day(v) },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_: unknown, row) =>
        row.status === "PENDING" ? (
          <>
            <Button type="link" size="small" onClick={() => void decideRequest(row, "approve")}>通过</Button>
            <Button type="link" size="small" danger onClick={() => void decideRequest(row, "reject")}>驳回</Button>
          </>
        ) : row.status === "APPROVED" ? (
          <Button type="link" size="small" onClick={() => void decideRequest(row, "issue")}>出库</Button>
        ) : null,
    },
  ];

  return (
    <Panel
      title="库存"
      extra={
        <>
          <TabStrip
            items={[
              { key: "stock", label: "库存" },
              { key: "moves", label: "流水" },
              { key: "alerts", label: "预警", count: alerts.length || undefined },
              { key: "requests", label: "领用" },
            ]}
            value={mode}
            onChange={(key) => setMode(key as Mode)}
          />
          <Button type="primary" onClick={() => (mode === "requests" ? setRequestOpen(true) : setMoveOpen(true))}>
            {mode === "requests" ? "领用申请" : "库存变动"}
          </Button>
        </>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Toolbar>
        <Select
          allowClear
          placeholder="全部仓库"
          style={{ width: 200 }}
          value={warehouseId || undefined}
          onChange={(value) => setWarehouseId(Number(value || 0))}
          options={warehouses.map((row) => ({ value: row.id, label: row.name }))}
        />
        {mode === "stock" ? (
          <PillTabs
            items={[
              { key: "all", label: "全部库存" },
              { key: "low", label: "仅低库存" },
            ]}
            value={lowOnly ? "low" : "all"}
            onChange={(key) => setLowOnly(key === "low")}
            size="small"
            variant="soft"
          />
        ) : null}
      </Toolbar>

      {mode === "stock" ? (
        <Table<ErpStock>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={stockColumns}
          dataSource={stock}
          scroll={{ x: "max-content" }}
          pagination={{ current: page, pageSize: 20, total: stockTotal, showSizeChanger: false, onChange: setPage }}
          locale={{ emptyText: "暂无库存" }}
        />
      ) : null}
      {mode === "moves" ? (
        <Table<ErpStockMove>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={moveColumns}
          dataSource={moves}
          scroll={{ x: "max-content" }}
          pagination={{ current: movePage, pageSize: 20, total: moveTotal, showSizeChanger: false, onChange: setMovePage }}
          locale={{ emptyText: "暂无库存流水" }}
        />
      ) : null}
      {mode === "alerts" ? (
        <>
          <div className="muted text-12" style={{ marginBottom: 8 }}>
            经营异常扫描发现低于补货点的 SKU 时，会自动生成一张待审批的补货采购单（采购单页可查「补货」来源），并派给采购岗位跟进。
          </div>
          <Table<ErpStockAlert>
            rowKey={(row) => `${row.warehouseId}-${row.variantId}`}
            size="middle"
            loading={loading}
            columns={alertColumns}
            dataSource={alerts}
            pagination={false}
            locale={{ emptyText: "暂无低库存预警" }}
          />
        </>
      ) : null}
      {mode === "requests" ? (
        <Table<ErpStockRequest>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={requestColumns}
          dataSource={requests}
          scroll={{ x: "max-content" }}
          pagination={{ current: requestPage, pageSize: 20, total: requestTotal, showSizeChanger: false, onChange: setRequestPage }}
          locale={{ emptyText: "暂无领用申请" }}
        />
      ) : null}

      <ErpEntityModal
        open={moveOpen}
        title="库存变动"
        onClose={() => setMoveOpen(false)}
        initial={{ type: "IN", warehouseId: warehouseId || warehouses[0]?.id }}
        onSubmit={saveMove}
        fields={[
          { name: "type", label: "变动类型", kind: "select", required: true, options: MOVE_TYPES },
          { name: "warehouseId", label: "仓库", kind: "select", required: true, options: warehouses.map((row) => ({ value: row.id, label: row.name })) },
          { name: "toWarehouseId", label: "目标仓库（调拨用）", kind: "select", options: warehouses.map((row) => ({ value: row.id, label: row.name })) },
          { name: "variantId", label: "变体", kind: "select", required: true, options: variantOptions(variants) },
          { name: "quantity", label: "数量", kind: "number", required: true, min: 0 },
          { name: "unitCost", label: "单位成本", kind: "money" },
          { name: "note", label: "备注", kind: "textarea", span: 24 },
        ]}
      />

      <Modal
        open={requestOpen}
        title="领用申请"
        onCancel={() => setRequestOpen(false)}
        onOk={() => void submitRequest()}
        width={640}
        destroyOnHidden
      >
        <Form form={requestForm} layout="vertical">
          <Form.Item name="warehouseId" label="出库仓库" rules={[{ required: true, message: "请选择仓库" }]}>
            <Select options={warehouses.map((row) => ({ value: row.id, label: row.name }))} />
          </Form.Item>
          <Form.List name="items" initialValue={[{ quantity: 1 }]}>
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
