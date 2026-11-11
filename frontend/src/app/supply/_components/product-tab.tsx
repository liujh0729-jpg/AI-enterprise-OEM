"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { supplyApi } from "@/api/supply";

import { InboxOutlined, ShopOutlined, ToolOutlined } from "@ant-design/icons";
import Link from "next/link";
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";

import type { SupplyIdentity } from "../page";
import {
  attrText,
  money,
  providerLabel,
  type SupplyContract,
  type SupplyProduct,
  type SupplySku,
  type SupplyStation,
} from "./common";

type AttrRow = { name: string; value: string };

const LISTING_OPTIONS = [
  { value: "ONLINE", label: "在售（上架）" },
  { value: "OFFLINE", label: "已下架" },
];

/**
 * 商品管理页签（本地 SPU/SKU 交易数据 + AIworkin GEO 独立站营销字段）：
 * - 服务商账号：新增/修改/删除商品、维护规格、按站点独立上下架；
 * - 用户：只读浏览已签约服务商的在售商品（下单在「商品订货」页签）。
 */
export function ProductTab({
  rows,
  stations,
  contracts,
  loading,
  identity,
  panelTitle,
  switcher,
}: {
  rows: SupplyProduct[];
  stations: SupplyStation[];
  contracts: SupplyContract[];
  loading: boolean;
  reload: () => Promise<void> | void;
  identity: SupplyIdentity;
  /** 企业侧合并栏目后换个看得懂的小标题（服务商侧沿用商品管理口径）。 */
  panelTitle?: string;
  /** 企业侧「商品供应」栏目内的子视图切换器（可订商品 / 我的订货单）。 */
  switcher?: ReactNode;
}) {
  const supply_createProductMutation = useOperationMutation(
    supplyApi.createProduct,
    ["supply", "dashboard"],
  );
  const supply_updateProductMutation = useOperationMutation(
    supplyApi.updateProduct,
    ["supply", "dashboard"],
  );
  const supply_removeProductMutation = useOperationMutation(
    supplyApi.removeProduct,
    ["supply", "dashboard"],
  );
  const supply_removeSkuMutation = useOperationMutation(supplyApi.removeSku, [
    "supply",
    "dashboard",
  ]);
  const supply_setProductStationsMutation = useOperationMutation(
    supplyApi.setProductStations,
    ["supply", "dashboard"],
  );
  const supply_setProductStationStatusMutation = useOperationMutation(
    supplyApi.setProductStationStatus,
    ["supply", "dashboard"],
  );

  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const canManage = identity.isProvider || identity.isAdmin;
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplyProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<SupplyProduct | null>(null);
  const [skuTarget, setSkuTarget] = useState<SupplyProduct | null>(null);
  const [skuForm] = Form.useForm();
  const [skuEditing, setSkuEditing] = useState<SupplySku | null>(null);
  const [skuOpen, setSkuOpen] = useState(false);
  const [stationTarget, setStationTarget] = useState<SupplyProduct | null>(
    null,
  );
  const [pickedStationIds, setPickedStationIds] = useState<number[]>([]);

  const myStations = identity.isAdmin
    ? stations
    : stations.filter((item) => item.providerUserId === identity.meUserId);

  const providerText = (userId: string) =>
    providerLabel(contracts, userId, identity.meUserId, identity.selfName);

  const stationName = (id: number) =>
    stations.find((item) => item.id === id)?.name || `站点 #${id}`;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      unit: "件",
      status: "ONLINE",
      featured: false,
      station_ids: myStations.slice(0, 1).map((item) => item.id),
      attrs: [{ name: "", value: "" }],
    });
    setOpen(true);
  };

  const openEdit = (row: SupplyProduct) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      category: row.category,
      unit: row.unit || "件",
      status: row.status || "ONLINE",
      station_ids: (row.stations || []).map((link) => link.stationId),
      attrs: (row.attrs || []).length ? row.attrs : [{ name: "", value: "" }],
      marketing_title: row.marketingTitle,
      marketing_summary: row.marketingSummary,
      marketing_content: row.marketingContent,
      cover_url: row.coverUrl,
      featured: Boolean(row.featured),
    });
    setOpen(true);
  };

  const buildBody = (values: Record<string, unknown>) => ({
    name: String(values.name || "").trim(),
    category: values.category || "",
    unit: values.unit || "件",
    status: values.status || "ONLINE",
    station_ids: (values.station_ids as number[]) || [],
    attrs: ((values.attrs as AttrRow[]) || []).filter(
      (item) => item?.name && String(item.name).trim(),
    ),
    marketing_title: values.marketing_title || "",
    marketing_summary: values.marketing_summary || "",
    marketing_content: values.marketing_content || "",
    cover_url: values.cover_url || "",
    featured: Boolean(values.featured),
  });

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const body = buildBody(values);
      if (!editing) {
        setBusy(true);
        try {
          await supply_createProductMutation.mutateAsync({ body: body });

          message.success("商品已创建");
          setOpen(false);
        } finally {
          setBusy(false);
        }
        return;
      }
      const target = editing;
      requestPassword({
        title: "修改商品（需密码）",
        content: `确认修改「${target.name}」？交易数据（价格/上下架/站点归属）变更会同步独立站展示状态。`,
        okText: "保存修改",
        onOk: async () => {
          await supply_updateProductMutation.mutateAsync({
            params: { id: String(target.id) },
            body: body,
          });

          message.success("商品已更新");
          setOpen(false);
        },
      });
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const removeProduct = (row: SupplyProduct) => {
    requestPassword({
      title: "删除商品",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.name}」？已有订货明细的商品不可删除，可改为「下架」。`,
      onOk: async () => {
        await supply_removeProductMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("商品已删除");
        setDetail(null);
      },
    });
  };

  const openSku = (row: SupplyProduct) => {
    setSkuTarget(row);
    setSkuEditing(null);
    skuForm.resetFields();
    setSkuOpen(false);
  };

  const openSkuForm = (row: SupplyProduct, sku: SupplySku | null) => {
    setSkuTarget(row);
    setSkuEditing(sku);
    skuForm.setFieldsValue({
      spec_name: sku?.specName || "",
      supply_price: Number(sku?.supplyPrice ?? 0),
      unit: sku?.unit || row.unit || "件",
      scene: sku?.scene || "",
    });
    setSkuOpen(true);
  };

  const createSkuMutation = useOperationMutation(supplyApi.addSku, ["supply"]);
  const updateSkuMutation = useOperationMutation(supplyApi.updateSku, [
    "supply",
  ]);
  const submitSku = async () => {
    if (!skuTarget) return;
    const values = await skuForm.validateFields();
    const body = {
      spec_name: String(values.spec_name || "").trim(),
      supply_price: Number(values.supply_price || 0),
      unit: values.unit || "件",
      scene: values.scene || "",
    };
    const run = async () => {
      if (skuEditing)
        await updateSkuMutation.mutateAsync({
          params: { id: String(skuEditing.id) },
          body,
        });
      else
        await createSkuMutation.mutateAsync({
          params: { id: String(skuTarget.id) },
          body,
        });
      message.success(skuEditing ? "规格已更新" : "规格已添加");
      setSkuOpen(false);
      setSkuEditing(null);
    };
    if (skuEditing) {
      requestPassword({
        title: "修改商品规格（需密码）",
        okText: "保存修改",
        onOk: run,
      });
      return;
    }
    try {
      await run();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  const removeSku = (sku: SupplySku) => {
    requestPassword({
      title: "删除商品规格",
      danger: true,
      okText: "确认删除",
      content: `确认删除规格「${sku.specName}」？已有订货明细的规格不可删除。`,
      onOk: async () => {
        await supply_removeSkuMutation.mutateAsync({
          params: { id: String(sku.id) },
        });

        message.success("规格已删除");
      },
    });
  };

  const openStations = (row: SupplyProduct) => {
    setStationTarget(row);
    setPickedStationIds((row.stations || []).map((link) => link.stationId));
  };

  const saveStations = async () => {
    try {
      if (!stationTarget) return;
      await supply_setProductStationsMutation.mutateAsync({
        params: { id: String(stationTarget.id) },
        body: { station_ids: pickedStationIds },
      });

      message.success("商品归属站点已更新");
      setStationTarget(null);
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  /** 按站点独立上下架（交易数据变更，联动独立站展示状态）。 */
  const toggleStation = async (
    row: SupplyProduct,
    stationId: number,
    status: string,
  ) => {
    try {
      await supply_setProductStationStatusMutation.mutateAsync({
        params: { id: String(row.id), stationId: String(stationId) },
        body: { status },
      });

      message.success(status === "ONLINE" ? "该站点已上架" : "该站点已下架");
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const refreshSkuTarget = (): SupplySku[] => {
    const fresh = rows.find((item) => item.id === skuTarget?.id);
    return fresh?.skus || [];
  };

  return (
    <Panel
      title={
        panelTitle ||
        "商品管理（本地 SPU / SKU 交易数据 + AIworkin 独立站营销）"
      }
      titleBadge={`${rows.length} 个商品`}
      extra={
        canManage ? (
          <Button type="primary" onClick={openCreate}>
            ＋ 新增商品
          </Button>
        ) : null
      }
    >
      {switcher}
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        交易数据（名称/品类/规格与供货价/归属站点与上下架）由本平台自持，价格按规格设定；
        营销标题与正文仅用于 AIworkin GEO 独立站公开展示，不影响订单与报价核算。
        {identity.isEnterprise
          ? "企业只看到已签约「供销服务」的服务商在售商品。"
          : "一个商品可归属多个服务站，并按站点独立上下架。"}
      </div>
      <div className="table-wrap">
        <Table<SupplyProduct>
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          dataSource={rows}
          locale={{
            emptyText: (
              <EmptyState
                icon={<InboxOutlined aria-hidden />}
                text="暂无商品。服务商在「商品管理」新增商品并绑定服务站后，需求方即可下单。"
              />
            ),
          }}
          columns={[
            {
              title: "商品名称",
              dataIndex: "name",
              width: 200,
              render: (value: string) => (
                <span style={{ fontWeight: 600 }}>{value || "—"}</span>
              ),
            },
            {
              title: "所属服务商",
              dataIndex: "providerUserId",
              width: 160,
              render: (value: string) => providerText(value),
            },
            {
              title: "品类",
              dataIndex: "category",
              width: 110,
              render: (value: string) => value || "—",
            },
            {
              title: "规格 / 供货价",
              width: 300,
              render: (_, row) =>
                (row.skus || []).length ? (
                  <Space orientation="vertical" size={2}>
                    {(row.skus || []).map((sku) => (
                      <span key={sku.id} className="text-12">
                        {sku.specName}　¥{money(sku.supplyPrice)} /{" "}
                        {sku.unit || row.unit || "件"}
                        {sku.scene ? (
                          <span className="muted">（{sku.scene}）</span>
                        ) : null}
                      </span>
                    ))}
                  </Space>
                ) : (
                  <span className="text-12 muted">
                    未设规格价（价格按规格设定，点「规格」添加）
                  </span>
                ),
            },
            {
              title: "商品属性",
              dataIndex: "attrs",
              ellipsis: true,
              render: (value: AttrRow[]) => (
                <span className="text-12">{attrText(value)}</span>
              ),
            },
            {
              title: "归属服务站",
              width: 200,
              render: (_, row) =>
                (row.stations || []).length ? (
                  <Space size={4} wrap>
                    {(row.stations || []).map((link) => (
                      <Tag
                        key={link.id}
                        variant="filled"
                        color={link.status === "ONLINE" ? "green" : "default"}
                      >
                        {stationName(link.stationId)}
                        {link.status === "ONLINE" ? "" : "（已下架）"}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <span className="text-12 muted">未绑定站点</span>
                ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (value: string) => (
                <StatusBadge domain="supplyListing" status={value} />
              ),
            },
            {
              title: "首页推荐",
              width: 110,
              render: (_, row) =>
                row.featured ? (
                  <span className="badge badge-orange">首页推荐</span>
                ) : (
                  "—"
                ),
            },
            {
              title: "操作",
              width: 260,
              render: (_, row) => (
                <Space size={6} wrap>
                  <Button onClick={() => setDetail(row)}>详情</Button>
                  {canManage ? (
                    <Button onClick={() => openEdit(row)}>编辑</Button>
                  ) : null}
                  {canManage ? (
                    <Button onClick={() => openSku(row)}>规格</Button>
                  ) : null}
                  {canManage ? (
                    <Button onClick={() => openStations(row)}>站点</Button>
                  ) : null}
                  {canManage ? (
                    <Button danger onClick={() => removeProduct(row)}>
                      删除
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={open}
        title={editing ? `修改商品 · ${editing.name}` : "新增商品"}
        width={760}
        okText={editing ? "保存修改（需密码）" : "创建商品"}
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <Notice>
          交易数据本地自持；营销标题/摘要/正文用于 AIworkin GEO 独立站展示，
          一期本地留痕（未接通通道时不对外发布）。
          价格按规格设置：创建后点列表「规格」逐条添加规格与供货价，未设规格价不可下单。
        </Notice>
        <div className="form-2col">
          <Form.Item
            name="name"
            label="商品名称 *"
            rules={[{ required: true, message: "商品名称必填" }]}
          >
            <Input placeholder="如：有机复合肥（缓释型）" />
          </Form.Item>
          <Form.Item name="category" label="所属品类">
            <Input placeholder="如：农资 / 农机具 / 苗木" />
          </Form.Item>
          <Form.Item name="unit" label="计价单位">
            <Input placeholder="如：袋 / 台 / 株（规格未单独设单位时按此默认）" />
          </Form.Item>
        </div>
        <Form.Item
          name="station_ids"
          label="归属服务站 *（可多选，按站点独立上下架）"
          rules={[{ required: true, message: "请至少选择一个服务站" }]}
        >
          <Select
            mode="multiple"
            placeholder={
              myStations.length
                ? "选择所属服务站"
                : "请先在「服务站」页签创建站点"
            }
            options={myStations.map((item) => ({
              value: item.id,
              label: `${item.name}${item.region ? `（${item.region}）` : ""}`,
            }))}
          />
          {!myStations.length ? (
            <div className="text-12 muted" style={{ marginTop: 4 }}>
              <Link href="/supply?tab=stations">去创建服务站</Link>
            </div>
          ) : null}
        </Form.Item>
        <Form.List name="attrs">
          {(fields, { add, remove }) => (
            <Form.Item label="商品属性（可逐条添加）">
              {fields.map((field) => (
                <Space
                  key={field.key}
                  size={8}
                  style={{ display: "flex", marginBottom: 8 }}
                >
                  <Form.Item name={[field.name, "name"]} noStyle>
                    <Input
                      style={{ width: 180 }}
                      placeholder="属性名，如 净含量"
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, "value"]} noStyle>
                    <Input
                      style={{ width: 240 }}
                      placeholder="属性值，如 25kg/袋"
                    />
                  </Form.Item>
                  <Button type="text" danger onClick={() => remove(field.name)}>
                    删除
                  </Button>
                </Space>
              ))}
              <Button onClick={() => add({ name: "", value: "" })}>
                ＋ 添加属性
              </Button>
            </Form.Item>
          )}
        </Form.List>
        <div className="form-2col">
          <Form.Item name="status" label="商品状态">
            <Select options={LISTING_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="featured"
            label="独立站首页推荐"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </div>
        <Form.Item
          name="marketing_title"
          label="AIworkin 营销标题（独立站展示）"
        >
          <Input placeholder="如：缓释型有机复合肥 · 萧山站直发" />
        </Form.Item>
        <Form.Item name="marketing_summary" label="产品摘要">
          <Input placeholder="一句话卖点，用于独立站列表页" />
        </Form.Item>
        <Form.Item name="marketing_content" label="详细正文">
          <Input.TextArea
            rows={3}
            placeholder="适用作物、用法用量、服务承诺等公域展示内容"
          />
        </Form.Item>
        <Form.Item name="cover_url" label="封面展示图 URL">
          <Input placeholder="留空表示暂不上传封面" />
        </Form.Item>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={`商品详情 · ${detail?.name || ""}`}
        width={680}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
      >
        <div className="text-12 muted" style={{ lineHeight: 1.9 }}>
          <div>所属服务商：{providerText(detail?.providerUserId || "")}</div>
          <div>
            品类 / 单位：{detail?.category || "—"} · {detail?.unit || "—"}
          </div>
          <div>商品属性：{attrText(detail?.attrs)}</div>
          <div>
            归属服务站：
            {(detail?.stations || []).length
              ? (detail?.stations || [])
                  .map(
                    (link) =>
                      `${stationName(link.stationId)}（${link.status === "ONLINE" ? "在售" : "已下架"}）`,
                  )
                  .join("；")
              : "未绑定站点"}
          </div>
          <div>
            规格 / 供货价：
            {(detail?.skus || []).length
              ? (detail?.skus || [])
                  .map(
                    (sku) =>
                      `${sku.specName} ¥${money(sku.supplyPrice)}/${sku.unit}${sku.scene ? `（${sku.scene}）` : ""}`,
                  )
                  .join("；")
              : "未设规格价（价格按规格设定）"}
          </div>
          <div>营销标题：{detail?.marketingTitle || "—"}</div>
          <div>产品摘要：{detail?.marketingSummary || "—"}</div>
          <div>详细正文：{detail?.marketingContent || "—"}</div>
          <div>封面图：{detail?.coverUrl || "—"}</div>
          <div>独立站推荐：{detail?.featured ? "是" : "否"}</div>
        </div>
      </Modal>

      {/* 规格（SKU）维护 */}
      <Modal
        open={Boolean(skuTarget) && !skuOpen}
        title={`商品规格 · ${skuTarget?.name || ""}`}
        width={680}
        onCancel={() => setSkuTarget(null)}
        footer={
          <Space size={8}>
            <Button onClick={() => setSkuTarget(null)}>关闭</Button>
            <Button
              type="primary"
              onClick={() => skuTarget && openSkuForm(skuTarget, null)}
            >
              ＋ 添加规格
            </Button>
          </Space>
        }
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          单商品可多个规格，各规格独立设置供货价、单位与适配场景；订货时按规格成交。
        </div>
        <div className="table-wrap">
          <Table<SupplySku>
            rowKey="id"
            pagination={false}
            size="small"
            dataSource={refreshSkuTarget()}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<ToolOutlined aria-hidden />}
                  text="暂无规格：商品价格按规格设定，未设规格价不可下单"
                />
              ),
            }}
            columns={[
              { title: "规格参数", dataIndex: "specName", width: 150 },
              {
                title: "供货价",
                dataIndex: "supplyPrice",
                width: 110,
                render: (value: string, row) =>
                  `¥${money(value)} / ${row.unit || "件"}`,
              },
              {
                title: "适配场景",
                dataIndex: "scene",
                ellipsis: true,
                render: (value: string) => value || "—",
              },
              {
                title: "操作",
                width: 120,
                render: (_, row) => (
                  <Space size={6}>
                    <Button
                      onClick={() => skuTarget && openSkuForm(skuTarget, row)}
                    >
                      编辑
                    </Button>
                    <Button danger onClick={() => removeSku(row)}>
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Modal>

      <Modal
        open={skuOpen}
        title={
          skuEditing
            ? `修改规格 · ${skuEditing.specName}`
            : `添加规格 · ${skuTarget?.name || ""}`
        }
        width={560}
        okText={skuEditing ? "保存修改（需密码）" : "添加"}
        cancelText="取消"
        onCancel={() => setSkuOpen(false)}
        onOk={() => void submitSku()}
      >
        <div className="form-2col">
          <Form.Item
            name="spec_name"
            label="规格参数 *"
            rules={[{ required: true, message: "规格参数必填" }]}
          >
            <Input placeholder="如：25kg 经济装" />
          </Form.Item>
          <Form.Item
            name="supply_price"
            label="规格供货价（元）*"
            rules={[{ required: true, message: "请填写该规格的供货价" }]}
          >
            <Input
              type="number"
              placeholder="该规格的结算单价，报价时按此预填"
            />
          </Form.Item>
          <Form.Item name="unit" label="单位">
            <Input placeholder="如：袋" />
          </Form.Item>
          <Form.Item name="scene" label="适配场景">
            <Input placeholder="如：小地块灌溉" />
          </Form.Item>
        </div>
      </Modal>

      {/* 站点归属与按站点上下架 */}
      <Modal
        open={Boolean(stationTarget)}
        title={`站点归属与上下架 · ${stationTarget?.name || ""}`}
        width={620}
        okText="保存归属"
        cancelText="取消"
        onCancel={() => setStationTarget(null)}
        onOk={() => void saveStations()}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          勾选归属站点后点「保存归属」；下方可对已归属站点单独上架 / 下架，
          下架后该站点需求方无法检索选购。
        </div>
        <Checkbox.Group
          value={pickedStationIds}
          onChange={(values) => setPickedStationIds(values as number[])}
          options={myStations.map((item) => ({
            value: item.id,
            label: `${item.name}${item.region ? `（${item.region}）` : ""}`,
          }))}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        />
        <div style={{ marginTop: 16 }}>
          {(stationTarget?.stations || []).length ? (
            (stationTarget?.stations || []).map((link) => (
              <div
                key={link.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <span>
                  {stationName(link.stationId)}　
                  <StatusBadge domain="supplyListing" status={link.status} />
                </span>
                <Button
                  onClick={() =>
                    void toggleStation(
                      stationTarget as SupplyProduct,
                      link.stationId,
                      link.status === "ONLINE" ? "OFFLINE" : "ONLINE",
                    )
                  }
                >
                  {link.status === "ONLINE" ? "下架" : "上架"}
                </Button>
              </div>
            ))
          ) : (
            <EmptyState
              icon={<ShopOutlined aria-hidden />}
              text="尚未归属任何站点"
            />
          )}
        </div>
      </Modal>

      {passwordModal}
    </Panel>
  );
}
