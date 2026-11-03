"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { supplyApi } from "@/api/supply";
import {
  useSupplyOrders,
  useProviderStaff,
  useSupplyLogs,
  useSupplyOrderNote,
} from "@/query/workspaces";

import {
  FileTextOutlined,
  HistoryOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
} from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import {
  contactText,
  enterpriseContactDefaults,
  providerContactDefaults,
} from "@/lib/contacts";
import { useSession } from "@/lib/session";
import type { SupplyIdentity } from "../page";
import {
  STOCK_STATE_OPTIONS,
  SUPPLY_NOTE_TEXT as NOTE_ACTION_TEXT,
  feeText,
  fmtTime,
  money,
  orderItemText,
  providerContactText,
  providerLabel,
  staffLabel,
  stockText,
  toDateText,
  type SupplyNoteAction as NoteAction,
  type SupplyContract,
  type SupplyFeeEntry,
  type SupplyOrder,
  type SupplyOrderItem,
  type SupplyOrderLog,
  type SupplyProduct,
  type SupplyStation,
} from "./common";

/** 本地明细行（逐条添加：列表 + 单条改删，最后一起提交）。 */
type DraftItem = {
  key: string;
  productId: number;
  skuId: number;
  quantity: number;
};

/** 报价明细行（服务商/承办职员逐条确认库存、单价、缺货说明与补货周期）。 */
type QuoteRow = {
  id: number;
  productName: string;
  specName: string;
  unit: string;
  price: number;
  quantity: number;
  stockState: string;
  shortageNote: string;
  restockCycle: string;
};

type FeeRow = { name: string; amount: number; note: string };

/**
 * 商品订货页签（需求 §三/§四：询价式订货流程）：
 * - 用户：发起订货单（逐条添加商品明细）→ 草稿/提交 → 确认或驳回报价 → 否决/取消；
 * - 服务商账号：指派承办职员，或本人直接报价；
 * - 承办职员：报价（逐条缺货说明 + 承诺发货日期 + 其他费用）；
 * - 全流程操作留痕（提交 / 报价 / 确认 / 驳回 / 否决 / 修改重提）。
 */
