"use client";

import { App, Button, Input, Modal, Space } from "antd";
import { useEffect, useState } from "react";
import { ScheduleFields } from "@/components/schedule-fields";
import {
  EMPTY_SCHEDULE,
  scheduleBody,
  scheduleError,
  type ScheduleDraft,
} from "@/lib/schedule";
import {
  PLAN_KIND_LABEL,
  workbuddyApi,
  type PlanStep,
  type WbPlan,
  type PlanAccount,
} from "./common";
import {
  EMPTY_TARGETS,
  TargetPicker,
  resolveTargets,
  type TargetSelection,
} from "./target-select";

/** 新建计划的三个分类：与后端 PLAN_KINDS / 界面筛选同源。 */
const KINDS = ["ai", "direct", "scheduled"] as const;

const KIND_HINT: Record<string, string> = {
  ai: "先写大白话，创建后 AI 追问关键信息，收敛成目标 / 交付物 / 验收标准 / 执行步骤",
  direct: "不经过 AI：直接按任务书字段填清目标、交付物、验收标准与逐条任务，建完即为待派发任务",
  scheduled: "填好任务内容并排期，到点由系统自动派发给选定的 Agent（一次或按周期重复）",
};

type ExplicitForm = {
  title: string;
  goal: string;
  deliverable: string;
  acceptance: string;
};

const EMPTY_EXPLICIT: ExplicitForm = {
  title: "",
  goal: "",
  deliverable: "",
  acceptance: "",
};

type StepDraft = {
  open: boolean;
  /** 正在编辑第几条（null＝新增）。 */
  index: number | null;
  title: string;
  instruction: string;
};

const EMPTY_STEP: StepDraft = { open: false, index: null, title: "", instruction: "" };

/**
 * 新建计划：先选分类，再按分类填字段。
 * 「明确生成」与「定时任务」用的是同一套任务书字段（目标/交付物/验收标准/逐条任务）
 * 与同一套排期字段（scheduleType/scheduleConfig/scheduledAt），与 RPA 任务口径一致。
 */
