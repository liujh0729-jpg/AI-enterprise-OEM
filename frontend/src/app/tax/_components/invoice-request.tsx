"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { invoiceApi } from "@/api/invoice";

import { FileTextOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
} from "antd";
import type { TableProps } from "antd";
import { useEffect, useState } from "react";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { EmptyState, Notice, Panel, TabStrip } from "@/components/ui/panel";
import { StatusBadge } from "@/components/status-badge";
import {
  useInvoiceRequests,
  useInvoiceStats,
  useServedEnterprises,
} from "@/query/tax";

import {
  contactOf,
  contactText,
  stageEnterpriseContact,
  stageProviderContact,
} from "@/lib/contacts";
import { InvoiceItemsEditor } from "./invoice-items-editor";

type Option = { code: string; label: string };

const INVOICE_TYPES: Option[] = [
  { code: "04", label: "增值税普通发票" },
  { code: "01", label: "增值税专用发票" },
  { code: "03", label: "机动车销售统一发票" },
];
const BUYER_TYPES: Option[] = [
  { code: "1", label: "企业" },
  { code: "2", label: "个人" },
];

type Line = {
  goodsCode?: string;
  goodsName?: string;
  spec?: string;
  quantity?: number;
  price?: number;
  taxRate?: string;
};

type InvoiceRequest = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Invoice_list">["data"]
>[number];

const STATUS_TONE: Record<string, string> = {
  REQUESTED: "PENDING",
  ISSUING: "PENDING",
  SUBMITTED: "PENDING",
  ISSUE_UNKNOWN: "PENDING",
  ISSUED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
};

const TYPE_LABEL = (code: string) =>
  INVOICE_TYPES.find((item) => item.code === code)?.label || code;

/**
 * 开发票申请（需求 6.4）：
 * - 用户：填写购方与项目明细，**发起开票申请**，并可查看进度 / 撤回待审核申请；
 * - 服务商·财税承办人：审核申请，**通过即走企享云自动开票**，或驳回（须附原因）。
 */
