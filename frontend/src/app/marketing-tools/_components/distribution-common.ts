import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/**
 * 多平台内容分发的界面层：台账 CRUD / 分发标记 / 结果回写都走 /enterprise/distribution/*（登录态）。
 * 与 AIPDD Enterprise 浏览器插件的通信约定（插件 bridge.js 按同一份协议实现）：
 *   页面 → 插件：window.postMessage({ source: 'aipdd-page', type: 'ping' | 'distribute', jobId, payload })
 *   插件 → 页面：window.postMessage({ source: 'aipdd-extension', type: 'pong' | 'accepted' | 'result', ... })
 */

export const distributionApi = {
  meta: endpoint(endpoints.Distribution_meta),
  page: endpoint(endpoints.Distribution_page),
  create: endpoint(endpoints.Distribution_create),
  update: endpoint(endpoints.Distribution_update),
  remove: endpoint(endpoints.Distribution_remove),
  detail: endpoint(endpoints.Distribution_detail),
  mark: endpoint(endpoints.Distribution_mark),
  reportLogs: endpoint(endpoints.Distribution_reportLogs),
};

/** 一次分发任务的载荷：与插件 background 的 AIPDD_DISTRIBUTE payload 同构。 */
export type DistributePayload = {
  title: string;
  content: string;
  images: { name: string; url: string }[];
  platformCodes: string[];
  autoPublish: boolean;
};

export type ExtensionPing = { version: string } | null;

function randomJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 只认插件消息：既要 data.source 对，也要发件方是本帧同源。
 * 与扩展 bridge.js 的入站护栏对齐（event.source === window && event.origin === location.origin），
 * 挡掉跨源 iframe / 其他窗口伪造 pong·accepted·result（单看 data.source 任何脚本都能贴）。
 */
function isTrustedExtensionMessage(event: MessageEvent): boolean {
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
      resolve({ version: String(data.version || "") });
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "aipdd-page", type: "ping" }, window.location.origin);
  });
}

/**
 * 把任务推给插件：resolved 表示「插件已接单」，逐平台结果由 onExtensionResult 异步送达；
 * 插件没装 / 拒单时 here 就失败，界面立刻提示，不必等超时。
 */
export function distributeViaExtension(
  payload: DistributePayload,
  timeoutMs = 10000,
): Promise<{ ok: boolean; errorMsg: string; jobId: string }> {
  const jobId = randomJobId();
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
        jobId,
      });
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, errorMsg: "插件没有在限定时间内应答", jobId });
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "aipdd-page", type: "distribute", jobId, payload },
      window.location.origin,
    );
  });
}

/** 监听插件回送的逐平台结果（同 jobId 关联到具体一次分发）；返回取消订阅函数。 */
export function onExtensionResult(
  handler: (
    logs: {
      platformCode: string;
      status: string;
      publishedUrl: string;
      errorMsg: string;
    }[],
    jobId: string,
  ) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isTrustedExtensionMessage(event)) return;
    const data = event.data as Record<string, unknown>;
    if (data.type !== "result") return;
    handler(
      Array.isArray(data.logs) ? (data.logs as never) : [],
      String(data.jobId || ""),
    );
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