export function OrderTab({
  stations,
  products,
  contracts,
  identity,
  panelTitle,
  switcher,
}: {
  stations: SupplyStation[];
  products: SupplyProduct[];
  contracts: SupplyContract[];
  reload: () => Promise<void> | void;
  identity: SupplyIdentity;
  /** 企业侧「商品供应」栏目内的单据列表标题。 */
  panelTitle?: string;
  /** 企业侧「商品供应」栏目内的子视图切换器（可订商品 / 我的订货单）。 */
  switcher?: ReactNode;
}) {
  const supply_createOrderMutation = useOperationMutation(
    supplyApi.createOrder,
    ["supply", "dashboard"],
  );
  const supply_updateOrderMutation = useOperationMutation(
    supplyApi.updateOrder,
    ["supply", "dashboard"],
  );
  const supply_submitOrderMutation = useOperationMutation(
    supplyApi.submitOrder,
    ["supply", "dashboard"],
  );
  const supply_removeOrderMutation = useOperationMutation(
    supplyApi.removeOrder,
    ["supply", "dashboard"],
  );
  const supply_quoteOrderMutation = useOperationMutation(supplyApi.quoteOrder, [
    "supply",
    "dashboard",
  ]);
  const supply_assignOrderMutation = useOperationMutation(
    supplyApi.assignOrder,
    ["supply", "dashboard"],
  );

  const [page, setPage] = useState(1);
  const listQuery = useSupplyOrders(page);
  const rows = listQuery.data?.list ?? [];
  const loading = listQuery.isPending;

  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const { me } = useSession();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplyOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [stationId, setStationId] = useState<number>(0);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [itemForm] = Form.useForm();
  const [detail, setDetail] = useState<SupplyOrder | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<SupplyOrder | null>(null);
  const [quoteRows, setQuoteRows] = useState<QuoteRow[]>([]);
  const [quoteFees, setQuoteFees] = useState<FeeRow[]>([]);
  const [promisedDate, setPromisedDate] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [quoteContactName, setQuoteContactName] = useState("");
  const [quoteContactPhone, setQuoteContactPhone] = useState("");
  const [assignTarget, setAssignTarget] = useState<SupplyOrder | null>(null);

  const [pickedStaff, setPickedStaff] = useState("");
  const [logTarget, setLogTarget] = useState<SupplyOrder | null>(null);
  const staffQuery = useProviderStaff(assignTarget !== null);
  const staff = staffQuery.data ?? [];
  const logsQuery = useSupplyLogs("orders", logTarget?.id ?? null);
  const logs = logsQuery.data ?? [];
  const logsLoading = logsQuery.isPending;
  const noteMutation = useSupplyOrderNote();
  const [noteAction, setNoteAction] = useState<{
    action: NoteAction;
    row: SupplyOrder;
  } | null>(null);
  const [noteText, setNoteText] = useState("");

  /** 企业侧动作（与后端 requireOwnOrder 同口径）：本企业当事人 + 平台管理员。 */
  const canEnterpriseAct = (row: SupplyOrder) =>
    identity.isAdmin ||
    row.createdBy === identity.meUserId ||
    identity.isEnterprise;
  /** 服务商侧动作者（与后端 requireBizActor 同口径）：指派了职员则仅该职员可作业。 */
  const canQuote = (row: SupplyOrder) =>
    identity.isAdmin ||
    (row.staffUserId
      ? row.staffUserId === identity.meUserId
      : identity.isProvider && row.providerUserId === identity.meUserId);
  /** 仅服务商账号本人可指派承办职员（与后端 assignOrder 同口径）。 */
  const canAssign = (row: SupplyOrder) =>
    identity.isAdmin ||
    (identity.isProvider && row.providerUserId === identity.meUserId);

  const providerText = (userId: string) =>
    providerLabel(contracts, userId, identity.meUserId, identity.selfName);

  /** 订货联系人预填：取当前用户档案（可改）；报价联系人预填：取当前操作人档案。 */
  const contactDefaults = () => {
    const contact = enterpriseContactDefaults(me);
    return { contact_name: contact.name, contact_phone: contact.phone };
  };
  const quoteContactDefaults = () => providerContactDefaults(me);

  /** 可下单站点：企业侧只列已签「供销服务」的服务商站点。 */
  const signedProviders = contracts
    .filter(
      (item) =>
        item.serviceType === "SUPPLY_NETWORK" && item.status === "ACTIVE",
    )
    .map((item) => item.providerUserId || "");
  const availableStations =
    identity.isEnterprise && !identity.isAdmin
      ? stations.filter(
          (item) =>
            item.status === "ACTIVE" &&
            signedProviders.includes(item.providerUserId),
        )
      : stations.filter((item) => item.status === "ACTIVE");

  /** 站点在售商品（后端已按可见范围过滤；此处再按站点上架状态过滤）。 */
  const stationProducts = (id: number) =>
    products.filter(
      (item) =>
        item.status === "ONLINE" &&
        (item.stations || []).some(
          (link) => link.stationId === id && link.status === "ONLINE",
        ),
    );

  const productOf = (id: number) => products.find((item) => item.id === id);
  const skuOf = (productId: number, skuId: number) =>
    (productOf(productId)?.skus || []).find((item) => item.id === skuId);

  const itemPrice = (productId: number, skuId: number) => {
    const sku = skuId ? skuOf(productId, skuId) : null;
    return Number(sku?.supplyPrice ?? 0);
  };
  const itemUnit = (productId: number, skuId: number) => {
    const sku = skuId ? skuOf(productId, skuId) : null;
    return sku?.unit || productOf(productId)?.unit || "";
  };
  const itemSpec = (productId: number, skuId: number) =>
    skuId ? skuOf(productId, skuId)?.specName || "" : "";

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setItems([]);
    const first = availableStations[0]?.id || 0;
    setStationId(first);
    form.setFieldsValue({
      station_id: first,
      ...contactDefaults(),
    });
    setOpen(true);
  };

  const openEdit = (row: SupplyOrder) => {
    setEditing(row);
    setItems(
      (row.items || []).map((item, index) => ({
        key: `it-${index}`,
        productId: item.productId,
        skuId: item.skuId,
        quantity: Number(item.quantity || 0),
      })),
    );
    setStationId(row.stationId);
    form.setFieldsValue({
      station_id: row.stationId,
      expected_date: row.expectedDate,
      remark: row.remark,
      contact_name: row.contactName || "",
      contact_phone: row.contactPhone || "",
    });
    setOpen(true);
  };

  const openItemForm = (key: string | null) => {
    if (!stationId) {
      message.warning("请先选择服务站");
      return;
    }
    const current = key ? items.find((item) => item.key === key) : null;
    setItemKey(key);
    itemForm.resetFields();
    itemForm.setFieldsValue(
      current
        ? {
            product_id: current.productId,
            sku_id: current.skuId || undefined,
            quantity: current.quantity,
          }
        : { quantity: 1 },
    );
    setItemOpen(true);
  };

  const saveItem = async () => {
    const values = await itemForm.validateFields();
    const next: DraftItem = {
      key: itemKey || `it-${Date.now()}`,
      productId: Number(values.product_id || 0),
      skuId: Number(values.sku_id || 0),
      quantity: Number(values.quantity || 0),
    };
    setItems((prev) =>
      itemKey
        ? prev.map((item) => (item.key === itemKey ? next : item))
        : [...prev, next],
    );
    setItemOpen(false);
    setItemKey(null);
    itemForm.resetFields();
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((item) => item.key !== key));
  };

  const buildItems = () =>
    items.map((item) => ({
      product_id: item.productId,
      sku_id: item.skuId || 0,
      quantity: item.quantity,
    }));

  const submitOrder = async (draft: boolean) => {
    try {
      const values = await form.validateFields();
      if (!items.length) {
        message.warning("请至少添加一条订货明细");
        return;
      }
      const body = {
        station_id: stationId,
        expected_date: toDateText(values.expected_date),
        remark: values.remark || "",
        contact_name: values.contact_name || "",
        contact_phone: values.contact_phone || "",
        items: buildItems(),
        draft,
      };
      setBusy(true);
      try {
        if (!editing) {
          const payload = await supply_createOrderMutation.mutateAsync({
            body: body,
          });

          const data = payload;
          message.success(
            draft
              ? `草稿已保存（${data?.order_no || ""}），可在列表「提交」`
              : `订货单已提交（${data?.order_no || ""}），待服务商报价`,
          );
          setOpen(false);

          return;
        }
        const target = editing;
        await supply_updateOrderMutation.mutateAsync({
          params: { id: String(target.id) },
          body: body,
        });

        message.success(
          `已修改并重新提交（第 ${target.revision + 1} 版），待重新报价`,
        );
        setOpen(false);
      } finally {
        setBusy(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const doSubmit = (row: SupplyOrder) => {
    Modal.confirm({
      title: "提交订货单",
      content: `确认提交「${row.orderNo}」？提交后服务商（或承办职员）将按明细报价。`,
      okText: "确认提交",
      cancelText: "取消",
      onOk: async () => {
        await supply_submitOrderMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("已提交，待报价");
      },
    });
  };

  const removeOrder = (row: SupplyOrder) => {
    requestPassword({
      title: "删除订货单",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.orderNo}」？仅草稿、已否决、已取消的单据可删除。`,
      onOk: async () => {
        await supply_removeOrderMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("订货单已删除");
        setDetail(null);
      },
    });
  };

  const submitNoteAction = async () => {
    if (!noteAction) return;
    const { action, row } = noteAction;
    const spec = NOTE_ACTION_TEXT[action];
    if (spec.requireNote && !noteText.trim()) {
      message.warning("请填写原因");
      return;
    }
    try {
      await noteMutation.mutateAsync({ id: row.id, action, note: noteText });
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
      return;
    }
    message.success(spec.success);
    setNoteAction(null);
    setNoteText("");
    setDetail(null);
  };

  const openQuote = (row: SupplyOrder) => {
    setQuoteTarget(row);
    setQuoteRows(
      (row.items || []).map((item) => ({
        id: item.id,
        productName: item.productName,
        specName: item.specName,
        unit: item.unit,
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        stockState: item.stockState || "SUFFICIENT",
        shortageNote: item.shortageNote || "",
        restockCycle: item.restockCycle || "",
      })),
    );
    setQuoteFees(
      (row.otherFees || []).map((item: SupplyFeeEntry) => ({
        name: item.name || "",
        amount: Number(item.amount || 0),
        note: item.note || "",
      })),
    );
    setPromisedDate(row.promisedShipDate || "");
    setQuoteNote(row.quoteNote || "");
    const fallback = quoteContactDefaults();
    setQuoteContactName(row.providerContactName || fallback.name);
    setQuoteContactPhone(row.providerContactPhone || fallback.phone);
  };

  const patchQuoteRow = (id: number, patch: Partial<QuoteRow>) => {
    setQuoteRows((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const patchFeeRow = (index: number, patch: Partial<FeeRow>) => {
    setQuoteFees((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    );
  };

  const submitQuote = async () => {
    try {
      if (!quoteTarget) return;
      if (!quoteContactName.trim() || !quoteContactPhone.trim()) {
        message.warning("请填写报价联系人及联系电话（便于企业方与您磋商）");
        return;
      }
      if (quoteRows.some((item) => !item.price || item.quantity <= 0)) {
        message.warning("请逐条确认单价与数量（单价不可为 0）");
        return;
      }
      setBusy(true);
      try {
        const payload = await supply_quoteOrderMutation.mutateAsync({
          params: { id: String(quoteTarget.id) },
          body: {
            items: quoteRows.map((item) => ({
              id: item.id,
              price: item.price,
              quantity: item.quantity,
              stock_state: item.stockState,
              shortage_note: item.shortageNote,
              restock_cycle: item.restockCycle,
            })),
            promised_ship_date: promisedDate,
            quote_note: quoteNote,
            provider_contact_name: quoteContactName,
            provider_contact_phone: quoteContactPhone,
            other_fees: quoteFees
              .filter((item) => item.name.trim())
              .map((item) => ({
                name: item.name,
                amount: Number(item.amount || 0),
                note: item.note || "",
              })),
          },
        });

        const data = payload;
        message.success(
          `报价已提交，报价总额 ¥${money(data?.total_amount)}，待企业确认`,
        );
        setQuoteTarget(null);
      } finally {
        setBusy(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const openAssign = (row: SupplyOrder) => {
    setAssignTarget(row);
    setPickedStaff(row.staffUserId || "");
  };

  const submitAssign = async () => {
    try {
      if (!assignTarget) return;
      await supply_assignOrderMutation.mutateAsync({
        params: { id: String(assignTarget.id) },
        body: { staff_user_id: pickedStaff },
      });

      message.success(
        pickedStaff ? "已指派承办职员" : "已收回承办（由服务商账号办理）",
      );
      setAssignTarget(null);
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const openLogs = (row: SupplyOrder) => setLogTarget(row);

  const detailItems = (detail?.items || []) as SupplyOrderItem[];
  const productAmount = quoteRows.reduce(
    (acc, item) => acc + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const feeAmount = quoteFees.reduce(
    (acc, item) => acc + Number(item.amount || 0),
    0,
  );

  return (
    <Panel
      title={panelTitle || "商品订货（询价式订货单）"}
      extra={
        identity.isEnterprise || identity.isAdmin ? (
          <Button type="primary" onClick={openCreate}>
            ＋ 发起订货单
          </Button>
        ) : null
      }
    >
      {switcher}
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        企业按服务站发起订货单（逐条添加商品明细）→ 服务商账号或其承办职员报价
        （逐条缺货说明 + 承诺发货日期 + 其他费用）→ 企业确认报价后订单生效；
        企业可驳回要求重新报价，也可否决/取消。
      </div>
      {listQuery.isError ? (
        <Notice variant="error">
          {listQuery.error.message}{" "}
          <Button onClick={() => void listQuery.refetch()}>重试</Button>
        </Notice>
      ) : null}
      <div className="table-wrap">
        <Table<SupplyOrder>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 20,
            total: listQuery.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          size="middle"
          locale={{
            emptyText: (
              <EmptyState
                icon={<FileTextOutlined aria-hidden />}
                text={
                  identity.isEnterprise
                    ? "暂无订货单。在「商品供应」选择签约服务商在售商品后，可在此发起订货单。"
                    : "暂无订货单。企业按服务站发起订货单后，将在此显示待报价单据。"
                }
              />
            ),
          }}
          columns={[
            {
              title: "订货单号",
              dataIndex: "orderNo",
              width: 150,
              render: (value: string, row) => (
                <span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                  {row.revision > 1 ? (
                    <span className="text-12 muted">
                      （第 {row.revision} 版）
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              title: "订货企业",
              dataIndex: "enterpriseName",
              width: 170,
              ellipsis: true,
            },
            {
              title: "服务商 / 服务站",
              width: 220,
              render: (_, row) => (
                <Space orientation="vertical" size={0}>
                  <span className="text-12">
                    {providerText(row.providerUserId)}
                  </span>
                  <span className="text-12 muted">
                    {row.stationName || "—"}
                  </span>
                </Space>
              ),
            },
            {
              // 双方联系方式随单流转：企业侧看报价联系人、服务商侧看订货联系人（管理员看订货方）
              title: "联系方式",
              width: 150,
              render: (_, row) => (
                <span className="text-12">
                  {identity.isEnterprise && !identity.isAdmin
                    ? providerContactText(row)
                    : contactText(row.contactName, row.contactPhone)}
                </span>
              ),
            },
            {
              title: "订货明细",
              ellipsis: true,
              render: (_, row) => (
                <span className="text-12">{orderItemText(row.items)}</span>
              ),
            },
            {
              title: "期望到货",
              dataIndex: "expectedDate",
              width: 110,
              render: (value: string) => (
                <span className="text-12">{value || "—"}</span>
              ),
            },
            {
              title: "报价金额",
              width: 120,
              render: (_, row) =>
                row.status === "DRAFT" || row.status === "SUBMITTED" ? (
                  <span className="text-12 muted">待报价</span>
                ) : (
                  <span style={{ fontWeight: 600 }}>
                    ¥{money(row.totalAmount)}
                  </span>
                ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 160,
              render: (value: string) => (
                <Space orientation="vertical" size={2}>
                  <StatusBadge domain="supply" status={value} />
                  {value === "RETURNED" ? (
                    <span className="text-12 muted">待服务商重新报价</span>
                  ) : null}
                </Space>
              ),
            },
            {
              title: "承办职员",
              width: 120,
              render: (_, row) => (
                <span className="text-12">
                  {row.staffName ||
                    staffLabel(
                      row.staffUserId,
                      identity.meUserId,
                      identity.selfName,
                    )}
                </span>
              ),
            },
            {
              title: "操作",
              width: 260,
              render: (_, row) => (
                <Space size={6} wrap>
                  <Button onClick={() => setDetail(row)}>详情</Button>
                  {canEnterpriseAct(row) && row.status === "DRAFT" ? (
                    <Button type="primary" onClick={() => doSubmit(row)}>
                      提交
                    </Button>
                  ) : null}
                  {canEnterpriseAct(row) &&
                  ["DRAFT", "SUBMITTED", "QUOTED", "RETURNED"].includes(
                    row.status,
                  ) ? (
                    <Button onClick={() => openEdit(row)}>
                      {row.status === "DRAFT" ? "修改" : "修改重提"}
                    </Button>
                  ) : null}
                  {canQuote(row) &&
                  ["SUBMITTED", "RETURNED"].includes(row.status) ? (
                    <Button type="primary" onClick={() => openQuote(row)}>
                      报价
                    </Button>
                  ) : null}
                  {canEnterpriseAct(row) && row.status === "QUOTED" ? (
                    <>
                      <Button
                        type="primary"
                        onClick={() => {
                          setNoteAction({ action: "confirm", row });
                          setNoteText("");
                        }}
                      >
                        确认报价
                      </Button>
                      <Button
                        danger
                        onClick={() => {
                          setNoteAction({ action: "return", row });
                          setNoteText("");
                        }}
                      >
                        驳回
                      </Button>
                    </>
                  ) : null}
                  {canAssign(row) ? (
                    <Button onClick={() => void openAssign(row)}>
                      指派职员
                    </Button>
                  ) : null}
                  <Button onClick={() => void openLogs(row)}>留痕</Button>
                  {canEnterpriseAct(row) &&
                  !["ACTIVE", "VETOED", "CANCELLED"].includes(row.status) ? (
                    <>
                      <Button
                        danger
                        onClick={() => {
                          setNoteAction({ action: "veto", row });
                          setNoteText("");
                        }}
                      >
                        否决
                      </Button>
                      <Button
                        onClick={() => {
                          setNoteAction({ action: "cancel", row });
                          setNoteText("");
                        }}
                      >
                        取消
                      </Button>
                    </>
                  ) : null}
                  {canEnterpriseAct(row) &&
                  ["DRAFT", "VETOED", "CANCELLED"].includes(row.status) ? (
                    <Button danger onClick={() => removeOrder(row)}>
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
        title={
          editing
            ? `${
                editing.status === "DRAFT"
                  ? "修改订货单"
                  : "修改订货单并重新提交"
              } · ${editing.orderNo}`
            : "发起订货单"
        }
        width={860}
        okText={
          editing
            ? editing.status === "DRAFT"
              ? "保存"
              : "保存并重新提交"
            : "提交订货单"
        }
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setOpen(false)}
        onOk={() => void submitOrder(false)}
        footer={(origin) => (
          <Space size={8}>
            {origin}
            {!editing ? (
              <Button onClick={() => void submitOrder(true)}>存为草稿</Button>
            ) : null}
          </Space>
        )}
      >
        <Notice>
          订货明细按条添加：一次只填一条商品与数量，保存后进入下方列表，可逐条修改/删除。
          提交后由服务商（或其承办职员）按明细报价，企业确认后才生效。
        </Notice>
        <Form form={form} layout="vertical">
          <div className="form-2col">
            <Form.Item
              name="station_id"
              label="服务站 *（须与该服务商已签「供销服务」）"
              rules={[{ required: true, message: "请选择服务站" }]}
            >
              <Select
                placeholder={
                  availableStations.length
                    ? "选择服务站"
                    : "暂无可用站点：请先在「签约管理」与服务商签署供销服务"
                }
                onChange={(value: number) => {
                  setStationId(value);
                  setItems([]);
                }}
                options={availableStations.map((item) => ({
                  value: item.id,
                  label: `${item.name}（${item.region || "—"}）· ${providerText(
                    item.providerUserId,
                  )}`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="expected_date"
              label="期望到货时间 *"
              rules={[{ required: true, message: "请选择期望到货时间" }]}
            >
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-10" />
              ) : (
                <DatePicker style={{ width: "100%" }} />
              )}
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item
              name="contact_name"
              label="订货联系人 *（随单提供给服务商，便于磋商）"
              rules={[{ required: true, message: "请填写订货联系人" }]}
            >
              <Input placeholder="联系人姓名" />
            </Form.Item>
            <Form.Item
              name="contact_phone"
              label="联系电话 *"
              rules={[{ required: true, message: "请填写联系电话" }]}
            >
              <Input placeholder="手机号或固定电话" />
            </Form.Item>
          </div>
          <Form.Item name="remark" label="备注">
            <Input placeholder="如：需随车提供质检单；卸货在 2 号门" />
          </Form.Item>
        </Form>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            margin: "4px 0 8px",
          }}
        >
          <div className="text-12 muted">
            订货明细（{items.length} 条）· 金额以服务商报价为准
          </div>
          <Button type="primary" onClick={() => openItemForm(null)}>
            ＋ 添加明细
          </Button>
        </div>
        <div className="table-wrap">
          <Table<DraftItem>
            rowKey="key"
            dataSource={items}
            pagination={false}
            size="small"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<InboxOutlined aria-hidden />}
                  text="尚未添加明细，点「＋ 添加明细」逐条录入商品与数量"
                />
              ),
            }}
            columns={[
              {
                title: "商品",
                render: (_, row) =>
                  productOf(row.productId)?.name || `#${row.productId}`,
              },
              {
                title: "规格",
                width: 140,
                render: (_, row) => itemSpec(row.productId, row.skuId) || "—",
              },
              {
                title: "数量",
                width: 100,
                render: (_, row) =>
                  `${row.quantity}${itemUnit(row.productId, row.skuId)}`,
              },
              {
                title: "参考单价",
                width: 110,
                render: (_, row) =>
                  row.skuId
                    ? `¥${money(itemPrice(row.productId, row.skuId))}`
                    : "待选规格",
              },
              {
                title: "操作",
                width: 120,
                render: (_, row) => (
                  <Space size={6}>
                    <Button onClick={() => openItemForm(row.key)}>修改</Button>
                    <Button danger onClick={() => removeItem(row.key)}>
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
        open={itemOpen}
        title={itemKey ? "修改订货明细" : "添加订货明细"}
        width={520}
        okText={itemKey ? "保存" : "添加"}
        cancelText="取消"
        onCancel={() => setItemOpen(false)}
        onOk={() => void saveItem()}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          一次只添加一条；商品限本服务站已在售（该服务商在本站点上架）的商品。
        </div>
        <Form form={itemForm} layout="vertical">
          <Form.Item
            name="product_id"
            label="商品 *"
            rules={[{ required: true, message: "请选择商品" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={
                stationProducts(stationId).length
                  ? "选择商品"
                  : "该服务站暂无在售商品，可联系服务商上架"
              }
              onChange={() => itemForm.setFieldValue("sku_id", undefined)}
              options={stationProducts(stationId).map((item) => ({
                value: item.id,
                label: `${item.name}${item.category ? `（${item.category}）` : ""}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, next) => prev.product_id !== next.product_id}
          >
            {({ getFieldValue }) => {
              const productId = Number(getFieldValue("product_id") || 0);
              const skus = productOf(productId)?.skus || [];
              return (
                <Form.Item
                  name="sku_id"
                  label="规格 *（价格按规格成交）"
                  rules={[
                    {
                      required: true,
                      message: "请选择规格：商品价格按规格设定",
                    },
                  ]}
                >
                  <Select
                    placeholder={
                      skus.length ? "选择规格" : "该商品未设规格价，暂不可下单"
                    }
                    disabled={!skus.length}
                    options={skus.map((item) => ({
                      value: item.id,
                      label: `${item.specName} · ¥${money(item.supplyPrice)} / ${item.unit || "件"}`,
                    }))}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item
            name="quantity"
            label="数量 *"
            rules={[{ required: true, message: "请填写数量" }]}
          >
            <Input type="number" placeholder="如：200" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={`订货单详情 · ${detail?.orderNo || ""}`}
        width={760}
        onCancel={() => setDetail(null)}
        footer={
          <Space size={8}>
            <Button onClick={() => void openLogs(detail as SupplyOrder)}>
              操作留痕
            </Button>
            <Button onClick={() => setDetail(null)}>关闭</Button>
          </Space>
        }
      >
        {detail ? (
          <>
            <div className="text-12 muted" style={{ lineHeight: 1.9 }}>
              <div>
                状态：
                <StatusBadge domain="supply" status={detail.status} />
                {detail.revision > 1 ? `（第 ${detail.revision} 版）` : ""}
              </div>
              <div>
                订货企业：{detail.enterpriseName || "—"} · 服务商：
                {providerText(detail.providerUserId)} · 服务站：
                {detail.stationName || "—"}
              </div>
              <div>
                承办职员：
                {detail.staffName ||
                  staffLabel(
                    detail.staffUserId,
                    identity.meUserId,
                    identity.selfName,
                  )}{" "}
                · 期望到货：{detail.expectedDate || "—"} · 承诺发货：
                {detail.promisedShipDate || "—"}
              </div>
              <div>
                订货联系人：
                {contactText(detail.contactName, detail.contactPhone)} ·
                报价联系人：{providerContactText(detail)}
              </div>
              <div>备注：{detail.remark || "—"}</div>
              <div>报价备注：{detail.quoteNote || "—"}</div>
              <div>
                其他费用：{feeText(detail.otherFees)} · 货款：¥
                {money(detail.productAmount)} · 费用：¥{money(detail.feeAmount)}{" "}
                · 合计：¥{money(detail.totalAmount)}
              </div>
              <div>企业意见：{detail.confirmNote || "—"}</div>
              <div>提交时间：{fmtTime(detail.createdAt)}</div>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <Table<SupplyOrderItem>
                rowKey="id"
                dataSource={detailItems}
                pagination={false}
                size="small"
                columns={[
                  { title: "商品", dataIndex: "productName" },
                  {
                    title: "规格",
                    dataIndex: "specName",
                    width: 120,
                    render: (value: string) => value || "—",
                  },
                  {
                    title: "数量",
                    width: 100,
                    render: (_, row) => `${row.quantity}${row.unit || ""}`,
                  },
                  {
                    title: "单价",
                    width: 100,
                    render: (_, row) => `¥${money(row.price)}`,
                  },
                  {
                    title: "金额",
                    width: 110,
                    render: (_, row) => `¥${money(row.amount)}`,
                  },
                  {
                    title: "缺货情况",
                    width: 220,
                    render: (_, row) => (
                      <span className="text-12">{stockText(row)}</span>
                    ),
                  },
                ]}
              />
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(quoteTarget)}
        title={`报价 · ${quoteTarget?.orderNo || ""}`}
        width={920}
        okText="提交报价"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setQuoteTarget(null)}
        onOk={() => void submitQuote()}
      >
        <Notice>
          逐条确认单价与数量、标注「缺货情况」（缺货/部分缺货须写明原因与补货周期）；
          另填承诺发货日期、报价联系人与其他费用科目（正数增收、负数减免）。
        </Notice>
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          订货方联系方式：
          {contactText(quoteTarget?.contactName, quoteTarget?.contactPhone)}
          {quoteTarget?.expectedDate
            ? ` · 期望到货 ${quoteTarget.expectedDate}`
            : ""}
          （报价前后可直接与对方电话磋商）
        </div>
        <div className="table-wrap">
          <Table<QuoteRow>
            rowKey="id"
            dataSource={quoteRows}
            pagination={false}
            size="small"
            columns={[
              { title: "商品", dataIndex: "productName", width: 150 },
              {
                title: "规格",
                dataIndex: "specName",
                width: 110,
                render: (value: string) => value || "—",
              },
              {
                title: "单价（元）",
                width: 120,
                render: (_, row) => (
                  <Input
                    type="number"
                    value={String(row.price)}
                    onChange={(event) =>
                      patchQuoteRow(row.id, {
                        price: Number(event.target.value),
                      })
                    }
                  />
                ),
              },
              {
                title: "数量",
                width: 110,
                render: (_, row) => (
                  <Input
                    type="number"
                    value={String(row.quantity)}
                    onChange={(event) =>
                      patchQuoteRow(row.id, {
                        quantity: Number(event.target.value),
                      })
                    }
                  />
                ),
              },
              {
                title: "金额",
                width: 100,
                render: (_, row) => (
                  <span className="text-12">
                    ¥{money(Number(row.price || 0) * Number(row.quantity || 0))}
                  </span>
                ),
              },
              {
                title: "缺货情况",
                width: 130,
                render: (_, row) => (
                  <Select
                    style={{ width: "100%" }}
                    value={row.stockState}
                    onChange={(value: string) =>
                      patchQuoteRow(row.id, { stockState: value })
                    }
                    options={STOCK_STATE_OPTIONS}
                  />
                ),
              },
              {
                title: "缺货原因 / 补货周期",
                render: (_, row) => (
                  <Space
                    orientation="vertical"
                    size={4}
                    style={{ width: "100%" }}
                  >
                    <Input
                      placeholder="缺货原因说明"
                      value={row.shortageNote}
                      onChange={(event) =>
                        patchQuoteRow(row.id, {
                          shortageNote: event.target.value,
                        })
                      }
                    />
                    <Input
                      placeholder="补货周期，如 7 天到货"
                      value={row.restockCycle}
                      onChange={(event) =>
                        patchQuoteRow(row.id, {
                          restockCycle: event.target.value,
                        })
                      }
                    />
                  </Space>
                ),
              },
            ]}
          />
        </div>
        <div className="form-2col" style={{ marginTop: 14 }}>
          <Form.Item label="承诺发货日期">
            <Input
              placeholder="YYYY-MM-DD，如 2026-10-08"
              value={promisedDate}
              onChange={(event) => setPromisedDate(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="报价备注">
            <Input
              placeholder="如：价格含税含运费，逾期顺延"
              value={quoteNote}
              onChange={(event) => setQuoteNote(event.target.value)}
            />
          </Form.Item>
        </div>
        <div className="form-2col">
          <Form.Item label="报价联系人 *（随报价单提供给企业，便于磋商）">
            <Input
              placeholder="联系人姓名"
              value={quoteContactName}
              onChange={(event) => setQuoteContactName(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="联系电话 *">
            <Input
              placeholder="手机号或固定电话"
              value={quoteContactPhone}
              onChange={(event) => setQuoteContactPhone(event.target.value)}
            />
          </Form.Item>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            margin: "4px 0 8px",
          }}
        >
          <div className="text-12 muted">
            其他费用（服务商自行填写，正数增收 / 负数减免，合计：¥
            {money(feeAmount)}）
          </div>
          <Button
            onClick={() =>
              setQuoteFees((prev) => [
                ...prev,
                { name: "", amount: 0, note: "" },
              ])
            }
          >
            ＋ 添加费用
          </Button>
        </div>
        {quoteFees.length ? (
          quoteFees.map((fee, index) => (
            <Space
              key={`fee-${index}`}
              size={8}
              style={{ display: "flex", marginBottom: 8 }}
              align="start"
            >
              <Input
                style={{ width: 210 }}
                placeholder="费用名称，如 运费 / 装卸费"
                value={fee.name}
                onChange={(event) =>
                  patchFeeRow(index, { name: event.target.value })
                }
              />
              <Input
                type="number"
                style={{ width: 140 }}
                placeholder="金额（负数为减免）"
                value={String(fee.amount)}
                onChange={(event) =>
                  patchFeeRow(index, { amount: Number(event.target.value) })
                }
              />
              <Input
                style={{ width: 200 }}
                placeholder="说明，如 按实际车次"
                value={fee.note}
                onChange={(event) =>
                  patchFeeRow(index, { note: event.target.value })
                }
              />
              <Button
                type="text"
                danger
                onClick={() =>
                  setQuoteFees((prev) => prev.filter((_, idx) => idx !== index))
                }
              >
                删除
              </Button>
            </Space>
          ))
        ) : (
          <div className="text-12 muted" style={{ marginBottom: 8 }}>
            本单据无其他费用（仅货款）；如需运费/装卸费等，点「＋ 添加费用」。
          </div>
        )}
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "#fbfcff",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          货款合计 ¥{money(productAmount)} ＋ 其他费用 ¥{money(feeAmount)} ＝
          <span style={{ fontWeight: 600 }}>
            {" "}
            ¥{money(productAmount + feeAmount)}
          </span>
        </div>
      </Modal>

      <Modal
        open={Boolean(assignTarget)}
        title={`指派承办职员 · ${assignTarget?.orderNo || ""}`}
        width={560}
        okText="保存指派"
        okButtonProps={{ disabled: staffQuery.isPending || staffQuery.isError }}
        cancelText="取消"
        onCancel={() => setAssignTarget(null)}
        onOk={() => void submitAssign()}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          指派后报价与后续履约由该职员承办（服务商账号不再代替承办人作业）；
          留空即收回承办、由服务商账号本人办理。
        </div>
        {staffQuery.isError ? (
          <Notice variant="error">
            职员加载失败：{staffQuery.error.message}{" "}
            <Button onClick={() => void staffQuery.refetch()}>重试</Button>
          </Notice>
        ) : null}
        <Select
          loading={staffQuery.isPending}
          style={{ width: "100%" }}
          value={pickedStaff}
          onChange={setPickedStaff}
          options={[
            { value: "", label: "（不指派 · 由服务商账号办理）" },
            ...staff.map((item) => ({
              value: item.staffUserId,
              label: `${item.profile?.realName || item.staff_name || item.staffUserId}（${item.staffUserId}）`,
            })),
          ]}
        />
        {staffQuery.isSuccess && !staff.length ? (
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            尚未绑定职员，请先在「职员/代理人管理」添加并等待对方确认。
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(noteAction)}
        title={noteAction ? NOTE_ACTION_TEXT[noteAction.action].title : ""}
        width={520}
        okText="确认"
        cancelText="取消"
        okButtonProps={{
          danger: Boolean(
            noteAction && NOTE_ACTION_TEXT[noteAction.action].danger,
          ),
        }}
        destroyOnHidden
        onCancel={() => setNoteAction(null)}
        onOk={() => void submitNoteAction()}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          {noteAction ? NOTE_ACTION_TEXT[noteAction.action].tip : ""}
        </div>
        <div className="text-12 muted" style={{ marginBottom: 6 }}>
          {noteAction
            ? `${NOTE_ACTION_TEXT[noteAction.action].label}（${
                NOTE_ACTION_TEXT[noteAction.action].requireNote
                  ? "必填"
                  : "选填"
              }）`
            : ""}
        </div>
        <Input.TextArea
          rows={3}
          value={noteText}
          placeholder="填写原因或说明，供服务商与留痕记录查看"
          onChange={(event) => setNoteText(event.target.value)}
        />
      </Modal>

      <Modal
        open={Boolean(logTarget)}
        title={`操作留痕 · ${logTarget?.orderNo || ""}`}
        width={680}
        onCancel={() => setLogTarget(null)}
        footer={<Button onClick={() => setLogTarget(null)}>关闭</Button>}
      >
        {logsQuery.isError ? (
          <Notice variant="error">
            留痕加载失败：{logsQuery.error.message}{" "}
            <Button onClick={() => void logsQuery.refetch()}>重试</Button>
          </Notice>
        ) : null}
        <div className="table-wrap">
          <Table<SupplyOrderLog>
            rowKey="id"
            loading={logsLoading}
            dataSource={logs}
            pagination={false}
            size="small"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<HistoryOutlined aria-hidden />}
                  text="暂无留痕"
                />
              ),
            }}
            columns={[
              {
                title: "动作",
                dataIndex: "action",
                width: 110,
                render: (value: string) => supplyLogActionText(value),
              },
              {
                title: "操作人",
                dataIndex: "operatorName",
                width: 120,
                render: (value: string) => value || "—",
              },
              { title: "说明", dataIndex: "detail", ellipsis: true },
              {
                title: "时间",
                dataIndex: "createdAt",
                width: 150,
                render: (value: string) => (
                  <span className="text-12">{fmtTime(value)}</span>
                ),
              },
            ]}
          />
        </div>
      </Modal>

      {passwordModal}
    </Panel>
  );
}

/** 留痕动作文案（对齐后端 writeLog 的 action 值）。 */
function supplyLogActionText(action: string): string {
  const map: Record<string, string> = {
    SAVE_DRAFT: "存草稿",
    SUBMIT: "提交",
    QUOTE: "报价",
    CONFIRM: "确认生效",
    RETURN: "驳回",
    VETO: "否决",
    CANCEL: "取消",
    ASSIGN: "指派承办",
    RESUBMIT: "修改重提",
  };
  return map[action] || action || "—";
}
