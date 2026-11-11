"use client";

import { useCallback, useMemo, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Switch,
  Table,
} from "antd";
import { EmptyState, Notice, Panel, PanelTabs } from "@/components/ui/panel";
import {
  servicePackagesAdminApi,
  type ServicePackageCandidate,
  type ServicePackageOrder,
  type ServicePackageOrderItem,
  type ServicePackageRow,
  type ServicePackageSaveBody,
} from "@/api/service-packages";
import {
  BOARD_OPTIONS,
  DELIVERY_CODE_GROUPS,
  FULFILLMENT_STATUS,
  ITEM_STATE,
  PLATFORM_DELIVERY_NOTICE,
  boardLabel,
  deliveryCodeLabel,
} from "@/lib/service-packages";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { PermissionNotice, fmtTime, useAdminData } from "./common";

/* ============================================================
   平台管理后台「服务套餐」：套餐目录（CRUD + 交付配置）与
   交付管理（逐项匹配服务商 / 主持发起 / 更换主体 / 部分退款与整单退款）。
   进入即加载、变更自动重拉，不设手动刷新按钮。
   ============================================================ */

type DeliveryDraft = {
  code: string;
  label: string;
  providerUserId: string;
  providerOrg: string;
};

function fmtYuan(cents: number | null | undefined) {
  return `¥${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function fmtPoints(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function badge(map: Record<string, { label: string; cls: string }>, key: string) {
  const meta = map[key] || { label: key || "—", cls: "badge-gray" };
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}

export function ServicePackagesTab() {
  const [tab, setTab] = useState("catalog");
  return (
    <PanelTabs
      value={tab}
      onChange={setTab}
      items={[
        { key: "catalog", label: "套餐目录", children: <CatalogPane /> },
        { key: "delivery", label: "交付管理", children: <DeliveryPane /> },
      ]}
    />
  );
}

/* ---------------------------------------------------------------- 交付项编辑器 */

type AssignmentMode = "PRESET" | "MANUAL";

/**
 * 交付项编辑：先定「预设服务商 / 人工分配」，再配交付项。
 * - 预设：每项当场选定服务商（服务商下拉按该码的已备案名录拉取），可选购买后自动发起；
 *   自动发起只生成「待确认」签约，仍须服务商确认后才生效；
 * - 人工分配：这里只配类目，订单产生后再到「交付管理」逐项匹配。
 */
function DeliveryItemsEditor({
  value = [],
  onChange,
  mode = "MANUAL",
}: {
  value?: DeliveryDraft[];
  onChange?: (rows: DeliveryDraft[]) => void;
  mode?: AssignmentMode;
}) {
  const [optionsByCode, setOptionsByCode] = useState<
    Record<string, ServicePackageCandidate[]>
  >({});
  const rows = value;

  const loadCandidates = async (code: string) => {
    if (!code) return;
    try {
      const list = await servicePackagesAdminApi.candidates(code);
      setOptionsByCode((prev) => ({ ...prev, [code]: list }));
    } catch {
      // 名录取失败不阻断表单，仅下拉为空（保存后仍可人工匹配）
    }
  };

  const update = (index: number, patch: Partial<DeliveryDraft>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange?.(next);
  };

  const providerOptions = (row: DeliveryDraft) => {
    const base = (optionsByCode[row.code] || []).map((c) => ({
      value: c.providerUserId,
      label: c.orgName || c.displayName || c.providerUserId,
    }));
    if (
      row.providerUserId &&
      !base.some((opt) => opt.value === row.providerUserId)
    ) {
      base.unshift({
        value: row.providerUserId,
        label: row.providerOrg || row.providerUserId,
      });
    }
    return base;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row, index) => (
        <div key={index} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Select
            style={{ width: 180 }}
            placeholder="交付项 / 细项"
            value={row.code || undefined}
            options={DELIVERY_CODE_GROUPS}
            showSearch
            optionFilterProp="label"
            onChange={(code: string) => {
              update(index, {
                code,
                label: deliveryCodeLabel(code),
                providerUserId: "",
                providerOrg: "",
              });
              void loadCandidates(code);
            }}
          />
          {mode === "PRESET" ? (
            <Select
              style={{ width: 240 }}
              placeholder="选择预设服务商"
              allowClear
              showSearch
              optionFilterProp="label"
              value={row.providerUserId || undefined}
              options={providerOptions(row)}
              onOpenChange={(open) => {
                if (open && row.code) void loadCandidates(row.code);
              }}
              onChange={(providerUserId: string | undefined) => {
                const hit = (optionsByCode[row.code] || []).find(
                  (c) => c.providerUserId === providerUserId,
                );
                update(index, {
                  providerUserId: providerUserId || "",
                  providerOrg: providerUserId
                    ? hit?.orgName || hit?.displayName || row.providerOrg || ""
                    : "",
                });
              }}
            />
          ) : (
            <span
              className="text-12 muted"
              style={{ width: 240, lineHeight: "32px" }}
            >
              订单产生后在「交付管理」分配服务商
            </span>
          )}
          <Button
            danger
            onClick={() => onChange?.(rows.filter((_, i) => i !== index))}
          >
            移除
          </Button>
        </div>
      ))}
      <Button
        onClick={() =>
          onChange?.([
            ...rows,
            { code: "", label: "", providerUserId: "", providerOrg: "" },
          ])
        }
      >
        添加交付项
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- 套餐目录 */

function CatalogPane() {
  const { message } = App.useApp();
  const [board, setBoard] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServicePackageRow | null>(null);
  const [form] = Form.useForm();
  const { data, denied, loading, reload } = useAdminData(
    "service-packages",
    (signal) => servicePackagesAdminApi.list(board || undefined, { signal }),
    { board },
  );
  const save = useOperationMutation(
    (body: ServicePackageSaveBody) => servicePackagesAdminApi.save(body),
    ["service-packages", "*"],
  );
  const toggle = useOperationMutation(
    (args: { id: number; status: "ACTIVE" | "DISABLED" }) =>
      servicePackagesAdminApi.toggle(args.id, args.status),
    ["service-packages"],
  );
  const remove = useOperationMutation(
    (id: number) => servicePackagesAdminApi.remove(id),
    ["service-packages"],
  );
  const rate = data?.rate ?? 10;
  const priceYuan = Form.useWatch("priceCents", form);
  const formServiceType = Form.useWatch("serviceType", form);
  const assignmentMode = (Form.useWatch("assignmentMode", form) ||
    "MANUAL") as AssignmentMode;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      serviceType: board || "TAX_FINANCE",
      unit: "年",
      perEnterpriseLimit: 0,
      sortOrder: 0,
      status: "ACTIVE",
      assignmentMode: "MANUAL",
      autoInitiate: false,
      deliveryItems: [],
    });
    setOpen(true);
  };

  const openEdit = useCallback(
    (row: ServicePackageRow) => {
      setEditing(row);
      form.setFieldsValue({
        serviceType: row.serviceType,
        name: row.name,
        description: row.description,
        priceCents: row.price / 100,
        unit: row.unit,
        features: row.features.join("\n"),
        deliveryItems: (row.deliveryConfig || []).map((i) => ({ ...i })),
        deliveryDesc: row.deliveryDesc,
        assignmentMode: (row.deliveryConfig || []).some((i) => i.providerUserId)
          ? "PRESET"
          : "MANUAL",
        autoInitiate: row.autoInitiate,
        taxpayerType: row.taxpayerType || undefined,
        perEnterpriseLimit: row.perEnterpriseLimit,
        status: row.status,
        sortOrder: row.sortOrder,
      });
      setOpen(true);
    },
    [form],
  );

  const onSubmit = async (values: Record<string, unknown>) => {
    const deliveryItems = (
      (values.deliveryItems as DeliveryDraft[] | undefined) || []
    ).filter((i) => i.code);
    const mode = (values.assignmentMode as AssignmentMode) || "MANUAL";
    if (mode === "PRESET" && !deliveryItems.length) {
      message.error("预设服务商需先添加至少一个交付项");
      return;
    }
    if (mode === "PRESET" && deliveryItems.some((i) => !i.providerUserId)) {
      message.error("预设服务商模式下，请为每个交付项选择服务商");
      return;
    }
    const body: ServicePackageSaveBody = {
      id: editing?.id,
      serviceType: String(values.serviceType || ""),
      name: String(values.name || ""),
      description: String(values.description || ""),
      priceCents: Math.round(Number(values.priceCents || 0) * 100),
      unit: String(values.unit || "年"),
      features: String(values.features || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      deliveryItems: deliveryItems.map((i) => ({
        code: i.code,
        label: i.label || deliveryCodeLabel(i.code),
        providerUserId: mode === "PRESET" ? i.providerUserId || "" : "",
        providerOrg: mode === "PRESET" ? i.providerOrg || "" : "",
      })),
      deliveryDesc: String(values.deliveryDesc || ""),
      autoInitiate: mode === "PRESET" && Boolean(values.autoInitiate),
      taxpayerType:
        String(values.serviceType) === "TAX_FINANCE"
          ? (values.taxpayerType as string) || null
          : null,
      perEnterpriseLimit: Number(values.perEnterpriseLimit || 0),
      status: (values.status as "ACTIVE" | "DISABLED") || "ACTIVE",
      sortOrder: Number(values.sortOrder || 0),
    };
    try {
      await save.mutateAsync(body);
      message.success(editing ? "套餐已更新" : "套餐已新增");
      setOpen(false);
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const columns = useMemo(
    () => [
      { title: "板块", width: 110, render: (_: unknown, row: ServicePackageRow) => boardLabel(row.serviceType) },
      { title: "套餐名", dataIndex: "name", render: (v: string) => <strong>{v}</strong> },
      {
        title: "人民币价",
        width: 120,
        render: (_: unknown, row: ServicePackageRow) => `${fmtYuan(row.priceCents)} / ${row.unit}`,
      },
      {
        title: "积分价",
        width: 150,
        render: (_: unknown, row: ServicePackageRow) => (
          <span className="text-12">
            {fmtPoints(row.pointsPrice)} 积分
            <span className="muted">（汇率 {rate}）</span>
          </span>
        ),
      },
      {
        title: "交付项",
        width: 220,
        render: (_: unknown, row: ServicePackageRow) =>
          row.deliveryItems.length ? (
            <span className="text-12">
              {row.deliveryItems.map((i) => i.label).join("、")}
            </span>
          ) : (
            <span className="muted text-12">未配置</span>
          ),
      },
      {
        title: "分配方式",
        width: 200,
        render: (_: unknown, row: ServicePackageRow) => {
          const preset = (row.deliveryConfig || []).some((i) => i.providerUserId);
          return preset ? (
            <span className="text-12">
              <span className="badge badge-green">预设服务商</span>
              {row.autoInitiate ? <span className="muted"> · 自动发起（待服务商确认）</span> : null}
            </span>
          ) : (
            <span className="badge badge-gray">人工分配</span>
          );
        },
      },
      {
        title: "状态",
        width: 90,
        render: (_: unknown, row: ServicePackageRow) =>
          row.status === "ACTIVE" ? (
            <span className="badge badge-green">已上架</span>
          ) : (
            <span className="badge badge-gray">已下架</span>
          ),
      },
      {
        title: "操作",
        width: 220,
        render: (_: unknown, row: ServicePackageRow) => (
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="small" onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Button
              size="small"
              onClick={() =>
                void toggle
                  .mutateAsync({
                    id: row.id,
                    status: row.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                  })
                  .then(() => reload())
                  .catch((error) =>
                    presentMutationError(error, (text) => message.error(text)),
                  )
              }
            >
              {row.status === "ACTIVE" ? "下架" : "上架"}
            </Button>
            <Popconfirm
              title="删除该套餐？"
              description="历史采购订单已快照套餐信息，删除目录不影响已购订单与交付。"
              onConfirm={() =>
                void remove
                  .mutateAsync(row.id)
                  .then(() => {
                    message.success("套餐已删除");
                    return reload();
                  })
                  .catch((error) =>
                    presentMutationError(error, (text) => message.error(text)),
                  )
              }
            >
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </div>
        ),
      },
    ],
    [rate, toggle, remove, reload, message, openEdit],
  );

  const pointsPreview =
    priceYuan === undefined || priceYuan === null
      ? 0
      : Number((Number(priceYuan) * rate).toFixed(4));

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="套餐目录"
        titleBadge={<span className="text-12 muted">{PLATFORM_DELIVERY_NOTICE}</span>}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Select
              allowClear
              placeholder="全部板块"
              style={{ width: 150 }}
              value={board || undefined}
              onChange={(value) => setBoard(value || "")}
              options={BOARD_OPTIONS}
            />
            <Button type="primary" onClick={openCreate}>
              新增套餐
            </Button>
          </div>
        }
      >
        <div className="table-wrap">
          <Table<ServicePackageRow>
            rowKey="id"
            loading={loading}
            dataSource={data?.list ?? []}
            size="middle"
            pagination={false}
            locale={{ emptyText: <EmptyState text="暂无服务套餐，点击「新增套餐」上架" /> }}
            columns={columns}
          />
        </div>
      </Panel>

      <Modal
        title={editing ? "编辑套餐" : "新增套餐"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} style={{ marginTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="serviceType" label="板块" rules={[{ required: true }]}>
              <Select options={BOARD_OPTIONS} />
            </Form.Item>
            <Form.Item name="name" label="套餐名" rules={[{ required: true, max: 120 }]}>
              <Input maxLength={120} placeholder="如：小规模纳税人记账报税服务包" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="简介" rules={[{ max: 500 }]}>
            <Input.TextArea rows={2} maxLength={500} placeholder="一句话说明套餐覆盖范围" />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item
              name="priceCents"
              label="人民币价（元）"
              rules={[{ required: true }]}
              extra={`积分价预览：${fmtPoints(pointsPreview)} 积分（按当前官方汇率 1 元 = ${rate} 积分）`}
            >
              <InputNumber min={0} precision={2} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="unit"
              label="计价单位"
              initialValue="年"
              extra="仅用于价格展示，套餐不参与交付周期与到期管理。"
            >
              <Input maxLength={16} placeholder="年 / 次 / 月" />
            </Form.Item>
          </div>
          <Form.Item name="features" label="包含服务（每行一项）">
            <Input.TextArea rows={4} placeholder={"增值税及附加税\n企业所得税\n…"} />
          </Form.Item>
          <Form.Item
            name="assignmentMode"
            label="服务商分配方式"
            initialValue="MANUAL"
            extra="先定方式：预设服务商＝现在为每个交付项选定服务商，购买后只自动发起，仍需服务商确认后生效；人工分配＝这里只配交付项，订单产生后再到「交付管理」逐项匹配。"
          >
            <Segmented
              options={[
                { value: "PRESET", label: "预设服务商" },
                { value: "MANUAL", label: "人工分配" },
              ]}
              onChange={(value) => {
                if (value !== "MANUAL") return;
                const rows =
                  (form.getFieldValue("deliveryItems") as DeliveryDraft[] | undefined) || [];
                form.setFieldsValue({
                  deliveryItems: rows.map((row) => ({
                    ...row,
                    providerUserId: "",
                    providerOrg: "",
                  })),
                  autoInitiate: false,
                });
              }}
            />
          </Form.Item>
          <Form.Item
            name="deliveryItems"
            label="交付项（平台整合的服务商签约项）"
            extra={
              assignmentMode === "PRESET"
                ? "每个交付项对应一次平台主持的服务商签约，请为每项选定预设服务商；预设不等于确认，服务商确认后签约才生效。"
                : "每个交付项对应一次平台主持的服务商签约；订单产生后到「交付管理」匹配服务商并发起。"
            }
          >
            <DeliveryItemsEditor mode={assignmentMode} />
          </Form.Item>
          <Form.Item name="deliveryDesc" label="交付说明" rules={[{ max: 500 }]}>
            <Input.TextArea rows={2} maxLength={500} placeholder="补充说明，如交付周期、验收方式" />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="taxpayerType" label="纳税人档（仅财税）">
              {formServiceType === "TAX_FINANCE" ? (
                <Select
                  allowClear
                  placeholder="用于「您的适用档」匹配"
                  options={[
                    { value: "SMALL", label: "小规模纳税人" },
                    { value: "GENERAL", label: "一般纳税人" },
                  ]}
                />
              ) : (
                <Input disabled placeholder="仅财税套餐可选" />
              )}
            </Form.Item>
            <Form.Item
              name="perEnterpriseLimit"
              label="每企业限购（0 = 不限）"
              initialValue={0}
              extra="按采购企业档案计数，同一企业的多个账号共享额度。"
            >
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="status" label="状态" initialValue="ACTIVE">
              <Select
                options={[
                  { value: "ACTIVE", label: "上架" },
                  { value: "DISABLED", label: "下架" },
                ]}
              />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序（越小越靠前）" initialValue={0}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </div>
          {assignmentMode === "PRESET" ? (
            <Form.Item
              name="autoInitiate"
              label="购买后自动发起签约（仍需服务商确认）"
              valuePropName="checked"
              initialValue={false}
              extra="开启后购买即按预设服务商发起「待确认」签约，绝不代服务商确认；关闭则先落单，由管理员在「交付管理」发起。"
            >
              <Switch />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- 交付管理 */

type MatchState = {
  item: ServicePackageOrderItem;
  orderId: number;
  mode: "assign" | "replace";
};

function DeliveryPane() {
  const { message } = App.useApp();
  const [board, setBoard] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [matchOptions, setMatchOptions] = useState<ServicePackageCandidate[]>([]);
  const [matchProvider, setMatchProvider] = useState("");
  const [refundTarget, setRefundTarget] = useState<{
    order: ServicePackageOrder;
    full: boolean;
  } | null>(null);
  const [refundAmount, setRefundAmount] = useState<number | null>(null);
  const [refundRemark, setRefundRemark] = useState("");
  const { data, denied, loading, reload } = useAdminData(
    "service-package-orders",
    (signal) =>
      servicePackagesAdminApi.orders(
        {
          serviceType: board || undefined,
          fulfillmentStatus: status || undefined,
          keyword: keyword || undefined,
          page,
          size: 20,
        },
        { signal },
      ),
    { board, status, keyword, page },
  );
  const assign = useOperationMutation(
    (args: { itemId: number; providerUserId: string }) =>
      servicePackagesAdminApi.assign(args.itemId, args.providerUserId),
    ["service-package-orders"],
  );
  const initiate = useOperationMutation(
    (orderId: number) => servicePackagesAdminApi.initiate(orderId),
    ["service-package-orders", "*"],
  );
  const replace = useOperationMutation(
    (args: { itemId: number; providerUserId: string }) =>
      servicePackagesAdminApi.replace(args.itemId, args.providerUserId),
    ["service-package-orders", "*"],
  );
  const refund = useOperationMutation(
    (args: { orderId: number; amount?: number; remark?: string }) =>
      servicePackagesAdminApi.refund(args.orderId, {
        amount: args.amount,
        remark: args.remark,
      }),
    ["service-package-orders", "*"],
  );

  const openMatch = async (item: ServicePackageOrderItem, orderId: number, mode: "assign" | "replace") => {
    setMatch({ item, orderId, mode });
    setMatchProvider("");
    setMatchOptions([]);
    try {
      const list = await servicePackagesAdminApi.candidates(item.code);
      setMatchOptions(list);
    } catch (error) {
      presentMutationError(error, (text) => message.error(text));
    }
  };

  const confirmMatch = async () => {
    if (!match || !matchProvider) return;
    try {
      if (match.mode === "assign") {
        await assign.mutateAsync({ itemId: match.item.id, providerUserId: matchProvider });
        message.success("已匹配服务商，可在订单「主持发起签约」");
      } else {
        await replace.mutateAsync({ itemId: match.item.id, providerUserId: matchProvider });
        message.success("已更换服务商并重新发起签约");
      }
      setMatch(null);
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const onInitiate = async (order: ServicePackageOrder) => {
    try {
      const res = await initiate.mutateAsync(order.id);
      if (res.failed.length) {
        message.warning(
          `已发起 ${res.initiated} 项；失败 ${res.failed.length} 项：${res.failed
            .map((f) => `${deliveryCodeLabel(f.code)}（${f.message}）`)
            .join("；")}`,
        );
      } else {
        message.success(`已主持发起 ${res.initiated} 项签约，等待服务商确认`);
      }
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const openRefund = (order: ServicePackageOrder, full: boolean) => {
    setRefundTarget({ order, full });
    setRefundAmount(full ? order.refundableAmount : null);
    setRefundRemark("");
  };

  const confirmRefund = async () => {
    if (!refundTarget) return;
    const amount = refundTarget.full
      ? refundTarget.order.refundableAmount
      : Number(refundAmount || 0);
    if (!(amount > 0)) {
      message.warning("请输入退款积分");
      return;
    }
    try {
      const res = await refund.mutateAsync({
        orderId: refundTarget.order.id,
        amount,
        remark: refundRemark,
      });
      message.success(
        res.status === "REFUNDED"
          ? `已整单退款 ${fmtPoints(res.refunded)} 积分并关闭订单`
          : `已部分退款 ${fmtPoints(res.refunded)} 积分，剩余可退 ${fmtPoints(res.remaining)} 积分`,
      );
      setRefundTarget(null);
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const renderItems = (order: ServicePackageOrder) => (
    <div style={{ padding: "4px 0" }}>
      <Table<ServicePackageOrderItem>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={order.items}
        locale={{ emptyText: <EmptyState text="该订单未配置交付项" /> }}
        columns={[
          {
            title: "交付项",
            width: 160,
            render: (_, item) => item.label || deliveryCodeLabel(item.code),
          },
          {
            title: "服务商",
            width: 200,
            render: (_, item) =>
              item.providerUserId ? (
                <span className="text-12">{item.providerName || item.providerOrg || item.providerUserId}</span>
              ) : (
                <span className="muted text-12">未匹配</span>
              ),
          },
          {
            title: "交付进度",
            width: 160,
            render: (_, item) => (
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {badge(ITEM_STATE, item.state)}
                {item.pendingHours >= 24 ? (
                  <span className="badge badge-red">待确认 {item.pendingHours}h</span>
                ) : null}
              </span>
            ),
          },
          {
            title: "签约单",
            width: 150,
            render: (_, item) =>
              item.contractNo ? <span className="mono text-12">{item.contractNo}</span> : <span className="muted text-12">—</span>,
          },
          {
            title: "操作",
            render: (_, item) => {
              if (order.fulfillmentStatus === "CLOSED") return <span className="muted text-12">订单已关闭</span>;
              const canMatch = item.state === "PENDING_MATCH" || item.state === "PENDING_INITIATE";
              const canReplace = item.state === "PENDING_INITIATE" || item.state === "SIGNING" || item.state === "TERMINATED" || item.state === "ACTIVE";
              return (
                <div style={{ display: "flex", gap: 8 }}>
                  {canMatch ? (
                    <Button size="small" onClick={() => void openMatch(item, order.id, "assign")}>
                      {item.state === "PENDING_INITIATE" ? "改派服务商" : "匹配服务商"}
                    </Button>
                  ) : null}
                  {canReplace && item.contractId ? (
                    <Button size="small" onClick={() => void openMatch(item, order.id, "replace")}>
                      更换服务商
                    </Button>
                  ) : null}
                </div>
              );
            },
          },
        ]}
      />
    </div>
  );

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="交付管理"
        titleBadge={<span className="text-12 muted">采购订单队列：逐项匹配服务商并主持发起签约，跟踪生效</span>}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Select
              allowClear
              placeholder="全部板块"
              style={{ width: 140 }}
              value={board || undefined}
              onChange={(value) => {
                setBoard(value || "");
                setPage(1);
              }}
              options={BOARD_OPTIONS}
            />
            <Select
              allowClear
              placeholder="全部交付状态"
              style={{ width: 140 }}
              value={status || undefined}
              onChange={(value) => {
                setStatus(value || "");
                setPage(1);
              }}
              options={Object.entries(FULFILLMENT_STATUS).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
            />
            <Input
              allowClear
              placeholder="按企业名筛选"
              style={{ width: 160 }}
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value.trim());
                setPage(1);
              }}
            />
          </div>
        }
      >
        <div className="table-wrap">
          <Table<ServicePackageOrder>
            rowKey="id"
            loading={loading}
            dataSource={data?.list ?? []}
            size="middle"
            expandable={{ expandedRowRender: renderItems }}
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            locale={{ emptyText: <EmptyState text="暂无套餐采购订单" /> }}
            columns={[
              {
                title: "订单号",
                width: 190,
                render: (_, row) => <span className="mono text-12">{row.orderNo}</span>,
              },
              { title: "企业", width: 180, render: (_, row) => row.enterpriseName || `#${row.enterpriseId}` },
              { title: "套餐", width: 200, render: (_, row) => row.packageName },
              { title: "板块", width: 100, render: (_, row) => boardLabel(row.serviceType) },
              { title: "积分", width: 110, render: (_, row) => fmtPoints(row.pointsAmount) },
              {
                title: "退款",
                width: 150,
                render: (_, row) =>
                  row.status === "REFUNDED" ? (
                    <span className="badge badge-red">
                      已全额退款 {fmtPoints(row.refundedPointsAmount)}
                    </span>
                  ) : row.refundedPointsAmount > 0 ? (
                    <div className="text-12">
                      <span className="badge badge-orange">
                        已退 {fmtPoints(row.refundedPointsAmount)}
                      </span>
                      <div className="muted" style={{ marginTop: 4 }}>
                        可退 {fmtPoints(row.refundableAmount)}
                      </div>
                    </div>
                  ) : (
                    <span className="muted text-12">—</span>
                  ),
              },
              {
                title: "交付状态",
                width: 110,
                render: (_, row) => badge(FULFILLMENT_STATUS, row.fulfillmentStatus),
              },
              {
                title: "采购时间",
                width: 160,
                render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
              },
              {
                title: "操作",
                width: 300,
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {row.fulfillmentStatus !== "CLOSED" && row.fulfillmentStatus !== "DELIVERED" ? (
                      <Button size="small" type="primary" onClick={() => void onInitiate(row)} loading={initiate.isPending}>
                        主持发起签约
                      </Button>
                    ) : null}
                    {row.status !== "REFUNDED" &&
                    row.fulfillmentStatus !== "CLOSED" &&
                    row.refundableAmount > 0 ? (
                      <>
                        <Button size="small" onClick={() => openRefund(row, false)}>
                          部分退款
                        </Button>
                        <Button size="small" danger onClick={() => openRefund(row, true)}>
                          整单退款
                        </Button>
                      </>
                    ) : (
                      <span className="muted text-12">
                        {row.status === "REFUNDED" ? "已全额退款" : "已关闭"}
                      </span>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        title={match?.mode === "replace" ? "更换服务商（原 Offer 撤销后重新发起）" : "匹配服务商"}
        open={Boolean(match)}
        onCancel={() => setMatch(null)}
        onOk={() => void confirmMatch()}
        okButtonProps={{ disabled: !matchProvider, loading: assign.isPending || replace.isPending }}
        destroyOnHidden
      >
        <p className="text-12 muted">
          交付项：{match ? match.item.label || deliveryCodeLabel(match.item.code) : ""}
          （仅列出已备案且承接该细项的优质服务商）
        </p>
        <Select
          style={{ width: "100%" }}
          placeholder="选择服务商"
          showSearch
          optionFilterProp="label"
          value={matchProvider || undefined}
          onChange={setMatchProvider}
          options={matchOptions.map((c) => ({
            value: c.providerUserId,
            label: `${c.orgName || c.displayName}${c.city ? ` · ${c.city}` : c.province ? ` · ${c.province}` : ""}`,
          }))}
        />
        {match?.mode === "replace" ? (
          <Notice variant="info">
            已生效且有业务单据的原签约不可直接更换，请解约后线下处理。
          </Notice>
        ) : null}
      </Modal>

      <Modal
        title={refundTarget?.full ? "整单退款" : "部分退款"}
        open={Boolean(refundTarget)}
        onCancel={() => setRefundTarget(null)}
        onOk={() => void confirmRefund()}
        okText={refundTarget?.full ? "确认整单退款" : "确认部分退款"}
        okButtonProps={{
          danger: refundTarget?.full,
          loading: refund.isPending,
          disabled: refundTarget?.full
            ? false
            : !(Number(refundAmount) > 0),
        }}
        destroyOnHidden
      >
        {refundTarget ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="text-12">
              <div>
                订单：<span className="mono">{refundTarget.order.orderNo}</span>
                （{refundTarget.order.packageName}）
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                已付 {fmtPoints(refundTarget.order.pointsAmount)} 积分 · 已退{" "}
                {fmtPoints(refundTarget.order.refundedPointsAmount)} 积分 · 剩余可退{" "}
                {fmtPoints(refundTarget.order.refundableAmount)} 积分
              </div>
            </div>
            {refundTarget.full ? (
              <Notice variant="warn">
                整单退款将关闭订单，并撤销全部待确认签约；已有生效签约的订单不可整单退款。
                本次退回 {fmtPoints(refundTarget.order.refundableAmount)} 积分。
              </Notice>
            ) : (
              <>
                <div>
                  <div className="text-12" style={{ marginBottom: 6 }}>
                    退款积分
                  </div>
                  <InputNumber
                    min={0.0001}
                    max={refundTarget.order.refundableAmount}
                    precision={4}
                    style={{ width: "100%" }}
                    value={refundAmount}
                    onChange={(value) => setRefundAmount(value)}
                    placeholder={`最多可退 ${fmtPoints(refundTarget.order.refundableAmount)} 积分`}
                  />
                </div>
                <Notice variant="info">
                  部分退款只回补积分，订单与交付继续保留；输入剩余全部金额时将按整单退款处理。
                </Notice>
              </>
            )}
            <div>
              <div className="text-12" style={{ marginBottom: 6 }}>
                退款备注（可选）
              </div>
              <Input.TextArea
                rows={2}
                maxLength={200}
                value={refundRemark}
                onChange={(event) => setRefundRemark(event.target.value)}
                placeholder="说明退款原因，便于后续对账"
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}