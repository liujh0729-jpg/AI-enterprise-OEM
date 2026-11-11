"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { taxApi } from "@/api/tax";

import {
  BulbOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import { App, Button, Space, Steps, Table } from "antd";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError } from "@enterprise/contracts";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { MaterialPackPanel } from "./material-pack";
import { useTaxBoard } from "@/query/tax";

import {
  contactOf,
  contactText,
  stageEnterpriseContact,
  stageProviderContact,
} from "@/lib/contacts";
import { fmtTime, money } from "./common";

/** 当前属期（YYYY-MM）：与材料录入的默认属期一致。 */
function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 企业视角：报税工作台（demo tax.js workbench）。
 * 三步材料（员工与工资 → 发票 → 银行流水）→ 提交报税 → AI 分类分析 → 分税种提报进度。
 */
export function BoardTab({
  onOpenDecl,
  onOpenMaterial,
  canFile = true,
}: {
  onOpenDecl: (id: number) => void;
  onOpenMaterial: (id: number) => void;
  /** 个人主体只可浏览，报税材料录入与提交（申报办理）锁住。 */
  canFile?: boolean;
}) {
  const tax_submitMaterialPackMutation = useOperationMutation(
    taxApi.submitMaterialPack,
    ["tax", "dashboard"],
  );

  const { message } = App.useApp();
  const period = useMemo(() => currentPeriod(), []);
  const [historyPage, setHistoryPage] = useState(1);
  const boardQuery = useTaxBoard(period, historyPage);
  const pack = boardQuery.data?.pack;
  const history = boardQuery.data?.history ?? [];
  const loading = boardQuery.isPending;
  const load = async () => {
    await boardQuery.refetch();
  };
  const [submitting, setSubmitting] = useState(false);
  /** 环节联系方式（系统按承办人/企业档案自动带出，临时换人可改） */
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );

  const submit = async () => {
    try {
      if (!pack) return;
      setSubmitting(true);
      try {
        const payload = await tax_submitMaterialPackMutation.mutateAsync({
          params: { id: String(pack.id) },
          body: {},
        });

        const tip = payload?.tip || "报税材料已提交";
        message.success(tip);
      } finally {
        setSubmitting(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const analysis = pack?.analysis || null;
  const items = analysis?.tax_items || [];
  const declOf = (taxType: string) =>
    (pack?.decls || []).find((item) => item.tax_type === taxType);
  /** 分税种提报进度：只取本材料包派生的申报单（demo progressCard 口径） */
  const progressRows = (pack?.decls || []).map((row) => ({ ...row }));

  const missing: string[] = [];
  if (!pack?.counts?.payroll) missing.push("员工与工资");
  if (!pack?.counts?.invoices) missing.push("发票");
  if (!pack?.counts?.bank) missing.push("银行流水");
  const doneSteps = [
    pack?.counts?.payroll,
    pack?.counts?.invoices,
    pack?.counts?.bank,
  ].filter(Boolean).length;

  if (boardQuery.isError) {
    // 后端守卫：账号名下没有已认证企业时回 403「请先完善企业信息」，
    // 这不是可重试的故障，引导用户去「身份与资质」补材料而不是给「重试」。
    const needsEnterprise =
      boardQuery.error instanceof ApiError &&
      boardQuery.error.status === 403 &&
      boardQuery.error.message.includes("完善企业信息");
    if (needsEnterprise)
      return (
        <Notice variant="warn">
          报税工作台需以「企业」或「个体工商户」主体办理：请先到「
          <Link href="/identity">身份与资质</Link>
          」完善企业信息并完成认证，认证通过后即可录入材料、提交报税。
        </Notice>
      );
    return (
      <Notice variant="error">
        {boardQuery.error.message}{" "}
        <Button onClick={() => void load()}>重试</Button>
      </Notice>
    );
  }
  return (
    <>
      <Panel
        title={
          <>
            <FileTextOutlined aria-hidden /> 报税工作台
          </>
        }
      >
        <Notice variant="info">
          三步提交材料（员工与工资 → 发票 → 银行流水），提交后 AI
          自动分类分析税种，由服务商核对提报。
        </Notice>
        <Steps
          size="small"
          current={pack?.status === "DRAFT" ? doneSteps : 3}
          items={[
            { title: "员工与工资" },
            { title: "获取发票" },
            { title: "上传流水" },
            { title: "提交报税" },
          ]}
        />
      </Panel>

      {canFile ? (
        <MaterialPackPanel />
      ) : (
        <Panel title="1-3 报税材料录入">
          <Notice variant="warn">
            你是「个人」主体，这里可查看报税流程与 AI 分析结果，但员工工资、发票、银行流水的录入与提交报税属申报办理，需要以「企业」或「个体工商户」主体进行；可在「身份与资质」变更主体类型后重新提交认证，也可以在「财税服务商」资源库浏览机构并申请加入服务商。
          </Notice>
        </Panel>
      )}

      <Panel
        title="4 提交报税"
        extra={
          pack ? (
            <Button onClick={() => onOpenMaterial(pack.id)}>
              查看材料详情
            </Button>
          ) : undefined
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div className="text-12 muted" style={{ flex: 1, minWidth: 260 }}>
            {pack
              ? `${missing.length ? `待完成：${missing.join("、")}` : "三步材料已齐备，可提交报税"}；提交后 AI 财务自动完成税种分类测算，服务商核对后分税种提报，进度实时同步。`
              : "提交后 AI 财务自动完成税种分类测算，服务商核对后分税种提报，进度实时同步。"}
          </div>
          <Space size={8} wrap>
            {canFile ? (
              <>
                <Button
                  type="primary"
                  disabled={!pack || pack.status !== "DRAFT"}
                  loading={submitting || loading}
                  onClick={() => void submit()}
                >
                  提交报税材料
                </Button>
                <Button
                  onClick={() =>
                    message.info(
                      "零申报需先录入员工工资等基础材料（用于个税扣缴零申报），录入后再提交",
                    )
                  }
                >
                  零申报提交
                </Button>
              </>
            ) : null}
          </Space>
        </div>
        {pack ? (
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 10,
            }}
          >
            <span className="text-12">
              企业侧联系方式（联系人/电话）：
              <b>{stageEnterpriseContact(pack)}</b>
            </span>
            <span className="text-12">
              财税承办人联系方式（联系人/电话）：
              <b>{stageProviderContact(pack, "待指派")}</b>
            </span>
            <Button
              onClick={() => {
                const ent = contactOf(pack, "contact");
                const prov = contactOf(pack, "provider_contact");
                setContactTarget({
                  resource: "taxMaterial",
                  id: pack.id,
                  no: pack.packNo,
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
          </div>
        ) : null}
      </Panel>

      <Panel title="✦ AI 分类分析结果">
        <div className="table-wrap">
          <Table
            rowKey="tax_type"
            dataSource={items}
            pagination={false}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<BulbOutlined aria-hidden />}
                  text="材料提交后，此处展示 AI 识别出的应申报税种、分析依据与申报表模板。"
                />
              ),
            }}
            columns={[
              { title: "应申报税种", dataIndex: "name" },
              { title: "AI 分析依据", dataIndex: "reason" },
              {
                title: "预估税额",
                dataIndex: "est_amount",
                render: (value: number) => (
                  <span className="mono">¥{money(value)}</span>
                ),
              },
              { title: "申报表模板", dataIndex: "template" },
              {
                title: "提报状态",
                dataIndex: "tax_type",
                render: (value: string) => {
                  const decl = declOf(value);
                  return decl ? (
                    <StatusBadge domain="taxDeclaration" status={decl.status} />
                  ) : (
                    <span className="badge badge-orange">待提报</span>
                  );
                },
              },
            ]}
          />
        </div>
      </Panel>

      <Panel
        title="4 分税种提报进度"
        titleBadge={
          pack?.status === "DONE"
            ? "已完成"
            : progressRows.length
              ? `${progressRows.length} 项提报中`
              : undefined
        }
      >
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          服务商按税种分类提报，全流程实时反馈：AI处理 → 财务专员确认并审核 →
          申报回执 → 完成扣款
        </div>
        <div className="table-wrap">
          <Table
            rowKey="id"
            dataSource={progressRows}
            pagination={false}
            size="middle"
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<FileTextOutlined aria-hidden />}
                  text={
                    analysis?.zero_declare
                      ? "本期为零申报，无申报单"
                      : "等待服务商核对 AI 分析结果并分类提报…"
                  }
                />
              ),
            }}
            columns={[
              {
                title: "申报单号",
                dataIndex: "decl_no",
                width: 150,
                render: (value: string) => (
                  <span className="mono text-12">{value || "—"}</span>
                ),
              },
              { title: "税种", dataIndex: "tax_type_name", width: 190 },
              {
                title: "预估税额",
                dataIndex: "tax_amount",
                width: 120,
                render: (value: unknown) => (
                  <span className="mono">¥{money(value)}</span>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 200,
                render: (value: string) => (
                  <StatusBadge domain="taxDeclaration" status={value} />
                ),
              },
              {
                title: "承办人联系方式",
                dataIndex: "provider_contact_name",
                width: 180,
                ellipsis: true,
                render: (_, row) => (
                  <span className="text-12">
                    {contactText(
                      row.provider_contact_name,
                      row.provider_contact_phone,
                      "待指派",
                    )}
                  </span>
                ),
              },
              {
                title: "回执号",
                dataIndex: "receipt_no",
                width: 140,
                render: (value: string) => (
                  <span className="mono text-12">{value || "—"}</span>
                ),
              },
              {
                title: "操作",
                width: 180,
                render: (_, row) => (
                  <Space size={6} wrap>
                    <Button onClick={() => onOpenDecl(row.id)}>查看</Button>
                    <Button
                      onClick={() => {
                        const ent = contactOf(row, "contact");
                        const prov = contactOf(row, "provider_contact");
                        setContactTarget({
                          resource: "taxDeclaration",
                          id: row.id,
                          no: row.decl_no,
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
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Panel
        title={
          <>
            <FolderOpenOutlined aria-hidden /> 历史报税材料
          </>
        }
        titleBadge={boardQuery.data?.total || undefined}
      >
        {history.length ? (
          <div className="table-wrap">
            <Table<
              NonNullable<
                import("@enterprise/contracts").EndpointResponse<"Tax_materialPacks">["data"]
              >[number]
            >
              rowKey="id"
              size="middle"
              pagination={{
                current: historyPage,
                pageSize: 20,
                total: boardQuery.data?.total ?? 0,
                onChange: setHistoryPage,
                showSizeChanger: false,
              }}
              dataSource={history}
              columns={[
                {
                  title: "属期",
                  dataIndex: "period",
                  width: 110,
                  render: (value: string) => (
                    <span className="fw-600 text-13">{value} 属期</span>
                  ),
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 170,
                  render: (value: string) => (
                    <StatusBadge domain="taxMaterial" status={value} />
                  ),
                },
                {
                  title: "材料摘要",
                  dataIndex: "counts",
                  render: (_, row) =>
                    `员工 ${row.counts?.payroll || 0} · 发票 ${
                      row.counts?.invoices || 0
                    } · 流水 ${row.counts?.bank || 0}`,
                },
                {
                  title: "提交时间",
                  dataIndex: "submitted_at",
                  width: 160,
                  render: (value: string | null, row) => (
                    <span className="text-12 muted">
                      {fmtTime(value || row.created_at || "")}
                    </span>
                  ),
                },
                {
                  title: "操作",
                  width: 100,
                  render: (_, row) => (
                    <Button onClick={() => onOpenMaterial(row.id)}>查看</Button>
                  ),
                },
              ]}
            />
          </div>
        ) : (
          <EmptyState
            icon={<FolderOpenOutlined aria-hidden />}
            text="暂无历史报税材料"
          />
        )}
      </Panel>

      <ContactEditModal
        target={contactTarget}
        onClose={() => setContactTarget(null)}
      />
    </>
  );
}
