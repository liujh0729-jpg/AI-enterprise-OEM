// 桥接脚本：注入到所有网页，但只在页面按约定 postMessage 时才动作。
// 统一通信协议（§10.7）：页面 → 插件 { source:'aipdd-page', type:'task', jobId, task:{ capability, action, payload } }，
//                        插件 → 页面 { source:'aipdd-extension', type:'receipt', receipt:{ ... } }。
// 存量消息名（distribute / collect / outreach / collect-metrics 等）继续保留：适配层把统一任务
// 路由到同一条后台链路，执行终态再翻译成统一回执，业务页面据此逐步从旧消息名迁移过来。
// 页面 → 插件：window.postMessage({ source: 'aipdd-page', type: 'distribute' | 'collect' | 'outreach' | 'collect-metrics' | ..., payload })
// 插件 → 页面：window.postMessage({ source: 'aipdd-extension', type: 'result' | 'metrics' | 'harvest' | 'outreach-result' | 'acq-state', ... })
// 页面侧实现见前端「营销工具 → 多平台内容分发」与「营销工具 → AI 获客」的使用说明。
(() => {
  if (window.__AIPDD_ENTERPRISE_BRIDGE__) return;
  window.__AIPDD_ENTERPRISE_BRIDGE__ = true;

  const post = (payload) => window.postMessage({ source: "aipdd-extension", ...payload }, window.location.origin);

  // ---------- 统一通信协议（§10.7 / §10.10）----------
  // 协议版本与契约 BROWSER_TASK_PROTOCOL_VERSION 对齐；页面按 pong 里的版本决定走新通道还是旧消息名。
  const PROTOCOL_VERSION = 1;

  // 「能力:动作」→ 后台消息路由：只放行已登记动作，未知能力/动作一律拒绝（不下发脚本）。
  const TASK_ROUTES = {
    "distribution:fill": { type: "AIPDD_DISTRIBUTE" },
    "distribution:publish": { type: "AIPDD_DISTRIBUTE" },
    "distribution:metrics": { type: "AIPDD_METRICS_REFRESH" },
    "acquisition:collect": { type: "AIPDD_ACQ_START", taskType: "collect" },
    "acquisition:outreach": { type: "AIPDD_ACQ_START", taskType: "outreach" },
    "acquisition:metrics": { type: "AIPDD_METRICS_REFRESH" },
  };

  // 经统一通道下发的任务：等执行终态到达时翻译成统一回执（内容脚本随页面存活，页面关闭即随之丢弃，不影响旧链路）。
  const unifiedTasks = new Map();

  // 逐条结果口径（与契约 BROWSER_RESULT_STATUSES 对齐；插件为纯 JS 不能直接引用契约）。
  // 已填充 FILLED / 已提交 SUBMITTED / 已核实 VERIFIED / 失败 FAILED / 跳过 SKIPPED。
  const DIST_LOG_STATUS = { SUCCESS: "SUBMITTED", FILLED: "FILLED", FAILED: "FAILED" };
  const ACQ_STOP_CODE = {
    NEED_LOGIN: "NEED_LOGIN",
    CAPTCHA: "CAPTCHA",
    RISK_CONTROL: "RISK_CONTROL",
    PAGE_CHANGED: "PLATFORM_CHANGED",
    USER_STOPPED: "CANCELLED",
  };

  const succeeded = (status) => status === "SUBMITTED" || status === "VERIFIED";

  // 站点授权声明：契约 sitePermissions 里声明的 origin，只有用户已在插件弹窗中授权才登记内容脚本。
  // 替代原先「所有网页都注入桥」——未授权的站点上根本不加载本插件，也收不到页面的 postMessage。
  const SITE_PATTERNS = {
    distribution: [
      "https://weibo.com/*",
      "https://creator.xiaohongshu.com/*",
      "https://creator.douyin.com/*",
      "https://zhuanlan.zhihu.com/*",
      "https://mp.toutiao.com/*",
      "https://cp.kuaishou.com/*",
      "https://channels.weixin.qq.com/*",
      "https://wx.zsxq.com/*",
      "https://mp.weixin.qq.com/*",
      "https://baijiahao.baidu.com/*",
      "https://member.bilibili.com/*",
      "https://www.jianshu.com/*",
      "https://www.douban.com/*",
    ],
    acquisition: [
      "https://www.xiaohongshu.com/*",
      "https://www.douyin.com/*",
      "https://www.zhihu.com/*",
      "https://weibo.com/*",
      "https://www.bilibili.com/*",
      "https://channels.weixin.qq.com/*",
      "https://mp.weixin.qq.com/*",
      "https://www.tiktok.com/*",
      "https://x.com/*",
      "https://www.kuaishou.com/*",
    ],
  };
  const ALL_SITE_PATTERNS = Array.from(
    new Set([...SITE_PATTERNS.distribution, ...SITE_PATTERNS.acquisition]),
  );

  /** 当前页面是否落在某个已声明能力站点（未声明站点不注入，避免向任意网页暴露消息通道）。 */
  function siteCapabilities() {
    const origin = `${window.location.origin}/*`;
    return Object.keys(SITE_PATTERNS).filter((key) => SITE_PATTERNS[key].includes(origin));
  }

  /** 由逐条结果汇总信封状态：无结果＝ACCEPTED，全成功＝SUCCESS，全失败＝FAILED，其余＝PARTIAL。 */
  function aggregateStatus(list) {
    const statuses = list.map((item) => String(item?.status || "")).filter(Boolean);
    if (!statuses.length) return "ACCEPTED";
    const ok = statuses.filter(succeeded).length;
    if (ok === statuses.length) return "SUCCESS";
    if (ok === 0 && statuses.every((s) => s === "FAILED")) return "FAILED";
    return "PARTIAL";
  }

  /** 获客终态 → 信封状态：优先用服务端回执口径，其次用任务状态，最后按是否有错误兜底。 */
  function acqReceiptStatus(payload) {
    const receipt = String(payload.receipt || "");
    if (receipt === "succeeded" || receipt === "submitted") return "SUCCESS";
    if (receipt === "failed") return "FAILED";
    if (receipt === "unknown") return "UNKNOWN";
    const status = String(payload.status || "");
    if (status === "failed" || status === "FAILED") return "FAILED";
    if (status === "partial") return "PARTIAL";
    if (status === "stopped" || status === "STOPPED") return "UNKNOWN";
    if (payload.error) return "PARTIAL";
    return "SUCCESS";
  }

  /** 只对「经统一通道下发」的任务回统一回执，旧消息名发起的任务不重复回报，避免双份台账。 */
  function emitReceipt(jobId, patch) {
    const pending = unifiedTasks.get(jobId);
    if (!pending) return;
    unifiedTasks.delete(jobId);
    // 按契约字段长度裁剪，避免长文案把整条回执卡在页面侧校验之外。
    const clip = (value, max) => String(value || "").slice(0, max);
    post({
      type: "receipt",
      receipt: {
        protocolVersion: PROTOCOL_VERSION,
        capability: pending.capability,
        action: pending.action,
        jobId,
        status: patch.status || "UNKNOWN",
        code: clip(patch.code, 40),
        message: clip(patch.message, 500),
        results: patch.results || [],
        evidence: (patch.evidence || []).map((item) => ({
          kind: item.kind,
          value: clip(item.value, 2000),
          note: clip(item.note, 500),
        })),
        // 能力回执数据（获客的 runId / 新增线索 / 触达状态）：页面据此把统一回执落回原业务表。
        data: patch.data || {},
        pluginVersion: chrome.runtime.getManifest().version,
        at: new Date().toISOString(),
      },
    });
  }

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

  /** 生成站点权限模式（`https://a.com/x` → `https://a.com/*`），与服务端站点权限同口径。 */
  const patternOf = (url) => {
    try {
      const target = new URL(String(url || ""));
      if (target.protocol !== "http:" && target.protocol !== "https:") return "";
      return `${target.origin}/*`;
    } catch (_) {
      return "";
    }
  };

  /** 能力 → 站点清单（能力站点声明，与后台 DECLARED_SITES 同源，业务页读同一份展示）。 */
  const CAPABILITY_SITE_LISTS = SITE_PATTERNS;

  /** 读取站点授权状态：capability 为空时只答当前页面模式（弹窗据此决定按钮形态）。 */
  async function sitesStatus(capability) {
    const list = CAPABILITY_SITE_LISTS[capability];
    if (!list) return { ok: true, sites: [], granted: [] };
    const patterns = list.filter(
      (pattern) => CAPABILITY_SITE_LISTS[capability].includes(pattern),
    );
    let granted = [];
    try {
      // 逐个查：一次查全部任一项命中就返回 true，无法分辨具体缺哪些。
      for (const pattern of patterns) {
        if (await chrome.permissions.contains({ origins: [pattern] })) {
          granted.push(pattern);
        }
      }
    } catch (_) {
      granted = [];
    }
    return { ok: true, sites: patterns, granted };
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
        // 协议版本：页面据此决定走统一通道（task/receipt）还是回落旧消息名。
        protocolVersion: PROTOCOL_VERSION,
      });
      return;
    }

    // 统一任务通道：页面只发「能力 + 动作 + 参数」，插件只执行已登记动作，未知能力/动作直接拒绝。
    // 本桥只在声明的平台站点上加载（见背景的 ensureSiteAccess），其它站点根本不注入。
    if (data.type === "task") {
      const task = data.task && typeof data.task === "object" ? data.task : {};
      const capability = String(task.capability || "");
      const action = String(task.action || "");
      if (!siteCapabilities().includes(capability)) {
        post({
          type: "accepted",
          jobId,
          ok: false,
          errorMsg: `当前站点不属于「${capability}」的已声明站点，插件拒绝执行`,
          code: "UNTRUSTED_SITE",
          state: null,
        });
        return;
      }
      const route = TASK_ROUTES[`${capability}:${action}`];
      if (!route) {
        post({
          type: "accepted",
          jobId,
          ok: false,
          errorMsg: `插件不支持该能力或动作：${capability}/${action}，请升级到最新版`,
          code: "UNKNOWN_CAPABILITY",
          state: null,
        });
        return;
      }
      // 记下待回报的统一任务；执行终态到达时翻译成统一回执（旧消息名发起的任务不记录）。
      unifiedTasks.set(jobId, { capability, action });
      const taskPayload = { ...(task.payload || {}) };
      if (route.taskType) taskPayload.type = route.taskType;
      if (task.token) taskPayload.token = String(task.token);
      if (
        route.type === "AIPDD_DISTRIBUTE" &&
        Array.isArray(task.platforms) &&
        !taskPayload.platformCodes
      ) {
        taskPayload.platformCodes = task.platforms;
      }
      let ack;
      try {
        ack = await chrome.runtime.sendMessage({
          type: route.type,
          jobId,
          taskType: route.taskType,
          payload: taskPayload,
        });
      } catch (error) {
        ack = { ok: false, errorMsg: String(error?.message || error) };
      }
      if (!ack?.ok) unifiedTasks.delete(jobId);
      post({
        type: "accepted",
        jobId: ack?.state?.jobId || jobId,
        ok: Boolean(ack?.ok),
        errorMsg: String(ack?.errorMsg || ""),
        code: ack?.ok ? "" : "TASK_REJECTED",
        capability,
        action,
        state: ack?.state || null,
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

    // 回执补传：页面连上后拉插件本地队列里的待补结果，落库成功后回执清队。
    if (data.type === "receipts") {
      try {
        const ack = await chrome.runtime.sendMessage({ type: "AIPDD_PENDING_RECEIPTS" });
        post({ type: "receipts", jobId, ok: Boolean(ack?.ok), items: ack?.items || [] });
      } catch (error) {
        post({ type: "receipts", jobId, ok: false, items: [], errorMsg: String(error?.message || error) });
      }
      return;
    }

    if (data.type === "receipts-ack") {
      try {
        await chrome.runtime.sendMessage({
          type: "AIPDD_RECEIPTS_ACK",
          jobIds: Array.isArray(payload.jobIds) ? payload.jobIds : [],
        });
      } catch (_) {
        // 插件被禁用/更新中：清队失败无副作用，下次连上仍会补传（服务端幂等）。
      }
      return;
    }

    // 分发效果回流（D8）：页面点「刷新效果」后由后台回各平台创作中心读数，结果经 metrics 通道回送。
    if (data.type === "collect-metrics") {
      try {
        const ack = await chrome.runtime.sendMessage({
          type: "AIPDD_METRICS_REFRESH",
          jobId,
          contentId: Number(payload.contentId) || 0,
          items: Array.isArray(payload.items) ? payload.items : [],
        });
        post({ type: "accepted", jobId, ok: Boolean(ack?.ok), errorMsg: String(ack?.errorMsg || ""), state: null });
      } catch (error) {
        post({ type: "accepted", jobId, ok: false, errorMsg: String(error?.message || error), state: null });
      }
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
    // 后台逐平台分发结果 → 转发给页面（携 jobId + contentId，页面据此关联台账并落库）。
    if (message?.type === "AIPDD_RESULT") {
      const jobId = message.jobId || "";
      const logs = Array.isArray(message.logs) ? message.logs : [];
      post({
        type: "result",
        jobId,
        contentId: Number(message.contentId) || 0,
        logs,
      });
      // 统一通道下发的任务：把逐平台日志翻译成统一回执（已填充/已提交/已核实严格区分）。
      const results = logs.map((log) => ({
        platformCode: String(log?.platformCode || ""),
        status: DIST_LOG_STATUS[String(log?.status || "")] || "FAILED",
        publishedUrl: String(log?.publishedUrl || ""),
        errorMsg: String(log?.errorMsg || ""),
      }));
      emitReceipt(jobId, {
        status: aggregateStatus(results),
        code: "",
        message: String(results.find((item) => item.errorMsg)?.errorMsg || ""),
        results,
        evidence: results
          .filter((item) => item.publishedUrl)
          .map((item) => ({
            kind: "URL",
            value: item.publishedUrl,
            note: item.platformCode,
          })),
        data: { contentId: Number(message.contentId) || 0 },
      });
      return false;
    }
    // 效果回流结果（D8）→ 转发给页面（携 jobId + 逐平台效果，页面按内容+平台幂等回写）。
    if (message?.type === "AIPDD_METRICS_RESULT") {
      const jobId = message.jobId || "";
      const metrics = Array.isArray(message.metrics) ? message.metrics : [];
      post({
        type: "metrics",
        jobId,
        ok: true,
        metrics,
      });
      const results = metrics.map((metric) => ({
        platformCode: String(metric?.platformCode || ""),
        status: metric?.errorMsg ? "FAILED" : "VERIFIED",
        views: Number(metric?.views) || 0,
        likes: Number(metric?.likes) || 0,
        comments: Number(metric?.comments) || 0,
        errorMsg: String(metric?.errorMsg || ""),
      }));
      emitReceipt(jobId, {
        status: aggregateStatus(results),
        code: "",
        message: String(results.find((item) => item.errorMsg)?.errorMsg || ""),
        results,
      });
      return false;
    }
    // 获客进度/状态 → 原样转发（harvest / outreach-result / acq-state / acq-unknown）。
    if (message?.type === "AIPDD_ACQ_EVENT") {
      const payload = { ...message, type: String(message.event || "acq-state") };
      delete payload.event;
      post(payload);
      const jobId = String(payload.jobId || "");
      const failed = String(payload.status || "") === "failed";
      const receiptData = {
        runId: Number(payload.runId) || 0,
        outreachId: Number(payload.outreachId) || 0,
        newLeads: Number(payload.newLeads) || 0,
        receipt: String(payload.receipt || ""),
        receiptRef: String(payload.receiptRef || ""),
        stopReason: String(payload.stopReason || ""),
      };
      // 终态才翻译统一回执；逐条线索仍走上面的 harvest / outreach-result 事件（信息更全，不重复回报）。
      if (payload.type === "harvest" && payload.done) {
        emitReceipt(jobId, {
          status: acqReceiptStatus(payload),
          code: ACQ_STOP_CODE[payload.stopReason] || (failed ? "INTERNAL" : ""),
          message: String(payload.error || ""),
          results: [],
          data: receiptData,
        });
      } else if (payload.type === "outreach-result") {
        emitReceipt(jobId, {
          status: acqReceiptStatus(payload),
          code: ACQ_STOP_CODE[payload.stopReason] || (failed ? "INTERNAL" : ""),
          message: String(payload.error || ""),
          results: [],
          data: receiptData,
        });
      } else if (payload.type === "acq-unknown") {
        emitReceipt(jobId, {
          status: "UNKNOWN",
          code: "UNKNOWN_RESULT",
          message: String(payload.error || ""),
          results: [],
          data: receiptData,
        });
      }
      return false;
    }
    return false;
  });
})();