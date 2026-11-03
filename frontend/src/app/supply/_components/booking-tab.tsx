"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { supplyApi } from "@/api/supply";
import {
  useSupplyBookings,
  useProviderStaff,
  useSupplyLogs,
  useSupplyBookingNote,
} from "@/query/workspaces";

import { CalendarOutlined, HistoryOutlined } from "@ant-design/icons";
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
  feeText,
  fmtTime,
  money,
  providerContactText,
  providerLabel,
  staffLabel,
  toDateText,
  type SupplyBooking,
  type SupplyContract,
  type SupplyFeeEntry,
  type SupplyOrderLog,
  type SupplyService,
} from "./common";

type FeeRow = { name: string; amount: number; note: string };

/** 需填原因的单据动作（确认 / 驳回 / 否决 / 取消）。 */
type NoteAction = "confirm" | "return" | "veto" | "cancel";

const NOTE_ACTION_TEXT: Record<
  NoteAction,
  { title: string; label: string; tip: string; danger: boolean }
> = {
  confirm: {
    title: "确认报价 · 服务订单生效",
    label: "确认备注",
    tip: "确认后服务订单生效，服务商按计划时间上门履约。",
    danger: false,
  },
  return: {
    title: "驳回报价 · 退回服务商重新报价",
    label: "驳回原因",
    tip: "驳回后服务商可二次修改报价（服务费/其他费用）再提交。",
    danger: false,
  },
  veto: {
    title: "否决预约单",
    label: "否决原因",
    tip: "否决后预约单终止流转，不可再报价；如需服务请重新预约。",
    danger: true,
  },
  cancel: {
    title: "取消预约单",
    label: "取消原因",
    tip: "取消后预约单终止流转；草稿可直接删除。",
    danger: true,
  },
};

/**
 * 服务预约页签（需求 §三/§五：线下服务预约流程）：
 * - 用户：发起预约单（选择服务项目 + 计划服务时间 + 作业地点）→ 提交 → 确认或驳回报价；
 * - 服务商账号：指派承办职员，或本人直接报价；
 * - 承办职员：报价（基础服务费 + 其他费用科目）；
 * - 全流程操作留痕。
 */
