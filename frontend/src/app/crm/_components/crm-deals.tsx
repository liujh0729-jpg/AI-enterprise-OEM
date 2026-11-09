"use client";

import {
  Button,
  Descriptions,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CrmContractRow,
  CrmMemberRow,
  CrmOpportunityRow,
  CrmOrderRow,
  CrmPaymentPlanRow,
  CrmPaymentRecordRow,
  CrmProductRow,
} from "@enterprise/contracts";
import { crmApi } from "@/api/crm";
import { Panel } from "@/components/ui/panel";
import { OaLaunchButton } from "@/app/oa/_components/oa-launch-button";
import { moneyCny } from "@/lib/money";
import {
  ActionButton,
  EntityModal,
  SearchBar,
  StatusTag,
  TableShell,
  errText,
  type FieldSpec,
} from "./crm-common";

function useMembers() {
  const [members, setMembers] = useState<CrmMemberRow[]>([]);
  useEffect(() => {
    void crmApi.members().then((data) => setMembers((data?.rows || []) as CrmMemberRow[])).catch(() => undefined);
  }, []);
  return members;
}

export function OpportunitiesTab({ customers }: { customers: { id: number; name: string }[] }) {
  const [rows, setRows] = useState<CrmOpportunityRow[]>([]);
  const [stages, setStages] = useState<Array<{ id: number; name: string; winRate: number }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [modal, setModal] = useState<{ open: boolean; row?: CrmOpportunityRow }>({ open: false });
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof crmApi.opportunity>> | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quote, setQuote] = useState({ name: "", qty: 1, price: 0, productName: "" });
  const [ai, setAi] = useState<{
    id: number;
    name: string;
    loading: boolean;
    data: Awaited<ReturnType<typeof crmApi.analyzeOpportunity>> | null;
  } | null>(null);
  const members = useMembers();

  const load = useCallback(async () => {
    try {
      const data = await crmApi.opportunities({ query: { page, pageSize: 20, view: "all", ...(keyword ? { keyword } : {}) } });
      setRows((data?.list || []) as CrmOpportunityRow[]);
      setTotal(data?.total || 0);
    } catch (error) {
      message.error(errText(error));
    }
  }, [page, keyword]);

  useEffect(() => {
    void load();
    void crmApi.opportunityStages().then((data) => setStages(data || [])).catch(() => undefined);
  }, [load]);

  const openDetail = async (row: CrmOpportunityRow) => {
    try {
      setDetail(await crmApi.opportunity({ params: { id: String(row.id) } }));
    } catch (error) {
      message.error(errText(error));
    }
  };

  const runAnalysis = async (row: { id: number; name: string }) => {
    setAi({ id: row.id, name: row.name, loading: true, data: null });
    try {
      const data = await crmApi.analyzeOpportunity({
        body: { opportunityId: row.id },
      });
      setAi((prev) =>
        prev && prev.id === row.id ? { ...prev, loading: false, data } : prev,
      );
    } catch (error) {
      setAi(null);
      message.error(errText(error));
    }
  };

  const analysis = ai?.data || null;

  const fields: FieldSpec[] = [
    { name: "customerId", label: "客户", kind: "customer", required: true },
    { name: "name", label: "商机名称", required: true },
    { name: "amount", label: "金额", kind: "money" },
    { name: "stageId", label: "阶段", kind: "select", options: stages.map((item) => ({ value: item.id, label: `${item.name}（${item.winRate}%）` })) },
    { name: "ownerId", label: "负责人", kind: "member" },
    { name: "expectedEndAt", label: "预计成交", kind: "date" },
    { name: "failureReason", label: "输单原因", span: 24 },
  ];

  return (
    <Panel title="商机" extra={<Button onClick={() => setModal({ open: true })}>新建商机</Button>}>
      <SearchBar value={keyword} onChange={(value) => { setPage(1); setKeyword(value); }} placeholder="搜索商机名称" />
      <TableShell
        columns={[
          { title: "商机", dataIndex: "name", width: 200 },
          { title: "客户", dataIndex: "customerName", width: 180 },
          { title: "金额", dataIndex: "amount", width: 140, render: (value: unknown) => moneyCny(value) },
          { title: "可能金额", dataIndex: "possible", width: 140, render: (value: unknown) => moneyCny(value) },
          { title: "阶段", dataIndex: "stageName", width: 110 },
          { title: "负责人", dataIndex: "ownerName", width: 110 },
          { title: "预计成交", dataIndex: "expectedEndAt", width: 130, render: (value: string) => value?.slice(0, 10) || "—" },
          {
            title: "操作",
            width: 210,
            render: (_: unknown, row: CrmOpportunityRow) => (
              <Space size={0}>
                <ActionButton onClick={() => void openDetail(row)}>详情</ActionButton>
                <ActionButton onClick={() => setModal({ open: true, row })}>编辑</ActionButton>
                <ActionButton onClick={() => void runAnalysis(row)}>AI分析</ActionButton>
              </Space>
            ),
          },
        ]}
        rows={rows}
        total={total}
        page={page}
        pageSize={20}
        onPage={setPage}
        empty="暂无商机"
      />

      <EntityModal
        open={modal.open}
        title={modal.row ? "编辑商机" : "新建商机"}
        formKey="opportunity"
        fields={fields}
        members={members}
        customers={customers}
        initial={modal.row || {}}
        onClose={() => setModal({ open: false })}
        onSubmit={async (values) => {
          if (modal.row) await crmApi.updateOpportunity({ params: { id: String(modal.row.id) }, body: values });
          else await crmApi.createOpportunity({ body: { ...values, customerId: Number(values.customerId), name: String(values.name) } });
          message.success("已保存");
          void load();
        }}
      />

      <Drawer
        open={Boolean(detail)}
        size={860}
        title={detail?.opportunity.name}
        onClose={() => setDetail(null)}
        extra={
          detail ? (
            <Space>
              <Select
                value={detail.opportunity.stageId || undefined}
                style={{ width: 160 }}
                placeholder="推进阶段"
                onChange={async (value) => {
                  try {
                    await crmApi.updateOpportunityStage({ params: { id: String(detail.opportunity.id) }, body: { stageId: value, failureReason: "" } });
                    void openDetail(detail.opportunity);
                    void load();
                  } catch (error) {
                    message.error(errText(error));
                  }
                }}
                options={stages.map((item) => ({ value: item.id, label: item.name }))}
              />
              <Button onClick={() => setQuoteOpen(true)}>新建报价</Button>
              <Button onClick={() => void runAnalysis(detail.opportunity)}>AI 分析</Button>
              <OaLaunchButton
                target="CRM_OPPORTUNITY"
                targetId={detail.opportunity.id}
              />
            </Space>
          ) : null
        }
      >
        {detail ? (
          <>
            <Descriptions
              size="small"
              bordered
              column={2}
              items={[
                { key: "1", label: "客户", children: detail.opportunity.customerName },
                { key: "2", label: "金额", children: moneyCny(detail.opportunity.amount) },
                { key: "3", label: "可能金额", children: moneyCny(detail.opportunity.possible) },
                { key: "4", label: "阶段", children: detail.opportunity.stageName },
                { key: "5", label: "负责人", children: detail.opportunity.ownerName },
                { key: "6", label: "审批", children: <StatusTag value={detail.opportunity.approvalStatus} label={detail.opportunity.approvalStatusLabel} /> },
              ]}
            />
            <Panel title="报价单" titleExtra="报价审批通过后可转合同">
              <TableShell
                columns={[
                  { title: "版本", dataIndex: "version", width: 70 },
                  { title: "名称", dataIndex: "name" },
                  { title: "金额", dataIndex: "amount", width: 140, render: (value: unknown) => moneyCny(value) },
                  { title: "有效期", dataIndex: "untilAt", width: 120, render: (value: string) => value?.slice(0, 10) || "—" },
                  { title: "状态", width: 100, render: (_: unknown, row: { invalid: boolean; approvalStatusLabel: string }) => (row.invalid ? <Tag>已作废</Tag> : <StatusTag value={row.approvalStatusLabel ? "APPROVED" : ""} label={row.approvalStatusLabel || "未提交"} />) },
                ]}
                rows={detail.quotations}
              />
            </Panel>
          </>
        ) : null}
      </Drawer>

      <Modal
        open={quoteOpen}
        title="新建报价"
        onCancel={() => setQuoteOpen(false)}
        onOk={async () => {
          if (!detail) return;
          try {
            await crmApi.saveQuotation({
              body: {
                opportunityId: detail.opportunity.id,
                name: quote.name || `${detail.opportunity.name}报价`,
                items: [
                  {
                    productId: 0,
                    nameSnapshot: quote.productName || "报价项",
                    qty: String(quote.qty),
                    price: String(quote.price),
                  },
                ],
              },
            });
            setQuoteOpen(false);
            setQuote({ name: "", qty: 1, price: 0, productName: "" });
            void openDetail(detail.opportunity);
          } catch (error) {
            message.error(errText(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="报价名称" value={quote.name} onChange={(event) => setQuote({ ...quote, name: event.target.value })} />
          <Input placeholder="报价项名称" value={quote.productName} onChange={(event) => setQuote({ ...quote, productName: event.target.value })} />
          <Space>
            <InputNumber min={0} value={quote.qty} onChange={(value) => setQuote({ ...quote, qty: Number(value || 0) })} />
            <InputNumber min={0} value={quote.price} onChange={(value) => setQuote({ ...quote, price: Number(value || 0) })} />
          </Space>
        </Space>
      </Modal>

      <Modal
        open={Boolean(ai)}
        title={ai ? `AI 商机分析 · ${ai.name}` : "AI 商机分析"}
        width={720}
        onCancel={() => setAi(null)}
        footer={[
          <Button
            key="again"
            disabled={ai?.loading}
            onClick={() => ai && void runAnalysis({ id: ai.id, name: ai.name })}
          >
            重新分析
          </Button>,
          <Button key="close" type="primary" onClick={() => setAi(null)}>
            关闭
          </Button>,
        ]}
      >
        {ai?.loading ? (
          <div className="muted">模型正在分析商机价值与成单率…</div>
        ) : analysis ? (
          <div className="crm-stack">
            <Space size={48} wrap>
              <div>
                <div className="muted">价值评分</div>
                <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>{analysis.valueScore}</div>
                <Tag color={analysis.valueLevel === "高" ? "green" : analysis.valueLevel === "低" ? "red" : "gold"}>
                  {analysis.valueLevel}价值
                </Tag>
              </div>
              <div>
                <div className="muted">AI 建议成单率</div>
                <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>{analysis.winRate}%</div>
                <div className="muted">当前阶段赢率 {analysis.stageWinRate}%</div>
              </div>
            </Space>
            <Panel title="判断依据">
              {analysis.reasons.length ? (
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {analysis.reasons.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ol>
              ) : (
                <div className="muted">模型没有给出判断依据</div>
              )}
            </Panel>
            <Panel title="结论">{analysis.advice || <span className="muted">无</span>}</Panel>
            <Panel title="下一步">{analysis.nextStep || <span className="muted">无</span>}</Panel>
          </div>
        ) : null}
      </Modal>
    </Panel>
  );
}

export function ContractsTab({ customers }: { customers: { id: number; name: string }[] }) {
  const [rows, setRows] = useState<CrmContractRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [modal, setModal] = useState<{ open: boolean; row?: CrmContractRow }>({ open: false });
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof crmApi.contract>> | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState({ name: "", planAmount: 0, planEndAt: "" });
  const [recordOpen, setRecordOpen] = useState(false);
  const [record, setRecord] = useState({ recordAmount: 0, recordEndAt: "", paymentPlanId: 0 });
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoice, setInvoice] = useState({ name: "", amount: 0, invoiceType: "SPECIAL", taxRate: 6 });
  const members = useMembers();
  const stages = useMemo(() => [] as Array<{ id: number; name: string }>, []);

  const load = useCallback(async () => {
    try {
      const data = await crmApi.contracts({ query: { page, pageSize: 20, view: "all", ...(keyword ? { keyword } : {}) } });
      setRows((data?.list || []) as CrmContractRow[]);
      setTotal(data?.total || 0);
    } catch (error) {
      message.error(errText(error));
    }
  }, [page, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (row: CrmContractRow) => {
    try {
      setDetail(await crmApi.contract({ params: { id: String(row.id) } }));
    } catch (error) {
      message.error(errText(error));
    }
  };

  const fields: FieldSpec[] = [
    { name: "customerId", label: "客户", kind: "customer", required: true },
    { name: "name", label: "合同名称", required: true },
    { name: "amount", label: "合同金额", kind: "money" },
    { name: "ownerId", label: "负责人", kind: "member" },
    { name: "startAt", label: "开始日期", kind: "date" },
    { name: "endAt", label: "结束日期", kind: "date" },
    { name: "remark", label: "备注", kind: "textarea", span: 24 },
  ];

  return (
    <Panel title="销售合同" extra={<Button onClick={() => setModal({ open: true })}>新建合同</Button>}>
      <SearchBar value={keyword} onChange={(value) => { setPage(1); setKeyword(value); }} placeholder="搜索合同名称/编号" />
      <TableShell
        columns={[
          { title: "编号", dataIndex: "number", width: 170 },
          { title: "名称", dataIndex: "name", width: 220 },
          { title: "客户", dataIndex: "customerName", width: 170 },
          { title: "金额", dataIndex: "amount", width: 130, render: (value: unknown) => moneyCny(value) },
          { title: "已回款", dataIndex: "paidAmount", width: 130, render: (value: unknown) => moneyCny(value) },
          { title: "审批", width: 100, render: (_: unknown, row: CrmContractRow) => <StatusTag value={row.approvalStatus} label={row.approvalStatusLabel} /> },
          {
            title: "操作",
            width: 150,
            render: (_: unknown, row: CrmContractRow) => (
              <Space size={0}>
                <ActionButton onClick={() => void openDetail(row)}>详情</ActionButton>
                <ActionButton onClick={() => setModal({ open: true, row })}>编辑</ActionButton>
              </Space>
            ),
          },
        ]}
        rows={rows}
        total={total}
        page={page}
        pageSize={20}
        onPage={setPage}
        empty="暂无合同"
      />

      <EntityModal
        open={modal.open}
        title={modal.row ? "编辑合同" : "新建合同"}
        formKey="contract"
        fields={fields}
        members={members}
        customers={customers}
        initial={modal.row || {}}
        onClose={() => setModal({ open: false })}
        onSubmit={async (values) => {
          if (modal.row) await crmApi.updateContract({ params: { id: String(modal.row.id) }, body: values });
          else await crmApi.createContract({ body: { ...values, customerId: Number(values.customerId), name: String(values.name) } });
          message.success("已保存");
          void load();
        }}
      />

      <Drawer
        open={Boolean(detail)}
        size={1000}
        title={detail ? `${detail.contract.number} ${detail.contract.name}` : ""}
        onClose={() => setDetail(null)}
        extra={
          detail ? (
            <Space>
              <Button onClick={() => setPlanOpen(true)}>回款计划</Button>
              <Button type="primary" onClick={() => setRecordOpen(true)}>登记回款</Button>
              <Button onClick={() => setInvoiceOpen(true)}>发票</Button>
              <OaLaunchButton
                target="CRM_CONTRACT"
                targetId={detail.contract.id}
              />
              <Button
                danger
                onClick={() => {
                  Modal.confirm({
                    title: "作废合同",
                    content: "作废后不能继续回款。确定作废？",
                    onOk: async () => {
                      await crmApi.voidContract({ params: { id: String(detail.contract.id) }, body: { reason: "作废" } });
                      setDetail(null);
                      void load();
                    },
                  });
                }}
              >
                作废
              </Button>
            </Space>
          ) : null
        }
      >
        {detail ? (
          <>
            <Descriptions
              size="small"
              bordered
              column={3}
              items={[
                { key: "1", label: "客户", children: detail.contract.customerName },
                { key: "2", label: "金额", children: moneyCny(detail.contract.amount) },
                { key: "3", label: "已回款", children: moneyCny(detail.contract.paidAmount) },
                { key: "4", label: "审批", children: <StatusTag value={detail.contract.approvalStatus} label={detail.contract.approvalStatusLabel} /> },
                { key: "5", label: "负责人", children: detail.contract.ownerName },
                { key: "6", label: "作废原因", children: detail.contract.voidReason || "—" },
              ]}
            />
            <Panel title="回款计划">
              <TableShell
                columns={[
                  { title: "计划", dataIndex: "name" },
                  { title: "计划金额", dataIndex: "planAmount", render: (value: unknown) => moneyCny(value) },
                  { title: "已回款", dataIndex: "paidAmount", render: (value: unknown) => moneyCny(value) },
                  { title: "日期", dataIndex: "planEndAt", width: 120, render: (value: string) => value?.slice(0, 10) || "—" },
                  { title: "状态", dataIndex: "statusLabel", width: 100 },
                ]}
                rows={detail.plans}
              />
            </Panel>
            <Panel title="回款记录">
              <TableShell
                columns={[
                  { title: "金额", dataIndex: "recordAmount", render: (value: unknown) => moneyCny(value) },
                  { title: "日期", dataIndex: "recordEndAt", width: 120, render: (value: string) => value?.slice(0, 10) || "—" },
                  { title: "流水号", dataIndex: "no" },
                ]}
                rows={detail.records}
              />
            </Panel>
            <Panel title="发票">
              <TableShell
                columns={[
                  { title: "名称", dataIndex: "name" },
                  { title: "金额", dataIndex: "amount", render: (value: unknown) => moneyCny(value) },
                  { title: "类型", dataIndex: "invoiceTypeLabel" },
                  { title: "税率", dataIndex: "taxRate" },
                ]}
                rows={detail.invoices}
              />
            </Panel>
          </>
        ) : null}
      </Drawer>

      <Modal
        open={planOpen}
        title="新增回款计划"
        onCancel={() => setPlanOpen(false)}
        onOk={async () => {
          if (!detail) return;
          await crmApi.savePaymentPlan({
            body: {
              contractId: detail.contract.id,
              name: plan.name || "回款计划",
              planAmount: String(plan.planAmount),
              planEndAt: plan.planEndAt ? new Date(plan.planEndAt).toISOString() : undefined,
            },
          });
          setPlanOpen(false);
          void openDetail(detail.contract);
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="计划名称" value={plan.name} onChange={(event) => setPlan({ ...plan, name: event.target.value })} />
          <InputNumber style={{ width: "100%" }} min={0} placeholder="计划金额" value={plan.planAmount} onChange={(value) => setPlan({ ...plan, planAmount: Number(value || 0) })} />
          <Input type="date" value={plan.planEndAt} onChange={(event) => setPlan({ ...plan, planEndAt: event.target.value })} />
        </Space>
      </Modal>

      <Modal
        open={recordOpen}
        title="登记回款"
        onCancel={() => setRecordOpen(false)}
        onOk={async () => {
          if (!detail) return;
          try {
            await crmApi.savePaymentRecord({
              body: {
                contractId: detail.contract.id,
                paymentPlanId: record.paymentPlanId || 0,
                name: "",
                no: "",
                attachmentKey: "",
                recordAmount: String(record.recordAmount),
                recordEndAt: record.recordEndAt ? new Date(record.recordEndAt).toISOString() : undefined,
              },
            });
            setRecordOpen(false);
            void openDetail(detail.contract);
            void load();
          } catch (error) {
            message.error(errText(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Select
            style={{ width: "100%" }}
            placeholder="关联回款计划（可选）"
            value={record.paymentPlanId || undefined}
            onChange={(value) => setRecord({ ...record, paymentPlanId: value })}
            options={detail?.plans.map((item) => ({ value: item.id, label: `${item.name}（${item.planAmount}）` })) || []}
          />
          <InputNumber style={{ width: "100%" }} min={0} placeholder="回款金额" value={record.recordAmount} onChange={(value) => setRecord({ ...record, recordAmount: Number(value || 0) })} />
          <Input type="date" value={record.recordEndAt} onChange={(event) => setRecord({ ...record, recordEndAt: event.target.value })} />
        </Space>
      </Modal>

      <Modal
        open={invoiceOpen}
        title="新增发票"
        onCancel={() => setInvoiceOpen(false)}
        onOk={async () => {
          if (!detail) return;
          await crmApi.saveInvoice({
            body: {
              contractId: detail.contract.id,
              businessTitleId: 0,
              name: invoice.name || detail.contract.name,
              amount: String(invoice.amount),
              invoiceType: invoice.invoiceType as "SPECIAL" | "NORMAL",
              taxRate: String(invoice.taxRate),
              attachmentKey: "",
              remark: "",
            },
          });
          setInvoiceOpen(false);
          void openDetail(detail.contract);
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="发票名称" value={invoice.name} onChange={(event) => setInvoice({ ...invoice, name: event.target.value })} />
          <InputNumber style={{ width: "100%" }} min={0} placeholder="金额" value={invoice.amount} onChange={(value) => setInvoice({ ...invoice, amount: Number(value || 0) })} />
          <Select
            value={invoice.invoiceType}
            onChange={(value) => setInvoice({ ...invoice, invoiceType: value })}
            options={[
              { value: "SPECIAL", label: "增值税专用发票" },
              { value: "NORMAL", label: "增值税普通发票" },
            ]}
          />
          <InputNumber style={{ width: "100%" }} min={0} placeholder="税率 %" value={invoice.taxRate} onChange={(value) => setInvoice({ ...invoice, taxRate: Number(value || 0) })} />
        </Space>
      </Modal>
      <span hidden>{stages.length}</span>
    </Panel>
  );
}

export function PaymentsTab() {
  const [plans, setPlans] = useState<CrmPaymentPlanRow[]>([]);
  const [records, setRecords] = useState<CrmPaymentRecordRow[]>([]);
  const [view, setView] = useState<"all" | "overdue">("all");

  const load = useCallback(async () => {
    try {
      const [planData, recordData] = await Promise.all([
        crmApi.paymentPlans({ query: { page: 1, pageSize: 100, view } }),
        crmApi.paymentRecords({ query: { page: 1, pageSize: 100 } }),
      ]);
      setPlans((planData?.list || []) as CrmPaymentPlanRow[]);
      setRecords((recordData?.list || []) as CrmPaymentRecordRow[]);
    } catch (error) {
      message.error(errText(error));
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="crm-stack">
      <Panel
        title="回款计划"
        extra={
          <Select
            value={view}
            style={{ width: 120 }}
            onChange={setView}
            options={[
              { value: "all", label: "全部" },
              { value: "overdue", label: "仅逾期" },
            ]}
          />
        }
      >
        <TableShell
          columns={[
            { title: "合同", dataIndex: "contractNumber", width: 160 },
            { title: "客户", dataIndex: "customerName", width: 170 },
            { title: "计划", dataIndex: "name", width: 160 },
            { title: "计划金额", dataIndex: "planAmount", width: 130, render: (value: unknown) => moneyCny(value) },
            { title: "已回款", dataIndex: "paidAmount", width: 130, render: (value: unknown) => moneyCny(value) },
            { title: "计划日期", dataIndex: "planEndAt", width: 120, render: (value: string) => value?.slice(0, 10) || "—" },
            { title: "状态", width: 100, render: (_: unknown, row: CrmPaymentPlanRow) => <StatusTag value={row.status} label={row.statusLabel} /> },
            { title: "逾期", dataIndex: "overdue", width: 80, render: (value: boolean) => (value ? <Tag color="red">逾期</Tag> : "—") },
          ]}
          rows={plans}
          empty="暂无回款计划"
        />
      </Panel>
      <Panel title="回款记录">
        <TableShell
          columns={[
            { title: "合同", dataIndex: "contractNumber", width: 160 },
            { title: "客户", dataIndex: "customerName", width: 170 },
            { title: "金额", dataIndex: "recordAmount", width: 130, render: (value: unknown) => moneyCny(value) },
            { title: "回款日期", dataIndex: "recordEndAt", width: 120, render: (value: string) => value?.slice(0, 10) || "—" },
            { title: "计划", dataIndex: "planName" },
          ]}
          rows={records}
          empty="暂无回款记录"
        />
      </Panel>
    </div>
  );
}

export function OrdersTab({ customers }: { customers: { id: number; name: string }[] }) {
  const [rows, setRows] = useState<CrmOrderRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [modal, setModal] = useState<{ open: boolean; row?: CrmOrderRow }>({ open: false });
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof crmApi.order>> | null>(null);
  const members = useMembers();

  const load = useCallback(async () => {
    try {
      const data = await crmApi.orders({ query: { page, pageSize: 20, ...(keyword ? { keyword } : {}) } });
      setRows((data?.list || []) as CrmOrderRow[]);
      setTotal(data?.total || 0);
    } catch (error) {
      message.error(errText(error));
    }
  }, [page, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title="订单" extra={<Button onClick={() => setModal({ open: true })}>新建订单</Button>}>
      <SearchBar value={keyword} onChange={(value) => { setPage(1); setKeyword(value); }} placeholder="搜索订单名称/编号" />
      <TableShell
        columns={[
          { title: "编号", dataIndex: "number", width: 170 },
          { title: "名称", dataIndex: "name", width: 220 },
          { title: "客户", dataIndex: "customerName", width: 170 },
          { title: "金额", dataIndex: "amount", width: 130, render: (value: unknown) => moneyCny(value) },
          { title: "审批", width: 100, render: (_: unknown, row: CrmOrderRow) => <StatusTag value={row.approvalStatus} label={row.approvalStatusLabel} /> },
          {
            title: "操作",
            width: 150,
            render: (_: unknown, row: CrmOrderRow) => (
              <Space size={0}>
                <ActionButton onClick={async () => { setDetail(await crmApi.order({ params: { id: String(row.id) } })); }}>详情</ActionButton>
                <ActionButton onClick={() => setModal({ open: true, row })}>编辑</ActionButton>
              </Space>
            ),
          },
        ]}
        rows={rows}
        total={total}
        page={page}
        pageSize={20}
        onPage={setPage}
        empty="暂无订单"
      />
      <EntityModal
        open={modal.open}
        title={modal.row ? "编辑订单" : "新建订单"}
        formKey="order"
        fields={[
          { name: "name", label: "订单名称", required: true },
          { name: "customerId", label: "客户", kind: "customer" },
          { name: "amount", label: "金额", kind: "money" },
          { name: "ownerId", label: "负责人", kind: "member" },
          { name: "remark", label: "备注", kind: "textarea", span: 24 },
        ]}
        members={members}
        customers={customers}
        initial={modal.row || {}}
        onClose={() => setModal({ open: false })}
        onSubmit={async (values) => {
          if (modal.row) await crmApi.updateOrder({ params: { id: String(modal.row.id) }, body: values });
          else await crmApi.createOrder({ body: { ...values, name: String(values.name) } });
          message.success("已保存");
          void load();
        }}
      />
      <Drawer open={Boolean(detail)} size={720} title={detail ? `${detail.order.number} ${detail.order.name}` : ""} onClose={() => setDetail(null)}>
        {detail ? (
          <>
            <Descriptions
              size="small"
              bordered
              column={2}
              items={[
                { key: "1", label: "客户", children: detail.order.customerName },
                { key: "2", label: "合同", children: detail.order.contractNumber || "—" },
                { key: "3", label: "金额", children: moneyCny(detail.order.amount) },
                { key: "4", label: "审批", children: <StatusTag value={detail.order.approvalStatus} label={detail.order.approvalStatusLabel} /> },
                {
                  key: "5",
                  label: "交付项目",
                  children: detail.order.projectId
                    ? `已自动立项 #${detail.order.projectId}`
                    : "审批通过后自动立项",
                },
              ]}
            />
            <Panel title="产品明细">
              <TableShell
                columns={[
                  { title: "产品", dataIndex: "nameSnapshot" },
                  { title: "数量", dataIndex: "qty" },
                  { title: "单价", dataIndex: "price", render: (value: unknown) => moneyCny(value) },
                  { title: "金额", dataIndex: "amount", render: (value: unknown) => moneyCny(value) },
                ]}
                rows={detail.items}
              />
            </Panel>
          </>
        ) : null}
      </Drawer>
    </Panel>
  );
}

export function ProductsTab() {
  const [rows, setRows] = useState<CrmProductRow[]>([]);
  const [prices, setPrices] = useState<Array<Record<string, unknown>>>([]);
  const [modal, setModal] = useState<{ open: boolean; row?: CrmProductRow }>({ open: false });
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState({ name: "", items: "[]" });

  const load = async () => {
    try {
      const [data, priceRows] = await Promise.all([
        crmApi.products({ query: { page: 1, pageSize: 200 } }),
        crmApi.productPrices(),
      ]);
      setRows((data?.list || []) as CrmProductRow[]);
      setPrices((priceRows || []) as Array<Record<string, unknown>>);
    } catch (error) {
      message.error(errText(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="crm-stack">
      <Panel title="产品目录" extra={<Button onClick={() => setModal({ open: true })}>新建产品</Button>}>
        <TableShell
          columns={[
            { title: "产品", dataIndex: "name" },
            { title: "编码", dataIndex: "code", width: 120 },
            { title: "标准价", dataIndex: "price", width: 140, render: (value: unknown) => moneyCny(value) },
            { title: "状态", dataIndex: "status", width: 90, render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
            {
              title: "操作",
              width: 100,
              render: (_: unknown, row: CrmProductRow) => <ActionButton onClick={() => setModal({ open: true, row })}>编辑</ActionButton>,
            },
          ]}
          rows={rows}
          empty="暂无产品"
        />
      </Panel>
      <Panel title="价格表" extra={<Button onClick={() => setPriceOpen(true)}>新建价格表</Button>}>
        <TableShell
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "状态", dataIndex: "status", width: 90, render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
            { title: "条目数", width: 90, render: (_: unknown, row: Record<string, unknown>) => (Array.isArray(row.items) ? row.items.length : 0) },
          ]}
          rows={prices as Array<{ id: number; name: string }>}
          empty="暂无价格表"
        />
      </Panel>

      <EntityModal
        open={modal.open}
        title={modal.row ? "编辑产品" : "新建产品"}
        fields={[
          { name: "name", label: "产品名称", required: true },
          { name: "code", label: "编码" },
          { name: "price", label: "标准价", kind: "money" },
          { name: "description", label: "说明", kind: "textarea", span: 24 },
        ]}
        initial={modal.row || {}}
        onClose={() => setModal({ open: false })}
        onSubmit={async (values) => {
          await crmApi.saveProduct({ body: { ...values, name: String(values.name) } });
          message.success("已保存");
          void load();
        }}
      />

      <Modal
        open={priceOpen}
        title="新建价格表"
        onCancel={() => setPriceOpen(false)}
        onOk={async () => {
          try {
            const items = JSON.parse(priceDraft.items || "[]");
            await crmApi.saveProductPrice({ body: { name: priceDraft.name, items, status: true, sort: 0 } });
            setPriceOpen(false);
            setPriceDraft({ name: "", items: "[]" });
            void load();
          } catch (error) {
            message.error(errText(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="价格表名称" value={priceDraft.name} onChange={(event) => setPriceDraft({ ...priceDraft, name: event.target.value })} />
          <Input.TextArea rows={6} placeholder='条目 JSON，例如 [{"productId":1,"price":"100.00"}]' value={priceDraft.items} onChange={(event) => setPriceDraft({ ...priceDraft, items: event.target.value })} />
        </Space>
      </Modal>
    </div>
  );
}