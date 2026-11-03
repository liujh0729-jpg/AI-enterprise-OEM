"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { taxApi } from "@/api/tax";

import { InboxOutlined, SolutionOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Space, Table } from "antd";
import { useEffect, useState } from "react";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { StatusBadge } from "@/components/status-badge";
import {
  EmptyState,
  Notice,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { useMaterialDetail } from "@/query/tax";

import {
  contactOf,
  contactText,
  stageEnterpriseContact,
  stageProviderContact,
} from "@/lib/contacts";
import { fmtTime, money } from "./common";

type MaterialRowData = MaterialDetailData["payload"]["payroll"][number];
export type MaterialDetailData = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Tax_materialPackDetail">["data"]
>;

/**
 * 报税材料详情（demo tax-material.js）：
 * 企业视角查看材料内容、AI 分类分析结果与分税种提报进度；
 * 服务商承办职员在此核对 AI 分析清单、勾选税种分类提报（生成申报单）。
 */
export function MaterialDetail({
  packId,
  currentUserId,
  isAdmin,
  canTouchContacts,
  onBack,
  onOpenDecl,
}: {
  packId: number;
  currentUserId: string;
  isAdmin: boolean;
  /** 是否展示「改联系方式」入口（企业当事人 / 承办职员 / 平台管理员） */
  canTouchContacts: boolean;
  onBack: () => void;
  onOpenDecl: (id: number) => void;
  /** 生成申报单后刷新父级申报单列表，详情页才能按 id 命中 */
  reload?: () => Promise<void>;
}) {
  const tax_generateDeclarationsMutation = useOperationMutation(
    taxApi.generateDeclarations,
    ["tax", "dashboard"],
  );

  const { message } = App.useApp();
  const detailQuery = useMaterialDetail(packId);
  const data = detailQuery.data;
  const loading = detailQuery.isPending;
  const load = async () => {
    await detailQuery.refetch();
  };
  const [picked, setPicked] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );

  const items = data?.analysis?.tax_items || [];
  const declared = data?.decls || [];
  // 默认勾选「尚未生成申报单」的税种：已提报的无需重复生成
  useEffect(() => {
    setPicked(
      items
        .filter(
          (item) => !declared.some((row) => row.tax_type === item.tax_type),
        )
        .map((item) => item.tax_type),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.analysis?.at, declared.length]);

  const canProvide =
    Boolean(currentUserId) &&
    (isAdmin ||
      (Boolean(data?.staffUserId) && data?.staffUserId === currentUserId));
  const pendingItems = items.filter(
    (item) => !declared.some((row) => row.tax_type === item.tax_type),
  );

  const provide = async () => {
    try {
      if (!picked.length) {
        message.warning("请至少勾选一个税种");
        return;
      }
      setGenerating(true);
      try {
        const payload = await tax_generateDeclarationsMutation.mutateAsync({
          params: { id: String(packId) },
          body: { taxTypes: picked },
        });

        const tip = payload?.tip || "已生成申报单";
        message.success(tip);
      } finally {
        setGenerating(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const payroll = data?.payload?.payroll || [];
  const invoices = data?.payload?.invoices || [];
  const bank = data?.payload?.bank || [];
  const sum = (rows: MaterialRowData[], key: string) =>
    rows.reduce((acc, row) => acc + Number(row[key] || 0), 0);

  /** 申报单环节联系方式（系统按承办人/企业档案自动带出，临时换人可改）。 */
  const openDeclContacts = (row: MaterialDetailData["decls"][number]) => {
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
  };

  if (!data) {
    if (detailQuery.isError)
      return (
        <Notice variant="error">
          {detailQuery.error.message}{" "}
          <Button onClick={() => void load()}>重试</Button>
        </Notice>
      );
    return (
      <Panel
        title="报税材料详情"
        extra={<Button onClick={onBack}>← 返回列表</Button>}
      >
        <EmptyState
          icon={<InboxOutlined aria-hidden />}
          text={
            loading ? "正在加载报税材料…" : "报税材料不存在或不在你的可见范围"
          }
        />
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title={`报税材料 · ${data.period} 属期`}
        titleBadge={`材料编号 ${data.packNo}`}
        extra={<Button onClick={onBack}>← 返回列表</Button>}
      >
        <div className="text-12 muted">
          {data.enterprise_name || "—"}｜服务商：{data.provider_name || "—"}
          {data.staff_name ? `（承办职员 ${data.staff_name}）` : ""}
          ｜提交时间：{data.submitted_at ? fmtTime(data.submitted_at) : "—"}
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
            <b>{stageEnterpriseContact(data)}</b>
          </span>
          <span className="text-12">
            财税承办人联系方式（联系人/电话）：
            <b>{stageProviderContact(data, "待指派")}</b>
          </span>
          {canTouchContacts ? (
            <Button
              onClick={() => {
                const ent = contactOf(data, "contact");
                const prov = contactOf(data, "provider_contact");
                setContactTarget({
                  resource: "taxMaterial",
                  id: data.id,
                  no: data.packNo,
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
        <div style={{ marginTop: 14 }}>
          <StatGrid>
            <StatCard
              label="材料状态"
              value={<StatusBadge domain="taxMaterial" status={data.status} />}
            />
            <StatCard
              label="材料编号"
              value={
                <span className="mono" style={{ fontSize: 16 }}>
                  {data.packNo}
                </span>
              }
            />
            <StatCard
              label="材料摘要"
              value={
                <span style={{ fontSize: 16 }}>
                  员工 {data.counts?.payroll || 0} 人 · 发票{" "}
                  {data.counts?.invoices || 0} 张 · 流水{" "}
                  {data.counts?.bank || 0} 笔
                </span>
              }
            />
            <StatCard
              label="分析时间"
              value={
                <span style={{ fontSize: 16 }}>
                  {data.analysis?.at ? fmtTime(data.analysis.at) : "—"}
                </span>
              }
            />
          </StatGrid>
        </div>
      </Panel>

      <Panel title="1 员工与工资" titleBadge={`${payroll.length} 条`}>
        {payroll.length ? (
          <>
            <StatGrid>
              <StatCard label="员工人数" value={`${payroll.length} 人`} />
              <StatCard
                label="工资成本"
                value={
                  <span className="mono">¥{money(sum(payroll, "salary"))}</span>
                }
              />
            </StatGrid>
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <Table<MaterialRowData>
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={payroll.map((row, index) => ({
                  ...row,
                  key: String(row.id || index),
                }))}
                columns={[
                  { title: "姓名", dataIndex: "name" },
                  {
                    title: "身份证号",
                    dataIndex: "idCard",
                    render: (value: string) => (
                      <span className="mono text-12">{value || "—"}</span>
                    ),
                  },
                  {
                    title: "月工资(元)",
                    dataIndex: "salary",
                    render: (value: string) => (
                      <span className="mono">{money(value)}</span>
                    ),
                  },
                  {
                    title: "社保(元)",
                    dataIndex: "socialSecurity",
                    render: (value: string) => (
                      <span className="mono">{money(value)}</span>
                    ),
                  },
                  {
                    title: "公积金(元)",
                    dataIndex: "housingFund",
                    render: (value: string) => (
                      <span className="mono">{money(value)}</span>
                    ),
                  },
                ]}
              />
            </div>
          </>
        ) : (
          <div className="text-12 muted">
            本期未提交员工工资数据（如无发薪员工可不填）
          </div>
        )}
      </Panel>

      <Panel title="2 获取发票" titleBadge={`${invoices.length} 条`}>
        {invoices.length ? (
          <div className="table-wrap">
            <Table<MaterialRowData>
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={invoices.map((row, index) => ({
                ...row,
                key: String(row.id || index),
              }))}
              columns={[
                { title: "类型", dataIndex: "kind", width: 100 },
                {
                  title: "发票号码",
                  dataIndex: "invoiceNo",
                  render: (value: string) => (
                    <span className="mono text-12">{value || "—"}</span>
                  ),
                },
                { title: "对方", dataIndex: "counterparty" },
                {
                  title: "金额(元)",
                  dataIndex: "amount",
                  render: (value: string) => (
                    <span className="mono">{money(value)}</span>
                  ),
                },
                {
                  title: "税额(元)",
                  dataIndex: "tax",
                  render: (value: string) => (
                    <span className="mono">{money(value)}</span>
                  ),
                },
                { title: "日期", dataIndex: "date", width: 120 },
              ]}
            />
          </div>
        ) : (
          <div className="text-12 muted">本期未提交发票数据</div>
        )}
      </Panel>

      <Panel title="3 上传流水" titleBadge={`${bank.length} 条`}>
        {bank.length ? (
          <>
            <StatGrid>
              <StatCard label="流水笔数" value={`${bank.length} 笔`} />
              <StatCard
                label="收入合计"
                value={
                  <span className="mono">
                    ¥
                    {money(
                      sum(
                        bank.filter((row) => row.direction === "收入"),
                        "amount",
                      ),
                    )}
                  </span>
                }
              />
              <StatCard
                label="支出合计"
                value={
                  <span className="mono">
                    ¥
                    {money(
                      sum(
                        bank.filter((row) => row.direction === "支出"),
                        "amount",
                      ),
                    )}
                  </span>
                }
              />
            </StatGrid>
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <Table<MaterialRowData>
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={bank.map((row, index) => ({
                  ...row,
                  key: String(row.id || index),
                }))}
                columns={[
                  { title: "日期", dataIndex: "date", width: 120 },
                  { title: "收支", dataIndex: "direction", width: 80 },
                  {
                    title: "金额(元)",
                    dataIndex: "amount",
                    render: (value: string) => (
                      <span className="mono">{money(value)}</span>
                    ),
                  },
                  { title: "对方", dataIndex: "counterparty" },
                  { title: "摘要", dataIndex: "summary" },
                ]}
              />
            </div>
          </>
        ) : (
          <div className="text-12 muted">本期未提交银行流水数据</div>
        )}
      </Panel>

      <Panel
        title="✦ AI 分类分析结果"
        titleBadge={data.analysis?.at ? fmtTime(data.analysis.at) : undefined}
      >
        {data.analysis ? (
          <>
            <div style={{ fontWeight: 600 }}>
              {data.analysis.zero_declare
                ? "零申报（已自动完成）"
                : `识别 ${items.length} 个应申报税种`}
            </div>
            <div className="text-12 muted" style={{ marginTop: 6 }}>
              {data.analysis.summary}
            </div>
            {items.length ? (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <Table
                  rowKey="tax_type"
                  size="small"
                  pagination={false}
                  dataSource={items}
                  columns={[
                    { title: "应申报税种", dataIndex: "name", width: 180 },
                    { title: "AI 分析依据", dataIndex: "reason" },
                    {
                      title: "预估税额",
                      dataIndex: "est_amount",
                      width: 120,
                      render: (value: number) => (
                        <span className="mono">¥{money(value)}</span>
                      ),
                    },
                    {
                      title: "申报表模板",
                      dataIndex: "template",
                      width: 200,
                      render: (value: string) => (
                        <span className="text-12">{value || "—"}</span>
                      ),
                    },
                  ]}
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="text-12 muted">
            材料提交后，此处展示 AI 识别出的应申报税种、分析依据与申报表模板。
          </div>
        )}
      </Panel>

      <Panel title="4 分税种提报进度" titleBadge={`${declared.length} 项`}>
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          服务商按税种分类提报，全流程实时反馈：AI处理 → 财务专员确认并审核 →
          申报回执 → 完成扣款
        </div>
        {declared.length ? (
          <div className="table-wrap">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: "max-content" }}
              dataSource={declared}
              columns={[
                {
                  title: "申报单号",
                  dataIndex: "decl_no",
                  width: 150,
                  render: (value: string) => (
                    <span className="mono text-12">{value}</span>
                  ),
                },
                { title: "税种", dataIndex: "tax_type_name", width: 190 },
                {
                  title: "预估税额",
                  dataIndex: "tax_amount",
                  width: 120,
                  render: (value: string) => (
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
                  width: canTouchContacts ? 180 : 100,
                  render: (_, row) => (
                    <Space size={6} wrap>
                      <Button onClick={() => onOpenDecl(row.id)}>查看</Button>
                      {canTouchContacts ? (
                        <Button onClick={() => openDeclContacts(row)}>
                          改联系方式
                        </Button>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        ) : (
          <div className="text-12 muted">
            {data.analysis?.zero_declare
              ? "本期为零申报，无申报单"
              : "尚未提报：等待服务商核对 AI 分析结果后按税种生成申报单"}
          </div>
        )}
      </Panel>

      {canProvide && data.status === "ANALYZED" ? (
        <Panel
          title={
            <>
              <SolutionOutlined aria-hidden /> 核对 AI 分析结果并分类提报
            </>
          }
          titleBadge={
            data.staff_name ? `承办职员 ${data.staff_name}` : undefined
          }
        >
          <div className="text-12 muted" style={{ marginBottom: 12 }}>
            勾选确认后按税种分别生成申报单：材料数据自动预填进对应国标申报表，随后进入「AI
            处理 → 财务专员确认并审核 → 税局申报 → 扣款」流程。
          </div>
          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            {pendingItems.map((item) => (
              <Checkbox
                key={item.tax_type}
                checked={picked.includes(item.tax_type)}
                onChange={(event) =>
                  setPicked((current) =>
                    event.target.checked
                      ? [...current, item.tax_type]
                      : current.filter((value) => value !== item.tax_type),
                  )
                }
              >
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                <span className="text-12 muted" style={{ marginLeft: 8 }}>
                  {item.reason}
                </span>
                <span className="mono" style={{ marginLeft: 8 }}>
                  预估 ¥{money(item.est_amount)}
                </span>
              </Checkbox>
            ))}
          </Space>
          <div style={{ marginTop: 14 }}>
            <Button
              type="primary"
              loading={generating}
              onClick={() => void provide()}
            >
              生成申报单并分类提报
            </Button>
          </div>
        </Panel>
      ) : null}

      <ContactEditModal
        target={contactTarget}
        onClose={() => setContactTarget(null)}
      />
    </>
  );
}
