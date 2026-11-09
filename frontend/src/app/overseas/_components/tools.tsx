"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { overseasApi } from "@/api/overseas";
import { aiApi, type AiOverseasCheck } from "@/api/ai";
import { AiList, AiModeTag } from "@/components/ai-result";

import { GlobalOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Steps,
  Table,
} from "antd";
import { useState } from "react";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import {
  useOverseasClaim,
  useOverseasClaims,
  useProviderStaff,
} from "@/query/workspaces";

import { contactOf } from "@/lib/contacts";
import { AlertModal, ConfirmModal, type ConfirmState } from "./confirm-modal";
import {
  OVERSEAS_SERVICES,
  fmtTime,
  money,
  serviceNameOf,
  type OverseasClaimRow,
  type OverseasContractRow,
} from "./common";

type StepAction = {
  label: string;
  action: "ACCEPT" | "APPROVE" | "REFUND" | "REJECT";
  tail: string;
  primary?: boolean;
  danger?: boolean;
};

/** 状态机（对齐 demo buildOverseasOps）：SUBMITTED → IN_REVIEW → APPROVED → REFUNDED。 */
export function stepsOf(row: OverseasClaimRow): StepAction[] {
  const steps: StepAction[] = [];
  if (row.status === "SUBMITTED") {
    steps.push({
      label: "受理办理",
      action: "ACCEPT",
      tail: "将受理并开始办理，",
      primary: true,
    });
  }
  if (row.status === "IN_REVIEW") {
    steps.push(
      row.serviceType === "EXPORT_REFUND"
        ? { label: "审核通过", action: "APPROVE", tail: "将标记为审核通过，" }
        : { label: "办结", action: "APPROVE", tail: "将标记为已办结，" },
    );
  }
  if (row.status === "APPROVED" && row.serviceType === "EXPORT_REFUND") {
    steps.push({
      label: "确认退税到账",
      action: "REFUND",
      tail: "将确认退税款已到账，",
    });
  }
  if (row.status === "SUBMITTED" || row.status === "IN_REVIEW") {
    steps.push({
      label: "退回",
      action: "REJECT",
      tail: "将退回该申请，",
      danger: true,
    });
  }
  return steps;
}

/** 详情弹窗办理流程：退税类多一步「退税到账」，其余审核通过即办结。 */
function flowOf(row: OverseasClaimRow): string[] {
  return row.serviceType === "EXPORT_REFUND"
    ? ["提交申请", "受理办理", "审核通过", "退税到账"]
    : ["提交申请", "受理办理", "办结"];
}

function flowIndexOf(row: OverseasClaimRow): number {
  const index = ["SUBMITTED", "IN_REVIEW", "APPROVED", "REFUNDED"].indexOf(
    row.status,
  );
  return index < 0 ? 0 : index;
}

/**
 * 出海服务工具（demo services.js renderTools）：服务工具卡片 + 出海服务台账。
 */
