"use client";

import {
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  OKR_DECOMPOSITION_STATUS_LABELS,
  OKR_OPTION_LABELS,
  type OkrBriefView,
  type OkrDecompositionView,
  type OkrTaskLinkView,
} from "@enterprise/contracts";
import { okrApi } from "@/api/okr";
import { projectApi } from "@/api/project";
import { Panel } from "@/components/ui/panel";
import {
  MemberSelect,
  Toolbar,
  levelLabel,
  okrError,
  type OkrContextData,
} from "./okr-common";

type DialogTurn = NonNullable<
  Awaited<ReturnType<typeof okrApi.dialogTurns>>
>[number];
type DialogResult = NonNullable<
  Awaited<ReturnType<typeof okrApi.sendDialog>>
>;
type Assessment = NonNullable<
  Awaited<ReturnType<typeof okrApi.assessmentPreview>>
>;
type Question = DialogResult["questions"][number];
type ProjectRow = NonNullable<
  Awaited<ReturnType<typeof projectApi.projects>>
>["list"][number];
type TaskRow = NonNullable<
  Awaited<ReturnType<typeof projectApi.tasks>>
>["list"][number];

type OptionKey = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

const statusColor = (status: string) =>
  status === "PASS" ? "green" : status === "WARN" ? "gold" : "red";

const checkLabel = (status: string) =>
  status === "PASS" ? "通过" : status === "WARN" ? "提醒" : "不通过";

const confidenceLabel: Record<string, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
};

function structuredOf(turn: DialogTurn) {
  const structured = turn.structured as {
    questions?: Question[];
    assumptions?: string[];
    risks?: Array<{ risk: string; impact?: string; mitigation?: string }>;
    readyToDecompose?: boolean;
    mode?: string;
  };
  return structured || {};
}

/** 最近一条 AI 回复里的追问清单；没有就回空数组。 */
function latestQuestionsOf(turns: DialogTurn[]): Question[] {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role !== "ASSISTANT") continue;
    return structuredOf(turn).questions ?? [];
  }
  return [];
}

function OptionCard({
  row,
  selected,
  onSelect,
}: {
  row: OkrDecompositionView;
  selected: boolean;
  onSelect: () => void;
}) {
  const payload = row.payload;
  const krCount = payload.objectives.reduce(
    (sum, objective) => sum + objective.krs.length,
    0,
  );
  const hours = payload.tasks.reduce(
    (sum, task) => sum + task.estimateHours,
    0,
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "left",
        width: "100%",
        padding: 12,
        marginBottom: 8,
        borderRadius: 10,
        cursor: "pointer",
        border: selected
          ? "1px solid var(--brand, #1677ff)"
          : "1px solid var(--border, #eee)",
        background: selected ? "var(--brand-soft, #f0f7ff)" : "transparent",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <strong>
          {OKR_OPTION_LABELS[row.optionKey] || row.optionKey} · v{row.version}
        </strong>
        <Tag color={row.mode === "LLM" ? "blue" : "default"}>
          {row.mode === "LLM" ? "AI 生成" : "规则兜底"}
        </Tag>
        <Tag>{OKR_DECOMPOSITION_STATUS_LABELS[row.status] || row.status}</Tag>
      </div>
      <div className="muted text-12" style={{ marginTop: 6 }}>
        置信度 {confidenceLabel[payload.confidence] || payload.confidence} ·
        目标 {payload.objectives.length} / KR {krCount} / 任务{" "}
        {payload.tasks.length} · 估时 {hours}h
      </div>
      <div className="muted text-12" style={{ marginTop: 2 }}>
        {payload.summary || "（无摘要）"}
      </div>
    </button>
  );
}

