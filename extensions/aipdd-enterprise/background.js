// AIPDD Enterprise 后台调度：一个插件同时承担「多平台内容分发」与「AI 获客（采集/触达）」。
// 分发：接收企业站页面推来的任务，逐平台开标签页让 publisher.js 在本地已登录的会话里填充/发布，
//       再把逐平台结果回送给来源标签页。
// 获客：acquisition.js 从服务端领任务，交给 collector.js / outreach.js 在本机执行。
// 账号凭据始终留在浏览器里，后台只搬运内容与结果，不做任何平台登录、不读取 Cookie。
// 站点权限：manifest 声明 `<all_urls>`，浏览器代理可在任意页面接管，无需逐站点信任。
// MV3 经典 Service Worker：importScripts 必须在顶层同步执行，获客模块与分发共用同一全局作用域。
importScripts("acquisition.js", "outreach.js", "chrome-rpa.js", "chrome-agent.js");

// 能力 → 允许执行平台动作的站点模式（与契约 EXTENSION_CAPABILITIES[*].sitePermissions 同源）。
// 插件是纯 JS 不能直接引用契约，这里按能力登记；发布新平台时两处同步，README「打包发布」有检查项。
const CAPABILITY_SITES = {
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

const PUBLISH_TARGETS = {
  weibo: "https://weibo.com/",
  xiaohongshu: "https://creator.xiaohongshu.com/publish/publish",
  douyin: "https://creator.douyin.com/creator-micro/content/upload",
  zhihu: "https://zhuanlan.zhihu.com/write",
  toutiao: "https://mp.toutiao.com/profile_v4/graphic/publish",
  kuaishou: "https://cp.kuaishou.com/",
  weixin_channels: "https://channels.weixin.qq.com/platform/post/create",
  zsxq: "https://wx.zsxq.com/",
  weixin: "https://mp.weixin.qq.com/",
  baijiahao: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
  bilibili: "https://member.bilibili.com/article-text/home?newArticle=true",
  jianshu: "https://www.jianshu.com/writer",
  douban: "https://www.douban.com/note/create",
};

// 效果回流（D8）：各平台「内容管理/创作中心」页——阅读/播放/点赞/评论在这里。
// 读不到就回落到该条内容的发布链接（详情页也有计数）；两处都读不到按 0 回报，不猜。
const METRIC_PAGES = {
  weibo: "https://weibo.com/",
  xiaohongshu: "https://creator.xiaohongshu.com/publish/note-manager",
  douyin: "https://creator.douyin.com/creator-micro/content/manage",
  zhihu: "https://www.zhihu.com/creator/manage/creation/all",
  toutiao: "https://mp.toutiao.com/profile_v4/graphic/articles",
  kuaishou: "https://cp.kuaishou.com/article/manage/video",
  weixin_channels: "https://channels.weixin.qq.com/platform/post/list",
  zsxq: "https://wx.zsxq.com/",
  weixin: "https://mp.weixin.qq.com/",
  baijiahao: "https://baijiahao.baidu.com/builder/rc/content?type=news",
  bilibili: "https://member.bilibili.com/platform/upload-manager/article",
  jianshu: "https://www.jianshu.com/",
  douban: "https://www.douban.com/",
};

/** 等平台标签页加载完成（pageshow 后 publisher.js 已就绪），带超时兜底。 */
function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === "complete") finish();
    });
  });
}

// ---------- 站点权限 ----------

/** 同时命中全部站点模式才算已授权；任一未勾选（用户在权限弹窗里取消）即视为未授权。 */
async function hasSites(origins) {
  const patterns = Array.isArray(origins) ? origins.filter(Boolean) : [];
  if (!patterns.length) return false;
  try {
    return await chrome.permissions.contains({ origins: patterns });
  } catch (_) {
    return false;
  }
}

/** URL → 能力站点模式（如 `https://zhuanlan.zhihu.com/write` → `https://zhuanlan.zhihu.com/*`）。 */
function sitePatternOf(url) {
  try {
    const target = new URL(url);
    if (target.protocol !== "http:" && target.protocol !== "https:") return "";
    return `${target.origin}/*`;
  } catch (_) {
    return "";
  }
}

/** 站点是否已由用户授权（可选的站点权限）：不给任何提示，供后台静默复核。 */
async function siteGranted(url) {
  return hasSites([sitePatternOf(url)]);
}