export function OverseasTools({
  contracts,
  isEnterprise,
  canApply = true,
  providerIds,
  enterpriseReady,
  currentUserId,
  onGoCatalog,
}: {
  contracts: OverseasContractRow[];
  isEnterprise: boolean;
  /** 个人主体只可浏览，发起出海服务申请（办理）锁住。 */
  canApply?: boolean;
  providerIds: string[];
  enterpriseReady: boolean;
  currentUserId: string;
  reload: () => Promise<void>;
  onGoCatalog: () => void;
}) {
  const overseas_advanceMutation = useOperationMutation(overseasApi.advance, [
    "overseas",
    "dashboard",
  ]);
  const overseas_createMutation = useOperationMutation(overseasApi.create, [
    "overseas",
    "dashboard",
  ]);

  const [page, setPage] = useState(1);
  const listQuery = useOverseasClaims(page);
  const rows = listQuery.data?.list ?? [];

  const { message } = App.useApp();
  const [applyType, setApplyType] = useState<string | null>(null);
  const [unsigned, setUnsigned] = useState<
    (typeof OVERSEAS_SERVICES)[number] | null
  >(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );
  const [detailId, setDetailId] = useState<number | null>(null);
  const [aiCountry, setAiCountry] = useState("");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<AiOverseasCheck | null>(null);
  const [aiAsking, setAiAsking] = useState(false);
  const [form] = Form.useForm();
  /** 服务商已绑定职员（用于把承办职员 id 显示成姓名） */
  const staffQuery = useProviderStaff(!isEnterprise);
  const staff = staffQuery.data ?? [];

  const runAiCheck = async () => {
    if (!aiCountry.trim() || !aiQuestion.trim()) {
      message.warning("请填写国家/地区与问题");
      return;
    }
    setAiAsking(true);
    setAiAnswer(null);
    try {
      setAiAnswer(
        await aiApi.overseasCheck({
          body: { country: aiCountry.trim(), question: aiQuestion.trim() },
        }),
      );
    } catch (error) {
      message.error((error as Error).message || "AI 问答失败");
    } finally {
      setAiAsking(false);
    }
  };

  const signedOf = (type: string) =>
    contracts.some(
      (item) => item.serviceType === type && item.status === "ACTIVE",
    );

  const providerNameOf = (userId: string) => {
    const hit = contracts.find((item) => item.providerUserId === userId);
    return hit?.provider_name || hit?.providerOrg || "—";
  };
  // 承办服务商名称回填（contracts 未覆盖时退回「—」）
  const contractProviderName = (row: OverseasClaimRow) =>
    providerNameOf(row.providerUserId) ||
    contracts.find((item) => item.id === row.contractId)?.providerOrg ||
    "—";
  const enterpriseNameOf = (row: OverseasClaimRow) =>
    contracts.find(
      (item) => Number(item.enterpriseId) === Number(row.enterpriseId),
    )?.enterpriseName || "—";

  const canWork = (row: OverseasClaimRow) =>
    // 作业主体是承办职员：已指派时只有该职员可办理；未指派时该服务商可先受理
    row.staffUserId
      ? row.staffUserId === currentUserId
      : providerIds.includes(row.providerUserId) ||
        row.providerUserId === currentUserId;

  /** 承办职员姓名（服务商/职员视角用 /enterprise/staff 映射；企业视角只显示是否已指派） */
  const staffNameOf = (staffUserId: string) => {
    if (!staffUserId) return "";
    const hit = staff.find((item) => item.staffUserId === staffUserId);
    return hit?.staff_name || hit?.profile?.realName || staffUserId;
  };

  const detailQuery = useOverseasClaim(detailId);
  const detail = detailQuery.data ?? null;

  /** 行内与详情弹窗共用：改联系方式入口（企业侧或可承办方） */
  const contactButton = (row: OverseasClaimRow) =>
    (isEnterprise && canApply) || canWork(row) ? (
      <Button
        key="contacts"
        onClick={() => {
          const ent = contactOf(row, "contact");
          const prov = contactOf(row, "provider_contact");
          setContactTarget({
            resource: "overseas",
            id: row.id,
            no: row.claimNo,
            contactName: ent.name,
            contactPhone: ent.phone,
            providerContactName: prov.name,
            providerContactPhone: prov.phone,
            partyLabel: "企业侧",
            providerLabel: "办理服务商",
          });
        }}
      >
        改联系方式
      </Button>
    ) : null;

  /** 行内与详情弹窗共用：状态机推进按钮 */
  const stepButtons = (row: OverseasClaimRow) =>
    (canWork(row) ? stepsOf(row) : []).map((step) => (
      <Button
        key={step.label}
        danger={step.danger}
        type={step.primary ? "primary" : "default"}
        onClick={() =>
          setConfirm({
            title: `出海服务办理 · ${step.label}`,
            okText: step.label,
            danger: step.danger,
            body: `「${row.title || row.claimNo}」${step.tail}确定执行吗？`,
            onOk: async () => {
              await overseas_advanceMutation.mutateAsync({
                params: { id: String(row.id) },
                body: { action: step.action },
              });

              message.success("办理进度已更新");
              setConfirm(null);
            },
          })
        }
      >
        {step.label}
      </Button>
    ));

  const detailItems = (row: OverseasClaimRow) => {
    const ent = contactOf(row, "contact");
    const prov = contactOf(row, "provider_contact");
    return [
      {
        key: "no",
        label: "单号",
        children: <span className="mono text-12">{row.claimNo}</span>,
      },
      {
        key: "service",
        label: "服务类型",
        children: (
          <span className="badge badge-sky">
            {serviceNameOf(row.serviceType)}
          </span>
        ),
      },
      { key: "title", label: "标题", children: row.title || "—" },
      { key: "enterprise", label: "企业", children: enterpriseNameOf(row) },
      {
        key: "provider",
        label: "办理服务商",
        children: contractProviderName(row),
      },
      {
        key: "staff",
        label: "承办职员",
        children: row.staffUserId ? (
          staffNameOf(row.staffUserId)
        ) : (
          <span className="badge badge-orange">待指派</span>
        ),
      },
      { key: "country", label: "办理地区", children: row.country || "—" },
      {
        key: "amount",
        label: "金额",
        children: Number(row.amount) ? (
          <span className="mono">{money(row.amount)}</span>
        ) : (
          "—"
        ),
      },
      {
        key: "status",
        label: "状态",
        children: <StatusBadge domain="overseas" status={row.status} />,
      },
      {
        key: "contact",
        label: "联系方式（企业侧）",
        children: [ent.name, ent.phone].filter(Boolean).join(" · ") || "—",
      },
      {
        key: "providerContact",
        label: "联系方式（执行侧）",
        children: [prov.name, prov.phone].filter(Boolean).join(" · ") || "—",
      },
      { key: "created", label: "提交时间", children: fmtTime(row.createdAt) },
      { key: "updated", label: "更新时间", children: fmtTime(row.updatedAt) },
    ];
  };

  const detailFooter = (row: OverseasClaimRow) => {
    const nodes = [contactButton(row), ...stepButtons(row)];
    if (!nodes.length) return null;
    return (
      <Space size={8} wrap>
        {nodes}
      </Space>
    );
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      try {
        const payload = await overseas_createMutation.mutateAsync({
          body: {
            service_type: values.service_type,
            title: values.title,
            country: values.region || "",
            amount: Number(values.amount || 0),
            remark: values.remark || "",
          },
        });

        const claimNo = payload?.claim_no;
        message.success(
          claimNo ? `出海服务申请已提交（${claimNo}）` : "出海服务申请已提交",
        );
        setApplyType(null);
        form.resetFields();
      } finally {
        setSubmitting(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      {staffQuery.isError ? (
        <Notice variant="error">
          职员加载失败：{staffQuery.error.message}{" "}
          <Button onClick={() => void staffQuery.refetch()}>重试</Button>
        </Notice>
      ) : null}
      <Panel
        title="出海服务工具"
        titleBadge="选择需要的出海服务发起申请；未签约该服务时先提醒去「跨境出海服务商」签约，签约生效后再申请办理"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {OVERSEAS_SERVICES.map((svc) => {
            const signed = signedOf(svc.type);
            return (
              <div key={svc.type} className="panel" style={{ margin: 0 }}>
                <div className="panel-body">
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span className="stat-ico">{svc.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{svc.name}</div>
                      {isEnterprise ? (
                        <span
                          className={`badge ${signed ? "badge-green" : "badge-gray"}`}
                        >
                          {signed ? "已签约 · 可申请" : "未签约"}
                        </span>
                      ) : (
                        <div className="text-12 muted">出海服务工具</div>
                      )}
                    </div>
                  </div>
                  <div className="text-12 muted" style={{ margin: "10px 0" }}>
                    {svc.desc}
                  </div>
                  <Space size={8} wrap style={{ marginTop: 12 }}>
                    {isEnterprise && canApply ? (
                      <Button
                        type={signed ? "primary" : "default"}
                        onClick={() => {
                          if (!signed) {
                            setUnsigned(svc);
                            return;
                          }
                          if (!enterpriseReady) {
                            message.warning(
                              "请先同步企业档案后再提交出海服务申请",
                            );
                            return;
                          }
                          form.setFieldsValue({
                            service_type: svc.type,
                            currency: "CNY",
                          });
                          setApplyType(svc.type);
                        }}
                      >
                        {signed ? "去申请" : "去申请（先签约）"}
                      </Button>
                    ) : (
                      <span className="text-12 muted">
                        {isEnterprise
                          ? "你是「个人」主体，可浏览该服务的办理流程并在「跨境出海服务商」申请加入服务商；发起出海服务申请需以「企业」或「个体工商户」主体办理"
                          : "企业提交申请后，具备出海服务资质的签约服务商可受理办理"}
                      </span>
                    )}
                  </Space>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="出海 AI 问答"
        titleBadge="基于知识库里「出海」挂载的资料回答，并给出通用风险清单；不替代当地律师与会计师意见"
      >
        <Space.Compact style={{ width: "100%", marginBottom: 8 }}>
          <Input
            style={{ width: 220 }}
            value={aiCountry}
            onChange={(event) => setAiCountry(event.target.value)}
            placeholder="国家/地区，如：越南"
          />
          <Input
            value={aiQuestion}
            onChange={(event) => setAiQuestion(event.target.value)}
            placeholder="例如：外资企业设立需要哪些资质与最低资本要求？"
          />
          <Button type="primary" loading={aiAsking} onClick={() => void runAiCheck()}>
            提问
          </Button>
        </Space.Compact>
        {aiAnswer ? (
          <div>
            <AiModeTag mode={aiAnswer.mode} model={aiAnswer.model} />
            <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
              {aiAnswer.answer}
            </div>
            {aiAnswer.citations.length ? (
              <AiList
                title="引用来源"
                items={aiAnswer.citations.map(
                  (item) => `${item.title}（${item.ref}）`,
                )}
              />
            ) : null}
            <AiList title="通用风险清单" items={aiAnswer.risks} />
          </div>
        ) : null}
      </Panel>

      {listQuery.isError || detailQuery.isError ? (
        <Notice variant="error">
          {listQuery.error?.message || detailQuery.error?.message}{" "}
          <Button onClick={() => void listQuery.refetch()}>重试</Button>
        </Notice>
      ) : null}
      <Panel
        title="出海服务台账"
        titleBadge={`${listQuery.data?.total ?? 0} 条`}
      >
        <p className="text-12 muted" style={{ marginTop: 0, marginBottom: 12 }}>
          {isEnterprise
            ? "办理流程：提交申请 → 服务商受理办理 → 审核/审批 → 完成（退税类服务流转至退税到账）。提交后自动匹配已签约且具备出海服务资质的服务商办理。"
            : "办理流程：企业提交申请 → 服务商受理办理 → 审核/审批 → 完成（退税类服务流转至退税到账）。"}
        </p>
        <div className="table-wrap">
          <Table<OverseasClaimRow>
            rowKey="id"
            dataSource={rows}
            loading={listQuery.isPending}
            pagination={{
              current: page,
              pageSize: 20,
              total: listQuery.data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            size="middle"
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<GlobalOutlined aria-hidden />}
                  text={
                    isEnterprise
                      ? "暂无出海服务申请，从「出海服务工具」选择服务提交申请，服务商将受理办理"
                      : "暂无出海服务申请，等待签约企业提交出海服务申请"
                  }
                />
              ),
            }}
            columns={[
              {
                title: "单号",
                dataIndex: "claimNo",
                width: 170,
                render: (value: string) => (
                  <span className="mono text-12">{value}</span>
                ),
              },
              {
                title: "服务类型",
                dataIndex: "serviceType",
                width: 130,
                render: (value: string) => (
                  <span className="badge badge-sky">
                    {serviceNameOf(value)}
                  </span>
                ),
              },
              {
                title: "标题",
                dataIndex: "title",
                width: 200,
                render: (value: string) => (
                  <span style={{ fontWeight: 600 }}>{value || "—"}</span>
                ),
              },
              {
                title: "企业",
                width: 150,
                render: (_, row) => enterpriseNameOf(row),
              },
              {
                title: "办理服务商",
                width: 150,
                render: (_, row) => contractProviderName(row),
              },
              {
                title: "承办职员",
                width: 130,
                render: (_, row) =>
                  row.staffUserId ? (
                    <span className="text-12">
                      {staffNameOf(row.staffUserId)}
                    </span>
                  ) : (
                    <span className="badge badge-orange">待指派</span>
                  ),
              },
              {
                title: "金额",
                dataIndex: "amount",
                width: 120,
                render: (value: string) =>
                  Number(value) ? (
                    <span className="mono">{money(value)}</span>
                  ) : (
                    "—"
                  ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 180,
                render: (value: string) => (
                  <StatusBadge domain="overseas" status={value} />
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
                title: "更新时间",
                dataIndex: "updatedAt",
                width: 150,
                render: (value: string) => (
                  <span className="text-12">{fmtTime(value)}</span>
                ),
              },
              {
                title: "操作",
                width: 300,
                render: (_, row) => (
                  <Space size={6} wrap>
                    <Button onClick={() => setDetailId(row.id)}>详情</Button>
                    {contactButton(row)}
                    {stepButtons(row)}
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        open={Boolean(detail)}
        title={`出海服务详情 · ${detail?.claimNo || ""}`}
        width={680}
        footer={detail ? detailFooter(detail) : null}
        onCancel={() => setDetailId(null)}
      >
        {detail ? (
          <div>
            <Descriptions
              column={1}
              size="small"
              bordered
              items={detailItems(detail)}
            />
            <div style={{ margin: "14px 0" }}>
              {detail.status === "REJECTED" ? (
                <Notice variant="error">
                  该申请已被退回，流程已终止；如需继续办理，请重新提交出海服务申请。
                </Notice>
              ) : (
                <Steps
                  size="small"
                  current={flowIndexOf(detail)}
                  items={flowOf(detail).map((title) => ({ title }))}
                />
              )}
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                备注
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>
                {detail.remark || "—"}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(applyType)}
        title="提交出海服务申请"
        width={560}
        okText="提交申请"
        cancelText="取消"
        confirmLoading={submitting}
        onCancel={() => setApplyType(null)}
        onOk={() => void submit()}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          提交后系统将自动匹配已签约且具备出海服务资质的服务商办理，进度可在本页跟踪。
        </div>
        <Form form={form} layout="vertical">
          <Form.Item
            name="service_type"
            label="服务类型"
            rules={[{ required: true, message: "请选择服务类型" }]}
          >
            <Select
              options={OVERSEAS_SERVICES.map((item) => ({
                value: item.type,
                label: (
                  <>
                    {item.icon} {item.name}
                  </>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="title"
            label="申请标题"
            rules={[{ required: true, message: "请填写申请标题" }]}
          >
            <Input placeholder="如：2026年9月出口退税（报关单 2230xxxx）/ 香港公司注册" />
          </Form.Item>
          <Form.Item name="region" label="办理地区">
            <Input placeholder="如：香港 / 新加坡 / 美国（退税类可留空）" />
          </Form.Item>
          <Form.Item name="currency" label="币种" initialValue="CNY">
            <Select
              options={["CNY", "USD", "EUR", "JPY"].map((item) => ({
                value: item,
                label: item,
              }))}
            />
          </Form.Item>
          <Form.Item name="amount" label="预估金额">
            <Input placeholder="0.00（选填）" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea
              rows={2}
              placeholder="业务背景、商品/地区、特殊要求等说明"
            />
          </Form.Item>
        </Form>
      </Modal>

      <AlertModal
        open={Boolean(unsigned)}
        title="未签约提醒"
        okText="前往跨境出海服务商"
        onOk={onGoCatalog}
        onClose={() => setUnsigned(null)}
        body={`你尚未签约「${unsigned?.name || ""}」服务，无法申请办理。请先到「跨境出海服务商」向提供该服务的出海服务商发起签约，待签约生效后再来申请服务。`}
      />

      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      <ContactEditModal
        target={contactTarget}
        onClose={() => setContactTarget(null)}
      />
    </>
  );
}
