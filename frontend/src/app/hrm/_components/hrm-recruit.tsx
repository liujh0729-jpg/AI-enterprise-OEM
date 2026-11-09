"use client";

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  hrmApi,
  type HrmApplication,
  type HrmCandidate,
  type HrmEvaluation,
  type HrmHiringRequest,
  type HrmJob,
} from "@/api/hrm";
import { Panel } from "@/components/ui/panel";
import {
  APP_STATUS_LABELS,
  JOB_STATUS_LABELS,
  STATUS_COLORS,
  TIER_OPTIONS,
  formatMoney,
  hrmError,
  shortDate,
} from "./hrm-common";

const PAGE_SIZE = 10;

type RequestPage = { list: HrmHiringRequest[]; total: number; page: number; pageSize: number };
type JobPage = { list: HrmJob[]; total: number; page: number; pageSize: number };
type CandidatePage = { list: HrmCandidate[]; total: number; page: number; pageSize: number };
type ApplicationPage = { list: HrmApplication[]; total: number; page: number; pageSize: number };

/** 招聘漏斗：用人申请 → 职位（JD）→ 候选人 → 投递 → AI 评估。 */
export function HrmRecruitTab({ reloadKey }: { reloadKey: number }) {
  const { message } = App.useApp();
  const [requests, setRequests] = useState<RequestPage | null>(null);
  const [jobs, setJobs] = useState<JobPage | null>(null);
  const [candidates, setCandidates] = useState<CandidatePage | null>(null);
  const [applications, setApplications] = useState<ApplicationPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [jdOpen, setJdOpen] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState<HrmEvaluation | null>(null);
  const [editingJob, setEditingJob] = useState<HrmJob | null>(null);
  const [requestForm] = Form.useForm();
  const [jobForm] = Form.useForm();
  const [jdForm] = Form.useForm();
  const [candidateForm] = Form.useForm();
  const [applicationForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requestRows, jobRows, candidateRows, applicationRows] = await Promise.all([
        hrmApi.listHiringRequests({ query: { page: 1, pageSize: PAGE_SIZE } }),
        hrmApi.listJobs({ query: { page: 1, pageSize: PAGE_SIZE } }),
        hrmApi.listCandidates({ query: { page: 1, pageSize: PAGE_SIZE } }),
        hrmApi.listApplications({ query: { page: 1, pageSize: PAGE_SIZE } }),
      ]);
      setRequests(requestRows);
      setJobs(jobRows);
      setCandidates(candidateRows);
      setApplications(applicationRows);
      setError("");
    } catch (err) {
      setError(hrmError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      message.success(success);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitRequest = async () => {
    const values = await requestForm.validateFields();
    await run(
      () =>
        hrmApi.createHiringRequest({
          body: {
            department: values.department || "",
            position: values.position,
            headCount: Number(values.headCount) || 1,
            expectedTier: values.expectedTier,
            budgetMonthly: Number(values.budgetMonthly) || 0,
            reason: values.reason || "",
          },
        }),
      "用人申请已提交",
    );
    setRequestOpen(false);
  };

  const openJob = (row?: HrmJob) => {
    setEditingJob(row || null);
    jobForm.resetFields();
    if (row) {
      jobForm.setFieldsValue({
        title: row.title,
        department: row.department,
        headCount: row.headCount,
        tier: row.tier || undefined,
        jd: row.jd,
        minScore: Number(row.minScore) || undefined,
      });
    }
    setJobOpen(true);
  };

  const submitJob = async () => {
    const values = await jobForm.validateFields();
    setBusy(true);
    try {
      if (editingJob) {
        await hrmApi.updateJob({
          body: {
            id: editingJob.id,
            title: values.title,
            department: values.department || "",
            headCount: Number(values.headCount) || 1,
            tier: values.tier,
            jd: values.jd || "",
            minScore: values.minScore ? Number(values.minScore) : undefined,
          },
        });
        message.success("职位已更新");
      } else {
        await hrmApi.createJob({
          body: {
            title: values.title,
            department: values.department || "",
            headCount: Number(values.headCount) || 1,
            tier: values.tier,
            jd: values.jd || "",
            minScore: values.minScore ? Number(values.minScore) : undefined,
            hiringRequestId: 0,
          },
        });
        message.success("职位已创建");
      }
      setJobOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitJd = async () => {
    const values = await jdForm.validateFields();
    setBusy(true);
    try {
      const result = await hrmApi.generateJd({
        body: {
          title: values.title,
          tier: values.tier,
          points: String(values.points || "")
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        },
      });
      jobForm.setFieldsValue({
        title: values.title,
        tier: values.tier,
        jd: result?.jd || "",
      });
      setJdOpen(false);
      setJobOpen(true);
      message.success(result?.mode === "llm" ? "JD 已由模型生成，请确认后保存" : "已生成规则式 JD 草稿，请确认后保存");
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCandidate = async () => {
    const values = await candidateForm.validateFields();
    await run(
      () =>
        hrmApi.upsertCandidate({
          body: {
            id: values.id ? Number(values.id) : undefined,
            name: values.name,
            phone: values.phone || "",
            email: values.email || "",
            source: values.source || "UPLOAD",
            resumeText: values.resumeText || "",
            items: [],
            skills: String(values.skills || "")
              .split(/[、,，\s]+/)
              .map((item: string) => item.trim())
              .filter(Boolean),
            tier: values.tier,
            note: values.note || "",
          },
        }),
      values.id ? "候选人已更新" : "候选人已入库",
    );
    setCandidateOpen(false);
  };

  const submitApplication = async () => {
    const values = await applicationForm.validateFields();
    await run(
      () =>
        hrmApi.createApplication({
          body: {
            jobId: Number(values.jobId),
            candidateId: Number(values.candidateId),
            channel: "LOCAL",
          },
        }),
      "投递已创建",
    );
    setApplicationOpen(false);
  };

  const evaluate = async (row: HrmApplication) => {
    try {
      const result = await hrmApi.evaluateApplication({ body: { id: row.id } });
      setEvalOpen(result);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error ? <div style={{ color: "#cf1322" }}>{error}</div> : null}

      <Panel
        title="用人申请"
        titleExtra={<span className="muted text-12">部门提出 HC 需求，批准后可据此建职位</span>}
        extra={<Button type="primary" onClick={() => {
          requestForm.resetFields();
          setRequestOpen(true);
        }}>发起用人申请</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={requests?.list || []}
          locale={{ emptyText: "还没有用人申请" }}
          pagination={false}
          columns={[
            { title: "部门", dataIndex: "department", width: 120, render: (v: string) => v || "—" },
            { title: "岗位", dataIndex: "position" },
            { title: "HC", dataIndex: "headCount", width: 70 },
            { title: "期望职级", dataIndex: "expectedTier", width: 100, render: (v: string) => v || "—" },
            { title: "月预算", dataIndex: "budgetMonthly", width: 120, render: (v: string) => formatMoney(v) },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: string) => (
                <Tag color={({ PENDING: "gold", APPROVED: "green", REJECTED: "red" } as Record<string, string>)[v]}>
                  {({ PENDING: "待审批", APPROVED: "已批准", REJECTED: "已驳回" } as Record<string, string>)[v] || v}
                </Tag>
              ),
            },
            {
              title: "操作",
              width: 170,
              render: (_: unknown, row: HrmHiringRequest) =>
                row.status === "PENDING" ? (
                  <Space size={4}>
                    <Button type="link" size="small" onClick={() => void run(() => hrmApi.decideHiringRequest({ body: { id: row.id, decision: "approve", note: "" } }), "已批准")}>
                      批准
                    </Button>
                    <Button type="link" size="small" danger onClick={() => void run(() => hrmApi.decideHiringRequest({ body: { id: row.id, decision: "reject", note: "" } }), "已驳回")}>
                      驳回
                    </Button>
                  </Space>
                ) : (
                  <span className="muted text-12">{row.jobId ? `职位 #${row.jobId}` : "—"}</span>
                ),
            },
          ]}
        />
      </Panel>

      <Panel
        title="招聘职位"
        titleExtra={<span className="muted text-12">JD 单一数据源；发布后同步到招聘专区渠道</span>}
        extra={
          <Space>
            <Button onClick={() => {
              jdForm.resetFields();
              setJdOpen(true);
            }}>AI 生成 JD</Button>
            <Button type="primary" onClick={() => openJob()}>新建职位</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={jobs?.list || []}
          locale={{ emptyText: "还没有招聘职位" }}
          pagination={false}
          columns={[
            { title: "职位", dataIndex: "title" },
            { title: "部门", dataIndex: "department", width: 110, render: (v: string) => v || "—" },
            { title: "HC", dataIndex: "headCount", width: 70 },
            { title: "职级", dataIndex: "tier", width: 90, render: (v: string) => v || "—" },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: string) => <Tag color={STATUS_COLORS[v]}>{JOB_STATUS_LABELS[v] || v}</Tag>,
            },
            { title: "门槛分", dataIndex: "minScore", width: 90, render: (v: string) => (Number(v) > 0 ? v : "—") },
            {
              title: "操作",
              width: 240,
              render: (_: unknown, row: HrmJob) => (
                <Space size={4}>
                  <Button type="link" size="small" onClick={() => openJob(row)}>编辑</Button>
                  {row.status === "OPEN" ? (
                    <Button type="link" size="small" onClick={() => void run(() => hrmApi.updateJob({ body: { id: row.id, status: "CLOSED" } }), "职位已关闭")}>
                      关闭
                    </Button>
                  ) : (
                    <Button type="link" size="small" onClick={() => void run(() => hrmApi.updateJob({ body: { id: row.id, status: "OPEN" } }), "职位已开放")}>
                      开放
                    </Button>
                  )}
                  <Button
                    type="link"
                    size="small"
                    disabled={Boolean(row.hiringPostId)}
                    onClick={() => void run(() => hrmApi.publishJob({ body: { id: row.id } }), "已发布到招聘专区")}
                  >
                    {row.hiringPostId ? `已发布 #${row.hiringPostId}` : "发布"}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Panel
        title="候选人库"
        extra={<Button onClick={() => {
          candidateForm.resetFields();
          setCandidateOpen(true);
        }}>录入候选人</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={candidates?.list || []}
          locale={{ emptyText: "还没有候选人" }}
          pagination={false}
          columns={[
            { title: "姓名", dataIndex: "name", width: 120 },
            { title: "联系方式", width: 190, render: (_: unknown, row: HrmCandidate) => row.phone || row.email || "—" },
            { title: "来源", dataIndex: "source", width: 110 },
            {
              title: "技能",
              dataIndex: "skills",
              render: (value: string[]) =>
                value.length ? (
                  <Space size={4} wrap>
                    {value.slice(0, 5).map((item) => <Tag key={item}>{item}</Tag>)}
                  </Space>
                ) : "—",
            },
            { title: "职级", dataIndex: "tier", width: 90, render: (v: string) => v || "—" },
            { title: "入库", dataIndex: "createdAt", width: 110, render: (v: string) => shortDate(v) },
            {
              title: "操作",
              width: 90,
              render: (_: unknown, row: HrmCandidate) => (
                <Button type="link" size="small" onClick={() => {
                  candidateForm.setFieldsValue({
                    id: row.id,
                    name: row.name,
                    phone: row.phone,
                    email: row.email,
                    source: row.source,
                    skills: row.skills.join("、"),
                    tier: row.tier || undefined,
                    note: row.note,
                    resumeText: "",
                  });
                  setCandidateOpen(true);
                }}>编辑</Button>
              ),
            },
          ]}
        />
      </Panel>

      <Panel
        title="投递与评估"
        titleExtra={<span className="muted text-12">评估结果仅作参考分，分档与证据矩阵由服务端代码校验</span>}
        extra={<Button type="primary" onClick={() => {
          applicationForm.resetFields();
          setApplicationOpen(true);
        }}>新建投递</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={applications?.list || []}
          locale={{ emptyText: "还没有投递" }}
          pagination={false}
          columns={[
            { title: "职位", dataIndex: "jobId", width: 90, render: (v: number) => `#${v}` },
            { title: "候选人", dataIndex: "candidateId", width: 100, render: (v: number) => `#${v}` },
            { title: "渠道", dataIndex: "channel", width: 100 },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (v: string) => <Tag color={STATUS_COLORS[v]}>{APP_STATUS_LABELS[v] || v}</Tag>,
            },
            { title: "匹配分", dataIndex: "matchScore", width: 100, render: (v: string) => (Number(v) > 0 ? v : "—") },
            { title: "匹配档", dataIndex: "matchTier", width: 100, render: (v: string) => v || "—" },
            {
              title: "操作",
              width: 280,
              render: (_: unknown, row: HrmApplication) => (
                <Space size={4}>
                  <Button type="link" size="small" onClick={() => void evaluate(row)}>AI 评估</Button>
                  <Button type="link" size="small" onClick={() => void run(() => hrmApi.decideApplication({ body: { id: row.id, decision: "advance", note: "" } }), "已推进")}>
                    推进
                  </Button>
                  <Button type="link" size="small" danger onClick={() => void run(() => hrmApi.decideApplication({ body: { id: row.id, decision: "reject", note: "" } }), "已淘汰")}>
                    淘汰
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Modal title="发起用人申请" open={requestOpen} onCancel={() => setRequestOpen(false)} onOk={() => void submitRequest()} confirmLoading={busy} destroyOnHidden>
        <Form form={requestForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="部门" name="department">
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item label="岗位" name="position" rules={[{ required: true, message: "请填写岗位" }]}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item label="招聘人数" name="headCount" initialValue={1}>
              <InputNumber min={1} max={500} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="期望职级" name="expectedTier">
              <Select allowClear options={TIER_OPTIONS} />
            </Form.Item>
            <Form.Item label="月预算（元）" name="budgetMonthly" initialValue={0}>
              <InputNumber min={0} max={10000000} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item label="申请理由" name="reason">
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={editingJob ? "编辑职位" : "新建职位"} open={jobOpen} onCancel={() => setJobOpen(false)} onOk={() => void submitJob()} confirmLoading={busy} destroyOnHidden>
        <Form form={jobForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="职位名称" name="title" rules={[{ required: true, message: "请填写职位名称" }]}>
            <Input maxLength={120} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="部门" name="department">
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item label="招聘人数" name="headCount" initialValue={1}>
              <InputNumber min={1} max={500} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="职级" name="tier">
              <Select allowClear options={TIER_OPTIONS} />
            </Form.Item>
            <Form.Item label="匹配门槛分（1~5）" name="minScore">
              <InputNumber min={1} max={5} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item label="JD 正文" name="jd">
            <Input.TextArea rows={10} maxLength={20000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="AI 生成 JD" open={jdOpen} onCancel={() => setJdOpen(false)} onOk={() => void submitJd()} confirmLoading={busy} destroyOnHidden>
        <Form form={jdForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="职位名称" name="title" rules={[{ required: true, message: "请填写职位名称" }]}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item label="职级" name="tier">
              <Select allowClear options={TIER_OPTIONS} />
            </Form.Item>
          </div>
          <Form.Item label="职责要点（每行一条）" name="points" rules={[{ required: true, message: "请至少填写一条职责" }]}>
            <Input.TextArea rows={6} placeholder={"负责核心模块研发\n推动性能优化\n参与技术方案评审"} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="录入候选人" open={candidateOpen} onCancel={() => setCandidateOpen(false)} onOk={() => void submitCandidate()} confirmLoading={busy} destroyOnHidden>
        <Form form={candidateForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: "请填写姓名" }]}>
            <Input maxLength={64} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="电话" name="phone"><Input maxLength={32} /></Form.Item>
            <Form.Item label="邮箱" name="email"><Input maxLength={120} /></Form.Item>
            <Form.Item label="来源" name="source" initialValue="UPLOAD">
              <Select options={[
                { value: "UPLOAD", label: "手工录入" },
                { value: "HIRING_POST", label: "招聘专区" },
                { value: "REFERRAL", label: "内推" },
              ]} />
            </Form.Item>
            <Form.Item label="职级" name="tier">
              <Select allowClear options={TIER_OPTIONS} />
            </Form.Item>
          </div>
          <Form.Item label="技能标签" name="skills">
            <Input placeholder="用「、」或逗号分隔" />
          </Form.Item>
          <Form.Item label="简历文本" name="resumeText">
            <Input.TextArea rows={6} maxLength={100000} placeholder="可选；粘贴简历正文后评估会用结构化事实" />
          </Form.Item>
          <Form.Item label="备注" name="note"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="新建投递" open={applicationOpen} onCancel={() => setApplicationOpen(false)} onOk={() => void submitApplication()} confirmLoading={busy} destroyOnHidden>
        <Form form={applicationForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="职位" name="jobId" rules={[{ required: true, message: "请选择职位" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(jobs?.list || []).map((row) => ({ value: row.id, label: `${row.title}（#${row.id}）` }))}
            />
          </Form.Item>
          <Form.Item label="候选人" name="candidateId" rules={[{ required: true, message: "请选择候选人" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(candidates?.list || []).map((row) => ({ value: row.id, label: `${row.name}（#${row.id}）` }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="AI 匹配评估" open={Boolean(evalOpen)} onCancel={() => setEvalOpen(null)} footer={<Button onClick={() => setEvalOpen(null)}>关闭</Button>} width={720}>
        {evalOpen?.evalResult ? (
          <div>
            <Space size={12} style={{ marginBottom: 12 }}>
              <Tag color="blue">匹配分 {evalOpen.evalResult.score}</Tag>
              <Tag color={({ excellent: "green", strong: "blue", medium: "gold", gap: "red" } as Record<string, string>)[evalOpen.evalResult.tier]}>
                {({ excellent: "优秀", strong: "较强", medium: "一般", gap: "不匹配" } as Record<string, string>)[evalOpen.evalResult.tier]}
              </Tag>
              <Tag>{evalOpen.evalResult.mode === "llm" ? "模型评估" : "规则式评估"}</Tag>
              <Tag>rubric v{evalOpen.evalResult.rubricVersion}</Tag>
            </Space>
            <Typography.Paragraph>{evalOpen.evalResult.recommendation}</Typography.Paragraph>
            <Table
              rowKey={(row) => row.key}
              size="small"
              pagination={false}
              dataSource={evalOpen.evalResult.dimensions}
              columns={[
                { title: "维度", dataIndex: "label", width: 140 },
                { title: "得分", dataIndex: "score", width: 90 },
              ]}
            />
            <div className="muted text-12" style={{ margin: "12px 0 4px" }}>需求-证据矩阵</div>
            <Table
              rowKey={(row) => row.requirement}
              size="small"
              pagination={false}
              dataSource={evalOpen.evalResult.requirementsMatrix}
              columns={[
                { title: "要求", dataIndex: "requirement" },
                {
                  title: "重要性",
                  dataIndex: "importance",
                  width: 100,
                  render: (v: string) => ({ HIGH: "高", MEDIUM: "中", NICE: "加分" } as Record<string, string>)[v] || v,
                },
                {
                  title: "匹配",
                  dataIndex: "match",
                  width: 100,
                  render: (v: string) => ({ STRONG: "强", PARTIAL: "部分", MISSING: "缺失" } as Record<string, string>)[v] || v,
                },
                {
                  title: "证据",
                  dataIndex: "evidence",
                  render: (rows: { quote: string }[]) => rows.map((item) => item.quote).join("；") || "—",
                },
              ]}
            />
          </div>
        ) : (
          <div className="muted">本次评估没有返回结构化结果。</div>
        )}
      </Modal>
    </div>
  );
}
