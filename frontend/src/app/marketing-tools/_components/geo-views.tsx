"use client";

import {
  BarChartOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  FundOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  RadarChartOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { App, Button, Form, Input, InputNumber, Modal, Select, Switch, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { demandPagination } from "@/components/demand-columns";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, StatCard, StatGrid } from "@/components/ui/panel";
import { useGeoAutoCollect, useGeoBatches, useGeoQuestions, useGeoObservations, useGeoTopics, useGeoReport } from "@/query/geo";
import { useGeoActions } from '@/query/geo-actions';
import {
  TOPIC_WEIGHTS,
  channelLabel,
  collectStatusLabel,
  deltaNum,
  deltaPp,
  draftTopicFromGap,
  formatWindow,
  natureLabel,
  pct,
  priorityBadge,
  score,
  tierBadge,
  type GeoBatch,
  type GeoMeta,
  type GeoObservation,
  type GeoQuestion,
  type GeoTopic,
  type GeoTopicDraft,
} from "./geo-common";

/* ------------------------------- 效果报告 ------------------------------- */

export function GeoReportView({
  projectId,
  onNavigate,
  onCreateTopic,
}: {
  projectId: number;
  onNavigate?: (view: string) => void;
  onCreateTopic?: (draft: GeoTopicDraft) => void;
}) {
  const { message } = App.useApp();
  const [batchId, setBatchId] = useState(0);

  useEffect(() => {
    setBatchId(0);
  }, [projectId]);

  const query = useGeoReport(projectId, batchId);
  const report = query.data ?? null;
  const loading = query.isPending;



  if (query.isError) return <Notice variant="warn">{query.error.message} <Button onClick={() => {void query.refetch();}}>重试</Button></Notice>;
  if (loading) return <EmptyState icon={<LoadingOutlined aria-hidden />} text="正在生成 GEO 效果报告…" />;
  if (!report?.current) {
    return (
      <EmptyState
        icon={<BarChartOutlined aria-hidden />}
        text="暂无采集批次：请到「采集批次」创建批次并逐条录入观测，报告按 geo_metrics 口径自动生成"
      />
    );
  }

  const current = report.current;
  const m = report.metrics;
  const prev = report.prevMetrics;
  const simulated = current.dataNature !== "real";

  const copyReport = async () => {
    if (!m) return;
    const lines = [
      `# GEO 效果报告 · ${report.project.brand}`,
      "",
      `- 采集批次：${current.periodLabel}（${natureLabel(current.dataNature)}）`,
      `- 监控平台：${current.platforms.join(" / ") || "未配置"}`,
      `- 回答样本：${m.total} 条（点名 ${m.mentioned} 条）`,
      "",
      "## 核心指标",
      `- 曝光效果分数：${score(m.exposureScore)}（${m.tier}）`,
      `- 提及率：${pct(m.mentionRate)}（上期 ${pct(prev?.mentionRate)} · ${deltaPp(m.mentionRate, prev?.mentionRate)}）`,
      `- 上榜率：${pct(m.listRate)}（上期 ${pct(prev?.listRate)} · ${deltaPp(m.listRate, prev?.listRate)}）`,
      `- 平均排名：${m.avgRank === null ? "无上榜样本" : `第 ${score(m.avgRank)} 位`}`,
      `- 引用质量得分：${score(m.citationQuality)}`,
      `- 负面提及率：${pct(m.negativeRate)}（负面 ${m.negative} 条）`,
      "",
      "## 结论摘要",
      ...report.summary.map((line, index) => `${index + 1}. ${line}`),
      "",
      "## 分平台摘要",
      "| 平台 | 回答条数 | 点名条数 | 上榜条数 | 平均排名 | 主要引用题材 |",
      "| --- | --- | --- | --- | --- | --- |",
      ...report.platforms.map(
        (row) =>
          `| ${row.platform} | ${row.total} | ${row.mentioned} | ${row.listed} | ${row.avgRank === null ? "—" : score(row.avgRank)} | ${row.topCitation} |`,
      ),
    ];
    if (report.competitors.length) {
      lines.push(
        "",
        "## 竞品对比（提及率按回答摘录文本匹配）",
        "| 竞品 | 提及率 | 我方缺席条数 |",
        "| --- | --- | --- |",
        ...report.competitors.map(
          (row) => `| ${row.name} | ${row.mentionRate}% | ${row.coverGap} |`,
        ),
      );
    }
    lines.push(
      "",
      "## 可见度缺口与机会点",
      "| 优先级 | 缺口类型 | 监控问题 | 问题类型 | 涉及平台 | 缺口说明 | 建议内容形态 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...(report.gaps.length
        ? report.gaps.map(
            (row) =>
              `| ${row.priority} | ${row.gapType} | ${row.text} | ${row.type} | ${row.platforms.join(" / ")} | ${row.detail} | ${row.suggestForm} |`,
          )
        : ["| — | — | — | — | — | 本轮未发现明显可见度缺口 | — |"]),
      "",
      "## 下一步动作清单",
      "| 优先级 | 动作 | 对应子技能 | 负责角色 | 建议时限 |",
      "| --- | --- | --- | --- | --- |",
      ...report.actions.map(
        (row) =>
          `| ${row.priority} | ${row.action} | ${row.skill} | ${row.owner} | ${row.due} |`,
      ),
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      message.success("报告已复制为 Markdown，可直接粘进交付文档");
    } catch {
      message.error("复制失败：浏览器未开放剪贴板权限");
    }
  };

  const batchBar = (
    <div className="geo-bar">
      <span className="text-12 muted">采集批次</span>
      <Select
        value={current.id}
        style={{ minWidth: 240 }}
        options={report.batches.map((batch) => ({
          value: batch.id,
          label: `${batch.periodLabel}（${natureLabel(batch.dataNature)} ·${
            batch.observationCount ? ` ${batch.observationCount} 条` : " 未录入"
          }）`,
        }))}
        onChange={(value) => setBatchId(value)}
      />
      <span className={`badge ${simulated ? "badge-orange" : "badge-green"}`}>
        {natureLabel(current.dataNature)}
      </span>
      {report.baseline && report.baseline.id !== current.id ? (
        <span className="text-12 muted">
          基线批次：{report.baseline.periodLabel}
        </span>
      ) : (
        <span className="text-12 muted">首次采集即基线</span>
      )}
      <Button
        onClick={() => void copyReport()}
        style={{ marginLeft: "auto" }}
        disabled={!m || !m.total}
      >
        复制报告
      </Button>
    </div>
  );

  if (!m || !m.total) {
    return (
      <>
        {batchBar}
        <Notice variant="warn">
          该批次（{current.periodLabel}）还没有观测记录：报告先要有「问题 × 平台」的观测数据，
          逐条录入后自动生成指标、缺口与动作清单。
        </Notice>
        <div className="geo-bar">
          <Button type="primary" onClick={() => onNavigate?.("batches")}>
            ＋ 前往录入观测
          </Button>
          <span className="text-12 muted">
            共 {report.batches.length} 个批次，其中{" "}
            {report.batches.filter((item) => item.observationCount).length} 个已录入观测
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      {batchBar}

      <Notice variant={simulated ? "warn" : "info"}>
        <strong>结论摘要</strong>
        <ol className="geo-summary">
          {report.summary.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      </Notice>

      <StatGrid>
        <StatCard
          label="曝光效果分数"
          value={
            <span>
              {score(m.exposureScore)}
              <span className={`badge ${tierBadge(m.tier)}`} style={{ marginLeft: 8 }}>
                {m.tier}
              </span>
            </span>
          }
          hint="提及率得分×40% + 上榜率得分×30% + 引用质量×30%（优≥80/良60-79/中40-59/差<40）"
        />
        <StatCard
          label="提及率"
          value={pct(m.mentionRate)}
          hint={`上期 ${pct(prev?.mentionRate)} · ${deltaPp(m.mentionRate, prev?.mentionRate)}`}
        />
        <StatCard
          label="上榜率"
          value={pct(m.listRate)}
          hint={`上期 ${pct(prev?.listRate)} · ${deltaPp(m.listRate, prev?.listRate)}`}
        />
        <StatCard
          label="平均排名"
          value={m.avgRank === null ? "无上榜样本" : `第 ${score(m.avgRank)} 位`}
          hint={
            prev?.avgRank == null
              ? "只统计上榜样本"
              : `上期第 ${score(prev.avgRank)} 位 · ${deltaNum(m.avgRank, prev.avgRank)}`
          }
        />
        <StatCard
          label="引用质量得分"
          value={score(m.citationQuality)}
          hint="报告/官网/百科=100，评测/社区=60，无引用=30"
        />
        <StatCard
          label="回答样本"
          value={`${m.total} 条`}
          hint={`点名 ${m.mentioned} 条 · 负面 ${m.negative} 条（负面提及率 ${pct(m.negativeRate)}）`}
        />
      </StatGrid>

      <p className="text-12 muted">
        口径：提及率＝点名回答数 ÷ 回答总数；上榜率＝进入推荐位的回答数 ÷ 回答总数；平均排名只统计上榜样本；
        引用质量按引用题材加权（报告/官网/百科 100 · 评测/社区 60 · 无引用 30，未点名按「无引用」计）。
      </p>

      <h4 className="geo-h4">分平台摘要</h4>
      <div className="table-wrap">
        <Table
          rowKey="platform"
          size="middle"
          dataSource={report.platforms}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState icon={<RadarChartOutlined aria-hidden />} text="本批次未配置监控平台" /> }}
          columns={[
            { title: "平台", dataIndex: "platform", width: 120 },
            { title: "回答条数", dataIndex: "total", width: 100 },
            { title: "点名条数", dataIndex: "mentioned", width: 100 },
            { title: "上榜条数", dataIndex: "listed", width: 100 },
            {
              title: "平均排名",
              width: 110,
              render: (_, row) => (row.avgRank === null ? "无上榜样本" : score(row.avgRank)),
            },
            { title: "主要引用题材", dataIndex: "topCitation", width: 140 },
            {
              title: "备注",
              dataIndex: "tip",
              width: 110,
              render: (value: string) =>
                value ? <span className="badge badge-orange">{value}</span> : "—",
            },
          ]}
        />
      </div>

      <h4 className="geo-h4">竞品对比矩阵</h4>
      {report.competitors.length ? (
        <>
          <div className="table-wrap">
            <Table
              rowKey="name"
              size="middle"
              dataSource={report.competitors}
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "竞品", dataIndex: "name", width: 160 },
                {
                  title: "提及率（摘录匹配）",
                  width: 170,
                  render: (_, row) => `${row.mentionRate}%`,
                },
                {
                  title: "我方缺席条数",
                  dataIndex: "coverGap",
                  width: 130,
                  render: (value: number) =>
                    value ? <span className="badge badge-red">{value}</span> : 0,
                },
                {
                  title: "竞品上榜率 / 平均排名 / 曝光分数",
                  width: 220,
                  render: () => (
                    <span className="text-12 muted">
                      未采集（需在观测中记录竞品位次）
                    </span>
                  ),
                },
              ]}
            />
          </div>
          <p className="text-12 muted">
            竞品提及率按回答摘录文本匹配统计；竞品的上榜率/平均排名/曝光分数需要在采集时逐条记录竞品位次，
            当前观测未采集该字段，故不显示数值。我方：{report.project.brand}
            {report.project.brandAliasList.length
              ? `（别名 ${report.project.brandAliasList.join(" / ")}）`
              : ""}
          </p>
        </>
      ) : (
        <EmptyState icon={<FundOutlined aria-hidden />} text="项目未配置竞品，可在项目设置中补充竞品名称" />
      )}

      <h4 className="geo-h4">可见度缺口与机会点</h4>
      <p className="text-12 muted">
        缺口只对「启用中」的监控问题生成，已淘汰的问题不参与；「加入选题池」会带着缺口证据跳到选题池并预填四维评分。
      </p>
      <div className="table-wrap">
        <Table
          rowKey="questionId"
          size="middle"
          dataSource={report.gaps}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState icon={<CheckCircleOutlined aria-hidden />} text="本轮未发现明显可见度缺口" /> }}
          columns={[
            {
              title: "优先级",
              dataIndex: "priority",
              width: 90,
              render: (value: string) => (
                <span className={`badge ${priorityBadge(value)}`}>{value}</span>
              ),
            },
            { title: "缺口类型", dataIndex: "gapType", width: 140 },
            { title: "监控问题", dataIndex: "text", width: 300 },
            { title: "问题类型", dataIndex: "type", width: 110 },
            {
              title: "涉及平台",
              dataIndex: "platforms",
              width: 200,
              render: (value: string[]) => value.join(" / "),
            },
            { title: "缺口说明", dataIndex: "detail", width: 220 },
            { title: "建议内容形态", dataIndex: "suggestForm", width: 130 },
            {
              title: "操作",
              width: 130,
              render: (_, row) => (
                <Button type="primary" onClick={() => onCreateTopic?.(draftTopicFromGap(row))}>
                  加入选题池
                </Button>
              ),
            },
          ]}
        />
      </div>

      <h4 className="geo-h4">下一步动作清单</h4>
      <div className="table-wrap">
        <Table
          rowKey="action"
          size="middle"
          dataSource={report.actions}
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: "优先级",
              dataIndex: "priority",
              width: 90,
              render: (value: string) => (
                <span className={`badge ${priorityBadge(value)}`}>{value}</span>
              ),
            },
            { title: "动作", dataIndex: "action", width: 420 },
            { title: "对应子技能", dataIndex: "skill", width: 240 },
            { title: "负责角色", dataIndex: "owner", width: 180 },
            { title: "建议时限", dataIndex: "due", width: 110 },
          ]}
        />
      </div>
    </>
  );
}