export function CreatePlanModal({
  open,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean;
  accounts: PlanAccount[];
  onClose: () => void;
  /** 建好计划后交回调用方：AI 分类要打开详情并接着澄清，其余分类只刷新清单。 */
  onCreated: (plan: WbPlan, kind: string) => Promise<void> | void;
}) {
  const { message } = App.useApp();
  const [kind, setKind] = useState<string>("ai");
  const [aiForm, setAiForm] = useState({ title: "", rawInput: "" });
  const [explicit, setExplicit] = useState<ExplicitForm>(EMPTY_EXPLICIT);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [stepDraft, setStepDraft] = useState<StepDraft>(EMPTY_STEP);
  const [selection, setSelection] = useState<TargetSelection>(EMPTY_TARGETS);
  const [schedule, setSchedule] = useState<ScheduleDraft>({
    ...EMPTY_SCHEDULE,
    scheduleType: "scheduled",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind("ai");
    setAiForm({ title: "", rawInput: "" });
    setExplicit(EMPTY_EXPLICIT);
    setSteps([]);
    setStepDraft(EMPTY_STEP);
    setSelection(EMPTY_TARGETS);
    setSchedule({ ...EMPTY_SCHEDULE, scheduleType: "scheduled" });
  }, [open]);

  const patchExplicit = (next: Partial<ExplicitForm>) =>
    setExplicit((prev) => ({ ...prev, ...next }));
  const patchSchedule = (next: Partial<ScheduleDraft>) =>
    setSchedule((prev) => ({ ...prev, ...next }));

  const saveStep = () => {
    if (!stepDraft.instruction.trim()) {
      message.error("请填写这条任务的内容");
      return;
    }
    const row: PlanStep = {
      title: stepDraft.title.trim().slice(0, 200),
      instruction: stepDraft.instruction.trim(),
    };
    setSteps((prev) =>
      stepDraft.index === null
        ? [...prev, row]
        : prev.map((item, i) => (i === stepDraft.index ? row : item)),
    );
    setStepDraft(EMPTY_STEP);
  };

  const editStep = (index: number) => {
    setStepDraft({ open: true, index, ...steps[index] });
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    if (stepDraft.index === index) setStepDraft(EMPTY_STEP);
  };

  const submit = async () => {
    if (kind === "ai") {
      if (!aiForm.rawInput.trim()) {
        message.error("先用一句话说清你想让 Agent 做什么");
        return;
      }
    } else {
      if (!explicit.goal.trim()) {
        message.error("请填写任务目标");
        return;
      }
      if (!steps.length) {
        message.error("请至少逐条添加一条任务内容");
        return;
      }
      const scheduleProblem = kind === "scheduled" ? scheduleError(schedule) : "";
      if (scheduleProblem) {
        message.error(scheduleProblem);
        return;
      }
    }
    const { targets, error } =
      kind === "ai" ? { targets: [], error: "" } : resolveTargets(accounts, selection);
    if (error) {
      message.error(error);
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> =
        kind === "ai"
          ? { kind, title: aiForm.title.trim(), rawInput: aiForm.rawInput.trim() }
          : {
              kind,
              title: explicit.title.trim(),
              goal: explicit.goal.trim(),
              deliverable: explicit.deliverable.trim(),
              acceptance: explicit.acceptance.trim(),
              steps,
              targets,
              ...(kind === "scheduled" ? scheduleBody(schedule) : {}),
            };
      const plan = await workbuddyApi.createPlan(body);
      onClose();
      await onCreated(plan, kind);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const okText = busy
    ? "创建中"
    : kind === "ai"
      ? "创建并和 AI 聊"
      : kind === "scheduled"
        ? "创建定时计划"
        : "创建并生成任务";

  return (
    <Modal
      open={open}
      title="新建计划"
      width={760}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={okText}
      cancelText="取消"
      confirmLoading={busy}
      destroyOnHidden
    >
      <div className="tool-group" style={{ marginBottom: 16 }}>
        {KINDS.map((value) => (
          <button
            key={value}
            type="button"
            className={`tool-card${kind === value ? " tool-card-active" : ""}`}
            onClick={() => setKind(value)}
          >
            <span className="tool-name">{PLAN_KIND_LABEL[value]}</span>
            <span className="tool-hint">{KIND_HINT[value]}</span>
          </button>
        ))}
      </div>

      {kind === "ai" ? (
        <div className="data-table-form">
          <label
            className="data-table-form-item"
            style={{ gridColumn: "1 / -1" }}
          >
            <span className="data-table-form-label">计划标题</span>
            <Input
              value={aiForm.title}
              maxLength={200}
              placeholder="留空＝从描述里自动截取"
              onChange={(event) =>
                setAiForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </label>
          <label
            className="data-table-form-item"
            style={{ gridColumn: "1 / -1" }}
          >
            <span className="data-table-form-label">
              你想让 Agent 做什么<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input.TextArea
              rows={5}
              value={aiForm.rawInput}
              maxLength={20000}
              placeholder="用大白话写，例如：把这个月天猫上 30 个竞品的价格、满减、赠品整理成一张对比表，标出比我们低价的，周五下班前给我"
              onChange={(event) =>
                setAiForm((prev) => ({ ...prev, rawInput: event.target.value }))
              }
            />
          </label>
        </div>
      ) : (
        <>
          <div className="data-table-form">
            <label
              className="data-table-form-item"
              style={{ gridColumn: "1 / -1" }}
            >
              <span className="data-table-form-label">计划标题</span>
              <Input
                value={explicit.title}
                maxLength={200}
                placeholder="留空＝从目标里自动截取"
                onChange={(event) => patchExplicit({ title: event.target.value })}
              />
            </label>
            <label
              className="data-table-form-item"
              style={{ gridColumn: "1 / -1" }}
            >
              <span className="data-table-form-label">
                任务目标<b style={{ color: "var(--danger)" }}> *</b>
              </span>
              <Input.TextArea
                rows={2}
                value={explicit.goal}
                maxLength={2000}
                placeholder="要达成什么，例如：整理本月 30 个竞品价格对比表并标出低价项"
                onChange={(event) => patchExplicit({ goal: event.target.value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">交付物</span>
              <Input
                value={explicit.deliverable}
                maxLength={2000}
                placeholder="例如：一张 xlsx 对比表 + 一段结论"
                onChange={(event) =>
                  patchExplicit({ deliverable: event.target.value })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">验收标准</span>
              <Input
                value={explicit.acceptance}
                maxLength={2000}
                placeholder="例如：30 个竞品全覆盖，缺一个不算完成"
                onChange={(event) =>
                  patchExplicit({ acceptance: event.target.value })
                }
              />
            </label>
          </div>

          <div className="ent-sub-title" style={{ marginTop: 16 }}>
            {`任务内容（逐条添加，共 ${steps.length} 条）`}
          </div>
          <div className="text-12 muted" style={{ marginBottom: 8 }}>
            一次只填一条，保存后可继续添加下一条；每条任务都会单独派发给 Agent。
          </div>
          {steps.length ? (
            <Space
              orientation="vertical"
              size={6}
              style={{ width: "100%", marginBottom: 10 }}
            >
              {steps.map((row, index) => (
                <div
                  key={`${row.title}-${index}`}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{row.title || `第 ${index + 1} 步`}</b>
                    <div className="text-12 muted">{row.instruction}</div>
                  </div>
                  <Space size={4}>
                    <Button onClick={() => editStep(index)}>
                      编辑
                    </Button>
                    <Button danger onClick={() => removeStep(index)}>
                      删除
                    </Button>
                  </Space>
                </div>
              ))}
            </Space>
          ) : null}

          {stepDraft.open ? (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <div className="data-table-form">
                <label className="data-table-form-item">
                  <span className="data-table-form-label">任务标题</span>
                  <Input
                    value={stepDraft.title}
                    maxLength={200}
                    placeholder="留空＝自动按「第 N 步」"
                    onChange={(event) =>
                      setStepDraft((prev) => ({ ...prev, title: event.target.value }))
                    }
                  />
                </label>
                <label
                  className="data-table-form-item"
                  style={{ gridColumn: "1 / -1" }}
                >
                  <span className="data-table-form-label">
                    任务内容<b style={{ color: "var(--danger)" }}> *</b>
                  </span>
                  <Input.TextArea
                    rows={3}
                    value={stepDraft.instruction}
                    maxLength={8000}
                    placeholder="这一步要做什么，写成 Agent 能直接执行的一句话"
                    onChange={(event) =>
                      setStepDraft((prev) => ({
                        ...prev,
                        instruction: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <Space size={8} style={{ marginTop: 8 }}>
                <Button type="primary" onClick={saveStep}>
                  {stepDraft.index === null ? "保存这条" : "保存修改"}
                </Button>
                <Button onClick={() => setStepDraft(EMPTY_STEP)}>取消</Button>
              </Space>
            </div>
          ) : (
            <Button
              type="primary"
              ghost
              style={{ marginBottom: 10 }}
              onClick={() => setStepDraft({ ...EMPTY_STEP, open: true })}
            >
              ＋ 添加任务
            </Button>
          )}

          <div className="ent-sub-title" style={{ marginTop: 16 }}>
            执行与排期
          </div>
          {kind === "scheduled" ? (
            <div className="data-table-form" style={{ marginBottom: 12 }}>
              <ScheduleFields draft={schedule} onChange={patchSchedule} allowOnce={false} />
            </div>
          ) : null}
          <TargetPicker
            accounts={accounts}
            label="Workbuddy Enterprise 账号（可多选，最多 10 个；多账号时步骤轮流分配）"
            value={selection}
            onChange={setSelection}
          />
        </>
      )}
    </Modal>
  );
}
