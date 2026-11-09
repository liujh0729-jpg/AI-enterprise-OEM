"use client";

import {
  Button,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { projectApi } from "@/api/project";
import { aiApi, type AiProjectSplit } from "@/api/ai";
import { AiResultModal } from "@/components/ai-result";
import { partyApi } from "@/api/party";
import { CollabDrawer } from "@/components/collab/collab-drawer";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import {
  PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_TYPE_OPTIONS,
  Toolbar,
  day,
  pjError,
  priorityTag,
  taskTypeTag,
  type PjDemand,
  type PjDemandResponse,
  type PjProject,
  type PjTask,
} from "./project-common";

const SOURCE_LABELS: Record<string, string> = {
  OKR: "来自 OKR",
  CRM_ORDER: "来自订单",
  DEMAND: "来自需求",
  OA: "来自审批",
};

export function PjTasksTab({ staff }: { staff: { value: string; label: string }[] }) {
  const [projects, setProjects] = useState<PjProject[]>([]);
  const [rows, setRows] = useState<PjTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [projectId, setProjectId] = useState(0);
  const [status, setStatus] = useState("TODO");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [relation, setRelation] = useState<PjTask | null>(null);
  const [relationForm] = Form.useForm();
  const [collab, setCollab] = useState<PjTask | null>(null);
  const [splitTask, setSplitTask] = useState<PjTask | null>(null);
  const [splitResult, setSplitResult] = useState<AiProjectSplit | null>(null);
  const [splitLoading, setSplitLoading] = useState(false);
  const [parties, setParties] = useState<{ value: string; label: string }[]>([]);
  const [assigneeType, setAssigneeType] = useState("STAFF");
  const [demandTask, setDemandTask] = useState<PjTask | null>(null);
  const [demand, setDemand] = useState<PjDemand | null>(null);
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandSaving, setDemandSaving] = useState(false);
  const [demandForm] = Form.useForm();
  const [respondForm] = Form.useForm();

  useEffect(() => {
    void projectApi
      .projects({ query: { page: 1, pageSize: 100 } })
      .then((data) => setProjects(data?.list || []))
      .catch(() => setProjects([]));
    void partyApi
      .list({ query: { page: 1, pageSize: 200, status: "ACTIVE" } })
      .then((data) =>
        setParties(
          (data?.list || []).map((row) => ({
            value: String(row.id),
            label: `${row.name} · ${row.kindLabel}`,
          })),
        ),
      )
      .catch(() => setParties([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectApi.tasks({
        query: {
          page,
          pageSize: 20,
          projectId: projectId || undefined,
          status: status || undefined,
          q: q || undefined,
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
  }, [page, projectId, status, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const openForm = (row?: PjTask) => {
    const levels =
      row && Array.isArray((row.qualityRubric as { levels?: unknown }).levels)
        ? ((row.qualityRubric as { levels: Array<{ level?: string; description?: string }> }).levels)
        : [];
    const levelOf = (label: string) =>
      levels.find((item) => item.level === label)?.description || "";
    const initial = row
      ? {
          ...row,
          estimateHours: Number(row.estimateHours),
          assigneeType: row.assigneeType === "NONE" ? "NONE" : row.assigneeType,
          assessmentWeight: Number(row.assessmentWeight || 1),
          criteria: row.acceptanceCriteria,
          rubricPass: levelOf("合格"),
          rubricGood: levelOf("良好"),
          rubricExcellent: levelOf("优秀"),
        }
      : {
          projectId: projectId || projects[0]?.id,
          status: "TODO",
          type: "TASK",
          priority: "MEDIUM",
          assigneeType: "STAFF",
          assessmentWeight: 1,
          criteria: [],
        };
    setAssigneeType(String(initial.assigneeType || "NONE"));
    setEditing(initial as Record<string, unknown>);
    form.setFieldsValue(initial);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const criteria = (Array.isArray(values.criteria) ? values.criteria : [])
        .filter((item: { label?: string }) => item?.label)
        .map((item: { label: string; required?: boolean; evidence?: string }, index: number) => ({
          key: `c${index + 1}`,
          label: item.label,
          required: Boolean(item.required),
          evidence: item.evidence || "",
        }));
      const levels = [
        { level: "合格", description: values.rubricPass || "" },
        { level: "良好", description: values.rubricGood || "" },
        { level: "优秀", description: values.rubricExcellent || "" },
      ].filter((item) => item.description);
      setSaving(true);
      await projectApi.saveTask({
        body: {
          id: editing?.id ? Number(editing.id) : undefined,
          projectId: values.projectId,
          sprintId: Number(editing?.sprintId || 0),
          milestoneId: Number(editing?.milestoneId || 0),
          parentId: Number(editing?.parentId || 0),
          title: values.title,
          description: values.description || "",
          sourceType: (editing?.sourceType as "MANUAL") || "MANUAL",
          sourceId: String(editing?.sourceId || ""),
          acceptanceCriteria: criteria,
          qualityRubric: levels.length ? { levels } : {},
          assessmentWeight: Number(values.assessmentWeight || 1),
          type: values.type || "TASK",
          priority: values.priority || "MEDIUM",
          status: values.status || "TODO",
          assigneeType:
            values.assigneeType === "NONE" ? "NONE" : values.assigneeType || "STAFF",
          assigneeId:
            values.assigneeType === "NONE" ? "" : values.assigneeId || "",
          estimateHours: Number(values.estimateHours || 0),
          estimatePoints: Number(editing?.estimatePoints || 0),
          startDate: values.startDate || "",
          dueDate: values.dueDate || "",
          sortOrder: Number(editing?.sortOrder || 0),
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

  const move = async (row: PjTask, next: string) => {
    try {
      await projectApi.moveTask({ body: { id: row.id, status: next as "TODO" } });
      await load();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const remove = async (row: PjTask) => {
    try {
      await projectApi.removeTask({ body: { id: row.id } });
      message.success("已删除");
      await load();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const runSplit = async (row: PjTask) => {
    setSplitTask(row);
    setSplitResult(null);
    setSplitLoading(true);
    try {
      setSplitResult(
        await aiApi.projectSplitTask({ body: { taskId: row.id, max: 6 } }),
      );
    } catch (err) {
      message.error(pjError(err));
      setSplitTask(null);
    } finally {
      setSplitLoading(false);
    }
  };

  const loadDemand = async (task: PjTask) => {
    setDemandLoading(true);
    try {
      const data = await projectApi.demand({ params: { id: task.id } });
      setDemand(data);
      demandForm.setFieldsValue(
        data
          ? {
              title: data.title,
              scope: data.scope,
              deliverables: data.deliverables,
              acceptance: data.acceptance,
              budgetAmount: Number(data.budgetAmount),
              currency: data.currency,
              startDate: data.startDate,
              dueDate: data.dueDate,
            }
          : {
              title: task.title,
              scope: task.description,
              deliverables: "",
              acceptance: task.acceptanceCriteria
                .map((item) => item.label)
                .join("\n"),
              budgetAmount: 0,
              currency: "CNY",
              startDate: task.startDate,
              dueDate: task.dueDate,
            },
      );
    } catch (err) {
      setDemand(null);
      message.error(pjError(err));
    } finally {
      setDemandLoading(false);
    }
  };

  const openDemand = (task: PjTask) => {
    setDemandTask(task);
    setDemand(null);
    respondForm.resetFields();
    void loadDemand(task);
  };

  const saveDemand = async (publish: boolean) => {
    if (!demandTask) return;
    try {
      const values = await demandForm.validateFields();
      setDemandSaving(true);
      const data = await projectApi.saveDemand({
        body: {
          taskId: demandTask.id,
          title: values.title,
          scope: values.scope || "",
          deliverables: values.deliverables || "",
          acceptance: values.acceptance || "",
          budgetAmount: Number(values.budgetAmount || 0),
          currency: values.currency || "CNY",
          startDate: values.startDate || "",
          dueDate: values.dueDate || "",
          publish,
        },
      });
      if (data) setDemand(data);
      message.success(publish ? "需求已发布" : "草稿已保存");
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    } finally {
      setDemandSaving(false);
    }
  };

  const respond = async () => {
    if (!demand) return;
    try {
      const values = await respondForm.validateFields();
      setDemandSaving(true);
      const data = await projectApi.respondDemand({
        body: {
          demandId: demand.id,
          partyId: Number(values.partyId || 0),
          partyName: values.partyName || "",
          contact: values.contact || "",
          quoteAmount: Number(values.quoteAmount || 0),
          currency: values.currency || demand.currency,
          durationDays: Number(values.durationDays || 0),
          note: values.note || "",
        },
      });
      if (data) setDemand(data);
      respondForm.resetFields();
      message.success("已登记响应");
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    } finally {
      setDemandSaving(false);
    }
  };

  const acceptResponse = (row: PjDemandResponse) => {
    if (!demand) return;
    Modal.confirm({
      title: `采纳「${row.partyName || "响应方"}」的响应？`,
      content: "采纳后会创建外部合作，并把任务指派给该合作方。",
      onOk: async () => {
        try {
          const data = await projectApi.acceptDemand({
            body: { demandId: demand.id, responseId: row.id, note: "" },
          });
          if (data) setDemand(data);
          message.success("已采纳并创建外部合作");
          await load();
        } catch (err) {
          message.error(pjError(err));
        }
      },
    });
  };

  const closeDemand = async () => {
    if (!demand) return;
    try {
      const data = await projectApi.closeDemand({
        body: { demandId: demand.id },
      });
      if (data) setDemand(data);
      message.success("需求已关闭");
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const addRelation = async () => {
    if (!relation) return;
    try {
      const values = await relationForm.validateFields();
      await projectApi.addRelation({
        body: {
          taskId: relation.id,
          relatedTaskId: Number(values.relatedTaskId),
          kind: values.kind || "FS",
        },
      });
      message.success("已添加依赖");
      setRelation(null);
      relationForm.resetFields();
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    }
  };

  const columns: ColumnsType<PjTask> = [
    { title: "任务", dataIndex: "title", render: (value: string, row) => (
      <span>
        {value}
        {SOURCE_LABELS[row.sourceType] ? (
          <Tag color="blue" className="ml-6">
            {SOURCE_LABELS[row.sourceType]}
          </Tag>
        ) : null}
        {row.relations.length ? <span className="muted text-12">{` · 依赖 ${row.relations.length} 项`}</span> : null}
      </span>
    ) },
    { title: "项目", dataIndex: "projectName", width: 150 },
    { title: "类型", dataIndex: "type", width: 80, render: (v: string) => taskTypeTag(v) },
    { title: "优先级", dataIndex: "priority", width: 90, render: (v: string) => priorityTag(v) },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (v: string, row) => (
        <Select
          size="small"
          value={v}
          style={{ width: 110 }}
          options={TASK_STATUS_OPTIONS}
          onChange={(next) => void move(row, next)}
        />
      ),
    },
    { title: "承接人", dataIndex: "assigneeName", width: 110, render: (v: string) => v || "—" },
    { title: "预估", dataIndex: "estimateHours", width: 90, render: (v: string) => `${v}h` },
    { title: "已记工时", dataIndex: "loggedMinutes", width: 100, render: (v: number) => `${(v / 60).toFixed(1)}h` },
    {
      title: "验收 / 权重",
      key: "acceptance",
      width: 120,
      render: (_: unknown, row) => (
        <span>
          {row.acceptanceCriteria.length ? `${row.acceptanceCriteria.length} 项` : "—"}
          <span className="muted"> · {Number(row.assessmentWeight || 0)}%</span>
        </span>
      ),
    },
    { title: "截止", dataIndex: "dueDate", width: 110, render: (v: string) => day(v) },
    {
      title: "操作",
      key: "actions",
      width: 360,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => openForm(row)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => void runSplit(row)}>
            AI 拆任务
          </Button>
          <Button type="link" size="small" onClick={() => openDemand(row)}>
            外发
          </Button>
          <Button type="link" size="small" onClick={() => setCollab(row)}>
            协作
          </Button>
          <Button type="link" size="small" onClick={() => setRelation(row)}>
            依赖
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
        title="任务"
        extra={
          <Button type="primary" onClick={() => openForm()}>
            新建任务
          </Button>
        }
      >
        <Toolbar hint={`共 ${total} 个任务`}>
          <Input.Search
            allowClear
            placeholder="搜索任务标题"
            style={{ width: 220 }}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="全部项目"
            style={{ width: 220 }}
            value={projectId || undefined}
            onChange={(value) => {
              setProjectId(Number(value || 0));
              setPage(1);
            }}
            options={projects.map((row) => ({ value: row.id, label: row.name }))}
          />
          <PillTabs
            items={[
              { key: "", label: "全部" },
              ...TASK_STATUS_OPTIONS.map((item) => ({ key: item.value, label: item.label })),
            ]}
            value={status}
            onChange={(key) => {
              setStatus(key);
              setPage(1);
            }}
            size="small"
            variant="soft"
          />
        </Toolbar>
        {error ? <Notice variant="error">{error}</Notice> : null}
        <Table<PjTask>
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
          locale={{ emptyText: "暂无任务" }}
        />
      </Panel>

      <Modal
        open={Boolean(editing)}
        title={editing?.id ? "编辑任务" : "新建任务"}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="title" label="任务标题" rules={[{ required: true, message: "请填写任务标题" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="projectId" label="所属项目" rules={[{ required: true, message: "请选择项目" }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={projects.map((row) => ({ value: row.id, label: row.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="assigneeType" label="承接类型">
                <Select
                  options={[
                    { value: "STAFF", label: "内部员工" },
                    { value: "ASSIGNMENT", label: "任务承接" },
                    { value: "PARTY", label: "外部合作方" },
                    { value: "NONE", label: "暂不指派" },
                  ]}
                  onChange={(value) => {
                    setAssigneeType(String(value));
                    form.setFieldValue("assigneeId", undefined);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="assigneeId" label="承接方">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  disabled={assigneeType === "NONE"}
                  options={assigneeType === "PARTY" ? parties : staff}
                  placeholder={assigneeType === "PARTY" ? "选择合作方" : "选择员工"}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="type" label="类型">
                <Select options={TASK_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="priority" label="优先级">
                <Select options={PRIORITY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="status" label="状态">
                <Select options={TASK_STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="estimateHours" label="预估工时（小时）">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="assessmentWeight" label="考核权重（%）" tooltip="绩效评估时该任务在所属目标中的权重">
                <InputNumber style={{ width: "100%" }} min={0} max={100} />
              </Form.Item>
            </Col>
            <Col span={9}>
              <Form.Item name="startDate" label="开始日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={9}>
              <Form.Item name="dueDate" label="截止日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="任务说明">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <div className="text-13 muted mb-8">验收标准（逐条添加，勾选必达项）</div>
              <Form.List name="criteria">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((field) => (
                      <Row gutter={8} key={field.key} align="top" className="mb-8">
                        <Col span={10}>
                          <Form.Item
                            name={[field.name, "label"]}
                            rules={[{ required: true, message: "请填写验收项" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="验收项，如「首版设计稿通过评审」" />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item name={[field.name, "evidence"]} style={{ marginBottom: 0 }}>
                            <Input placeholder="证明材料，如 PRD/截图/链接" />
                          </Form.Item>
                        </Col>
                        <Col span={4}>
                          <Form.Item
                            name={[field.name, "required"]}
                            valuePropName="checked"
                            style={{ marginBottom: 0 }}
                          >
                            <Switch checkedChildren="必达" unCheckedChildren="可选" />
                          </Form.Item>
                        </Col>
                        <Col span={2}>
                          <Button
                            type="text"
                            danger
                            icon={<MinusCircleOutlined />}
                            onClick={() => remove(field.name)}
                          />
                        </Col>
                      </Row>
                    ))}
                    <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ required: true })}>
                      添加验收项
                    </Button>
                  </>
                )}
              </Form.List>
            </Col>
            <Col span={24}>
              <div className="text-13 muted mb-8">质量档位（用于评估完成质量）</div>
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item name="rubricPass" label="合格">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="rubricGood" label="良好">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="rubricExcellent" label="优秀">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </Col>
              </Row>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        open={Boolean(relation)}
        title={`添加依赖 · ${relation?.title || ""}`}
        onCancel={() => setRelation(null)}
        onOk={() => void addRelation()}
        destroyOnHidden
      >
        <Form form={relationForm} layout="vertical" initialValues={{ kind: "FS" }}>
          <Form.Item name="relatedTaskId" label="依赖任务 ID" rules={[{ required: true, message: "请填写任务 ID" }]}>
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
          <Form.Item name="kind" label="依赖类型">
            <Select
              options={[
                { value: "FS", label: "完成-开始（FS）" },
                { value: "SS", label: "开始-开始（SS）" },
                { value: "FF", label: "完成-完成（FF）" },
                { value: "SF", label: "开始-完成（SF）" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(demandTask)}
        title={`外发需求 · ${demandTask?.title || ""}`}
        onCancel={() => setDemandTask(null)}
        footer={null}
        width={880}
        destroyOnHidden
      >
        {demandLoading ? (
          <div className="py-24 text-center">
            <Spin />
          </div>
        ) : (
          <>
            {demand ? (
              <div className="mb-12">
                <Tag
                  color={
                    demand.status === "PUBLISHED"
                      ? "processing"
                      : demand.status === "CLOSED"
                        ? "default"
                        : "gold"
                  }
                >
                  {demand.statusLabel}
                </Tag>
                <span className="muted text-12">
                  共 {demand.responseCount} 条响应
                  {demand.publishedAt
                    ? ` · 发布于 ${day(demand.publishedAt)}`
                    : ""}
                </span>
              </div>
            ) : (
              <Notice variant="info">
                尚未创建外发需求，填写后保存草稿或直接发布。
              </Notice>
            )}
            <Form form={demandForm} layout="vertical">
              <Row gutter={12}>
                <Col span={24}>
                  <Form.Item
                    name="title"
                    label="需求标题"
                    rules={[{ required: true, message: "请填写需求标题" }]}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item name="scope" label="范围说明">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item name="deliverables" label="交付物">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item name="acceptance" label="验收口径（逐行一条）">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item name="budgetAmount" label="预算">
                    <InputNumber style={{ width: "100%" }} min={0} />
                  </Form.Item>
                </Col>
                <Col span={4}>
                  <Form.Item name="currency" label="币种">
                    <Select
                      options={[
                        { value: "CNY", label: "CNY" },
                        { value: "USD", label: "USD" },
                        { value: "HKD", label: "HKD" },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={7}>
                  <Form.Item name="startDate" label="开始日期">
                    <Input type="date" />
                  </Form.Item>
                </Col>
                <Col span={7}>
                  <Form.Item name="dueDate" label="截止日期">
                    <Input type="date" />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
            <Space className="mb-16">
              <Button
                onClick={() => void saveDemand(false)}
                loading={demandSaving}
              >
                保存草稿
              </Button>
              <Button
                type="primary"
                onClick={() => void saveDemand(true)}
                loading={demandSaving}
              >
                发布需求
              </Button>
              {demand && demand.status !== "CLOSED" ? (
                <Button danger onClick={() => void closeDemand()}>
                  关闭需求
                </Button>
              ) : null}
            </Space>

            <Divider titlePlacement="start">响应与报价</Divider>
            <Table<PjDemandResponse>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={demand?.responses || []}
              locale={{ emptyText: "暂无响应" }}
              columns={[
                {
                  title: "响应方",
                  dataIndex: "partyName",
                  render: (value: string, row) => (
                    <span>
                      {value || "—"}
                      {row.partyKindLabel ? (
                        <span className="muted text-12"> · {row.partyKindLabel}</span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  title: "报价",
                  dataIndex: "quoteAmount",
                  width: 120,
                  render: (value: string, row) => `${row.currency} ${value}`,
                },
                {
                  title: "工期",
                  dataIndex: "durationDays",
                  width: 80,
                  render: (value: number) => (value ? `${value} 天` : "—"),
                },
                {
                  title: "状态",
                  dataIndex: "statusLabel",
                  width: 90,
                },
                {
                  title: "操作",
                  key: "actions",
                  width: 90,
                  render: (_: unknown, row) =>
                    demand?.status === "PUBLISHED" &&
                    row.status !== "ACCEPTED" ? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => acceptResponse(row)}
                      >
                        采纳
                      </Button>
                    ) : (
                      <span className="muted">—</span>
                    ),
                },
              ]}
            />

            {demand?.status === "PUBLISHED" ? (
              <>
                <div className="text-13 muted mt-16 mb-8">
                  登记响应（选择已有合作方，或直接填写新响应方）
                </div>
                <Form form={respondForm} layout="vertical">
                  <Row gutter={12}>
                    <Col span={8}>
                      <Form.Item name="partyId" label="已有合作方">
                        <Select
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          options={parties}
                          placeholder="可选"
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="partyName" label="新响应方名称">
                        <Input placeholder="未选择合作方时填写" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="contact" label="联系方式">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="quoteAmount" label="报价">
                        <InputNumber style={{ width: "100%" }} min={0} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="durationDays" label="工期（天）">
                        <InputNumber style={{ width: "100%" }} min={0} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="note" label="说明">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>
                <Button onClick={() => void respond()} loading={demandSaving}>
                  登记响应
                </Button>
              </>
            ) : null}
          </>
        )}
      </Modal>

      <AiResultModal
        open={Boolean(splitTask)}
        title={splitTask ? `AI 任务拆分 · ${splitTask.title}` : "AI 任务拆分"}
        loading={splitLoading}
        mode={splitResult?.mode}
        model={splitResult?.model}
        onClose={() => setSplitTask(null)}
        width={720}
      >
        {splitResult ? (
          <>
            <div className="muted text-12">
              以下为建议子任务，可直接新建任务并填写对应字段。
            </div>
            {splitResult.tasks.map((task, index) => (
              <div
                key={`${index}-${task.title}`}
                style={{ borderTop: "1px dashed #eee", padding: "10px 0" }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <strong>{task.title}</strong>
                  <Tag>{`预估 ${task.estimateHours} 小时`}</Tag>
                </div>
                {task.description ? (
                  <div className="text-12">{task.description}</div>
                ) : null}
                {task.acceptance.length ? (
                  <div className="muted text-12">
                    验收：{task.acceptance.join("；")}
                  </div>
                ) : null}
              </div>
            ))}
          </>
        ) : null}
      </AiResultModal>

      <CollabDrawer
        open={Boolean(collab)}
        onClose={() => setCollab(null)}
        targetType="TASK"
        targetId={collab ? String(collab.id) : ""}
        title={collab?.title}
        staff={staff}
      />
    </>
  );
}
