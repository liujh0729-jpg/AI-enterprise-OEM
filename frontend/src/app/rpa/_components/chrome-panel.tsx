"use client";

import {
  CaretRightOutlined,
  ChromeOutlined,
  DownloadOutlined,
  PauseOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { App, Badge, Button, Drawer, Empty, Input, InputNumber, Modal, Space, Table, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { RawImg } from "@/components/ui/raw-img";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { platformApi, type ExtensionInfo } from "@/api/platform";
import {
  RC_ACTION_LABELS,
  rcDeviceBadge,
  rcSessionColor,
  rpaChromeApi,
  type RcDeviceView,
  type RcSessionView,
  type RcStepView,
} from "@/api/rpa-chrome";

/**
 * RPA ·「本地RPA状态」页签（方案 §6）：插件登录本系统后，本机浏览器成为该账号名下的一台设备；
 * 这台设备在线时，页面（或 Agent/MCP）就能给它派任务。升级后插件侧边栏自己就是浏览器代理
 * （目标在插件侧编排、模型与工具在平台），这里仍是本账号的自检台：设备在线灯、心跳、扩展版本、
 * 当前会话、待确认队列与「停止所有控制」。离线设备不渲染「新建互动任务」，符合「不该看到的不渲染」的纪律。
 */

const POLL_MS = 15_000;

/** 动作快照 → 一行人话：动作名 + 关键参数（目标/文本/地址），够看清这一步在干什么。 */
function actionText(action: Record<string, unknown>): string {
  const name = String(action.action || "").trim();
  const label = RC_ACTION_LABELS[name] || name || "动作";
  const detail: string[] = [];
  const target = action.target;
  if (typeof target === "string" && target) detail.push(target);
  else if (target && typeof target === "object") {
    const row = target as Record<string, unknown>;
    const text = [row.selector, row.name, row.text, row.role]
      .filter((item) => typeof item === "string" && item)
      .join(" ");
    if (text) detail.push(text);
  }
  for (const key of ["url", "act", "value", "key"]) {
    const value = action[key];
    if (typeof value === "string" && value) detail.push(`${key}=${value}`);
  }
  return detail.length ? `${label}｜${detail.join(" ")}` : label;
}

export function ChromePanel() {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [devices, setDevices] = useState<RcDeviceView[]>([]);
  const [sessions, setSessions] = useState<RcSessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<RcSessionView | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [starting, setStarting] = useState<RcDeviceView | null>(null);
  const [info, setInfo] = useState<ExtensionInfo | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 下载引导与顶栏「浏览器插件」入口同源：取不到（未发布 / 入口关闭）就不渲染下载按钮。
  useEffect(() => {
    let alive = true;
    platformApi
      .extensionInfo()
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch(() => {
        if (alive) setInfo(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      const [deviceResult, sessionResult] = await Promise.all([
        rpaChromeApi.devices(),
        rpaChromeApi.sessions(),
      ]);
      if (deviceResult.data) setDevices(deviceResult.data.devices);
      if (sessionResult.data) setSessions(sessionResult.data.list);
      setError(
        [deviceResult.message, sessionResult.message].filter(Boolean).join("；"),
      );
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    void reload(true);
    timer.current = setInterval(() => void reload(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [reload]);

  // 会话详情抽屉开着、且会话还在跑时，按更短的节奏刷新逐步回放。
  useEffect(() => {
    const id = detail?.id;
    const status = detail?.status;
    if (!id || !status) return;
    if (["COMPLETED", "FAILED", "CANCELLED", "TIMEOUT"].includes(status)) return;
    const timer = setInterval(() => {
      void rpaChromeApi.session(id).then((result) => {
        if (result.data) setDetail(result.data.session);
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [detail?.id, detail?.status]);

  const refreshDetail = async (id: number, silent = false) => {
    const result = await rpaChromeApi.session(id);
    if (result.message) {
      if (!silent) message.error(result.message);
      return;
    }
    if (result.data) setDetail(result.data.session);
    if (!silent) await reload();
  };

  const openDetail = (id: number) => {
    setDetailBusy(true);
    void refreshDetail(id).finally(() => setDetailBusy(false));
  };

  const toggleDevice = async (device: RcDeviceView) => {
    const enabled = device.status === "DISABLED";
    try {
      await rpaChromeApi.setDevice(device.clientId, enabled);
      message.success(enabled ? "设备已启用" : "设备已停用");
      await reload();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const removeDevice = (device: RcDeviceView) => {
    request({
      title: "移除本地 Chrome 设备",
      content: `确认移除「${device.name}」？移除后这台浏览器要重新在插件里登录才能再被控制。`,
      danger: true,
      okText: "确认移除",
      onOk: async () => {
        await rpaChromeApi.removeDevice(device.clientId);
        message.success("设备已移除");
        await reload();
      },
    });
  };

  const control = async (
    work: Promise<{ session: RcSessionView }>,
    tip: string,
  ) => {
    try {
      const { session } = await work;
      message.success(tip);
      setDetail(session);
      await reload();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const retryStep = async (step: RcStepView) => {
    try {
      const { session } = await rpaChromeApi.retryStep(step.id);
      message.success(`已重试第 ${step.stepIndex + 1} 步`);
      setDetail(session);
      await reload();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const deviceColumns = [
    {
      title: "设备",
      key: "name",
      render: (_: unknown, row: RcDeviceView) => (
        <div>
          <div>{row.name}</div>
          <div className="text-12 muted mono">{row.clientId}</div>
        </div>
      ),
    },
    {
      title: "在线",
      key: "online",
      width: 110,
      render: (_: unknown, row: RcDeviceView) => (
        <Badge status={rcDeviceBadge(row)} text={row.statusLabel || "—"} />
      ),
    },
    {
      title: "扩展版本",
      dataIndex: "extensionVersion",
      key: "extensionVersion",
      width: 100,
      render: (value: string) => (value ? `v${value}` : "—"),
    },
    {
      title: "最近心跳",
      dataIndex: "lastSeenAt",
      key: "lastSeenAt",
      width: 150,
      render: (value: string | null) => fmtTime(value),
    },
    {
      title: "当前会话",
      key: "active",
      width: 120,
      render: (_: unknown, row: RcDeviceView) =>
        row.activeSessionId ? (
          <Button type="link" size="small" onClick={() => openDetail(row.activeSessionId)}>
            #{row.activeSessionId}
          </Button>
        ) : (
          "—"
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_: unknown, row: RcDeviceView) => (
        <Space size={4} wrap>
          {row.online ? (
            <Button size="small" type="primary" onClick={() => setStarting(row)}>
              新建互动任务
            </Button>
          ) : null}
          <Button size="small" onClick={() => toggleDevice(row)}>
            {row.status === "DISABLED" ? "启用" : "停用"}
          </Button>
          <Button size="small" danger onClick={() => removeDevice(row)}>
            移除
          </Button>
        </Space>
      ),
    },
  ];

  const sessionColumns = [
    {
      title: "目标",
      dataIndex: "goal",
      key: "goal",
      render: (value: string) => value || "—",
    },
    {
      title: "设备",
      dataIndex: "deviceName",
      key: "deviceName",
      width: 160,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (value: string, row: RcSessionView) => (
        <Tag color={rcSessionColor(value)}>{row.statusLabel || value}</Tag>
      ),
    },
    {
      title: "步数",
      key: "steps",
      width: 90,
      render: (_: unknown, row: RcSessionView) =>
        `${row.stepCount}/${row.maxSteps}`,
    },
    {
      title: "开始",
      dataIndex: "startedAt",
      key: "startedAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      render: (_: unknown, row: RcSessionView) => (
        <Button size="small" onClick={() => openDetail(row.id)}>
          回放
        </Button>
      ),
    },
  ];

  const hasOnline = devices.some((device) => device.online);
  const activeSessions = sessions.filter((row) =>
    ["RUNNING", "WAITING_CONFIRM", "PAUSED"].includes(row.status),
  );
  const waitingConfirm = sessions.filter((row) => row.status === "WAITING_CONFIRM");

  const stopAll = () => {
    if (!activeSessions.length) return;
    request({
      title: "停止所有控制",
      content: `确认停止当前 ${activeSessions.length} 个进行中的会话？插件本机上的正在执行的动作会一起停下。`,
      danger: true,
      okText: "全部停止",
      onOk: async () => {
        for (const row of activeSessions) {
          await rpaChromeApi.stopSession(row.id).catch(() => undefined);
        }
        message.success("已请求停止全部会话");
        await reload(true);
      },
    });
  };

  return (
    <Panel
      title="本地RPA状态"
      titleBadge={`${devices.length} 台设备 · ${activeSessions.length} 个进行中`}
      extra={
        <Space>
          <span className="text-12 muted">
            插件登录本系统后即成为一台设备；只有在线设备能被 Agent 控制
          </span>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void reload(true)}>
            刷新
          </Button>
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            disabled={!activeSessions.length}
            onClick={stopAll}
          >
            停止所有控制
          </Button>
        </Space>
      }
    >
      {error ? <Notice variant="error">{`本地 RPA 状态加载失败：${error}`}</Notice> : null}

      {waitingConfirm.length ? (
        <Notice>
          {`有 ${waitingConfirm.length} 个会话在等你确认敏感动作：请在插件侧边栏点「允许本次 / 拒绝」，或在这里打开会话查看。`}
        </Notice>
      ) : null}

      {!loading && !devices.length ? (
        <Notice>
          <div>
            {`还没有本地 Chrome 设备：请在某台电脑上安装「${info?.name || "AIPDD Enterprise"}」插件（v${info?.minVersion || "1.4.0"}+），打开插件弹窗填本系统地址与账号登录，这台浏览器就会出现在这里。`}
          </div>
          <Space size={8} style={{ marginTop: 8 }} wrap>
            {info?.downloadUrl ? (
              <Button
                size="small"
                type="primary"
                icon={<DownloadOutlined />}
                href={info.downloadUrl}
                download
              >
                下载插件安装包（zip）
              </Button>
            ) : null}
            <span className="text-12 muted">
              安装：下载 zip → 解压出的文件夹直接加载（扩展管理页开「开发者模式」→「加载已解压的扩展程序」）→
              点插件图标拉开侧边栏，在右上角「⋯」里登录本系统
            </span>
          </Space>
        </Notice>
      ) : null}

      {devices.length ? (
        <Table<RcDeviceView>
          rowKey="clientId"
          size="small"
          columns={deviceColumns}
          dataSource={devices}
          scroll={{ x: "max-content" }}
          pagination={false}
          loading={loading}
        />
      ) : null}

      <div style={{ marginTop: 20 }}>
        <Panel title="互动会话" titleBadge={`${sessions.length} 条`}>
          {sessions.length ? (
            <Table<RcSessionView>
              rowKey="id"
              size="small"
              columns={sessionColumns}
              dataSource={sessions}
              scroll={{ x: "max-content" }}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
            />
          ) : (
            <EmptyState
              icon={<ChromeOutlined aria-hidden />}
              text={
                hasOnline
                  ? "还没有互动会话：点设备行的「新建互动任务」，给一个目标让 Agent 在你的浏览器里逐步完成"
                  : "还没有可用的在线设备：先在插件里登录，设备在线后才能发起互动会话"
              }
            />
          )}
        </Panel>
      </div>

      <StartSessionModal
        device={starting}
        onClose={() => setStarting(null)}
        onDone={async (session) => {
          setStarting(null);
          await reload();
          openDetail(session.id);
        }}
      />

      <SessionDrawer
        session={detail}
        busy={detailBusy}
        onClose={() => setDetail(null)}
        onRefresh={() => detail && void refreshDetail(detail.id)}
        onPause={() =>
          detail &&
          void control(rpaChromeApi.pauseSession(detail.id), "会话已暂停")
        }
        onResume={() =>
          detail &&
          void control(rpaChromeApi.resumeSession(detail.id), "会话已继续")
        }
        onStop={() =>
          detail &&
          void control(rpaChromeApi.stopSession(detail.id), "会话已停止")
        }
        onRetry={retryStep}
      />
      {modal}
    </Panel>
  );
}

/** 新建互动任务：设备固定为点开的那台（在线才会点得进来），人给目标与可选的起始地址。 */
function StartSessionModal({
  device,
  onClose,
  onDone,
}: {
  device: RcDeviceView | null;
  onClose: () => void;
  onDone: (session: RcSessionView) => void | Promise<void>;
}) {
  const { message } = App.useApp();
  const [goal, setGoal] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [maxSteps, setMaxSteps] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (device) {
      setGoal("");
      setStartUrl("");
      setMaxSteps(null);
    }
  }, [device]);

  const submit = async () => {
    if (!device) return;
    if (goal.trim().length < 2) {
      message.warning("请把要完成的目标写清楚（至少 2 个字）");
      return;
    }
    setBusy(true);
    try {
      const { session } = await rpaChromeApi.startSession({
        clientId: device.clientId,
        goal: goal.trim(),
        ...(startUrl.trim() ? { startUrl: startUrl.trim() } : {}),
        ...(maxSteps ? { maxSteps } : {}),
      });
      message.success("已发起互动会话，Agent 会在你的浏览器里逐步执行");
      await onDone(session);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!device}
      title={`新建互动任务 · ${device?.name || ""}`}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={busy ? "发起中" : "发起会话"}
      cancelText="取消"
      confirmLoading={busy}
      destroyOnHidden
      width={620}
    >
      <div className="text-12 muted" style={{ marginBottom: 12 }}>
        Agent 会按你的目标，在这台浏览器已登录的页面上逐步决策并执行；敏感操作（提交、支付、删除等）
        会先停下等你点「允许本次」。你可以随时在会话里暂停或停止。
      </div>
      <div className="data-table-form">
        <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
          <span className="data-table-form-label">
            目标<b style={{ color: "var(--danger)" }}> *</b>
          </span>
          <Input.TextArea
            value={goal}
            rows={3}
            maxLength={1000}
            placeholder="如：打开某电商站点，搜索「蓝牙耳机」，把前 3 个商品的标题和价格记下来"
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>
        <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
          <span className="data-table-form-label">起始地址（可选）</span>
          <Input
            value={startUrl}
            placeholder="https://… 留空则从当前活动页开始"
            onChange={(event) => setStartUrl(event.target.value)}
          />
        </label>
        <label className="data-table-form-item">
          <span className="data-table-form-label">最大步数（可选）</span>
          <InputNumber
            min={1}
            max={60}
            value={maxSteps ?? undefined}
            placeholder="默认 25"
            style={{ width: "100%" }}
            onChange={(value) => setMaxSteps(value ?? null)}
          />
        </label>
      </div>
    </Modal>
  );
}

/** 会话回放抽屉：逐步列出动作 + LLM 理由 + 页面观测 + 截图；可暂停/继续/停止/重试某步。 */
function SessionDrawer({
  session,
  busy,
  onClose,
  onRefresh,
  onPause,
  onResume,
  onStop,
  onRetry,
}: {
  session: RcSessionView | null;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetry: (step: RcStepView) => void;
}) {
  const status = session?.status || "";
  const running = status === "RUNNING" || status === "WAITING_CONFIRM";
  const steps = session?.steps ?? [];

  return (
    <Drawer
      open={!!session}
      onClose={onClose}
      size={680}
      title={session ? `会话 #${session.id} · ${session.deviceName}` : ""}
      destroyOnHidden
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} loading={busy}>
            刷新
          </Button>
          {running ? (
            <Button size="small" icon={<PauseOutlined />} onClick={onPause}>
              暂停
            </Button>
          ) : status === "PAUSED" ? (
            <Button size="small" icon={<CaretRightOutlined />} onClick={onResume}>
              继续
            </Button>
          ) : null}
          {running || status === "PAUSED" ? (
            <Button size="small" danger icon={<StopOutlined />} onClick={onStop}>
              停止
            </Button>
          ) : null}
        </Space>
      }
    >
      {session ? (
        <>
          <div className="ext-detail" style={{ marginBottom: 12 }}>
            <div className="ext-detail-row">
              <span className="ext-detail-label">目标</span>
              <span>{session.goal}</span>
            </div>
            <div className="ext-detail-row">
              <span className="ext-detail-label">状态</span>
              <span>
                <Tag color={rcSessionColor(session.status)}>
                  {session.statusLabel || session.status}
                </Tag>
                {`第 ${session.stepCount}/${session.maxSteps} 步`}
              </span>
            </div>
            <div className="ext-detail-row">
              <span className="ext-detail-label">模型</span>
              <span>{session.model || "—"}</span>
            </div>
            {session.stopReason ? (
              <div className="ext-detail-row">
                <span className="ext-detail-label">结束原因</span>
                <span>{session.stopReason}</span>
              </div>
            ) : null}
          </div>

          {steps.length ? (
            <div className="rc-steps">
              {steps.map((step) => (
                <div className="rc-step" key={step.id}>
                  <div className="rc-step-head">
                    <span>
                      第 {step.stepIndex + 1} 步
                      <span className="text-12 muted" style={{ marginLeft: 6 }}>
                        {fmtTime(step.createdAt)}
                      </span>
                    </span>
                    <Tag color={rcSessionColor(step.status === "DONE" ? "COMPLETED" : step.status)}>
                      {step.status}
                    </Tag>
                  </div>
                  <div className="rc-step-action">{actionText(step.action)}</div>
                  {step.thought ? (
                    <div className="text-12 muted">理由：{step.thought}</div>
                  ) : null}
                  {step.errorMessage ? (
                    <div className="text-12" style={{ color: "var(--danger)" }}>
                      {step.errorMessage}
                    </div>
                  ) : null}
                  {step.screenshotUrl ? (
                    <a href={step.screenshotUrl} target="_blank" rel="noreferrer">
                      <RawImg
                        className="rc-step-shot"
                        src={step.screenshotUrl}
                        alt={`第 ${step.stepIndex + 1} 步截图`}
                        loading="lazy"
                      />
                    </a>
                  ) : null}
                  {step.status === "FAILED" ? (
                    <Tooltip title="只有已暂停或失败的会话可重试某步">
                      <Button size="small" onClick={() => onRetry(step)}>
                        重试这一步
                      </Button>
                    </Tooltip>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <Empty description="还没有执行的步骤" />
          )}
        </>
      ) : null}
    </Drawer>
  );
}
