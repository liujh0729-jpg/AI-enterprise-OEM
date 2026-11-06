// AIPDD Enterprise 后台调度：接收企业站页面推来的分发任务，逐平台开标签页让
// publisher.js 在本地已登录的会话里填充/发布，再把逐平台结果回送给来源标签页。
// 账号凭据始终留在浏览器里，后台只搬运内容与结果，不做任何平台登录。

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

/**
 * 来源可信校验：bridge 注入在所有网页，任何站点都能 postMessage 触发分发，
 * 因此后台只接受「用户在插件弹窗里显式信任过」的站点 origin（存 chrome.storage.local）。
 */
async function isTrustedSender(sender) {
  const url = sender.tab?.url || sender.url || "";
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch (_) {
    return false;
  }
  if (!origin || origin === "null") return false;
  const stored = await chrome.storage.local.get("trustedOrigins");
  const list = Array.isArray(stored?.trustedOrigins) ? stored.trustedOrigins : [];
  return list.includes(origin);
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

/** 给某平台标签页下发填充指令，等 publisher.js 回报单平台结果。 */
async function runPlatform(code, task, sourceTabId) {
  const url = PUBLISH_TARGETS[code];
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
    result = await chrome.tabs.sendMessage(tab.id, {
      type: "AIPDD_FILL",
      payload: { ...task, platformCode: code },
    });
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
  if (message?.type !== "AIPDD_DISTRIBUTE") return false;
  const task = message.payload || {};
  const codes = Array.isArray(task.platformCodes) ? task.platformCodes : [];
  const sourceTabId = sender.tab?.id;
  const jobId = message.jobId || task.jobId || "";
  (async () => {
    // 接单三重校验：站点已信任 + 平台清单非空且全部已登记，任一不满足即拒单，页面据此不会误置「已分发」。
    const trusted = await isTrustedSender(sender);
    if (!trusted) {
      sendResponse({ ok: false, accepted: 0, jobId, errorMsg: "当前站点未被信任：请在 AIPDD Enterprise 插件弹窗中点「信任此站点」后重试" });
      return;
    }
    const valid = codes.length > 0 && codes.every((code) => Boolean(PUBLISH_TARGETS[code]));
    if (!valid) {
      sendResponse({ ok: false, accepted: 0, jobId, errorMsg: "没有可分发的平台（清单为空或含插件未登记的平台）" });
      return;
    }
    // 校验通过才同步应答接单（页面据此置台账为已分发），逐平台结果另走 AIPDD_RESULT 异步回送。
    sendResponse({ ok: true, accepted: codes.length, jobId, errorMsg: "" });
    const images = await toDataImages(task.images);
    const filledTask = { ...task, images };
    const logs = [];
    for (const code of codes) {
      // 串行发布：并行开多标签容易触发平台风控，也看不清哪个失败；
      // 单家串行耗时可达分钟级，页面侧的兜底定时器因此不解除关联、只作提示。
      logs.push(await runPlatform(code, filledTask, sourceTabId));
    }
    // 回送来源标签页（带 jobId 供页面精确关联台账），由页面调 reportLogs 落库并刷新界面。
    if (sourceTabId !== undefined) {
      chrome.tabs
        .sendMessage(sourceTabId, { type: "AIPDD_RESULT", jobId, logs })
        .catch(() => undefined);
    }
  })();
  return true; // 异步应答：保留消息通道直到 sendResponse
});