export function OkrDecompositionTab({
  ctx,
  initialBriefId,
  onBriefsLoaded,
  onCommitted,
}: {
  ctx: OkrContextData;
  initialBriefId?: number;
  onBriefsLoaded?: (rows: OkrBriefView[]) => void;
  onCommitted?: () => Promise<void>;
}) {
  const { message, modal } = App.useApp();
  const [briefs, setBriefs] = useState<OkrBriefView[]>([]);
  const [briefId, setBriefId] = useState(initialBriefId || 0);
  const [turns, setTurns] = useState<DialogTurn[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [decompositions, setDecompositions] = useState<OkrDecompositionView[]>([]);
  const [selectedId, setSelectedId] = useState(0);
  const [simulating, setSimulating] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState(0);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [commitResult, setCommitResult] = useState<{
    projectId: number;
    tasks: number;
    objectives: number;
  } | null>(null);

  const [memberKey, setMemberKey] = useState("");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [links, setLinks] = useState<OkrTaskLinkView[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkObjectiveId, setLinkObjectiveId] = useState(0);
  const [linkKrId, setLinkKrId] = useState(0);
  const [linkTaskId, setLinkTaskId] = useState(0);
  const [linkWeight, setLinkWeight] = useState(1);
  const [linkSaving, setLinkSaving] = useState(false);

  const brief = briefs.find((item) => item.id === briefId) || null;
  const selected =
    decompositions.find((item) => item.id === selectedId) || null;

  const loadBriefs = useCallback(async () => {
    try {
      const rows = (await okrApi.briefs({ query: {} })) ?? [];
      setBriefs(rows);
      onBriefsLoaded?.(rows);
      const next =
        rows.find((row) => row.id === briefId) ||
        rows.find((row) => row.status !== "CLOSED") ||
        rows[0];
      if (!briefId && next) setBriefId(next.id);
    } catch (err) {
      message.error(okrError(err));
    }
  }, [briefId, message, onBriefsLoaded]);

  useEffect(() => {
    void loadBriefs();
    // 目标书只在进入页签时加载一次，后续由操作主动刷新
  }, [loadBriefs]);

  const loadWork = useCallback(async (id: number) => {
    if (!id) return;
    try {
      const [turnRows, plans] = await Promise.all([
        okrApi.dialogTurns({ params: { id: String(id) } }),
        okrApi.decompositions({ params: { id: String(id) } }),
      ]);
      setTurns(turnRows ?? []);
      setDecompositions(plans ?? []);
      const draft = (plans ?? []).find((row) => row.status === "DRAFT");
      setSelectedId((current) =>
        (plans ?? []).some((row) => row.id === current)
          ? current
          : draft?.id || 0,
      );
    } catch (err) {
      message.error(okrError(err));
    }
  }, [message]);

  useEffect(() => {
    setAnswers({});
    setMessageText("");
    setCommitResult(null);
    setAssessment(null);
    void loadWork(briefId);
  }, [briefId, loadWork]);

  const loadLinks = useCallback(async () => {
    try {
      setLinks((await okrApi.taskLinks({ query: {} })) ?? []);
    } catch (err) {
      message.error(okrError(err));
    }
  }, [message]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const latestQuestions = latestQuestionsOf(turns);

  const send = async () => {
    if (!briefId) return;
    setSending(true);
    try {
      const result = await okrApi.sendDialog({
        params: { id: String(briefId) },
        body: { message: messageText.trim(), answers },
      });
      if (!result) throw new Error("接口返回为空");
      setTurns(result.turns);
      setAnswers({});
      setMessageText("");
      message.success(
        result.mode === "LLM" ? "AI 已回复" : "已用规则模式回复",
      );
      await loadBriefs();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setSending(false);
    }
  };

  const generate = async (forceRule: boolean, optionKey?: string) => {
    if (!briefId) return;
    setGenerating(true);
    try {
      const rows =
        (await okrApi.generateDecomposition({
          params: { id: String(briefId) },
          body: {
            ...(optionKey
              ? { optionKey: optionKey as OptionKey }
              : {}),
            forceRule,
          },
        })) ?? [];
      setDecompositions(rows);
      setSelectedId(rows[rows.length - 1]?.id || 0);
      message.success(
        forceRule ? "已生成规则兜底方案" : `已生成 ${rows.length} 套候选方案`,
      );
      await loadBriefs();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setGenerating(false);
    }
  };

  const simulate = async () => {
    if (!selected) return;
    setSimulating(true);
    try {
      const row = await okrApi.simulateDecomposition({
        params: { id: String(selected.id) },
      });
      if (!row) throw new Error("接口返回为空");
      setDecompositions((prev) =>
        prev.map((item) => (item.id === row.id ? row : item)),
      );
      message.success(row.simulation?.feasible ? "模拟通过" : "模拟发现风险");
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setSimulating(false);
    }
  };

  const openCommit = async () => {
    if (!selected) return;
    setProjectName(brief?.title || "");
    setProjectId(0);
    setCommitOpen(true);
    try {
      const data = await projectApi.projects({ query: { page: 1, pageSize: 200 } });
      setProjects(data?.list ?? []);
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const commit = async () => {
    if (!selected) return;
    setCommitting(true);
    try {
      const result = await okrApi.commitDecomposition({
        params: { id: String(selected.id) },
        body: {
          confirmed: true,
          createProject: projectId === 0,
          projectId,
          projectName: projectName.trim(),
        },
      });
      if (!result) throw new Error("接口返回为空");
      setCommitOpen(false);
      setCommitResult({
        projectId: result.projectId,
        tasks: result.tasks.length,
        objectives: result.objectives.length,
      });
      message.success("已确认落库：目标、KR、任务与个人 OKR 已生成");
      await loadWork(briefId);
      await loadBriefs();
      await loadLinks();
      if (onCommitted) await onCommitted();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setCommitting(false);
    }
  };

  const loadAssessment = async (key: string) => {
    setMemberKey(key);
    try {
      const data = await okrApi.assessmentPreview({
        query: {
          ...(ctx.cycle?.id ? { cycleId: ctx.cycle.id } : {}),
          ...(key ? { memberUserId: key } : {}),
        },
      });
      setAssessment(data ?? null);
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const openLink = async () => {
    setLinkObjectiveId(0);
    setLinkKrId(0);
    setLinkTaskId(0);
    setLinkWeight(1);
    setLinkOpen(true);
    try {
      const data = await projectApi.tasks({ query: { page: 1, pageSize: 200 } });
      setTasks(data?.list ?? []);
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const saveLink = async () => {
    if (!linkObjectiveId || !linkTaskId) {
      message.warning("请选择目标与任务");
      return;
    }
    setLinkSaving(true);
    try {
      await okrApi.saveTaskLink({
        body: {
          id: 0,
          objectiveId: linkObjectiveId,
          krId: linkKrId,
          taskId: linkTaskId,
          weight: linkWeight,
          targetValue: 0,
          acceptance: [],
          ownerMemberUserId: "",
        },
      });
      message.success("任务已关联");
      setLinkOpen(false);
      await loadLinks();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setLinkSaving(false);
    }
  };

  const removeLink = (row: OkrTaskLinkView) => {
    modal.confirm({
      title: "取消任务关联",
      content: `确认取消「${row.taskTitle || row.taskId}」与当前 KR 的关联？`,
      okText: "取消关联",
      okButtonProps: { danger: true },
      cancelText: "返回",
      onOk: async () => {
        try {
          await okrApi.removeTaskLink({ params: { id: String(row.id) } });
          await loadLinks();
        } catch (err) {
          message.error(okrError(err));
        }
      },
    });
  };

  const linkObjective =
    ctx.objectives.find((item) => item.id === linkObjectiveId) || null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Panel
        title="AI 拆解"
        titleExtra={
          <span className="muted text-12">
            目标书 → 互动澄清 → 多套候选 → 容量/预算/工期模拟 → 人工确认落库
          </span>
        }
        extra={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Select
              style={{ width: 300 }}
              value={briefId || undefined}
              placeholder="选择目标书"
              options={briefs.map((item) => ({
                value: item.id,
                label: `${item.title}（${
                  item.status === "COMMITTED" ? "已落库" : "待推进"
                }）`,
              }))}
              onChange={(value) => setBriefId(Number(value))}
            />
            <Button onClick={() => void loadBriefs()}>刷新</Button>
          </div>
        }
      >
        {!brief ? (
          <div className="muted">请先在「目标书」页签创建目标书。</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            <div>{brief.businessGoal || "（未填写总体业务目标）"}</div>
            <div className="muted text-12">
              {brief.scopeWhat || "未填写范围"} · {brief.startDate || "?"} ~{" "}
              {brief.endDate || "?"} · 预算 {brief.budgetAmount}{" "}
              {brief.currency}
            </div>
            {brief.readiness.blockers.length ? (
              <div className="text-12" style={{ color: "var(--danger, #cf1322)" }}>
                待补：{brief.readiness.blockers.join("；")}
              </div>
            ) : null}
            {brief.readiness.warnings.length ? (
              <div className="muted text-12">
                提醒：{brief.readiness.warnings.join("；")}
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {brief ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
              gap: 12,
            }}
          >
            <Panel
              title="互动澄清"
              titleExtra={
                <span className="muted text-12">
                  每轮最多 5 个问题；回答后点「发送」
                </span>
              }
            >
              <div
                style={{
                  maxHeight: 320,
                  overflowY: "auto",
                  display: "grid",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                {turns.length === 0 ? (
                  <div className="muted text-12">
                    还没有对话。先发一句话说明你最想达成的结果，AI 会指出还缺什么。
                  </div>
                ) : null}
                {turns.map((turn) => {
                  const assistant = turn.role === "ASSISTANT";
                  return (
                    <div
                      key={turn.id}
                      style={{
                        justifySelf: assistant ? "start" : "end",
                        maxWidth: "88%",
                        padding: "8px 10px",
                        borderRadius: 10,
                        background: assistant
                          ? "var(--panel-soft, #f6f8fa)"
                          : "var(--brand-soft, #f0f7ff)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      <div className="text-12 muted" style={{ marginBottom: 2 }}>
                        {assistant ? "AI 顾问" : "我"}
                      </div>
                      <div>{turn.content}</div>
                    </div>
                  );
                })}
              </div>

              {latestQuestions.length ? (
                <div
                  style={{
                    border: "1px dashed var(--border, #ddd)",
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 10,
                  }}
                >
                  <div className="muted text-12" style={{ marginBottom: 6 }}>
                    待澄清问题（可只回答需要的项）
                  </div>
                  {latestQuestions.map((question) => (
                    <div key={question.key} style={{ marginBottom: 8 }}>
                      <div className="text-12">
                        {question.question}
                        {question.required ? (
                          <Tag color="red" style={{ marginLeft: 6 }}>
                            必答
                          </Tag>
                        ) : null}
                      </div>
                      {question.why ? (
                        <div className="muted text-12">{question.why}</div>
                      ) : null}
                      <Input
                        value={answers[question.key] || ""}
                        placeholder={question.defaultValue || "填写回答"}
                        onChange={(event) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [question.key]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <Input.TextArea
                rows={2}
                value={messageText}
                placeholder="补充说明，例如：目标客户是华东区制造业，预算 80 万"
                onChange={(event) => setMessageText(event.target.value)}
              />
              <Toolbar>
                <Button
                  type="primary"
                  loading={sending}
                  onClick={() => void send()}
                >
                  发送
                </Button>
                <span className="muted text-12">
                  AI 不可用时会自动用规则模式回复，并明确标注。
                </span>
              </Toolbar>
            </Panel>

            <Panel
              title="拆解方案"
              titleExtra={
                <span className="muted text-12">
                  生成 3 套对比；确认前都只是候选
                </span>
              }
            >
              <Toolbar>
                <Button
                  type="primary"
                  loading={generating}
                  onClick={() => void generate(false)}
                >
                  生成三套方案
                </Button>
                <Button
                  loading={generating}
                  onClick={() => void generate(true)}
                >
                  规则兜底
                </Button>
              </Toolbar>
              {decompositions.length === 0 ? (
                <div className="muted text-12">还没有方案。</div>
              ) : (
                decompositions.map((row) => (
                  <OptionCard
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId}
                    onSelect={() => setSelectedId(row.id)}
                  />
                ))
              )}
            </Panel>
          </div>

          {selected ? (
            <Panel
              title={`方案详情 · ${
                OKR_OPTION_LABELS[selected.optionKey] || selected.optionKey
              }`}
              extra={
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    loading={simulating}
                    disabled={selected.status !== "DRAFT"}
                    onClick={() => void simulate()}
                  >
                    模拟校验
                  </Button>
                  <Button
                    type="primary"
                    disabled={selected.status !== "DRAFT"}
                    onClick={() => void openCommit()}
                  >
                    确认落库
                  </Button>
                </div>
              }
            >
              <div className="muted text-12" style={{ marginBottom: 8 }}>
                {selected.payload.summary}
              </div>
              {selected.payload.objectives.map((objective) => (
                <div
                  key={objective.key}
                  style={{
                    border: "1px solid var(--border, #eee)",
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Tag color="blue">{levelLabel(objective.level)}</Tag>
                    <strong>{objective.title}</strong>
                    <span className="muted text-12">
                      {objective.ownerName || "账号负责人"}
                    </span>
                  </div>
                  {objective.krs.map((kr) => (
                    <div key={kr.key} className="text-12" style={{ marginTop: 6 }}>
                      · {kr.title}：{kr.baseline} → {kr.target} {kr.unit}
                      {kr.quality.ok ? null : (
                        <span style={{ color: "var(--danger, #cf1322)" }}>
                          （{kr.quality.issues.join("；")}）
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <div className="muted text-12" style={{ marginTop: 8 }}>
                任务 {selected.payload.tasks.length} 个 · 内部成本{" "}
                {selected.payload.cost.internalCost} · 外部成本{" "}
                {selected.payload.cost.externalCost} · 工时{" "}
                {selected.payload.cost.laborHours}h
              </div>
              {selected.payload.assumptions.length ? (
                <div className="muted text-12">
                  假设：{selected.payload.assumptions.join("；")}
                </div>
              ) : null}
              {selected.payload.risks.length ? (
                <div className="muted text-12">
                  风险：
                  {selected.payload.risks
                    .map((risk) => `${risk.risk}（${risk.mitigation}）`)
                    .join("；")}
                </div>
              ) : null}
              {selected.simulation ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    模拟结果：
                    {selected.simulation.feasible ? "可执行" : "存在硬约束冲突"}
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    {selected.simulation.checks.map((check) => (
                      <div
                        key={check.key}
                        style={{ display: "flex", gap: 8, alignItems: "center" }}
                      >
                        <Tag color={statusColor(check.status)}>
                          {checkLabel(check.status)}
                        </Tag>
                        <span className="text-12">{check.label}</span>
                        <span className="muted text-12">{check.detail}</span>
                      </div>
                    ))}
                  </div>
                  <div className="muted text-12" style={{ marginTop: 8 }}>
                    人力：
                    {selected.simulation.capacity
                      .map((row) => `${row.name} ${row.load}%`)
                      .join("、") || "无"}
                    ；预算：计划 {selected.simulation.budget.planned} / 剩余{" "}
                    {selected.simulation.budget.remaining}；工期{" "}
                    {selected.simulation.timeline.criticalDays} /{" "}
                    {selected.simulation.timeline.deadlineDays} 天
                  </div>
                </div>
              ) : null}
            </Panel>
          ) : null}

          {commitResult ? (
            <Panel title="落库结果">
              <div className="text-12">
                已生成 {commitResult.objectives} 个目标、{commitResult.tasks}{" "}
                个任务，写入项目 #{commitResult.projectId}。任务已带验收标准与考核权重，
                个人 OKR 已按承接工时拆分。
              </div>
            </Panel>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 12,
            }}
          >
            <Panel
              title="考核预览"
              titleExtra={
                <span className="muted text-12">
                  KR 进度 70% + 任务状态 30%，证据来自任务验收
                </span>
              }
              extra={
                <div style={{ display: "flex", gap: 8 }}>
                  <MemberSelect
                    members={ctx.members}
                    ownerName={ctx.me?.name || "账号所有者"}
                    value={memberKey}
                    onChange={(value) =>
                      void loadAssessment(String(value || ""))
                    }
                    placeholder="选择成员"
                  />
                  <Button onClick={() => void loadAssessment(memberKey)}>
                    刷新
                  </Button>
                </div>
              }
            >
              {!assessment ? (
                <div className="muted text-12">
                  选择成员后查看任务/KR 证据与折算得分。
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                    <span>
                      OKR 得分 <strong>{assessment.okrScore}</strong>
                    </span>
                    <span>
                      KR 得分 <strong>{assessment.krScore}</strong>
                    </span>
                    <span>
                      任务得分 <strong>{assessment.taskScore}</strong>
                    </span>
                  </div>
                  <Table
                    rowKey="taskId"
                    size="small"
                    pagination={false}
                    dataSource={assessment.items}
                    columns={[
                      {
                        title: "任务",
                        dataIndex: "taskTitle",
                        render: (value: string, row: Assessment["items"][number]) => (
                          <div>
                            <div>{value || `任务 #${row.taskId}`}</div>
                            <div className="muted text-12">
                              验收 {row.acceptanceDone}/{row.acceptanceTotal}
                            </div>
                          </div>
                        ),
                      },
                      { title: "权重", dataIndex: "weight", width: 70 },
                      {
                        title: "状态",
                        dataIndex: "status",
                        width: 90,
                      },
                    ]}
                  />
                  {assessment.notes.length ? (
                    <div className="muted text-12" style={{ marginTop: 6 }}>
                      {assessment.notes.join("；")}
                    </div>
                  ) : null}
                </div>
              )}
            </Panel>

            <Panel
              title="任务关联"
              titleExtra={
                <span className="muted text-12">
                  手动把已有任务挂到目标/KR，参与考核
                </span>
              }
              extra={
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={() => void openLink()}>新增关联</Button>
                  <Button onClick={() => void loadLinks()}>刷新</Button>
                </div>
              }
            >
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={links}
                columns={[
                  {
                    title: "任务",
                    dataIndex: "taskTitle",
                    render: (value: string, row: OkrTaskLinkView) => (
                      <div>
                        <div>{value || `任务 #${row.taskId}`}</div>
                        <div className="muted text-12">
                          目标 #{row.objectiveId} · KR #{row.krId} · 权重{" "}
                          {row.weight}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "操作",
                    width: 90,
                    render: (_: unknown, row: OkrTaskLinkView) => (
                      <Button
                        size="small"
                        danger
                        type="text"
                        onClick={() => removeLink(row)}
                      >
                        取消关联
                      </Button>
                    ),
                  },
                ]}
              />
            </Panel>
          </div>
        </>
      ) : null}

      <Modal
        title="确认落库"
        open={commitOpen}
        onCancel={() => setCommitOpen(false)}
        onOk={() => void commit()}
        okText="确认创建"
        cancelText="返回"
        confirmLoading={committing}
        destroyOnHidden
      >
        <div className="muted text-12" style={{ marginBottom: 10 }}>
          确认后将创建目标、KR、任务与个人 OKR，并写入项目看板；人工闸门不会被跳过。
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <Select
            style={{ width: "100%" }}
            value={projectId}
            options={[
              { value: 0, label: "新建项目（用目标书标题命名）" },
              ...projects.map((project) => ({
                value: project.id,
                label: `关联已有项目：${project.name}`,
              })),
            ]}
            onChange={(value) => setProjectId(Number(value) || 0)}
          />
          {projectId === 0 ? (
            <Input
              value={projectName}
              maxLength={200}
              placeholder="项目名称"
              onChange={(event) => setProjectName(event.target.value)}
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        title="新增任务关联"
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        onOk={() => void saveLink()}
        okText="关联"
        cancelText="取消"
        confirmLoading={linkSaving}
        destroyOnHidden
      >
        <div style={{ display: "grid", gap: 8 }}>
          <Select
            style={{ width: "100%" }}
            value={linkObjectiveId || undefined}
            placeholder="选择目标"
            options={ctx.objectives.map((objective) => ({
              value: objective.id,
              label: objective.title,
            }))}
            onChange={(value) => {
              setLinkObjectiveId(Number(value));
              setLinkKrId(0);
            }}
          />
          <Select
            style={{ width: "100%" }}
            value={linkKrId || undefined}
            placeholder="选择 KR（可选）"
            allowClear
            options={(linkObjective?.krs || []).map((kr) => ({
              value: kr.id,
              label: kr.title,
            }))}
            onChange={(value) => setLinkKrId(Number(value) || 0)}
          />
          <Select
            style={{ width: "100%" }}
            value={linkTaskId || undefined}
            placeholder="选择任务"
            showSearch
            optionFilterProp="label"
            options={tasks.map((task) => ({
              value: task.id,
              label: `#${task.id} ${task.title}`,
            }))}
            onChange={(value) => setLinkTaskId(Number(value))}
          />
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            max={100}
            value={linkWeight}
            prefix="权重"
            onChange={(value) => setLinkWeight(Number(value) || 0)}
          />
        </div>
      </Modal>
    </div>
  );
}
