"use client";

import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  z,
  MKT_OUTPUT_FORMATS,
  MKT_OUTPUT_FORMAT_LABELS,
  MKT_SKILL_CATEGORIES,
  MKT_SKILL_CATEGORY_LABELS,
  mktArtifactSchema,
  mktCapabilitySchema,
  mktEvalSchema,
  mktLoopSchema,
  mktRunSchema,
  mktSkillSchema,
} from "@enterprise/contracts";
import { mktApi } from "@/api/mkt";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";

type Skill = z.infer<typeof mktSkillSchema>;
type Run = z.infer<typeof mktRunSchema>;
type Artifact = z.infer<typeof mktArtifactSchema>;
type Capability = z.infer<typeof mktCapabilitySchema>;
type Loop = z.infer<typeof mktLoopSchema>;
type EvalResult = z.infer<typeof mktEvalSchema>;

const CATEGORY_OPTIONS = MKT_SKILL_CATEGORIES.map((value) => ({
  value,
  label: MKT_SKILL_CATEGORY_LABELS[value] || value,
}));
const FORMAT_OPTIONS = MKT_OUTPUT_FORMATS.map((value) => ({
  value,
  label: MKT_OUTPUT_FORMAT_LABELS[value] || value,
}));

const RUN_STATUS: Record<string, { color: string; label: string }> = {
  RUNNING: { color: "processing", label: "运行中" },
  DONE: { color: "green", label: "已完成" },
  FAILED: { color: "red", label: "失败" },
};

/** 内容审核 / 渠道发布状态（docs §8.4 营销内容生成→审核→发布）。 */
const REVIEW_STATUS: Record<string, { color: string; label: string }> = {
  NONE: { color: "default", label: "未进入审核" },
  PENDING: { color: "gold", label: "待审核" },
  APPROVED: { color: "green", label: "审核通过" },
  REJECTED: { color: "red", label: "审核驳回" },
};
const PUBLISH_STATUS: Record<string, { color: string; label: string }> = {
  NONE: { color: "default", label: "未发布" },
  PENDING: { color: "gold", label: "待发布" },
  PUBLISHED: { color: "green", label: "已发布" },
};

/** 内容资产类型：技能产出与 SEO 模块写入的 kind 统一显示中文，未知值原样兜底。 */
const ARTIFACT_KIND_LABELS: Record<string, string> = {
  COPY: "文案",
  REPORT: "报告",
  SEO_REPORT: "SEO 报告",
  SEO_PAGE: "SEO 页面",
  SEO_OUTREACH: "外链草稿",
  OUTREACH_DRAFT: "外联草稿",
};