export function InvoiceRequestPanel({
  mode,
  enterpriseId,
}: {
  mode: "ENTERPRISE" | "REVIEW";
  enterpriseId?: number;
}) {
  const invoice_createMutation = useOperationMutation(invoiceApi.create, [
    "invoice",
    "dashboard",
  ]);
  const invoice_approveMutation = useOperationMutation(invoiceApi.approve, [
    "invoice",
    "dashboard",
  ]);
  const invoice_rejectMutation = useOperationMutation(invoiceApi.reject, [
    "invoice",
    "dashboard",
  ]);
  const invoice_cancelMutation = useOperationMutation(invoiceApi.cancel, [
    "invoice",
    "dashboard",
  ]);

  const { message } = App.useApp();
  const [tab, setTab] = useState("PENDING");
  const [page, setPage] = useState(1);
  // 企业 id 只认正整数：平台 / 服务商账号没有企业档案时父组件传 0，契约会按 positive 拒绝。
  const scopedEnterpriseId =
    enterpriseId && enterpriseId > 0 ? enterpriseId : undefined;
  const requestsQuery = useInvoiceRequests(
    page,
    mode === "REVIEW" && tab === "PENDING" ? "REQUESTED" : "",
    scopedEnterpriseId,
  );
  const invoiceStats = useInvoiceStats(scopedEnterpriseId);
  const rows = requestsQuery.data?.list ?? [];
  const load = async () => {
    await requestsQuery.refetch();
  };
  const loading = requestsQuery.isPending;
  const [busy, setBusy] = useState("");
  const [form] = Form.useForm();
  const servedQuery = useServedEnterprises(
    mode === "ENTERPRISE" && !scopedEnterpriseId,
  );
  const serveOptions = (servedQuery.data ?? []).map((item) => ({
    id: Number(item.id),
    name: String(item.name ?? ""),
  }));
  const [rejecting, setRejecting] = useState<InvoiceRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detail, setDetail] = useState<InvoiceRequest | null>(null);

  /** 环节联系方式（系统自动带出，临时换人可改） */
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );

  const openContacts = (row: InvoiceRequest) => {
    const ent = contactOf(row, "contact");
    const prov = contactOf(row, "provider_contact");
    setContactTarget({
      resource: "invoice",
      id: row.id,
      no: row.reqNo,
      contactName: ent.name,
      contactPhone: ent.phone,
      providerContactName: prov.name,
      providerContactPhone: prov.phone,
      partyLabel: "企业侧（申请人）",
      providerLabel: "财税承办人",
    });
  };

  useEffect(() => {
    if (mode === "ENTERPRISE" && !scopedEnterpriseId && servedQuery.data?.length)
      form.setFieldValue("enterpriseId", Number(servedQuery.data[0].id));
  }, [mode, scopedEnterpriseId, form, servedQuery.data]);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setBusy("submit");
      try {
        await invoice_createMutation.mutateAsync({
          body: {
            enterpriseId: scopedEnterpriseId || values.enterpriseId,
            invoiceType: values.invoiceType || "04",
            buyerType: values.buyerType || "1",
            buyerName: values.buyerName,
            buyerTaxNo: values.buyerTaxNo || "",
            orderNo: values.orderNo || "",
            remark: values.remark || "",
            items: (values.items || []).map((item: Line) => ({
              goodsCode: item.goodsCode || "",
              goodsName: item.goodsName || "",
              spec: item.spec || "",
              quantity: Number(item.quantity ?? 1),
              price: Number(item.price ?? 0),
              taxRate: item.taxRate || "6",
            })),
          },
        });

        message.success("开票申请已提交，等待财税承办人审核后开具");
        form.resetFields([
          "buyerName",
          "buyerTaxNo",
          "orderNo",
          "remark",
          "items",
        ]);
        form.setFieldsValue({ items: [{ quantity: 1, taxRate: "6" }] });
      } finally {
        setBusy("");
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const approve = async (row: InvoiceRequest) => {
    try {
      setBusy(`approve-${row.id}`);
      try {
        await invoice_approveMutation.mutateAsync({
          params: { id: String(row.id) },
          body: {},
        });

        message.success("开票任务已提交，开票结果待企享云确认");
      } finally {
        setBusy("");
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const reject = async () => {
    try {
      if (!rejecting) return;
      if (!rejectReason.trim()) {
        message.error("驳回必须填写原因");
        return;
      }
      setBusy("reject");
      try {
        await invoice_rejectMutation.mutateAsync({
          params: { id: String(rejecting.id) },
          body: { reason: rejectReason.trim() },
        });

        message.success("已驳回");
        setRejecting(null);
        setRejectReason("");
      } finally {
        setBusy("");
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const cancel = async (row: InvoiceRequest) => {
    try {
      setBusy(`cancel-${row.id}`);
      try {
        await invoice_cancelMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("已撤回申请");
      } finally {
        setBusy("");
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const columns: TableProps<InvoiceRequest>["columns"] = [
    { title: "申请单号", dataIndex: "reqNo", width: 150 },
    {
      title: "企业",
      dataIndex: "enterpriseName",
      render: (value: string) => value || "—",
    },
    { title: "购方", dataIndex: "buyerName", render: (v: string) => v || "—" },
    {
      title: "发票类型",
      dataIndex: "invoiceType",
      render: (v: string) => TYPE_LABEL(v),
    },
    {
      title: "价税合计",
      render: (_, row) =>
        `￥${(Number(row.amount) + Number(row.tax)).toFixed(2)}`,
    },
    {
      title: "承办职员",
      dataIndex: "staffName",
      render: (value: string) => value || "—",
    },
    {
      title: "承办人联系方式（联系人/电话）",
      width: 190,
      ellipsis: true,
      render: (_, row) => (
        <span className="text-12">
          {contactText(
            row.providerContactName,
            row.providerContactPhone,
            "待指派",
          )}
        </span>
      ),
    },
    {
      title: "状态",
      render: (_, row) => (
        <StatusBadge
          status={STATUS_TONE[row.status] || row.status}
          text={row.statusLabel}
        />
      ),
    },
    {
      title: "操作",
      width: mode === "REVIEW" ? 300 : 270,
      render: (_, row) => (
        <Space size={6} wrap>
          <Button type="link" onClick={() => setDetail(row)}>
            详情
          </Button>
          <Button onClick={() => openContacts(row)}>改联系方式</Button>
          {row.canReview && row.status === "REQUESTED" ? (
            <>
              <Button
                type="primary"
                loading={busy === `approve-${row.id}`}
                onClick={() => void approve(row)}
              >
                通过并提交开票
              </Button>
              <Button danger onClick={() => setRejecting(row)}>
                驳回
              </Button>
            </>
          ) : null}
          {row.status === "REQUESTED" && row.canReview ? null : row.status ===
            "REQUESTED" ? (
            <Button
              loading={busy === `cancel-${row.id}`}
              onClick={() => void cancel(row)}
            >
              撤回
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const pendingTotal = invoiceStats.data?.byStatus.REQUESTED ?? 0;
  const total = invoiceStats.data?.total ?? 0;
  const visibleRows = rows;

  return (
    <>
      {requestsQuery.isError || servedQuery.isError ? (
        <Notice variant="error">
          {requestsQuery.error?.message || servedQuery.error?.message}{" "}
          <Button
            onClick={() => {
              void requestsQuery.refetch();
              if (mode === "ENTERPRISE" && !scopedEnterpriseId)
                void servedQuery.refetch();
            }}
          >
            重试
          </Button>
        </Notice>
      ) : null}
      {mode === "ENTERPRISE" ? (
        <Panel
          title={
            <>
              <FileTextOutlined aria-hidden /> 开发票申请
            </>
          }
          titleBadge="填写购方与项目明细提交后，由财税承办人审核并开具"
        >
          <Notice variant="info">
            开票由已签约财税服务商的承办人审核：审核通过后系统调用企享云自动开票；
            驳回会附原因。开具结果可在「已开发票」统一查询。
          </Notice>
          <Form
            form={form}
            layout="vertical"
            style={{ maxWidth: 880, marginTop: 12 }}
            initialValues={{
              enterpriseId: scopedEnterpriseId,
              invoiceType: "04",
              buyerType: "1",
              items: [{ quantity: 1, taxRate: "6" }],
            }}
          >
            <div className="form-2col">
              {!scopedEnterpriseId && serveOptions.length ? (
                <Form.Item
                  name="enterpriseId"
                  label="开票企业"
                  rules={[{ required: true, message: "请选择开票企业" }]}
                >
                  <Select
                    options={serveOptions.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                  />
                </Form.Item>
              ) : null}
              <Form.Item name="invoiceType" label="发票类型">
                <Select
                  options={INVOICE_TYPES.map((item) => ({
                    value: item.code,
                    label: `${item.code} · ${item.label}`,
                  }))}
                />
              </Form.Item>
              <Form.Item name="buyerType" label="购买方类型">
                <Select
                  options={BUYER_TYPES.map((item) => ({
                    value: item.code,
                    label: item.label,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="buyerName"
                label="购方名称"
                rules={[{ required: true, message: "请填写购方名称" }]}
              >
                <Input placeholder="购买方企业名称 / 个人姓名" />
              </Form.Item>
              <Form.Item name="buyerTaxNo" label="购方纳税人识别号">
                <Input placeholder="选填（个人可不填）" />
              </Form.Item>
              <Form.Item name="orderNo" label="来源订单编号">
                <Input placeholder="选填，留空由系统生成" />
              </Form.Item>
              <Form.Item name="remark" label="备注">
                <Input placeholder="选填" />
              </Form.Item>
            </div>

            <InvoiceItemsEditor />

            <div style={{ marginTop: 12 }}>
              <Button
                type="primary"
                loading={busy === "submit"}
                onClick={() => void submit()}
              >
                提交开票申请
              </Button>
            </div>
          </Form>
        </Panel>
      ) : null}

      <Panel
        title={
          mode === "REVIEW" ? (
            <>
              <FileTextOutlined aria-hidden /> 开票申请（审核）
            </>
          ) : (
            "我的开票申请"
          )
        }
        titleBadge={pendingTotal ? `待审核 ${pendingTotal} 张` : `${total} 张`}
        extra={
          <Button loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        {invoiceStats.isError ? (
          <Notice variant="error">
            统计加载失败：{invoiceStats.error.message}{" "}
            <Button onClick={() => void invoiceStats.refetch()}>重试</Button>
          </Notice>
        ) : null}
        {mode === "REVIEW" ? (
          <TabStrip
            value={tab}
            onChange={(value) => {
              setTab(value);
              setPage(1);
            }}
            items={[
              { key: "PENDING", label: "待审核", count: pendingTotal },
              { key: "ALL", label: "全部", count: total },
            ]}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <div className="table-wrap">
          <Table<InvoiceRequest>
            rowKey="id"
            loading={loading}
            pagination={{
              current: page,
              pageSize: 20,
              total: requestsQuery.data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            size="middle"
            dataSource={visibleRows}
            columns={columns}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<FileTextOutlined aria-hidden />}
                  text={
                    mode === "REVIEW"
                      ? "暂无开票申请：企业提交后在此审核并开具。"
                      : "还没有开票申请，填好上方表单提交即可。"
                  }
                />
              ),
            }}
          />
        </div>
      </Panel>

      <Modal
        open={Boolean(detail)}
        title={`开票申请详情 · ${detail?.reqNo || ""}`}
        width={640}
        onCancel={() => setDetail(null)}
        footer={[
          detail ? (
            <Button key="contacts" onClick={() => openContacts(detail)}>
              改联系方式
            </Button>
          ) : null,
          <Button key="close" onClick={() => setDetail(null)}>
            关闭
          </Button>,
        ]}
      >
        {detail ? (
          <>
            <div className="form-2col">
              <div>
                <div className="text-12 muted">企业</div>
                <div>{detail.enterpriseName || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">购方</div>
                <div>{detail.buyerName || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">购方税号</div>
                <div>{detail.buyerTaxNo || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">发票类型</div>
                <div>{TYPE_LABEL(detail.invoiceType)}</div>
              </div>
              <div>
                <div className="text-12 muted">来源订单编号</div>
                <div>{detail.orderNo || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">承办职员</div>
                <div>{detail.staffName || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">
                  企业侧联系方式（联系人/电话）
                </div>
                <div>{stageEnterpriseContact(detail)}</div>
              </div>
              <div>
                <div className="text-12 muted">
                  财税承办人联系方式（联系人/电话）
                </div>
                <div>{stageProviderContact(detail, "待指派")}</div>
              </div>
              <div>
                <div className="text-12 muted">状态</div>
                <div>{detail.statusLabel}</div>
              </div>
              <div>
                <div className="text-12 muted">价税合计</div>
                <div>
                  ￥{(Number(detail.amount) + Number(detail.tax)).toFixed(2)}
                </div>
              </div>
            </div>
            <div className="text-12 muted" style={{ margin: "12px 0 6px" }}>
              项目明细
            </div>
            <div className="table-wrap">
              <Table<Line>
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={(detail.items || []).map((item, index) => ({
                  ...item,
                  key: String(index),
                }))}
                columns={[
                  { title: "名称", dataIndex: "goodsName" },
                  { title: "规格", dataIndex: "spec", render: (v) => v || "—" },
                  { title: "数量", dataIndex: "quantity" },
                  { title: "单价", dataIndex: "price" },
                  {
                    title: "税率",
                    dataIndex: "taxRate",
                    render: (v) => `${v || "6"}%`,
                  },
                ]}
              />
            </div>
            {detail.rejectReason ? (
              <div className="text-12" style={{ marginTop: 10 }}>
                驳回原因：{detail.rejectReason}
              </div>
            ) : null}
            {detail.issueMessage ? (
              <div className="text-12 muted" style={{ marginTop: 10 }}>
                开票任务：{detail.issueCode} · {detail.issueMessage}
              </div>
            ) : null}
            {detail.issueTaskId ? (
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                企享云任务编号：{detail.issueTaskId}
              </div>
            ) : null}
            {detail.remark ? (
              <div className="text-12 muted" style={{ marginTop: 10 }}>
                备注：{detail.remark}
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(rejecting)}
        title={`驳回开票申请 · ${rejecting?.reqNo || ""}`}
        okText="确认驳回"
        cancelText="取消"
        confirmLoading={busy === "reject"}
        onCancel={() => {
          setRejecting(null);
          setRejectReason("");
        }}
        onOk={() => void reject()}
      >
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          驳回原因会展示给企业申请人，请写明需补充或修正的内容。
        </div>
        <Input.TextArea
          rows={3}
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
          placeholder="如：购方税号缺失 / 项目明细金额与合同不一致"
        />
      </Modal>

      <ContactEditModal
        target={contactTarget}
        onClose={() => setContactTarget(null)}
      />
    </>
  );
}
