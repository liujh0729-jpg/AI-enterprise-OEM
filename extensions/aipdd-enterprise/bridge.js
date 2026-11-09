// 桥接脚本：注入到所有网页，但只在页面按约定 postMessage 时才动作。
// 页面 → 插件：window.postMessage({ source: 'aipdd-page', type: 'distribute' | 'collect' | 'outreach' | ..., payload })
// 插件 → 页面：window.postMessage({ source: 'aipdd-extension', type: 'result' | 'harvest' | 'outreach-result' | 'acq-state', ... })
// 页面侧实现见前端「营销工具 → 多平台内容分发」与「营销工具 → AI 获客」的使用说明。
(() => {
  if (window.__AIPDD_ENTERPRISE_BRIDGE__) return;
  window.__AIPDD_ENTERPRISE_BRIDGE__ = true;

  const post = (payload) => window.postMessage({ source: "aipdd-extension", ...payload }, window.location.origin);

  /** 统一转发到后台并应答：后台不可用（插件被禁用/正在更新）时也要给页面一个明确失败。 */
  async function relay(jobId, message, extra = {}) {
    try {
      const ack = await chrome.runtime.sendMessage(message);
      post({
        type: "accepted",
        jobId: ack?.state?.jobId || jobId,
        ok: Boolean(ack?.ok),
        errorMsg: String(ack?.errorMsg || ""),
        ...extra,
        state: ack?.state || null,
      });
    } catch (error) {
      post({
        type: "accepted",
        jobId,
        ok: false,
        errorMsg: String(error?.message || error),
        ...extra,
        state: null,
      });
    }
  }

  // 页面握手：探测插件是否安装（前端页面据此提示「未检测到插件」）。
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    // 同帧同源护栏：只处理与当前页面 origin 完全一致的发件方，避免 iframe 嵌景伪造握手。
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "aipdd-page") return;
    const jobId = String(data.jobId || "");
    const payload = data.payload || {};

    if (data.type === "ping") {
      post({
        type: "pong",
        // 版本直接读 manifest，避免写死后升级插件时握手回报与真实版本脱节。
        version: chrome.runtime.getManifest().version,
      });
      return;
    }

    if (data.type === "distribute") {
      await relay(jobId, {
        type: "AIPDD_DISTRIBUTE",
        jobId,
        payload,
      });
      return;
    }

    // 获客：采集与触达共用同一条启动通道，任务类型由 payload.type 决定，
    // apiBase / token 由页面签发，后台还会校验 apiBase 必须与本页同源。
    if (data.type === "collect" || data.type === "outreach") {
      await relay(jobId, {
        type: "AIPDD_ACQ_START",
        jobId,
        taskType: data.type,
        payload: { ...payload, type: data.type },
      });
      return;
    }

    // 令牌只有 5 分钟：长任务跑到一半由页面重新签发，续期不重启任务、不丢已采到的结果。
    if (data.type === "acq-token") {
      await relay(jobId, { type: "AIPDD_ACQ_TOKEN", token: String(payload.token || "") });
      return;
    }

    if (data.type === "acq-control") {
      const action = String(payload.action || "");
      const type = action === "stop" ? "AIPDD_ACQ_STOP" : action === "pause" ? "AIPDD_ACQ_PAUSE" : "";
      if (!type) {
        post({ type: "accepted", jobId, ok: false, errorMsg: `未知控制动作 ${action}`, state: null });
        return;
      }
      await relay(jobId, { type });
      return;
    }

    if (data.type === "acq-status") {
      await relay(jobId, { type: "AIPDD_ACQ_STATUS" });
      return;
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    // 后台逐平台分发结果 → 转发给页面（携 jobId，页面据此区分是哪一次分发）。
    if (message?.type === "AIPDD_RESULT") {
      post({
        type: "result",
        jobId: message.jobId || "",
        logs: message.logs || [],
      });
      return false;
    }
    // 获客进度/状态 → 原样转发（harvest / outreach-result / acq-state / acq-unknown）。
    if (message?.type === "AIPDD_ACQ_EVENT") {
      const payload = { ...message, type: String(message.event || "acq-state") };
      delete payload.event;
      post(payload);
      return false;
    }
    return false;
  });
})();