"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { taxApi } from "@/api/tax";

import {
  CheckCircleOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  RobotOutlined,
  SolutionOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { App, Button, Checkbox, Input, Modal, Space, Steps } from "antd";
import { useState } from "react";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { StatusBadge } from "@/components/status-badge";
import { Notice, Panel } from "@/components/ui/panel";

import {
  contactOf,
  stageEnterpriseContact,
  stageProviderContact,
} from "@/lib/contacts";
import {
  DECL_STEP_INDEX,
  declFormFields,
  fmtTime,
  money,
  taxTypeLabel,
  type TaxDeclaration,
  type TaxMeta,
} from "./common";
import { ExternalChannelPanel } from "./external-channel";

/** 申报表基础信息（demo tax-forms.js basicHeader）。 */
type DeclBasic = { taxpayerName?: string; uscc?: string; period?: string };

/**
 * 申报单详情（demo tax-form.js）：国标申报表 + AI 财务闭环流水线。
 * 状态机：DRAFT →(AI自动处理)→ SUBMITTED →(财务专员确认并审核)→ FILED →(扣款)→ PAID；驳回 → REJECTED
 */
export function DeclarationDetail({
  decl,
  meta,
  canWork,
  canWrite,
  onBack,
  reload,
}: {
  decl: TaxDeclaration;
  meta: TaxMeta;
  /** 承办人/管理员：可推进（AI 自动处理、审核）。 */
  canWork: boolean;
  /** 可写草稿与联系方式：承办人/管理员/本企业当事人；服务商账号对自己名下申报单只读。 */
  canWrite: boolean;
  onBack: () => void;
  reload: () => Promise<void>;
}) {
  const tax_formMutation = useOperationMutation(taxApi.form, [
    "tax",
    "dashboard",
  ]);
  const tax_runAiMutation = useOperationMutation(taxApi.runAi, [
    "tax",
    "dashboard",
  ]);
  const tax_qcMutation = useOperationMutation(taxApi.qc, ["tax", "dashboard"]);

  const { message } = App.useApp();
  const fields = declFormFields(decl.taxType);
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    fields.forEach((field) => {
      init[field.name] = Number(decl.formData?.[field.name] || 0);
    });
    return init;
  });
  const [basic, setBasic] = useState<DeclBasic>(() => {
    const source = (decl.formData?.basic || {}) as DeclBasic;
    return {
      taxpayerName: source.taxpayerName || "",
      uscc: source.uscc || "",
      period: source.period || decl.period || "",
    };
  });
  const [note, setNote] = useState("");
  const checks = meta.advisor_checks.length
    ? meta.advisor_checks
    : decl.advisorConfirms || [];
  const [confirmed, setConfirmed] = useState<string[]>(
    decl.advisorConfirms || [],
  );
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [auditing, setAuditing] = useState(false);
  /** AI 流水线确认弹窗（demo：运行前二次确认） */
  const [aiConfirmOpen, setAiConfirmOpen] = useState(false);
  /** 环节联系方式（系统按承办人/企业档案自动带出，临时换人可改） */
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );

  const editable = decl.status === "DRAFT";
  const stepIndex = DECL_STEP_INDEX[decl.status] ?? 0;
  const steps = decl.aiSteps || [];
  const knownTaxType = meta.forms.some((item) => item.type === decl.taxType);

  const saveDraft = async () => {
    try {
      setSaving(true);
      try {
        await tax_formMutation.mutateAsync({
          params: { id: String(decl.id) },
          body: { ...values, basic },
        });

        message.success("草稿已保存");
      } finally {
        setSaving(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const runAi = async () => {
    try {
      setAiConfirmOpen(false);
      setRunning(true);
      try {
        await tax_runAiMutation.mutateAsync({
          params: { id: String(decl.id) },
        });

        message.success("AI 处理完成，等待财务专员确认并审核");
      } finally {
        setRunning(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const audit = async (action: "PASS" | "REJECT") => {
    try {
      if (confirmed.length < checks.length) {
        message.warning("请先完成全部核对确认项");
        return;
      }
      setAuditing(true);
      try {
        const payload = await tax_qcMutation.mutateAsync({
          params: { id: String(decl.id) },
          body: { action, confirms: confirmed, note },
        });

        if (action === "PASS") {
          const tip = payload?.tip;
          message.success(tip || "已申报，请按「外报通道」指引报送");
        } else {
          message.success("已驳回，请修改后重新提交");
        }
      } finally {
        setAuditing(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <Panel
        title={decl.title || decl.declNo}
        titleBadge={
          <StatusBadge domain="taxDeclaration" status={decl.status} />
        }
        extra={
          <Space size={6} wrap>
            <Button onClick={onBack}>← 返回列表</Button>
            <Button
              onClick={() => {
                if (editable && canWrite) void saveDraft();
                if (typeof window !== "undefined") window.print();
              }}
            >
              <PrinterOutlined aria-hidden /> 打印预览
            </Button>
            <Button
              disabled={!editable || !canWrite}
              loading={saving}
              onClick={() => void saveDraft()}
            >
              保存草稿
            </Button>
            {canWork ? (
              <Button
                type="primary"
                disabled={!editable}
                loading={running}
                onClick={() => setAiConfirmOpen(true)}
              >
                <PlayCircleOutlined aria-hidden /> 运行 AI 自动处理
              </Button>
            ) : null}
          </Space>
        }
      >
        <div className="text-12 muted">
          申报单号 {decl.declNo || "—"} · {taxTypeLabel(meta, decl.taxType)} ·
          所属期 {decl.period || "—"} · 更新时间 {fmtTime(decl.updatedAt)}
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <span className="text-12">
            企业侧联系方式（联系人/电话）：
            <b>{stageEnterpriseContact(decl)}</b>
          </span>
          <span className="text-12">
            财税承办人联系方式（联系人/电话）：
            <b>{stageProviderContact(decl, "待指派")}</b>
          </span>
          {canWrite ? (
            <Button
              onClick={() => {
                const ent = contactOf(decl, "contact");
                const prov = contactOf(decl, "provider_contact");
                setContactTarget({
                  resource: "taxDeclaration",
                  id: decl.id,
                  no: decl.declNo,
                  contactName: ent.name,
                  contactPhone: ent.phone,
                  providerContactName: prov.name,
                  providerContactPhone: prov.phone,
                  partyLabel: "企业侧",
                  providerLabel: "财税承办人",
                });
              }}
            >
              改联系方式
            </Button>
          ) : null}
        </div>
        {!knownTaxType ? (
          <div style={{ marginTop: 12 }}>
            <Notice variant="error">
              未知税种：{decl.taxType || "—"}
              （该税种不在系统申报表模板清单内，请联系服务商核对申报单数据）
            </Notice>
          </div>
        ) : null}
        <div style={{ marginTop: 14 }}>
          {decl.status === "REJECTED" ? (
            <Notice variant="error">
              <div style={{ fontWeight: 600 }}>
                <WarningOutlined aria-hidden /> 申报单被财务专员审核驳回
              </div>
              <div className="text-12" style={{ marginTop: 4 }}>
                {decl.qcNote || "财务专员未填写驳回原因，请与服务商联系。"}
              </div>
            </Notice>
          ) : (
            <Steps
              size="small"
              current={stepIndex}
              items={[
                { title: "草稿填写" },
                { title: "AI 自动处理" },
                { title: "财务专员确认并审核" },
                { title: "申报完成" },
                { title: "税款扣缴" },
              ]}
            />
          )}
        </div>
      </Panel>

      <Panel
        title={`申报表 · ${taxTypeLabel(meta, decl.taxType)}（${decl.period || "—"}）`}
        titleBadge={`应纳税（费）额合计 ¥${money(decl.taxAmount)}`}
      >
        <div className="form-2col">
          <div style={{ marginBottom: 12 }}>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              纳税人名称
            </div>
            <Input
              value={basic.taxpayerName}
              disabled={!editable}
              placeholder="企业名称"
              onChange={(event) =>
                setBasic((current) => ({
                  ...current,
                  taxpayerName: event.target.value,
                }))
              }
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              纳税人识别号
            </div>
            <Input
              value={basic.uscc}
              disabled={!editable}
              placeholder="统一社会信用代码"
              onChange={(event) =>
                setBasic((current) => ({
                  ...current,
                  uscc: event.target.value,
                }))
              }
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              税款所属期
            </div>
            <Input
              value={basic.period}
              disabled={!editable}
              placeholder="如 2026-10-01 至 2026-12-31"
              onChange={(event) =>
                setBasic((current) => ({
                  ...current,
                  period: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className="form-2col">
          {fields.map((field) => (
            <div key={field.name} style={{ marginBottom: 12 }}>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                {field.label}
              </div>
              <Input
                value={String(values[field.name] ?? 0)}
                disabled={!editable}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.name]:
                      Number(event.target.value.replace(/[^\d.-]/g, "")) || 0,
                  }))
                }
              />
            </div>
          ))}
        </div>
        {!editable ? (
          <p className="text-12 muted" style={{ margin: 0 }}>
            当前状态不可编辑（仅草稿可填写）
          </p>
        ) : null}
      </Panel>

      <Panel
        title={
          <>
            <RobotOutlined aria-hidden /> AI 财务自动化流水线
          </>
        }
        titleBadge={
          steps.length
            ? `${steps.filter((item) => item.status === "DONE").length}/${steps.length}`
            : undefined
        }
      >
        {steps.length ? (
          <div>
            {steps.map((item, index) => (
              <div
                key={index}
                style={{ display: "flex", gap: 8, marginBottom: 10 }}
              >
                <span className="badge badge-green">
                  {item.status === "DONE" ? "✓" : "○"}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {index + 1}. {item.text || "—"}
                  </div>
                  {item.note ? (
                    <div className="text-12 muted">{item.note}</div>
                  ) : null}
                  {item.at ? (
                    <div className="text-12 muted">
                      完成于 {fmtTime(item.at)}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-12 muted">
            尚未运行 AI 处理。运行后此处将展示 8
            步自动化流水线执行结果（采集字段 → 核对税号 → 计税 → 勾稽校验 →
            生成草稿 → 风险扫描 → 回写试算 → 等待财务专员确认）。
          </div>
        )}
      </Panel>

      <Panel
        title={
          <>
            <SolutionOutlined aria-hidden /> 财务专员确认并审核
          </>
        }
        titleBadge={
          checks.length ? `${confirmed.length}/${checks.length}` : undefined
        }
      >
        {checks.length ? (
          <Checkbox.Group
            value={confirmed}
            disabled={!canWork}
            onChange={(value) => setConfirmed(value as string[])}
            options={checks.map((item) => ({ label: item, value: item }))}
          />
        ) : (
          <div className="text-12 muted">
            AI
            处理后由财务专员对发票、银行、工资、税款预估、税款确认、社保、完税通知
            7 项逐一核对。
          </div>
        )}
        {decl.qcStatus && decl.qcStatus !== "PENDING" ? (
          <div style={{ marginTop: 10 }}>
            <StatusBadge status={decl.qcStatus} />
            <div className="text-12 muted" style={{ marginTop: 6 }}>
              {decl.qcNote}
            </div>
          </div>
        ) : null}
        {canWork ? (
          <div style={{ marginTop: 12 }}>
            <Input.TextArea
              rows={2}
              value={note}
              placeholder="审核意见（可选）"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        ) : null}
        {canWork ? (
          <Space size={8} style={{ marginTop: 8 }} wrap>
            <Button
              danger
              disabled={!["SUBMITTED", "CHECKING"].includes(decl.status)}
              loading={auditing}
              onClick={() => void audit("REJECT")}
            >
              驳回重做
            </Button>
            <Button
              type="primary"
              disabled={!["SUBMITTED", "CHECKING"].includes(decl.status)}
              loading={auditing}
              onClick={() => void audit("PASS")}
            >
              <CheckCircleOutlined aria-hidden /> 确认并审核·正式申报
            </Button>
          </Space>
        ) : (
          <p
            className="text-12 muted"
            style={{ marginTop: 10, marginBottom: 0 }}
          >
            确认并审核与扣款由承办人执行（企业侧只读）。
          </p>
        )}
        {decl.status === "REJECTED" ? (
          <p
            className="text-12 muted"
            style={{ marginTop: 10, marginBottom: 0 }}
          >
            该申报单已被驳回，请联系服务商重新发起或修改。
          </p>
        ) : null}
      </Panel>

      <ExternalChannelPanel
        declId={decl.id}
        declStatus={decl.status}
        canWork={canWork}
        reload={reload}
      />

      <ContactEditModal
        target={contactTarget}
        onClose={() => setContactTarget(null)}
      />

      <Modal
        open={aiConfirmOpen}
        title="运行 AI 财务自动化流水线"
        width={560}
        okText="开始处理"
        cancelText="取消"
        confirmLoading={running}
        onCancel={() => setAiConfirmOpen(false)}
        onOk={() => void runAi()}
      >
        将按「票据清册 → 发票采集 → 勾选认证 → 自动记账 → 自动出报表 → 智能质检
        → 自动报税 → 自动检查」8
        步处理完成本申报单，处理完成后进入财务专员确认并审核环节。确定运行吗？
      </Modal>
    </>
  );
}