/** 派发前逐平台复核站点授权：任一目标平台没授权就不接单，页面据此提示去弹窗授权。 */
async function missingSites(capability, urls) {
  const sites = CAPABILITY_SITES[capability] || [];
  const missing = [];
  for (const url of urls) {
    const pattern = sitePatternOf(url);
    if (!pattern || !sites.includes(pattern)) continue;
    if (!(await hasSites([pattern]))) missing.push(pattern);
  }
  return missing;
}

/** 用户撤销站点权限后，该站点上可能还有在跑的分发/采集页：立即关闭，旧任务不能继续执行。 */
async function closeTabsOnOrigins(origins) {
  if (!Array.isArray(origins) || !origins.length) return 0;
  const prefixes = origins.map((pattern) => String(pattern).replace(/\*$/, ""));
  const tabs = await chrome.tabs.query({});
  let closed = 0;
  for (const tab of tabs) {
    const url = tab.url || "";
    if (url && prefixes.some((prefix) => url.startsWith(prefix))) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      closed += 1;
    }
  }
  return closed;
}

// 用户在浏览器扩展详情页直接改权限（不经弹窗按钮）：同样关闭受影响站点上的标签页。
// （监听在文件末尾统一登记，此处只定义辅助函数。）

/**
 * 分发 / 获客的平台站点声明：manifest 已申请 `<all_urls>`，浏览器代理可在任意页面接管，
 * 这里只用于把 bridge.js 内容脚本限定登记到这些平台页（页面发来的任务一律走统一通道）。
 * 声明清单与 bridge.js 的 SITE_PATTERNS、契约 EXTENSION_CAPABILITIES.sitePermissions 同源。
 */
const DECLARED_SITES = {
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
const BRIDGE_SCRIPT_ID = "aipdd-bridge";
let sitesReady = null;

async function ensureSiteAccess() {
  if (sitesReady) return sitesReady;
  sitesReady = (async () => {
    const declared = Array.from(
      new Set([...DECLARED_SITES.distribution, ...DECLARED_SITES.acquisition]),
    );
    // 声明站点在 `<all_urls>` 下已随安装授予：按声明清单登记内容脚本即可。
    const granted = [];
    for (const pattern of declared) {
      if (await chrome.permissions.contains({ origins: [pattern] }).catch(() => false)) {
        granted.push(pattern);
      }
    }
    const matches = granted.length ? granted : declared;
    const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
    if (existing.some((item) => item.id === BRIDGE_SCRIPT_ID)) {
      await chrome.scripting.updateContentScripts([
        { id: BRIDGE_SCRIPT_ID, matches },
      ]);
    } else {
      await chrome.scripting.registerContentScripts([
        {
          id: BRIDGE_SCRIPT_ID,
          matches,
          js: ["bridge.js"],
          runAt: "document_idle",
          allFrames: false,
        },
      ]);
    }
    return granted;
  })();
  return sitesReady;
}

void ensureSiteAccess();

chrome.runtime.onInstalled.addListener(() => {
  void ensureSiteAccess();
});

// ---------- 分发回执本地队列（P1-4）----------
// 页面关闭后结果无处可送：先把整批结果落到 chrome.storage.local，等下次有页面连上再补传。
// 服务端 reportLogs 按「内容 + 平台」覆盖写，重复补传天然幂等；页面落库成功后才回执清队。
const RECEIPT_QUEUE_KEY = "pendingReceipts";
const RECEIPT_QUEUE_MAX = 200;
const RECEIPT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

async function readReceiptQueue() {
  const stored = await chrome.storage.local.get(RECEIPT_QUEUE_KEY);
  const list = Array.isArray(stored?.[RECEIPT_QUEUE_KEY]) ? stored[RECEIPT_QUEUE_KEY] : [];
  const now = Date.now();
  return list.filter(
    (item) =>
      item &&
      typeof item.jobId === "string" &&
      item.jobId &&
      now - Number(item.at || 0) < RECEIPT_TTL_MS,
  );
}

async function enqueueReceipt(entry) {
  if (!entry.jobId) return;
  const list = await readReceiptQueue();
  if (list.some((item) => item.jobId === entry.jobId)) return;
  list.push(entry);
  await chrome.storage.local.set({
    [RECEIPT_QUEUE_KEY]: list.slice(-RECEIPT_QUEUE_MAX),
  });
}

async function ackReceipts(jobIds) {
  const drop = new Set((Array.isArray(jobIds) ? jobIds : []).map(String));
  if (!drop.size) return;
  const list = await readReceiptQueue();
  await chrome.storage.local.set({
    [RECEIPT_QUEUE_KEY]: list.filter((item) => !drop.has(String(item.jobId))),
  });
}

/** 后台拉图转 dataURL：平台页里直接 fetch 企业服务器会被 CORS 拦，后台有全量 host 权限。 */
async function toDataImages(images) {
  const list = Array.isArray(images) ? images : [];
  const result = [];
  for (const image of list) {
    const url = typeof image === "string" ? image : image?.url || "";
    if (!url) continue;
    let target;
    try {
      target = new URL(url);
    } catch (_) {
      continue;
    }
    // 协议白名单：只放行 http(s)，挡掉 chrome-extension / file / 内网元数据地址被当作图片入口探测（SSRF 收敛）。
    if (target.protocol !== "http:" && target.protocol !== "https:") continue;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error("读取失败"));
        reader.readAsDataURL(blob);
      });
      result.push({
        name: (typeof image === "object" && image?.name) || url.split("/").pop() || "image",
        dataUrl,
      });
    } catch (error) {
      // 单图拉取失败不阻断整批：平台页少图比不发强。
      console.warn("AIPDD: 图片拉取失败", url, error);
    }
  }
  return result;
}

