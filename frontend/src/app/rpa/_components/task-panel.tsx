"use client";

import { RobotOutlined } from "@ant-design/icons";
import { App, Button, Collapse, Input, Modal, Radio, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { ScheduleFields } from "@/components/schedule-fields";
import { EmptyState, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  EMPTY_SCHEDULE,
  scheduleBody,
  scheduleDraftFrom,
  scheduleError,
  scheduleText,
  type ScheduleDraft,
} from "@/lib/schedule";
import {
  EXECUTION_STATUS_LABEL,
  PHONE_FINISH_OPTIONS,
  TASK_STATUS_LABEL,
  buildParams,
  DEVICE_OPTIONS,
  deviceLabel,
  durationText,
  fileTypeLabel,
  isPhoneDevice,
  paramEntries,
  rpaApi,
  type RpaAccount,
  type RpaExecution,
  type RpaScript,
  type RpaTask,
} from "./common";
import { ParamsChatDrawer } from "./params-chat-drawer";
import { ScriptPicker } from "./script-picker";
import { AccountPicker } from "./account-picker";

const EXECUTION_COLOR: Record<string, string> = {
  running: "processing",
  success: "success",
  failed: "error",
  cancelled: "default",
  timeout: "warning",
};

const TASK_COLOR: Record<string, string> = {
  pending: "default",
  running: "processing",
  completed: "success",
  failed: "error",
  cancelled: "default",
  timeout: "warning",
};

type TaskForm = {
  name: string;
  deviceType: string;
  scriptId: number | null;
  accountIds: number[];
  schedule: ScheduleDraft;
  maxRetries: string;
  timeoutSeconds: string;
  freeJson: string;
  phoneFinishAction: string;
};

const EMPTY: TaskForm = {
  name: "",
  deviceType: "pc",
  scriptId: null,
  accountIds: [],
  schedule: EMPTY_SCHEDULE,
  maxRetries: "0",
  timeoutSeconds: "3600",
  freeJson: "",
  phoneFinishAction: "keep",
};

/**
 * RPA 任务：云端建任务时就绑定「脚本 + 运行参数 + RPA 账号」，本地比特浏览器凭 API Key
 * 认领后拿脚本正文与账号口令执行，再把结果回传；界面这边看状态与执行记录。
 * 任务不独立声明设备类型，从绑定的脚本继承（PC / 安卓云手机 / iPhone 云手机）。
 */
export function TaskPanel({
  tasks,
  scripts,
  accounts,
  reload,
}: {
  tasks: RpaTask[];
  scripts: RpaScript[];
  accounts: RpaAccount[];
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RpaTask | null>(null);
  const [form, setForm] = useState<TaskForm>(EMPTY);
  const [params, setParams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [multiTask, setMultiTask] = useState(false);
  const [running, setRuns] = useState<{ task: RpaTask; list: RpaExecution[] } | null>(
    null,
  );

  const patch = (next: Partial<TaskForm>) =>
    setForm((prev) => ({ ...prev, ...next }));

  const patchSchedule = (next: Partial<ScheduleDraft>) =>
    setForm((prev) => ({ ...prev, schedule: { ...prev.schedule, ...next } }));

  const selected = scripts.find((item) => item.id === form.scriptId) || null;
  const entries = paramEntries(selected);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setParams({});
    setMultiTask(false);
    setOpen(true);
  };

  const openEdit = (task: RpaTask) => {
    const script = scripts.find((item) => item.id === task.scriptId) || null;
    setEditing(task);
    setForm({
      ...EMPTY,
      name: task.name,
      deviceType: task.deviceType,
      scriptId: task.scriptId,
      accountIds: task.accountIds,
      schedule: scheduleDraftFrom(task),
      maxRetries: String(task.maxRetries),
      timeoutSeconds: String(task.timeoutSeconds),
      freeJson:
        !script || !Object.keys(script.paramsSchema || {}).length
          ? Object.keys(task.params || {}).length
            ? JSON.stringify(task.params, null, 2)
            : ""
          : "",
      phoneFinishAction: task.phoneFinishAction || "keep",
    });
    const next: Record<string, string> = {};
    paramEntries(script).forEach(([key]) => {
      const value = task.params?.[key];
      next[key] = value === null || value === undefined ? "" : String(value);
    });
    setParams(next);
    setOpen(true);
  };

  const loadRuns = async (task: RpaTask) => {
    const result = await rpaApi.executions(task.id);
    if (result.message) {
      message.error(result.message);
      return;
    }
    setRuns({ task, list: result.data ?? [] });
  };

  const body = (): Record<string, unknown> => {
    const phone = isPhoneDevice(form.deviceType);
    return {
      name: form.name.trim(),
      deviceType: form.deviceType,
      scriptId: form.scriptId,
      accountIds: form.accountIds,
      params: selected
        ? buildParams(selected.paramsSchema, params, form.freeJson)
        : {},
      ...scheduleBody(form.schedule),
      maxRetries: form.maxRetries.trim(),
      timeoutSeconds: form.timeoutSeconds.trim(),
      ...(phone ? { phoneFinishAction: form.phoneFinishAction } : {}),
    };
  };

  const submit = async () => {
    if (!form.name.trim()) {
      message.warning("请填写任务名称");
      return;
    }
    if (!form.scriptId) {
      message.warning("请选择要执行的 RPA 脚本");
      return;
    }
    if (!form.accountIds.length) {
      message.warning("请至少绑定一个 RPA 账号（本地执行端要靠它登录平台）");
      return;
    }
    const scheduleProblem = scheduleError(form.schedule);
    if (scheduleProblem) {
      message.warning(scheduleProblem);
      return;
    }
    if (editing) {
      const target = editing;
      request({
        title: "修改 RPA 任务（需密码）",
        content: `确认修改「${target.name}」？`,
        okText: "保存修改",
        onOk: async () => {
          await rpaApi.updateTask(target.id, body());
          close();
          await reload();
        },
      });
      return;
    }
    setBusy(true);
    try {
      const batch = multiTask && form.accountIds.length > 1;
      if (batch) {
        const created = await rpaApi.createBatch(body());
        close();
        await reload();
        message.success(`已批量创建 ${created.length} 个任务（每账号一个），等待本地执行端认领`);
      } else {
        await rpaApi.createTask(body());
        close();
        await reload();
        message.success("已创建 1 个任务，等待本地执行端认领");
      }
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
    setParams({});
    setMultiTask(false);
  };

  const remove = (task: RpaTask) => {
    request({
      title: "删除 RPA 任务",
      content: `确认删除「${task.name}」？它的执行记录会一并删除。`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await rpaApi.deleteTask(task.id);
        await reload();
      },
    });
  };

  const cancel = (task: RpaTask) => {
    request({
      title: "取消任务",
      content: `确认取消「${task.name}」？取消后本地执行端不会再认领它。`,
      okText: "确认取消",
      onOk: async () => {
        await rpaApi.cancelTask(task.id);
        await reload();
      },
    });
  };

  const requeue = (task: RpaTask) => {
    request({
      title: "重新排队",
      content: `确认把「${task.name}」退回待执行？本地执行端下一轮会重新认领它。`,
      okText: "重新排队",
      onOk: async () => {
        await rpaApi.requeueTask(task.id);
        await reload();
      },
    });
  };

  const columns: ColumnsType<RpaTask> = [
    {
      title: "任务名称",
      dataIndex: "name",
      key: "name",
      width: 220,
      render: (value: string, row) => (
        <Space size={6}>
          <b>{value}</b>
          {(row.status === "running" || row.status === "completed" || row.status === "failed") && row.lastRunAt ? (
            <Button
              type="link"
              style={{ padding: 0, fontSize: 12, height: "auto" }}
              onClick={() => void loadRuns(row)}
            >
              查看执行
            </Button>
          ) : null}
        </Space>
      ),
    },
    {
      title: "目标设备",
      dataIndex: "deviceLabel",
      key: "deviceLabel",
      width: 130,
      render: (value: string, row) => (
        <Tag color={isPhoneDevice(row.deviceType) ? "geekblue" : "blue"}>
          {value}
        </Tag>
      ),
    },
    {
      title: "RPA 脚本",
      key: "script",
      width: 200,
      render: (_, row) =>
        row.script ? (
          <span>
            {row.script.name}
            <span className="text-12 muted">
              {` · ${fileTypeLabel(row.script.fileType)}`}
            </span>
          </span>
        ) : (
          <Tag color="error">脚本已删除</Tag>
        ),
    },
    {
      title: "绑定账号",
      key: "accounts",
      width: 200,
      render: (_, row) =>
        row.accounts.length
          ? row.accounts
              .map((item) => `${item.platform}/${item.username}`)
              .join("、")
          : `${row.accountIds.length} 个（账号已删除）`,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (value: string) => (
        <Tag color={TASK_COLOR[value] || "default"}>
          {TASK_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "排期",
      key: "schedule",
      width: 170,
      render: (_, row) => scheduleText(row),
    },
    {
      title: "最近执行",
      key: "lastRun",
      width: 190,
      render: (_, row) =>
        row.lastRunAt ? (
          <span>
            {fmtTime(row.lastRunAt)}
            {row.lastError ? (
              <span className="text-12" style={{ color: "var(--danger)" }}>
                {` ${row.lastError}`}
              </span>
            ) : null}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 360,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button onClick={() => void loadRuns(row)}>
            执行记录
          </Button>
          {row.status === "pending" || row.status === "running" ? (
            <Button onClick={() => cancel(row)}>
              取消
            </Button>
          ) : null}
          {row.status !== "running" ? (
            <Button onClick={() => requeue(row)}>
              重新排队
            </Button>
          ) : null}
          <Button onClick={() => openEdit(row)}>
            改
          </Button>
          <Button danger onClick={() => remove(row)}>
            删
          </Button>
        </Space>
      ),
    },
  ];

  const runColumns: ColumnsType<RpaExecution> = [
    { title: "执行", dataIndex: "id", key: "id", width: 80 },
    {
      title: "结果",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (value: string) => (
        <Tag color={EXECUTION_COLOR[value] || "default"}>
          {EXECUTION_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "设备",
      dataIndex: "deviceLabel",
      key: "deviceLabel",
      width: 120,
      render: (value: string) => value || "—",
    },
    {
      title: "第几次",
      dataIndex: "attempt",
      key: "attempt",
      width: 80,
    },
    {
      title: "执行端",
      dataIndex: "executor",
      key: "executor",
      width: 160,
      render: (value: string) => value || "—",
    },
    {
      title: "开始",
      dataIndex: "startedAt",
      key: "startedAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "时长",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 100,
      render: (value: number | null) => durationText(value),
    },
    {
      title: "说明",
      key: "detail",
      render: (_, row) =>
        row.errorMessage || (Object.keys(row.output || {}).length
          ? JSON.stringify(row.output)
          : "—"),
    },
  ];

  // 建任务的前置条件缺哪一项就写在面板标题后面：页签底部的说明用户看不到，会以为按钮没反应
  const prereqHints = [
    scripts.length
      ? ""
      : "还没有 RPA 脚本：先到「RPA 脚本」页签新建或用 AI 生成，任务要绑定脚本",
    accounts.length
      ? ""
      : "还没有 RPA 账号：先到「RPA 账号」页签登记，任务要绑定账号才能在本地登录平台执行",
  ].filter(Boolean);

  return (
    <Panel
      title="RPA 任务"
      titleExtra={
        prereqHints.length ? (
          <span className="text-12 muted">{prereqHints.join("；")}</span>
        ) : null
      }
      titleBadge={`${tasks.length} 个`}
      extra={
        <Button type="primary" onClick={openCreate}>
          新建任务
        </Button>
      }
    >
      {tasks.length ? (
        <Table<RpaTask>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={tasks}
          scroll={{ x: "max-content" }}
          pagination={false}
        />
      ) : (
        <EmptyState text="还没有 RPA 任务：任务要在云端绑定脚本与账号，本地执行端才会认领它" />
      )}

      <Modal
        open={open}
        title={editing ? `修改任务（${editing.name}）` : "新建 RPA 任务"}
        onCancel={close}
        onOk={() => void submit()}
        okText={busy ? "提交中" : editing ? "下一步（密码确认）" : "保存"}
        cancelText="取消"
        confirmLoading={busy}
        width={860}
        destroyOnHidden
      >
        <div className="data-table-form">
          <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
            <span className="data-table-form-label">
              任务名称<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input
              value={form.name}
              maxLength={200}
              placeholder="如 每早采集竞品价格"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              目标设备<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Select
              value={form.deviceType}
              options={DEVICE_OPTIONS}
              onChange={(value) => {
                patch({ deviceType: value, scriptId: null, accountIds: [] });
                setParams({});
                if (!isPhoneDevice(value)) {
                  patch({ phoneFinishAction: "keep" });
                }
              }}
            />
          </label>
          <div
            className="text-12 muted"
            style={{ gridColumn: "1 / -1", marginTop: -4, marginBottom: 8 }}
          >
            <Tag
              color={isPhoneDevice(form.deviceType) ? "geekblue" : "blue"}
              style={{ fontSize: 13, padding: "2px 10px" }}
            >
              {`本任务为：${deviceLabel(form.deviceType)}`}
            </Tag>
            <span style={{ marginLeft: 8 }}>
              本地执行端按该设备类型认领；下方只列出该设备类型的脚本与账号
            </span>
          </div>
          <ScriptPicker
            scripts={scripts.filter((s) => s.deviceType === form.deviceType)}
            selectedId={form.scriptId}
            deviceType={form.deviceType}
            onChange={(scriptId) => {
              patch({ scriptId, freeJson: "" });
              if (scriptId === null) {
                setParams({});
                return;
              }
              const script = scripts.find((item) => item.id === scriptId);
              const next: Record<string, string> = {};
              paramEntries(script || null).forEach(([key, spec]) => {
                const initial = spec?.default;
                next[key] =
                  initial === null || initial === undefined
                    ? ""
                    : typeof initial === "object"
                      ? JSON.stringify(initial)
                      : String(initial);
              });
              setParams(next);
            }}
          />
          <AccountPicker
            accounts={accounts}
            selectedIds={form.accountIds}
            onChange={(accountIds) => patch({ accountIds })}
          />
          {!editing && form.accountIds.length > 1 ? (
            <label className="data-table-form-item">
              <span className="data-table-form-label">建任务方式</span>
              <Radio.Group
                value={multiTask ? "multi" : "single"}
                onChange={(event) => setMultiTask(event.target.value === "multi")}
              >
                <Radio value="single">单任务（多账号共用）</Radio>
                <Radio value="multi">多任务（每账号一个）</Radio>
              </Radio.Group>
            </label>
          ) : null}
          {!editing && form.accountIds.length > 1 && multiTask ? (
            <div
              className="text-12 muted"
              style={{ gridColumn: "1 / -1", marginTop: -4, marginBottom: 8 }}
            >
              {`将按选中的 ${form.accountIds.length} 个账号各建一个任务，任务名自动加「平台/账号」后缀，脚本、参数、排期共享`}
            </div>
          ) : null}

          {entries.length ? (
            <>
              <div
                className="data-table-form-item"
                style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
                  运行参数
                </span>
                <Button
                  icon={<RobotOutlined />}
                  onClick={() => setChatOpen(true)}
                >
                  AI 填写
                </Button>
              </div>
              {entries.map(([key, spec]) => (
                <label className="data-table-form-item" key={key}>
                  <span className="data-table-form-label">
                    {spec?.label || key}
                    <span className="text-12 muted">{` · ${key}`}</span>
                    {spec?.required ? (
                      <b style={{ color: "var(--danger)" }}> *</b>
                    ) : null}
                  </span>
                  <Input
                    value={params[key] || ""}
                    placeholder={
                      spec?.required
                        ? "必填（脚本声明的运行参数）"
                        : "留空＝用脚本默认值"
                    }
                    onChange={(event) =>
                      setParams((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </>
          ) : null}

          <ScheduleFields
            draft={form.schedule}
            onChange={patchSchedule}
            textDate={Boolean(editing)}
          />

          <Collapse
            ghost
            style={{ gridColumn: "1 / -1" }}
            items={[
              {
                key: "advanced",
                label: "高级设置",
                children: (
                  <div className="data-table-form" style={{ marginTop: 8 }}>
                    {selected && isPhoneDevice(selected.deviceType) ? (
                      <label className="data-table-form-item">
                        <span className="data-table-form-label">任务结束后</span>
                        <Select
                          value={form.phoneFinishAction}
                          options={PHONE_FINISH_OPTIONS}
                          onChange={(value) => patch({ phoneFinishAction: value })}
                        />
                      </label>
                    ) : null}
                    <label className="data-table-form-item">
                      <span className="data-table-form-label">失败重试次数</span>
                      <Input
                        value={form.maxRetries}
                        maxLength={2}
                        placeholder="0-20，默认 0"
                        onChange={(event) => patch({ maxRetries: event.target.value })}
                      />
                    </label>
                    <label className="data-table-form-item">
                      <span className="data-table-form-label">超时秒数</span>
                      <Input
                        value={form.timeoutSeconds}
                        maxLength={5}
                        placeholder="60-86400，默认 3600"
                        onChange={(event) => patch({ timeoutSeconds: event.target.value })}
                      />
                    </label>
                    <div className="text-12 muted" style={{ gridColumn: "1 / -1" }}>
                      任务建好即进入待执行，本地比特浏览器凭 API Key 认领后拿脚本正文与账号口令执行；
                      任务设备类型由脚本决定，账号必须与脚本同设备；超过超时秒数没回传会被判超时并退回待执行。
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(running)}
        title={running ? `执行记录（${running.task.name}）` : "执行记录"}
        onCancel={() => setRuns(null)}
        footer={<Button onClick={() => setRuns(null)}>关闭</Button>}
        width={900}
        destroyOnHidden
      >
        {running ? (
          running.list.length ? (
            <Table<RpaExecution>
              rowKey="id"
              size="small"
              columns={runColumns}
              dataSource={running.list}
              scroll={{ x: "max-content" }}
              pagination={false}
            />
          ) : (
            <EmptyState text="这个任务还没有被本地执行端认领过" />
          )
        ) : null}
      </Modal>
      {modal}
      {selected ? (
        <ParamsChatDrawer
          open={chatOpen}
          script={selected}
          currentParams={params}
          onClose={() => setChatOpen(false)}
          onApply={(next) => setParams(next)}
        />
      ) : null}
    </Panel>
  );
}