function mktError(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

export function MktSkillsTab() {
  const [mode, setMode] = useState("skills");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loops, setLoops] = useState<Loop[]>([]);
  const [contextForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [editingSkill, setEditingSkill] = useState<Record<string, unknown> | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [runSkill, setRunSkill] = useState<Skill | null>(null);
  const [runForm] = Form.useForm();
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectForm] = Form.useForm();
  const [callCap, setCallCap] = useState<Capability | null>(null);
  const [callForm] = Form.useForm();
  const [loopOpen, setLoopOpen] = useState(false);
  const [loopForm] = Form.useForm();
  const [skillForm] = Form.useForm();
  /** 内容资产筛选：全部 / 待审核 / 待发布 / 已发布（审核发布共用一张资产表）。 */
  const [artifactFilter, setArtifactFilter] = useState("all");
  const [reviewTarget, setReviewTarget] = useState<Artifact | null>(null);
  const [reviewForm] = Form.useForm();
  const [publishTarget, setPublishTarget] = useState<Artifact | null>(null);
  const [publishForm] = Form.useForm();

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      setSkills((await mktApi.skills({ query: {} })) || []);
      setError("");
    } catch (err) {
      setError(mktError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mktApi.runs({ query: { page: 1, pageSize: 50 } });
      setRuns(data?.list || []);
    } catch (err) {
      setError(mktError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const filter =
        artifactFilter === "review"
          ? { reviewStatus: "PENDING" }
          : artifactFilter === "publish"
            ? { publishStatus: "PENDING" }
            : artifactFilter === "published"
              ? { publishStatus: "PUBLISHED" }
              : {};
      const data = await mktApi.artifacts({
        query: { page: 1, pageSize: 50, ...filter },
      });
      setArtifacts(data?.list || []);
    } catch (err) {
      setError(mktError(err));
    } finally {
      setLoading(false);
    }
  }, [artifactFilter]);

  const loadCapabilities = useCallback(async () => {
    setLoading(true);
    try {
      setCapabilities((await mktApi.capabilities()) || []);
    } catch (err) {
      setError(mktError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLoops = useCallback(async () => {
    setLoading(true);
    try {
      setLoops((await mktApi.loops()) || []);
    } catch (err) {
      setError(mktError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContext = useCallback(async () => {
    try {
      const data = await mktApi.context();
      if (data) {
        contextForm.setFieldsValue({
          brandName: data.brandName,
          industry: data.industry,
          positioning: data.positioning,
          tone: data.tone,
          audiences: data.audiences,
          keywords: data.keywords,
          competitors: data.competitors,
        });
      }
    } catch (err) {
      setError(mktError(err));
    }
  }, [contextForm]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (mode === "runs") void loadRuns();
    if (mode === "artifacts") void loadArtifacts();
    if (mode === "capabilities") void loadCapabilities();
    if (mode === "loops") void loadLoops();
    if (mode === "context") void loadContext();
  }, [mode, loadRuns, loadArtifacts, loadCapabilities, loadLoops, loadContext]);

  const saveSkill = async () => {
    try {
      const values = await skillForm.validateFields();
      let inputs: Skill["inputs"] =
        (editingSkill?.inputs as Skill["inputs"] | undefined) || [];
      if (values.inputsJson) {
        try {
          inputs = JSON.parse(String(values.inputsJson)) as Skill["inputs"];
        } catch {
          message.error("输入项 JSON 格式不正确");
          return;
        }
      }
      await mktApi.saveSkill({
        body: {
          id: editingSkill?.id ? Number(editingSkill.id) : undefined,
          key: values.key,
          name: values.name,
          category: values.category,
          description: values.description || "",
          channel: values.channel || "",
          promptTemplate: values.promptTemplate,
          inputs,
          outputFormat: values.outputFormat || "MARKDOWN",
          enabled: Boolean(values.enabled),
        },
      });
      message.success("技能已保存");
      setSkillOpen(false);
      skillForm.resetFields();
      await loadSkills();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(mktError(err));
    }
  };

  const submitRun = async () => {
    if (!runSkill) return;
    try {
      const values = await runForm.validateFields();
      const input: Record<string, string> = {};
      for (const field of runSkill.inputs) {
        const value = values[field.key];
        input[field.key] = value === undefined || value === null ? "" : String(value);
      }
      setSubmitting(true);
      const result = await mktApi.runSkill({
        body: { skillKey: runSkill.key, input, persistArtifact: true },
      });
      message.success(result?.status === "DONE" ? "运行完成" : "已创建运行任务");
      setRunSkill(null);
      runForm.resetFields();
      await Promise.all([loadRuns(), loadArtifacts(), loadSkills()]);
      setMode("runs");
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(mktError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const runEval = async (row: Run) => {
    try {
      setEvalResult(await mktApi.runEval({ body: { runId: row.id } }));
    } catch (err) {
      message.error(mktError(err));
    }
  };

  const submitReview = async (decision: "approve" | "reject") => {
    if (!reviewTarget) return;
    try {
      const values = await reviewForm.validateFields();
      await mktApi.reviewArtifact({
        body: { id: reviewTarget.id, decision, note: values.note || "" },
      });
      message.success(decision === "approve" ? "审核通过，已派发渠道发布任务" : "已驳回，内容退回草稿");
      setReviewTarget(null);
      reviewForm.resetFields();
      await loadArtifacts();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(mktError(err));
    }
  };

  const submitPublish = async () => {
    if (!publishTarget) return;
    try {
      const values = await publishForm.validateFields();
      await mktApi.publishArtifact({
        body: { id: publishTarget.id, channel: values.channel, note: values.note || "" },
      });
      message.success("发布回执已记录");
      setPublishTarget(null);
      publishForm.resetFields();
      await loadArtifacts();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(mktError(err));
    }
  };

  const connect = async () => {
    try {
      const values = await connectForm.validateFields();
      await mktApi.connectAccount({
        body: { key: values.key, accountName: values.accountName, credential: values.credential || "" },
      });
      message.success("已连接");
      setConnectOpen(false);
      connectForm.resetFields();
      await loadCapabilities();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(mktError(err));
    }
  };

  const callCapability = async () => {
    if (!callCap) return;
    try {
      const values = await callForm.validateFields();
      let payload: Record<string, unknown> = {};
      if (values.payload) {
        try {
          payload = JSON.parse(values.payload);
        } catch {
          message.error("参数 JSON 格式不正确");
          return;
        }
      }
      const result = await mktApi.callCapability({
        body: { key: callCap.key, action: values.action, payload },
      });
      message.success(result?.result || "已执行");
      setCallCap(null);
      callForm.resetFields();
      await loadCapabilities();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(mktError(err));
    }
  };

  const saveLoop = async () => {
    try {
      const values = await loopForm.validateFields();
      await mktApi.saveLoop({
        body: {
          skillKey: values.skillKey,
          name: values.name,
          cron: values.cron,
          enabled: Boolean(values.enabled),
        },
      });
      message.success("定时任务已保存");
      setLoopOpen(false);
      loopForm.resetFields();
      await loadLoops();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(mktError(err));
    }
  };

  const saveContext = async () => {
    try {
      const values = await contextForm.validateFields();
      await mktApi.saveContext({
        body: {
          brandName: values.brandName || "",
          industry: values.industry || "",
          positioning: values.positioning || "",
          tone: values.tone || "",
          audiences: values.audiences || [],
          keywords: values.keywords || [],
          competitors: values.competitors || [],
        },
      });
      message.success("品牌上下文已保存");
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(mktError(err));
    }
  };

  const skillColumns: ColumnsType<Skill> = [
    {
      title: "技能",
      dataIndex: "name",
      render: (value: string, row) => (
        <span>
          {value}
          {row.builtin ? <Tag style={{ marginLeft: 6 }}>内置</Tag> : null}
        </span>
      ),
    },
    {
      title: "分类",
      dataIndex: "category",
      width: 110,
      render: (v: string) => MKT_SKILL_CATEGORY_LABELS[v] || v,
    },
    { title: "说明", dataIndex: "description", render: (v: string) => v || "—" },
    { title: "产出格式", dataIndex: "outputFormat", width: 110, render: (v: string) => MKT_OUTPUT_FORMAT_LABELS[v] || v },
    { title: "运行次数", dataIndex: "runCount", width: 90 },
    { title: "状态", dataIndex: "enabled", width: 80, render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag> },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { setRunSkill(row); runForm.resetFields(); }}>
            运行
          </Button>
          <Button type="link" size="small" onClick={() => {
            setEditingSkill(row);
            skillForm.setFieldsValue({
              key: row.key,
              name: row.name,
              category: row.category,
              description: row.description,
              channel: row.channel,
              promptTemplate: row.promptTemplate,
              outputFormat: row.outputFormat,
              enabled: row.enabled,
              inputsJson: JSON.stringify(row.inputs, null, 2),
            });
            setSkillOpen(true);
          }}>
            编辑
          </Button>
        </>
      ),
    },
  ];

  const runColumns: ColumnsType<Run> = [
    { title: "技能", dataIndex: "skillName", width: 160 },
    { title: "状态", dataIndex: "status", width: 90, render: (v: string) => <Tag color={RUN_STATUS[v]?.color}>{RUN_STATUS[v]?.label || v}</Tag> },
    { title: "模式", dataIndex: "mode", width: 80, render: (v: string) => (v === "llm" ? "模型" : "规则") },
    { title: "产出", dataIndex: "output", render: (v: string) => (v ? `${v.slice(0, 120)}${v.length > 120 ? "…" : ""}` : "—") },
    { title: "消耗积分", dataIndex: "points", width: 90 },
    { title: "时间", dataIndex: "createdAt", width: 170 },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_: unknown, row) => (
        <Button type="link" size="small" onClick={() => void runEval(row)}>
          评估
        </Button>
      ),
    },
  ];

  const artifactColumns: ColumnsType<Artifact> = [
    { title: "标题", dataIndex: "title" },
    { title: "类型", dataIndex: "kind", width: 100, render: (v: string) => ARTIFACT_KIND_LABELS[v] || v },
    { title: "状态", dataIndex: "status", width: 90, render: (v: string) => ({ DRAFT: "草稿", READY: "可用", ARCHIVED: "归档" } as Record<string, string>)[v] || v },
    {
      title: "内容审核",
      dataIndex: "reviewStatus",
      width: 110,
      render: (v: string) => (
        <Tag color={REVIEW_STATUS[v]?.color}>{REVIEW_STATUS[v]?.label || v}</Tag>
      ),
    },
    {
      title: "渠道发布",
      dataIndex: "publishStatus",
      width: 110,
      render: (v: string) => (
        <Tag color={PUBLISH_STATUS[v]?.color}>{PUBLISH_STATUS[v]?.label || v}</Tag>
      ),
    },
    { title: "内容", dataIndex: "body", render: (v: string) => (v ? `${v.slice(0, 120)}${v.length > 120 ? "…" : ""}` : "—") },
    { title: "更新时间", dataIndex: "updatedAt", width: 170 },
    {
      title: "操作",
      key: "actions",
      width: 150,
      render: (_: unknown, row) => (
        <>
          {row.reviewStatus === "PENDING" ? (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setReviewTarget(row);
                reviewForm.resetFields();
              }}
            >
              审核
            </Button>
          ) : null}
          {row.reviewStatus === "APPROVED" && row.publishStatus === "PENDING" ? (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setPublishTarget(row);
                publishForm.setFieldsValue({ channel: row.publishChannel || "", note: "" });
              }}
            >
              回填发布
            </Button>
          ) : null}
        </>
      ),
    },
  ];

  const capabilityColumns: ColumnsType<Capability> = [
    { title: "渠道", dataIndex: "name" },
    { title: "类目", dataIndex: "category", width: 100, render: (v: string) => ({ SOCIAL: "社媒", EMAIL: "邮件", CONTENT: "内容" } as Record<string, string>)[v] || v },
    { title: "账号", dataIndex: "accountName", width: 160, render: (v: string) => v || "—" },
    { title: "状态", dataIndex: "connected", width: 90, render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "已连接" : "未连接"}</Tag> },
    { title: "连接时间", dataIndex: "connectedAt", width: 170, render: (v: string) => v || "—" },
    {
      title: "操作",
      key: "actions",
      width: 190,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => { connectForm.setFieldsValue({ key: row.key, accountName: row.accountName }); setConnectOpen(true); }}>
            {row.connected ? "重新连接" : "连接"}
          </Button>
          {row.connected ? (
            <>
              <Button type="link" size="small" onClick={() => { setCallCap(row); callForm.resetFields(); }}>
                调用
              </Button>
              <Button type="link" size="small" danger onClick={() => void mktApi.disconnectAccount({ body: { key: row.key } }).then(loadCapabilities).catch((err) => message.error(mktError(err)))}>
                断开
              </Button>
            </>
          ) : null}
        </>
      ),
    },
  ];

  const loopColumns: ColumnsType<Loop> = [
    { title: "任务名称", dataIndex: "name" },
    { title: "技能", dataIndex: "skillName", width: 160 },
    { title: "cron", dataIndex: "cron", width: 140 },
    { title: "状态", dataIndex: "enabled", width: 80, render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag> },
    { title: "上次运行", dataIndex: "lastRunAt", width: 170, render: (v: string) => v || "—" },
    { title: "下次运行", dataIndex: "nextRunAt", width: 170, render: (v: string) => v || "—" },
    {
      title: "操作",
      key: "actions",
      width: 80,
      render: (_: unknown, row) => (
        <Button type="link" size="small" danger onClick={() => void mktApi.removeLoop({ body: { id: row.id } }).then(loadLoops).catch((err) => message.error(mktError(err)))}>
          删除
        </Button>
      ),
    },
  ];

  return (
    <Panel
      title="营销技能库"
      extra={
        <div style={{ display: "flex", gap: 8 }}>
          <PillTabs
            items={[
              { key: "skills", label: "技能库" },
              { key: "runs", label: "运行记录" },
              { key: "artifacts", label: "内容资产" },
              { key: "context", label: "品牌上下文" },
              { key: "capabilities", label: "渠道连接" },
              { key: "loops", label: "定时任务" },
            ]}
            value={mode}
            onChange={setMode}
            size="small"
            variant="soft"
          />
          {mode === "skills" || mode === "loops" ? (
            <Button
              type="primary"
              onClick={() => {
                if (mode === "loops") {
                  loopForm.setFieldsValue({ enabled: true, cron: "0 9 * * *" });
                  setLoopOpen(true);
                } else {
                  setEditingSkill(null);
                  skillForm.resetFields();
                  skillForm.setFieldsValue({ category: "CONTENT", outputFormat: "MARKDOWN", enabled: true });
                  setSkillOpen(true);
                }
              }}
            >
              {mode === "loops" ? "新建定时任务" : "新建技能"}
            </Button>
          ) : null}
        </div>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}

      {mode === "skills" ? (
        <Table<Skill>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={skillColumns}
          dataSource={skills}
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: "暂无技能" }}
        />
      ) : null}

      {mode === "runs" ? (
        <Table<Run>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={runColumns}
          dataSource={runs}
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: "暂无运行记录" }}
        />
      ) : null}

      {mode === "artifacts" ? (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <PillTabs
              items={[
                { key: "all", label: "全部" },
                { key: "review", label: "待审核" },
                { key: "publish", label: "待发布" },
                { key: "published", label: "已发布" },
              ]}
              value={artifactFilter}
              onChange={setArtifactFilter}
              size="small"
              variant="soft"
            />
          </div>
          <Table<Artifact>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={artifactColumns}
            dataSource={artifacts}
            scroll={{ x: "max-content" }}
            pagination={false}
            locale={{ emptyText: "暂无内容资产" }}
          />
        </>
      ) : null}

      {mode === "context" ? (
        <Form form={contextForm} layout="vertical" style={{ maxWidth: 720 }}>
          <Form.Item name="brandName" label="品牌名称">
            <Input />
          </Form.Item>
          <Form.Item name="industry" label="行业">
            <Input />
          </Form.Item>
          <Form.Item name="positioning" label="品牌定位">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="tone" label="品牌语气">
            <Input placeholder="例如：专业、克制、有温度" />
          </Form.Item>
          <Form.Item name="audiences" label="目标人群">
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name="keywords" label="关键词">
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name="competitors" label="竞品">
            <Select mode="tags" />
          </Form.Item>
          <Button type="primary" onClick={() => void saveContext()}>
            保存上下文
          </Button>
        </Form>
      ) : null}

      {mode === "capabilities" ? (
        <Table<Capability>
          rowKey="key"
          size="middle"
          loading={loading}
          columns={capabilityColumns}
          dataSource={capabilities}
          pagination={false}
          locale={{ emptyText: "暂无渠道" }}
        />
      ) : null}

      {mode === "loops" ? (
        <Table<Loop>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={loopColumns}
          dataSource={loops}
          pagination={false}
          locale={{ emptyText: "暂无定时任务" }}
        />
      ) : null}

      <Modal
        open={skillOpen}
        title={editingSkill?.id ? "编辑技能" : "新建技能"}
        onCancel={() => setSkillOpen(false)}
        onOk={() => void saveSkill()}
        width={720}
        destroyOnHidden
      >
        <Form form={skillForm} layout="vertical">
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item name="key" label="技能标识" rules={[{ required: true, message: "请填写技能标识" }]} style={{ flex: 1 }}>
              <Input placeholder="小写字母与短横线，如 brand-story" disabled={Boolean(editingSkill?.id)} />
            </Form.Item>
            <Form.Item name="name" label="技能名称" rules={[{ required: true, message: "请填写技能名称" }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item name="category" label="分类" style={{ flex: 1 }}>
              <Select options={CATEGORY_OPTIONS} />
            </Form.Item>
            <Form.Item name="outputFormat" label="产出格式" style={{ flex: 1 }}>
              <Select options={FORMAT_OPTIONS} />
            </Form.Item>
            <Form.Item name="channel" label="渠道" style={{ flex: 1 }}>
              <Input placeholder="如 小红书 / 邮件" />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item name="description" label="技能说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="promptTemplate" label="提示词模板" rules={[{ required: true, message: "请填写提示词模板" }]}>
            <Input.TextArea rows={5} placeholder="使用 {{字段}} 插入运行时输入" />
          </Form.Item>
          <Form.Item name="inputsJson" label="输入项（JSON 数组）">
            <Input.TextArea rows={4} placeholder='[{"key":"topic","label":"主题","type":"TEXT","required":true,"placeholder":"","options":[]}]' />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(runSkill)}
        title={`运行技能 · ${runSkill?.name || ""}`}
        onCancel={() => setRunSkill(null)}
        onOk={() => void submitRun()}
        confirmLoading={submitting}
        width={640}
        destroyOnHidden
      >
        <Form form={runForm} layout="vertical">
          {(runSkill?.inputs || []).map((field) => (
            <Form.Item
              key={field.key}
              name={field.key}
              label={field.label}
              rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}
            >
              {field.type === "TEXTAREA" ? (
                <Input.TextArea rows={3} placeholder={field.placeholder} />
              ) : field.type === "SELECT" ? (
                <Select options={field.options.map((value) => ({ value, label: value }))} placeholder={field.placeholder} />
              ) : field.type === "NUMBER" ? (
                <InputNumber style={{ width: "100%" }} placeholder={field.placeholder} />
              ) : (
                <Input placeholder={field.placeholder} />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>

      <Modal
        open={Boolean(callCap)}
        title={`调用渠道 · ${callCap?.name || ""}`}
        onCancel={() => setCallCap(null)}
        onOk={() => void callCapability()}
        destroyOnHidden
      >
        <Form form={callForm} layout="vertical">
          <Form.Item name="action" label="动作" rules={[{ required: true, message: "请填写动作" }]}>
            <Input placeholder="如 publish / test / sync" />
          </Form.Item>
          <Form.Item name="payload" label="参数（JSON）">
            <Input.TextArea rows={4} placeholder='{"title":"...","content":"..."}' />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={connectOpen}
        title="连接渠道"
        onCancel={() => setConnectOpen(false)}
        onOk={() => void connect()}
        destroyOnHidden
      >
        <Form form={connectForm} layout="vertical">
          <Form.Item name="key" label="渠道" rules={[{ required: true, message: "请选择渠道" }]}>
            <Select options={capabilities.map((row) => ({ value: row.key, label: row.name }))} />
          </Form.Item>
          <Form.Item name="accountName" label="账号名称" rules={[{ required: true, message: "请填写账号名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="credential" label="凭据">
            <Input.Password placeholder="Webhook 地址 / 访问令牌，加密保存" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={loopOpen}
        title="新建定时任务"
        onCancel={() => setLoopOpen(false)}
        onOk={() => void saveLoop()}
        destroyOnHidden
      >
        <Form form={loopForm} layout="vertical">
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: "请填写任务名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="skillKey" label="技能" rules={[{ required: true, message: "请选择技能" }]}>
            <Select options={skills.map((row) => ({ value: row.key, label: row.name }))} />
          </Form.Item>
          <Form.Item name="cron" label="cron 表达式" rules={[{ required: true, message: "请填写 cron" }]}>
            <Input placeholder="0 9 * * *" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(reviewTarget)}
        title={`内容审核 · ${reviewTarget?.title || ""}`}
        onCancel={() => setReviewTarget(null)}
        footer={[
          <Button key="cancel" onClick={() => setReviewTarget(null)}>
            取消
          </Button>,
          <Button key="reject" danger onClick={() => void submitReview("reject")}>
            驳回
          </Button>,
          <Button key="approve" type="primary" onClick={() => void submitReview("approve")}>
            审核通过
          </Button>,
        ]}
        destroyOnHidden
      >
        <p className="muted text-12" style={{ marginTop: 0 }}>
          通过后会自动派发「渠道发布」待办；驳回则退回草稿继续修改。
        </p>
        <Form form={reviewForm} layout="vertical">
          <Form.Item name="note" label="审核意见">
            <Input.TextArea rows={3} placeholder="驳回时请写明修改原因" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(publishTarget)}
        title={`回填发布 · ${publishTarget?.title || ""}`}
        onCancel={() => setPublishTarget(null)}
        onOk={() => void submitPublish()}
        destroyOnHidden
      >
        <Form form={publishForm} layout="vertical">
          <Form.Item
            name="channel"
            label="发布渠道"
            rules={[{ required: true, message: "请填写发布渠道" }]}
          >
            <Input placeholder="如 公众号 / 小红书 / 官网" />
          </Form.Item>
          <Form.Item name="note" label="执行回执">
            <Input.TextArea rows={3} placeholder="如 链接、发布账号、发布时间" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(evalResult)}
        title="运行质量评估"
        onCancel={() => setEvalResult(null)}
        footer={null}
        destroyOnHidden
      >
        {evalResult ? (
          <>
            <p>
              <Tag color={evalResult.score >= 80 ? "green" : evalResult.score >= 60 ? "gold" : "red"}>
                总分 {evalResult.score}
              </Tag>
              <span className="muted text-12">模式：{evalResult.mode === "llm" ? "模型 + 规则" : "规则"}</span>
            </p>
            {evalResult.dimensions.map((item) => (
              <div key={item.name} style={{ padding: "6px 0", borderTop: "1px dashed var(--border, #eee)" }}>
                <strong>{item.name}</strong> {item.score} · <span className="muted">{item.note}</span>
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <strong>改进建议：</strong>
              {evalResult.suggestions.join("；") || "暂无"}
            </div>
          </>
        ) : null}
      </Modal>
    </Panel>
  );
}