/**
 * 读取单平台效果（D8）：开创作中心页让 metrics.js 读数，读不到再回落到发布链接页。
 * 只读 DOM，不下发任何写操作；页面未就绪/无匹配行时按 0 回报，不猜。
 */
async function collectPlatformMetric(item) {
  const code = String(item?.platformCode || "");
  const candidates = [METRIC_PAGES[code], item?.publishedUrl].filter(Boolean);
  if (!candidates.length) {
    return {
      platformCode: code,
      publishedItemId: item?.publishedItemId || "",
      views: 0,
      likes: 0,
      comments: 0,
      capturedAt: new Date().toISOString(),
      errorMsg: "没有可用于读取效果的平台页",
    };
  }
  let lastError = "";
  for (const url of candidates) {
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (error) {
      lastError = `打开效果页失败：${error?.message || error}`;
      continue;
    }
    await waitForTabComplete(tab.id);
    // 创作中心/详情页多是 SPA，首屏数据要等一会儿才渲染出来。
    await new Promise((r) => setTimeout(r, 2500));
    let result;
    try {
      result = await sendToPage(
        tab.id,
        { type: "AIPDD_METRICS", payload: item },
        ["metrics.js"],
      );
    } catch (error) {
      result = { ok: false, errorMsg: `效果读取脚本未就绪：${error?.message || error}` };
    }
    // 读数用的标签页一律读后即关；用户当前正在看的页不关。
    chrome.tabs.remove(tab.id).catch(() => undefined);
    if (result?.ok && result.metric) {
      const metric = result.metric;
      // 三个计数全 0 视为没读到（可能是页面改版或未登录），继续试下一个候选页。
      if (metric.views || metric.likes || metric.comments) return metric;
      lastError = "页面未读出效果数据";
      continue;
    }
    if (result?.code === "NEED_LOGIN" || result?.code === "CAPTCHA") {
      // 需要人工处理：不再试下一个页，避免连续开一堆登录墙标签页。
      return {
        platformCode: code,
        publishedItemId: item?.publishedItemId || "",
        views: 0,
        likes: 0,
        comments: 0,
        capturedAt: new Date().toISOString(),
        errorMsg: result.errorMsg || "需要人工处理",
      };
    }
    lastError = result?.errorMsg || lastError;
  }
  return {
    platformCode: code,
    publishedItemId: item?.publishedItemId || "",
    views: 0,
    likes: 0,
    comments: 0,
    capturedAt: new Date().toISOString(),
    errorMsg: lastError,
  };
}

/**
 * 在目标页投递指令：优先用内容脚本（声明的平台站点在加载时就会注入）；
 * 内容脚本没就绪（页面在注册之前就打开等）时，用动态脚本补一次；
 * 都失败就照实回报「脚本未就绪」，不静默失败、不伪造结果。
 */
async function sendToPage(tabId, message, sources) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // 内容脚本未就绪，继续走动态注入兜底
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: sources });
  return chrome.tabs.sendMessage(tabId, message);
}

