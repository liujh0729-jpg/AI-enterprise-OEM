import {
  RC_ACTION_LABELS,
  RC_DEVICE_STATUS_LABELS,
  RC_SESSION_STATUSES,
  RC_SESSION_STATUS_LABELS,
  type RcDeviceView,
  type RcSessionView,
  type RcSettings,
  type RcStepView,
  endpoints,
} from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/**
 * 本地 Chrome 插件 RPA 的界面层（登录态）：RPA「本地RPA状态」页签与顶栏状态灯共用这一份。
 * 后端：/enterprise/rpa/chrome/*（设备清单 + 会话引擎）。设备通道（插件用、免登录）不在前端。
 */

const api = {
  devices: endpoint(endpoints.RpaChrome_devices),
  setDevice: endpoint(endpoints.RpaChrome_setDevice),
  removeDevice: endpoint(endpoints.RpaChrome_removeDevice),
  sessions: endpoint(endpoints.RpaChrome_sessions),
  activeSessions: endpoint(endpoints.RpaChrome_activeSessions),
  session: endpoint(endpoints.RpaChrome_session),
  startSession: endpoint(endpoints.RpaChrome_startSession),
  pauseSession: endpoint(endpoints.RpaChrome_pauseSession),
  resumeSession: endpoint(endpoints.RpaChrome_resumeSession),
  stopSession: endpoint(endpoints.RpaChrome_stopSession),
  retryStep: endpoint(endpoints.RpaChrome_retryStep),
  settings: endpoint(endpoints.RpaChrome_settings),
  saveSettings: endpoint(endpoints.RpaChrome_saveSettings),
};

export type { RcDeviceView, RcSessionView, RcSettings, RcStepView };
export {
  RC_ACTION_LABELS,
  RC_DEVICE_STATUS_LABELS,
  RC_SESSION_STATUSES,
  RC_SESSION_STATUS_LABELS,
};

/** 设备在线态 → antd Badge 状态点：绿=在线，灰=离线，红=已停用（被撤销/停用）。 */
export function rcDeviceBadge(
  device: Pick<RcDeviceView, "status" | "online">,
): "success" | "default" | "error" {
  if (device.status === "DISABLED") return "error";
  return device.online ? "success" : "default";
}

/** 会话状态 → 页面 badge 颜色（与任务/执行记录同一套取值）。 */
export function rcSessionColor(status: string): string {
  if (status === "RUNNING") return "processing";
  if (status === "WAITING_CONFIRM" || status === "TIMEOUT") return "warning";
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "error";
  return "default";
}

/**
 * 取数：失败不抛错，交页面提示（与 rpa/_components/common.ts 同口径）。
 * 契约信封里 `data` 可空，故入参按 `Promise<T | null>` 收。
 */
async function load<T>(work: Promise<T | null>): Promise<{
  data: T | null;
  message: string;
}> {
  try {
    return { data: await work, message: "" };
  } catch (error) {
    return { data: null, message: (error as Error).message || "加载失败" };
  }
}

/** 写操作：失败抛出后端文案，由调用方 message.error（信封可空，非空断言在调用侧）。 */
async function mutate<T>(work: Promise<T | null>): Promise<T> {
  const data = await work;
  if (data === null) throw new Error("服务端没有返回结果");
  return data;
}

const ALL = { page: 1, pageSize: 200 };

export const rpaChromeApi = {
  devices: () =>
    load<{ devices: RcDeviceView[]; settings: RcSettings }>(api.devices({})),
  setDevice: (clientId: string, enabled: boolean) =>
    mutate(api.setDevice({ params: { clientId }, body: { enabled } })),
  removeDevice: (clientId: string) =>
    mutate(api.removeDevice({ params: { clientId } })),

  sessions: (clientId?: string) =>
    load<{ list: RcSessionView[]; total: number }>(
      api.sessions({ query: { ...ALL, ...(clientId ? { clientId } : {}) } }),
    ),
  activeSessions: (clientId?: string) =>
    api.activeSessions({ query: clientId ? { clientId } : {} }),
  session: (id: number) =>
    load<{ session: RcSessionView }>(api.session({ params: { id: String(id) } })),
  startSession: (body: Record<string, unknown>) =>
    mutate(api.startSession({ body })),
  pauseSession: (id: number) =>
    mutate(api.pauseSession({ params: { id: String(id) } })),
  resumeSession: (id: number) =>
    mutate(api.resumeSession({ params: { id: String(id) } })),
  stopSession: (id: number) =>
    mutate(api.stopSession({ params: { id: String(id) } })),
  retryStep: (id: number) => mutate(api.retryStep({ params: { id: String(id) } })),

  settings: () => load<RcSettings>(api.settings({})),
  saveSettings: (body: Record<string, unknown>) =>
    mutate(api.saveSettings({ body })),
};

/** 在线设备清单（顶栏状态灯与任务表单共用）。 */
export function onlineChromeDevices(devices: RcDeviceView[]): RcDeviceView[] {
  return devices.filter((device) => device.online);
}
