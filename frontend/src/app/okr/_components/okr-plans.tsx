"use client";

import {
  App,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { useEffect, useState } from "react";
import {
  OKR_PLAN_KINDS,
  OKR_PLAN_KIND_LABELS,
  type OkrPlanView,
} from "@enterprise/contracts";
import { okrApi } from "@/api/okr";
import { contentApi } from "@/api/content";
import { Panel } from "@/components/ui/panel";
import { fmtDate } from "@/lib/datetime";
import {
  ProgressBar,
  Toolbar,
  okrError,
  planStatusTag,
  priorityTag,
  type OkrContextData,
} from "./okr-common";

const PRIORITIES = [
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
];

const SECTIONS = [
  { kind: "WEEK", title: "周计划", hint: "按设置里的周起始日归集" },
  { kind: "DAY", title: "日计划", hint: "按天归集" },
  { kind: "ADHOC", title: "日常计划", hint: "不挂周期的一次性动作" },
];

const todayStr = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const emptyPlanDraft = {
  id: 0,
  title: "",
  detail: "",
  kind: "WEEK" as (typeof OKR_PLAN_KINDS)[number],
  objectiveId: 0,
  krId: 0,
  priority: "MEDIUM",
  startDate: "",
  dueDate: "",
};

type PlanDraft = typeof emptyPlanDraft;

type GenRow = {
  selected: boolean;
  title: string;
  detail: string;
  priority: string;
  krId: number;
  objectiveId: number;
};

export function OkrPlansTab({
  ctx,
  reload,
}: {
  ctx: OkrContextData;
  reload: () => Promise<void>;
}) {
  const { message, modal } = App.useApp();
  const [plans, setPlans] = useState<OkrPlanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<PlanDraft>(emptyPlanDraft);

  const [progressRow, setProgressRow] = useState<OkrPlanView | null>(null);
  const [progressValue, setProgressValue] = useState(0);

  const [genOpen, setGenOpen] = useState<"WEEK" | "DAY" | null>(null);
  const [genRows, setGenRows] = useState<GenRow[]>([]);
  const [genNotes, setGenNotes] = useState<string[]>([]);
  const [genPeriod, setGenPeriod] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  const [scheduleRow, setScheduleRow] = useState<OkrPlanView | null>(null);
  const [schedules, setSchedules] = useState<
    NonNullable<Awaited<ReturnType<typeof contentApi.schedules>>>
  >([]);
  const [scheduleId, setScheduleId] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await okrApi.plans({
        query: { cycleId: ctx.cycle?.id ? ctx.cycle.id : undefined },
      });
      setPlans(rows ?? []);
      setError("");
    } catch (err) {
      setError(okrError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.cycle?.id]);

  const refreshAll = async () => {
    await load();
    await reload();
  };

  const objectiveTitle = (id: number) =>
    ctx.objectives.find((item) => item.id === id)?.title || "";
  const krTitle = (id: number) => {
    for (const objective of ctx.objectives) {
      const kr = objective.krs.find((item) => item.id === id);
      if (kr) return kr.title;
    }
    return "";
  };

  const openCreate = (kind: PlanDraft["kind"]) => {
    setDraft({ ...emptyPlanDraft, kind });
    setEditorOpen(true);
  };

  const openEdit = (row: OkrPlanView) => {
    setDraft({
      id: row.id,
      title: row.title,
      detail: row.detail,
      kind: (OKR_PLAN_KINDS as readonly string[]).includes(row.kind)
        ? (row.kind as PlanDraft["kind"])
        : "ADHOC",
      objectiveId: row.objectiveId,
      krId: row.krId,
      priority: row.priority,
      startDate: row.startDate ? row.startDate.slice(0, 10) : "",
      dueDate: row.dueDate ? row.dueDate.slice(0, 10) : "",
    });
    setEditorOpen(true);
  };

  const saveDraft = async () => {
    if (!draft.title.trim()) {
      message.warning("请填写计划标题");
      return;
    }
    try {
      await okrApi.savePlan({
        body: {
          id: draft.id,
          memberUserId: "",
          objectiveId: draft.objectiveId,
          krId: draft.krId,
          title: draft.title.trim(),
          detail: draft.detail.trim(),
          kind: draft.kind,
          periodKey: "",
          startDate: draft.startDate,
          dueDate: draft.dueDate,
          priority: draft.priority as "LOW" | "MEDIUM" | "HIGH",
          source: "MANUAL",
        },
      });
      message.success(draft.id ? "计划已更新" : "计划已创建");
      setEditorOpen(false);
      await refreshAll();
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const changeStatus = async (row: OkrPlanView, status: string) => {
    try {
      await okrApi.updatePlan({
        params: { id: String(row.id) },
        body: {
          status: status as "TODO" | "DOING" | "DONE" | "CANCELLED",
        },
      });
      await refreshAll();
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const saveProgress = async () => {
    if (!progressRow) return;
    try {
      await okrApi.updatePlan({
        params: { id: String(progressRow.id) },
        body: { progress: progressValue },
      });
      message.success("进度已更新");
      setProgressRow(null);
      await refreshAll();
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const removePlan = (row: OkrPlanView) => {
    modal.confirm({
      title: "删除计划",
      content: `确定删除「${row.title}」？删除后不可恢复。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await okrApi.removePlan({ params: { id: String(row.id) } });
          message.success("已删除");
          await refreshAll();
        } catch (err) {
          message.error(okrError(err));
        }
      },
    });
  };

  const generate = async (kind: "WEEK" | "DAY") => {
    setGenBusy(true);
    setGenOpen(kind);
    setGenRows([]);
    setGenNotes([]);
    try {
      const result = await okrApi.generatePlans({
        body: {
          kind,
          memberUserId: "",
          cycleId: ctx.cycle?.id || 0,
        },
      });
      if (!result) return;
      setGenPeriod(result.periodKey);
      setGenNotes(result.notes);
      setGenRows(
        result.plans.map((item) => ({
          selected: true,
          title: item.title,
          detail: item.detail,
          priority: item.priority,
          krId: item.krId,
          objectiveId: item.objectiveId,
        })),
      );
    } catch (err) {
      message.error(okrError(err));
      setGenOpen(null);
    } finally {
      setGenBusy(false);
    }
  };

  const saveGenerated = async () => {
    const chosen = genRows.filter((row) => row.selected && row.title.trim());
    if (!chosen.length) {
      message.warning("请至少勾选一条计划");
      return;
    }
    if (!genOpen) return;
    setGenBusy(true);
    try {
      for (const row of chosen) {
        await okrApi.savePlan({
          body: {
            id: 0,
            memberUserId: "",
            objectiveId: row.objectiveId,
            krId: row.krId,
            title: row.title.trim(),
            detail: row.detail,
            kind: genOpen,
            periodKey: genPeriod,
            startDate: "",
            dueDate: "",
            priority: row.priority as "LOW" | "MEDIUM" | "HIGH",
            source: "AGENT",
          },
        });
      }
      message.success(`已保存 ${chosen.length} 条计划`);
      setGenOpen(null);
      await refreshAll();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setGenBusy(false);
    }
  };

  const openSchedule = async (row: OkrPlanView) => {
    setScheduleRow(row);
    setScheduleId(row.scheduleId);
    try {
      setSchedules((await contentApi.schedules()) ?? []);
    } catch {
      setSchedules([]);
    }
  };

  const saveSchedule = async () => {
    if (!scheduleRow) return;
    try {
      await okrApi.linkPlanSchedule({
        params: { id: String(scheduleRow.id) },
        body: { scheduleId },
      });
      message.success(scheduleId ? "已关联定时任务" : "已取消关联");
      setScheduleRow(null);
      await load();
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const columns = [
    {
      title: "计划",
      dataIndex: "title",
      render: (_: unknown, row: OkrPlanView) => {
        const overdue =
          row.status !== "DONE" &&
          row.status !== "CANCELLED" &&
          Boolean(row.dueDate) &&
          row.dueDate.slice(0, 10) < todayStr();
        const objective = objectiveTitle(row.objectiveId);
        const kr = krTitle(row.krId);
        return (
          <div style={{ minWidth: 180 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span>{row.title}</span>
              {overdue ? <Tag color="red">逾期</Tag> : null}
              {row.source === "AGENT" ? <Tag>由 Agent 创建</Tag> : null}
            </div>
            {row.detail ? (
              <div className="muted text-12">{row.detail}</div>
            ) : null}
            {objective || kr ? (
              <div className="muted text-12">
                {`关联：${objective || "—"}${kr ? ` · ${kr}` : ""}`}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      title: "归期",
      dataIndex: "periodKey",
      width: 110,
      render: (value: string) => value || "—",
    },
    {
      title: "起止",
      width: 180,
      render: (_: unknown, row: OkrPlanView) =>
        row.startDate || row.dueDate
          ? `${row.startDate ? fmtDate(row.startDate) : "—"} ~ ${
              row.dueDate ? fmtDate(row.dueDate) : "—"
            }`
          : "—",
    },
    {
      title: "优先级",
      dataIndex: "priority",
      width: 80,
      render: (value: string) => priorityTag(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: string) => planStatusTag(value),
    },
    {
      title: "进度",
      width: 180,
      render: (_: unknown, row: OkrPlanView) => (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ width: 100 }}>
            <ProgressBar value={row.progress} />
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setProgressRow(row);
              setProgressValue(Math.round(row.progress));
            }}
          >
            更新
          </Button>
        </div>
      ),
    },
    {
      title: "定时任务",
      dataIndex: "scheduleId",
      width: 90,
      render: (value: number) => (value > 0 ? <Tag color="blue">已关联</Tag> : "—"),
    },
    {
      title: "操作",
      width: 260,
      render: (_: unknown, row: OkrPlanView) => (
        <Space size={4} wrap>
          {row.status === "TODO" ? (
            <Button type="link" size="small" onClick={() => void changeStatus(row, "DOING")}>
              开始
            </Button>
          ) : null}
          {row.status !== "DONE" && row.status !== "CANCELLED" ? (
            <Button type="link" size="small" onClick={() => void changeStatus(row, "DONE")}>
              完成
            </Button>
          ) : null}
          {row.status === "DONE" || row.status === "CANCELLED" ? (
            <Button type="link" size="small" onClick={() => void changeStatus(row, "DOING")}>
              重开
            </Button>
          ) : null}
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => void openSchedule(row)}>
            定时任务
          </Button>
          <Button type="link" size="small" danger onClick={() => removePlan(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const krOptions = ctx.objectives
    .filter((item) => !draft.objectiveId || item.id === draft.objectiveId)
    .flatMap((item) =>
      item.krs.map((kr) => ({
        value: kr.id,
        label: `${item.title} · ${kr.title}`,
      })),
    );

  return (
    <>
      <Toolbar
        hint={`共 ${plans.length} 条计划 · 逾期与未完成会出现在驾驶舱待办`}
      >
        <Button type="primary" onClick={() => openCreate("WEEK")}>
          新建计划
        </Button>
        <Button onClick={() => void generate("WEEK")}>生成周计划</Button>
        <Button onClick={() => void generate("DAY")}>生成日计划</Button>
      </Toolbar>

      {error ? (
        <Panel title="计划加载失败">
          <div className="muted">{error}</div>
          <Button style={{ marginTop: 8 }} onClick={() => void load()}>
            重试
          </Button>
        </Panel>
      ) : null}

      {SECTIONS.map((section) => {
        const rows = plans.filter((row) => row.kind === section.kind);
        return (
          <Panel
            key={section.kind}
            title={section.title}
            titleExtra={<span className="muted text-12">{section.hint}</span>}
            extra={
              <Button size="small" onClick={() => openCreate(section.kind as PlanDraft["kind"])}>
                新建
              </Button>
            }
          >
            <Table
              size="small"
              rowKey="id"
              loading={loading}
              dataSource={rows}
              columns={columns}
              pagination={false}
              locale={{ emptyText: "暂无计划" }}
              onRow={(row) => {
                const overdue =
                  row.status !== "DONE" &&
                  row.status !== "CANCELLED" &&
                  Boolean(row.dueDate) &&
                  row.dueDate.slice(0, 10) < todayStr();
                return overdue ? { style: { background: "#fff1f0" } } : {};
              }}
            />
          </Panel>
        );
      })}

      <Modal
        title={draft.id ? "编辑计划" : "新建计划"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void saveDraft()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={10}>
          <Input
            placeholder="计划标题，例如：拜访 5 家重点客户"
            value={draft.title}
            maxLength={200}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, title: event.target.value }))
            }
          />
          <Input.TextArea
            placeholder="说明（可选）"
            rows={3}
            maxLength={2000}
            value={draft.detail}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, detail: event.target.value }))
            }
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Select
              style={{ width: 140 }}
              value={draft.kind}
              options={OKR_PLAN_KINDS.map((kind) => ({
                value: kind,
                label: OKR_PLAN_KIND_LABELS[kind] || kind,
              }))}
              onChange={(value: PlanDraft["kind"]) =>
                setDraft((prev) => ({ ...prev, kind: value }))
              }
            />
            <Select
              style={{ flex: 1 }}
              value={draft.priority}
              options={PRIORITIES}
              onChange={(value: string) =>
                setDraft((prev) => ({ ...prev, priority: value }))
              }
            />
          </div>
          <Select
            style={{ width: "100%" }}
            placeholder="关联目标（可选）"
            allowClear
            value={draft.objectiveId || undefined}
            options={ctx.objectives.map((item) => ({
              value: item.id,
              label: item.title,
            }))}
            onChange={(value?: number) =>
              setDraft((prev) => ({
                ...prev,
                objectiveId: value || 0,
                krId:
                  prev.objectiveId === (value || 0) ? prev.krId : 0,
              }))
            }
          />
          <Select
            style={{ width: "100%" }}
            placeholder="关联 KR（可选）"
            allowClear
            value={draft.krId || undefined}
            options={krOptions}
            onChange={(value?: number) =>
              setDraft((prev) => ({ ...prev, krId: value || 0 }))
            }
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted text-12">起始</span>
            <Input
              type="date"
              value={draft.startDate}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, startDate: event.target.value }))
              }
            />
            <span className="muted text-12">截止</span>
            <Input
              type="date"
              value={draft.dueDate}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, dueDate: event.target.value }))
              }
            />
          </div>
          {draft.kind !== "ADHOC" ? (
            <div className="muted text-12">
              不填起止日期时，按设置里的周起始日自动归集到本周/当天。
            </div>
          ) : null}
        </Space>
      </Modal>

      <Modal
        title="更新进度"
        open={Boolean(progressRow)}
        onCancel={() => setProgressRow(null)}
        onOk={() => void saveProgress()}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1 }}>{progressRow?.title}</span>
          <InputNumber
            min={0}
            max={100}
            value={progressValue}
            formatter={(value) => `${value}%`}
            parser={(value) => Number(String(value).replace("%", "")) || 0}
            onChange={(value) => setProgressValue(Number(value) || 0)}
          />
        </div>
      </Modal>

      <Modal
        title={genOpen === "WEEK" ? "生成周计划" : "生成日计划"}
        open={Boolean(genOpen)}
        onCancel={() => setGenOpen(null)}
        onOk={() => void saveGenerated()}
        okText="保存所选"
        cancelText="取消"
        confirmLoading={genBusy}
        width={760}
      >
        {genPeriod ? (
          <div className="muted text-12" style={{ marginBottom: 8 }}>
            归期：{genPeriod}
          </div>
        ) : null}
        {genNotes.map((note) => (
          <div key={note} className="muted text-12">
            {note}
          </div>
        ))}
        <Table
          size="small"
          rowKey="title"
          style={{ marginTop: 8 }}
          pagination={false}
          dataSource={genRows}
          locale={{ emptyText: "没有可生成的草稿" }}
          columns={[
            {
              title: "",
              width: 40,
              render: (_: unknown, row: GenRow, index: number) => (
                <Checkbox
                  checked={row.selected}
                  onChange={(event) =>
                    setGenRows((prev) =>
                      prev.map((item, at) =>
                        at === index
                          ? { ...item, selected: event.target.checked }
                          : item,
                      ),
                    )
                  }
                />
              ),
            },
            {
              title: "标题",
              render: (_: unknown, row: GenRow, index: number) => (
                <Input
                  size="small"
                  value={row.title}
                  maxLength={200}
                  onChange={(event) =>
                    setGenRows((prev) =>
                      prev.map((item, at) =>
                        at === index
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              ),
            },
            {
              title: "优先级",
              dataIndex: "priority",
              width: 80,
              render: (value: string) => priorityTag(value),
            },
          ]}
        />
      </Modal>

      <Modal
        title="关联 Agent 定时任务"
        open={Boolean(scheduleRow)}
        onCancel={() => setScheduleRow(null)}
        onOk={() => void saveSchedule()}
        okText="保存"
        cancelText="取消"
      >
        <div className="muted text-12" style={{ marginBottom: 8 }}>
          计划：{scheduleRow?.title}
        </div>
        <Select
          style={{ width: "100%" }}
          value={scheduleId}
          onChange={(value: number) => setScheduleId(value)}
          options={[
            { value: 0, label: "不关联" },
            ...schedules.map((item) => ({
              value: item.id,
              label: item.title || `定时任务 #${item.id}`,
            })),
          ]}
        />
        <div className="muted text-12" style={{ marginTop: 8 }}>
          定时任务在「工作台 → Agent → 定时任务」里创建；这里只做关联，不新建任务。
        </div>
      </Modal>
    </>
  );
}
