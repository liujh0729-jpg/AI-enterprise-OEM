"use client";

import {
  Button,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  message,
} from "antd";
import { useEffect, useRef, useState } from "react";
import type {
  CrmApprovalRow,
  CrmApprovalTaskRow,
  CrmMemberRow,
  CrmPoolRow,
  CrmStageRow,
} from "@enterprise/contracts";
import { crmApi } from "@/api/crm";
import { Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { moneyCny } from "@/lib/money";
import {
  ActionButton,
  SearchBar,
  StatusTag,
  TableShell,
  errText,
} from "./crm-common";

export function WorkbenchTab({
  onGo,
  initial,
}: {
  onGo: (tab: string) => void;
  initial?: Awaited<ReturnType<typeof crmApi.workbench>> | null;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof crmApi.workbench>> | null>(initial ?? null);
  const [range, setRange] = useState("month");
  const [keyword, setKeyword] = useState("");
  const [groups, setGroups] = useState<Array<Record<string, unknown>>>([]);
  const [dup, setDup] = useState<Array<Record<string, unknown>>>([]);
  const [dupForm, setDupForm] = useState({ name: "", phone: "", email: "" });
  const fetchedRange = useRef(initial ? "month" : "");

  const load = async () => {
    try {
      setData(await crmApi.workbench({ query: { range: range as never } }));
    } catch (error) {
      message.error(errText(error));
    }
  };

  useEffect(() => {
    if (fetchedRange.current === range) return;
    fetchedRange.current = range;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  if (!data) return <div className="muted">加载中…</div>;
  if (!data.isMember) {
    return <Panel title="CRM 未开通">你还没有被加入本账号的 CRM，请联系负责人添加成员权限。</Panel>;
  }

  return (
    <div className="crm-stack">
      <Panel
        title="数据概览"
        extra={
          <Select
            value={range}
            style={{ width: 120 }}
            onChange={setRange}
            options={[
              { value: "today", label: "今日" },
              { value: "week", label: "本周" },
              { value: "month", label: "本月" },
              { value: "year", label: "本年" },
            ]}
          />
        }
      >
        <StatGrid>
          {data.stats.map((item) => (
            <StatCard key={item.key} label={item.label} value={item.value} hint={item.hint} />
          ))}
        </StatGrid>
      </Panel>

      <div className="crm-two-col">
        <Panel title="我的待办">
          <div className="crm-todo-grid">
            <button type="button" className="crm-todo" onClick={() => onGo("leads")}>
              <span>待跟进</span>
              <b>{data.todo.follow}</b>
            </button>
            <button type="button" className="crm-todo" onClick={() => onGo("approvals")}>
              <span>待审批</span>
              <b>{data.todo.approval}</b>
            </button>
            <button type="button" className="crm-todo" onClick={() => onGo("payments")}>
              <span>待回款</span>
              <b>{data.todo.receivable}</b>
            </button>
            <button type="button" className="crm-todo" onClick={() => onGo("payments")}>
              <span>逾期回款</span>
              <b>{data.todo.overdue}</b>
            </button>
          </div>
        </Panel>
        <Panel title="快捷入口">
          <Space wrap>
            {data.quickAccess.map((item) => (
              <Button key={item.key} onClick={() => onGo(new URL(item.path, "http://x").searchParams.get("tab") || "leads")}>
                {item.label}
              </Button>
            ))}
          </Space>
        </Panel>
      </div>

      <Panel title="全局搜索">
        <SearchBar value={keyword} onChange={setKeyword} placeholder="客户名 / 联系人 / 手机 / 线索 / 商机">
          <Button
            type="primary"
            onClick={async () => {
              if (!keyword.trim()) return;
              try {
                const result = await crmApi.globalSearch({ query: { keyword } });
                setGroups((result?.groups || []) as Array<Record<string, unknown>>);
              } catch (error) {
                message.error(errText(error));
              }
            }}
          >
            搜索
          </Button>
        </SearchBar>
        {groups.map((group) => (
          <div key={String(group.module)} style={{ marginTop: 12 }}>
            <Divider plain>{String(group.label)}</Divider>
            {(group.rows as Array<Record<string, unknown>>).map((row) => (
              <div className="crm-search-row" key={String(row.id)}>
                <b>{String(row.title)}</b>
                <span className="muted">{String(row.detail || "")}</span>
                {row.status ? <Tag>{String(row.status)}</Tag> : null}
              </div>
            ))}
          </div>
        ))}
      </Panel>

      <Panel title="查重">
        <Space wrap>
          <Input placeholder="名称" value={dupForm.name} onChange={(event) => setDupForm({ ...dupForm, name: event.target.value })} />
          <Input placeholder="手机号" value={dupForm.phone} onChange={(event) => setDupForm({ ...dupForm, phone: event.target.value })} />
          <Input placeholder="邮箱" value={dupForm.email} onChange={(event) => setDupForm({ ...dupForm, email: event.target.value })} />
          <Button
            type="primary"
            onClick={async () => {
              try {
                const result = await crmApi.duplicateCheck({
                  query: {
                    ...(dupForm.name ? { name: dupForm.name } : {}),
                    ...(dupForm.phone ? { phone: dupForm.phone } : {}),
                    ...(dupForm.email ? { email: dupForm.email } : {}),
                  },
                });
                setDup((result?.candidates || []) as Array<Record<string, unknown>>);
              } catch (error) {
                message.error(errText(error));
              }
            }}
          >
            查重
          </Button>
        </Space>
        <div style={{ marginTop: 12 }}>
          {dup.length ? (
            dup.map((row) => (
              <div className="crm-search-row" key={`${row.module}-${row.id}`}>
                <Tag color={row.exact ? "red" : "orange"}>{row.exact ? "完全一致" : "相似"}</Tag>
                <b>{String(row.title)}</b>
                <span className="muted">{String(row.detail || "")}</span>
              </div>
            ))
          ) : (
            <span className="muted">输入名称/手机/邮箱后查重</span>
          )}
        </div>
      </Panel>
    </div>
  );
}

export function ApprovalsTab() {
  const [tab, setTab] = useState("todo");
  const [todo, setTodo] = useState<CrmApprovalTaskRow[]>([]);
  const [done, setDone] = useState<CrmApprovalTaskRow[]>([]);
  const [instances, setInstances] = useState<CrmApprovalRow[]>([]);
  const [flows, setFlows] = useState<Array<Record<string, unknown>>>([]);
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowDraft, setFlowDraft] = useState({ formType: "CONTRACT", name: "", nodes: "[]" });
  const [comment, setComment] = useState<Record<number, string>>({});

  const load = async () => {
    try {
      const [todoData, doneData, instanceData, flowData] = await Promise.all([
        crmApi.approvalTodo({ query: { page: 1, pageSize: 100 } }),
        crmApi.approvalDone({ query: { page: 1, pageSize: 100 } }),
        crmApi.approvalInstances({ query: { page: 1, pageSize: 100, view: "all" } }),
        crmApi.approvalFlows(),
      ]);
      setTodo((todoData?.list || []) as CrmApprovalTaskRow[]);
      setDone((doneData?.list || []) as CrmApprovalTaskRow[]);
      setInstances((instanceData?.list || []) as CrmApprovalRow[]);
      setFlows((flowData || []) as Array<Record<string, unknown>>);
    } catch (error) {
      message.error(errText(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (task: CrmApprovalTaskRow, action: "approve" | "reject") => {
    try {
      if (action === "approve") {
        await crmApi.approve({
          params: { id: String(task.instanceId) },
          body: { taskId: task.id, comment: comment[task.id] || "" },
        });
      } else {
        await crmApi.reject({
          params: { id: String(task.instanceId) },
          body: { taskId: task.id, comment: comment[task.id] || "驳回" },
        });
      }
      message.success(action === "approve" ? "已同意" : "已驳回");
      void load();
    } catch (error) {
      message.error(errText(error));
    }
  };

  return (
    <div className="crm-stack">
      <Panel
        title="审批"
        extra={
          <Space>
            <Button onClick={() => setFlowOpen(true)}>配置审批流</Button>
            <Button onClick={() => void load()}>刷新</Button>
          </Space>
        }
      >
    <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "todo",
              label: `待我审批（${todo.length}）`,
              children: (
                <TableShell
                  columns={[
                    { title: "单据", dataIndex: "formTypeLabel", width: 100 },
                    { title: "标题", dataIndex: "title" },
                    { title: "发起人", dataIndex: "submitterName", width: 110 },
                    { title: "节点", dataIndex: "nodeName", width: 140 },
                    {
                      title: "处理",
                      width: 360,
                      render: (_: unknown, row: CrmApprovalTaskRow) => (
                        <Space>
                          <Input
                            size="middle"
                            placeholder="意见"
                            value={comment[row.id] || ""}
                            onChange={(event) => setComment({ ...comment, [row.id]: event.target.value })}
                            style={{ width: 140 }}
                          />
                          <Button type="primary" onClick={() => void act(row, "approve")}>同意</Button>
                          <Button danger onClick={() => void act(row, "reject")}>驳回</Button>
                        </Space>
                      ),
                    },
                  ]}
                  rows={todo}
                  empty="暂无待审批"
                />
              ),
            },
            {
              key: "done",
              label: `我已审批（${done.length}）`,
              children: (
                <TableShell
                  columns={[
                    { title: "单据", dataIndex: "formTypeLabel", width: 100 },
                    { title: "标题", dataIndex: "title" },
                    { title: "结果", dataIndex: "status", width: 100, render: (value: string) => <Tag>{value}</Tag> },
                    { title: "意见", dataIndex: "comment" },
                    { title: "时间", dataIndex: "actedAt", width: 150, render: (value: string) => value?.replace("T", " ").slice(0, 16) || "—" },
                  ]}
                  rows={done}
                />
              ),
            },
            {
              key: "instances",
              label: "审批实例",
              children: (
                <TableShell
                  columns={[
                    { title: "单据", dataIndex: "formTypeLabel", width: 100 },
                    { title: "标题", dataIndex: "title" },
                    { title: "发起人", dataIndex: "submitterName", width: 110 },
                    { title: "状态", width: 100, render: (_: unknown, row: CrmApprovalRow) => <StatusTag value={row.status} label={row.statusLabel} /> },
                    { title: "提交时间", dataIndex: "submittedAt", width: 150, render: (value: string) => value?.replace("T", " ").slice(0, 16) || "—" },
                  ]}
                  rows={instances}
                />
              ),
            },
            {
              key: "flows",
              label: "审批流",
              children: (
                <TableShell
                  columns={[
                    { title: "单据", dataIndex: "formTypeLabel", width: 100 },
                    { title: "名称", dataIndex: "name" },
                    { title: "启用", dataIndex: "enabled", width: 80, render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
                    { title: "节点数", width: 80, render: (_: unknown, row: Record<string, unknown>) => (Array.isArray(row.nodes) ? row.nodes.length : 0) },
                    {
                      title: "操作",
                      width: 100,
                      render: (_: unknown, row: Record<string, unknown>) => (
                        <ActionButton
                          onClick={() => {
                            setFlowDraft({
                              formType: String(row.formType || "CONTRACT"),
                              name: String(row.name || ""),
                              nodes: JSON.stringify(row.nodes || [], null, 2),
                            });
                            setFlowOpen(true);
                          }}
                        >
                          编辑
                        </ActionButton>
                      ),
                    },
                  ]}
                  rows={flows as Array<{ id: number; name: string }>}
                  empty="还没有审批流"
                />
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        open={flowOpen}
        title="审批流配置"
        width={760}
        onCancel={() => setFlowOpen(false)}
        onOk={async () => {
          try {
            const nodes = JSON.parse(flowDraft.nodes || "[]");
            await crmApi.saveApprovalFlow({
              body: {
                formType: flowDraft.formType as never,
                name: flowDraft.name || "审批流",
                enabled: true,
                nodes,
              },
            });
            setFlowOpen(false);
            void load();
          } catch (error) {
            message.error(errText(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Select
            value={flowDraft.formType}
            onChange={(value) => setFlowDraft({ ...flowDraft, formType: value })}
            options={[
              { value: "LEAD", label: "线索" },
              { value: "CUSTOMER", label: "客户" },
              { value: "OPPORTUNITY", label: "商机" },
              { value: "QUOTATION", label: "报价" },
              { value: "CONTRACT", label: "销售合同" },
              { value: "INVOICE", label: "发票" },
              { value: "ORDER", label: "订单" },
            ]}
          />
          <Input placeholder="审批流名称" value={flowDraft.name} onChange={(event) => setFlowDraft({ ...flowDraft, name: event.target.value })} />
          <Input.TextArea
            rows={12}
            value={flowDraft.nodes}
            onChange={(event) => setFlowDraft({ ...flowDraft, nodes: event.target.value })}
            placeholder='节点 JSON：[{"type":"APPROVER","name":"主管审批","approverType":"ROLE","role":"MANAGER","mode":"ALL"}]'
          />
        </Space>
      </Modal>
    </div>
  );
}

export function ReportsTab() {
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [funnel, setFunnel] = useState<Array<Record<string, unknown>>>([]);
  const [receivables, setReceivables] = useState<Record<string, unknown> | null>(null);
  const [range, setRange] = useState("month");

  useEffect(() => {
    void Promise.all([
      crmApi.statsOverview({ query: { range } }),
      crmApi.statsFunnel(),
      crmApi.statsReceivables(),
    ])
      .then(([a, b, c]) => {
        setOverview(a as Record<string, unknown>);
        setFunnel((b?.stages || []) as Array<Record<string, unknown>>);
        setReceivables(c as unknown as Record<string, unknown>);
      })
      .catch((error) => message.error(errText(error)));
  }, [range]);

  return (
    <div className="crm-stack">
      <Panel
        title="经营概览"
        extra={
          <Select
            value={range}
            style={{ width: 120 }}
            onChange={setRange}
            options={[
              { value: "week", label: "本周" },
              { value: "month", label: "本月" },
              { value: "year", label: "本年" },
            ]}
          />
        }
      >
        {overview ? (
          <Descriptions
            bordered
            size="small"
            column={4}
            items={[
              { key: "1", label: "赢单", children: String(overview.won || 0) },
              { key: "2", label: "输单", children: String(overview.lost || 0) },
              { key: "3", label: "合同金额", children: moneyCny(overview.contractAmount) },
              { key: "4", label: "回款金额", children: moneyCny(overview.paymentAmount) },
            ]}
          />
        ) : (
          <div className="muted">加载中…</div>
        )}
      </Panel>
      <Panel title="商机漏斗">
        <TableShell
          columns={[
            { title: "阶段", dataIndex: "name" },
            { title: "商机数", dataIndex: "count", width: 100 },
            { title: "金额", dataIndex: "amount", width: 180, render: (value: unknown) => moneyCny(value) },
          ]}
          rows={funnel as Array<{ name: string }>}
        />
      </Panel>
      <Panel title="回款报表">
        {receivables ? (
          <>
            <Descriptions
              bordered
              size="small"
              column={3}
              items={[
                { key: "1", label: "合同总额", children: moneyCny(receivables.total) },
                { key: "2", label: "已回款", children: moneyCny(receivables.paid) },
                { key: "3", label: "逾期金额", children: moneyCny(receivables.overdue) },
              ]}
            />
            <TableShell
              columns={[
                { title: "合同", dataIndex: "number", width: 160 },
                { title: "名称", dataIndex: "name" },
                { title: "金额", dataIndex: "amount", render: (value: unknown) => moneyCny(value) },
                { title: "已回款", dataIndex: "paid", render: (value: unknown) => moneyCny(value) },
                { title: "未回款", dataIndex: "remaining", render: (value: unknown) => moneyCny(value) },
              ]}
              rows={(receivables.rows || []) as Array<{ id: number; name: string }>}
            />
          </>
        ) : (
          <div className="muted">加载中…</div>
        )}
      </Panel>
    </div>
  );
}

function AiGuidePanel({ isAdmin }: { isAdmin: boolean }) {
  const [guide, setGuide] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    crmApi
      .settings()
      .then((data) => {
        const value = data?.aiAnalysisGuide || "";
        setGuide(value);
        setSaved(value);
      })
      .catch((error: unknown) => message.error(errText(error)))
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    setSaving(true);
    try {
      await crmApi.saveSettings({ body: { aiAnalysisGuide: guide } });
      setSaved(guide);
      message.success("已保存");
    } catch (error) {
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="AI 分析指引"
      titleExtra="商机 AI 分析按这里的口径评估价值与成单率"
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Input.TextArea
          rows={10}
          maxLength={4000}
          showCount={isAdmin}
          readOnly={!isAdmin}
          disabled={loading}
          value={guide}
          onChange={(event) => setGuide(event.target.value)}
          placeholder="例如：金额 ≥ 50 万且已确认预算的商机视为高价值；连续 14 天无跟进的商机成单率不超过 20%；政府与国企客户优先；报价已审批通过可上调成单率。"
        />
        {isAdmin ? (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="primary"
              loading={saving}
              disabled={loading || guide === saved}
              onClick={() => void submit()}
            >
              保存设置
            </Button>
          </div>
        ) : (
          <div className="muted">只有 CRM 负责人可以修改分析指引</div>
        )}
      </Space>
    </Panel>
  );
}

export function SettingsTab() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [members, setMembers] = useState<{ rows: CrmMemberRow[]; candidates: Array<Record<string, unknown>>; isAdmin: boolean } | null>(null);
  const [fields, setFields] = useState<Array<Record<string, unknown>>>([]);
  const [leadPools, setLeadPools] = useState<CrmPoolRow[]>([]);
  const [customerPools, setCustomerPools] = useState<CrmPoolRow[]>([]);
  const [stages, setStages] = useState<CrmStageRow[]>([]);
  const [contractStages, setContractStages] = useState<CrmStageRow[]>([]);
  const [orderStages, setOrderStages] = useState<CrmStageRow[]>([]);
  const [capacities, setCapacities] = useState<Array<Record<string, unknown>>>([]);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberDraft, setMemberDraft] = useState({ memberUserId: "", role: "SALES", dataScope: "SELF", department: "" });
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldDraft, setFieldDraft] = useState({ formKey: "lead", fieldKey: "", name: "", type: "text", required: false });
  const [poolOpen, setPoolOpen] = useState<{ kind: "lead" | "customer"; row?: CrmPoolRow } | null>(null);
  const [poolDraft, setPoolDraft] = useState({ name: "", description: "", auto: false });
  const [stageOpen, setStageOpen] = useState<{ kind: "opportunity" | "contract" | "order"; row?: CrmStageRow } | null>(null);
  const [stageDraft, setStageDraft] = useState({ name: "", type: "AFOOT", winRate: 0, sort: 0 });
  const [capacityDraft, setCapacityDraft] = useState({ targetType: "LEAD", scopeType: "ORG", scopeId: "", capacity: 0 });
  const [general, setGeneral] = useState({ maskPhone: true, maskEmail: true });
  const [generalSaving, setGeneralSaving] = useState(false);

  const load = async () => {
    try {
      const [s, m, f, lp, cp, os, cs, ords, caps] = await Promise.all([
        crmApi.settings(),
        crmApi.members(),
        crmApi.fieldDefs({ query: {} }),
        crmApi.leadPools(),
        crmApi.customerPools(),
        crmApi.opportunityStages(),
        crmApi.contractStages(),
        crmApi.orderStages(),
        crmApi.capacities({ query: { targetType: "LEAD" } }),
      ]);
      setSettings(s as Record<string, unknown>);
      setGeneral({
        maskPhone: Boolean(s?.maskPhone),
        maskEmail: Boolean(s?.maskEmail),
      });
      setMembers(m as never);
      setFields((f || []) as Array<Record<string, unknown>>);
      setLeadPools((lp || []) as CrmPoolRow[]);
      setCustomerPools((cp || []) as CrmPoolRow[]);
      setStages((os || []) as CrmStageRow[]);
      setContractStages((cs || []) as CrmStageRow[]);
      setOrderStages((ords || []) as CrmStageRow[]);
      setCapacities((caps || []) as Array<Record<string, unknown>>);
    } catch (error) {
      message.error(errText(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!settings) return <div className="muted">加载中…</div>;

  const generalDirty =
    general.maskPhone !== Boolean(settings.maskPhone) ||
    general.maskEmail !== Boolean(settings.maskEmail);

  const saveGeneral = async () => {
    const body: Record<string, unknown> = {};
    if (general.maskPhone !== Boolean(settings.maskPhone)) body.maskPhone = general.maskPhone;
    if (general.maskEmail !== Boolean(settings.maskEmail)) body.maskEmail = general.maskEmail;
    if (!Object.keys(body).length) return;
    setGeneralSaving(true);
    try {
      await crmApi.saveSettings({ body });
      message.success("已保存");
      await load();
    } catch (error) {
      message.error(errText(error));
    } finally {
      setGeneralSaving(false);
    }
  };

  return (
    <>
    <Tabs
      items={[
        {
          key: "general",
          label: "常规",
          children: (
            <Panel title="常规设置">
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap>
                  <span>手机号脱敏</span>
                  <Switch
                    checked={general.maskPhone}
                    onChange={(value) => setGeneral({ ...general, maskPhone: value })}
                  />
                  <span>邮箱脱敏</span>
                  <Switch
                    checked={general.maskEmail}
                    onChange={(value) => setGeneral({ ...general, maskEmail: value })}
                  />
                </Space>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    type="primary"
                    loading={generalSaving}
                    disabled={!generalDirty}
                    onClick={() => void saveGeneral()}
                  >
                    保存设置
                  </Button>
                </div>
              </Space>
            </Panel>
          ),
        },
        {
          key: "ai",
          label: "AI 分析",
          children: <AiGuidePanel isAdmin={Boolean(settings.isAdmin)} />,
        },
        {
          key: "members",
          label: `成员与权限（${members?.rows.length || 0}）`,
          children: (
            <Panel title="成员与权限" extra={<Button onClick={() => setMemberOpen(true)}>添加成员</Button>}>
              <TableShell
                columns={[
                  { title: "成员", dataIndex: "memberName" },
                  { title: "角色", dataIndex: "roleLabel", width: 100 },
                  { title: "数据范围", dataIndex: "dataScopeLabel", width: 120 },
                  { title: "部门", dataIndex: "department", width: 120 },
                  {
                    title: "操作",
                    width: 100,
                    render: (_: unknown, row: CrmMemberRow) => (
                      <ActionButton
                        danger
                        onClick={async () => {
                          await crmApi.removeMember({ params: { id: String(row.id) } });
                          void load();
                        }}
                      >
                        移除
                      </ActionButton>
                    ),
                  },
                ]}
                rows={members?.rows || []}
                empty="还没有成员"
              />
            </Panel>
          ),
        },
        {
          key: "fields",
          label: "自定义字段",
          children: (
            <Panel title="自定义字段" extra={<Button onClick={() => setFieldOpen(true)}>添加字段</Button>}>
              <TableShell
                columns={[
                  { title: "模块", dataIndex: "formKey", width: 100 },
                  { title: "字段", dataIndex: "name" },
                  { title: "标识", dataIndex: "fieldKey", width: 140 },
                  { title: "类型", dataIndex: "type", width: 100 },
                  { title: "必填", dataIndex: "required", width: 80, render: (value: boolean) => (value ? "是" : "否") },
                ]}
                rows={fields as Array<{ id: number; name: string }>}
                empty="暂无自定义字段"
              />
            </Panel>
          ),
        },
        {
          key: "pools",
          label: "线索池 / 公海",
          children: (
            <div className="crm-stack">
              <Panel title="线索池" extra={<Button onClick={() => setPoolOpen({ kind: "lead" })}>新建线索池</Button>}>
                <TableShell
                  columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "池内线索", dataIndex: "leadCount", width: 100 },
                    { title: "自动回收", dataIndex: "auto", width: 100, render: (value: boolean) => (value ? "是" : "否") },
                    { title: "启用", dataIndex: "enabled", width: 80, render: (value: boolean) => (value ? "是" : "否") },
                    {
                      title: "操作",
                      width: 100,
                      render: (_: unknown, row: CrmPoolRow) => <ActionButton onClick={() => setPoolOpen({ kind: "lead", row })}>编辑</ActionButton>,
                    },
                  ]}
                  rows={leadPools}
                  empty="暂无线索池"
                />
              </Panel>
              <Panel title="客户公海" extra={<Button onClick={() => setPoolOpen({ kind: "customer" })}>新建客户公海</Button>}>
                <TableShell
                  columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "池内客户", dataIndex: "leadCount", width: 100 },
                    { title: "自动回收", dataIndex: "auto", width: 100, render: (value: boolean) => (value ? "是" : "否") },
                    {
                      title: "操作",
                      width: 100,
                      render: (_: unknown, row: CrmPoolRow) => <ActionButton onClick={() => setPoolOpen({ kind: "customer", row })}>编辑</ActionButton>,
                    },
                  ]}
                  rows={customerPools}
                  empty="暂无客户公海"
                />
              </Panel>
              <Panel title="库容">
                <Space wrap>
                  <Select
                    value={capacityDraft.targetType}
                    onChange={(value) => setCapacityDraft({ ...capacityDraft, targetType: value })}
                    options={[
                      { value: "LEAD", label: "线索" },
                      { value: "CUSTOMER", label: "客户" },
                    ]}
                  />
                  <Select
                    value={capacityDraft.scopeType}
                    onChange={(value) => setCapacityDraft({ ...capacityDraft, scopeType: value })}
                    options={[
                      { value: "ORG", label: "全账号" },
                      { value: "DEPT", label: "按部门" },
                      { value: "MEMBER", label: "按成员" },
                    ]}
                  />
                  {capacityDraft.scopeType !== "ORG" ? (
                    <Input
                      placeholder={capacityDraft.scopeType === "DEPT" ? "部门名称" : "成员账号"}
                      value={capacityDraft.scopeId}
                      onChange={(event) => setCapacityDraft({ ...capacityDraft, scopeId: event.target.value })}
                    />
                  ) : null}
                  <InputNumber min={0} value={capacityDraft.capacity} onChange={(value) => setCapacityDraft({ ...capacityDraft, capacity: Number(value || 0) })} />
                  <Button
                    type="primary"
                    onClick={async () => {
                      await crmApi.saveCapacity({ body: capacityDraft as never });
                      void load();
                    }}
                  >
                    保存库容
                  </Button>
                </Space>
                <TableShell
                  columns={[
                    { title: "对象", dataIndex: "targetType", width: 80 },
                    { title: "范围", dataIndex: "scopeType", width: 80 },
                    { title: "对象", dataIndex: "scopeName" },
                    { title: "库容", dataIndex: "capacity", width: 80 },
                    { title: "已用", dataIndex: "used", width: 80 },
                  ]}
                  rows={capacities as Array<{ id: number; scopeName: string }>}
                />
              </Panel>
            </div>
          ),
        },
        {
          key: "stages",
          label: "阶段配置",
          children: (
            <div className="crm-stack">
              {[
                { title: "商机阶段", kind: "opportunity" as const, rows: stages },
                { title: "合同阶段", kind: "contract" as const, rows: contractStages },
                { title: "订单阶段", kind: "order" as const, rows: orderStages },
              ].map((group) => (
                <Panel key={group.kind} title={group.title} extra={<Button onClick={() => setStageOpen({ kind: group.kind })}>新增阶段</Button>}>
                  <TableShell
                    columns={[
                      { title: "名称", dataIndex: "name" },
                      { title: "类型", dataIndex: "type", width: 90 },
                      { title: "赢率", dataIndex: "winRate", width: 80 },
                      { title: "排序", dataIndex: "sort", width: 80 },
                      { title: "数量", dataIndex: "count", width: 80 },
                      { title: "金额", dataIndex: "amount", width: 140, render: (value: unknown) => moneyCny(value) },
                      {
                        title: "操作",
                        width: 100,
                        render: (_: unknown, row: CrmStageRow) => (
                          <ActionButton
                            onClick={() => {
                              setStageDraft({ name: row.name, type: row.type || "AFOOT", winRate: row.winRate, sort: row.sort });
                              setStageOpen({ kind: group.kind, row });
                            }}
                          >
                            编辑
                          </ActionButton>
                        ),
                      },
                    ]}
                    rows={group.rows}
                  />
                </Panel>
              ))}
            </div>
          ),
        },
      ]}
      />
      <Divider />
      <Modal
        open={memberOpen}
        title="添加成员"
        onCancel={() => setMemberOpen(false)}
        onOk={async () => {
          try {
            await crmApi.saveMember({ body: memberDraft as never });
            setMemberOpen(false);
            void load();
          } catch (error) {
            message.error(errText(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Select
            style={{ width: "100%" }}
            placeholder="从本账号职员与代理人中选择"
            value={memberDraft.memberUserId || undefined}
            onChange={(value) => setMemberDraft({ ...memberDraft, memberUserId: value })}
            options={(members?.candidates || []).map((item) => ({ value: String(item.memberUserId), label: String(item.name) }))}
          />
          <Select
            value={memberDraft.role}
            onChange={(value) => setMemberDraft({ ...memberDraft, role: value })}
            options={[
              { value: "ADMIN", label: "负责人" },
              { value: "MANAGER", label: "主管" },
              { value: "SALES", label: "销售" },
              { value: "FINANCE", label: "财务" },
              { value: "READONLY", label: "只读" },
            ]}
          />
          <Select
            value={memberDraft.dataScope}
            onChange={(value) => setMemberDraft({ ...memberDraft, dataScope: value })}
            options={[
              { value: "ALL", label: "本账号全部" },
              { value: "DEPT", label: "本部门" },
              { value: "SELF", label: "本人负责" },
            ]}
          />
          {memberDraft.dataScope === "DEPT" ? (
            <Input placeholder="部门名称" value={memberDraft.department} onChange={(event) => setMemberDraft({ ...memberDraft, department: event.target.value })} />
          ) : null}
        </Space>
      </Modal>

      <Modal
        open={fieldOpen}
        title="添加自定义字段"
        onCancel={() => setFieldOpen(false)}
        onOk={async () => {
          try {
            await crmApi.saveFieldDef({
              body: {
                formKey: fieldDraft.formKey,
                fieldKey: fieldDraft.fieldKey,
                name: fieldDraft.name,
                type: fieldDraft.type,
                required: fieldDraft.required,
                options: [],
                visible: true,
                editable: true,
                sort: 0,
              },
            });
            setFieldOpen(false);
            void load();
          } catch (error) {
            message.error(errText(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Select
            value={fieldDraft.formKey}
            onChange={(value) => setFieldDraft({ ...fieldDraft, formKey: value })}
            options={[
              { value: "lead", label: "线索" },
              { value: "customer", label: "客户" },
              { value: "contact", label: "联系人" },
              { value: "opportunity", label: "商机" },
              { value: "quotation", label: "报价" },
              { value: "contract", label: "合同" },
              { value: "order", label: "订单" },
            ]}
          />
          <Input placeholder="字段名称" value={fieldDraft.name} onChange={(event) => setFieldDraft({ ...fieldDraft, name: event.target.value })} />
          <Input placeholder="字段标识（英文）" value={fieldDraft.fieldKey} onChange={(event) => setFieldDraft({ ...fieldDraft, fieldKey: event.target.value })} />
          <Select
            value={fieldDraft.type}
            onChange={(value) => setFieldDraft({ ...fieldDraft, type: value })}
            options={[
              { value: "text", label: "单行文本" },
              { value: "textarea", label: "多行文本" },
              { value: "number", label: "数字" },
              { value: "date", label: "日期" },
              { value: "select", label: "单选" },
            ]}
          />
        </Space>
      </Modal>

      <Modal
        open={Boolean(poolOpen)}
        title={poolOpen?.kind === "customer" ? "客户公海" : "线索池"}
        onCancel={() => setPoolOpen(null)}
        onOk={async () => {
          if (!poolOpen) return;
          const body = { ...poolDraft, ...(poolOpen.row?.id ? { id: poolOpen.row.id } : {}) };
          if (poolOpen.kind === "lead") await crmApi.saveLeadPool({ body: body as never });
          else await crmApi.saveCustomerPool({ body: body as never });
          setPoolOpen(null);
          void load();
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="名称" value={poolDraft.name} onChange={(event) => setPoolDraft({ ...poolDraft, name: event.target.value })} />
          <Input placeholder="说明" value={poolDraft.description} onChange={(event) => setPoolDraft({ ...poolDraft, description: event.target.value })} />
          <Space>
            <span>自动回收</span>
            <Switch checked={poolDraft.auto} onChange={(value) => setPoolDraft({ ...poolDraft, auto: value })} />
          </Space>
        </Space>
      </Modal>

      <Modal
        open={Boolean(stageOpen)}
        title="阶段"
        onCancel={() => setStageOpen(null)}
        onOk={async () => {
          if (!stageOpen) return;
          const body = {
            ...(stageOpen.row?.id ? { id: stageOpen.row.id } : {}),
            name: stageDraft.name,
            type: stageDraft.type,
            winRate: stageDraft.winRate,
            sort: stageDraft.sort,
          };
          if (stageOpen.kind === "opportunity") await crmApi.saveOpportunityStage({ body: body as never });
          else if (stageOpen.kind === "contract") await crmApi.saveContractStage({ body: body as never });
          else await crmApi.saveOrderStage({ body: body as never });
          setStageOpen(null);
          void load();
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="阶段名称" value={stageDraft.name} onChange={(event) => setStageDraft({ ...stageDraft, name: event.target.value })} />
          {stageOpen?.kind === "opportunity" ? (
            <>
              <Select
                value={stageDraft.type}
                onChange={(value) => setStageDraft({ ...stageDraft, type: value })}
                options={[
                  { value: "AFOOT", label: "进行中" },
                  { value: "END", label: "结束" },
                ]}
              />
              <InputNumber min={0} max={100} addonAfter="%" value={stageDraft.winRate} onChange={(value) => setStageDraft({ ...stageDraft, winRate: Number(value || 0) })} />
            </>
          ) : null}
          <InputNumber min={0} value={stageDraft.sort} onChange={(value) => setStageDraft({ ...stageDraft, sort: Number(value || 0) })} />
        </Space>
      </Modal>
    </>
  );
}