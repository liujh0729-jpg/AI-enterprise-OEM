"use client";

import {
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { z, pjCostSummarySchema, projectInsightSchema, wbsSuggestResultSchema } from "@enterprise/contracts";
import { projectApi } from "@/api/project";
import { aiApi, type AiProjectStandup } from "@/api/ai";
import { AiList, AiResultModal } from "@/components/ai-result";
import { CollabDrawer } from "@/components/collab/collab-drawer";
import { EmptyState, Notice, Panel, PillTabs, StatCard, StatGrid } from "@/components/ui/panel";
import { fmtDate } from "@/lib/datetime";
import {
  PROJECT_STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  TASK_TYPE_OPTIONS,
  Toolbar,
  day,
  hours,
  money,
  pjError,
  priorityTag,
  ProgressInline,
  projectStatusTag,
  taskStatusTag,
  taskTypeTag,
  type PjMilestone,
  type PjProject,
  type PjProjectDetail,
  type PjSprint,
  type PjTask,
} from "./project-common";

type Insight = z.infer<typeof projectInsightSchema>;
type WbsResult = z.infer<typeof wbsSuggestResultSchema>;
type PjCostSummary = z.infer<typeof pjCostSummarySchema>;

export type StaffOption = { value: string; label: string };

export function PjProjectsTab({ staff }: { staff: StaffOption[] }) {
  const [rows, setRows] = useState<PjProject[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<PjProjectDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("members");
  const [collab, setCollab] = useState<PjProject | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectApi.projects({
        query: {
          page,
          pageSize: 20,
          q: q || undefined,
          status: status || undefined,
        },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(pjError(err));
    } finally {
      setLoading(false);
    }
  }, [page, q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: number) => {
    try {
      const data = await projectApi.project({ params: { id } });
      setDetail(data);
      setDetailTab("members");
      setDetailOpen(true);
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const openForm = (row?: PjProject) => {
    setEditing(
      row
        ? { ...row, budgetAmount: Number(row.budgetAmount), budgetHours: Number(row.budgetHours) }
        : { status: "PLANNING", currency: "CNY" },
    );
    form.setFieldsValue(
      row
        ? {
            ...row,
            budgetAmount: Number(row.budgetAmount),
            budgetHours: Number(row.budgetHours),
          }
        : { status: "PLANNING", currency: "CNY" },
    );
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await projectApi.saveProject({
        body: {
          id: editing?.id ? Number(editing.id) : undefined,
          code: values.code || "",
          name: values.name,
          description: values.description || "",
          source: "MANUAL",
          sourceRef: "",
          customerName: values.customerName || "",
          contractId: 0,
          ownerId: String(editing?.ownerId || ""),
          status: values.status || "PLANNING",
          startDate: values.startDate || "",
          endDate: values.endDate || "",
          budgetAmount: Number(values.budgetAmount || 0),
          budgetHours: Number(values.budgetHours || 0),
          currency: values.currency || "CNY",
        },
      });
      message.success("已保存");
      setEditing(null);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: PjProject) => {
    try {
      await projectApi.removeProject({ body: { id: row.id } });
      message.success("已删除");
      await load();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const columns: ColumnsType<PjProject> = [
    { title: "编号", dataIndex: "code", width: 130 },
    { title: "项目名称", dataIndex: "name", render: (value: string) => value || "—" },
    { title: "客户", dataIndex: "customerName", width: 130, render: (v: string) => v || "—" },
    { title: "负责人", dataIndex: "ownerName", width: 110 },
    { title: "状态", dataIndex: "status", width: 100, render: (v: string) => projectStatusTag(v) },
    {
      title: "进度",
      dataIndex: "taskDone",
      width: 160,
      render: (_: number, row) => <ProgressInline done={row.taskDone} total={row.taskTotal} />,
    },
    {
      title: "周期",
      dataIndex: "startDate",
      width: 200,
      render: (_: string, row) =>
        `${row.startDate ? fmtDate(row.startDate) : "—"} ~ ${row.endDate ? fmtDate(row.endDate) : "—"}`,
    },
    {
      title: "预算",
      dataIndex: "budgetAmount",
      width: 150,
      render: (v: string, row) => money(v, row.currency),
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => void openDetail(row.id)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => setCollab(row)}>
            协作
          </Button>
          <Button type="link" size="small" onClick={() => openForm(row)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => void remove(row)}>
            删除
          </Button>
        </>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="项目列表"
        extra={
          <Button type="primary" onClick={() => openForm()}>
            新建项目
          </Button>
        }
      >
        <Toolbar hint={`共 ${total} 个项目`}>
          <Input.Search
            allowClear
            placeholder="搜索项目名称 / 编号"
            style={{ width: 240 }}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="项目状态"
            style={{ width: 150 }}
            value={status || undefined}
            onChange={(value) => {
              setStatus(value || "");
              setPage(1);
            }}
            options={PROJECT_STATUS_OPTIONS}
          />
        </Toolbar>
        {error ? <Notice variant="error">{error}</Notice> : null}
        <Table<PjProject>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: "max-content" }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{ emptyText: "暂无项目" }}
        />
      </Panel>

      <Modal
        open={Boolean(editing)}
        title={editing?.id ? "编辑项目" : "新建项目"}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请填写项目名称" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="code" label="项目编号">
                <Input placeholder="留空自动生成" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="customerName" label="客户">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="项目状态">
                <Select options={PROJECT_STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="startDate" label="开始日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="endDate" label="结束日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="budgetAmount" label="预算金额">
                <InputNumber style={{ width: "100%" }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="budgetHours" label="预算工时（小时）">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="currency" label="币种">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="项目说明">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <PjDetailDrawer
        open={detailOpen}
        detail={detail}
        staff={staff}
        tab={detailTab}
        onTab={setDetailTab}
        onClose={() => setDetailOpen(false)}
        onChanged={async () => {
          if (detail) {
            const next = await projectApi.project({ params: { id: detail.id } });
            setDetail(next);
          }
          await load();
        }}
      />

      <CollabDrawer
        open={Boolean(collab)}
        onClose={() => setCollab(null)}
        targetType="PROJECT"
        targetId={collab ? String(collab.id) : ""}
        title={collab?.name}
        staff={staff}
      />
    </>
  );
}

function PjDetailDrawer({
  open,
  detail,
  staff,
  tab,
  onTab,
  onClose,
  onChanged,
}: {
  open: boolean;
  detail: PjProjectDetail | null;
  staff: StaffOption[];
  tab: string;
  onTab: (key: string) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [sprints, setSprints] = useState<PjSprint[]>([]);
  const [milestones, setMilestones] = useState<PjMilestone[]>([]);
  const [wbsRequirement, setWbsRequirement] = useState("");
  const [wbs, setWbs] = useState<WbsResult | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [standup, setStandup] = useState<AiProjectStandup | null>(null);
  const [standupOpen, setStandupOpen] = useState(false);
  const [standupLoading, setStandupLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<PjTask[]>([]);
  const [cost, setCost] = useState<PjCostSummary | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");

  const projectId = detail?.id || 0;

  const loadLists = useCallback(async () => {
    if (!projectId) return;
    try {
      const [sprintRows, milestoneRows] = await Promise.all([
        projectApi.sprints({ query: { projectId } }),
        projectApi.milestones({ query: { projectId } }),
      ]);
      setSprints(sprintRows || []);
      setMilestones(milestoneRows || []);
    } catch {
      setSprints([]);
      setMilestones([]);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && projectId) void loadLists();
  }, [open, projectId, loadLists]);

  const loadDelivery = useCallback(async () => {
    if (!projectId) return;
    setDeliveryLoading(true);
    setDeliveryError("");
    try {
      const [taskPage, costSummary] = await Promise.all([
        projectApi.tasks({ query: { projectId, page: 1, pageSize: 200 } }),
        projectApi.projectCost({ params: { id: projectId } }).catch(() => null),
      ]);
      setTasks(taskPage?.list || []);
      setCost(costSummary);
    } catch (err) {
      setDeliveryError(pjError(err));
      setTasks([]);
      setCost(null);
    } finally {
      setDeliveryLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && projectId) void loadDelivery();
  }, [open, projectId, loadDelivery]);

  const addMember = async (values: Record<string, unknown>) => {
    try {
      await projectApi.saveMember({
        body: {
          projectId,
          principalType: "STAFF",
          principalId: String(values.principalId || ""),
          role: String(values.role || "MEMBER") as "OWNER" | "MEMBER" | "APPROVER",
          allocationPct: Number(values.allocationPct || 100),
        },
      });
      message.success("已添加成员");
      await onChanged();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const addMilestone = async (values: Record<string, unknown>) => {
    try {
      await projectApi.saveMilestone({
        body: {
          projectId,
          name: String(values.name || ""),
          dueDate: String(values.dueDate || ""),
          status: "TODO",
          deliverable: String(values.deliverable || ""),
          acceptanceNote: "",
        },
      });
      await loadLists();
      await onChanged();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const addSprint = async (values: Record<string, unknown>) => {
    try {
      await projectApi.saveSprint({
        body: {
          projectId,
          name: String(values.name || ""),
          goal: String(values.goal || ""),
          startDate: String(values.startDate || ""),
          endDate: String(values.endDate || ""),
          capacityHours: Number(values.capacityHours || 0),
          status: "PLANNED",
        },
      });
      await loadLists();
      await onChanged();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const runWbs = async () => {
    if (!projectId || !wbsRequirement.trim()) return;
    setBusy(true);
    try {
      const result = await projectApi.wbsSuggest({
        body: { projectId, requirement: wbsRequirement, maxTasks: 8 },
      });
      setWbs(result);
    } catch (err) {
      message.error(pjError(err));
    } finally {
      setBusy(false);
    }
  };

  const runInsight = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      setInsight(await projectApi.insight({ body: { projectId } }));
    } catch (err) {
      message.error(pjError(err));
    } finally {
      setBusy(false);
    }
  };

  const runStandup = async () => {
    if (!projectId) return;
    setStandupOpen(true);
    setStandupLoading(true);
    setStandup(null);
    try {
      setStandup(await aiApi.projectStandup({ body: { projectId, days: 7 } }));
    } catch (err) {
      message.error(pjError(err));
      setStandupOpen(false);
    } finally {
      setStandupLoading(false);
    }
  };

  const doneTasks = tasks.filter((task) => task.status === "DONE").length;
  const doingTasks = tasks.filter((task) => task.status === "IN_PROGRESS").length;
  const today = new Date().toISOString().slice(0, 10);
  const overdueTasks = tasks.filter(
    (task) => task.status !== "DONE" && Boolean(task.dueDate) && task.dueDate.slice(0, 10) < today,
  ).length;

  return (
    <Drawer
      open={open}
      size={900}
      title={detail?.name || "项目详情"}
      onClose={onClose}
      destroyOnHidden
    >
      {!detail ? null : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {projectStatusTag(detail.status)}
            <Tag>{`${detail.code || `#${detail.id}`}`}</Tag>
            <Tag>{`客户：${detail.customerName || "—"}`}</Tag>
            <Tag>{`负责人：${detail.ownerName || "—"}`}</Tag>
            <Tag>{`预算：${money(detail.budgetAmount, detail.currency)}`}</Tag>
            <Tag>{`工时预算：${hours(Number(detail.budgetHours) * 60)}`}</Tag>
            <Button style={{ marginLeft: "auto" }} onClick={() => void runStandup()}>
              AI 站会
            </Button>
          </div>
          {detail.description ? (
            <p className="muted text-12" style={{ whiteSpace: "pre-wrap" }}>
              {detail.description}
            </p>
          ) : null}

          <PillTabs
            items={[
              { key: "delivery", label: "交付", count: tasks.length },
              { key: "cost", label: "成本", count: cost?.costItemCount },
              { key: "members", label: "成员", count: detail.members.length },
              { key: "sprints", label: "迭代", count: sprints.length },
              { key: "milestones", label: "里程碑", count: milestones.length },
              { key: "ai", label: "AI 建议" },
            ]}
            value={tab}
            onChange={onTab}
            style={{ marginBottom: 12 }}
          />

          {tab === "delivery" ? (
            deliveryError ? (
              <Notice variant="error">{deliveryError}</Notice>
            ) : (
              <>
                <StatGrid>
                  <StatCard label="任务总数" value={String(tasks.length)} />
                  <StatCard
                    label="已完成"
                    value={String(doneTasks)}
                    hint={tasks.length ? `${Math.round((doneTasks / tasks.length) * 100)}%` : "—"}
                  />
                  <StatCard label="进行中" value={String(doingTasks)} />
                  <StatCard
                    label="逾期未完成"
                    value={String(overdueTasks)}
                    hint={overdueTasks ? "需要优先处理" : "无逾期"}
                  />
                </StatGrid>
                <div style={{ margin: "12px 0" }}>
                  <ProgressInline done={doneTasks} total={tasks.length} />
                </div>
                {tasks.length ? (
                  <Table
                    rowKey="id"
                    size="small"
                    loading={deliveryLoading}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    dataSource={tasks}
                    columns={[
                      { title: "任务", dataIndex: "title" },
                      { title: "负责人", dataIndex: "assigneeName", render: (v: string) => v || "—" },
                      { title: "状态", dataIndex: "status", render: (v: string) => taskStatusTag(v) },
                      { title: "优先级", dataIndex: "priority", render: (v: string) => priorityTag(v) },
                      { title: "截止", dataIndex: "dueDate", render: (v: string) => (v ? fmtDate(v) : "—") },
                      {
                        title: "权重",
                        dataIndex: "assessmentWeight",
                        render: (v: string) => `${Number(v || 0)}%`,
                      },
                      {
                        title: "验收项",
                        dataIndex: "acceptanceCriteria",
                        render: (rows: PjTask["acceptanceCriteria"]) => `${rows.length} 项`,
                      },
                    ]}
                  />
                ) : (
                  <EmptyState text="该项目还没有任务：可在「任务」页签创建，或用「AI 建议」拆解。" />
                )}
              </>
            )
          ) : null}

          {tab === "cost" ? (
            deliveryError ? (
              <Notice variant="error">{deliveryError}</Notice>
            ) : !cost ? (
              <EmptyState text="暂时拿不到成本汇总（可能需要成本权限）。" />
            ) : (
              <>
                <StatGrid>
                  <StatCard label="合同预算" value={money(cost.budgetAmount, cost.currency)} />
                  <StatCard
                    label="已发生成本"
                    value={money(cost.costTotal, cost.currency)}
                    hint={`预算使用 ${cost.budgetUtilizationPct.toFixed(1)}%`}
                  />
                  <StatCard
                    label="外部合作"
                    value={money(cost.engagementAmount, cost.currency)}
                    hint={`${cost.engagementCount} 单 / 已结算 ${cost.settledEngagementCount}`}
                  />
                  <StatCard
                    label="已记工时"
                    value={hours(cost.timeLogMinutes)}
                    hint={cost.missingRateMinutes ? `缺费率 ${hours(cost.missingRateMinutes)}` : "费率已齐"}
                  />
                </StatGrid>
                {cost.byKind.length ? (
                  <Table
                    style={{ marginTop: 12 }}
                    rowKey="kind"
                    size="small"
                    pagination={false}
                    dataSource={cost.byKind}
                    columns={[
                      { title: "成本类型", dataIndex: "label" },
                      { title: "笔数", dataIndex: "items" },
                      { title: "金额", dataIndex: "amount", render: (v: string) => money(v, cost.currency) },
                    ]}
                  />
                ) : null}
                <p className="muted text-12" style={{ marginTop: 10 }}>
                  成本项、费率与外部合作在项目页「成本」页签维护，这里只做项目内汇总。
                </p>
              </>
            )
          ) : null}

          {tab === "members" ? (
            <>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detail.members}
                columns={[
                  { title: "成员", dataIndex: "name" },
                  { title: "类型", dataIndex: "principalType", render: (v: string) => (v === "ASSIGNMENT" ? "代理人" : "职员") },
                  { title: "角色", dataIndex: "role", render: (v: string) => (v === "OWNER" ? "负责人" : v === "APPROVER" ? "审批人" : "成员") },
                  { title: "投入", dataIndex: "allocationPct", render: (v: number) => `${v}%` },
                ]}
              />
              <MemberForm staff={staff} onSubmit={addMember} />
            </>
          ) : null}

          {tab === "sprints" ? (
            <>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={sprints}
                columns={[
                  { title: "迭代", dataIndex: "name" },
                  { title: "目标", dataIndex: "goal", render: (v: string) => v || "—" },
                  { title: "周期", dataIndex: "startDate", render: (_: string, row) => `${day(row.startDate)} ~ ${day(row.endDate)}` },
                  { title: "容量", dataIndex: "capacityHours", render: (v: string) => hours(Number(v) * 60) },
                  { title: "状态", dataIndex: "status", render: (v: string) => <Tag>{v === "ACTIVE" ? "进行中" : v === "CLOSED" ? "已关闭" : "计划中"}</Tag> },
                ]}
              />
              <SimpleForm
                fields={[
                  { name: "name", label: "迭代名称", required: true },
                  { name: "goal", label: "迭代目标" },
                  { name: "startDate", label: "开始日期", type: "date" },
                  { name: "endDate", label: "结束日期", type: "date" },
                  { name: "capacityHours", label: "容量（小时）", type: "number" },
                ]}
                onSubmit={addSprint}
                submitText="添加迭代"
              />
            </>
          ) : null}

          {tab === "milestones" ? (
            <>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={milestones}
                columns={[
                  { title: "里程碑", dataIndex: "name" },
                  { title: "截止日期", dataIndex: "dueDate", render: (v: string) => day(v) },
                  { title: "状态", dataIndex: "status", render: (v: string) => <Tag color={v === "DONE" ? "green" : "gold"}>{v === "DONE" ? "已完成" : "待完成"}</Tag> },
                  { title: "交付物", dataIndex: "deliverable", render: (v: string) => v || "—" },
                ]}
              />
              <SimpleForm
                fields={[
                  { name: "name", label: "里程碑名称", required: true },
                  { name: "dueDate", label: "截止日期", type: "date" },
                  { name: "deliverable", label: "交付物" },
                ]}
                onSubmit={addMilestone}
                submitText="添加里程碑"
              />
            </>
          ) : null}

          {tab === "ai" ? (
            <>
              <Panel title="AI 拆解任务（WBS）">
                <Input.TextArea
                  rows={3}
                  value={wbsRequirement}
                  onChange={(event) => setWbsRequirement(event.target.value)}
                  placeholder="描述需求，例如：为跨境客户搭建独立站，包含选品、建站、支付与投放"
                />
                <div style={{ marginTop: 8 }}>
                  <Button type="primary" loading={busy} onClick={() => void runWbs()}>
                    生成任务拆解
                  </Button>
                </div>
                {wbs ? (
                  <Table
                    style={{ marginTop: 12 }}
                    rowKey="title"
                    size="small"
                    pagination={false}
                    dataSource={wbs.tasks}
                    columns={[
                      { title: "任务", dataIndex: "title" },
                      { title: "类型", dataIndex: "type", render: (v: string) => taskTypeTag(v) },
                      { title: "优先级", dataIndex: "priority", render: (v: string) => priorityTag(v) },
                      { title: "预估工时", dataIndex: "estimateHours" },
                      { title: "建议承接", dataIndex: "assigneeName", render: (v: string) => v || "—" },
                      { title: "理由", dataIndex: "reason" },
                    ]}
                  />
                ) : null}
                {wbs ? (
                  <div style={{ marginTop: 8 }}>
                    <Button
                      onClick={() =>
                        void Promise.all(
                          wbs.tasks.map((task) =>
                            projectApi.saveTask({
                              body: {
                                projectId,
                                title: task.title,
                                description: "",
                                sourceType: "MANUAL",
                                sourceId: "",
                                acceptanceCriteria: [],
                                qualityRubric: {},
                                assessmentWeight: 1,
                                type: (TASK_TYPE_OPTIONS.some((o) => o.value === task.type) ? task.type : "TASK") as "TASK",
                                priority: (PRIORITY_OPTIONS.some((o) => o.value === task.priority) ? task.priority : "MEDIUM") as "MEDIUM",
                                status: "TODO",
                                assigneeType: task.assigneeId ? "STAFF" : "NONE",
                                assigneeId: task.assigneeId || "",
                                estimateHours: task.estimateHours,
                                estimatePoints: 0,
                                startDate: "",
                                dueDate: "",
                                sortOrder: 0,
                                sprintId: 0,
                                milestoneId: 0,
                                parentId: 0,
                              },
                            }),
                          ),
                        )
                          .then(() => {
                            message.success("任务已写入项目");
                            void onChanged();
                          })
                          .catch((err) => message.error(pjError(err)))
                      }
                    >
                      把拆解结果全部写入任务
                    </Button>
                  </div>
                ) : null}
              </Panel>

              <Panel title="项目健康度评估" extra={<Button loading={busy} onClick={() => void runInsight()}>运行评估</Button>}>
                {!insight ? (
                  <span className="muted">尚未评估：运行后给出风险等级、原因与建议。</span>
                ) : (
                  <div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <Tag color={insight.riskLevel === "HIGH" ? "red" : insight.riskLevel === "MEDIUM" ? "gold" : "green"}>
                        {insight.riskLevel === "HIGH" ? "高风险" : insight.riskLevel === "MEDIUM" ? "中风险" : "低风险"}
                      </Tag>
                      <Tag>{`进度 ${insight.progress}%`}</Tag>
                      <Tag>{`逾期 ${insight.overdueTasks} 项`}</Tag>
                      <Tag>{`投入 ${hours(insight.loggedMinutes)} / ${hours(insight.budgetMinutes)}`}</Tag>
                      <Tag>{`成本估算 ${money(insight.costEstimate, detail.currency)}`}</Tag>
                    </div>
                    <div className="muted text-12">原因：{insight.reasons.join("；") || "—"}</div>
                    <div className="muted text-12">建议：{insight.suggestions.join("；") || "—"}</div>
                  </div>
                )}
              </Panel>
            </>
          ) : null}
        </>
      )}
      <AiResultModal
        open={standupOpen}
        title={detail ? `AI 站会 · ${detail.name}` : "AI 站会"}
        loading={standupLoading}
        mode={standup?.mode}
        model={standup?.model}
        onClose={() => setStandupOpen(false)}
        width={720}
      >
        {standup ? (
          <>
            <div>{standup.summary}</div>
            <AiList title="已完成" items={standup.done} />
            <AiList title="进行中" items={standup.doing} />
            <AiList title="受阻" items={standup.blocked} />
            <AiList title="下一步" items={standup.next} />
          </>
        ) : null}
      </AiResultModal>
    </Drawer>
  );
}

function MemberForm({
  staff,
  onSubmit,
}: {
  staff: StaffOption[];
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [form] = Form.useForm();
  return (
    <Form
      form={form}
      layout="inline"
      style={{ marginTop: 12, gap: 8 }}
      onFinish={(values) => void onSubmit(values).then(() => form.resetFields())}
      initialValues={{ role: "MEMBER", allocationPct: 100 }}
    >
      <Form.Item name="principalId" rules={[{ required: true, message: "选择成员" }]}>
        <Select showSearch optionFilterProp="label" placeholder="选择职员/代理人" style={{ width: 220 }} options={staff} />
      </Form.Item>
      <Form.Item name="role">
        <Select style={{ width: 120 }} options={[{ value: "MEMBER", label: "成员" }, { value: "APPROVER", label: "审批人" }, { value: "OWNER", label: "负责人" }]} />
      </Form.Item>
      <Form.Item name="allocationPct">
        <InputNumber min={0} max={100} suffix="%" style={{ width: 120 }} />
      </Form.Item>
      <Form.Item>
        <Button htmlType="submit">添加成员</Button>
      </Form.Item>
    </Form>
  );
}

export function SimpleForm({
  fields,
  onSubmit,
  submitText,
}: {
  fields: { name: string; label: string; type?: "text" | "date" | "number"; required?: boolean }[];
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  submitText: string;
}) {
  const [form] = Form.useForm();
  return (
    <Form
      form={form}
      layout="inline"
      style={{ marginTop: 12, gap: 8 }}
      onFinish={(values) => void onSubmit(values).then(() => form.resetFields())}
    >
      {fields.map((field) => (
        <Form.Item
          key={field.name}
          name={field.name}
          rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}
        >
          {field.type === "date" ? (
            <Input type="date" />
          ) : field.type === "number" ? (
            <InputNumber min={0} />
          ) : (
            <Input placeholder={field.label} />
          )}
        </Form.Item>
      ))}
      <Form.Item>
        <Button htmlType="submit">{submitText}</Button>
      </Form.Item>
    </Form>
  );
}