export function BookingTab({
  services,
  contracts,
  identity,
  panelTitle,
  switcher,
}: {
  services: SupplyService[];
  contracts: SupplyContract[];
  reload: () => Promise<void> | void;
  identity: SupplyIdentity;
  /** 企业侧「服务采购」栏目内的单据列表标题。 */
  panelTitle?: string;
  /** 企业侧「服务采购」栏目内的子视图切换器（可约服务项目 / 我的服务预约单）。 */
  switcher?: ReactNode;
}) {
  const supply_createBookingMutation = useOperationMutation(
    supplyApi.createBooking,
    ["supply", "dashboard"],
  );
  const supply_updateBookingMutation = useOperationMutation(
    supplyApi.updateBooking,
    ["supply", "dashboard"],
  );
  const supply_submitBookingMutation = useOperationMutation(
    supplyApi.submitBooking,
    ["supply", "dashboard"],
  );
  const supply_removeBookingMutation = useOperationMutation(
    supplyApi.removeBooking,
    ["supply", "dashboard"],
  );
  const supply_quoteBookingMutation = useOperationMutation(
    supplyApi.quoteBooking,
    ["supply", "dashboard"],
  );
  const supply_assignBookingMutation = useOperationMutation(
    supplyApi.assignBooking,
    ["supply", "dashboard"],
  );

  const [page, setPage] = useState(1);
  const listQuery = useSupplyBookings(page);
  const rows = listQuery.data?.list ?? [];
  const loading = listQuery.isPending;

  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const { me } = useSession();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplyBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<SupplyBooking | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<SupplyBooking | null>(null);
  const [baseAmount, setBaseAmount] = useState(0);
  const [quoteFees, setQuoteFees] = useState<FeeRow[]>([]);
  const [quoteNote, setQuoteNote] = useState("");
  const [quoteContactName, setQuoteContactName] = useState("");
  const [quoteContactPhone, setQuoteContactPhone] = useState("");
  const [assignTarget, setAssignTarget] = useState<SupplyBooking | null>(null);

  const [pickedStaff, setPickedStaff] = useState("");
  const [logTarget, setLogTarget] = useState<SupplyBooking | null>(null);
  const staffQuery = useProviderStaff(assignTarget !== null);
  const staff = staffQuery.data ?? [];
  const logsQuery = useSupplyLogs("bookings", logTarget?.id ?? null);
  const logs = logsQuery.data ?? [];
  const logsLoading = logsQuery.isPending;
  const noteMutation = useSupplyBookingNote();
  const [noteAction, setNoteAction] = useState<{
    action: NoteAction;
    row: SupplyBooking;
  } | null>(null);
  const [noteText, setNoteText] = useState("");

  const canEnterpriseAct = (row: SupplyBooking) =>
    identity.isAdmin ||
    row.createdBy === identity.meUserId ||
    identity.isEnterprise;
  const canQuote = (row: SupplyBooking) =>
    identity.isAdmin ||
    (row.staffUserId
      ? row.staffUserId === identity.meUserId
      : identity.isProvider && row.providerUserId === identity.meUserId);
  const canAssign = (row: SupplyBooking) =>
    identity.isAdmin ||
    (identity.isProvider && row.providerUserId === identity.meUserId);

  const providerText = (userId: string) =>
    providerLabel(contracts, userId, identity.meUserId, identity.selfName);

  /** 预约联系人预填：取当前用户档案（可改）；报价联系人预填：取当前操作人档案。 */
  const contactDefaults = () => {
    const contact = enterpriseContactDefaults(me);
    return { contact_name: contact.name, contact_phone: contact.phone };
  };
  const quoteContactDefaults = () => providerContactDefaults(me);

  const signedProviders = contracts
    .filter(
      (item) =>
        item.serviceType === "SUPPLY_NETWORK" && item.status === "ACTIVE",
    )
    .map((item) => item.providerUserId || "");
  /** 可预约服务：企业侧只列已签「供销服务」的服务商在售服务。 */
  const availableServices = services.filter(
    (item) =>
      item.status === "ONLINE" &&
      (identity.isAdmin ||
        !identity.isEnterprise ||
        signedProviders.includes(item.providerUserId)),
  );

  const serviceLabel = (row: SupplyBooking) =>
    row.serviceName ||
    services.find((item) => item.id === row.serviceId)?.name ||
    `服务 #${row.serviceId}`;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(contactDefaults());
    setOpen(true);
  };

  const openEdit = (row: SupplyBooking) => {
    setEditing(row);
    form.setFieldsValue({
      service_id: row.serviceId,
      plan_date: row.planDate,
      site_address: row.siteAddress,
      scale: row.scale,
      remark: row.remark,
      contact_name: row.contactName || "",
      contact_phone: row.contactPhone || "",
    });
    setOpen(true);
  };

  const submitBooking = async (draft: boolean) => {
    try {
      const values = await form.validateFields();
      const body = {
        service_id: Number(values.service_id || 0),
        plan_date: toDateText(values.plan_date),
        site_address: values.site_address || "",
        scale: values.scale || "",
        remark: values.remark || "",
        contact_name: values.contact_name || "",
        contact_phone: values.contact_phone || "",
        draft,
      };
      setBusy(true);
      try {
        if (!editing) {
          const payload = await supply_createBookingMutation.mutateAsync({
            body: body,
          });

          const data = payload;
          message.success(
            draft
              ? `草稿已保存（${data?.booking_no || ""}），可在列表「提交」`
              : `预约单已提交（${data?.booking_no || ""}），待服务商报价`,
          );
          setOpen(false);

          return;
        }
        const target = editing;
        await supply_updateBookingMutation.mutateAsync({
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

  const doSubmit = (row: SupplyBooking) => {
    Modal.confirm({
      title: "提交预约单",
      content: `确认提交「${row.bookingNo}」？提交后服务商（或承办职员）将按服务项目报价。`,
      okText: "确认提交",
      cancelText: "取消",
      onOk: async () => {
        await supply_submitBookingMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("已提交，待报价");
      },
    });
  };

  const removeBooking = (row: SupplyBooking) => {
    requestPassword({
      title: "删除预约单",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.bookingNo}」？仅草稿、已否决、已取消的单据可删除。`,
      onOk: async () => {
        await supply_removeBookingMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("预约单已删除");
        setDetail(null);
      },
    });
  };

  const submitNoteAction = async () => {
    if (!noteAction) return;
    const { action, row } = noteAction;
    if ((action === "veto" || action === "cancel") && !noteText.trim()) {
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
    message.success(
      action === "confirm"
        ? "已确认报价，服务订单生效"
        : action === "return"
          ? "已驳回，退回服务商重新报价"
          : action === "veto"
            ? "已否决该预约单"
            : "已取消该预约单",
    );
    setNoteAction(null);
    setNoteText("");
    setDetail(null);
  };

  const openQuote = (row: SupplyBooking) => {
    setQuoteTarget(row);
    setBaseAmount(Number(row.baseAmount || 0));
    setQuoteFees(
      (row.otherFees || []).map((item: SupplyFeeEntry) => ({
        name: item.name || "",
        amount: Number(item.amount || 0),
        note: item.note || "",
      })),
    );
    setQuoteNote(row.quoteNote || "");
    const fallback = quoteContactDefaults();
    setQuoteContactName(row.providerContactName || fallback.name);
    setQuoteContactPhone(row.providerContactPhone || fallback.phone);
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
      if (!baseAmount) {
        message.warning("请填写基础服务费");
        return;
      }
      setBusy(true);
      try {
        const payload = await supply_quoteBookingMutation.mutateAsync({
          params: { id: String(quoteTarget.id) },
          body: {
            base_amount: baseAmount,
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

  const openAssign = (row: SupplyBooking) => {
    setAssignTarget(row);
    setPickedStaff(row.staffUserId || "");
  };

  const submitAssign = async () => {
    try {
      if (!assignTarget) return;
      await supply_assignBookingMutation.mutateAsync({
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

  const openLogs = (row: SupplyBooking) => setLogTarget(row);

  const feeAmount = quoteFees.reduce(
    (acc, item) => acc + Number(item.amount || 0),
    0,
  );

  return (
    <Panel
      title={panelTitle || "服务预约（线下服务预约单）"}
      extra={
        identity.isEnterprise || identity.isAdmin ? (
          <Button type="primary" onClick={openCreate}>
            ＋ 发起服务预约
          </Button>
        ) : null
      }
    >
      {switcher}
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        企业按服务项目发起预约单（计划服务时间 + 作业地点 + 规模）→
        服务商账号或其承办职员报价 （基础服务费 + 其他费用）→
        企业确认后服务订单生效；企业可驳回要求重新报价，也可否决/取消。
      </div>
      {listQuery.isError ? (
        <Notice variant="error">
          {listQuery.error.message}{" "}
          <Button onClick={() => void listQuery.refetch()}>重试</Button>
        </Notice>
      ) : null}
      <div className="table-wrap">
        <Table<SupplyBooking>
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
                icon={<CalendarOutlined aria-hidden />}
                text={
                  identity.isEnterprise
                    ? "暂无预约单。在「服务采购」选择签约服务商在售服务项目后，可在此发起预约单。"
                    : "暂无预约单。企业按服务项目发起预约后，将在此显示待报价单据。"
                }
              />
            ),
          }}
          columns={[
            {
              title: "预约单号",
              dataIndex: "bookingNo",
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
              title: "预约企业",
              dataIndex: "enterpriseName",
              width: 170,
              ellipsis: true,
            },
            {
              title: "服务商 / 服务站",
              width: 200,
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
              // 双方联系方式随单流转：企业侧看报价联系人、服务商侧看预约联系人（管理员看预约方）
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
              title: "服务项目",
              width: 180,
              render: (_, row) => (
                <span className="text-12">
                  {serviceLabel(row)}
                  {row.priceUnit ? `（按${row.priceUnit}）` : ""}
                </span>
              ),
            },
            {
              title: "计划服务时间",
              dataIndex: "planDate",
              width: 120,
              render: (value: string) => (
                <span className="text-12">{value || "—"}</span>
              ),
            },
            {
              title: "作业地点",
              dataIndex: "siteAddress",
              ellipsis: true,
              render: (value: string) => value || "—",
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
                    <Button danger onClick={() => removeBooking(row)}>
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
                  ? "修改预约单"
                  : "修改预约单并重新提交"
              } · ${editing.bookingNo}`
            : "发起服务预约"
        }
        width={720}
        okText={
          editing
            ? editing.status === "DRAFT"
              ? "保存"
              : "保存并重新提交"
            : "提交预约单"
        }
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setOpen(false)}
        onOk={() => void submitBooking(false)}
        footer={(origin) => (
          <Space size={8}>
            {origin}
            {!editing ? (
              <Button onClick={() => void submitBooking(true)}>存为草稿</Button>
            ) : null}
          </Space>
        )}
      >
        <Notice>
          预约单按服务项目发起：服务项目已绑定服务站与报价单位；提交后由服务商（或其承办职员）
          报价（基础服务费 + 其他费用），企业确认后生效。
        </Notice>
        <Form form={form} layout="vertical">
          <Form.Item
            name="service_id"
            label="服务项目 *（须与该服务商已签「供销服务」）"
            rules={[{ required: true, message: "请选择服务项目" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              disabled={Boolean(editing)}
              placeholder={
                availableServices.length
                  ? "选择服务项目"
                  : "暂无可预约服务：请先在「签约管理」与服务商签署供销服务"
              }
              options={availableServices.map((item) => ({
                value: item.id,
                label: `${item.name} · ¥${money(item.basePrice)}/${item.priceUnit || "次"} · ${providerText(item.providerUserId)}`,
              }))}
            />
          </Form.Item>
          <div className="form-2col">
            <Form.Item
              name="plan_date"
              label="计划服务时间 *"
              rules={[{ required: true, message: "请选择计划服务时间" }]}
            >
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-12" />
              ) : (
                <DatePicker style={{ width: "100%" }} />
              )}
            </Form.Item>
            <Form.Item name="scale" label="作业规模">
              <Input placeholder="如：120 亩 / 6 台次" />
            </Form.Item>
          </div>
          <Form.Item
            name="site_address"
            label="作业地点 *"
            rules={[{ required: true, message: "请填写作业地点" }]}
          >
            <Input placeholder="如：杭州市萧山区 XX 镇 XX 村东片农田" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item
              name="contact_name"
              label="预约联系人 *（随单提供给服务商，便于磋商）"
              rules={[{ required: true, message: "请填写预约联系人" }]}
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
            <Input placeholder="如：需提前 1 天现场勘查；早 6 点进场" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={`预约单详情 · ${detail?.bookingNo || ""}`}
        width={680}
        onCancel={() => setDetail(null)}
        footer={
          <Space size={8}>
            <Button onClick={() => void openLogs(detail as SupplyBooking)}>
              操作留痕
            </Button>
            <Button onClick={() => setDetail(null)}>关闭</Button>
          </Space>
        }
      >
        {detail ? (
          <div className="text-12 muted" style={{ lineHeight: 1.9 }}>
            <div>
              状态：
              <StatusBadge domain="supply" status={detail.status} />
              {detail.revision > 1 ? `（第 ${detail.revision} 版）` : ""}
            </div>
            <div>
              预约企业：{detail.enterpriseName || "—"} · 服务商：
              {providerText(detail.providerUserId)} · 服务站：
              {detail.stationName || "—"}
            </div>
            <div>
              服务项目：{serviceLabel(detail)}
              {detail.priceUnit ? `（按${detail.priceUnit}计价）` : ""}
            </div>
            <div>
              计划服务时间：{detail.planDate || "—"} · 作业地点：
              {detail.siteAddress || "—"} · 作业规模：{detail.scale || "—"}
            </div>
            <div>
              承办职员：
              {detail.staffName ||
                staffLabel(
                  detail.staffUserId,
                  identity.meUserId,
                  identity.selfName,
                )}
            </div>
            <div>
              预约联系人：{contactText(detail.contactName, detail.contactPhone)}{" "}
              · 报价联系人：{providerContactText(detail)}
            </div>
            <div>备注：{detail.remark || "—"}</div>
            <div>报价备注：{detail.quoteNote || "—"}</div>
            <div>
              基础服务费：¥{money(detail.baseAmount)} · 其他费用：
              {feeText(detail.otherFees)} · 费用合计：¥{money(detail.feeAmount)}{" "}
              · 报价总额：¥{money(detail.totalAmount)}
            </div>
            <div>企业意见：{detail.confirmNote || "—"}</div>
            <div>提交时间：{fmtTime(detail.createdAt)}</div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(quoteTarget)}
        title={`报价 · ${quoteTarget?.bookingNo || ""}`}
        width={720}
        okText="提交报价"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setQuoteTarget(null)}
        onOk={() => void submitQuote()}
      >
        <Notice>
          线下服务按项目整体报价：填写基础服务费、「其他费用科目」（如差旅、材料、加班等，
          正数增收、负数减免）与报价联系人，汇总即报价总额。
        </Notice>
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          预约方联系方式：
          {contactText(quoteTarget?.contactName, quoteTarget?.contactPhone)}
          {quoteTarget?.planDate ? ` · 计划服务 ${quoteTarget.planDate}` : ""}
          （报价前后可直接与对方电话磋商）
        </div>
        <Form layout="vertical">
          <Form.Item
            label={`基础服务费（元）${
              quoteTarget?.priceUnit
                ? ` · 报价单位：${quoteTarget.priceUnit}`
                : ""
            }`}
          >
            <Input
              type="number"
              value={String(baseAmount)}
              onChange={(event) => setBaseAmount(Number(event.target.value))}
            />
          </Form.Item>
          <Form.Item label="报价备注">
            <Input
              placeholder="如：报价含人工与设备，材料按实结算"
              value={quoteNote}
              onChange={(event) => setQuoteNote(event.target.value)}
            />
          </Form.Item>
        </Form>
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
                placeholder="费用名称，如 差旅费 / 上门费"
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
                placeholder="说明，如 按实际里程"
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
            本单据无其他费用（仅基础服务费）；如需差旅/材料等，点「＋
            添加费用」。
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
          基础服务费 ¥{money(baseAmount)} ＋ 其他费用 ¥{money(feeAmount)} ＝
          <span style={{ fontWeight: 600 }}>
            {" "}
            ¥{money(baseAmount + feeAmount)}
          </span>
        </div>
      </Modal>

      <Modal
        open={Boolean(assignTarget)}
        title={`指派承办职员 · ${assignTarget?.bookingNo || ""}`}
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
            ? `${NOTE_ACTION_TEXT[noteAction.action].label}（否决/取消必填）`
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
        title={`操作留痕 · ${logTarget?.bookingNo || ""}`}
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
