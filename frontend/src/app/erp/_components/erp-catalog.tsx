"use client";

import { Button, Input, Select, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { erpApi } from "@/api/erp";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import {
  ErpEntityModal,
  Toolbar,
  erpError,
  money,
  productOptions,
  type ErpCategory,
  type ErpProduct,
  type ErpVariant,
  type ErpWarehouse,
} from "./erp-common";

type Mode = "products" | "variants" | "categories" | "warehouses";

export function ErpCatalogTab() {
  const [mode, setMode] = useState<Mode>("products");
  const [categories, setCategories] = useState<ErpCategory[]>([]);
  const [products, setProducts] = useState<ErpProduct[]>([]);
  const [variants, setVariants] = useState<ErpVariant[]>([]);
  const [warehouses, setWarehouses] = useState<ErpWarehouse[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [productFilter, setProductFilter] = useState(0);

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [modal, setModal] = useState<"" | "product" | "variant" | "category" | "warehouse">("");

  const loadBase = useCallback(async () => {
    try {
      const [categoryRows, warehouseRows] = await Promise.all([
        erpApi.categories(),
        erpApi.warehouses(),
      ]);
      setCategories(categoryRows || []);
      setWarehouses(warehouseRows || []);
    } catch (err) {
      setError(erpError(err));
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await erpApi.products({ query: { page, pageSize: 20, q: q || undefined } });
      setProducts(data?.list || []);
      setProductTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  const loadVariants = useCallback(async () => {
    setLoading(true);
    try {
      setVariants(
        (await erpApi.variants({ query: { productId: productFilter || undefined } })) || [],
      );
      setError("");
    } catch (err) {
      setError(erpError(err));
    } finally {
      setLoading(false);
    }
  }, [productFilter]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (mode === "products" || mode === "variants" || mode === "categories" || mode === "warehouses") {
      void loadProducts();
    }
    if (mode === "variants") void loadVariants();
  }, [mode, loadProducts, loadVariants]);

  const saveProduct = async (values: Record<string, unknown>) => {
    await erpApi.saveProduct({
      body: {
        id: editing?.id ? Number(editing.id) : undefined,
        code: String(values.code || ""),
        name: String(values.name),
        categoryId: Number(values.categoryId || 0),
        unit: String(values.unit || "件"),
        spec: String(values.spec || ""),
        barcode: String(values.barcode || ""),
        purchasePrice: Number(values.purchasePrice || 0),
        salePrice: Number(values.salePrice || 0),
        taxRate: Number(values.taxRate || 0),
        status: (values.status || "ACTIVE") as "ACTIVE",
        note: String(values.note || ""),
      },
    });
    message.success("已保存");
    await loadProducts();
  };

  const saveVariant = async (values: Record<string, unknown>) => {
    const attributes: Record<string, string> = {};
    String(values.attributesText || "")
      .split(/[,，;；]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        const [key, ...rest] = item.split(/[:：=]/);
        if (key && rest.length) attributes[key.trim()] = rest.join(":").trim();
      });
    await erpApi.saveVariant({
      body: {
        id: editing?.id ? Number(editing.id) : undefined,
        productId: Number(values.productId),
        sku: String(values.sku),
        name: String(values.name || ""),
        attributes,
        purchasePrice: Number(values.purchasePrice || 0),
        salePrice: Number(values.salePrice || 0),
        status: (values.status || "ACTIVE") as "ACTIVE",
      },
    });
    message.success("已保存");
    await loadVariants();
  };

  const saveCategory = async (values: Record<string, unknown>) => {
    await erpApi.saveCategory({
      body: {
        id: editing?.id ? Number(editing.id) : undefined,
        code: String(values.code),
        name: String(values.name),
        parentId: Number(values.parentId || 0),
        sortOrder: Number(values.sortOrder || 0),
      },
    });
    message.success("已保存");
    await loadBase();
  };

  const saveWarehouse = async (values: Record<string, unknown>) => {
    await erpApi.saveWarehouse({
      body: {
        id: editing?.id ? Number(editing.id) : undefined,
        code: String(values.code),
        name: String(values.name),
        address: String(values.address || ""),
        managerId: String(values.managerId || ""),
        status: (values.status || "ACTIVE") as "ACTIVE",
      },
    });
    message.success("已保存");
    await loadBase();
  };

  const productColumns: ColumnsType<ErpProduct> = [
    { title: "编码", dataIndex: "code", width: 130 },
    { title: "商品", dataIndex: "name" },
    { title: "分类", dataIndex: "categoryName", width: 120, render: (v: string) => v || "—" },
    { title: "单位", dataIndex: "unit", width: 70 },
    { title: "采购价", dataIndex: "purchasePrice", width: 110, render: (v: string) => money(v) },
    { title: "销售价", dataIndex: "salePrice", width: 110, render: (v: string) => money(v) },
    { title: "税率", dataIndex: "taxRate", width: 80, render: (v: string) => `${v}%` },
    { title: "变体", dataIndex: "variantCount", width: 70 },
    { title: "库存", dataIndex: "onHand", width: 90 },
    { title: "状态", dataIndex: "status", width: 80, render: (v: string) => <Tag color={v === "ACTIVE" ? "green" : "default"}>{v === "ACTIVE" ? "在售" : "停用"}</Tag> },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { setEditing({ ...row, purchasePrice: Number(row.purchasePrice), salePrice: Number(row.salePrice), taxRate: Number(row.taxRate) }); setModal("product"); }}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => void erpApi.removeProduct({ body: { id: row.id } }).then(() => loadProducts()).catch((err) => message.error(erpError(err)))}>
            删除
          </Button>
        </>
      ),
    },
  ];

  const variantColumns: ColumnsType<ErpVariant> = [
    { title: "SKU", dataIndex: "sku", width: 140 },
    { title: "商品", dataIndex: "productName" },
    { title: "变体名", dataIndex: "name", width: 120, render: (v: string) => v || "—" },
    { title: "属性", dataIndex: "attributes", render: (v: Record<string, string>) => Object.entries(v || {}).map(([k, val]) => `${k}:${val}`).join(" · ") || "—" },
    { title: "在库", dataIndex: "onHand", width: 80 },
    { title: "在途", dataIndex: "inTransit", width: 80 },
    { title: "锁定", dataIndex: "locked", width: 80 },
    { title: "采购价", dataIndex: "purchasePrice", width: 100, render: (v: string) => money(v) },
    { title: "销售价", dataIndex: "salePrice", width: 100, render: (v: string) => money(v) },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { setEditing({ ...row, attributesText: Object.entries(row.attributes || {}).map(([k, v]) => `${k}:${v}`).join(","), purchasePrice: Number(row.purchasePrice), salePrice: Number(row.salePrice) }); setModal("variant"); }}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => void erpApi.removeVariant({ body: { id: row.id } }).then(() => loadVariants()).catch((err) => message.error(erpError(err)))}>
            删除
          </Button>
        </>
      ),
    },
  ];

  const categoryColumns: ColumnsType<ErpCategory> = [
    { title: "编码", dataIndex: "code", width: 140 },
    { title: "名称", dataIndex: "name" },
    { title: "上级", dataIndex: "parentId", width: 90, render: (v: number) => (v ? `#${v}` : "—") },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { setEditing(row); setModal("category"); }}>编辑</Button>
          <Button type="link" size="small" danger onClick={() => void erpApi.removeCategory({ body: { id: row.id } }).then(() => loadBase()).catch((err) => message.error(erpError(err)))}>删除</Button>
        </>
      ),
    },
  ];

  const warehouseColumns: ColumnsType<ErpWarehouse> = [
    { title: "编码", dataIndex: "code", width: 140 },
    { title: "仓库", dataIndex: "name" },
    { title: "地址", dataIndex: "address", render: (v: string) => v || "—" },
    { title: "管理员", dataIndex: "managerId", width: 120, render: (v: string) => v || "—" },
    { title: "品类数", dataIndex: "stockKinds", width: 90 },
    { title: "总数量", dataIndex: "totalQty", width: 100 },
    { title: "状态", dataIndex: "status", width: 80, render: (v: string) => <Tag color={v === "ACTIVE" ? "green" : "default"}>{v === "ACTIVE" ? "启用" : "停用"}</Tag> },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { setEditing(row); setModal("warehouse"); }}>编辑</Button>
          <Button type="link" size="small" danger onClick={() => void erpApi.removeWarehouse({ body: { id: row.id } }).then(() => loadBase()).catch((err) => message.error(erpError(err)))}>删除</Button>
        </>
      ),
    },
  ];

  return (
    <Panel
      title="商品与主数据"
      extra={
        <>
          <TabStrip
            items={[
              { key: "products", label: "商品" },
              { key: "variants", label: "变体" },
              { key: "categories", label: "分类" },
              { key: "warehouses", label: "仓库" },
            ]}
            value={mode}
            onChange={(key) => setMode(key as Mode)}
          />
          <Button
            type="primary"
            onClick={() => {
              setEditing(null);
              setModal(mode === "products" ? "product" : mode === "variants" ? "variant" : mode === "categories" ? "category" : "warehouse");
            }}
          >
            {mode === "products" ? "新建商品" : mode === "variants" ? "新建变体" : mode === "categories" ? "新建分类" : "新建仓库"}
          </Button>
        </>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {mode === "products" ? (
        <>
          <Toolbar hint={`共 ${productTotal} 个商品`}>
            <Input.Search
              allowClear
              placeholder="搜索商品名称 / 编码"
              style={{ width: 240 }}
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
            />
          </Toolbar>
          <Table<ErpProduct>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={productColumns}
            dataSource={products}
            scroll={{ x: "max-content" }}
            pagination={{ current: page, pageSize: 20, total: productTotal, showSizeChanger: false, onChange: setPage }}
            locale={{ emptyText: "暂无商品" }}
          />
        </>
      ) : null}
      {mode === "variants" ? (
        <>
          <Toolbar>
            <Select
              allowClear
              placeholder="全部商品"
              style={{ width: 240 }}
              value={productFilter || undefined}
              onChange={(value) => setProductFilter(Number(value || 0))}
              options={productOptions(products)}
            />
          </Toolbar>
          <Table<ErpVariant>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={variantColumns}
            dataSource={variants}
            scroll={{ x: "max-content" }}
            pagination={false}
            locale={{ emptyText: "暂无变体" }}
          />
        </>
      ) : null}
      {mode === "categories" ? (
        <Table<ErpCategory>
          rowKey="id"
          size="middle"
          columns={categoryColumns}
          dataSource={categories}
          pagination={false}
          locale={{ emptyText: "暂无分类" }}
        />
      ) : null}
      {mode === "warehouses" ? (
        <Table<ErpWarehouse>
          rowKey="id"
          size="middle"
          columns={warehouseColumns}
          dataSource={warehouses}
          pagination={false}
          locale={{ emptyText: "暂无仓库" }}
        />
      ) : null}

      <ErpEntityModal
        open={modal === "product"}
        title={editing?.id ? "编辑商品" : "新建商品"}
        onClose={() => setModal("")}
        initial={editing || { status: "ACTIVE", unit: "件", taxRate: 0 }}
        onSubmit={saveProduct}
        fields={[
          { name: "name", label: "商品名称", required: true },
          { name: "code", label: "商品编码" },
          { name: "categoryId", label: "分类", kind: "select", options: categories.map((row) => ({ value: row.id, label: row.name })) },
          { name: "unit", label: "单位" },
          { name: "spec", label: "规格" },
          { name: "barcode", label: "条码" },
          { name: "purchasePrice", label: "采购价", kind: "money" },
          { name: "salePrice", label: "销售价", kind: "money" },
          { name: "taxRate", label: "税率（%）", kind: "number", min: 0, max: 100 },
          { name: "status", label: "状态", kind: "select", options: [{ value: "ACTIVE", label: "在售" }, { value: "INACTIVE", label: "停用" }] },
          { name: "note", label: "备注", kind: "textarea", span: 24 },
        ]}
      />

      <ErpEntityModal
        open={modal === "variant"}
        title={editing?.id ? "编辑变体" : "新建变体"}
        onClose={() => setModal("")}
        initial={editing || { status: "ACTIVE", productId: productFilter || products[0]?.id }}
        onSubmit={saveVariant}
        fields={[
          { name: "productId", label: "所属商品", kind: "select", required: true, options: productOptions(products) },
          { name: "sku", label: "SKU", required: true },
          { name: "name", label: "变体名称" },
          { name: "attributesText", label: "属性（键:值，逗号分隔）", placeholder: "颜色:红,尺寸:L" },
          { name: "purchasePrice", label: "采购价", kind: "money" },
          { name: "salePrice", label: "销售价", kind: "money" },
          { name: "status", label: "状态", kind: "select", options: [{ value: "ACTIVE", label: "在售" }, { value: "INACTIVE", label: "停用" }] },
        ]}
      />

      <ErpEntityModal
        open={modal === "category"}
        title={editing?.id ? "编辑分类" : "新建分类"}
        onClose={() => setModal("")}
        initial={editing || {}}
        onSubmit={saveCategory}
        fields={[
          { name: "code", label: "分类编码", required: true },
          { name: "name", label: "分类名称", required: true },
          { name: "parentId", label: "上级分类 ID", kind: "number", min: 0 },
          { name: "sortOrder", label: "排序", kind: "number" },
        ]}
      />

      <ErpEntityModal
        open={modal === "warehouse"}
        title={editing?.id ? "编辑仓库" : "新建仓库"}
        onClose={() => setModal("")}
        initial={editing || { status: "ACTIVE" }}
        onSubmit={saveWarehouse}
        fields={[
          { name: "code", label: "仓库编码", required: true },
          { name: "name", label: "仓库名称", required: true },
          { name: "address", label: "地址" },
          { name: "managerId", label: "管理员账号" },
          { name: "status", label: "状态", kind: "select", options: [{ value: "ACTIVE", label: "启用" }, { value: "INACTIVE", label: "停用" }] },
        ]}
      />
    </Panel>
  );
}
