"use client";
import { capabilityApi } from "@/api/capability";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";

import { qxyApi } from "@/api/qxy";

import {
  BankOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { App, Button, Checkbox, Form, Input, Modal, Select, Space, Table } from "antd";
import type { TableProps } from "antd";
import { useEffect, useState } from "react";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/status-badge";
import {
  useServedCapabilities,
  useServedEnterprises,
  useTaxCapabilities,
  useTaxOptions,
  useQxyInvoices,
} from "@/query/tax";
import { type EndpointResponse } from "@enterprise/contracts";

import { InvoiceItemsEditor } from "./invoice-items-editor";

type Options = NonNullable<EndpointResponse<"Qxy_options">["data"]>;
type ServedRow = NonNullable<
  EndpointResponse<"Capability_served">["data"]
>[number];
type ServedCapability = ServedRow["capabilities"][number];

const CAP_STATUS_CLS: Record<string, string> = {
  NONE: "badge-gray",
  REQUESTED: "badge-orange",
  OPEN: "badge-green",
  CLOSED: "badge-gray",
};

const CAP_STATUS_TEXT: Record<string, string> = {
  NONE: "未配置",
  REQUESTED: "待平台审核",
  OPEN: "已开通",
  CLOSED: "已关闭",
};

type InvoiceRow = Record<string, unknown>;

const FALLBACK_OPTIONS: Options = {
  taxTypes: [
    { code: "BDA0610611", label: "增值税及附加税（小规模纳税人）", vat: true },
    { code: "BDA0610606", label: "增值税及附加税（一般纳税人）", vat: true },
    { code: "BDA0610100", label: "通用申报表（工会经费等）" },
    { code: "BDA0611054", label: "非税收入通用申报表（垃圾处理费）" },
    { code: "BDA0611159", label: "企业所得税A类（2021年版·查账征收）" },
  ],
  invoiceTypes: [
    { code: "04", label: "增值税普通发票" },
    { code: "01", label: "增值税专用发票" },
    { code: "03", label: "机动车销售统一发票" },
  ],
  buyerTypes: [
    { code: "1", label: "企业" },
    { code: "2", label: "个人" },
  ],
};

/**
 * 财税自动化（需求 6.4 / 6.6）：平台为企业开通「电子报税 / 电子开票」后，
 * 财务人员才有「自动申报」「自动开票」（走企享云 MCP）；未开通则显示「申请付费开通…」。
 * 自动化能力配置与能力开通融合在本板块：服务商**按服务企业**配置谁可使用自动化，
 * 点「申请付费开通…」还能勾选多家还没有配置的企业批量提交申请；申请进入平台
 * 「财税管理」，平台为这些企业的税号匹配企享云报税 API Key 后即可使用。
 * 参数口径对齐企享云：申报需 yzpzzlDm + 所属期；开票需 data（fplxdm/gmf_lx/xmmx…）。
 */
export function AutoTaxPanel({
  enterpriseId,
  enterpriseName,
  period,
}: {
  enterpriseId: number;
  enterpriseName?: string;
  period?: string;
}) {
  const qxy_autoFileMutation = useOperationMutation(qxyApi.autoFile, [
    "tax",
    "dashboard",
  ]);
  const qxy_autoInvoiceMutation = useOperationMutation(qxyApi.autoInvoice, [
    "tax",
    "dashboard",
  ]);

  const { message, modal } = App.useApp();
  const optionsQuery = useTaxOptions();
  const options = optionsQuery.data ?? FALLBACK_OPTIONS;
  const servedQuery = useServedCapabilities();
  const served = servedQuery.data ?? [];

  const requestCapability = useOperationMutation(capabilityApi.request, [
    "tax",
    "admin",
  ]);
  const cancelCapability = useOperationMutation(capabilityApi.cancel, [
    "tax",
    "admin",
  ]);
  const [busy, setBusy] = useState("");
  const [autoFileOpen, setAutoFileOpen] = useState(false);
  const [autoFileResult, setAutoFileResult] = useState("");
  const [invoiceRange, setInvoiceRange] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [form] = Form.useForm();
  const [fileForm] = Form.useForm();
  /** 申报表样是否为增值税类：企享云要求增值税算税必传未开票收入 wkpxse */
  const taxTypeCode = Form.useWatch("yzpzzlDm", fileForm) as string | undefined;
  const needWkpxse = Boolean(
    options.taxTypes.find((item) => item.code === taxTypeCode)?.vat,
  );
  /** 已开发票查询：开票日期起止（企享云 kprqq / kprqz） */
  const [range, setRange] = useState<{ start: string; end: string }>({
    start: "",
    end: "",
  });
  /** 申请付费开通：勾选还没有配置的服务企业批量提交（申请进入平台「财税管理」匹配 API Key）。 */
  const [applyTarget, setApplyTarget] = useState<{
    code: string;
    label: string;
  } | null>(null);
  const [applyIds, setApplyIds] = useState<number[]>([]);
  /** 开通时间（YYYY-MM-DD）：服务商提交审核时必填，平台「财税管理」可见。 */
  const [applyDate, setApplyDate] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  /** 服务商/职员视角：选择要操作的服务企业 */
  const enterprisesQuery = useServedEnterprises(!enterpriseId);
  const serves = (enterprisesQuery.data ?? []).map((item) => ({
    id: Number(item.id),
    name: String(item.name ?? ""),
  }));
  const [active, setActive] = useState(enterpriseId || 0);

  useEffect(() => {
    if (enterpriseId) setActive(enterpriseId);
    else
      setActive((current) =>
        enterprisesQuery.data?.some((item) => Number(item.id) === current)
          ? current
          : Number(enterprisesQuery.data?.[0]?.id ?? 0),
      );
  }, [enterpriseId, enterprisesQuery.data]);
  const invoicesQuery = useQxyInvoices(active, invoiceRange);
  const invoices = invoicesQuery.data ?? [];
  const invoiceBusy = invoicesQuery.isFetching;
  const invoiceError = invoicesQuery.error?.message ?? "";
  const capabilitiesQuery = useTaxCapabilities(active);
  const capabilities = capabilitiesQuery.data ?? [];
  const loading = capabilitiesQuery.isPending;

  const capOf = (code: string) =>
    capabilities.find((item) => item.code === code)?.status || "NONE";
  const capLabel = (code: string) =>
    capabilities.find((item) => item.code === code)?.statusLabel || "未开通";

  /** 撤回待审核的配置：撤回后企业回到「未配置」，需重新提交并经平台审核。 */
  const cancelConfig = (row: ServedRow, cap: ServedCapability) => {
    modal.confirm({
      title: `撤回「${row.name}」的${cap.label}配置`,
      okText: "确认撤回",
      cancelText: "取消",
      content: "撤回后该企业回到「未配置」，需重新提交并经平台审核。",
      onOk: async () => {
        setBusy(`${row.enterpriseId}-${cap.code}`);
        try {
          await cancelCapability.mutateAsync({
            params: { code: cap.code },
            body: { enterpriseId: row.enterpriseId },
          });
          message.success("已撤回配置");
        } finally {
          setBusy("");
        }
      },
    });
  };

  const capCell = (row: ServedRow, code: string) => {
    const cap = row.capabilities.find((item) => item.code === code);
    if (!cap) return "—";
    const loading = busy === `${row.enterpriseId}-${code}`;
    return (
      <Space size={6}>
        <span className={`badge ${CAP_STATUS_CLS[cap.status] || "badge-gray"}`}>
          {cap.statusLabel}
        </span>
        {row.canConfigure && cap.status !== "OPEN" ? (
          <Button
            type={cap.status === "REQUESTED" ? "default" : "primary"}
            loading={loading}
            onClick={() =>
              cap.status === "REQUESTED"
                ? cancelConfig(row, cap)
                : openApply(cap.code, cap.label, [Number(row.enterpriseId)])
            }
          >
            {cap.status === "REQUESTED"
              ? "撤回"
              : cap.status === "CLOSED"
                ? "重新配置"
                : "配置"}
          </Button>
        ) : null}
      </Space>
    );
  };

  /** 申请列表：服务企业 + 当前企业（去重）；已开通的也可展示但禁止勾选。 */
  const applyCandidates = (code: string) => {
    const rows = served.map((row) => ({
      id: Number(row.enterpriseId),
      name: row.name,
      taxNo: row.taxNo || "",
      status: row.capabilities.find((item) => item.code === code)?.status || "NONE",
    }));
    if (active && !rows.some((row) => row.id === active)) {
      rows.unshift({
        id: active,
        name:
          enterpriseName ||
          serves.find((item) => item.id === active)?.name ||
          `企业 #${active}`,
        taxNo: "",
        status: capOf(code),
      });
    }
    return rows;
  };

  /**
   * 点击「配置 / 申请付费开通」：弹出勾选面板 + 开通时间。
   * preset 为预设勾选的企业（表内单家配置），仍可再勾选其他同状态企业。
   */
  const openApply = (code: string, label: string, preset: number[] = []) => {
    const rows = applyCandidates(code);
    const selectable = rows
      .filter((row) => row.status !== "OPEN" && row.status !== "REQUESTED")
      .map((row) => row.id);
    const initial = preset.filter((id) => selectable.includes(id));
    setApplyIds(
      initial.length ? initial : selectable.includes(active) ? [active] : [],
    );
    setApplyDate("");
    setApplyTarget({ code, label });
  };

  /** 批量提交申请：逐企业写入待审核记录（含开通时间），平台在「财税管理」匹配 API Key 后开通。 */
  const submitApply = async () => {
    if (!applyTarget || !applyIds.length) return;
    if (!applyDate) {
      message.error("请选择开通时间");
      return;
    }
    setApplyBusy(true);
    try {
      for (const enterpriseId of applyIds) {
        try {
          await requestCapability.mutateAsync({
            params: { code: applyTarget.code },
            body: {
              enterpriseId,
              opensAt: applyDate,
              note: `申请付费开通${applyTarget.label}`,
            },
          });
        } catch {
          // 错误已由统一 Mutation Hook 提示；保留已提交部分，避免重复提交。
          return;
        }
      }
      message.success(
        `已提交 ${applyIds.length} 家企业的${applyTarget.label}付费开通申请（开通时间 ${applyDate}），平台匹配财税 API Key 后即可使用`,
      );
      setApplyTarget(null);
      void servedQuery.refetch();
      if (active) void capabilitiesQuery.refetch();
    } finally {
      setApplyBusy(false);
    }
  };

  const autoFile = async () => {
    try {
      const values = await fileForm.validateFields();
      setBusy("file");
      try {
        const payload = await qxy_autoFileMutation.mutateAsync({
          params: { id: String(active) },
          body: {
            period: values.period || period || "",
            yzpzzlDm: values.yzpzzlDm || "",
            wkpxse: values.wkpxse || "",
          },
        });

        const data = payload;
        setAutoFileResult(
          `${data?.message || "已发起自动申报任务"}（${data?.code || "OK"}）${
            data?.yzpzzlLabel ? ` · ${data.yzpzzlLabel}` : ""
          }`,
        );
        setAutoFileOpen(true);
      } finally {
        setBusy("");
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const autoInvoice = async () => {
    try {
      const values = await form.validateFields();
      setBusy("invoice");
      try {
        const payload = await qxy_autoInvoiceMutation.mutateAsync({
          params: { id: String(active) },
          body: {
            invoiceType: values.invoiceType || "04",
            buyerType: values.buyerType || "1",
            buyerName: values.buyerName,
            buyerTaxNo: values.buyerTaxNo || "",
            orderNo: values.orderNo || "",
            remark: values.remark || "",
            items: (values.items || []).map(
              (item: Record<string, unknown>) => ({
                goodsCode: item.goodsCode || "",
                goodsName: item.goodsName || "",
                spec: item.spec || "",
                quantity: Number(item.quantity ?? 1),
                price: Number(item.price ?? 0),
                taxRate: item.taxRate || "6",
              }),
            ),
          },
        });

        const data = payload;
        message.success(
          `已发起开票任务${data?.orderNo ? `（来源订单号 ${data.orderNo}）` : ""}，可在下方「已开发票」核对结果`,
        );
        form.resetFields();
        setInvoiceRange({ ...range });
      } finally {
        setBusy("");
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const loadInvoices = async () => {
    if (!active) return;
    if (invoiceRange?.start === range.start && invoiceRange.end === range.end)
      await invoicesQuery.refetch();
    else setInvoiceRange({ ...range });
  };

  const invoiceColumns: TableProps<InvoiceRow>["columns"] = [
    {
      title: "发票号码",
      render: (_, row) =>
        String(row.invoiceNo || row.invoiceNumber || row.fpdm || "—"),
    },
    {
      title: "开票日期",
      render: (_, row) =>
        String(row.date || row.invoiceDate || row.kprq || "—"),
    },
    {
      title: "购方",
      render: (_, row) =>
        String(row.buyerName || row.gfmc || row.gmf_nsrmc || "—"),
    },
    {
      title: "金额",
      render: (_, row) => String(row.amount || row.je || "—"),
    },
    {
      title: "税额",
      render: (_, row) => String(row.tax || row.se || "—"),
    },
    {
      title: "状态",
      render: (_, row) => {
        const status = String(row.status || row.state || "OK");
        return <StatusBadge status={status === "OK" ? "APPROVED" : status} />;
      },
    },
  ];

  const zlpzzlLink = "https://opendoc.qixiangyun.com/sb/enum/sb_enum.html";

  return (
    <>
      {optionsQuery.isError ||
      servedQuery.isError ||
      capabilitiesQuery.isError ||
      enterprisesQuery.isError ? (
        <Notice variant="error">
          {optionsQuery.error?.message ||
            servedQuery.error?.message ||
            capabilitiesQuery.error?.message ||
            enterprisesQuery.error?.message}{" "}
          <Button
            onClick={() => {
              void optionsQuery.refetch();
              void servedQuery.refetch();
              if (active) void capabilitiesQuery.refetch();
              if (!enterpriseId) void enterprisesQuery.refetch();
            }}
          >
            重试
          </Button>
        </Notice>
      ) : null}
      <Panel
        title="财税自动化（电子报税 / 电子开票）"
        titleBadge={
          enterpriseName ||
          serves.find((item) => item.id === active)?.name ||
          ""
        }
        extra={
          <Space size={6} wrap>
            {serves.length ? (
              <Select
                size="small"
                style={{ minWidth: 180 }}
                value={active}
                options={serves.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                onChange={(value: number) => setActive(Number(value))}
              />
            ) : null}
            {capOf("E_TAX_FILING") === "OPEN" ? (
              <Button
                type="primary"
                loading={busy === "file"}
                onClick={() => void autoFile()}
              >
                <ThunderboltOutlined aria-hidden /> 自动申报
              </Button>
            ) : (
              <Button
                loading={busy === "E_TAX_FILING"}
                onClick={() => openApply("E_TAX_FILING", "自动申报")}
              >
                申请付费开通自动申报
              </Button>
            )}
            {capOf("E_INVOICING") === "OPEN" ? (
              <Button
                type="primary"
                loading={busy === "invoice"}
                onClick={() => void autoInvoice()}
              >
                <FileTextOutlined aria-hidden /> 自动开票
              </Button>
            ) : (
              <Button
                loading={busy === "E_INVOICING"}
                onClick={() => openApply("E_INVOICING", "自动开票")}
              >
                申请付费开通自动开票
              </Button>
            )}
          </Space>
        }
      >
        <Notice variant="info">
          自动申报 / 自动开票由企享云 MCP 执行。先在下方按服务企业配置，配置后进入
          「待平台审核」；也可以点右上「申请付费开通…」批量勾选还没有配置的服务企业提交申请，
          申请会进入平台「财税管理」。平台给该企业税号匹配好企享云报税 API Key
          并审核通过后即可使用。
        </Notice>
        <div className="text-12 muted" style={{ marginTop: 10 }}>
          当前状态：
          {capabilities.map((item) => (
            <span key={item.code} style={{ marginLeft: 10 }}>
              {item.label}·{capLabel(item.code)}
            </span>
          ))}
          {loading ? <span style={{ marginLeft: 8 }}>（加载中…）</span> : null}
        </div>
        <div className="text-12 muted" style={{ margin: "12px 0 8px" }}>
          服务企业自动化配置 · 共 {served.length} 家企业：点企业名称在顶部切换查看申报 /
          开票信息；配置后进入「待平台审核」，平台审核通过才生效。
        </div>
        <div className="table-wrap">
          <Table<ServedRow>
            rowKey="enterpriseId"
            pagination={false}
            size="middle"
            scroll={{ x: "max-content" }}
            dataSource={served}
            columns={[
              {
                title: "服务企业",
                dataIndex: "name",
                render: (value: string, row) => (
                  <a
                    onClick={() => setActive(Number(row.enterpriseId))}
                    title="在顶部切换到该企业"
                  >
                    {value}
                  </a>
                ),
              },
              {
                title: "税号",
                dataIndex: "taxNo",
                width: 200,
                render: (value?: string) =>
                  value ? (
                    <span className="mono text-12">{value}</span>
                  ) : (
                    <span className="text-danger">缺税号（无法匹配 API Key）</span>
                  ),
              },
              {
                title: "电子报税（自动申报）",
                width: 240,
                render: (_, row) => capCell(row, "E_TAX_FILING"),
              },
              {
                title: "电子开票（自动开票）",
                width: 240,
                render: (_, row) => capCell(row, "E_INVOICING"),
              },
            ]}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<BankOutlined aria-hidden />}
                  text="暂无生效签约的服务企业：自动化能力按服务企业配置，签约生效后这里才会出现企业。"
                />
              ),
            }}
          />
        </div>
      </Panel>

      <Panel title="申报信息（自动申报用）">
        <Form
          form={fileForm}
          layout="vertical"
          style={{ maxWidth: 720 }}
          initialValues={{ period: period || "" }}
        >
          <div className="form-2col">
            <Form.Item name="period" label="所属期">
              <Input placeholder="如 2026-08 / 2026-Q3 / 2026" />
            </Form.Item>
            <Form.Item
              name="yzpzzlDm"
              label="应征凭证种类代码（yzpzzlDm）"
              rules={[{ required: true, message: "请选择应征凭证种类代码" }]}
            >
              <Select
                placeholder="选择申报表样 / 税种"
                onChange={() => fileForm.setFieldValue("wkpxse", undefined)}
                options={options.taxTypes.map((item) => ({
                  value: item.code,
                  label: `${item.code} · ${item.label}`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="wkpxse"
              label="未开票收入（wkpxse，元）"
              rules={
                needWkpxse
                  ? [
                      {
                        required: true,
                        message: "增值税算税必须填写未开票收入",
                      },
                    ]
                  : []
              }
            >
              <Input
                type="number"
                disabled={!needWkpxse}
                placeholder={
                  needWkpxse ? "本期未开票收入" : "仅增值税类申报需要"
                }
              />
            </Form.Item>
          </div>
          <div className="text-12 muted">
            所属期支持 2026-08（月）/ 2026-Q3（季）/ 2026（年），留空取当月；
            增值税类表样必须填未开票收入，企享云据此合并销售额算税；
            代码取值见企享云
            <a href={zlpzzlLink} target="_blank" rel="noreferrer">
              申报附录
            </a>
            。
          </div>
        </Form>
      </Panel>

      <Panel title="开票信息（自动开票用）">
        <Form
          form={form}
          layout="vertical"
          style={{ maxWidth: 860 }}
          initialValues={{
            invoiceType: "04",
            buyerType: "1",
            items: [{ quantity: 1, taxRate: "6" }],
          }}
        >
          <div className="form-2col">
            <Form.Item name="invoiceType" label="发票类型">
              <Select
                options={options.invoiceTypes.map((item) => ({
                  value: item.code,
                  label: `${item.code} · ${item.label}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="buyerType" label="购买方类型">
              <Select
                options={options.buyerTypes.map((item) => ({
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
              <Input placeholder="留空自动生成" />
            </Form.Item>
            <Form.Item name="remark" label="备注">
              <Input placeholder="选填" />
            </Form.Item>
          </div>

          <InvoiceItemsEditor />

          <div className="text-12 muted" style={{ marginTop: 8 }}>
            金额 / 税额由系统按「数量 × 单价」与税率自动计算；填好后点右上「
            <FileTextOutlined aria-hidden /> 自动开票」提交，
            开票为异步任务，可在下方「已开发票」核对结果。
          </div>
        </Form>
      </Panel>

      <Panel
        title="已开发票（统一查询与管理）"
        titleBadge={invoices.length ? `${invoices.length} 张` : undefined}
        extra={
          <Button loading={invoiceBusy} onClick={() => void loadInvoices()}>
            查询已开发票
          </Button>
        }
      >
        <Space wrap size={8} style={{ marginBottom: 12 }}>
          <span className="text-12 muted">开票日期起止</span>
          <Input
            type="date"
            style={{ width: 160 }}
            value={range.start}
            onChange={(event) =>
              setRange({ ...range, start: event.target.value })
            }
          />
          <span className="text-12 muted">至</span>
          <Input
            type="date"
            style={{ width: 160 }}
            value={range.end}
            onChange={(event) =>
              setRange({ ...range, end: event.target.value })
            }
          />
          <span className="text-12 muted">（留空默认查当月）</span>
        </Space>
        {invoiceError ? (
          <div className="text-12 muted" style={{ marginBottom: 10 }}>
            {invoiceError}
          </div>
        ) : null}
        <div className="table-wrap">
          <Table<InvoiceRow>
            rowKey="key"
            loading={invoiceBusy}
            pagination={false}
            size="middle"
            dataSource={invoices.map((row, index) => ({
              ...row,
              key: String(row.id || row.invoiceNo || index),
            }))}
            columns={invoiceColumns}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<FileTextOutlined aria-hidden />}
                  text="点右上「查询已开发票」从企享云拉取该企业的已开发票。"
                />
              ),
            }}
          />
        </div>
      </Panel>

      <Modal
        open={Boolean(applyTarget)}
        width={580}
        title={
          applyTarget ? `申请付费开通${applyTarget.label}` : "申请付费开通"
        }
        okText={
          applyIds.length
            ? `提交 ${applyIds.length} 家企业申请`
            : "提交申请"
        }
        okButtonProps={{ disabled: !applyIds.length || !applyDate }}
        confirmLoading={applyBusy}
        cancelText="取消"
        onOk={() => void submitApply()}
        onCancel={() => {
          if (!applyBusy) setApplyTarget(null);
        }}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          勾选还没有配置{applyTarget?.label || "自动化"}的服务企业批量提交申请；申请会进入平台
          「财税管理 · 待匹配申请」，平台给这些企业的税号匹配好企享云 API Key
          并审核开通后即可使用。已开通 / 待审核的企业不可重复申请。
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span className="text-12 muted">开通时间</span>
          <Input
            type="date"
            style={{ width: 170 }}
            value={applyDate}
            onChange={(event) => setApplyDate(event.target.value)}
          />
          <span className="text-12 muted">必填，平台「财税管理」审核时可见</span>
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {(applyTarget ? applyCandidates(applyTarget.code) : []).map((row) => {
            const locked = row.status === "OPEN" || row.status === "REQUESTED";
            return (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <Checkbox
                  checked={applyIds.includes(row.id)}
                  disabled={locked}
                  onChange={(event) =>
                    setApplyIds((current) =>
                      event.target.checked
                        ? [...current, row.id]
                        : current.filter((id) => id !== row.id),
                    )
                  }
                />
                <span style={{ flex: 1 }}>{row.name}</span>
                <span
                  className={
                    row.taxNo ? "mono text-12" : "text-12 muted"
                  }
                >
                  {row.taxNo || "税号未登记"}
                </span>
                <span
                  className={`badge ${CAP_STATUS_CLS[row.status] || "badge-gray"}`}
                >
                  {CAP_STATUS_TEXT[row.status] || row.status}
                </span>
              </div>
            );
          })}
        </div>
        {applyTarget && !applyCandidates(applyTarget.code).length ? (
          <div className="text-12 muted">暂无服务企业可申请。</div>
        ) : null}
      </Modal>

      <Modal
        open={autoFileOpen}
        title="自动申报已受理"
        okText="知道了"
        cancelText="关闭"
        onOk={() => setAutoFileOpen(false)}
        onCancel={() => setAutoFileOpen(false)}
      >
        <div className="text-12">{autoFileResult}</div>
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          企享云为异步任务：可在财税工作台的申报计划中查看进度，如需回查结果可再次点击「自动申报」。
        </div>
      </Modal>
    </>
  );
}
