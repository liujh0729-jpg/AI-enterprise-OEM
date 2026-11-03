"use client";

import { EnvironmentOutlined } from "@ant-design/icons";
import { Alert, App, Button, Spin } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  money,
  providerLabel,
  type SupplyProduct,
  type SupplySku,
} from "@/app/supply/_components/common";
import { useCreateSupplyOrder, useMobileOrderOptions, useStationProducts } from "@/query/workspaces";
import { enterpriseContactDefaults } from "@/lib/contacts";
import { useSession } from "@/lib/session";

type CartLine = {
  productId: number;
  skuId: number;
  productName: string;
  specName: string;
  unit: string;
  price: number;
  quantity: number;
};

/** 本地日期（避免 toISOString 的 UTC 偏差：北京时间凌晨会算成前一天）。 */
function localDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 默认期望到货时间：今天 + 7 天（必填项，预填减少手机端输入）。 */
function defaultExpectedDate() {
  return localDate(7);
}

function today() {
  return localDate(0);
}

/**
 * H5 下单：只列**已签约（生效中「供销服务」）服务商**的启用站点，
 * 商品按站加载，价格取所选**规格**的供货价；明细逐条添加、可改可删。
 */
export function MobileOrderCreate({
  onSubmitted,
  onOpenMine,
}: {
  onSubmitted: () => void;
  onOpenMine: () => void;
}) {
  const { message } = App.useApp();
  const { me } = useSession();
  const optionsQuery = useMobileOrderOptions();
  const stations = useMemo(() => optionsQuery.data?.stations ?? [], [optionsQuery.data]);
  const contracts = useMemo(() => optionsQuery.data?.contracts ?? [], [optionsQuery.data]);
  const loading = optionsQuery.isPending;
  const createOrder = useCreateSupplyOrder();
  const [stationId, setStationId] = useState(0);
  const productsQuery = useStationProducts(stationId);
  const products = productsQuery.data ?? [];
  const loadingProducts = productsQuery.isPending;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expectedDate, setExpectedDate] = useState(defaultExpectedDate);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [remark, setRemark] = useState("");
  const submitting = createOrder.isPending;

  /** 订货联系方式预填用户档案（法定代表人/经营者/姓名 + 联系电话），可改。 */
  useEffect(() => {
    const contact = enterpriseContactDefaults(me);
    setContactName((prev) => prev || contact.name);
    setContactPhone((prev) => prev || contact.phone);
  }, [me]);

  /** 只有「生效中的供销服务签约」服务商的启用站点可下单（无签约下单会被后端 20001 拒绝）。 */
  const availableStations = useMemo(() => {
    const signed = new Set(
      contracts
        .filter(
          (item) =>
            item.serviceType === "SUPPLY_NETWORK" && item.status === "ACTIVE",
        )
        .map((item) => item.providerUserId || ""),
    );
    return stations.filter(
      (item) => item.status === "ACTIVE" && signed.has(item.providerUserId),
    );
  }, [stations, contracts]);

  const currentStation = useMemo(
    () => availableStations.find((item) => item.id === stationId) || null,
    [availableStations, stationId],
  );

  const providerName = (userId: string) =>
    providerLabel(contracts, userId, me?.userId || "", me?.displayName || "");

  const totalQuantity = cart.reduce((acc, line) => acc + line.quantity, 0);
  const totalAmount = cart.reduce(
    (acc, line) => acc + line.price * line.quantity,
    0,
  );

  const addSku = (product: SupplyProduct, sku: SupplySku) => {
    setCart((prev) => {
      const hit = prev.find((line) => line.skuId === sku.id);
      if (hit) {
        return prev.map((line) =>
          line.skuId === sku.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          skuId: sku.id,
          productName: product.name,
          specName: sku.specName,
          unit: sku.unit || product.unit || "件",
          price: Number(sku.supplyPrice || 0),
          quantity: 1,
        },
      ];
    });
  };

  const changeQuantity = (skuId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) =>
          line.skuId === skuId
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const removeLine = (skuId: number) => {
    setCart((prev) => prev.filter((line) => line.skuId !== skuId));
  };

  const submit = async () => {
    if (!stationId) {
      message.warning("请先选择服务站");
      return;
    }
    if (!cart.length) {
      message.warning("请至少添加一条订货明细");
      return;
    }
    if (!expectedDate) {
      message.warning("请填写期望到货时间");
      return;
    }
    if (!contactName.trim() || !contactPhone.trim()) {
      message.warning("请填写订货联系人及联系电话（便于服务商与您磋商）");
      return;
    }
    try {
      await createOrder.mutateAsync({
        station_id: stationId,
        expected_date: expectedDate,
        contact_name: contactName,
        contact_phone: contactPhone,
        remark,
        items: cart.map((line) => ({
          product_id: line.productId,
          sku_id: line.skuId,
          quantity: line.quantity,
        })),
      });
      message.success("订货单已提交，等待服务商报价");
      setCart([]);
      setRemark("");
      setExpectedDate(defaultExpectedDate());
      setSheetOpen(false);
      onSubmitted();
    } catch {
      // 操作错误由统一 Mutation Hook 呈现。
    }
  };

  if (loading) {
    return (
      <div className="m-loading">
        <Spin />
      </div>
    );
  }

  if (optionsQuery.isError) return <Alert type="error" message={optionsQuery.error.message} action={<Button onClick={() => void optionsQuery.refetch()}>重试</Button>} />;

  return (
    <div className="m-view">
      <section className="m-card">
        <div className="m-card-title">
          选择服务站
          <span className="m-card-sub">
            {availableStations.length} 个可订货站点
          </span>
        </div>
        {availableStations.length ? (
          <>
            <select
              className="m-select"
              value={stationId || ""}
              onChange={(event) => {
                setStationId(Number(event.target.value) || 0);
                setCart([]);
              }}
            >
              <option value="">请选择服务站</option>
              {availableStations.map((item) => (
                <option key={item.id} value={item.id}>
                  {providerName(item.providerUserId)} · {item.name}
                </option>
              ))}
            </select>
            {currentStation ? (
              <div className="m-hint">
                <EnvironmentOutlined aria-hidden /> {currentStation.region} {currentStation.address}
                {currentStation.contactName
                  ? ` · 联系人 ${currentStation.contactName} ${currentStation.contactPhone}`
                  : ""}
              </div>
            ) : (
              <div className="m-hint">
                每家服务商下有多个服务站，本站商品与服务由该站履约。
              </div>
            )}
          </>
        ) : (
          <div className="m-empty-inline">
            <div className="m-empty-title">暂无可用服务站</div>
            <p className="m-empty-text">
              需先与服务商完成生效中的「供销服务」签约，且对方已建站上架商品。
            </p>
            <div className="m-inline-actions">
              <Button href="/supply?tab=providers" size="middle">
                去选服务商签约
              </Button>
            </div>
          </div>
        )}
      </section>

      {stationId ? (
        <section className="m-card">
          <div className="m-card-title">
            选购商品
            <span className="m-card-sub">{products.length} 个在售商品</span>
          </div>
          {loadingProducts ? (
            <div className="m-loading">
              <Spin />
            </div>
          ) : productsQuery.isError ? (
            <Alert type="error" message={productsQuery.error.message} action={<Button onClick={() => void productsQuery.refetch()}>重试</Button>} />
          ) : products.length ? (
            <>
              {products.map((product) => (
                <div className="m-product" key={product.id}>
                  <div className="m-product-name">{product.name}</div>
                  <div className="m-product-meta">
                    {product.category || "未分类"}
                    {" · "}
                    {product.unit}
                  </div>
                  {(product.skus || []).length ? (
                    (product.skus || []).map((sku) => {
                      const line = cart.find((item) => item.skuId === sku.id);
                      return (
                        <div className="m-spec" key={sku.id}>
                          <div className="m-spec-main">
                            <div className="m-spec-name">{sku.specName}</div>
                            <div className="m-spec-meta">
                              {sku.unit} · ¥{money(sku.supplyPrice)}
                              {sku.scene ? ` · ${sku.scene}` : ""}
                            </div>
                          </div>
                          {line ? (
                            <div className="m-stepper">
                              <button
                                type="button"
                                onClick={() => changeQuantity(sku.id, -1)}
                              >
                                −
                              </button>
                              <span>{line.quantity}</span>
                              <button
                                type="button"
                                onClick={() => changeQuantity(sku.id, 1)}
                              >
                                ＋
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="m-add"
                              onClick={() => addSku(product, sku)}
                            >
                              加入
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="m-hint">该商品暂未设置规格，暂不可订购</div>
                  )}
                </div>
              ))}
              <div className="m-hint">
                展示价为该规格的供货价，最终以服务商报价单为准。
              </div>
            </>
          ) : (
            <div className="m-hint">该服务站暂无在售商品</div>
          )}
        </section>
      ) : null}

      {cart.length ? (
        <div className="m-cartbar">
          <div className="m-cartbar-info">
            <div className="m-cartbar-amount">¥{money(totalAmount)}</div>
            <div className="m-cartbar-meta">
              已选 {cart.length} 种 · {totalQuantity} 件
            </div>
          </div>
          <Button type="primary" onClick={() => setSheetOpen(true)}>
            填写并提交
          </Button>
        </div>
      ) : null}

      {sheetOpen ? (
        <div className="m-sheet-mask" onClick={() => setSheetOpen(false)}>
          <div className="m-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="m-sheet-head">
              <span>订货明细</span>
              <button
                type="button"
                className="m-sheet-close"
                onClick={() => setSheetOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="m-sheet-body">
              {cart.map((line) => (
                <div className="m-line" key={line.skuId}>
                  <div className="m-line-main">
                    <div className="m-line-name">{line.productName}</div>
                    <div className="m-line-meta">
                      {line.specName} · {line.unit} · ¥{money(line.price)}
                    </div>
                  </div>
                  <div className="m-stepper">
                    <button
                      type="button"
                      onClick={() => changeQuantity(line.skuId, -1)}
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => changeQuantity(line.skuId, 1)}
                    >
                      ＋
                    </button>
                  </div>
                  <button
                    type="button"
                    className="m-line-remove"
                    onClick={() => removeLine(line.skuId)}
                  >
                    删除
                  </button>
                </div>
              ))}

              <label className="m-field">
                <span className="m-field-label">期望到货时间（必填）</span>
                <input
                  className="m-input"
                  type="date"
                  min={today()}
                  value={expectedDate}
                  onChange={(event) => setExpectedDate(event.target.value)}
                />
              </label>

              <label className="m-field">
                <span className="m-field-label">订货联系人（必填）</span>
                <input
                  className="m-input"
                  value={contactName}
                  placeholder="联系人姓名"
                  onChange={(event) => setContactName(event.target.value)}
                />
              </label>

              <label className="m-field">
                <span className="m-field-label">联系电话（必填）</span>
                <input
                  className="m-input"
                  type="tel"
                  value={contactPhone}
                  placeholder="手机号或固定电话"
                  onChange={(event) => setContactPhone(event.target.value)}
                />
              </label>

              <label className="m-field">
                <span className="m-field-label">订货备注（选填）</span>
                <textarea
                  className="m-textarea"
                  rows={3}
                  placeholder="特殊需求、收货要求等"
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                />
              </label>

              <div className="m-summary">
                <span>商品合计</span>
                <strong>¥{money(totalAmount)}</strong>
              </div>
              <div className="m-hint">
                提交后由服务商（或其指派职员）审核报价，报价与费用明细在「我的订货单」查看确认；
                联系方式随单流转，双方可据此直接商谈。
              </div>
            </div>
            <div className="m-sheet-foot">
              <Button onClick={onOpenMine}>我的订货单</Button>
              <Button
                type="primary"
                loading={submitting}
                onClick={() => void submit()}
              >
                提交订货单
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
