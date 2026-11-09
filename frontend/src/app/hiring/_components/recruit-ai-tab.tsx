"use client";

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  RECRUIT_APPLICATION_STATUSES,
  RECRUIT_APPLICATION_STATUS_LABELS,
  RECRUIT_STATUS_FLOW,
} from "@enterprise/contracts";
import { recruitApi } from "@/api/recruit";
import {
  EmptyState,
  Panel,
  PillTabs,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { fmtDate } from "@/lib/datetime";

type RecruitProfile = NonNullable<
  Awaited<ReturnType<typeof recruitApi.profile>>
>;
type RecruitJob = NonNullable<
  Awaited<ReturnType<typeof recruitApi.jobs>>
>["list"][number];
type RecruitMatch = NonNullable<
  Awaited<ReturnType<typeof recruitApi.matchJobs>>
>[number];
type RecruitEvaluation = NonNullable<
  Awaited<ReturnType<typeof recruitApi.evaluatePost>>
>;
type RecruitOptimize = NonNullable<
  Awaited<ReturnType<typeof recruitApi.optimizeResume>>
>;
type RecruitApplication = NonNullable<
  Awaited<ReturnType<typeof recruitApi.applications>>
>["list"][number];
type RecruitFunnel = NonNullable<
  Awaited<ReturnType<typeof recruitApi.funnel>>
>;
type RecruitInsight = NonNullable<
  Awaited<ReturnType<typeof recruitApi.insights>>
>;
type Experience = RecruitProfile["experiences"][number];
type Education = RecruitProfile["educations"][number];
type RecruitStatus = (typeof RECRUIT_APPLICATION_STATUSES)[number];

const SUB_TABS = [
  { key: "profile", label: "求职画像" },
  { key: "match", label: "岗位匹配" },
  { key: "applications", label: "投递跟踪" },
  { key: "insight", label: "数据洞察" },
];

function statusTag(status: string) {
  const color =
    status === "OFFER"
      ? "green"
      : status === "INTERVIEW"
        ? "blue"
        : status === "SCREENING"
          ? "processing"
          : status === "REJECTED" || status === "WITHDRAWN"
            ? "default"
            : status === "DRAFT"
              ? "gold"
              : "cyan";
  return (
    <Tag color={color}>
      {RECRUIT_APPLICATION_STATUS_LABELS[status] || status}
    </Tag>
  );
}

function modeTag(mode: string) {
  return <Tag color={mode === "llm" ? "blue" : "default"}>{mode === "llm" ? "大模型" : "规则"}</Tag>;
}

const EMPTY_EXPERIENCE: Experience = {
  company: "",
  title: "",
  start: "",
  end: "",
  summary: "",
};
const EMPTY_EDUCATION: Education = {
  school: "",
  degree: "",
  major: "",
  start: "",
  end: "",
};

/**
 * AI 简历代投（求职者视角）：画像与简历、岗位匹配、投递跟踪、漏斗洞察。
 * 投递先落为「待确认」，必须由本人在界面上确认后才真正发出。
 */
export function RecruitAiTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [sub, setSub] = useState("profile");
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [educations, setEducations] = useState<Education[]>([]);
  const [saving, setSaving] = useState(false);

  const [jobs, setJobs] = useState<RecruitJob[]>([]);
  const [matches, setMatches] = useState<RecruitMatch[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [evaluation, setEvaluation] = useState<RecruitEvaluation | null>(null);
  const [optimize, setOptimize] = useState<RecruitOptimize | null>(null);
  const [jobBusy, setJobBusy] = useState(0);

  const [applications, setApplications] = useState<RecruitApplication[]>([]);
  const [appForm] = Form.useForm();
  const [applyJob, setApplyJob] = useState<RecruitJob | null>(null);
  const [timeline, setTimeline] = useState<RecruitApplication | null>(null);

  const [funnel, setFunnel] = useState<RecruitFunnel | null>(null);
  const [insight, setInsight] = useState<RecruitInsight | null>(null);

  const [expOpen, setExpOpen] = useState(false);
  const [expIndex, setExpIndex] = useState(-1);
  const [eduOpen, setEduOpen] = useState(false);
  const [eduIndex, setEduIndex] = useState(-1);
  const [expForm] = Form.useForm();
  const [eduForm] = Form.useForm();

  const loadProfile = useCallback(async () => {
    const data = await recruitApi.profile();
    setExperiences(data?.experiences || []);
    setEducations(data?.educations || []);
    form.setFieldsValue({
      fullName: data?.fullName || "",
      headline: data?.headline || "",
      years: data?.years || 0,
      city: data?.city || "",
      expectedSalary: data?.expectedSalary || "",
      objectiveRole: data?.objectiveRole || "",
      skills: data?.skills || [],
      summary: data?.summary || "",
    });
  }, [form]);

  const loadApplications = useCallback(async () => {
    const data = await recruitApi.applications({ query: { page: 1, pageSize: 50 } });
    setApplications(data?.list || []);
  }, []);

  const loadInsight = useCallback(async () => {
    const [funnelData, insightData] = await Promise.all([
      recruitApi.funnel(),
      recruitApi.insights(),
    ]);
    setFunnel(funnelData);
    setInsight(insightData);
  }, []);

  useEffect(() => {
    void loadProfile().catch((err: Error) => message.error(err.message || "加载求职画像失败"));
    void loadApplications().catch(() => setApplications([]));
    void loadInsight().catch(() => undefined);
    void recruitApi
      .jobs({ query: { page: 1, pageSize: 30 } })
      .then((data) => setJobs(data?.list || []))
      .catch(() => setJobs([]));
  }, [loadProfile, loadApplications, loadInsight, message]);

  const saveProfile = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await recruitApi.saveProfile({
        body: {
          ...values,
          experiences,
          educations,
        },
      });
      message.success("求职画像已保存");
    } catch (err) {
      if (err instanceof Error) message.error(err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const openExperience = (index: number) => {
    setExpIndex(index);
    expForm.setFieldsValue(index >= 0 ? experiences[index] : EMPTY_EXPERIENCE);
    setExpOpen(true);
  };

  const submitExperience = async () => {
    const values = await expForm.validateFields();
    const next = [...experiences];
    if (expIndex >= 0) next[expIndex] = values;
    else next.push(values);
    setExperiences(next);
    setExpOpen(false);
  };

  const openEducation = (index: number) => {
    setEduIndex(index);
    eduForm.setFieldsValue(index >= 0 ? educations[index] : EMPTY_EDUCATION);
    setEduOpen(true);
  };

  const submitEducation = async () => {
    const values = await eduForm.validateFields();
    const next = [...educations];
    if (eduIndex >= 0) next[eduIndex] = values;
    else next.push(values);
    setEducations(next);
    setEduOpen(false);
  };

  const runMatch = async () => {
    setMatching(true);
    try {
      const data = await recruitApi.matchJobs({ body: { limit: 20 } });
      setMatches(data || []);
      if (!data?.length) message.info("暂无可匹配的岗位，先去招聘广场看看");
    } catch (err) {
      if (err instanceof Error) message.error(err.message || "匹配失败");
    } finally {
      setMatching(false);
    }
  };

  const evaluateJob = async (job: RecruitJob) => {
    setJobBusy(job.id);
    try {
      const data = await recruitApi.evaluatePost({ body: { jobId: job.id } });
      setEvaluation(data);
    } catch (err) {
      if (err instanceof Error) message.error(err.message || "评估失败");
    } finally {
      setJobBusy(0);
    }
  };

  const optimizeForJob = async (job: RecruitJob) => {
    setJobBusy(job.id);
    try {
      const data = await recruitApi.optimizeResume({ body: { jobId: job.id } });
      setOptimize(data);
      await loadProfile();
    } catch (err) {
      if (err instanceof Error) message.error(err.message || "简历优化失败");
    } finally {
      setJobBusy(0);
    }
  };

  const openApply = (job: RecruitJob) => {
    setApplyJob(job);
    appForm.setFieldsValue({ note: "", channel: "AI" });
  };

  const submitApply = async () => {
    if (!applyJob) return;
    const values = await appForm.validateFields();
    try {
      await recruitApi.createApplication({
        body: { jobId: applyJob.id, note: values.note || "", channel: values.channel || "AI" },
      });
      message.success("已生成投递草稿，请在「投递跟踪」里确认后发出");
      setApplyJob(null);
      setSub("applications");
      await loadApplications();
      await loadInsight();
    } catch (err) {
      if (err instanceof Error) message.error(err.message || "创建投递失败");
    }
  };

  const confirmApplication = async (row: RecruitApplication) => {
    try {
      await recruitApi.confirmApplication({ body: { id: row.id } });
      message.success("已确认投递");
      await loadApplications();
      await loadInsight();
    } catch (err) {
      if (err instanceof Error) message.error(err.message || "确认失败");
    }
  };

  const moveApplication = async (row: RecruitApplication, status: string) => {
    try {
      await recruitApi.updateApplicationStatus({
        body: { id: row.id, status: status as RecruitStatus, note: "" },
      });
      message.success("状态已更新");
      await loadApplications();
      await loadInsight();
    } catch (err) {
      if (err instanceof Error) message.error(err.message || "更新失败");
    }
  };

  const openTimeline = async (row: RecruitApplication) => {
    try {
      const events = await recruitApi.events({ query: { applicationId: row.id } });
      setTimeline({ ...row, timeline: events || [] });
    } catch (err) {
      if (err instanceof Error) message.error(err.message || "加载进展失败");
    }
  };

  const jobColumns: ColumnsType<RecruitMatch> = [
    {
      title: "岗位",
      dataIndex: ["job", "title"],
      render: (_value, row) => (
        <div>
          <div>{row.job.title}</div>
          <div className="muted text-12">
            {row.job.company}
            {row.job.city ? ` · ${row.job.city}` : ""}
            {row.job.salary ? ` · ${row.job.salary}` : ""}
          </div>
        </div>
      ),
    },
    {
      title: "匹配度",
      dataIndex: "score",
      width: 110,
      render: (value: number) => <Tag color={value >= 70 ? "green" : value >= 40 ? "gold" : "default"}>{Math.round(value)} 分</Tag>,
    },
    {
      title: "匹配理由",
      dataIndex: "reasons",
      render: (values: string[]) => (values.length ? values.join("；") : "—"),
    },
    {
      title: "待补齐",
      dataIndex: "gaps",
      render: (values: string[]) => (values.length ? values.join("；") : "—"),
    },
    {
      title: "操作",
      width: 250,
      render: (_value, row) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="small" loading={jobBusy === row.job.id} onClick={() => void evaluateJob(row.job)}>
            评估
          </Button>
          <Button size="small" loading={jobBusy === row.job.id} onClick={() => void optimizeForJob(row.job)}>
            优化简历
          </Button>
          <Button size="small" type="primary" onClick={() => openApply(row.job)}>
            AI 代投
          </Button>
        </div>
      ),
    },
  ];

  const applyColumns: ColumnsType<RecruitApplication> = [
    {
      title: "岗位",
      dataIndex: "jobTitle",
      render: (_value, row) => (
        <div>
          <div>{row.jobTitle}</div>
          <div className="muted text-12">
            {row.company}
            {row.resumeTitle ? ` · 简历：${row.resumeTitle}` : ""}
            {row.channel ? ` · 渠道：${row.channel}` : ""}
          </div>
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: string) => statusTag(value),
    },
    {
      title: "备注",
      dataIndex: "note",
      render: (value: string) => value || "—",
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 130,
      render: (value: string) => fmtDate(value),
    },
    {
      title: "操作",
      width: 280,
      render: (_value, row) => {
        const next = RECRUIT_STATUS_FLOW[row.status] || [];
        return (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {row.status === "DRAFT" ? (
              <Button size="small" type="primary" onClick={() => void confirmApplication(row)}>
                确认投递
              </Button>
            ) : null}
            {next.length ? (
              <Select
                size="small"
                style={{ width: 120 }}
                placeholder="推进状态"
                onChange={(value: string) => void moveApplication(row, value)}
                options={next.map((status) => ({
                  value: status,
                  label: RECRUIT_APPLICATION_STATUS_LABELS[status] || status,
                }))}
              />
            ) : null}
            <Button size="small" onClick={() => void openTimeline(row)}>
              进展
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Panel
        title="AI 简历代投"
        extra={<PillTabs items={SUB_TABS} value={sub} onChange={setSub} />}
      >
        {sub === "profile" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Form form={form} layout="vertical" onFinish={() => void saveProfile()}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                <Form.Item name="fullName" label="姓名">
                  <Input placeholder="真实姓名" />
                </Form.Item>
                <Form.Item name="headline" label="一句话简介">
                  <Input placeholder="如：8 年 B 端 SaaS 增长负责人" />
                </Form.Item>
                <Form.Item name="years" label="工作年限">
                  <InputNumber min={0} max={60} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item name="city" label="所在城市">
                  <Input placeholder="如：上海" />
                </Form.Item>
                <Form.Item name="expectedSalary" label="期望薪资">
                  <Input placeholder="如：30-40K" />
                </Form.Item>
                <Form.Item name="objectiveRole" label="目标岗位">
                  <Input placeholder="如：增长负责人 / 市场总监" />
                </Form.Item>
              </div>
              <Form.Item name="skills" label="技能标签">
                <Select mode="tags" placeholder="输入后回车添加，如：内容营销、SEM、数据分析" tokenSeparators={[",", "，"]} />
              </Form.Item>
              <Form.Item name="summary" label="个人简介">
                <Input.TextArea rows={4} placeholder="经历亮点、擅长的领域与拿得出手的成果" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存画像
              </Button>
            </Form>

            <div>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <strong>工作经历</strong>
                <Button size="small" icon={<PlusOutlined aria-hidden />} style={{ marginLeft: "auto" }} onClick={() => openExperience(-1)}>
                  添加经历
                </Button>
              </div>
              {experiences.length ? (
                experiences.map((item, index) => (
                  <div key={`${item.company}-${index}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px dashed var(--border, #eee)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>
                        {item.company || "未填写公司"} · {item.title || "未填写职位"}
                      </div>
                      <div className="muted text-12">
                        {[item.start, item.end].filter(Boolean).join(" ~ ") || "时间未填"}
                        {item.summary ? ` · ${item.summary}` : ""}
                      </div>
                    </div>
                    <Button size="small" icon={<EditOutlined aria-hidden />} onClick={() => openExperience(index)} />
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined aria-hidden />}
                      onClick={() => setExperiences(experiences.filter((_row, i) => i !== index))}
                    />
                  </div>
                ))
              ) : (
                <EmptyState text="还没有工作经历，添加后匹配与投递会更有说服力" />
              )}
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <strong>教育经历</strong>
                <Button size="small" icon={<PlusOutlined aria-hidden />} style={{ marginLeft: "auto" }} onClick={() => openEducation(-1)}>
                  添加教育
                </Button>
              </div>
              {educations.length ? (
                educations.map((item, index) => (
                  <div key={`${item.school}-${index}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px dashed var(--border, #eee)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>
                        {item.school || "未填写学校"} · {item.major || "未填写专业"}
                      </div>
                      <div className="muted text-12">
                        {item.degree || "学历未填"} · {[item.start, item.end].filter(Boolean).join(" ~ ") || "时间未填"}
                      </div>
                    </div>
                    <Button size="small" icon={<EditOutlined aria-hidden />} onClick={() => openEducation(index)} />
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined aria-hidden />}
                      onClick={() => setEducations(educations.filter((_row, i) => i !== index))}
                    />
                  </div>
                ))
              ) : (
                <EmptyState text="还没有教育经历" />
              )}
            </div>
          </div>
        ) : null}

        {sub === "match" ? (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <Button type="primary" icon={<ThunderboltOutlined aria-hidden />} loading={matching} onClick={() => void runMatch()}>
                AI 匹配岗位
              </Button>
              <span className="muted text-12">按画像与目标岗位，对招聘广场的在招岗位打分并列出待补齐项</span>
            </div>
            <Table
              rowKey={(row) => String(row.job.id)}
              size="small"
              columns={jobColumns}
              dataSource={matches || []}
              pagination={false}
              locale={{ emptyText: "点「AI 匹配岗位」开始匹配" }}
            />
          </div>
        ) : null}

        {sub === "applications" ? (
          <Table
            rowKey="id"
            size="small"
            columns={applyColumns}
            dataSource={applications}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            locale={{ emptyText: "还没有投递记录，去「岗位匹配」里选一个岗位代投" }}
          />
        ) : null}

        {sub === "insight" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <StatGrid>
              <StatCard label="累计投递" value={funnel?.total ?? 0} hint="含待确认与已撤回" />
              <StatCard label="已投递" value={funnel?.submitted ?? 0} />
              <StatCard label="面试中" value={funnel?.interview ?? 0} hint={`面试率 ${funnel?.interviewRate ?? 0}%`} />
              <StatCard label="Offer" value={funnel?.offer ?? 0} hint={`Offer 率 ${funnel?.offerRate ?? 0}%`} />
              <StatCard label="未通过" value={funnel?.rejected ?? 0} />
            </StatGrid>
            <div>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <strong>投递模式洞察</strong>
                <span style={{ marginLeft: 8 }}>{insight ? modeTag(insight.mode) : null}</span>
                <span className="muted text-12" style={{ marginLeft: "auto" }}>
                  {insight ? `生成于 ${fmtDate(insight.generatedAt)}` : ""}
                </span>
              </div>
              {insight?.insights?.length ? (
                insight.insights.map((item, index) => (
                  <div key={`${item.title}-${index}`} style={{ padding: "10px 0", borderTop: "1px dashed var(--border, #eee)" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <RobotOutlined aria-hidden />
                      <strong>{item.title}</strong>
                    </div>
                    <div className="muted text-12" style={{ marginTop: 4 }}>
                      {item.detail}
                    </div>
                    <div className="text-12" style={{ marginTop: 4 }}>
                      依据：{item.evidence}
                    </div>
                    <div className="text-12" style={{ marginTop: 2 }}>
                      建议：{item.advice}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState text="投递达到一定数量后，这里会给出渠道与节奏上的洞察" />
              )}
            </div>
          </div>
        ) : null}
      </Panel>

      <Modal
        open={expOpen}
        title={expIndex >= 0 ? "编辑工作经历" : "添加工作经历"}
        onCancel={() => setExpOpen(false)}
        onOk={() => void submitExperience()}
        okText="保存"
      >
        <Form form={expForm} layout="vertical">
          <Form.Item name="company" label="公司" rules={[{ required: true, message: "请填写公司" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="title" label="职位" rules={[{ required: true, message: "请填写职位" }]}>
            <Input />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="start" label="开始时间">
              <Input placeholder="如 2020-03" />
            </Form.Item>
            <Form.Item name="end" label="结束时间">
              <Input placeholder="如 至今 / 2024-06" />
            </Form.Item>
          </div>
          <Form.Item name="summary" label="职责与成果">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={eduOpen}
        title={eduIndex >= 0 ? "编辑教育经历" : "添加教育经历"}
        onCancel={() => setEduOpen(false)}
        onOk={() => void submitEducation()}
        okText="保存"
      >
        <Form form={eduForm} layout="vertical">
          <Form.Item name="school" label="学校" rules={[{ required: true, message: "请填写学校" }]}>
            <Input />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="degree" label="学历">
              <Input placeholder="如 本科 / 硕士" />
            </Form.Item>
            <Form.Item name="major" label="专业">
              <Input />
            </Form.Item>
            <Form.Item name="start" label="开始时间">
              <Input placeholder="如 2012-09" />
            </Form.Item>
            <Form.Item name="end" label="结束时间">
              <Input placeholder="如 2016-06" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        open={Boolean(applyJob)}
        title={`AI 代投 · ${applyJob?.title || ""}`}
        onCancel={() => setApplyJob(null)}
        onOk={() => void submitApply()}
        okText="生成投递"
      >
        <Form form={appForm} layout="vertical">
          <Form.Item name="channel" label="投递渠道">
            <Select
              options={[
                { value: "AI", label: "AI 代投" },
                { value: "MANUAL", label: "本人投递" },
              ]}
            />
          </Form.Item>
          <Form.Item name="note" label="投递说明">
            <Input.TextArea rows={3} placeholder="可选：给用人方的补充说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(evaluation)}
        title={`岗位评估 · ${evaluation ? jobs.find((job) => job.id === evaluation.jobId)?.title || "" : ""}`}
        onCancel={() => setEvaluation(null)}
        footer={<Button onClick={() => setEvaluation(null)}>关闭</Button>}
      >
        {evaluation ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Tag color="blue">{Math.round(evaluation.score)} 分</Tag>
              {modeTag(evaluation.mode)}
            </div>
            <div>
              <strong>优势</strong>
              <div className="muted text-12">{evaluation.strengths.length ? evaluation.strengths.join("；") : "—"}</div>
            </div>
            <div>
              <strong>风险</strong>
              <div className="muted text-12">{evaluation.risks.length ? evaluation.risks.join("；") : "—"}</div>
            </div>
            <div>
              <strong>建议</strong>
              <div className="muted text-12">{evaluation.suggestions.length ? evaluation.suggestions.join("；") : "—"}</div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(optimize)}
        title="优化后的简历"
        width={720}
        onCancel={() => setOptimize(null)}
        footer={<Button onClick={() => setOptimize(null)}>关闭</Button>}
      >
        {optimize ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong>{optimize.title}</strong>
              {modeTag(optimize.mode)}
            </div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{optimize.body}</pre>
            {optimize.suggestions.length ? (
              <div>
                <strong>修改建议</strong>
                <div className="muted text-12">{optimize.suggestions.join("；")}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(timeline)}
        title={`投递进展 · ${timeline?.jobTitle || ""}`}
        onCancel={() => setTimeline(null)}
        footer={<Button onClick={() => setTimeline(null)}>关闭</Button>}
      >
        {timeline?.timeline?.length ? (
          timeline.timeline.map((event) => (
            <div key={event.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: "1px dashed var(--border, #eee)" }}>
              <span>{statusTag(event.status)}</span>
              <span style={{ flex: 1 }}>{event.note || "状态更新"}</span>
              <span className="muted text-12">{fmtDate(event.at)}</span>
            </div>
          ))
        ) : (
          <EmptyState text="还没有进展记录" />
        )}
      </Modal>
    </>
  );
}