/** 给某平台标签页下发填充指令，等 publisher.js 回报单平台结果。 */
async function runPlatform(code, task, sourceTabId) {  const url = PUBLISH_TARGETS[code];
  if (!url) {
    return {
      platformCode: code,
      status: "FAILED",
      publishedUrl: "",
      errorMsg: "插件不认识该平台，请升级到最新版",
    };
  }
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (error) {
    return {
      platformCode: code,
      status: "FAILED",
      publishedUrl: "",
      errorMsg: `打开平台页面失败：${error?.message || error}`,
    };
  }
  await waitForTabComplete(tab.id);
  // 平台 SPA 首屏渲染有延迟，稍等再投递，避免 publisher 找不到输入框。
  await new Promise((r) => setTimeout(r, 1500));
  // execCommand 只在前台窗口聚焦的标签页上可靠：投递前先把该页切到前台，
  // 填完再切回来源页（串行发布下用户看到的是平台页逐个闪过）。
  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300));
  let result;
  try {
    result = await sendToPage(
      tab.id,
      { type: "AIPDD_FILL", payload: { ...task, platformCode: code } },
      ["publisher.js", "bridge.js"],
    );
  } catch (error) {
    result = {
      platformCode: code,
      status: "FAILED",
      publishedUrl: "",
      errorMsg: `发布脚本未就绪：${error?.message || error}`,
    };
  }
  if (sourceTabId !== undefined) {
    chrome.tabs.update(sourceTabId, { active: true }).catch(() => undefined);
  }
  // 只有自动发布真正成功才关页；FILLED（仅填充待人工确认）与 FAILED 一律保留标签页。
  const status = result?.status || "FAILED";
  if (status === "SUCCESS") {
    setTimeout(() => {
      chrome.tabs.remove(tab.id).catch(() => undefined);
    }, 3000);
  } else if (status === "FILLED") {
    // 仅填充模式：把该标签页切到前台，用户手动确认发布；不再延时关闭，避免草稿随页丢失。
    // 页已在投递前激活过，这里只保证 FAILED 转人工等场景下也留在该页。
    chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
  }
  return {
    platformCode: code,
    status: result?.status || "FAILED",
    publishedUrl: result?.publishedUrl || "",
    errorMsg: result?.errorMsg || (result ? "" : "平台页无响应"),
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 本地 Chrome RPA 指令（登录/心跳/确认/停止/状态）：设备令牌通道，与分发/获客互不干扰。
  if (String(message?.type || "").startsWith("AIPDD_RPA_")) {
    return self.AIPDD_RPA.handle(message, sender, sendResponse);
  }
  // 获客指令（启动/续期/暂停/停止/查状态）交给 acquisition.js，分发链路保持原样。
  if (String(message?.type || "").startsWith("AIPDD_ACQ_")) {
    return self.AIPDD_ACQ.handle(message, sender, sendResponse);
  }
  // 侧边栏浏览器代理（启动/停止/状态/引导/敏感动作确认）：编排在插件，模型与工具在平台。
  if (String(message?.type || "").startsWith("AIPDD_AGENT_")) {
    return self.AIPDD_AGENT.handle(message, sender, sendResponse);
  }
  // 页面连上后拉取待补传的分发回执；落库成功由页面发 AIPDD_RECEIPTS_ACK 清队。
  if (message?.type === "AIPDD_PENDING_RECEIPTS") {
    readReceiptQueue()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => sendResponse({ ok: false, items: [], errorMsg: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "AIPDD_RECEIPTS_ACK") {
    ackReceipts(message.jobIds)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, errorMsg: String(error?.message || error) }));
    return true;
  }
  // 分发效果回流（D8）：页面点「刷新效果」后逐平台读创作中心，读到的经 AIPDD_METRICS_RESULT 回送。
  if (message?.type === "AIPDD_METRICS_REFRESH") {
    const sourceTabId = sender.tab?.id;
    const jobId = message.jobId || "";
    const contentId = Number(message.contentId) || 0;
    const items = Array.isArray(message.items) ? message.items : [];
    (async () => {
      // 效果回流要开各平台创作中心页：不在声明范围内就如实拒绝，不开空页乱跑。
      const targets = new Set();
      for (const item of items) {
        const code = String(item?.platformCode || "");
        targets.add(METRIC_PAGES[code] || "");
        targets.add(String(item?.publishedUrl || ""));
      }
      const missing = await missingSites("distribution", [...targets]);
      if (missing.length) {
        sendResponse({
          ok: false,
          jobId,
          code: "UNTRUSTED_SITE",
          errorMsg: `以下效果页不在插件可执行的声明范围内：${missing.join("、")}；请更新插件后重试`,
        });
        return;
      }
      sendResponse({ ok: true, jobId, errorMsg: "" });
      const metrics = [];
      for (const item of items) {
        metrics.push(await collectPlatformMetric(item));
      }
      if (sourceTabId !== undefined) {
        chrome.tabs
          .sendMessage(sourceTabId, { type: "AIPDD_METRICS_RESULT", jobId, contentId, metrics })
          .catch(() => undefined);
      }
    })();
    return true;
  }
  if (message?.type !== "AIPDD_DISTRIBUTE") return false;
  const task = message.payload || {};
  const codes = Array.isArray(task.platformCodes) ? task.platformCodes : [];
  const sourceTabId = sender.tab?.id;
  const jobId = message.jobId || task.jobId || "";
  const contentId = Number(task.contentId) || 0;
  (async () => {
    // 接单校验：来源是普通网页 + 平台清单非空且全部已登记 + 目标站点已授权，
    // 任一不满足即拒单，页面据此不会误置「已分发」。
    const valid = codes.length > 0 && codes.every((code) => Boolean(PUBLISH_TARGETS[code]));
    if (!valid) {
      sendResponse({ ok: false, accepted: 0, jobId, errorMsg: "没有可分发的平台（清单为空或含插件未登记的平台）" });
      return;
    }
    // content script 只在声明的平台站点注入：缺任一平台站点就不接单，
    // 否则会开出一串没有脚本的平台页，用户只看到「发布脚本未就绪」。
    const missing = await missingSites(
      "distribution",
      codes.map((code) => PUBLISH_TARGETS[code]),
    );
    if (missing.length) {
      sendResponse({
        ok: false,
        accepted: 0,
        jobId,
        code: "UNTRUSTED_SITE",
        errorMsg: `以下平台不在插件可执行的声明范围内：${missing.join("、")}；请更新插件后重试`,
      });
      return;
    }
    // 校验通过才同步应答接单（页面据此置台账为已分发），逐平台结果另走 AIPDD_RESULT 异步回送。
    // state 随应答带回 jobId 与台账 contentId：页面把它挂在本地队列条目上，补传时能落回台账。
    sendResponse({
      ok: true,
      accepted: codes.length,
      jobId,
      errorMsg: "",
      state: { jobId, contentId },
    });
    const images = await toDataImages(task.images);
    const filledTask = { ...task, images };
    const logs = [];
    for (const code of codes) {
      // 撤销授权（弹窗或扩展详情页）会关闭该站点标签页；开页前复核，旧任务不能继续执行。
      if (!(await siteGranted(PUBLISH_TARGETS[code]))) {
        logs.push({
          platformCode: code,
          status: "FAILED",
          publishedUrl: "",
          errorMsg: "站点授权已撤销，未继续执行",
        });
        continue;
      }
      // 串行发布：并行开多标签容易触发平台风控，也看不清哪个失败；
      // 单家串行耗时可达分钟级，页面侧的兜底定时器因此不解除关联、只作提示。
      logs.push(await runPlatform(code, filledTask, sourceTabId));
    }
    // 回送来源标签页（带 jobId 供页面精确关联台账），由页面调 reportLogs 落库并刷新界面。
    // 同时落本地队列：页面已关时这一条就是唯一的补传来源，页面落库成功后才会回执清队。
    await enqueueReceipt({ jobId, contentId, logs, at: Date.now() });
    if (sourceTabId !== undefined) {
      chrome.tabs
        .sendMessage(sourceTabId, {
          type: "AIPDD_RESULT",
          jobId,
          contentId,
          capability: "distribution",
          logs,
        })
        .catch(() => undefined);
    }
  })();
  return true; // 异步应答：保留消息通道直到 sendResponse
});

// 用户在扩展详情页收窄网站访问权限时：关闭受影响站点上还在跑的平台页，让变更即时生效——
// 旧任务不会在已收回权限的站点上继续填表或发布。
chrome.permissions.onRemoved.addListener((removed) => {
  const origins = Array.isArray(removed?.origins) ? removed.origins : [];
  closeTabsOnOrigins(origins).catch(() => undefined);
});

// 工具栏图标直接拉开侧边栏（rtrvr 式）：设备登录收进侧边栏的账号浮层，
// 不再用 action.default_popup 弹一个浮动小窗——浮窗每次都要点开再关，操作链路太长。
void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => undefined);

// 快捷键 Alt+A（manifest.commands.open-side-panel）：打开浏览器代理侧边栏。
chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-side-panel") return;
  chrome.windows
    .getLastFocused({ populate: false })
    .then((win) => (win?.id == null ? undefined : chrome.sidePanel.open({ windowId: win.id })))
    .catch(() => undefined);
});
