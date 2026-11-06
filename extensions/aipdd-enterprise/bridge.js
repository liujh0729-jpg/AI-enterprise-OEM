// 桥接脚本：注入到所有网页，但只在页面按约定 postMessage 时才动作。
// 页面 → 插件：window.postMessage({ source: 'aipdd-page', type: 'distribute', payload })
// 插件 → 页面：window.postMessage({ source: 'aipdd-extension', type: 'result', logs })
// 页面侧实现见前端「营销工具 → 多平台内容分发」的使用说明。
(() => {
  if (window.__AIPDD_ENTERPRISE_BRIDGE__) return;
  window.__AIPDD_ENTERPRISE_BRIDGE__ = true;

  // 页面握手：探测插件是否安装（前端页面据此提示「未检测到插件」）。
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    // 同帧同源护栏：只处理与当前页面 origin 完全一致的发件方，避免 iframe 嵌景伪造握手。
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "aipdd-page") return;

    if (data.type === "ping") {
      window.postMessage(
        {
          source: "aipdd-extension",
          type: "pong",
          // 版本直接读 manifest，避免写死后升级插件时握手回报与真实版本脱节。
          version: chrome.runtime.getManifest().version,
        },
        window.location.origin,
      );
      return;
    }

    if (data.type === "distribute") {
      try {
        const ack = await chrome.runtime.sendMessage({
          type: "AIPDD_DISTRIBUTE",
          jobId: data.jobId || "",
          payload: data.payload || {},
        });
        window.postMessage(
          {
            source: "aipdd-extension",
            type: "accepted",
            jobId: data.jobId || ack?.jobId || "",
            ok: Boolean(ack?.ok),
            errorMsg: String(ack?.errorMsg || ""),
          },
          window.location.origin,
        );
      } catch (error) {
        window.postMessage(
          {
            source: "aipdd-extension",
            type: "accepted",
            jobId: data.jobId || "",
            ok: false,
            errorMsg: String(error?.message || error),
          },
          window.location.origin,
        );
      }
    }
  });

  // 后台逐平台结果 → 转发给页面（携 jobId，页面据此区分是哪一次分发）。
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "AIPDD_RESULT") {
      window.postMessage(
        {
          source: "aipdd-extension",
          type: "result",
          jobId: message.jobId || "",
          logs: message.logs || [],
        },
        window.location.origin,
      );
    }
    return false;
  });
})();
