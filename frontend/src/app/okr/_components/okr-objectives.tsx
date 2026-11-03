"use client";

import {
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { useMemo, useState } from "react";
import {
  OKR_CYCLE_KINDS,
  OKR_CYCLE_KIND_LABELS,
  OKR_CYCLE_STATUSES,
  OKR_CYCLE_STATUS_LABELS,
  OKR_LEVELS,
  OKR_LEVEL_LABELS,
  OKR_METRIC_SOURCES,
  OKR_METRIC_SOURCE_LABELS,
  OKR_METRIC_TYPES,
  OKR_METRIC_TYPE_LABELS,
  OKR_OBJECTIVE_STATUS_LABELS,
  OKR_VISIBILITIES,
  OKR_VISIBILITY_LABELS,
  type OkrCycleView,
} from "@enterprise/contracts";
import { okrApi } from "@/api/okr";
import { Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  KrLine,
  MemberSelect,
  ProgressRing,
  Toolbar,
  cycleName,
  cycleOption,
  emptyMetricSource,
  levelLabel,
  okrError,
  type OkrContextData,
  type OkrKr,
  type OkrMetricSourceDraft,
} from "./okr-common";

type Objective = OkrContextData["objectives"][number];
type Member = OkrContextData["members"][number];

const num = (value: number | string | null | undefined) => Number(value || 0);

function toMetricDraft(raw: Record<string, unknown>): OkrMetricSourceDraft {
  return {
    ...emptyMetricSource,
    ...(raw as Partial<OkrMetricSourceDraft>),
    filters: Array.isArray(raw.filters)
      ? (raw.filters as OkrMetricSourceDraft["filters"])
      : [],
  };
}

export function OkrObjectivesTab({
  ctx,
  reload,
  onCycleChange,
}: {
  ctx: OkrContextData;
  reload: () => Promise<void>;
  onCycleChange: (cycleId: number) => void;
}) {
  const { message, modal } = App.useApp();
  const canManage = ctx.isOwner || ctx.isManager;
  const selfKey = ctx.isOwner ? "" : ctx.me?.memberUserId || "";
  const cycle = ctx.cycle;

  const [cycleOpen, setCycleOpen] = useState(false);
  const [cycleDraft, setCycleDraft] = useState({
    id: 0,
    kind: "QUARTER",
    year: new Date().getFullYear(),
    period: 1,
    title: "",
    startDate: "",
    endDate: "",
    status: "ACTIVE",
  });

  const [objOpen, setObjOpen] = useState(false);
  const [objDraft, setObjDraft] = useState({
    id: 0,
    parentId: 0,
    level: "COMPANY",
    title: "",
    description: "",
    ownerMemberUserId: "",
    weight: 1,
    visibility: "ORG",
    status: "ACTIVE",
  });

  const [krOpen, setKrOpen] = useState(false);
  const [krDraft, setKrDraft] = useState({
    id: 0,
    objectiveId: 0,
    title: "",
    metricType: "MANUAL",
    targetValue: 100,
    currentValue: 0,
    startValue: 0,
    unit: "",
    direction: "UP",
    weight: 1,
    ownerMemberUserId: "",
  });
  const [metric, setMetric] = useState<OkrMetricSourceDraft>(emptyMetricSource);
  const [preview, setPreview] = useState<{
    value: number;
    ok: boolean;
    message: string;
    rangeStart: string;
    rangeEnd: string;
  } | null>(null);

  const [progressOpen, setProgressOpen] = useState(false);
  const [progressDraft, setProgressDraft] = useState({
    kr: null as OkrKr | null,
    currentValue: 0,
    note: "",
  });

  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<
    NonNullable<Awaited<ReturnType<typeof okrApi.progressLogs>>>
  >([]);
  const [logsTitle, setLogsTitle] = useState("");

  const [assignOpen, setAssignOpen] = useState<Objective | null>(null);
  const [assignDraft, setAssignDraft] = useState({
    memberUserIds: [] as string[],
    generatePlan: "NONE" as "NONE" | "WEEK" | "DAY",
    krTitles: "",
  });

  const [suggestOpen, setSuggestOpen] = useState<Objective | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<
    NonNullable<Awaited<ReturnType<typeof okrApi.decomposeSuggest>>>["suggestions"]
  >([]);
  const [suggestNotes, setSuggestNotes] = useState<string[]>([]);

  const [draftOpen, setDraftOpen] = useState(false);
  const [draftInput, setDraftInput] = useState({
    direction: "",
    level: "COMPANY",
    memberUserId: "",
    krCount: 3,
  });
  const [draftResult, setDraftResult] = useState<
    NonNullable<Awaited<ReturnType<typeof okrApi.draftObjective>>>["objective"] | null
  >(null);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);

  const roots = useMemo(
    () => ctx.objectives.filter((item) => !item.parentId),
    [ctx.objectives],
  );
  const membersById = useMemo(() => {
    const map = new Map<string, Member>();
    ctx.members.forEach((item) => map.set(item.memberUserId, item));
    return map;
  }, [ctx.members]);
  const averageProgress = ctx.objectives.length
    ? Math.round(
        ctx.objectives.reduce((sum, item) => sum + num(item.progress), 0) /
          ctx.objectives.length,
      )
    : 0;

  const canEditObjective = (objective: Objective) =>
    canManage || objective.ownerMemberUserId === selfKey;

  const success = async (text: string) => {
    message.success(text);
    await reload();
  };

  const openCycle = (editing?: OkrCycleView) => {
    setCycleDraft(
      editing
        ? {
            id: editing.id,
            kind: editing.kind,
            year: editing.year,
            period: editing.period,
            title: editing.title,
            startDate: editing.startDate.slice(0, 10),
            endDate: editing.endDate.slice(0, 10),
            status: editing.status,
          }
        : {
            id: 0,
            kind: "QUARTER",
            year: new Date().getFullYear(),
            period: 1,
            title: "",
            startDate: "",
            endDate: "",
            status: "ACTIVE",
          },
    );
    setCycleOpen(true);
  };

  const saveCycle = async () => {
    try {
      await okrApi.saveCycle({
        body: {
          id: cycleDraft.id,
          kind: cycleDraft.kind as "YEAR" | "QUARTER" | "MONTH",
          year: cycleDraft.year,
          period: cycleDraft.period,
          title: cycleDraft.title,
          startDate: cycleDraft.startDate,
          endDate: cycleDraft.endDate,
          status: cycleDraft.status as
            | "DRAFT"
            | "ACTIVE"
            | "REVIEW"
            | "CLOSED",
        },
      });
      setCycleOpen(false);
      await success("周期已保存");
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const closeCycle = () => {
    if (!cycle) return;
    modal.confirm({
      title: `关闭「${cycleName(cycle)}」？`,
      content: "关闭后周期内的目标与计划变为只读，且不能再次修改周期。",
      okText: "确认关闭",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await okrApi.closeCycle({ params: { id: String(cycle.id) } });
          await success("周期已关闭");
        } catch (error) {
          message.error(okrError(error));
        }
      },
    });
  };

  const openObjective = (objective?: Objective, parent?: Objective) => {
    if (objective) {
      setObjDraft({
        id: objective.id,
        parentId: objective.parentId,
        level: objective.level,
        title: objective.title,
        description: objective.description,
        ownerMemberUserId: objective.ownerMemberUserId,
        weight: objective.weight,
        visibility: objective.visibility,
        status: objective.status,
      });
    } else {
      setObjDraft({
        id: 0,
        parentId: parent?.id || 0,
        level: parent ? "PERSONAL" : "COMPANY",
        title: "",
        description: "",
        ownerMemberUserId: "",
        weight: 1,
        visibility: "ORG",
        status: "ACTIVE",
      });
    }
    setObjOpen(true);
  };

  const saveObjective = async () => {
    if (!cycle) {
      message.warning("先创建或选择一个周期");
      return;
    }
    if (!objDraft.title.trim()) {
      message.warning("请填写目标标题");
      return;
    }
    try {
      await okrApi.saveObjective({
        body: {
          ...objDraft,
          level: objDraft.level as "COMPANY" | "DEPT" | "PERSONAL",
          visibility: objDraft.visibility as "ORG" | "DEPT" | "SELF",
          status: objDraft.status as "DRAFT" | "ACTIVE" | "DONE" | "CANCELLED",
          source: "MANUAL",
          cycleId: cycle.id,
          krs: [],
        },
      });
      setObjOpen(false);
      await success("目标已保存");
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const removeObjective = (objective: Objective) => {
    modal.confirm({
      title: `删除目标「${objective.title}」？`,
      content: "目标下的子目标与关键结果会一并删除，不可恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await okrApi.removeObjective({ params: { id: String(objective.id) } });
          await success("目标已删除");
        } catch (error) {
          message.error(okrError(error));
        }
      },
    });
  };

  const openKr = (objectiveId: number, kr?: OkrKr) => {
    if (kr) {
      setKrDraft({
        id: kr.id,
        objectiveId: kr.objectiveId,
        title: kr.title,
        metricType: kr.metricType,
        targetValue: kr.targetValue,
        currentValue: kr.currentValue,
        startValue: kr.startValue,
        unit: kr.unit,
        direction: kr.direction,
        weight: kr.weight,
        ownerMemberUserId: kr.ownerMemberUserId,
      });
      setMetric(toMetricDraft(kr.metricSource || {}));
    } else {
      setKrDraft({
        id: 0,
        objectiveId,
        title: "",
        metricType: "MANUAL",
        targetValue: 100,
        currentValue: 0,
        startValue: 0,
        unit: "",
        direction: "UP",
        weight: 1,
        ownerMemberUserId: "",
      });
      setMetric({ ...emptyMetricSource });
    }
    setPreview(null);
    setKrOpen(true);
  };

  const saveKr = async () => {
    if (!krDraft.title.trim()) {
      message.warning("请填写关键结果标题");
      return;
    }
    try {
      await okrApi.saveKr({
        body: {
          ...krDraft,
          metricType: krDraft.metricType as "MANUAL" | "AUTO" | "ROLLUP",
          direction: krDraft.direction as "UP" | "DOWN",
          metricSource: krDraft.metricType === "AUTO" ? metric : undefined,
        },
      });
      setKrOpen(false);
      await success("关键结果已保存");
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const previewMetric = async () => {
    try {
      const data = await okrApi.previewMetric({
        body: { cycleId: cycle?.id || 0, metricSource: metric },
      });
      setPreview(data);
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const removeKr = (kr: OkrKr) => {
    modal.confirm({
      title: `删除关键结果「${kr.title}」？`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await okrApi.removeKr({ params: { id: String(kr.id) } });
          await success("关键结果已删除");
        } catch (error) {
          message.error(okrError(error));
        }
      },
    });
  };

  const refreshKr = async (kr: OkrKr) => {
    try {
      const result = await okrApi.refreshMetric({
        body: { krId: kr.id, cycleId: cycle?.id || 0 },
      });
      if (!result) return;
      if (result.failed > 0) message.warning(result.message);
      else message.success(result.message);
      await reload();
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const openProgress = (kr: OkrKr) => {
    setProgressDraft({ kr, currentValue: kr.currentValue, note: "" });
    setProgressOpen(true);
  };

  const saveProgress = async () => {
    if (!progressDraft.kr) return;
    try {
      await okrApi.saveKrProgress({
        params: { id: String(progressDraft.kr.id) },
        body: {
          currentValue: progressDraft.currentValue,
          note: progressDraft.note,
        },
      });
      setProgressOpen(false);
      await success("进度已更新");
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const openLogs = async (kr: OkrKr) => {
    setLogsTitle(kr.title);
    setLogs([]);
    setLogsOpen(true);
    try {
      setLogs(
        (await okrApi.progressLogs({ query: { krId: kr.id } })) ?? [],
      );
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const submitAssign = async () => {
    if (!assignOpen) return;
    if (!assignDraft.memberUserIds.length) {
      message.warning("请选择承接人");
      return;
    }
    try {
      await okrApi.assignObjective({
        params: { id: String(assignOpen.id) },
        body: {
          memberUserIds: assignDraft.memberUserIds,
          generatePlan: assignDraft.generatePlan,
          krTitles: assignDraft.krTitles
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          source: "MANUAL",
        },
      });
      setAssignOpen(null);
      await success("已拆解下发");
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const openSuggest = async (objective: Objective) => {
    setSuggestOpen(objective);
    setSuggestLoading(true);
    setSuggestions([]);
    setSuggestNotes([]);
    try {
      const data = await okrApi.decomposeSuggest({
        body: { objectiveId: objective.id, memberUserIds: [] },
      });
      if (!data) return;
      setSuggestions(data.suggestions);
      setSuggestNotes(data.notes);
    } catch (error) {
      message.error(okrError(error));
    } finally {
      setSuggestLoading(false);
    }
  };

  const applySuggestion = async (
    memberUserId: string,
    krTitles: string[],
  ) => {
    if (!suggestOpen) return;
    try {
      await okrApi.assignObjective({
        params: { id: String(suggestOpen.id) },
        body: {
          memberUserIds: [memberUserId],
          generatePlan: "NONE",
          krTitles,
          source: "AGENT",
        },
      });
      setSuggestOpen(null);
      await success("已按建议下发");
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const generateDraft = async () => {
    if (!draftInput.direction.trim()) {
      message.warning("请描述你想达成的方向");
      return;
    }
    setDraftBusy(true);
    try {
      const data = await okrApi.draftObjective({
        body: {
          cycleId: cycle?.id || 0,
          direction: draftInput.direction,
          level: draftInput.level as "COMPANY" | "DEPT" | "PERSONAL",
          memberUserId: draftInput.memberUserId,
          krCount: draftInput.krCount,
        },
      });
      if (!data) return;
      setDraftResult(data.objective);
      setDraftNotes(data.notes);
    } catch (error) {
      message.error(okrError(error));
    } finally {
      setDraftBusy(false);
    }
  };

  const saveDraftObjective = async () => {
    if (!cycle || !draftResult) return;
    try {
      await okrApi.saveObjective({
        body: {
          id: 0,
          cycleId: cycle.id,
          parentId: 0,
          level: draftResult.level as "COMPANY" | "DEPT" | "PERSONAL",
          title: draftResult.title,
          description: draftResult.description,
          ownerMemberUserId: draftResult.memberUserId,
          weight: 1,
          visibility: "ORG",
          status: "ACTIVE",
          source: "AGENT",
          krs: draftResult.krs,
        },
      });
      setDraftOpen(false);
      setDraftResult(null);
      await success("目标已创建");
    } catch (error) {
      message.error(okrError(error));
    }
  };

  const memberLabel = (memberUserId: string) => {
    if (!memberUserId) return ctx.me?.name || "账号所有者";
    return membersById.get(memberUserId)?.name || memberUserId;
  };

  const renderObjective = (objective: Objective, depth: number) => {
    const children = ctx.objectives.filter(
      (item) => item.parentId === objective.id,
    );
    const editable = canEditObjective(objective);
    return (
      <div
        key={objective.id}
        style={{ marginBottom: 16, marginLeft: depth ? 24 : 0 }}
      >
        <Panel
          title={objective.title}
          titleExtra={
            <>
              <Tag>{levelLabel(objective.level)}</Tag>
              <Tag>{OKR_OBJECTIVE_STATUS_LABELS[objective.status] || objective.status}</Tag>
              <Tag>
                {OKR_VISIBILITY_LABELS[objective.visibility] || objective.visibility}
              </Tag>
              {objective.weight !== 1 ? <Tag>权重 {objective.weight}</Tag> : null}
              {objective.source === "AGENT" ? <Tag color="purple">由 Agent 创建</Tag> : null}
            </>
          }
          extra={
            <Space wrap>
              <span className="muted text-12">
                {`承接人：${objective.ownerMemberUserId ? memberLabel(objective.ownerMemberUserId) : "账号所有者"}`}
              </span>
              <ProgressRing value={objective.progress} size={44} />
              {editable ? (
                <Button onClick={() => openObjective(objective)}>编辑</Button>
              ) : null}
              {editable ? (
                <Button onClick={() => openKr(objective.id)}>添加关键结果</Button>
              ) : null}
              {canManage ? (
                <Button
                  onClick={() => {
                    setAssignDraft({
                      memberUserIds: [],
                      generatePlan: "NONE",
                      krTitles: "",
                    });
                    setAssignOpen(objective);
                  }}
                >
                  拆解下发
                </Button>
              ) : null}
              {canManage ? (
                <Button onClick={() => void openSuggest(objective)}>
                  AI 拆解建议
                </Button>
              ) : null}
              {editable ? (
                <Button danger onClick={() => removeObjective(objective)}>
                  删除
                </Button>
              ) : null}
            </Space>
          }
        >
          {objective.description ? (
            <p className="muted" style={{ marginTop: 0 }}>
              {objective.description}
            </p>
          ) : null}
          {objective.krs.length ? (
            <div>
              {objective.krs.map((kr) => (
                <KrLine
                  key={kr.id}
                  kr={kr}
                  actions={
                    <>
                      <Button size="small" onClick={() => openProgress(kr)}>
                        进度
                      </Button>
                      <Button size="small" onClick={() => void openLogs(kr)}>
                        记录
                      </Button>
                      {editable ? (
                        <Button size="small" onClick={() => openKr(objective.id, kr)}>
                          编辑
                        </Button>
                      ) : null}
                      {kr.metricType === "AUTO" ? (
                        <Button size="small" onClick={() => void refreshKr(kr)}>
                          刷新
                        </Button>
                      ) : null}
                      {editable ? (
                        <Button size="small" danger onClick={() => removeKr(kr)}>
                          删除
                        </Button>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          ) : (
            <div className="muted text-12">还没有关键结果，点「添加关键结果」补齐衡量口径。</div>
          )}
        </Panel>
        {children.map((child) => renderObjective(child, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <Toolbar
        hint={
          cycle
            ? `${cycleName(cycle)} · ${cycle.statusLabel}`
            : "还没有周期：先新建年度 / 季度 / 月度周期"
        }
      >
        <Select
          style={{ minWidth: 220 }}
          value={cycle?.id}
          placeholder="选择周期"
          onChange={(value: number) => onCycleChange(value)}
          options={ctx.cycles.map(cycleOption)}
        />
        {ctx.isOwner ? (
          <Button type="primary" onClick={() => openCycle()}>
            新建周期
          </Button>
        ) : null}
        {ctx.isOwner && cycle && cycle.status !== "CLOSED" ? (
          <Button onClick={() => openCycle(cycle)}>编辑周期</Button>
        ) : null}
        {canManage ? (
          <Button onClick={() => openObjective()}>新建目标</Button>
        ) : null}
        {canManage ? (
          <Button
            onClick={() => {
              setDraftResult(null);
              setDraftOpen(true);
            }}
          >
            AI 起草目标
          </Button>
        ) : null}
        {ctx.isOwner && cycle && cycle.status !== "CLOSED" ? (
          <Button danger onClick={closeCycle}>
            关闭周期
          </Button>
        ) : null}
      </Toolbar>

      <StatGrid>
        <StatCard
          label="本周期目标"
          value={ctx.objectives.length}
          hint="含子目标与个人目标"
        />
        <StatCard
          label="平均完成度"
          value={`${averageProgress}%`}
          hint="目标进度的简单平均"
        />
        <StatCard
          label="关键结果"
          value={ctx.objectives.reduce((sum, item) => sum + item.krs.length, 0)}
          hint="手动 / 自动 / 汇总三类"
        />
      </StatGrid>

      {!cycle ? (
        <Panel title="目标">
          <div className="muted">
            还没有选择周期。点击「新建周期」，再在周期内建目标并拆解下发。
          </div>
        </Panel>
      ) : roots.length === 0 ? (
        <Panel title="目标">
          <div className="muted">
            本周期还没有目标。可以「新建目标」手工填写，或让「AI 起草目标」按方向生成草稿后再确认。
          </div>
        </Panel>
      ) : (
        roots.map((objective) => renderObjective(objective, 0))
      )}

      <Modal
        open={cycleOpen}
        title={cycleDraft.id ? "编辑周期" : "新建周期"}
        onCancel={() => setCycleOpen(false)}
        onOk={() => void saveCycle()}
        okText="保存"
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <div className="field-label">周期类型</div>
            <Select
              style={{ width: "100%" }}
              value={cycleDraft.kind}
              onChange={(kind: string) =>
                setCycleDraft((prev) => ({ ...prev, kind }))
              }
              options={OKR_CYCLE_KINDS.map((kind) => ({
                value: kind,
                label: OKR_CYCLE_KIND_LABELS[kind],
              }))}
              disabled={Boolean(cycleDraft.id)}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">年份</div>
              <InputNumber
                style={{ width: "100%" }}
                min={2000}
                max={2100}
                value={cycleDraft.year}
                onChange={(value) =>
                  setCycleDraft((prev) => ({ ...prev, year: num(value) }))
                }
              />
            </div>
            {cycleDraft.kind === "QUARTER" ? (
              <div style={{ flex: 1 }}>
                <div className="field-label">季度</div>
                <Select
                  style={{ width: "100%" }}
                  value={cycleDraft.period}
                  onChange={(period: number) =>
                    setCycleDraft((prev) => ({ ...prev, period }))
                  }
                  options={[1, 2, 3, 4].map((item) => ({
                    value: item,
                    label: `第 ${item} 季度`,
                  }))}
                />
              </div>
            ) : null}
            {cycleDraft.kind === "MONTH" ? (
              <div style={{ flex: 1 }}>
                <div className="field-label">月份</div>
                <Select
                  style={{ width: "100%" }}
                  value={cycleDraft.period}
                  onChange={(period: number) =>
                    setCycleDraft((prev) => ({ ...prev, period }))
                  }
                  options={Array.from({ length: 12 }, (_, index) => ({
                    value: index + 1,
                    label: `${index + 1} 月`,
                  }))}
                />
              </div>
            ) : null}
          </div>
          <div>
            <div className="field-label">名称（可留空，自动按年月生成）</div>
            <Input
              value={cycleDraft.title}
              onChange={(event) =>
                setCycleDraft((prev) => ({ ...prev, title: event.target.value }))
              }
              maxLength={120}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">开始日期（留空按自然日历）</div>
              <Input
                type="date"
                value={cycleDraft.startDate}
                onChange={(event) =>
                  setCycleDraft((prev) => ({
                    ...prev,
                    startDate: event.target.value,
                  }))
                }
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">结束日期</div>
              <Input
                type="date"
                value={cycleDraft.endDate}
                onChange={(event) =>
                  setCycleDraft((prev) => ({
                    ...prev,
                    endDate: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div>
            <div className="field-label">状态</div>
            <Select
              style={{ width: "100%" }}
              value={cycleDraft.status}
              onChange={(status: string) =>
                setCycleDraft((prev) => ({ ...prev, status }))
              }
              options={OKR_CYCLE_STATUSES.map((status) => ({
                value: status,
                label: OKR_CYCLE_STATUS_LABELS[status],
              }))}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        open={objOpen}
        title={objDraft.id ? "编辑目标" : "新建目标"}
        onCancel={() => setObjOpen(false)}
        onOk={() => void saveObjective()}
        okText="保存"
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <div className="field-label">目标标题</div>
            <Input
              value={objDraft.title}
              onChange={(event) =>
                setObjDraft((prev) => ({ ...prev, title: event.target.value }))
              }
              maxLength={200}
            />
          </div>
          <div>
            <div className="field-label">说明</div>
            <Input.TextArea
              rows={3}
              value={objDraft.description}
              onChange={(event) =>
                setObjDraft((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              maxLength={2000}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">层级</div>
              <Select
                style={{ width: "100%" }}
                value={objDraft.level}
                onChange={(level: string) =>
                  setObjDraft((prev) => ({ ...prev, level }))
                }
                options={OKR_LEVELS.map((level) => ({
                  value: level,
                  label: OKR_LEVEL_LABELS[level],
                }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">可见性</div>
              <Select
                style={{ width: "100%" }}
                value={objDraft.visibility}
                onChange={(visibility: string) =>
                  setObjDraft((prev) => ({ ...prev, visibility }))
                }
                options={OKR_VISIBILITIES.map((visibility) => ({
                  value: visibility,
                  label: OKR_VISIBILITY_LABELS[visibility],
                }))}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">上级目标</div>
              <Select
                style={{ width: "100%" }}
                value={objDraft.parentId}
                onChange={(parentId: number) =>
                  setObjDraft((prev) => ({ ...prev, parentId }))
                }
                options={[
                  { value: 0, label: "无（顶级目标）" },
                  ...ctx.objectives
                    .filter((item) => item.id !== objDraft.id)
                    .map((item) => ({ value: item.id, label: item.title })),
                ]}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">权重</div>
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                max={100}
                value={objDraft.weight}
                onChange={(value) =>
                  setObjDraft((prev) => ({ ...prev, weight: num(value) }))
                }
              />
            </div>
          </div>
          <div>
            <div className="field-label">承接人</div>
            <MemberSelect
              members={ctx.members}
              value={objDraft.ownerMemberUserId}
              onChange={(value) =>
                setObjDraft((prev) => ({
                  ...prev,
                  ownerMemberUserId: String(value || ""),
                }))
              }
              ownerName={ctx.me?.name}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <div className="field-label">状态</div>
            <Select
              style={{ width: "100%" }}
              value={objDraft.status}
              onChange={(status: string) =>
                setObjDraft((prev) => ({ ...prev, status }))
              }
              options={["DRAFT", "ACTIVE", "DONE", "CANCELLED"].map((status) => ({
                value: status,
                label: OKR_OBJECTIVE_STATUS_LABELS[status] || status,
              }))}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        open={krOpen}
        title={krDraft.id ? "编辑关键结果" : "添加关键结果"}
        onCancel={() => setKrOpen(false)}
        onOk={() => void saveKr()}
        okText="保存"
        width={640}
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <div className="field-label">标题</div>
            <Input
              value={krDraft.title}
              onChange={(event) =>
                setKrDraft((prev) => ({ ...prev, title: event.target.value }))
              }
              maxLength={200}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">度量方式</div>
              <Select
                style={{ width: "100%" }}
                value={krDraft.metricType}
                onChange={(metricType: string) =>
                  setKrDraft((prev) => ({ ...prev, metricType }))
                }
                options={OKR_METRIC_TYPES.map((type) => ({
                  value: type,
                  label: OKR_METRIC_TYPE_LABELS[type],
                }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">方向</div>
              <Select
                style={{ width: "100%" }}
                value={krDraft.direction}
                onChange={(direction: string) =>
                  setKrDraft((prev) => ({ ...prev, direction }))
                }
                options={[
                  { value: "UP", label: "越大越好" },
                  { value: "DOWN", label: "越小越好" },
                ]}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">权重</div>
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                max={100}
                value={krDraft.weight}
                onChange={(value) =>
                  setKrDraft((prev) => ({ ...prev, weight: num(value) }))
                }
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">起始值</div>
              <InputNumber
                style={{ width: "100%" }}
                value={krDraft.startValue}
                onChange={(value) =>
                  setKrDraft((prev) => ({ ...prev, startValue: num(value) }))
                }
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">当前值</div>
              <InputNumber
                style={{ width: "100%" }}
                value={krDraft.currentValue}
                onChange={(value) =>
                  setKrDraft((prev) => ({ ...prev, currentValue: num(value) }))
                }
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">目标值</div>
              <InputNumber
                style={{ width: "100%" }}
                value={krDraft.targetValue}
                onChange={(value) =>
                  setKrDraft((prev) => ({ ...prev, targetValue: num(value) }))
                }
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">单位</div>
              <Input
                value={krDraft.unit}
                onChange={(event) =>
                  setKrDraft((prev) => ({ ...prev, unit: event.target.value }))
                }
                maxLength={32}
              />
            </div>
          </div>
          <div>
            <div className="field-label">负责人</div>
            <MemberSelect
              members={ctx.members}
              value={krDraft.ownerMemberUserId}
              onChange={(value) =>
                setKrDraft((prev) => ({
                  ...prev,
                  ownerMemberUserId: String(value || ""),
                }))
              }
              ownerName={ctx.me?.name}
              style={{ width: "100%" }}
            />
          </div>
          {krDraft.metricType === "AUTO" ? (
            <div style={{ borderTop: "1px dashed #eee", paddingTop: 12 }}>
              <div className="field-label">自动统计来源</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Select
                  style={{ minWidth: 180 }}
                  value={metric.source}
                  onChange={(source: string) =>
                    setMetric((prev) => ({
                      ...prev,
                      source: source as OkrMetricSourceDraft["source"],
                      field: "",
                    }))
                  }
                  options={OKR_METRIC_SOURCES.map((source) => ({
                    value: source,
                    label: OKR_METRIC_SOURCE_LABELS[source],
                  }))}
                />
                <Select
                  style={{ minWidth: 140 }}
                  value={metric.agg}
                  onChange={(agg: string) =>
                    setMetric((prev) => ({
                      ...prev,
                      agg: agg as OkrMetricSourceDraft["agg"],
                    }))
                  }
                  options={(ctx.metricSources.find((item) => item.key === metric.source)?.aggs || ["COUNT"]).map(
                    (agg) => ({
                      value: agg,
                      label:
                        agg === "COUNT" ? "计数" : agg === "SUM" ? "求和" : "平均",
                    }),
                  )}
                />
                {metric.agg !== "COUNT" ? (
                  <Select
                    style={{ minWidth: 180 }}
                    value={metric.field || undefined}
                    placeholder="汇总字段"
                    onChange={(field: string) =>
                      setMetric((prev) => ({ ...prev, field }))
                    }
                    options={(ctx.metricSources.find((item) => item.key === metric.source)?.fields || []).map(
                      (field) => ({ value: field, label: field }),
                    )}
                  />
                ) : null}
                <Select
                  style={{ minWidth: 160 }}
                  value={metric.scope}
                  onChange={(scope: string) =>
                    setMetric((prev) => ({
                      ...prev,
                      scope: scope as OkrMetricSourceDraft["scope"],
                    }))
                  }
                  options={[
                    { value: "ACCOUNT", label: "全账号" },
                    { value: "MY_DEPT", label: "本部门" },
                    { value: "MYSELF", label: "仅本人" },
                  ]}
                />
                <Select
                  style={{ minWidth: 160 }}
                  value={metric.dateRange}
                  onChange={(dateRange: string) =>
                    setMetric((prev) => ({
                      ...prev,
                      dateRange: dateRange as OkrMetricSourceDraft["dateRange"],
                    }))
                  }
                  options={[
                    { value: "CYCLE", label: "按 KR 周期自动取区间" },
                    { value: "NONE", label: "不限时间" },
                  ]}
                />
              </div>
              {metric.source === "DATA_TABLE" ? (
                <div style={{ marginTop: 8 }}>
                  <div className="field-label">多维表格 ID</div>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    value={metric.tableId}
                    onChange={(value) =>
                      setMetric((prev) => ({ ...prev, tableId: num(value) }))
                    }
                  />
                </div>
              ) : null}
              {metric.source === "LOWCODE_ENTITY" ? (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div className="field-label">内建应用项目 ID</div>
                    <Input
                      value={metric.projectId}
                      onChange={(event) =>
                        setMetric((prev) => ({
                          ...prev,
                          projectId: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="field-label">实体 ID</div>
                    <InputNumber
                      style={{ width: "100%" }}
                      min={0}
                      value={metric.entityId}
                      onChange={(value) =>
                        setMetric((prev) => ({ ...prev, entityId: num(value) }))
                      }
                    />
                  </div>
                </div>
              ) : null}
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <Button onClick={() => void previewMetric()}>预览取数</Button>
                {preview ? (
                  <span className={preview.ok ? "muted text-12" : "text-12"}>
                    {preview.ok
                      ? `当前取数：${preview.value}${
                          preview.rangeStart
                            ? `（${preview.rangeStart} ~ ${preview.rangeEnd}）`
                            : ""
                        }`
                      : preview.message || "暂不可用"}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </Space>
      </Modal>

      <Modal
        open={progressOpen}
        title="更新进度"
        onCancel={() => setProgressOpen(false)}
        onOk={() => void saveProgress()}
        okText="保存"
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <div className="field-label">
              当前值{progressDraft.kr?.unit ? `（${progressDraft.kr.unit}）` : ""}
            </div>
            <InputNumber
              style={{ width: "100%" }}
              value={progressDraft.currentValue}
              onChange={(value) =>
                setProgressDraft((prev) => ({ ...prev, currentValue: num(value) }))
              }
            />
          </div>
          <div>
            <div className="field-label">说明（可选）</div>
            <Input.TextArea
              rows={3}
              maxLength={500}
              value={progressDraft.note}
              onChange={(event) =>
                setProgressDraft((prev) => ({ ...prev, note: event.target.value }))
              }
            />
          </div>
        </Space>
      </Modal>

      <Modal
        open={logsOpen}
        title={`进度记录 · ${logsTitle}`}
        onCancel={() => setLogsOpen(false)}
        footer={<Button onClick={() => setLogsOpen(false)}>关闭</Button>}
        width={720}
      >
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={logs}
          columns={[
            {
              title: "时间",
              dataIndex: "createdAt",
              width: 150,
              render: (value: string) => fmtDateTime(value),
            },
            {
              title: "数值变化",
              width: 160,
              render: (_: unknown, row: { before: number; after: number }) =>
                `${row.before} → ${row.after}`,
            },
            { title: "进度", dataIndex: "progress", width: 90 },
            { title: "来源", dataIndex: "source", width: 90 },
            { title: "说明", dataIndex: "note" },
          ]}
        />
      </Modal>

      <Modal
        open={Boolean(assignOpen)}
        title={`拆解下发 · ${assignOpen?.title || ""}`}
        onCancel={() => setAssignOpen(null)}
        onOk={() => void submitAssign()}
        okText="下发"
        width={640}
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <div className="field-label">承接人（可为多人）</div>
            <MemberSelect
              mode="multiple"
              members={ctx.members}
              value={assignDraft.memberUserIds}
              onChange={(value) =>
                setAssignDraft((prev) => ({
                  ...prev,
                  memberUserIds: Array.isArray(value) ? value : [],
                }))
              }
              ownerName={ctx.me?.name}
              style={{ width: "100%" }}
            />
          </div>
          {assignDraft.memberUserIds.map((memberUserId) => {
            const member = membersById.get(memberUserId);
            if (!member) return null;
            return (
              <div key={memberUserId} className="muted text-12">
                <strong>{member.name}</strong>
                {member.positions.length
                  ? ` · 岗位：${member.positions.map((item) => item.name).filter(Boolean).join("、")}`
                  : ""}
                {member.capabilities ? ` · 能力：${member.capabilities}` : ""}
              </div>
            );
          })}
          <div>
            <div className="field-label">
              为承接人生成的 KR 草稿（每行一条，可留空，承接人自行补齐）
            </div>
            <Input.TextArea
              rows={4}
              value={assignDraft.krTitles}
              onChange={(event) =>
                setAssignDraft((prev) => ({ ...prev, krTitles: event.target.value }))
              }
            />
          </div>
          <div>
            <div className="field-label">同时生成我的计划</div>
            <Select
              style={{ width: "100%" }}
              value={assignDraft.generatePlan}
              onChange={(generatePlan: "NONE" | "WEEK" | "DAY") =>
                setAssignDraft((prev) => ({ ...prev, generatePlan }))
              }
              options={[
                { value: "NONE", label: "不生成" },
                { value: "WEEK", label: "生成到周计划" },
                { value: "DAY", label: "生成到日计划" },
              ]}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        open={Boolean(suggestOpen)}
        title={`AI 拆解建议 · ${suggestOpen?.title || ""}`}
        onCancel={() => setSuggestOpen(null)}
        footer={<Button onClick={() => setSuggestOpen(null)}>关闭</Button>}
        width={760}
      >
        {suggestLoading ? <div className="muted">正在按本组织岗位与能力分析…</div> : null}
        {!suggestLoading && suggestions.length === 0 ? (
          <div className="muted">
            暂时没有可用建议。先确认本周期已有可承接的成员，并在「职员/代理人管理」补齐岗位与能力说明。
          </div>
        ) : null}
        {suggestions.map((item) => (
          <div
            key={item.memberUserId}
            style={{ borderTop: "1px dashed #eee", padding: "10px 0" }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong>{item.memberName}</strong>
              {item.department ? <Tag>{item.department}</Tag> : null}
              {item.positions.map((position, index) => (
                <Tag key={`${position.name}-${index}`}>{position.name}</Tag>
              ))}
              <Button
                style={{ marginLeft: "auto" }}
                type="primary"
                onClick={() =>
                  void applySuggestion(
                    item.memberUserId,
                    item.krs.map((kr) => kr.title),
                  )
                }
              >
                按此建议下发
              </Button>
            </div>
            {item.reason ? <div className="muted text-12">{item.reason}</div> : null}
            {item.capabilities ? (
              <div className="muted text-12">能力：{item.capabilities}</div>
            ) : null}
            {item.krs.length ? (
              <div className="text-12">
                建议 KR：{item.krs.map((kr) => kr.title).join("；")}
              </div>
            ) : null}
          </div>
        ))}
        {suggestNotes.map((note) => (
          <div key={note} className="muted text-12">
            {note}
          </div>
        ))}
      </Modal>

      <Modal
        open={draftOpen}
        title="AI 起草目标"
        onCancel={() => setDraftOpen(false)}
        onOk={() => (draftResult ? void saveDraftObjective() : void generateDraft())}
        okText={draftResult ? "保存为目标" : "生成草稿"}
        confirmLoading={draftBusy}
        width={680}
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <div className="field-label">你想达成的方向</div>
            <Input.TextArea
              rows={3}
              maxLength={500}
              value={draftInput.direction}
              onChange={(event) =>
                setDraftInput((prev) => ({ ...prev, direction: event.target.value }))
              }
              placeholder="例如：Q4 把华南区的签约金额翻倍，重点突破制造业客户"
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">层级</div>
              <Select
                style={{ width: "100%" }}
                value={draftInput.level}
                onChange={(level: string) =>
                  setDraftInput((prev) => ({ ...prev, level }))
                }
                options={OKR_LEVELS.map((level) => ({
                  value: level,
                  label: OKR_LEVEL_LABELS[level],
                }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">承接人</div>
              <MemberSelect
                members={ctx.members}
                value={draftInput.memberUserId}
                onChange={(value) =>
                  setDraftInput((prev) => ({
                    ...prev,
                    memberUserId: String(value || ""),
                  }))
                }
                ownerName={ctx.me?.name}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ width: 120 }}>
              <div className="field-label">KR 数量</div>
              <InputNumber
                style={{ width: "100%" }}
                min={2}
                max={5}
                value={draftInput.krCount}
                onChange={(value) =>
                  setDraftInput((prev) => ({ ...prev, krCount: num(value) }))
                }
              />
            </div>
          </div>
          {draftResult ? (
            <div style={{ borderTop: "1px dashed #eee", paddingTop: 12 }}>
              <div style={{ fontWeight: 600 }}>{draftResult.title}</div>
              {draftResult.description ? (
                <div className="muted text-12">{draftResult.description}</div>
              ) : null}
              {draftResult.krs.map((kr, index) => (
                <div key={`${kr.title}-${index}`} className="text-12" style={{ marginTop: 6 }}>
                  {`${index + 1}. ${kr.title}（${OKR_METRIC_TYPE_LABELS[kr.metricType] || kr.metricType}，目标 ${kr.targetValue}${kr.unit}）`}
                </div>
              ))}
            </div>
          ) : null}
          {draftNotes.map((note) => (
            <div key={note} className="muted text-12">
              {note}
            </div>
          ))}
        </Space>
      </Modal>
    </>
  );
}
