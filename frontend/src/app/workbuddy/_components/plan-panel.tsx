"use client";

import { App, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { nextRunText, scheduleText } from "@/lib/schedule";
import { ClarifyDrawer } from "./clarify-drawer";
import { CreatePlanModal } from "./create-plan-modal";
import {
  PLAN_KIND_LABEL,
  PLAN_KIND_OPTIONS,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_OPTIONS,
  STRATEGY_LABEL,
  TASK_STATUS_LABEL,
  planHint,
  planStatusColor,
  taskStatusColor,
  targetText,
  workbuddyApi,
  type DispatchTarget,
  type PlanAccount,
  type WbLlmSetting,
  type WbPlan,
  type WbTask,
} from "./common";
import { ModelSettingModal } from "./model-setting";
import { AgentPicker, MaterializeModal } from "./target-select";
import { TaskEventsDrawer } from "./task-events-drawer";

type Detail = { plan: WbPlan; tasks: WbTask[]; accounts: PlanAccount[] };

/**
 * 计划任务：口水话 →（AI 澄清）任务书 → 拆解成逐条任务 → 派发到腾讯云 Agent 会话 → 同步消息。
 * 计划与任务只在本系统留回看记录；Agent、会话与消息事件都在腾讯云侧。
 */
export function PlanPanel({
  plans,
  accounts,
  reload,
}: {
  plans: WbPlan[];
  accounts: PlanAccount[];
  reload: () => Promise<void>;
}) {
  const { message, modal: appModal } = App.useApp();
  const { request, modal } = usePasswordConfirm();

  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [setting, setSetting] = useState<WbLlmSetting | null>(null);
  /** 模型配置没读到（不是「没有 Key」）：要说清是没读到，并给重试。 */
  const [settingError, setSettingError] = useState("");
  const [settingOpen, setSettingOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [materializeOpen, setMaterializeOpen] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [planEditOpen, setPlanEditOpen] = useState(false);
  const [planEditForm, setPlanEditForm] = useState({ title: "", rawInput: "" });

  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addTaskForm, setAddTaskForm] = useState({ instruction: "" });
  const [addTarget, setAddTarget] = useState<{
    accountId?: number;
    agentId?: string;
    versionId?: string;
  }>({});
  const [addingTask, setAddingTask] = useState(false);

  const [editTask, setEditTask] = useState<WbTask | null>(null);
  const [editTaskForm, setEditTaskForm] = useState({ instruction: "" });
  const [editTarget, setEditTarget] = useState<{
    accountId?: number;
    agentId?: string;
    versionId?: string;
  }>({});
  const [eventsTask, setEventsTask] = useState<WbTask | null>(null);
  const [followTask, setFollowTask] = useState<WbTask | null>(null);
  const [followText, setFollowText] = useState("");
  const [following, setFollowing] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const loadSetting = useCallback(async () => {
    const result = await workbuddyApi.setting();
    setSetting(result.data);
    setSettingError(result.message);
  }, []);

  useEffect(() => {
    void loadSetting();
  }, [loadSetting]);

  /** 打开对话抽屉前重读一次：抽屉按 configured 决定能不能发问，不能拿进入本页时的旧值。 */
  const openClarify = useCallback(async () => {
    await loadSetting();
    setClarifyOpen(true);
  }, [loadSetting]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError("");
    const result = await workbuddyApi.plan(id);
    if (result.data) setDetail(result.data);
    setDetailError(result.message);
    setDetailLoading(false);
  }, []);

  const refreshDetail = async (id?: number) => {
    const target = id ?? detailId;
    await reload();
    if (target) await loadDetail(target);
  };

  const openDetail = (id: number) => {
    setDetailId(id);
    setDetail(null);
    void loadDetail(id);
  };

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
    setDetailError("");
  };

  /** 新建计划后：AI 分类接着打开澄清对话；明确/定时分类任务已经落好，只刷新清单。 */
  const afterCreate = async (plan: WbPlan, kind: string) => {
    await reload();
    openDetail(plan.id);
    if (kind === "ai") {
      message.success("计划已创建，接着和 AI 把任务书聊清楚");
      void openClarify();
    } else {
      message.success(
        kind === "scheduled"
          ? "定时计划已创建，到点自动派发"
          : "任务已生成，可直接派发给 Agent",
      );
    }
  };

  const savePlanEdit = () => {
    if (!detail) return;
    const plan = detail.plan;
    request({
      title: "修改计划（需密码）",
      content: "修改计划的标题与原始描述；任务书请用「和 AI 聊任务书」调整。",
      okText: "保存修改",
      onOk: async () => {
        await workbuddyApi.updatePlan(plan.id, {
          title: planEditForm.title.trim(),
          rawInput: planEditForm.rawInput.trim(),
        });
        setPlanEditOpen(false);
        await refreshDetail(plan.id);
        message.success("计划已更新");
      },
    });
  };

  const removePlan = () => {
    if (!detail) return;
    const plan = detail.plan;
    request({
      title: "删除计划",
      content: `确认删除「${plan.title}」？计划下的 ${plan.taskCount} 条任务与已同步的消息会一并删除（腾讯云会话不删）。`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await workbuddyApi.deletePlan(plan.id);
        closeDetail();
        await reload();
        message.success("计划已删除");
      },
    });
  };

  const submitMaterialize = async (targets: DispatchTarget[]) => {
    if (!detail) return;
    setMaterializing(true);
    try {
      const saved = await workbuddyApi.materialize(detail.plan.id, { targets });
      setMaterializeOpen(false);
      await refreshDetail(detail.plan.id);
      message.success(
        `已拆解为 ${saved.taskCount} 条任务（${
          saved.strategy === "fan_out" ? "多账号并行" : "单账号"
        }）`,
      );
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setMaterializing(false);
    }
  };

  const dispatch = () => {
    if (!detail) return;
    const pending = detail.tasks.filter((task) =>
      ["pending", "failed"].includes(task.status),
    ).length;
    appModal.confirm({
      title: "派发待执行任务",
      content: `把 ${pending} 条任务交给 Agent 执行？每条任务会新建一个腾讯云会话，多账号时各自用各自的 Key 并行。`,
      okText: "开始派发",
      cancelText: "取消",
      onOk: async () => {
        setDispatching(true);
        try {
          const result = await workbuddyApi.dispatch(detail.plan.id);
          if (result.errors.length) {
            message.warning(result.errors.join("；"));
          } else {
            message.success(`已派发 ${result.dispatched} 条任务`);
          }
          await refreshDetail(detail.plan.id);
        } catch (error) {
          message.error((error as Error).message);
          await refreshDetail(detail.plan.id);
        } finally {
          setDispatching(false);
        }
      },
    });
  };

  const sync = async () => {
    if (!detail) return;
    setSyncing(true);
    try {
      const result = await workbuddyApi.sync(detail.plan.id);
      if (result.errors?.length) {
        message.warning(result.errors.join("；"));
      } else {
        message.success(`已同步 ${result.synced} 条任务的消息与状态`);
      }
      await refreshDetail(detail.plan.id);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const addTask = async () => {
    if (!detail) return;
    if (!addTaskForm.instruction.trim()) {
      message.error("请填写这条任务要做什么");
      return;
    }
    if (!addTarget.accountId || !addTarget.agentId) {
      message.error("请选择 Workbuddy Enterprise 账号与 Agent");
      return;
    }
    setAddingTask(true);
    try {
      await workbuddyApi.addTask(detail.plan.id, {
        instruction: addTaskForm.instruction.trim(),
        accountId: addTarget.accountId,
        agentId: addTarget.agentId,
        versionId: addTarget.versionId,
      });
      setAddTaskOpen(false);
      setAddTaskForm({ instruction: "" });
      setAddTarget({});
      await refreshDetail(detail.plan.id);
      message.success("已新增 1 条任务");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAddingTask(false);
    }
  };

  const saveTaskEdit = () => {
    if (!detail || !editTask) return;
    if (!editTaskForm.instruction.trim()) {
      message.error("任务内容不能为空");
      return;
    }
    const task = editTask;
    request({
      title: "修改任务（需密码）",
      content: `确认修改第 ${task.seq} 步的内容？`,
      okText: "保存修改",
      onOk: async () => {
        await workbuddyApi.updateTask(task.id, {
          instruction: editTaskForm.instruction.trim(),
          ...(editTarget.accountId && editTarget.agentId
            ? {
                accountId: editTarget.accountId,
                agentId: editTarget.agentId,
                versionId: editTarget.versionId || "",
              }
            : {}),
        });
        setEditTask(null);
        await refreshDetail(detail.plan.id);
        message.success("任务已更新");
      },
    });
  };

  const removeTask = (task: WbTask) => {
    if (!detail) return;
    request({
      title: "删除任务",
      content: `确认删除第 ${task.seq} 步？已经派发到会话的任务不能删，只能取消。`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await workbuddyApi.deleteTask(task.id);
        await refreshDetail(detail.plan.id);
        message.success("任务已删除");
      },
    });
  };

  const cancelTask = (task: WbTask) => {
    appModal.confirm({
      title: `取消第 ${task.seq} 步`,
      content: "腾讯云侧会同步取消这条任务；已完成的任务不受影响。",
      okText: "确认取消",
      okButtonProps: { danger: true },
      cancelText: "再想想",
      onOk: async () => {
        setCancellingId(task.id);
        try {
          await workbuddyApi.cancelTask(task.id);
          await refreshDetail(detail?.plan.id);
          message.success("任务已取消");
        } catch (error) {
          message.error((error as Error).message);
        } finally {
          setCancellingId(null);
        }
      },
    });
  };

  const followUp = async () => {
    if (!followTask) return;
    if (!followText.trim()) {
      message.error("请填写要追加的内容");
      return;
    }
    setFollowing(true);
    try {
      await workbuddyApi.followUp(followTask.id, {
        instruction: followText.trim(),
      });
      setFollowTask(null);
      setFollowText("");
      await refreshDetail(detail?.plan.id);
      message.success("已追加到该任务的 Agent 会话");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setFollowing(false);
    }
  };

  const visible = plans.filter(
    (plan) =>
      (!kindFilter || plan.kind === kindFilter) &&
      (!statusFilter || plan.status === statusFilter),
  );
  const kindCounts = plans.reduce<Record<string, number>>((acc, plan) => {
    acc[plan.kind] = (acc[plan.kind] || 0) + 1;
    return acc;
  }, {});
  /** 状态计数按已选类型统计，两个筛选同时用时候选项里的数字才对得上。 */
  const statusBase = plans.filter((plan) => !kindFilter || plan.kind === kindFilter);
  const counts = statusBase.reduce<Record<string, number>>((acc, plan) => {
    acc[plan.status] = (acc[plan.status] || 0) + 1;
    return acc;
  }, {});

  const planColumns: ColumnsType<WbPlan> = [
    {
      title: "计划",
      key: "plan",
      width: 300,
      render: (_, row) => (
        <div>
          <b>{row.title}</b>
          <div className="text-12 muted" style={{ marginTop: 2 }}>
            {row.rawInput.slice(0, 80)}
            {row.rawInput.length > 80 ? "…" : ""}
          </div>
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "kind",
      key: "kind",
      width: 130,
      render: (value: string) => (
        <Tag>{PLAN_KIND_LABEL[value] || PLAN_KIND_LABEL.ai}</Tag>
      ),
    },
    {
      title: "任务书",
      key: "spec",
      width: 140,
      render: (_, row) =>
        row.ready ? (
          <Tag color="green">{`${row.stepCount} 步`}</Tag>
        ) : (
          <Tag>未成形</Tag>
        ),
    },
    {
      title: "任务",
      dataIndex: "taskCount",
      key: "taskCount",
      width: 80,
      render: (value: number) => value || "—",
    },
    {
      title: "派发方式",
      dataIndex: "strategy",
      key: "strategy",
      width: 120,
      render: (value: string) => STRATEGY_LABEL[value] || "—",
    },
    {
      title: "排期",
      key: "schedule",
      width: 170,
      render: (_, row) =>
        row.kind === "scheduled" ? (
          <div>
            <div>{scheduleText(row)}</div>
            <div className="text-12 muted">下次 {nextRunText(row)}</div>
          </div>
        ) : (
          "—"
        ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={planStatusColor(value)}>
          {PLAN_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_, row) => (
        <Space size={4}>
          <Button type="primary" onClick={() => openDetail(row.id)}>
            管理
          </Button>
        </Space>
      ),
    },
  ];

  const plan = detail?.plan || null;
  const tasks = detail?.tasks || [];
  const detailAccounts = detail?.accounts || [];
  const dispatched = tasks.filter((task) => Boolean(task.sessionId)).length;
  const pending = tasks.filter((task) =>
    ["pending", "failed"].includes(task.status),
  ).length;

  const taskColumns: ColumnsType<WbTask> = [
    {
      title: "步骤",
      dataIndex: "seq",
      key: "seq",
      width: 64,
      render: (value: number) => `第 ${value} 步`,
    },
    {
      title: "任务内容",
      dataIndex: "instruction",
      key: "instruction",
      width: 340,
      ellipsis: true,
      render: (value: string) => <Tooltip title={value}>{value}</Tooltip>,
    },
    {
      title: "账号 · Agent",
      key: "target",
      width: 180,
      ellipsis: true,
      render: (_, row) => (
        <Tooltip title={`${row.agentId}${row.versionId ? ` · ${row.versionId}` : ""}`}>
          <span>{targetText(row, detailAccounts)}</span>
        </Tooltip>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_, row) => (
        <div>
          <Tag color={taskStatusColor(row.status)}>
            {TASK_STATUS_LABEL[row.status] || row.status}
          </Tag>
          {row.state ? (
            <div className="text-12 muted">{row.state}</div>
          ) : null}
          {row.lastError ? (
            <div className="text-12" style={{ color: "var(--danger)" }}>
              {row.lastError}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "最近更新",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button
            disabled={!row.sessionId}
            onClick={() => setEventsTask(row)}
          >
            消息
          </Button>
          {row.sessionId ? (
            <Button
              onClick={() => {
                setFollowTask(row);
                setFollowText("");
              }}
            >
              追加
            </Button>
          ) : (
            <Button
              onClick={() => {
                setEditTask(row);
                setEditTaskForm({ instruction: row.instruction });
                setEditTarget({
                  accountId: row.accountId,
                  agentId: row.agentId,
                  versionId: row.versionId || undefined,
                });
              }}
            >
              改
            </Button>
          )}
          {row.sessionId ? null : (
            <Button danger onClick={() => removeTask(row)}>
              删
            </Button>
          )}
          {["pending", "running"].includes(row.status) ? (
            <Button
              danger
              loading={cancellingId === row.id}
              onClick={() => cancelTask(row)}
            >
              取消
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <Panel
      title="计划任务"
      titleBadge={`${visible.length} 个计划`}
      extra={
        <Space>
          <Select
            style={{ width: 160 }}
            value={kindFilter}
            options={PLAN_KIND_OPTIONS.map((item) => ({
              value: item.value,
              label: item.value
                ? `${item.label}（${kindCounts[item.value] || 0}）`
                : item.label,
            }))}
            onChange={setKindFilter}
          />
          <Select
            style={{ width: 140 }}
            value={statusFilter}
            options={[
              { value: "", label: "全部状态" },
              ...PLAN_STATUS_OPTIONS.filter((item) => item.value).map((item) => ({
                value: item.value,
                label: `${item.label}（${counts[item.value] || 0}）`,
              })),
            ]}
            onChange={setStatusFilter}
          />
          <Button onClick={() => setSettingOpen(true)}>模型设置</Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建计划
          </Button>
        </Space>
      }
    >
      {settingError ? (
        <div style={{ marginBottom: 10 }}>
          <Notice variant="warn">
            <Space size={8}>
              <span>
                {`AI 模型配置没读取成功：${settingError}。清单里的计划不受影响，「和 AI 聊任务书」暂时用不了。`}
              </span>
              <Button onClick={() => void loadSetting()}>
                重试
              </Button>
            </Space>
          </Notice>
        </div>
      ) : null}

      {setting && !setting.configured ? (
        <div style={{ marginBottom: 10 }}>
          <Notice variant="warn">
            还没有 API Key：AI 澄清任务书暂不可用。可以先新建计划后手写任务，
            或到「API Key 管理」生成一把 Key。
          </Notice>
        </div>
      ) : null}

      {visible.length ? (
        <Table<WbPlan>
          rowKey="id"
          size="small"
          columns={planColumns}
          dataSource={visible}
          scroll={{ x: "max-content" }}
          pagination={false}
        />
      ) : (
        <EmptyState
          text={
            plans.length
              ? "当前筛选条件下没有计划：换个任务类型或状态看看"
              : "还没有计划：点右上角「新建计划」，选「与 AI 沟通确定任务」「明确生成任务」或「定时任务」"
          }
        />
      )}

      <CreatePlanModal
        open={createOpen}
        accounts={accounts}
        onClose={() => setCreateOpen(false)}
        onCreated={afterCreate}
      />

      <Drawer
        open={Boolean(detailId)}
        onClose={closeDetail}
        size={1080}
        title={
          plan ? (
            <Space size={8}>
              <span>{plan.title}</span>
              <Tag color={planStatusColor(plan.status)}>
                {PLAN_STATUS_LABEL[plan.status] || plan.status}
              </Tag>
            </Space>
          ) : (
            "计划详情"
          )
        }
        extra={
          plan ? (
            <Space>
              <Button
                onClick={() => {
                  setPlanEditForm({
                    title: plan.title,
                    rawInput: plan.rawInput,
                  });
                  setPlanEditOpen(true);
                }}
              >
                编辑
              </Button>
              <Button danger onClick={removePlan}>
                删除计划
              </Button>
            </Space>
          ) : null
        }
        destroyOnHidden
      >
        {detailLoading ? (
          <EmptyState text="正在读取计划与任务…" />
        ) : detailError ? (
          <Notice variant="error">{detailError}</Notice>
        ) : !plan ? (
          <EmptyState text="计划不存在或归他人所有" />
        ) : (
          <>
            {plan.lastError ? (
              <div style={{ marginBottom: 12 }}>
                <Notice variant="error">{plan.lastError}</Notice>
              </div>
            ) : null}

            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <div className="text-12 muted">原始描述</div>
              <div
                style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, marginTop: 4 }}
              >
                {plan.rawInput || "—"}
              </div>
            </div>

            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <div>
                  <b>任务书</b>
                  <span className="text-12 muted" style={{ marginLeft: 8 }}>
                    {planHint(plan)}
                  </span>
                </div>
                <Space>
                  <Button onClick={() => void openClarify()}>
                    和 AI 聊任务书
                  </Button>
                  <Button
                    type="primary"
                    disabled={!plan.ready || dispatched > 0}
                    onClick={() => setMaterializeOpen(true)}
                  >
                    {tasks.length ? "重新拆解为任务" : "拆解为任务"}
                  </Button>
                </Space>
              </div>
              {plan.ready ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <SpecLine label="目标" value={plan.spec.goal} />
                    <SpecLine label="交付物" value={plan.spec.deliverable} />
                    <SpecLine label="验收标准" value={plan.spec.acceptance} />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div className="text-12 muted" style={{ marginBottom: 4 }}>
                      {`执行步骤（${plan.spec.steps.length}）`}
                    </div>
                    <ol style={{ paddingLeft: 18, margin: 0 }}>
                      {plan.spec.steps.map((step, index) => (
                        <li key={index} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {step.title}
                          </div>
                          <div
                            className="text-12 muted"
                            style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
                          >
                            {step.instruction}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {dispatched > 0 ? (
                    <div className="text-12 muted" style={{ marginTop: 8 }}>
                      已派发过的计划不能再重新拆解（避免重复执行）；要换做法请新建计划或逐条新增任务。
                    </div>
                  ) : null}
                </>
              ) : (
                <Notice variant="info">
                  任务书还没成形：点「和 AI 聊任务书」把目标、交付物、验收标准和步骤聊清楚，
                  或直接在下面逐条新增任务。
                </Notice>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <b>任务</b>
              <span className="text-12 muted">{`${tasks.length} 条 · 已派发 ${dispatched} 条`}</span>
              <div style={{ flex: 1 }} />
              <Button
                disabled={!accounts.some((item) => item.status === "active")}
                onClick={() => {
                  setAddTaskForm({ instruction: "" });
                  setAddTarget({
                    accountId: accounts.find((item) => item.status === "active")?.id,
                  });
                  setAddTaskOpen(true);
                }}
              >
                新增任务
              </Button>
              <Button
                type="primary"
                disabled={!pending}
                loading={dispatching}
                onClick={dispatch}
              >
                {`派发待执行（${pending}）`}
              </Button>
              <Button
                loading={syncing}
                disabled={!dispatched}
                onClick={() => void sync()}
              >
                同步进度
              </Button>
            </div>

            {tasks.length ? (
              <Table<WbTask>
                rowKey="id"
                size="small"
                columns={taskColumns}
                dataSource={tasks}
                scroll={{ x: "max-content" }}
                pagination={false}
              />
            ) : (
              <EmptyState text="还没有任务：先和 AI 把任务书聊完整后「拆解为任务」，或直接逐条新增" />
            )}
          </>
        )}
      </Drawer>

      <Modal
        open={planEditOpen}
        title="编辑计划"
        width={620}
        onCancel={() => setPlanEditOpen(false)}
        onOk={savePlanEdit}
        okText="下一步（密码确认）"
        cancelText="取消"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="计划标题" required>
            <Input
              value={planEditForm.title}
              maxLength={200}
              onChange={(event) =>
                setPlanEditForm((prev) => ({
                  ...prev,
                  title: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="原始描述">
            <Input.TextArea
              rows={5}
              value={planEditForm.rawInput}
              maxLength={20000}
              onChange={(event) =>
                setPlanEditForm((prev) => ({
                  ...prev,
                  rawInput: event.target.value,
                }))
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={addTaskOpen}
        title="新增任务"
        width={680}
        onCancel={() => setAddTaskOpen(false)}
        onOk={() => void addTask()}
        okText={addingTask ? "保存中" : "新增"}
        cancelText="取消"
        confirmLoading={addingTask}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item
            label="任务内容"
            required
            extra="一条任务只交给一个 Agent；指令要自包含（Agent 看不到计划和对话历史）"
          >
            <Input.TextArea
              rows={4}
              value={addTaskForm.instruction}
              maxLength={8000}
              placeholder="写清输入、做什么、输出什么"
              onChange={(event) =>
                setAddTaskForm({ instruction: event.target.value })
              }
            />
          </Form.Item>
          <Form.Item label="执行目标" required>
            <AgentPicker
              accounts={accounts}
              accountId={addTarget.accountId}
              agentId={addTarget.agentId}
              versionId={addTarget.versionId}
              onChange={setAddTarget}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(editTask)}
        title={`修改第 ${editTask?.seq || ""} 步`}
        width={680}
        onCancel={() => setEditTask(null)}
        onOk={saveTaskEdit}
        okText="下一步（密码确认）"
        cancelText="取消"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="任务内容" required>
            <Input.TextArea
              rows={4}
              value={editTaskForm.instruction}
              maxLength={8000}
              onChange={(event) =>
                setEditTaskForm({ instruction: event.target.value })
              }
            />
          </Form.Item>
          <Form.Item label="执行目标">
            <AgentPicker
              accounts={accounts}
              accountId={editTarget.accountId}
              agentId={editTarget.agentId}
              versionId={editTarget.versionId}
              onChange={setEditTarget}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(followTask)}
        title={`追加指令 · 第 ${followTask?.seq || ""} 步`}
        width={640}
        onCancel={() => setFollowTask(null)}
        onOk={() => void followUp()}
        okText={following ? "发送中" : "追加到会话"}
        cancelText="取消"
        confirmLoading={following}
        destroyOnHidden
      >
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          直接发到这条任务已有的 Agent 会话里，不新建会话。
        </div>
        <Input.TextArea
          rows={4}
          value={followText}
          maxLength={8000}
          placeholder="例如：把结果再按省份拆一列，并把异常值标红"
          onChange={(event) => setFollowText(event.target.value)}
        />
      </Modal>

      <MaterializeModal
        open={materializeOpen}
        planTitle={plan?.title || ""}
        stepCount={plan?.stepCount || 0}
        accounts={accounts}
        busy={materializing}
        onCancel={() => setMaterializeOpen(false)}
        onSubmit={submitMaterialize}
      />

      <ClarifyDrawer
        open={clarifyOpen}
        plan={plan}
        configured={Boolean(setting?.configured)}
        model={setting?.model || ""}
        initialInput=""
        onClose={() => setClarifyOpen(false)}
        onApplied={() => {
          void refreshDetail(detailId || undefined);
        }}
      />

      <TaskEventsDrawer
        open={Boolean(eventsTask)}
        task={eventsTask}
        onClose={() => setEventsTask(null)}
      />

      <ModelSettingModal
        open={settingOpen}
        onClose={() => setSettingOpen(false)}
        onSaved={(next) => {
          setSetting(next);
          setSettingError("");
        }}
      />
      {modal}
    </Panel>
  );
}

function SpecLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-12 muted">{label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
        {value || "—"}
      </div>
    </div>
  );
}
