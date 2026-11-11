import {
  BROWSER_TASK_PROTOCOL_VERSION,
  browserReceiptSchema,
  type BrowserReceipt,
  type BrowserTask,
} from "@enterprise/contracts";

/**
 * 与 AIPDD Enterprise 浏览器插件的页面侧通信（统一实例）：
 *   页面 → 插件：window.postMessage({ source: 'aipdd-page', type, jobId?, payload? })
 *   插件 → 页面：window.postMessage({ source: 'aipdd-extension', type, ... })
 * 协议实现见 extensions/aipdd-enterprise/bridge.js；顶部统一插件入口与营销工具共用这一份。
 *
 * 统一通信协议（§10.7）：页面只发「能力 + 动作 + 参数」（type: 'task'），插件回统一回执
 * （type: 'receipt'，携带状态/结果/证据/错误码/版本）。存量消息名（distribute/collect 等）
 * 由插件侧适配层兼容，页面侧优先走统一通道，未上报协议版本的旧插件自动回落。
 */

export type ExtensionPing = {
  version: string;
  /** 插件上报的协议版本；旧插件不上报＝0，页面据此回落兼容通道。 */
  protocolVersion: number;
} | null;

/** 插件是否支持统一任务通道（协议版本达标）。 */
export function supportsBrowserTask(ping: ExtensionPing): boolean {
  return !!ping && ping.protocolVersion >= BROWSER_TASK_PROTOCOL_VERSION;
}

/**
 * 只认插件消息：既要 data.source 对，也要发件方是本帧同源。
 * 与 bridge.js 的入站护栏对齐，挡掉跨源 iframe / 其他窗口伪造 pong。
 */
export function isTrustedExtensionMessage(event: MessageEvent): boolean {
  if (event.source !== window) return false;
  if (event.origin !== window.location.origin) return false;
  const data = event.data;
  return (
    !!data &&
    typeof data === "object" &&
    (data as Record<string, unknown>).source === "aipdd-extension"
  );
}

/** 探测插件是否安装：800ms 内没有 pong 就按未安装处理。 */
export function pingExtension(timeoutMs = 800): Promise<ExtensionPing> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedExtensionMessage(event)) return;
      const data = event.data as Record<string, unknown>;
      if (data.type !== "pong") return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve({
        version: String(data.version || ""),
        protocolVersion: Number(data.protocolVersion) || 0,
      });
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "aipdd-page", type: "ping" }, window.location.origin);
  });
}

/* ---------------------------------------------------------------- 统一任务通道 */

/** 插件对统一任务的接单应答（能力/动作被拒时 ok=false 且带 code）。 */
export type BrowserTaskAck = {
  ok: boolean;
  errorMsg: string;
  code: string;
  jobId: string;
  /** 插件回传的任务状态快照（如获客进度 state），无则为 null。 */
  state: Record<string, unknown> | null;
};

function randomJobId(capability: string) {
  return `${capability}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 下发一条统一浏览器任务：页面只发能力 + 动作 + 参数，不发任意脚本。
 * 接单应答（accepted）同步返回；执行结果另由 onBrowserReceipt 以统一回执送达。
 * onReceipt（可选）注册在该次任务上：回执到达时先交给它（用于把结果落回业务表），再交给全局订阅。
 */
export function sendBrowserTask(
  task: Omit<BrowserTask, "protocolVersion" | "jobId">,
  options: {
    timeoutMs?: number;
    jobId?: string;
    onReceipt?: (receipt: BrowserReceipt) => void;
  } = {},
): Promise<BrowserTaskAck> {
  const { timeoutMs = 15000, onReceipt } = options;
  const jobId = options.jobId || randomJobId(task.capability);
  const envelope: BrowserTask = {
    ...task,
    protocolVersion: BROWSER_TASK_PROTOCOL_VERSION,
    jobId,
    payload: task.payload ?? {},
  };
  const off = onReceipt ? onBrowserReceiptFor(jobId, onReceipt) : () => undefined;
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedExtensionMessage(event)) return;
      const data = event.data as Record<string, unknown>;
      if (data.type !== "accepted" || data.jobId !== jobId) return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve({
        ok: Boolean(data.ok),
        errorMsg: String(data.errorMsg || ""),
        code: String(data.code || ""),
        jobId,
        state:
          data.state && typeof data.state === "object"
            ? (data.state as Record<string, unknown>)
            : null,
      });
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      off();
      resolve({
        ok: false,
        errorMsg: "插件没有在限定时间内应答",
        code: "PLUGIN_UNRESPONSIVE",
        jobId,
        state: null,
      });
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "aipdd-page", type: "task", jobId, task: envelope },
      window.location.origin,
    );
  });
}

/** 订阅指定 jobId 的统一回执（只回调一次）：回执到达即自动退订。 */
export function onBrowserReceiptFor(
  jobId: string,
  handler: (receipt: BrowserReceipt) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isTrustedExtensionMessage(event)) return;
    const data = event.data as Record<string, unknown>;
    if (data.type !== "receipt") return;
    const parsed = browserReceiptSchema.safeParse(data.receipt);
    if (!parsed.success || parsed.data.jobId !== jobId) return;
    window.removeEventListener("message", onMessage);
    handler(parsed.data);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** 订阅插件推送的统一回执（已按协议校验，非法信封直接丢弃）；返回取消订阅函数。 */
export function onBrowserReceipt(
  handler: (receipt: BrowserReceipt) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isTrustedExtensionMessage(event)) return;
    const data = event.data as Record<string, unknown>;
    if (data.type !== "receipt") return;
    const parsed = browserReceiptSchema.safeParse(data.receipt);
    if (parsed.success) handler(parsed.data);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
