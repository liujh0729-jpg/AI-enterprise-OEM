"use client";

import { Button, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { erpApi } from "@/api/erp";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import {
  ErpEntityModal,
  erpError,
  type ErpPricePolicy,
  type ErpTaxRate,
} from "./erp-common";

type Mode = "tax" | "price";

export function ErpSettingsTab() {
  const [mode, setMode] = useState<Mode>("tax");
  const [taxRates, setTaxRates] = useState<ErpTaxRate[]>([]);
  const [policies, setPolicies] = useState<ErpPricePolicy[]>([]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [modal, setModal] = useState<"" | "tax" | "price">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [taxRows, policyRows] = await Promise.all([
        erpApi.taxRates(),
        erpApi.pricePolicies(),
      ]);
      setTaxRates(taxRows || []);
      setPolicies(policyRows || []);
      setError("");
    } catch (err) {
      setError(erpError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveTax = async (values: Record<string, unknown>) => {
    await erpApi.saveTaxRate({
      body: {
        id: editing?.id ? Number(editing.id) : undefined,
        name: String(values.name),
        rate: Number(values.rate || 0),
        kind: (values.kind || "BOTH") as "BOTH",
        note: String(values.note || ""),
      },
    });
    message.success("已保存");
    await load();
  };

  const savePolicy = async (values: Record<string, unknown>) => {
    await erpApi.savePricePolicy({
      body: {
        id: editing?.id ? Number(editing.id) : undefined,
        name: String(values.name),
        scope: (values.scope || "ALL") as "ALL",
        scopeId: Number(values.scopeId || 0),
        discountPct: Number(values.discountPct || 0),
        minQty: Number(values.minQty || 0),
        status: (values.status || "ACTIVE") as "ACTIVE",
      },
    });
    message.success("已保存");
    await load();
  };

  const taxColumns: ColumnsType<ErpTaxRate> = [
    { title: "税率名称", dataIndex: "name" },
    { title: "税率", dataIndex: "rate", width: 100, render: (v: string) => `${v}%` },
    { title: "适用", dataIndex: "kind", width: 100, render: (v: string) => ({ SALES: "销售", PURCHASE: "采购", BOTH: "通用" } as Record<string, string>)[v] || v },
    { title: "备注", dataIndex: "note", render: (v: string) => v || "—" },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { setEditing({ ...row, rate: Number(row.rate) }); setModal("tax"); }}>编辑</Button>
          <Button type="link" size="small" danger onClick={() => void erpApi.removeTaxRate({ body: { id: row.id } }).then(load).catch((err) => message.error(erpError(err)))}>删除</Button>
        </>
      ),
    },
  ];

  const policyColumns: ColumnsType<ErpPricePolicy> = [
    { title: "策略名称", dataIndex: "name" },
    { title: "范围", dataIndex: "scope", width: 100, render: (v: string) => ({ ALL: "全部", CATEGORY: "分类", PRODUCT: "商品" } as Record<string, string>)[v] || v },
    { title: "范围 ID", dataIndex: "scopeId", width: 90, render: (v: number) => (v ? `#${v}` : "—") },
    { title: "折扣", dataIndex: "discountPct", width: 90, render: (v: string) => `${v}%` },
    { title: "起订量", dataIndex: "minQty", width: 90 },
    { title: "状态", dataIndex: "status", width: 80, render: (v: string) => <Tag color={v === "ACTIVE" ? "green" : "default"}>{v === "ACTIVE" ? "启用" : "停用"}</Tag> },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { setEditing({ ...row, discountPct: Number(row.discountPct) }); setModal("price"); }}>编辑</Button>
          <Button type="link" size="small" danger onClick={() => void erpApi.removePricePolicy({ body: { id: row.id } }).then(load).catch((err) => message.error(erpError(err)))}>删除</Button>
        </>
      ),
    },
  ];

  return (
    <Panel
      title="税务与价格"
      extra={
        <>
          <TabStrip
            items={[
              { key: "tax", label: "税率" },
              { key: "price", label: "价格策略" },
            ]}
            value={mode}
            onChange={(key) => setMode(key as Mode)}
          />
          <Button type="primary" onClick={() => { setEditing(null); setModal(mode === "tax" ? "tax" : "price"); }}>
            {mode === "tax" ? "新建税率" : "新建策略"}
          </Button>
        </>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {mode === "tax" ? (
        <Table<ErpTaxRate>
          rowKey="id"
          size="middle"
          columns={taxColumns}
          dataSource={taxRates}
          pagination={false}
          locale={{ emptyText: "暂无税率" }}
        />
      ) : (
        <Table<ErpPricePolicy>
          rowKey="id"
          size="middle"
          columns={policyColumns}
          dataSource={policies}
          pagination={false}
          locale={{ emptyText: "暂无价格策略" }}
        />
      )}

      <ErpEntityModal
        open={modal === "tax"}
        title={editing?.id ? "编辑税率" : "新建税率"}
        onClose={() => setModal("")}
        initial={editing || { kind: "BOTH" }}
        onSubmit={saveTax}
        fields={[
          { name: "name", label: "税率名称", required: true },
          { name: "rate", label: "税率（%）", kind: "number", required: true, min: 0, max: 100 },
          { name: "kind", label: "适用", kind: "select", options: [{ value: "SALES", label: "销售" }, { value: "PURCHASE", label: "采购" }, { value: "BOTH", label: "通用" }] },
          { name: "note", label: "备注", kind: "textarea", span: 24 },
        ]}
      />

      <ErpEntityModal
        open={modal === "price"}
        title={editing?.id ? "编辑价格策略" : "新建价格策略"}
        onClose={() => setModal("")}
        initial={editing || { scope: "ALL", status: "ACTIVE" }}
        onSubmit={savePolicy}
        fields={[
          { name: "name", label: "策略名称", required: true },
          { name: "scope", label: "范围", kind: "select", options: [{ value: "ALL", label: "全部" }, { value: "CATEGORY", label: "分类" }, { value: "PRODUCT", label: "商品" }] },
          { name: "scopeId", label: "范围 ID（分类/商品）", kind: "number", min: 0 },
          { name: "discountPct", label: "折扣（%）", kind: "number", required: true, min: 0, max: 100 },
          { name: "minQty", label: "起订量", kind: "number", min: 0 },
          { name: "status", label: "状态", kind: "select", options: [{ value: "ACTIVE", label: "启用" }, { value: "INACTIVE", label: "停用" }] },
        ]}
      />
    </Panel>
  );
}
