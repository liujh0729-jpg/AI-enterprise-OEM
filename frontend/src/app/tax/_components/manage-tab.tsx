"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";

import {
  CalendarOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Space, Table } from "antd";
import { useCallback, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";

import { usePasswordConfirm } from "@/components/confirm-with-password";
import { useTaxDeclarations, useMaterialPacks } from "@/query/tax";
import { taxApi } from "@/api/tax";
import { useBusinessQuery } from "@/query/business";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { contactOf } from "@/lib/contacts";
import { AutoTaxPanel } from "./auto-tax-panel";
import { InvoiceRequestPanel } from "./invoice-request";
import { MaterialDetail } from "./material-detail";
import {
  fmtTime,
  money,
  taxTypeLabel,
  type AccountSetRow,
  type ContractRow,
  type TaxDeclaration,
  type TaxMeta,
} from "./common";

/** 后端 /enterprise/tax/materials 行（demo 报税材料包）。 */
type MaterialRow = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Tax_materialPacks">["data"]
>[number];

/** 申报计划行（对齐 demo /api/tax/plans → decoratePlan 的税种级任务）。 */
type PlanRow = {
  id: number;
  enterpriseId: number;
  enterpriseName: string;
  period: string;
  taxType: string;
  taxTypeName: string;
  freq?: string;
  template?: string;
  accountSetName?: string;
  staffName?: string;
  staffUserId?: string;
  status: string;
  declId?: number;
};

export function ManageTab({
  view,
  sets,
  setTotal,
  setPage,
  onSetPage,
  contracts,
  meta,
  currentUserId,
  enterpriseId,
  staffOf,
  isAdmin = false,
  canCreateSet,
  reload,
  onOpenDecl,
}: {
  view: string;
  sets: AccountSetRow[];
  setTotal: number;
  setPage: number;
  onSetPage: (page: number) => void;
  contracts: ContractRow[];
  meta: TaxMeta;
  currentUserId: string;
  enterpriseId: number;
  staffOf?: unknown[];
  isAdmin?: boolean;
  canCreateSet: boolean;
  reload: () => Promise<void>;
  onOpenDecl: (id: number) => void;
}) {
  const tax_archiveSetMutation = useOperationMutation(taxApi.archiveSet, [
    "tax",
    "dashboard",
  ]);
  const tax_createSetMutation = useOperationMutation(taxApi.createSet, [
    "tax",
    "dashboard",
  ]);

  const { message } = App.useApp();
  const [setOpen, setSetOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [setForm] = Form.useForm();
  const [declSet, setDeclSet] = useState<AccountSetRow | null>(null);
  const [declPage, setDeclPage] = useState(1);
  const declarationsQuery = useTaxDeclarations(
    declSet?.enterpriseId ?? 0,
    declPage,
    !!declSet,
  );
  /** 报税材料详情（demo tax-material.js：材料回显 + AI 分析 + 分税种提报） */
  const [detailId, setDetailId] = useState<number | null>(null);
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const [packPage, setPackPage] = useState(1);
  const packsQuery = useMaterialPacks(packPage, view === "materials");
  const packs = packsQuery.data?.list ?? [];
  const { refetch: refetchPacks } = packsQuery;
  const loadPacks = useCallback(async () => {
    await refetchPacks();
  }, [refetchPacks]);
  /** 环节联系方式（系统自动带出，临时换人可改） */
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );

  const enterpriseNameOf = (id: number) =>
    contracts.find((item) => Number(item.enterpriseId) === Number(id))
      ?.enterpriseName || "—";

  if (view === "materials") {
    if (detailId) {
      return (
        <MaterialDetail
          packId={detailId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canTouchContacts={isAdmin || (staffOf || []).length > 0}
          onBack={() => setDetailId(null)}
          onOpenDecl={onOpenDecl}
          reload={reload}
        />
      );
    }
    const materials = packs;
    return (
      <>
        <Panel
          title="企业报税材料"
          titleBadge={`${packsQuery.data?.total ?? 0} 条`}
        >
          <Notice variant="info">
            企业按「员工与工资 → 发票 → 银行流水」逐条提交材料后在此展示；
            点「查看」核对 AI 分类分析结果，确认后点「核对提报」生成申报单。
          </Notice>
          <div className="table-wrap">
            <Table<MaterialRow>
              rowKey="id"
              dataSource={materials}
              loading={packsQuery.isPending}
              pagination={{
                current: packPage,
                pageSize: 20,
                total: packsQuery.data?.total ?? 0,
                onChange: setPackPage,
                showSizeChanger: false,
              }}
              size="middle"
              locale={{
                emptyText: (
                  <EmptyState
                    icon={<DownloadOutlined aria-hidden />}
                    text="暂无报税材料，企业提交报税材料后将在此展示，供服务商核对与提报"
                  />
                ),
              }}
              columns={[
                {
                  title: "材料编号",
                  dataIndex: "packNo",
                  width: 170,
                  render: (value: string) => (
                    <span className="mono text-12">{value}</span>
                  ),
                },
                {
                  title: "企业",
                  width: 160,
                  render: (_, row) => enterpriseNameOf(row.enterpriseId),
                },
                { title: "属期", dataIndex: "period", width: 110 },
                {
                  title: "材料摘要",
                  width: 240,
                  render: (_, row) =>
                    `员工 ${row.counts?.payroll || 0} · 发票 ${row.counts?.invoices || 0} · 流水 ${row.counts?.bank || 0}`,
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 190,
                  render: (value: string) => (
                    <StatusBadge domain="taxMaterial" status={value} />
                  ),
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
                  title: "承办职员",
                  width: 120,
                  render: (_: unknown, row: Record<string, unknown>) => {
                    const staffUserId = String(row.staffUserId || "");
                    if (!staffUserId) {
                      return <span className="badge badge-orange">未指派</span>;
                    }
                    return staffUserId === currentUserId ? (
                      <span className="badge badge-green">我承办</span>
                    ) : (
                      <span className="badge badge-gray">已指派职员</span>
                    );
                  },
                },
                {
                  title: "操作",
                  width: 180,
                  render: (_: unknown, row: MaterialRow) => {
                    // 核对提报是「服务商为本企业指派的承办职员」的作业；材料详情两者皆可查看
                    const isMyWork =
                      Boolean(row.staffUserId) &&
                      row.staffUserId === currentUserId;
                    // demo 口径：仅「AI 分析完成」的材料可分类提报
                    const needProvide = isMyWork && row.status === "ANALYZED";
                    return (
                      <Space size={6} wrap>
                        {needProvide ? (
                          <Button
                            type="primary"
                            onClick={() => setDetailId(row.id)}
                          >
                            核对提报
                          </Button>
                        ) : null}
                        <Button onClick={() => setDetailId(row.id)}>
                          查看
                        </Button>
                        <Button
                          onClick={() => {
                            const ent = contactOf(row, "contact");
                            const prov = contactOf(row, "provider_contact");
                            setContactTarget({
                              resource: "taxMaterial",
                              id: row.id,
                              no: row.packNo,
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
                    );
                  },
                },
              ]}
            />
          </div>
        </Panel>

        {packsQuery.isError ? (
          <Notice variant="error">
            {packsQuery.error.message}{" "}
            <Button onClick={() => void loadPacks()}>重试</Button>
          </Notice>
        ) : null}
        <ContactEditModal
          target={contactTarget}
          onClose={() => setContactTarget(null)}
        />
      </>
    );
  }

  if (view === "sets") {
    const activeClients = contracts.filter(
      (item) => item.status === "ACTIVE" && item.serviceType === "TAX_FINANCE",
    );
    return (
      <>
        <Panel
          title="企业账套"
          titleBadge={
            <span className="text-12 muted">
              账套对应企业一套独立的总账核算体系，与纳税申报构成闭环：账套 →
              申报计划（按企业性质与申报频率自动生成）→ 申报单填写提报 →
              申报完成回写账套进度；存在未办结申报计划时不可归档 · 共 {setTotal}{" "}
              个
            </span>
          }
          extra={
            canCreateSet ? (
              <Button
                type="primary"
                onClick={() => {
                  setForm.resetFields();
                  setSetOpen(true);
                }}
              >
                ＋ 新建账套
              </Button>
            ) : undefined
          }
        >
          <div className="table-wrap">
            <Table<AccountSetRow>
              rowKey="id"
              dataSource={sets}
              pagination={{
                current: setPage,
                pageSize: 20,
                total: setTotal,
                onChange: onSetPage,
                showSizeChanger: false,
              }}
              size="middle"
              scroll={{ x: "max-content" }}
              locale={{
                emptyText: (
                  <EmptyState
                    icon={<FolderOpenOutlined aria-hidden />}
                    text="暂无账套，为已签约企业创建账套（账套与申报闭环：申报计划将挂接在用账套作为申报依据来源）"
                  />
                ),
              }}
              columns={[
                {
                  title: "账套名称",
                  dataIndex: "name",
                  width: 200,
                  render: (value: string) => (
                    <span style={{ fontWeight: 600 }}>{value}</span>
                  ),
                },
                {
                  title: "企业",
                  width: 150,
                  render: (_, row) => enterpriseNameOf(row.enterpriseId),
                },
                {
                  title: "申报进度（待/进行/完成）",
                  width: 230,
                  render: (_, row) => (
                    <Space size={4} wrap>
                      <span className="badge badge-orange">
                        待 {row.plan_stats?.due || 0}
                      </span>
                      <span className="badge badge-sky">
                        进行 {row.plan_stats?.in_progress || 0}
                      </span>
                      <span className="badge badge-green">
                        完成 {row.plan_stats?.done || 0}
                      </span>
                    </Space>
                  ),
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 110,
                  render: (value: string) => <StatusBadge status={value} />,
                },
                {
                  title: "创建时间",
                  dataIndex: "createdAt",
                  width: 150,
                  render: (value: string) => (
                    <span className="text-12">{fmtTime(value)}</span>
                  ),
                },
                {
                  title: "操作",
                  width: 220,
                  render: (_, row) => (
                    <Space size={6} wrap>
                      <Button
                        onClick={() => {
                          setDeclSet(row);
                          setDeclPage(1);
                        }}
                      >
                        申报明细（{row.decl_summary?.count || 0}）
                      </Button>
                      {row.status === "ACTIVE" && canCreateSet ? (
                        <Button
                          danger
                          onClick={() =>
                            requestPassword({
                              title: "归档账套",
                              danger: true,
                              content: (
                                <div>
                                  归档「
                                  <b>{String(row.name)}</b>
                                  」后该账套不再参与新的申报，历史申报依据仍可查询。
                                  存在未办结申报计划时无法归档。确定归档吗？
                                </div>
                              ),
                              onOk: async () => {
                                await tax_archiveSetMutation.mutateAsync({
                                  params: { id: String(row.id) },
                                });

                                message.success("账套已归档");
                              },
                            })
                          }
                        >
                          归档
                        </Button>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </Panel>

        {passwordModal}

        <Modal
          open={Boolean(declSet)}
          title={`申报明细 · ${declSet ? enterpriseNameOf(declSet.enterpriseId) : ""}`}
          width={720}
          footer={null}
          onCancel={() => setDeclSet(null)}
        >
          {declarationsQuery.isError ? (
            <Notice variant="error">
              {declarationsQuery.error.message}{" "}
              <Button onClick={() => void declarationsQuery.refetch()}>
                重试
              </Button>
            </Notice>
          ) : null}
          <p className="text-12 muted" style={{ marginTop: 0 }}>
            「{declSet ? enterpriseNameOf(declSet.enterpriseId) : ""}
            」账套已申报 {declSet?.decl_summary?.count || 0}{" "}
            份；申报计划：待申报 {declSet?.plan_stats?.due || 0} · 申报中{" "}
            {declSet?.plan_stats?.in_progress || 0} · 已完成{" "}
            {declSet?.plan_stats?.done || 0}
          </p>
          <div className="table-wrap">
            <Table<TaxDeclaration>
              rowKey="id"
              dataSource={declarationsQuery.data?.list ?? []}
              loading={declarationsQuery.isPending}
              pagination={{
                current: declPage,
                pageSize: 20,
                total: declarationsQuery.data?.total ?? 0,
                showSizeChanger: false,
                onChange: setDeclPage,
              }}
              size="middle"
              locale={{
                emptyText: (
                  <EmptyState
                    icon={<FileTextOutlined aria-hidden />}
                    text="该企业暂无申报单。可在「申报计划」中按税种点「去填写」生成申报单后填写提报，申报完成自动回写账套进度。"
                  />
                ),
              }}
              columns={[
                {
                  title: "申报单号",
                  dataIndex: "declNo",
                  render: (value: string) => (
                    <span className="mono text-12">{value}</span>
                  ),
                },
                {
                  title: "税种",
                  dataIndex: "taxType",
                  render: (value: string) => taxTypeLabel(meta, value),
                },
                { title: "所属期", dataIndex: "period", width: 110 },
                {
                  title: "税额",
                  dataIndex: "taxAmount",
                  width: 130,
                  render: (value: string) => (
                    <span className="mono">¥{money(value)}</span>
                  ),
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 190,
                  render: (value: string) => (
                    <StatusBadge domain="taxDeclaration" status={value} />
                  ),
                },
              ]}
            />
          </div>
        </Modal>

        <Modal
          open={setOpen}
          title="新建账套"
          width={480}
          okText="创建账套"
          cancelText="取消"
          confirmLoading={creating}
          onCancel={() => setSetOpen(false)}
          onOk={async () => {
            try {
              if (!activeClients.length) {
                message.warning("没有生效签约的服务企业");
                return;
              }
              const values = await setForm.validateFields();
              setCreating(true);
              try {
                await tax_createSetMutation.mutateAsync({
                  body: {
                    name: values.name,
                    enterpriseId: values.enterpriseId,
                  },
                });

                message.success("账套已创建");
                setSetOpen(false);
              } finally {
                setCreating(false);
              }
            } catch (error) {
              if (error instanceof Error)
                presentMutationError(error, (text) => message.error(text));
            }
          }}
        >
          <Form
            form={setForm}
            layout="vertical"
            initialValues={{ enterpriseId: activeClients[0]?.enterpriseId }}
          >
            <Form.Item name="enterpriseId" label="服务企业">
              <Select
                options={activeClients.map((item) => ({
                  value: item.enterpriseId,
                  label: item.enterpriseName,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="name"
              label="账套名称"
              rules={[{ required: true, message: "请填写账套名称" }]}
            >
              <Input placeholder="如：2026年度总账账套" />
            </Form.Item>
          </Form>
        </Modal>
      </>
    );
  }

  // 自动化能力（电子报税/电子开票）：平台开通后财务人员可自动申报/自动开票
  if (view === "auto") {
    return (
      <>
        <AutoTaxPanel
          enterpriseId={enterpriseId}
          enterpriseName={
            contracts.find(
              (item) => Number(item.enterpriseId) === Number(enterpriseId),
            )?.enterpriseName || ""
          }
        />
        <InvoiceRequestPanel mode="REVIEW" />
      </>
    );
  }

  // 申报计划：按签约企业 × 所属期 × 税种一张总表（企业/承办职员/所属期合并单元格）；
  // 计划在申报期按纳税人性质与申报频率自动生成，无需手动触发
  return (
    <PlansView
      contracts={contracts}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      onOpenDecl={onOpenDecl}
      reload={reload}
    />
  );
}

function PlansView({
  contracts,
  currentUserId,
  isAdmin = false,
  onOpenDecl,
}: {
  contracts: ContractRow[];
  currentUserId: string;
  isAdmin?: boolean;
  onOpenDecl: (id: number) => void;
  reload: () => Promise<void>;
}) {
  const tax_fromPlanMutation = useOperationMutation(taxApi.fromPlan, [
    "tax",
    "dashboard",
  ]);

  const { message } = App.useApp();
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 });
  const planQuery = useBusinessQuery("tax", "plans", pagination, (signal) =>
    taxApi.planList({ query: pagination }, { signal }),
  );
  const statsQuery = useBusinessQuery("tax", "plan-stats", {}, (signal) =>
    taxApi.planStats({}, { signal }),
  );
  const planLoading = planQuery.isPending;
  const plans: PlanRow[] = (planQuery.data?.list || []).map((row) => ({
    id: row.id,
    enterpriseId: row.enterpriseId,
    enterpriseName: row.enterprise_name || "—",
    period: row.period,
    taxType: row.taxType,
    taxTypeName: row.tax_type_name || row.taxType,
    freq: row.freq || "",
    template: row.template || "",
    accountSetName: row.account_set_name || "",
    staffName: row.staff_name || "",
    staffUserId: row.staffUserId || "",
    status: row.status,
    declId: row.declarationId || undefined,
  }));

  /** 层级＝服务企业 → 所属期 → 税种（企业列表按签约企业来）；前两级按组合并单元格。 */
  const byEnterprise = new Map<number, PlanRow[]>();
  plans.forEach((plan) => {
    const list = byEnterprise.get(plan.enterpriseId);
    if (list) list.push(plan);
    else byEnterprise.set(plan.enterpriseId, [plan]);
  });
  const flatRows: {
    key: number;
    plan: PlanRow;
    enterpriseSpan: number;
    periodSpan: number;
  }[] = [];
  byEnterprise.forEach((list) => {
    const byPeriod = new Map<string, PlanRow[]>();
    list.forEach((plan) => {
      const period = plan.period || "—";
      const rows = byPeriod.get(period);
      if (rows) rows.push(plan);
      else byPeriod.set(period, [plan]);
    });
    let enterpriseStarted = false;
    byPeriod.forEach((rows) => {
      rows.forEach((plan, index) => {
        flatRows.push({
          key: plan.id,
          plan,
          enterpriseSpan: enterpriseStarted ? 0 : list.length,
          periodSpan: index === 0 ? rows.length : 0,
        });
        enterpriseStarted = true;
      });
    });
  });

  const enterpriseNameOf = (id: number) =>
    contracts.find((item) => Number(item.enterpriseId) === Number(id))
      ?.enterpriseName || "—";

  /** 计划「去填写」需本人是该计划的承办职员（与服务端同口径），服务商账号不代替承办人作业。 */
  const canFill = (plan: PlanRow) =>
    isAdmin || (!!plan.staffUserId && plan.staffUserId === currentUserId);

  /** 计划「去填写」：生成/复用该税种申报单并打开填写。 */
  const goFill = async (row: PlanRow) => {
    try {
      const payload = await tax_fromPlanMutation.mutateAsync({
        params: { id: String(row.id) },
      });

      const data = payload;
      message.success(
        data?.existing
          ? "该税种申报单已存在，直接打开填写"
          : "已按该税种生成申报单，请在申报单中填写提报",
      );

      if (data?.id) onOpenDecl(data.id);
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const dueCount = statsQuery.data?.due ?? "—";
  const doingCount = statsQuery.data?.in_progress ?? "—";
  const doneCount = statsQuery.data?.done ?? "—";

  type FlatRow = {
    key: number;
    plan: PlanRow;
    enterpriseSpan: number;
    periodSpan: number;
  };

  return (
    <Panel
      title="申报计划"
      titleBadge={
        <span className="text-12 muted">
          计划按签约企业的纳税人性质（一般/小规模）与申报频率（月/季/年）在申报期自动生成：共{" "}
          {statsQuery.data?.enterpriseCount ?? "—"} 家服务企业 ·{" "}
          {planQuery.data?.total ?? "—"} 个应申报税种（待申报 {dueCount} ·
          申报中 {doingCount} · 已完成 {doneCount}）；按企业 → 所属期 →
          税种查看进度，可直接进入该税种的申报单
        </span>
      }
    >
      {(planQuery.error || statsQuery.error) && (
        <Notice variant="error">
          {planQuery.error?.message || statsQuery.error?.message}
        </Notice>
      )}
      <div className="table-wrap">
        <Table<FlatRow>
          rowKey="key"
          dataSource={flatRows}
          loading={planLoading}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total: planQuery.data?.total || 0,
            showSizeChanger: true,
            onChange: (page, pageSize) => setPagination({ page, pageSize }),
          }}
          size="middle"
          locale={{
            emptyText: (
              <EmptyState
                icon={<CalendarOutlined aria-hidden />}
                text="暂无申报计划。计划由系统按签约企业的纳税人性质（一般/小规模）与申报频率（月报/季报/年报）在申报期自动生成：到达申报期后，这里会自然出现该企业该所属期的应申报税种任务，无需手动生成。"
              />
            ),
          }}
          columns={[
            {
              title: "服务企业",
              width: 200,
              onCell: (row: FlatRow) => ({ rowSpan: row.enterpriseSpan }),
              render: (_: unknown, row: FlatRow) => (
                <span style={{ fontWeight: 600 }}>
                  {row.plan.enterpriseName !== "—"
                    ? row.plan.enterpriseName
                    : enterpriseNameOf(row.plan.enterpriseId)}
                </span>
              ),
            },
            {
              title: "财税承办职员",
              width: 120,
              onCell: (row: FlatRow) => ({ rowSpan: row.enterpriseSpan }),
              render: (_: unknown, row: FlatRow) => (
                <span className="text-12">{row.plan.staffName || "—"}</span>
              ),
            },
            {
              title: "所属期",
              width: 110,
              onCell: (row: FlatRow) => ({ rowSpan: row.periodSpan }),
              render: (_: unknown, row: FlatRow) => (
                <span className="mono text-12">{row.plan.period}</span>
              ),
            },
            {
              title: "税种",
              width: 180,
              render: (_: unknown, row: FlatRow) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{row.plan.taxTypeName}</div>
                  <div className="text-12 muted">
                    {row.plan.freq ? `申报频率：${row.plan.freq}` : "—"}
                  </div>
                </div>
              ),
            },
            {
              title: "申报模板",
              width: 150,
              render: (_: unknown, row: FlatRow) => (
                <span className="text-12">{row.plan.template || "—"}</span>
              ),
            },
            {
              title: "进度",
              width: 110,
              render: (_: unknown, row: FlatRow) => (
                <StatusBadge domain="taxPlan" status={row.plan.status} />
              ),
            },
            {
              title: "关联账套",
              width: 170,
              render: (_: unknown, row: FlatRow) => (
                <span className="text-12">
                  {row.plan.accountSetName || "—（账套未启用）"}
                </span>
              ),
            },
            {
              title: "操作",
              width: 130,
              render: (_: unknown, row: FlatRow) =>
                row.plan.status === "DUE" && canFill(row.plan) ? (
                  <Button type="primary" onClick={() => void goFill(row.plan)}>
                    去填写
                  </Button>
                ) : row.plan.declId ? (
                  <Button onClick={() => onOpenDecl(row.plan.declId as number)}>
                    查看申报单
                  </Button>
                ) : (
                  <span className="text-12 muted">—</span>
                ),
            },
          ]}
        />
      </div>
    </Panel>
  );
}