/* ------------------------------ 监控问题库 ------------------------------ */

const EMPTY_QUESTION = {
  text: "",
  type: "品类词",
  scenario: "",
  expected_answer_form: "",
  priority: "P1",
};

export function GeoQuestionsView({
  projectId,
  meta,
}: {
  projectId: number;
  meta: GeoMeta | null;
}) {
  const actions=useGeoActions();
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GeoQuestion | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const query = useGeoQuestions(projectId);
  const rows = query.data ?? [];
  const loading = query.isPending;


  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(EMPTY_QUESTION);
    setFormOpen(true);
  };

  const openEdit = (row: GeoQuestion) => {
    setEditing(row);
    form.setFieldsValue({
      text: row.text,
      type: row.type,
      scenario: row.scenario,
      expected_answer_form: row.expectedAnswerForm,
      priority: row.priority,
    });
    setFormOpen(true);
  };

  const save = async () => {
    const values = (await form.validateFields()) as Record<string, unknown>;
    setSubmitting(true);
    try {
      if (!editing) {
        await actions.createQuestion.mutateAsync({params:{id:String(projectId)},body:values});

        message.success("监控问题已加入问题库");
        setFormOpen(false);
        return;
      }
      const target = editing;
      setFormOpen(false);
      request({
        title: "修改监控问题（需密码）",
        content: `确认修改「${target.text}」？`,
        okText: "保存修改",
        onOk: async () => {
          await actions.updateQuestion.mutateAsync({params:{id:String(target.id)},body:{ ...values, project_id: projectId }});

          message.success("已保存修改");
          setEditing(null);
        },
      });
    } catch { /* 统一 Mutation Hook 已展示错误。 */ } finally {
      setSubmitting(false);
    }
  };

  const remove = (row: GeoQuestion) => {
    request({
      title: "删除监控问题",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.text}」？该问题下的采集观测记录一并删除，报告口径随之变化。`,
      onOk: async () => {
        await actions.removeQuestion.mutateAsync({params:{id:String(row.id)}});

        message.success("已删除");
      },
    });
  };

  const toggleStatus = (row: GeoQuestion) => {
    const retiring = row.status === "ACTIVE";
    request({
      title: `${retiring ? "淘汰" : "启用"}监控问题（需密码）`,
      okText: retiring ? "确认淘汰" : "确认启用",
      content: retiring
        ? `确认淘汰「${row.text}」？淘汰后不再生成可见度缺口，历史观测仍计入指标。`
        : `确认重新启用「${row.text}」？启用后重新参与缺口判定。`,
      onOk: async () => {
        await actions.updateQuestion.mutateAsync({params:{id:String(row.id)},body:{
            project_id: projectId,
            status: retiring ? "RETIRED" : "ACTIVE",
          }});

        message.success(retiring ? "已淘汰" : "已启用");
      },
    });
  };

  const counts = (meta?.questionTypes || []).map((item) => ({
    ...item,
    current: rows.filter((row) => row.type === item.type).length,
  }));

  return (
    <>
      {query.isError ? <Notice variant="warn">{query.error.message} <Button onClick={() => {void query.refetch();}}>重试</Button></Notice> : null}
      <Notice variant="info">
        问题库配比（起步 30 条）：
        {counts
          .map((item) => `${item.type} ${item.current}/${item.target} 条（${item.share}%）`)
          .join(" · ")}
        。命中率靠前的问题优先保留，长期无品牌/无竞品的问题按季度淘汰。
      </Notice>
      <div className="geo-bar">
        <Button type="primary" onClick={openCreate}>
          ＋ 新增监控问题
        </Button>
        <span className="text-12 muted">逐条添加，共 {rows.length} 条</span>
      </div>
      <div className="table-wrap">
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={demandPagination}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState icon={<QuestionCircleOutlined aria-hidden />} text="问题库为空，先按配比逐条录入监控问题" /> }}
          columns={[
            { title: "序号", dataIndex: "seq", width: 80, render: (value: string) => value || "—" },
            { title: "监控问题", dataIndex: "text", width: 320 },
            { title: "问题类型", dataIndex: "type", width: 110 },
            { title: "业务场景", dataIndex: "scenario", width: 160, render: (value: string) => value || "—" },
            {
              title: "期望答案形态",
              dataIndex: "expectedAnswerForm",
              width: 150,
              render: (value: string) => value || "—",
            },
            {
              title: "优先级",
              dataIndex: "priority",
              width: 90,
              render: (value: string) => (
                <span className={`badge ${priorityBadge(value)}`}>{value}</span>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (value: string) =>
                value === "ACTIVE" ? (
                  <span className="badge badge-green">启用</span>
                ) : (
                  <span className="badge badge-gray">已淘汰</span>
                ),
            },
            {
              title: "操作",
              width: 200,
              render: (_, row) => (
                <div className="geo-actions">
                  <Button onClick={() => openEdit(row)}>编辑</Button>
                  <Button onClick={() => toggleStatus(row)}>
                    {row.status === "ACTIVE" ? "淘汰" : "启用"}
                  </Button>
                  <Button danger onClick={() => remove(row)}>
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={formOpen}
        title={editing ? "修改监控问题（需密码）" : "新增监控问题"}
        width={620}
        confirmLoading={submitting}
        okText={editing ? "保存修改" : "加入问题库"}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onOk={() => void save()}
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_QUESTION}>
          <Form.Item
            name="text"
            label="监控问题 *"
            rules={[{ required: true, message: "请填写监控问题" }]}
          >
            <Input placeholder="如：杭州有哪些靠谱的餐饮品牌代运营公司" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="type" label="问题类型">
              <Select
                options={(meta?.questionTypes || []).map((item) => ({
                  value: item.type,
                  label: item.type,
                }))}
              />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select
                options={[
                  { value: "P0", label: "P0 最高" },
                  { value: "P1", label: "P1" },
                  { value: "P2", label: "P2" },
                ]}
              />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="scenario" label="业务场景">
              <Input placeholder="如：新店开业选服务商" />
            </Form.Item>
            <Form.Item name="expected_answer_form" label="期望答案形态">
              <Input placeholder="如：数据文/指南、对比表、清单/FAQ" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
      {modal}
    </>
  );
}

/* ------------------------------ 采集批次 ------------------------------ */

const EMPTY_BATCH = {
  period_label: "",
  channel: "A",
  data_nature: "simulated",
  platforms: [] as string[],
  note: "",
};

export function GeoBatchesView({
  projectId,
  meta,
}: {
  projectId: number;
  meta: GeoMeta | null;
}) {
  const actions=useGeoActions();
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GeoBatch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [active, setActive] = useState<GeoBatch | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [form] = Form.useForm();

  const autoQuery = useGeoAutoCollect(projectId);
  const auto = autoQuery.data ?? null;
  const batchesQuery = useGeoBatches(projectId);
  const questionsQuery = useGeoQuestions(projectId);
  const rows = batchesQuery.data ?? [];
  const questions = questionsQuery.data ?? [];
  const loading = batchesQuery.isPending || questionsQuery.isPending;
  const {refetch:refetchBatches} = batchesQuery;
  const {refetch:refetchQuestions} = questionsQuery;
  const load = useCallback(async () => {await Promise.all([refetchBatches(), refetchQuestions()]);}, [refetchBatches, refetchQuestions]);
  useEffect(() => {
    const batches = batchesQuery.data ?? [];
    setActive(current => current ? batches.find(item => item.id === current.id) ?? null : null);
  }, [batchesQuery.data]);

  const toggleAuto = () => {
    const enabled = !auto?.enabled;
    const apply = async () => {
      setAutoSaving(true);
      try {
        await actions.setAutoCollect.mutateAsync({params:{id:String(projectId)},body:{ enabled }});

        message.success(
          enabled ? "已开启自动采集，每周日凌晨窗口执行" : "已关闭自动采集",
        );
      } catch (error) {
        void error;
      } finally {
        setAutoSaving(false);
      }
    };
    if (!enabled) {
      void apply();
      return;
    }
    request({
      title: "开启自动采集（需密码）",
      okText: "确认开启",
      content: `确认开启自动采集？系统将在每周日 02:00–06:00 窗口按「启用中的监控问题 × 可用平台」逐条向 AI 平台提问并自动记录观测（本期约 ${auto?.plannedPerRun ?? 0} 条），会产生真实的模型调用；窗口未跑完的自动顺延到次日同窗口。`,
      onOk: apply,
    });
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(EMPTY_BATCH);
    setFormOpen(true);
  };

  const openEdit = (row: GeoBatch) => {
    setEditing(row);
    form.setFieldsValue({
      period_label: row.periodLabel,
      channel: row.channel,
      data_nature: row.dataNature,
      platforms: row.platforms,
      note: row.note,
    });
    setFormOpen(true);
  };

  const save = async () => {
    const values = (await form.validateFields()) as Record<string, unknown>;
    setSubmitting(true);
    try {
      if (!editing) {
        await actions.createBatch.mutateAsync({params:{id:String(projectId)},body:values});

        message.success("采集批次已创建，可逐条录入观测记录");
        setFormOpen(false);
        return;
      }
      const target = editing;
      setFormOpen(false);
      request({
        title: "修改采集批次（需密码）",
        content: `确认修改批次「${target.periodLabel}」？`,
        okText: "保存修改",
        onOk: async () => {
          await actions.updateBatch.mutateAsync({params:{id:String(target.id)},body:{ ...values, project_id: projectId }});

          message.success("已保存修改");
          setEditing(null);
        },
      });
    } catch { /* 统一 Mutation Hook 已展示错误。 */ } finally {
      setSubmitting(false);
    }
  };

  const remove = (row: GeoBatch) => {
    request({
      title: "删除采集批次",
      danger: true,
      okText: "确认删除",
      content: `确认删除批次「${row.periodLabel}」？该批次下 ${row.observationCount} 条观测记录一并删除。`,
      onOk: async () => {
        await actions.removeBatch.mutateAsync({params:{id:String(row.id)}});

        message.success("已删除");
      },
    });
  };

  if (active) {
    return (
      <GeoBatchDetail
        batch={active}
        questions={questions}
        meta={meta}
        onBack={() => setActive(null)}
      />
    );
  }

  const run = auto?.currentRun || null;

  return (
    <>
      {batchesQuery.isError || questionsQuery.isError ? <Notice variant="warn">{batchesQuery.error?.message ?? questionsQuery.error?.message} <Button onClick={() => {void load();}}>重试</Button></Notice> : null}
      <Notice variant="info">
        采集批次＝一次监控采集（周期 A：每周人工；周期 B：每月复核；自动采集：系统每周生成）。同一批次内按「问题 ×
        平台」逐条录入观测；人工采集的模拟数据必须标注，自动采集落的是真实平台回答数据。
      </Notice>
      {autoQuery.error&&<Notice variant="error">采集状态暂不可用：{autoQuery.error.message}</Notice>}
      <div className="geo-bar">
        <Button type="primary" onClick={openCreate}>
          ＋ 新建采集批次
        </Button>
        <Button
          danger={Boolean(auto?.enabled)}
          loading={autoSaving}
          disabled={!auto}
          onClick={toggleAuto}
        >
          {auto?.enabled ? <><PauseCircleOutlined aria-hidden /> 关闭自动采集</> : <><PlayCircleOutlined aria-hidden /> 开启自动采集</>}
        </Button>
        <span className="text-12 muted">共 {rows.length} 个批次</span>
      </div>

      {auto ? (
        <>
          <Notice variant={auto.enabled ? "success" : "info"}>
            <strong>
              {auto.enabled
                ? `自动采集已开启 · 本期 ${auto.weekLabel}`
                : "自动采集未开启"}
            </strong>
            <span>
              {auto.enabled
                ? `　每周日 02:00–06:00 由系统向监控平台逐条提问并自动记录观测（真实数据）；本期未跑完的顺延到次日同一窗口（至周六）。`
                : `　开启后由系统每周日 02:00–06:00 自动向监控平台逐条提问并记录观测（真实数据），本期未跑完顺延到次日同一窗口（至周六）。`}
            </span>
            <div className="text-12 muted" style={{ marginTop: 6 }}>
              本期计划：{auto.questionCount} 个启用问题 × {auto.usablePlatforms.length} 个可用平台 ＝{" "}
              {auto.plannedPerRun} 条观测（{auto.usablePlatforms.join(" / ") || "无可用平台"}）
              {auto.skippedPlatforms.length
                ? `；未纳入：${auto.skippedPlatforms.join("、")}`
                : ""}
              {auto.enabled
                ? `　·　下一个窗口：${formatWindow(auto.windowStart, auto.windowEnd)}${auto.inWindow ? "（进行中）" : ""}`
                : ""}
            </div>
            {run?.lastError ? (
              <div className="text-12 muted" style={{ marginTop: 4 }}>
                本期说明：{run.lastError}
              </div>
            ) : null}
            {auto.enabled && auto.updatedBy ? (
              <div className="text-12 muted" style={{ marginTop: 4 }}>
                开关操作：{auto.updatedBy}
                {auto.updatedAt
                  ? ` · ${new Date(auto.updatedAt).toLocaleString("zh-CN", { hour12: false })}`
                  : ""}
              </div>
            ) : null}
          </Notice>

          {auto.enabled && run ? (
            <StatGrid>
              <StatCard
                label={`本期计划（${run.periodLabel}）`}
                value={`${run.planned} 条`}
                hint={collectStatusLabel(run.status)}
              />
              <StatCard
                label="已完成"
                value={`${run.done} 条`}
                hint={
                  run.status === "RUNNING"
                    ? "采集中，每 30 秒自动刷新"
                    : run.batchId
                      ? `已生成批次记录（批次 #${run.batchId}）`
                      : "尚无成功项"
                }
              />
              <StatCard
                label="失败"
                value={`${run.failed} 条`}
                hint="单条最多重试 3 次，失败的顺延到下一窗口"
              />
              <StatCard
                label="待采集"
                value={`${run.pending} 条`}
                hint={
                  run.deferred
                    ? "本窗口已结束，顺延至次日 02:00–06:00"
                    : "按「问题 × 平台」逐条排队"
                }
              />
            </StatGrid>
          ) : null}
        </>
      ) : null}
      <div className="table-wrap">
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={demandPagination}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState icon={<DownloadOutlined aria-hidden />} text="暂无采集批次，先新建批次再逐条录入观测" /> }}
          columns={[
            { title: "采集周期", dataIndex: "periodLabel", width: 130 },
            {
              title: "通道",
              dataIndex: "channel",
              width: 130,
              render: (value: string) => (
                <span className={`badge ${value === "C" ? "badge-sky" : "badge-gray"}`}>
                  {channelLabel(value)}
                </span>
              ),
            },
            {
              title: "数据性质",
              dataIndex: "dataNature",
              width: 130,
              render: (value: string) => (
                <span className={`badge ${value === "real" ? "badge-green" : "badge-orange"}`}>
                  {natureLabel(value)}
                </span>
              ),
            },
            {
              title: "监控平台",
              dataIndex: "platforms",
              width: 220,
              render: (value: string[]) => value.join(" / "),
            },
            { title: "观测条数", dataIndex: "observationCount", width: 100 },
            { title: "备注", dataIndex: "note", width: 180, render: (value: string) => value || "—" },
            {
              title: "操作",
              width: 220,
              render: (_, row) => (
                <div className="geo-actions">
                  <Button type="primary" onClick={() => setActive(row)}>
                    录入观测
                  </Button>
                  <Button onClick={() => openEdit(row)}>编辑</Button>
                  <Button danger onClick={() => remove(row)}>
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={formOpen}
        title={editing ? "修改采集批次（需密码）" : "新建采集批次"}
        width={620}
        confirmLoading={submitting}
        okText={editing ? "保存修改" : "创建批次"}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onOk={() => void save()}
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_BATCH}>
          <div className="form-2col">
            <Form.Item
              name="period_label"
              label="采集周期 *"
              rules={[{ required: true, message: "请填写采集周期" }]}
            >
              <Input placeholder="如：2026-W39 / 2026-09" />
            </Form.Item>
            <Form.Item name="channel" label="采集通道">
              <Select
                options={[
                  { value: "A", label: "通道 A（每周人工采集）" },
                  { value: "B", label: "通道 B（每月复核）" },
                  { value: "C", label: "通道 C（系统自动采集）" },
                ]}
              />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="data_nature" label="数据性质">
              <Select
                options={[
                  { value: "simulated", label: "模拟数据（人工模拟，报告内标注）" },
                  { value: "real", label: "真实采集数据（监控平台）" },
                ]}
              />
            </Form.Item>
            <Form.Item name="platforms" label="监控平台">
              <Select
                mode="multiple"
                placeholder={
                  (meta?.availablePlatforms || []).length
                    ? "留空则用项目配置的平台"
                    : "暂无可用的采集平台"
                }
                options={(meta?.availablePlatforms || []).map((item) => ({
                  value: item,
                  label: item,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="采集说明、数据断点等" />
          </Form.Item>
        </Form>
      </Modal>
      {modal}
    </>
  );
}

const EMPTY_OBSERVATION = {
  question_id: undefined as number | undefined,
  platform: "",
  brand_mentioned: "0",
  rank_position: undefined as number | undefined,
  sentiment: "中性",
  citation_genre: "无",
  citation_domains: "",
  model_version: "",
  answer_excerpt: "",
};

function GeoBatchDetail({
  batch,
  questions,
  meta,
  onBack,
}: {
  batch: GeoBatch;
  questions: GeoQuestion[];
  meta: GeoMeta | null;
  onBack: () => void;
}) {
  const actions=useGeoActions();
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GeoObservation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const mentioned = Form.useWatch("brand_mentioned", form);
  const platformWatched = Form.useWatch("platform", form);

  const query = useGeoObservations(batch.id);
  const rows = query.data ?? [];
  const loading = query.isPending;


  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(EMPTY_OBSERVATION);
    setFormOpen(true);
  };

  const openEdit = (row: GeoObservation) => {
    setEditing(row);
    form.setFieldsValue({
      question_id: row.questionId,
      platform: row.platform,
      brand_mentioned: row.brandMentioned ? "1" : "0",
      rank_position: row.rankPosition ?? undefined,
      sentiment: row.sentiment,
      citation_genre: row.citationGenre,
      citation_domains: row.citationDomains,
      model_version: row.modelVersion,
      answer_excerpt: row.answerExcerpt,
    });
    setFormOpen(true);
  };

  const save = async (keepOpen = false) => {
    const values = (await form.validateFields()) as Record<string, unknown>;
    setSubmitting(true);
    try {
      if (!editing) {
        await actions.createObservation.mutateAsync({params:{id:String(batch.id)},body:values});
        if (keepOpen) {
          const questionId = values.question_id as number | undefined;
          form.resetFields();
          form.setFieldsValue({ ...EMPTY_OBSERVATION, question_id: questionId });
          message.success("已保存，接着录这个问题的下一个平台");
        } else {
          message.success("观测记录已加入批次");
          setFormOpen(false);
        }
        return;
      }
      const target = editing;
      setFormOpen(false);
      request({
        title: "修改观测记录（需密码）",
        content: `确认修改「${target.questionText} · ${target.platform}」的观测记录？`,
        okText: "保存修改",
        onOk: async () => {
          await actions.updateObservation.mutateAsync({params:{id:String(target.id)},body:{ ...values, batch_id: batch.id }});

          message.success("已保存修改");
          setEditing(null);
        },
      });
    } catch { /* 统一 Mutation Hook 已展示错误。 */ } finally {
      setSubmitting(false);
    }
  };

  const remove = (row: GeoObservation) => {
    request({
      title: "删除观测记录",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.questionText} · ${row.platform}」这条观测？`,
      onOk: async () => {
        await actions.removeObservation.mutateAsync({params:{id:String(row.id)}});

        message.success("已删除");
      },
    });
  };

  // 批次表单/观测录入同样只给后台配好的平台；正在编辑的那条历史记录的平台保留，避免改别的字段时把平台丢掉
  const usablePlatforms = meta?.availablePlatforms || [];
  const batchPlatforms = batch.platforms.length
    ? batch.platforms
    : usablePlatforms;
  const platformOptions = Array.from(
    new Set([
      ...batchPlatforms.filter((item) => usablePlatforms.includes(item)),
      ...(editing?.platform ? [editing.platform] : []),
    ]),
  );
  const activeQuestions = questions.filter((item) => item.status === "ACTIVE");
  const coveredQuestions = new Set(rows.map((row) => row.questionId)).size;
  const coveredPlatforms = new Set(rows.map((row) => row.platform)).size;
  const recordedKeys = new Set(
    rows.map((row) => `${row.questionId}|${row.platform}`),
  );
  const pendingCount = activeQuestions.reduce(
    (sum, question) =>
      sum +
      platformOptions.filter(
        (platform) => !recordedKeys.has(`${question.id}|${platform}`),
      ).length,
    0,
  );
  const takenKeys = new Set(
    rows
      .filter((row) => row.id !== editing?.id)
      .map((row) => `${row.questionId}|${row.platform}`),
  );

  return (
    <>
      {query.isError ? <Notice variant="warn">{query.error.message} <Button onClick={() => {void query.refetch();}}>重试</Button></Notice> : null}
      <div className="geo-bar">
        <Button onClick={onBack}>← 返回批次列表</Button>
        <span className="badge badge-gray">{batch.periodLabel}</span>
        {batch.channel === "C" ? (
          <span className="badge badge-sky">{channelLabel(batch.channel)}</span>
        ) : null}
        <span className={`badge ${batch.dataNature === "real" ? "badge-green" : "badge-orange"}`}>
          {natureLabel(batch.dataNature)}
        </span>
        <Button type="primary" onClick={openCreate}>
          ＋ 添加观测
        </Button>
        <span className="text-12 muted">
          已录入 {rows.length} 条 · 覆盖问题 {coveredQuestions}/{activeQuestions.length} ·
          覆盖平台 {coveredPlatforms}/{platformOptions.length}
          {pendingCount ? ` · 还差 ${pendingCount} 组（问题 × 平台）` : " · 已录满"}
        </span>
      </div>
      <p className="text-12 muted">
        {batch.channel === "C"
          ? "本批次由系统自动采集生成（观测为平台真实回答数据）：可手工补录自动采集失败或缺失的「问题 × 平台」。"
          : "逐条录入：每条观测＝一个监控问题在一个平台上的回答结果（是否点名、排名、情绪、引用题材）。"}
        未点名的记录不参与平均排名统计；同一「问题 × 平台」只录一条，重复录入会被拦截。
      </p>
      <div className="table-wrap">
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={demandPagination}
          scroll={{ x: "max-content" }}
          expandable={{
            rowExpandable: (row) => Boolean(row.answerExcerpt),
            expandedRowRender: (row) => (
              <div className="geo-answer">
                <div className="text-12 muted" style={{ marginBottom: 4 }}>
                  回答摘录（{row.answerExcerpt.length} 字）
                  {row.modelVersion ? ` · 模型 ${row.modelVersion}` : ""}
                </div>
                {row.answerExcerpt}
              </div>
            ),
          }}
          locale={{ emptyText: <EmptyState icon={<SearchOutlined aria-hidden />} text="该批次还没有观测记录，逐条添加后生成报告" /> }}
          columns={[
            { title: "监控问题", dataIndex: "questionText", width: 260 },
            { title: "问题类型", dataIndex: "questionType", width: 110 },
            { title: "平台", dataIndex: "platform", width: 100 },
            {
              title: "是否点名",
              dataIndex: "brandMentioned",
              width: 100,
              render: (value: number) =>
                value ? (
                  <span className="badge badge-green">点名</span>
                ) : (
                  <span className="badge badge-gray">未点名</span>
                ),
            },
            {
              title: "排名",
              dataIndex: "rankPosition",
              width: 80,
              render: (value: number | null) => (value ? `第 ${value} 位` : "—"),
            },
            { title: "情绪", dataIndex: "sentiment", width: 90 },
            { title: "引用题材", dataIndex: "citationGenre", width: 100 },
            {
              title: "引用域名",
              dataIndex: "citationDomains",
              width: 160,
              render: (value: string) => value || "—",
            },
            {
              title: "模型版本",
              dataIndex: "modelVersion",
              width: 130,
              render: (value: string) => value || "—",
            },
            {
              title: "操作",
              width: 140,
              render: (_, row) => (
                <div className="geo-actions">
                  <Button onClick={() => openEdit(row)}>编辑</Button>
                  <Button danger onClick={() => remove(row)}>
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={formOpen}
        title={editing ? "修改观测记录（需密码）" : "添加观测记录"}
        width={680}
        confirmLoading={submitting}
        okText={editing ? "保存修改" : "加入批次"}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onOk={() => void save()}
        footer={
          editing
            ? undefined
            : [
                <Button
                  key="cancel"
                  onClick={() => {
                    setFormOpen(false);
                    setEditing(null);
                  }}
                >
                  取消
                </Button>,
                <Button key="more" loading={submitting} onClick={() => void save(true)}>
                  保存并继续
                </Button>,
                <Button
                  key="ok"
                  type="primary"
                  loading={submitting}
                  onClick={() => void save()}
                >
                  加入批次
                </Button>,
              ]
        }
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_OBSERVATION}>
          <div className="form-2col">
            <Form.Item
              name="question_id"
              label="监控问题 *"
              rules={[{ required: true, message: "请选择监控问题" }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择本项目的问题"
                options={questions.map((item) => {
                  const retired = item.status !== "ACTIVE";
                  const taken = takenKeys.has(`${item.id}|${platformWatched}`);
                  const suffix = taken
                    ? "（该平台已录）"
                    : retired
                      ? "（已淘汰）"
                      : "";
                  return {
                    value: item.id,
                    label: `${item.type}｜${item.text}${suffix}`,
                    disabled: taken || (retired && item.id !== editing?.questionId),
                  };
                })}
              />
            </Form.Item>
            <Form.Item
              name="platform"
              label="监控平台 *"
              rules={[{ required: true, message: "请选择监控平台" }]}
            >
              <Select
                placeholder={
                  platformOptions.length
                    ? "选择本批次配置的平台"
                    : "暂无可用的采集平台"
                }
                options={platformOptions.map((item) => ({
                  value: item,
                  label: item,
                }))}
              />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="brand_mentioned" label="品牌是否被点名">
              <Select
                options={[
                  { value: "1", label: "点名" },
                  { value: "0", label: "未点名" },
                ]}
              />
            </Form.Item>
            <Form.Item name="rank_position" label="推荐排名（未上榜留空）">
              <InputNumber
                min={1}
                style={{ width: "100%" }}
                disabled={mentioned !== "1"}
                placeholder="如 2"
              />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="sentiment" label="情绪">
              <Select
                disabled={mentioned !== "1"}
                options={(meta?.sentiments || []).map((item) => ({
                  value: item,
                  label: item,
                }))}
              />
            </Form.Item>
            <Form.Item name="citation_genre" label="引用题材">
              <Select
                disabled={mentioned !== "1"}
                options={(meta?.citationGenres || []).map((item) => ({
                  value: item,
                  label: item,
                }))}
              />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="citation_domains" label="引用域名">
              <Input placeholder="如：zhihu.com, 36kr.com" />
            </Form.Item>
            <Form.Item name="model_version" label="模型版本">
              <Input placeholder="如：DeepSeek-V3 / doubao-1.5-pro" />
            </Form.Item>
          </div>
          <Form.Item name="answer_excerpt" label="回答摘录（竞品分析按此文本匹配）">
            <Input.TextArea rows={3} placeholder="粘贴回答中与品牌/竞品相关的原文段落" />
          </Form.Item>
        </Form>
      </Modal>
      {modal}
    </>
  );
}

/* ------------------------------- 选题池 ------------------------------- */

const EMPTY_TOPIC = {
  title: "",
  gap_type: "引用真空点",
  question_id: undefined as number | undefined,
  platform_count: 0,
  gap_score: 0,
  citable_score: 0,
  business_score: 0,
  supply_score: 0,
  style_bonus: 0,
  blacklisted: false,
  status: "CANDIDATE",
  note: "",
};

export function GeoTopicView({
  projectId,
  meta,
  questions,
  draft,
  onDraftUsed,
}: {
  projectId: number;
  meta: GeoMeta | null;
  questions: GeoQuestion[];
  draft?: GeoTopicDraft | null;
  onDraftUsed?: () => void;
}) {
  const actions=useGeoActions();
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GeoTopic | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [form] = Form.useForm();

  const query = useGeoTopics(projectId);
  const rows = query.data ?? [];
  const loading = query.isPending;


  // 报告缺口「加入选题池」：带证据打开预填表单，评分按技能包分档预填（可改）
  useEffect(() => {
    if (!draft) return;
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      ...EMPTY_TOPIC,
      title: draft.title,
      gap_type: draft.gapType,
      question_id: draft.questionId,
      platform_count: draft.platformCount,
      gap_score: draft.gapScore,
      citable_score: draft.citableScore,
      business_score: draft.businessScore,
      supply_score: draft.supplyScore,
      note: draft.note,
    });
    setPresetOpen(true);
    setFormOpen(true);
    onDraftUsed?.();
  }, [draft, form, onDraftUsed]);

  const openCreate = () => {
    setEditing(null);
    setPresetOpen(false);
    form.resetFields();
    form.setFieldsValue(EMPTY_TOPIC);
    setFormOpen(true);
  };

  const openEdit = (row: GeoTopic) => {
    setEditing(row);
    setPresetOpen(false);
    form.setFieldsValue({
      title: row.title,
      gap_type: row.gapType,
      question_id: row.questionId || undefined,
      platform_count: row.platformCount,
      gap_score: row.gapScore,
      citable_score: row.citableScore,
      business_score: row.businessScore,
      supply_score: row.supplyScore,
      style_bonus: row.styleBonus,
      blacklisted: Boolean(row.blacklisted),
      status: row.status,
      note: row.note,
    });
    setFormOpen(true);
  };

  const save = async () => {
    const values = (await form.validateFields()) as Record<string, unknown>;
    const body = { ...values, blacklisted: values.blacklisted ? 1 : 0 };
    setSubmitting(true);
    try {
      if (!editing) {
        await actions.createTopic.mutateAsync({params:{id:String(projectId)},body:body});

        message.success("选题已加入选题池（总分按四维加权自动计算）");
        setFormOpen(false);
        return;
      }
      const target = editing;
      setFormOpen(false);
      request({
        title: "修改选题（需密码）",
        content: `确认修改选题「${target.title}」？总分将按四维评分重新计算。`,
        okText: "保存修改",
        onOk: async () => {
          await actions.updateTopic.mutateAsync({params:{id:String(target.id)},body:{ ...body, project_id: projectId }});

          message.success("已保存修改");
          setEditing(null);
        },
      });
    } catch { /* 统一 Mutation Hook 已展示错误。 */ } finally {
      setSubmitting(false);
    }
  };

  const remove = (row: GeoTopic) => {
    request({
      title: "删除选题",
      danger: true,
      okText: "确认删除",
      content: `确认删除选题「${row.title}」？`,
      onOk: async () => {
        await actions.removeTopic.mutateAsync({params:{id:String(row.id)}});

        message.success("已删除");
      },
    });
  };

  const statusLabel = (value: string) => {
    if (value === "SELECTED") return { cls: "badge-green", label: "已选用" };
    if (value === "REJECTED") return { cls: "badge-red", label: "已淘汰" };
    return { cls: "badge-gray", label: "候选" };
  };

  return (
    <>
      {query.isError ? <Notice variant="warn">{query.error.message} <Button onClick={() => {void query.refetch();}}>重试</Button></Notice> : null}
      <Notice variant="info">{TOPIC_WEIGHTS}</Notice>
      <div className="geo-bar">
        <Button type="primary" onClick={openCreate}>
          ＋ 新增选题
        </Button>
        <span className="text-12 muted">
          共 {rows.length} 条 · 按总分降序排列，分数越高越优先生产
        </span>
      </div>
      <div className="table-wrap">
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={demandPagination}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState icon={<BulbOutlined aria-hidden />} text="选题池为空，按报告缺口逐条录入选题" /> }}
          columns={[
            { title: "选题", dataIndex: "title", width: 260 },
            { title: "缺口类型", dataIndex: "gapType", width: 140 },
            {
              title: "关联问题",
              dataIndex: "questionId",
              width: 220,
              render: (value: number) =>
                questions.find((item) => item.id === value)?.text || "—",
            },
            { title: "平台数", dataIndex: "platformCount", width: 80 },
            {
              title: "四维评分（缺口/可引/商业/供给）",
              width: 220,
              render: (_, row) =>
                `${row.gapScore} / ${row.citableScore} / ${row.businessScore} / ${row.supplyScore}`,
            },
            { title: "风格加分", dataIndex: "styleBonus", width: 90 },
            {
              title: "总分",
              dataIndex: "totalScore",
              width: 90,
              render: (value: number, row) =>
                row.blacklisted ? (
                  <span className="badge badge-red">0</span>
                ) : (
                  <strong>{value.toFixed(1)}</strong>
                ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (value: string) => {
                const state = statusLabel(value);
                return <span className={`badge ${state.cls}`}>{state.label}</span>;
              },
            },
            {
              title: "操作",
              width: 140,
              render: (_, row) => (
                <div className="geo-actions">
                  <Button onClick={() => openEdit(row)}>编辑</Button>
                  <Button danger onClick={() => remove(row)}>
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={formOpen}
        title={editing ? "修改选题（需密码）" : "新增选题"}
        width={680}
        confirmLoading={submitting}
        okText={editing ? "保存修改" : "加入选题池"}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onOk={() => void save()}
      >
        {presetOpen ? (
          <Notice variant="info">
            由报告缺口带入：四维评分按《GEO 四维选题评分引擎》分档预填（估算），
            请按实际证据调整后再加入选题池。
          </Notice>
        ) : null}
        <Form form={form} layout="vertical" initialValues={EMPTY_TOPIC}>
          <Form.Item
            name="title"
            label="选题名称 *"
            rules={[{ required: true, message: "请填写选题名称" }]}
          >
            <Input placeholder="如：杭州餐饮品牌代运营 10 家实测对比" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="gap_type" label="缺口类型">
              <Select
                options={(meta?.gapTypes || []).map((item) => ({
                  value: item,
                  label: item,
                }))}
              />
            </Form.Item>
            <Form.Item name="question_id" label="关联监控问题">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="可选"
                options={questions.map((item) => ({
                  value: item.id,
                  label: `${item.type}｜${item.text}`,
                }))}
              />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="gap_score" label="缺口强度（0-10）">
              <InputNumber min={0} max={10} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="citable_score" label="AI 可引性（0-10）">
              <InputNumber min={0} max={10} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="business_score" label="商业价值（0-10）">
              <InputNumber min={0} max={10} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="supply_score" label="供给难度（0-10，越高越易生产）">
              <InputNumber min={0} max={10} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="platform_count" label="出现缺口的平台数">
              <InputNumber min={0} max={5} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="style_bonus" label="风格加分（0-2）">
              <InputNumber min={0} max={2} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: "CANDIDATE", label: "候选" },
                  { value: "SELECTED", label: "已选用" },
                  { value: "REJECTED", label: "已淘汰" },
                ]}
              />
            </Form.Item>
            <Form.Item name="blacklisted" label="黑名单（判 0 分淘汰）" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="选题说明、对标内容、生产要求等" />
          </Form.Item>
        </Form>
      </Modal>
      {modal}
    </>
  );
}
