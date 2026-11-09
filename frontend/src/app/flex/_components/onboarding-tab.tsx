"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";

import {
  BorderOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
} from "antd";
import { useState, type ReactNode } from "react";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { useFlexOnboardings } from "@/query/workspaces";

import { uploadAttachments } from "@/lib/upload-attachments";
import { flexApi } from "@/api/flex";
import { canWorkOn } from "@/lib/can-work-on";
import { contactOf } from "@/lib/contacts";
import {
  ONBOARDING_ATTACHMENTS,
  contractLabel,
  fmtTime,
  onboardingNo,
  type FlexContract,
  type FlexOnboarding,
  type OnboardingFile,
} from "./common";

/** 单项材料最多上传的文件数。 */
const FILES_PER_ITEM = 6;

const TEXT_INPUTS: {
  name: string;
  label: string;
  placeholder: string;
  area?: number;
}[] = [
  {
    name: "company_name",
    label: "企业名称 *",
    placeholder: "如：杭州智造科技有限公司",
  },
  {
    name: "address",
    label: "实际经营地址 *",
    placeholder: "省市区 + 详细地址",
  },
  {
    name: "tax_no",
    label: "纳税人识别号 *",
    placeholder: "统一社会信用代码/税号",
  },
  {
    name: "company_intro",
    label: "公司简介 *",
    placeholder: "主营业务、规模、经营情况等",
    area: 2,
  },
  { name: "legal_person", label: "法定代表人 *", placeholder: "姓名" },
  {
    name: "legal_id_no",
    label: "法人身份证号 *",
    placeholder: "18 位身份证号",
  },
  { name: "legal_phone", label: "法人联系电话 *", placeholder: "手机号" },
  {
    name: "found_date",
    label: "企业成立日期 *",
    placeholder: "如：2019-06-01",
  },
  { name: "industry", label: "所属行业 *", placeholder: "如：智能制造" },
  { name: "contact_name", label: "系统对接人 *", placeholder: "姓名" },
  {
    name: "contact_id_no",
    label: "对接人身份证号 *",
    placeholder: "18 位身份证号",
  },
  {
    name: "audit_phone",
    label: "发佣审核号码 *",
    placeholder: "手机号，发佣前审核确认",
  },
  { name: "tax_landing", label: "入驻税地 *", placeholder: "如：杭州" },
  { name: "service_rate", label: "服务费率 *", placeholder: "如：6.5%" },
  {
    name: "main_business",
    label: "公司主营业务 *",
    placeholder: "主营业务及收入来源描述",
    area: 2,
  },
  {
    name: "work_scenario",
    label: "用工场景 *",
    placeholder:
      "如：我公司为物流公司，主营道路运输，需要灵活用工人员完成货物配送，分拣，搬运包装等",
    area: 3,
  },
  {
    name: "settle_rule",
    label: "结算规则 *",
    placeholder: "如：按天结算，月结（次月 10 日前）",
    area: 2,
  },
  {
    name: "bank_name",
    label: "开户行 *",
    placeholder: "如：招商银行杭州分行营业部",
  },
  { name: "bank_account", label: "银行账号 *", placeholder: "对公账户账号" },
  { name: "reg_address", label: "注册地址 *", placeholder: "营业执照注册地址" },
  {
    name: "invoice_items",
    label: "开票类目 *",
    placeholder: "如：物流辅助服务*配送服务",
  },
];

function fieldOf(name: string) {
  return TEXT_INPUTS.find((item) => item.name === name);
}

function SectionTitle({ text }: { text: string }) {
  return <div style={{ fontWeight: 600, margin: "12px 0 6px" }}>{text}</div>;
}

function Field({ name, control }: { name: string; control: ReactNode }) {
  const field = fieldOf(name);
  if (!field) return null;
  return (
    <Form.Item
      name={field.name}
      label={field.label}
      rules={[
        { required: true, message: `请填写${field.label.replace(" *", "")}` },
      ]}
    >
      {control}
    </Form.Item>
  );
}

