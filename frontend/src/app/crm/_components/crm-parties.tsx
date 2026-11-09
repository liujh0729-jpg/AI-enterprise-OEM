"use client";

import {
  Button,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import type {
  CrmCustomerRow,
  CrmLeadRow,
  CrmMemberRow,
} from "@enterprise/contracts";
import { crmApi } from "@/api/crm";
import { aiApi, type AiCrmLeadScore } from "@/api/ai";
import { AiLevelTag, AiList, AiResultModal } from "@/components/ai-result";
import { scrmContactApi } from "@/api/scrm";
import { Notice, Panel, PanelTabs } from "@/components/ui/panel";
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

const LEAD_STAGES = [
  { value: "NEW", label: "新建" },
  { value: "FOLLOWING", label: "跟进中" },
  { value: "INTERESTED", label: "感兴趣" },
  { value: "SUCCESS", label: "成功" },
  { value: "FAIL", label: "失败" },
];

function useMembers() {
  const [members, setMembers] = useState<CrmMemberRow[]>([]);
  useEffect(() => {
    void crmApi
      .members()
      .then((data) => setMembers((data?.rows || []) as CrmMemberRow[]))
      .catch(() => undefined);
  }, []);
  return members;
}

export function LeadsTab({ customers }: { customers: { id: number; name: string }[] }) {
  const [rows, setRows] = useState<CrmLeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [view, setView] = useState<"all" | "mine" | "pool">("all");
  const [stage, setStage] = useState<string>("");
  const [pools, setPools] = useState<Array<{ id: number; name: string }>>([]);
  const [modal, setModal] = useState<{ open: boolean; row?: CrmLeadRow }>({ open: false });
  const [detail, setDetail] = useState<CrmLeadRow | null>(null);
  const [leadTab, setLeadTab] = useState("follow");
  const [follows, setFollows] = useState<Array<Record<string, unknown>>>([]);
  const [plans, setPlans] = useState<Array<Record<string, unknown>>>([]);
  const [followText, setFollowText] = useState("");
  const [planText, setPlanText] = useState("");
  const [planAt, setPlanAt] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolId, setPoolId] = useState(0);
  const [aiScore, setAiScore] = useState<AiCrmLeadScore | null>(null);
  const [aiScoreOpen, setAiScoreOpen] = useState(false);
  const [aiScoreLoading, setAiScoreLoading] = useState(false);
  const members = useMembers();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await crmApi.leads({
        query: {
          page,
          pageSize: 20,
          view,
          ...(stage ? { stage } : {}),
          ...(keyword ? { keyword } : {}),
        },
      });
      setRows((data?.list || []) as CrmLeadRow[]);
      setTotal(data?.total || 0);
    } catch (error) {
      message.error(errText(error));
    } finally {
      setLoading(false);
    }
  }, [page, view, stage, keyword]);

  useEffect(() => {
    void load();
    void crmApi.leadPools().then((data) => setPools((data || []) as Array<{ id: number; name: string }>)).catch(() => undefined);
  }, [load]);

  const openDetail = async (row: CrmLeadRow) => {
    try {
      const [lead, records, planRows] = await Promise.all([
        crmApi.lead({ params: { id: String(row.id) } }),
        crmApi.followRecords({ query: { targetType: "LEAD", targetId: row.id } }),
        crmApi.followPlans({ query: { targetType: "LEAD", targetId: row.id } }),
      ]);
      setDetail(lead as CrmLeadRow);
      setFollows((records || []) as Array<Record<string, unknown>>);
      setPlans((planRows || []) as Array<Record<string, unknown>>);
    } catch (error) {
      message.error(errText(error));
    }
  };

  const runLeadScore = async () => {
    if (!detail) return;
    setAiScoreOpen(true);
    setAiScoreLoading(true);
    setAiScore(null);
    try {
      setAiScore(await aiApi.crmLeadScore({ body: { leadId: detail.id } }));
    } catch (error) {
      message.error(errText(error));
      setAiScoreOpen(false);
    } finally {
      setAiScoreLoading(false);
    }
  };

  const fields: FieldSpec[] = [
    { name: "name", label: "线索名称", required: true },
    { name: "contactName", label: "联系人" },
    { name: "phone", label: "电话" },
    { name: "email", label: "邮箱" },
    { name: "source", label: "来源" },
    { name: "stage", label: "阶段", kind: "select", options: LEAD_STAGES },
    { name: "ownerId", label: "负责人", kind: "member" },
    {
      name: "poolId",
      label: "线索池（选了就进池，负责人清空）",
      kind: "select",
      options: pools.map((item) => ({ value: item.id, label: item.name })),
    },
    { name: "remark", label: "备注", kind: "textarea", span: 24 },
  ];

  const columns = [
    { title: "线索", dataIndex: "name", width: 200 },
    { title: "联系人", dataIndex: "contactName", width: 120 },
    { title: "电话", dataIndex: "phone", width: 130 },
    { title: "来源", dataIndex: "source", width: 110 },
    { title: "阶段", dataIndex: "stageLabel", width: 100, render: (_: unknown, row: CrmLeadRow) => <StatusTag value={row.stage} label={row.stageLabel} /> },
    { title: "负责人", dataIndex: "ownerName", width: 110 },
    { title: "最近跟进", dataIndex: "lastFollowAt", width: 150, render: (value: string) => value?.replace("T", " ").slice(0, 16) || "—" },
    {
      title: "操作",
      width: 200,
      render: (_: unknown, row: CrmLeadRow) => (
        <Space size={0}>
          <ActionButton onClick={() => void openDetail(row)}>详情</ActionButton>
          <ActionButton onClick={() => setModal({ open: true, row })}>编辑</ActionButton>
          {row.inPool ? (
            <ActionButton
              onClick={async () => {
                try {
                  await crmApi.pickLead({ params: { id: String(row.id) } });
                  message.success("已领取");
                  void load();
                } catch (error) {
                  message.error(errText(error));
                }
              }}
            >
              领取
            </ActionButton>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <Panel
      title="线索"
      extra={<Button onClick={() => setModal({ open: true })}>新建线索</Button>}
    >
      <SearchBar value={keyword} onChange={(value) => { setPage(1); setKeyword(value); }} placeholder="搜索线索名称/联系人/电话">
        <Select
          value={view}
          style={{ width: 120 }}
          onChange={(value) => { setPage(1); setView(value); }}
          options={[
            { value: "all", label: "全部" },
            { value: "mine", label: "我的" },
            { value: "pool", label: "线索池" },
          ]}
        />
        <Select
          value={stage}
          style={{ width: 120 }}
          onChange={(value) => { setPage(1); setStage(value || ""); }}
          options={[{ value: "", label: "全部阶段" }, ...LEAD_STAGES]}
        />
        <Button
          onClick={async () => {
            try {
              const task = await crmApi.createExport({ body: { module: "leads", filters: { stage } } });
              message.success("已生成导出文件");
              window.open(`/api/backend/enterprise/crm/export-tasks/${(task as { id: number }).id}/download`, "_blank");
            } catch (error) {
              message.error(errText(error));
            }
          }}
        >
          导出
        </Button>
      </SearchBar>
      <TableShell
        columns={columns}
        rows={rows}
        loading={loading}
        total={total}
        page={page}
        pageSize={20}
        onPage={setPage}
        empty="暂无线索"
      />

      <EntityModal
        open={modal.open}
        title={modal.row ? "编辑线索" : "新建线索"}
        formKey="lead"
        fields={fields}
        members={members}
        initial={modal.row || { stage: "NEW", ownerId: "" }}
        onClose={() => setModal({ open: false })}
        onSubmit={async (values) => {
          if (modal.row) await crmApi.updateLead({ params: { id: String(modal.row.id) }, body: values });
          else await crmApi.createLead({ body: { ...values, name: String(values.name) } });
          message.success("已保存");
          void load();
        }}
      />

      <Drawer
        open={Boolean(detail)}
        size={760}
        title={detail?.name}
        onClose={() => setDetail(null)}
        extra={
          detail ? (
            <Space>
              <Button onClick={() => void runLeadScore()}>AI 线索评分</Button>
              <Button onClick={() => setConvertOpen(true)}>转客户</Button>
              <Button onClick={() => setTransferOpen(true)}>转移</Button>
              <Button onClick={() => setPoolOpen(true)}>移入池</Button>
              {detail.inPool ? (
                <Button
                  type="primary"
                  onClick={async () => {
                    await crmApi.pickLead({ params: { id: String(detail.id) } });
                    setDetail(null);
                    void load();
                  }}
                >
                  领取
                </Button>
              ) : null}
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
                { key: "1", label: "联系人", children: detail.contactName || "—" },
                { key: "2", label: "电话", children: detail.phone || "—" },
                { key: "3", label: "邮箱", children: detail.email || "—" },
                { key: "4", label: "来源", children: detail.source || "—" },
                { key: "5", label: "阶段", children: <StatusTag value={detail.stage} label={detail.stageLabel} /> },
                { key: "6", label: "负责人", children: detail.ownerName || "—" },
                { key: "7", label: "线索池", children: detail.poolName || "—" },
                { key: "8", label: "审批", children: <StatusTag value={detail.approvalStatus} label={detail.approvalStatusLabel} /> },
              ]}
            />
            <PanelTabs
              style={{ marginTop: 16 }}
              value={leadTab}
              onChange={setLeadTab}
              items={[
                {
                  key: "follow",
                  label: "跟进记录",
                  children: (
                    <div className="crm-stack">
                      <Input.TextArea
                        rows={2}
                        value={followText}
                        placeholder="写一条跟进记录"
                        onChange={(event) => setFollowText(event.target.value)}
                      />
                      <Button
                        type="primary"
                        onClick={async () => {
                          if (!followText.trim()) return;
                          await crmApi.saveFollowRecord({
                            body: { targetType: "LEAD", targetId: detail.id, type: "", result: "", content: followText },
                          });
                          setFollowText("");
                          void openDetail(detail);
                        }}
                      >
                        添加跟进
                      </Button>
                      {follows.map((item) => (
                        <div className="crm-note" key={String(item.id)}>
                          <div className="muted">
                            {String(item.createdByName || "")} · {String(item.createdAt || "").replace("T", " ").slice(0, 16)}
                          </div>
                          {String(item.content || "")}
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  key: "plans",
                  label: "跟进计划",
                  children: (
                    <div className="crm-stack">
                      <Space.Compact style={{ width: "100%" }}>
                        <Input
                          type="datetime-local"
                          value={planAt}
                          onChange={(event) => setPlanAt(event.target.value)}
                          style={{ width: 220 }}
                        />
                        <Input
                          value={planText}
                          placeholder="计划内容"
                          onChange={(event) => setPlanText(event.target.value)}
                        />
                        <Button
                          type="primary"
                          onClick={async () => {
                            if (!planAt || !planText.trim()) return;
                            await crmApi.saveFollowPlan({
                              body: {
                                targetType: "LEAD",
                                targetId: detail.id,
                                planAt: new Date(planAt).toISOString(),
                                ownerId: "",
                                content: planText,
                              },
                            });
                            setPlanAt("");
                            setPlanText("");
                            void openDetail(detail);
                          }}
                        >
                          添加计划
                        </Button>
                      </Space.Compact>
                      {plans.map((item) => (
                        <div className="crm-note" key={String(item.id)}>
                          <div className="muted">{String(item.planAt || "").replace("T", " ").slice(0, 16)} · {String(item.statusLabel || "")}</div>
                          {String(item.content || "")}
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </>
        ) : null}
      </Drawer>

      <AiResultModal
        open={aiScoreOpen}
        title={detail ? `AI 线索评分 · ${detail.name}` : "AI 线索评分"}
        loading={aiScoreLoading}
        mode={aiScore?.mode}
        model={aiScore?.model}
        onClose={() => setAiScoreOpen(false)}
        footer={
          aiScore ? (
            <Button onClick={() => void runLeadScore()}>重新评分</Button>
          ) : null
        }
      >
        {aiScore ? (
          <>
            <Space>
              <span>
                综合评分 <strong>{aiScore.score}</strong>
              </span>
              <AiLevelTag level={aiScore.level} />
            </Space>
            <AiList title="判断依据" items={aiScore.reasons} />
            <div>
              <strong>建议动作：</strong>
              {aiScore.nextStep}
            </div>
            <div>
              <strong>跟进建议：</strong>
              {aiScore.advice}
            </div>
          </>
        ) : null}
      </AiResultModal>

      <Modal
        open={convertOpen}
        title="线索转客户"
        onCancel={() => setConvertOpen(false)}
        onOk={async () => {
          if (!detail) return;
          try {
            const result = await crmApi.convertLead({
              params: { id: String(detail.id) },
              body: { customerId: 0, createOpportunity: true, opportunityName: "" },
            });
            message.success(result?.linkedExisting ? "已关联到已有客户" : "已创建客户");
            setConvertOpen(false);
            setDetail(null);
            void load();
          } catch (error) {
            message.error(errText(error));
          }
        }}
      >
        将创建（或关联）客户与联系人，并同步跟进记录；同时创建一个商机。
      </Modal>

      <Modal
        open={transferOpen}
        title="转移线索"
        onCancel={() => setTransferOpen(false)}
        onOk={async () => {
          if (!detail || !transferTo) return;
          await crmApi.transferLead({ params: { id: String(detail.id) }, body: { ownerId: transferTo, reason: "" } });
          setTransferOpen(false);
          setDetail(null);
          void load();
        }}
      >
        <Select
          style={{ width: "100%" }}
          value={transferTo || undefined}
          placeholder="选择负责人"
          onChange={setTransferTo}
          options={members.map((item) => ({ value: item.memberUserId, label: item.memberName }))}
        />
      </Modal>

      <Modal
        open={poolOpen}
        title="移入线索池"
        onCancel={() => setPoolOpen(false)}
        onOk={async () => {
          if (!detail || !poolId) return;
          await crmApi.leadToPool({ params: { id: String(detail.id) }, body: { poolId, reason: "" } });
          setPoolOpen(false);
          setDetail(null);
          void load();
        }}
      >
        <Select
          style={{ width: "100%" }}
          value={poolId || undefined}
          placeholder="选择线索池"
          onChange={setPoolId}
          options={pools.map((item) => ({ value: item.id, label: item.name }))}
        />
      </Modal>
      {/* 客户下拉在转化弹窗中由后端自动匹配；此处保留以复用后续扩展 */}
      <span hidden>{customers.length}</span>
    </Panel>
  );
}

export function CustomersTab({ customers }: { customers: { id: number; name: string }[] }) {
  const [rows, setRows] = useState<CrmCustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [view, setView] = useState<"all" | "mine" | "pool">("all");
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; row?: CrmCustomerRow }>({ open: false });
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof crmApi.customer360>> | null>(null);
  const [customerTab, setCustomerTab] = useState("contacts");
  const [scrmContacts, setScrmContacts] = useState<
    NonNullable<Awaited<ReturnType<typeof scrmContactApi.contacts>>>["list"]
  >([]);
  const [scrmLoading, setScrmLoading] = useState(false);
  const [scrmError, setScrmError] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSecondary, setMergeSecondary] = useState(0);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<Record<string, string>>({});
  const members = useMembers();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await crmApi.customers({
        query: { page, pageSize: 20, view, ...(keyword ? { keyword } : {}) },
      });
      setRows((data?.list || []) as CrmCustomerRow[]);
      setTotal(data?.total || 0);
    } catch (error) {
      message.error(errText(error));
    } finally {
      setLoading(false);
    }
  }, [page, view, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadScrm = async (customerId: number) => {
    setScrmLoading(true);
    setScrmError("");
    try {
      const data = await scrmContactApi.contacts({
        query: { page: 1, pageSize: 50, crmCustomerId: customerId },
      });
      setScrmContacts(data?.list || []);
    } catch (error) {
      setScrmContacts([]);
      setScrmError(errText(error));
    } finally {
      setScrmLoading(false);
    }
  };

  const openDetail = async (row: CrmCustomerRow) => {
    setCustomerTab("contacts");
    setScrmContacts([]);
    setScrmError("");
    try {
      setDetail(await crmApi.customer360({ params: { id: String(row.id) } }));
    } catch (error) {
      message.error(errText(error));
      return;
    }
    void loadScrm(row.id);
  };

  const fields: FieldSpec[] = [
    { name: "name", label: "客户名称", required: true },
    { name: "ownerId", label: "负责人", kind: "member" },
    { name: "industry", label: "行业" },
    { name: "province", label: "省" },
    { name: "city", label: "市" },
    { name: "remark", label: "备注", kind: "textarea", span: 24 },
  ];

  const columns = [
    { title: "客户", dataIndex: "name", width: 220 },
    { title: "负责人", dataIndex: "ownerName", width: 110 },
    { title: "行业", dataIndex: "industry", width: 100 },
    { title: "地区", width: 140, render: (_: unknown, row: CrmCustomerRow) => [row.province, row.city].filter(Boolean).join(" · ") || "—" },
    { title: "联系人", dataIndex: "contactCount", width: 80 },
    { title: "商机", dataIndex: "opportunityCount", width: 70 },
    { title: "合同金额", dataIndex: "contractAmount", width: 130, render: (value: unknown) => moneyCny(value) },
    {
      title: "操作",
      width: 160,
      render: (_: unknown, row: CrmCustomerRow) => (
        <Space size={0}>
          <ActionButton onClick={() => void openDetail(row)}>360</ActionButton>
          <ActionButton onClick={() => setModal({ open: true, row })}>编辑</ActionButton>
        </Space>
      ),
    },
  ];

  return (
    <Panel title="客户" extra={<Button onClick={() => setModal({ open: true })}>新建客户</Button>}>
      <SearchBar value={keyword} onChange={(value) => { setPage(1); setKeyword(value); }} placeholder="搜索客户名称">
        <Select
          value={view}
          style={{ width: 120 }}
          onChange={(value) => { setPage(1); setView(value); }}
          options={[
            { value: "all", label: "全部" },
            { value: "mine", label: "我的" },
            { value: "pool", label: "公海" },
          ]}
        />
      </SearchBar>
      <TableShell columns={columns} rows={rows} loading={loading} total={total} page={page} pageSize={20} onPage={setPage} empty="暂无客户" />

      <EntityModal
        open={modal.open}
        title={modal.row ? "编辑客户" : "新建客户"}
        formKey="customer"
        fields={fields}
        members={members}
        initial={modal.row || { ownerId: "" }}
        onClose={() => setModal({ open: false })}
        onSubmit={async (values) => {
          if (modal.row) await crmApi.updateCustomer({ params: { id: String(modal.row.id) }, body: values });
          else await crmApi.createCustomer({ body: { ...values, name: String(values.name) } });
          message.success("已保存");
          void load();
        }}
      />

      <Drawer
        open={Boolean(detail)}
        size={1040}
        title={detail?.customer.name}
        onClose={() => setDetail(null)}
        extra={
          detail ? (
            <Space>
              <Button onClick={() => setMergeOpen(true)}>合并</Button>
              <Button onClick={() => setTransferOpen(true)}>转移</Button>
              <Button onClick={() => setContactOpen(true)}>添加联系人</Button>
              <OaLaunchButton target="CRM_CUSTOMER" targetId={detail.customer.id} />
            </Space>
          ) : null
        }
      >
        {detail ? (
          <PanelTabs
            value={customerTab}
            onChange={setCustomerTab}
            items={[
              {
                key: "contacts",
                label: `联系人（${detail.contacts.length}）`,
                children: (
                  <TableShell
                    columns={[
                      { title: "姓名", dataIndex: "name", width: 140 },
                      { title: "电话", dataIndex: "phone", width: 140 },
                      { title: "邮箱", dataIndex: "email", width: 180 },
                      { title: "职务", dataIndex: "title", width: 120 },
                      { title: "状态", dataIndex: "enabled", width: 90, render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
                    ]}
                    rows={detail.contacts}
                  />
                ),
              },
              {
                key: "opportunities",
                label: `商机（${detail.opportunities.length}）`,
                children: (
                  <TableShell
                    columns={[
                      { title: "商机", dataIndex: "name" },
                      { title: "金额", dataIndex: "amount", render: (value: unknown) => moneyCny(value) },
                      { title: "负责人", dataIndex: "ownerName", width: 110 },
                      { title: "审批", dataIndex: "approvalStatusLabel", width: 100 },
                    ]}
                    rows={detail.opportunities}
                  />
                ),
              },
              {
                key: "contracts",
                label: `合同（${detail.contracts.length}）`,
                children: (
                  <TableShell
                    columns={[
                      { title: "编号", dataIndex: "number", width: 160 },
                      { title: "名称", dataIndex: "name" },
                      { title: "金额", dataIndex: "amount", width: 140, render: (value: unknown) => moneyCny(value) },
                      { title: "审批", dataIndex: "approvalStatusLabel", width: 100 },
                    ]}
                    rows={detail.contracts}
                  />
                ),
              },
              {
                key: "payments",
                label: "回款",
                children: (
                  <div className="crm-stack">
                    <Panel title="回款计划">
                      <TableShell
                        columns={[
                          { title: "计划", dataIndex: "name" },
                          { title: "金额", dataIndex: "planAmount", render: (value: unknown) => moneyCny(value) },
                          { title: "计划日期", dataIndex: "planEndAt", width: 140, render: (value: string) => value?.slice(0, 10) || "—" },
                        ]}
                        rows={detail.paymentPlans}
                      />
                    </Panel>
                    <Panel title="回款记录">
                      <TableShell
                        columns={[
                          { title: "金额", dataIndex: "recordAmount", render: (value: unknown) => moneyCny(value) },
                          { title: "日期", dataIndex: "recordEndAt", width: 140, render: (value: string) => value?.slice(0, 10) || "—" },
                        ]}
                        rows={detail.paymentRecords}
                      />
                    </Panel>
                  </div>
                ),
              },
              {
                key: "invoices",
                label: `发票（${detail.invoices.length}）`,
                children: (
                  <TableShell
                    columns={[
                      { title: "名称", dataIndex: "name" },
                      { title: "金额", dataIndex: "amount", render: (value: unknown) => moneyCny(value) },
                      { title: "税率", dataIndex: "taxRate" },
                      { title: "审批", dataIndex: "approvalStatusLabel" },
                    ]}
                    rows={detail.invoices}
                  />
                ),
              },
              {
                key: "orders",
                label: `订单（${detail.orders.length}）`,
                children: (
                  <TableShell
                    columns={[
                      { title: "编号", dataIndex: "number", width: 160 },
                      { title: "名称", dataIndex: "name" },
                      { title: "金额", dataIndex: "amount", render: (value: unknown) => moneyCny(value) },
                      { title: "审批", dataIndex: "approvalStatusLabel" },
                    ]}
                    rows={detail.orders}
                  />
                ),
              },
              {
                key: "scrm",
                label: `企微（${scrmContacts.length}）`,
                children: scrmError ? (
                  <Notice variant="warn">
                    企微客户暂不可用：{scrmError}
                  </Notice>
                ) : (
                  <TableShell
                    loading={scrmLoading}
                    empty="该客户还没有关联的企微联系人：可从线索转客户或企微同步后关联。"
                    columns={[
                      { title: "企微客户", dataIndex: "name" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        width: 90,
                        render: (value: string) =>
                          value === "LOST" ? <Tag>已流失</Tag> : <Tag color="green">正常</Tag>,
                      },
                      {
                        title: "归属员工",
                        dataIndex: "staff",
                        render: (rows: (typeof scrmContacts)[number]["staff"]) =>
                          rows.map((item) => item.name || item.userId).join("、") || "—",
                      },
                      {
                        title: "标签",
                        dataIndex: "tags",
                        render: (rows: (typeof scrmContacts)[number]["tags"]) =>
                          rows.length
                            ? rows.map((item) => (
                                <Tag key={item.id}>{item.name}</Tag>
                              ))
                            : "—",
                      },
                      {
                        title: "最后互动",
                        dataIndex: "lastInteractionAt",
                        width: 160,
                        render: (value: string) => value?.slice(0, 16).replace("T", " ") || "—",
                      },
                    ]}
                    rows={scrmContacts}
                  />
                ),
              },
              {
                key: "follow",
                label: "跟进",
                children: (
                  <div className="crm-stack">
                    {detail.follows.map((item) => (
                      <div className="crm-note" key={item.id}>
                        <div className="muted">{item.createdByName} · {item.createdAt.replace("T", " ").slice(0, 16)}</div>
                        {item.content}
                      </div>
                    ))}
                    {detail.follows.length ? null : <div className="muted">暂无跟进</div>}
                  </div>
                ),
              },
              {
                key: "relations",
                label: "协作/关系/抬头",
                children: (
                  <div className="crm-stack">
                    <Panel title="协作人">
                      {detail.collaborations.length ? detail.collaborations.map((item) => <Tag key={item.id}>{item.userName}（{item.typeLabel}）</Tag>) : <span className="muted">暂无</span>}
                    </Panel>
                    <Panel title="客户关系">
                      {detail.relations.length ? detail.relations.map((item) => <Tag key={item.id}>{item.typeLabel}：{item.customerName}</Tag>) : <span className="muted">暂无</span>}
                    </Panel>
                    <Panel title="工商抬头">
                      <TableShell
                        columns={[
                          { title: "名称", dataIndex: "name" },
                          { title: "税号", dataIndex: "taxNo", width: 200 },
                          { title: "默认", dataIndex: "isDefault", width: 80, render: (value: boolean) => (value ? <Tag color="blue">默认</Tag> : "—") },
                        ]}
                        rows={detail.titles}
                      />
                    </Panel>
                  </div>
                ),
              },
            ]}
          />
        ) : null}
      </Drawer>

      <Modal
        open={mergeOpen}
        title="合并客户（不可回退）"
        onCancel={() => setMergeOpen(false)}
        onOk={async () => {
          if (!detail || !mergeSecondary) return;
          try {
            await crmApi.mergeCustomers({ body: { primaryId: detail.customer.id, secondaryId: mergeSecondary } });
            message.success("已合并");
            setMergeOpen(false);
            setDetail(null);
            void load();
          } catch (error) {
            message.error(errText(error));
          }
        }}
      >
        <div className="muted" style={{ marginBottom: 8 }}>
          保留当前客户，把下列客户的联系人、商机、合同、订单、发票、跟进合并进来。
        </div>
        <Select
          style={{ width: "100%" }}
          value={mergeSecondary || undefined}
          placeholder="选择被合并的客户"
          onChange={setMergeSecondary}
          options={customers.filter((item) => item.id !== detail?.customer.id).map((item) => ({ value: item.id, label: item.name }))}
        />
      </Modal>

      <Modal
        open={transferOpen}
        title="转移客户"
        onCancel={() => setTransferOpen(false)}
        onOk={async () => {
          if (!detail || !transferTo) return;
          await crmApi.transferCustomer({ params: { id: String(detail.customer.id) }, body: { ownerId: transferTo, reason: "" } });
          setTransferOpen(false);
          setDetail(null);
          void load();
        }}
      >
        <Select
          style={{ width: "100%" }}
          value={transferTo || undefined}
          placeholder="选择负责人"
          onChange={setTransferTo}
          options={members.map((item) => ({ value: item.memberUserId, label: item.memberName }))}
        />
      </Modal>

      <Modal
        open={contactOpen}
        title="添加联系人"
        onCancel={() => setContactOpen(false)}
        onOk={async () => {
          if (!detail || !contactDraft.name?.trim()) return;
          await crmApi.saveContact({
            body: {
              customerId: detail.customer.id,
              name: contactDraft.name || "",
              phone: contactDraft.phone || "",
              email: contactDraft.email || "",
              title: contactDraft.title || "",
              ownerId: "",
              custom: {},
            },
          });
          setContactDraft({});
          setContactOpen(false);
          void openDetail(detail.customer);
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="姓名" value={contactDraft.name} onChange={(event) => setContactDraft({ ...contactDraft, name: event.target.value })} />
          <Input placeholder="电话" value={contactDraft.phone} onChange={(event) => setContactDraft({ ...contactDraft, phone: event.target.value })} />
          <Input placeholder="邮箱" value={contactDraft.email} onChange={(event) => setContactDraft({ ...contactDraft, email: event.target.value })} />
          <Input placeholder="职务" value={contactDraft.title} onChange={(event) => setContactDraft({ ...contactDraft, title: event.target.value })} />
        </Space>
      </Modal>
    </Panel>
  );
}