/** 注意：必须把 Form.Item 注入的 value/onChange/id 透传给控件，否则表单取不到值。 */
function InputFor({
  name,
  ...rest
}: { name: string } & Record<string, unknown>) {
  const field = fieldOf(name);
  if (!field) return null;
  return field.area ? (
    <Input.TextArea
      rows={field.area}
      placeholder={field.placeholder}
      {...rest}
    />
  ) : (
    <Input placeholder={field.placeholder} {...rest} />
  );
}

function fmtSize(size: number) {
  if (!size) return "";
  return size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function attachmentName(key: string) {
  return (
    ONBOARDING_ATTACHMENTS.find((item) => item.key === key)?.name || "该材料"
  );
}

/** 用工进件页签（📄 用工进件）：企业风控表提交 → 代理人审核 → 台账留痕。 */
export function OnboardingTab({
  contracts,
  isEnterprise,
  isProvider,
  meUserId,
  staffOf,
  switcher,
}: {
  contracts: FlexContract[];
  isEnterprise: boolean;
  isProvider: boolean;
  meUserId: string;
  staffOf?: { providerUserId?: string; status?: string }[];
  reload: () => Promise<void>;
  /** 「用工需求」栏目内的子视图切换器（用工需求 / 用工进件）。 */
  switcher?: ReactNode;
}) {
  const flex_auditOnboardingMutation = useOperationMutation(
    flexApi.auditOnboarding,
    ["flex", "dashboard"],
  );
  const flex_createOnboardingMutation = useOperationMutation(
    flexApi.createOnboarding,
    ["flex", "dashboard"],
  );

  const [page, setPage] = useState(1);
  const listQuery = useFlexOnboardings(page);
  const rows = listQuery.data?.list ?? [];
  const loading = listQuery.isPending;

  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<
    Record<string, OnboardingFile[]>
  >(() =>
    Object.fromEntries(ONBOARDING_ATTACHMENTS.map((item) => [item.key, []])),
  );
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlexOnboarding | null>(null);
  const [auditNote, setAuditNote] = useState("");
  const [auditing, setAuditing] = useState(false);
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );

  const usableContracts = contracts.filter(
    (item) => item.status === "ACTIVE" && item.serviceType === "FLEX_WORK",
  );

  const contractName = (contractId: number) =>
    contracts.find((item) => item.id === contractId)?.enterpriseName || "—";

  const canAudit =
    detail?.status === "SUBMITTED" &&
    canWorkOn({ userId: meUserId, staffOf }, detail);

  const attachmentRows = (
    detail?.attachments?.length ? detail.attachments : ONBOARDING_ATTACHMENTS
  ).map((item, index) => ({
    key: item.key || String(index),
    name: item.name || "",
    requirement: item.requirement || "",
    ready: "ready" in item ? Boolean(item.ready) : true,
    files: ("files" in item ? item.files : undefined) || [],
  }));

  const uploadedCount = attachmentRows.reduce(
    (sum, item) => sum + item.files.length,
    0,
  );

  /** 上传某项进件材料到平台 OSS，返回后端登记的文件记录。 */
  const uploadFiles = async (key: string, picked: File[]) => {
    if (uploadingKey || submitting) return;
    const current = attachments[key] || [];
    const remain = FILES_PER_ITEM - current.length;
    if (remain <= 0) {
      message.warning(
        `「${attachmentName(key)}」最多上传 ${FILES_PER_ITEM} 个文件`,
      );
      return;
    }
    const batch = picked.slice(0, remain);
    if (picked.length > remain) {
      message.warning(
        `「${attachmentName(key)}」最多 ${FILES_PER_ITEM} 个文件，本次仅上传 ${remain} 个`,
      );
    }
    setUploadingKey(key);
    try {
      const count = await uploadAttachments(
        flexApi.uploadOnboardingAttachments,
        batch,
        (uploaded) =>
          setAttachments((prev) => ({
            ...prev,
            [key]: [...(prev[key] || []), ...uploaded],
          })),
      );
      if (count)
        message.success(`「${attachmentName(key)}」已上传 ${count} 个文件`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "文件上传失败");
    } finally {
      setUploadingKey(null);
    }
  };

  const removeFile = (key: string, index: number) => {
    setAttachments((prev) => ({
      ...prev,
      [key]: (prev[key] || []).filter((_, i) => i !== index),
    }));
  };

  const openAudit = (action: "APPROVE" | "REJECT") => {
    if (!detail) return;
    if (action === "REJECT" && !auditNote.trim()) {
      message.warning("驳回时请填写驳回原因");
      return;
    }
    setAuditing(true);
    void (async () => {
      try {
        try {
          await flex_auditOnboardingMutation.mutateAsync({
            params: { id: String(detail.id) },
            body: { action, note: auditNote.trim() },
          });

          message.success(action === "APPROVE" ? "进件已通过" : "进件已驳回");
          setDetail(null);
          setAuditNote("");
        } finally {
          setAuditing(false);
        }
      } catch (error) {
        if (error instanceof Error)
          presentMutationError(error, (text) => message.error(text));
      }
    })();
  };

  return (
    <>
      <Panel
        title="灵活用工进件台账（企业风控表）"
        titleBadge={`${listQuery.data?.total ?? 0} 条`}
        extra={
          isEnterprise ? (
            <Button
              type="primary"
              onClick={() => {
                if (!usableContracts.length) {
                  message.warning(
                    "暂无生效签约，请先在「代理人资源库」选择该代理人合作",
                  );
                  return;
                }
                setCreateOpen(true);
              }}
            >
              ＋ 提交进件
            </Button>
          ) : null
        }
      >
        {switcher}
        {listQuery.isError ? (
          <Notice variant="error">
            {listQuery.error.message}{" "}
            <Button onClick={() => void listQuery.refetch()}>重试</Button>
          </Notice>
        ) : null}
        <div className="table-wrap">
          <Table<FlexOnboarding>
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
                    isProvider
                      ? "暂无进件记录，等待签约企业提交灵活用工进件"
                      : "暂无进件记录，点击右上角提交进件（企业风控表）"
                  }
                />
              ),
            }}
            columns={[
              {
                title: "进件编号",
                width: 130,
                render: (_, row) => (
                  <span className="mono text-12">{onboardingNo(row)}</span>
                ),
              },
              {
                title: "企业",
                width: 200,
                render: (_, row) =>
                  row.form?.company_name || contractName(row.contractId),
              },
              {
                title: "代理人",
                width: 150,
                render: (_, row) => row.agentName || "—",
              },
              {
                title: "状态",
                width: 100,
                render: (_, row) => (
                  <StatusBadge domain="onboarding" status={row.status} />
                ),
              },
              {
                title: "审核意见",
                width: 200,
                render: (_, row) => (
                  <span className="text-12">{row.rejectNote || "—"}</span>
                ),
              },
              {
                title: "提交时间",
                dataIndex: "createdAt",
                width: 150,
                render: (value: string) => (
                  <span className="text-12">{fmtTime(value)}</span>
                ),
              },
              {
                title: "联系方式（企业侧 / 执行侧）",
                width: 220,
                render: (_, row) => {
                  const ent = contactOf(row, "contact");
                  const prov = contactOf(row, "provider_contact");
                  return (
                    <span className="text-12">
                      {[ent.name, ent.phone].filter(Boolean).join(" · ") || "—"}
                      {" / "}
                      {[prov.name, prov.phone].filter(Boolean).join(" · ") ||
                        "—"}
                    </span>
                  );
                },
              },
              {
                title: "操作",
                width: 190,
                render: (_, row) => (
                  <Space size={6} wrap>
                    <Button
                      onClick={() => {
                        setAuditNote("");
                        setDetail(row);
                      }}
                    >
                      详情
                    </Button>
                    {isEnterprise ||
                    canWorkOn({ userId: meUserId, staffOf }, row) ? (
                      <Button
                        onClick={() => {
                          const ent = contactOf(row, "contact");
                          const prov = contactOf(row, "provider_contact");
                          setContactTarget({
                            resource: "flexOnboarding",
                            id: row.id,
                            no: onboardingNo(row),
                            contactName: ent.name,
                            contactPhone: ent.phone,
                            providerContactName: prov.name,
                            providerContactPhone: prov.phone,
                            partyLabel: "企业侧",
                            providerLabel: "代理人/承办方",
                          });
                        }}
                      >
                        改联系方式
                      </Button>
                    ) : null}
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        open={createOpen}
        title="提交灵活用工进件（企业风控表 · 模板：企业风控表模版-泰联普票）"
        width={860}
        confirmLoading={submitting}
        okButtonProps={{ disabled: Boolean(uploadingKey) }}
        cancelButtonProps={{ disabled: Boolean(uploadingKey) || submitting }}
        closable={!uploadingKey && !submitting}
        mask={{ closable: !uploadingKey && !submitting }}
        keyboard={!uploadingKey && !submitting}
        okText="提交进件"
        onCancel={() => {
          if (!uploadingKey && !submitting) setCreateOpen(false);
        }}
        onOk={async () => {
          try {
            if (uploadingKey || submitting) return;
            const values = (await form.validateFields()) as Record<
              string,
              unknown
            >;
            setSubmitting(true);
            try {
              await flex_createOnboardingMutation.mutateAsync({
                body: {
                  contract_id: values.contract_id,
                  form: values,
                  attachments: ONBOARDING_ATTACHMENTS.map((item) => ({
                    key: item.key,
                    name: item.name,
                    requirement: item.requirement,
                    // 已上传真实材料即视为备齐（按模板口径，部分项为三选一/三选二）
                    ready: Boolean((attachments[item.key] || []).length),
                    files: attachments[item.key] || [],
                  })),
                },
              });

              message.success("进件已提交，等待服务商审核");
              setCreateOpen(false);
              form.resetFields();
              setAttachments(
                Object.fromEntries(
                  ONBOARDING_ATTACHMENTS.map((item) => [item.key, []]),
                ),
              );
            } finally {
              setSubmitting(false);
            }
          } catch (error) {
            if (error instanceof Error)
              presentMutationError(error, (text) => message.error(text));
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="contract_id"
            label="签约代理人 *"
            rules={[{ required: true, message: "请选择签约代理人" }]}
          >
            <Select
              placeholder="请选择签约代理人"
              options={usableContracts.map((contract) => ({
                value: contract.id,
                label: contractLabel(contract),
              }))}
            />
          </Form.Item>

          <SectionTitle text="▍企业信息" />
          <Field
            name="company_name"
            control={<InputFor name="company_name" />}
          />
          <Field name="address" control={<InputFor name="address" />} />
          <Field name="tax_no" control={<InputFor name="tax_no" />} />
          <Field
            name="company_intro"
            control={<InputFor name="company_intro" />}
          />

          <SectionTitle text="▍法人信息" />
          <div className="form-2col">
            <Field
              name="legal_person"
              control={<InputFor name="legal_person" />}
            />
            <Field
              name="legal_id_no"
              control={<InputFor name="legal_id_no" />}
            />
          </div>
          <div className="form-2col">
            <Field
              name="legal_phone"
              control={<InputFor name="legal_phone" />}
            />
            <Field name="found_date" control={<InputFor name="found_date" />} />
          </div>
          <Field name="industry" control={<InputFor name="industry" />} />

          <SectionTitle text="▍系统对接" />
          <div className="form-2col">
            <Field
              name="contact_name"
              control={<InputFor name="contact_name" />}
            />
            <Field
              name="contact_id_no"
              control={<InputFor name="contact_id_no" />}
            />
          </div>
          <div className="form-2col">
            <Form.Item name="sign_mode" label="签约模式" initialValue="线上">
              <Select
                options={[
                  { value: "线上", label: "默认线上" },
                  { value: "线下", label: "线下" },
                ]}
              />
            </Form.Item>
            <Field
              name="audit_phone"
              control={<InputFor name="audit_phone" />}
            />
          </div>
          <div className="form-2col">
            <Field
              name="tax_landing"
              control={<InputFor name="tax_landing" />}
            />
            <Field
              name="service_rate"
              control={<InputFor name="service_rate" />}
            />
          </div>

          <SectionTitle text="▍风控信息" />
          <Field
            name="main_business"
            control={<InputFor name="main_business" />}
          />
          <Field
            name="work_scenario"
            control={<InputFor name="work_scenario" />}
          />
          <Field name="settle_rule" control={<InputFor name="settle_rule" />} />

          <SectionTitle text="▍开票信息" />
          <div className="form-2col">
            <Field name="bank_name" control={<InputFor name="bank_name" />} />
            <Field
              name="bank_account"
              control={<InputFor name="bank_account" />}
            />
          </div>
          <div className="form-2col">
            <Field
              name="reg_address"
              control={<InputFor name="reg_address" />}
            />
            <Field
              name="invoice_items"
              control={<InputFor name="invoice_items" />}
            />
          </div>

          <SectionTitle
            text={`▍附件清单（8 项，按模板要求备齐 · 已上传 ${ONBOARDING_ATTACHMENTS.reduce(
              (sum, item) => sum + (attachments[item.key]?.length || 0),
              0,
            )} 个文件）`}
          />
          <div className="text-12 muted" style={{ marginBottom: 6 }}>
            按模板逐项上传真实材料（支持 jpg / png / pdf，单个 ≤10MB，每项最多{" "}
            {FILES_PER_ITEM} 个）；企业成立 1 年以上社保、纳税记录三选一，成立 6
            个月以上不满 1 年三选二。
          </div>
          {ONBOARDING_ATTACHMENTS.map((item) => {
            const files = attachments[item.key] || [];
            const inputId = `flex-onboarding-file-${item.key}`;
            return (
              <div
                key={item.key}
                style={{
                  padding: "8px 0",
                  borderBottom: "1px dashed var(--line, #e5e7eb)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>
                    {files.length ? (
                      <CheckCircleOutlined
                        aria-label="已上传"
                        style={{ color: "var(--success)" }}
                      />
                    ) : (
                      <BorderOutlined aria-label="未上传" />
                    )}{" "}
                    {item.name}
                    <span className="text-12 muted" style={{ marginLeft: 8 }}>
                      {item.requirement}
                    </span>
                  </span>
                  <input
                    id={inputId}
                    type="file"
                    disabled={Boolean(uploadingKey) || submitting}
                    multiple
                    accept=".jpg,.jpeg,.png,.pdf"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      const picked = Array.from(event.target.files || []);
                      event.target.value = "";
                      if (picked.length) void uploadFiles(item.key, picked);
                    }}
                  />
                  <Button
                    loading={uploadingKey === item.key}
                    disabled={Boolean(uploadingKey) || submitting}
                    onClick={() => document.getElementById(inputId)?.click()}
                  >
                    {files.length ? "继续上传" : "上传材料"}
                  </Button>
                </div>
                {files.length ? (
                  <div style={{ marginTop: 2, paddingLeft: 18 }}>
                    {files.map((file, index) => (
                      <div
                        key={file.id || `${file.url}-${index}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "4px 0",
                        }}
                      >
                        <span className="text-12" style={{ flex: 1 }}>
                          {`${index + 1}. ${file.name}`}
                        </span>
                        <span className="text-12 muted">
                          {fmtSize(file.size || 0)}
                        </span>
                        <a
                          className="text-12"
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          OSS 链接
                        </a>
                        <Button
                          type="text"
                          danger
                          onClick={() => removeFile(item.key, index)}
                        >
                          删除
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={`灵活用工进件详情 · ${detail ? onboardingNo(detail) : ""}`}
        width={780}
        onCancel={() => setDetail(null)}
        footer={
          canAudit
            ? [
                <Button
                  key="reject"
                  danger
                  loading={auditing}
                  onClick={() => openAudit("REJECT")}
                >
                  驳回
                </Button>,
                <Button
                  key="approve"
                  type="primary"
                  loading={auditing}
                  onClick={() => openAudit("APPROVE")}
                >
                  审核通过
                </Button>,
              ]
            : null
        }
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="进件编号">
            <span className="mono">{detail ? onboardingNo(detail) : "—"}</span>
          </Descriptions.Item>
          <Descriptions.Item label="企业">
            {detail?.form?.company_name ||
              (detail ? contractName(detail.contractId) : "—")}
          </Descriptions.Item>
          <Descriptions.Item label="承办代理人">
            {detail?.agentName || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <StatusBadge domain="onboarding" status={detail?.status} />
          </Descriptions.Item>
        </Descriptions>

        <SectionTitle text="▍企业信息登记表（企业风控表）" />
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="企业名称">
            {detail?.form?.company_name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="纳税人识别号">
            {detail?.form?.tax_no || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="实际经营地址">
            {detail?.form?.address || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="注册地址">
            {detail?.form?.reg_address || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="所属行业">
            {detail?.form?.industry || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="企业成立日期">
            {detail?.form?.found_date || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="法定代表人">
            {detail?.form?.legal_person || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="法人身份证号">
            <span className="mono">{detail?.form?.legal_id_no || "—"}</span>
          </Descriptions.Item>
          <Descriptions.Item label="法人联系电话">
            {detail?.form?.legal_phone || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="系统对接人">
            {`${detail?.form?.contact_name || "—"}（身份证：${
              detail?.form?.contact_id_no || "—"
            }）`}
          </Descriptions.Item>
          <Descriptions.Item label="签约模式">
            {detail?.form?.sign_mode || "线上"}
          </Descriptions.Item>
          <Descriptions.Item label="发佣审核号码">
            {detail?.form?.audit_phone || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="入驻税地">
            {detail?.form?.tax_landing || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="服务费率">
            {detail?.form?.service_rate || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="公司简介">
            {detail?.form?.company_intro || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="开户行">
            {detail?.form?.bank_name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="银行账号">
            <span className="mono">{detail?.form?.bank_account || "—"}</span>
          </Descriptions.Item>
          <Descriptions.Item label="开票类目">
            {detail?.form?.invoice_items || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="公司主营业务">
            {detail?.form?.main_business || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="结算规则">
            {detail?.form?.settle_rule || "—"}
          </Descriptions.Item>
        </Descriptions>

        <SectionTitle text="用工场景（自由职业提供的服务内容）" />
        <div style={{ whiteSpace: "pre-wrap" }}>
          {detail?.form?.work_scenario || "—"}
        </div>

        <SectionTitle
          text={`附件清单（模板要求 8 项 · 已上传 ${uploadedCount} 个文件）`}
        />
        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          {attachmentRows.map((item) => (
            <div key={item.key} className="text-12">
              {item.ready ? (
                <CheckCircleOutlined
                  aria-label="材料齐全"
                  style={{ color: "var(--success)" }}
                />
              ) : (
                <BorderOutlined aria-label="材料待补充" />
              )}{" "}
              {item.name}
              <span className="muted" style={{ marginLeft: 8 }}>
                {item.requirement}
              </span>
              {item.files.length ? (
                <div style={{ paddingLeft: 18 }}>
                  {item.files.map((file, index) => (
                    <div
                      key={file.id || `${file.url}-${index}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "3px 0",
                      }}
                    >
                      <span className="text-12" style={{ flex: 1 }}>
                        {`${index + 1}. ${file.name}`}
                      </span>
                      <span className="text-12 muted">
                        {fmtSize(file.size || 0)}
                      </span>
                      <a
                        className="text-12"
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看材料
                      </a>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </Space>

        <SectionTitle text="审核记录" />
        <div>
          {detail?.status === "SUBMITTED"
            ? "尚未审核"
            : `${detail?.rejectNote || "已审核"}（${fmtTime(
                detail?.auditedAt || "",
              )}）`}
        </div>

        {canAudit ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6 }}>审核意见（驳回必填）</div>
            <Input
              value={auditNote}
              placeholder="通过可不填；驳回请填写原因"
              onChange={(event) => setAuditNote(event.target.value)}
            />
          </div>
        ) : null}
      </Modal>

      <ContactEditModal
        target={contactTarget}
        onClose={() => setContactTarget(null)}
      />
    </>
  );
}
