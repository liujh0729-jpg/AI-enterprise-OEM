// 获客执行器（后台侧）：把服务端排好的「采集 / 触达」任务拉到本机浏览器执行，
// 复用用户已登录的平台会话。不读取、不导出 Cookie，不绕过验证码，遇登录墙/风控立即停。
// 由 background.js 顶部 importScripts 载入，与分发共用同一个 Service Worker 全局作用域，
// 因此这里直接调用 background.js 声明的 waitForTabComplete / sendToPage / missingSites。
(() => {
  if (self.AIPDD_ACQ) return;

  const IDLE_POLL_MS = 15000;
  const TOKEN_POLL_MS = 2000;
  const PAGE_SETTLE_MS = 1500;
  const FOCUS_SETTLE_MS = 300;
  const REPORT_CHUNK = 200;
  const HARD_MAX_ITEMS = 500;
  const TOKEN_REFRESH_MAX = 3;
  // 搜索页/账号页只负责给出内容链接，评论区要再开详情页才采得到：
  // 队列封顶避免一个批次跑成小时级，单页派生链接也封顶。
  const MAX_TARGETS = 20;
  const NEXT_URLS_PER_PAGE = 5;

  const STOP_LABELS = {
    NEED_LOGIN: "需要登录",
    CAPTCHA: "遇到验证码",
    RISK_CONTROL: "平台风控",
    PAGE_CHANGED: "页面结构变化",
    USER_STOPPED: "用户已停止",
    LIMIT_REACHED: "达到限额",
  };

  // 平台公开网页搜索入口。视频号没有公开搜索页，宁可如实停下也不伪造结果。
  const SEARCH_URLS = {
    XHS: (term) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(term)}`,
    DOUYIN: (term) => `https://www.douyin.com/search/${encodeURIComponent(term)}?type=general`,
    ZHIHU: (term) => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(term)}`,
    WEIBO: (term) => `https://s.weibo.com/weibo?q=${encodeURIComponent(term)}`,
    BILIBILI: (term) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(term)}`,
    WX_MP: (term) => `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(term)}`,
  };
  const NO_SEARCH_REASON = {
    WX_CHANNEL: "视频号没有公开网页搜索入口：请把监控源改成「指定内容评论」，填入可公开访问的视频页链接",
    TIKTOK: "TikTok 采集本期未开放",
    X: "X 采集本期未开放",
    KUAISHOU: "快手采集本期未开放",
  };

  // 任务类型 → 执行器。采集在这里注册，触达由 outreach.js 注册，桥两边都不认识业务细节。
  const runners = new Map();

  const state = {
    phase: "idle", // idle | running | paused | waiting-token | stopped
    type: "",
    jobId: "",
    apiBase: "",
    token: "",
    sourceTabId: undefined,
    done: 0,
    total: 0,
    newLeads: 0,
    message: "",
    stop: false,
    pause: false,
    needToken: false,
    intervalMin: 20,
    intervalMax: 60,
    tabs: [],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  const errMsg = (error) => String(error?.message || error || "未知错误");
  const int = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  };
  const clip = (value, max) => String(value == null ? "" : value).slice(0, max);
  const strList = (value) =>
    (Array.isArray(value) ? value : [])
      .map((item) => String(item == null ? "" : item).trim())
      .filter(Boolean);
  const uniq = (items) => [...new Set(items)];

  /** 与服务端 randomIntervalMs 同一口径：两次平台操作之间随机等待，避免固定节奏被风控识别。 */
  function randomInterval(minSeconds, maxSeconds) {
    const lo = Math.max(1, int(minSeconds, 20));
    const hi = Math.max(lo, int(maxSeconds, 60));
    return Math.round((lo + Math.random() * (hi - lo)) * 1000);
  }

  function post(event, extra) {
    if (state.sourceTabId === undefined) return;
    chrome.tabs
      .sendMessage(state.sourceTabId, {
        type: "AIPDD_ACQ_EVENT",
        event,
        jobId: state.jobId,
        ...extra,
      })
      .catch(() => undefined);
  }

  function broadcast(message) {
    if (message !== undefined) state.message = message;
    post("acq-state", {
      phase: state.phase,
      taskType: state.type,
      done: state.done,
      total: state.total,
      newLeads: state.newLeads,
      needToken: state.needToken,
      message: state.message,
    });
  }

  async function request(path, body) {
    const response = await fetch(`${state.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.code !== 0) {
      const error = new Error(String(payload?.message || `HTTP ${response.status}`));
      error.code = payload?.code ?? response.status;
      throw error;
    }
    return payload.data;
  }

  /**
   * 只在「服务端明确拒绝」（401 令牌过期）时换新令牌重发；
   * 网络中断这类结果未知的情况一律不重试，否则平台侧可能被重复执行。
   */
  async function api(path, body) {
    let payload = { ...body, token: state.token };
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request(path, payload);
      } catch (error) {
        if (error.code !== 401 || state.stop || attempt >= TOKEN_REFRESH_MAX) throw error;
        state.token = "";
        if (!(await waitToken())) throw error;
        payload = { ...body, token: state.token };
      }
    }
  }

  async function waitWhilePaused() {
    while (state.pause && !state.stop) await sleep(500);
  }

  /** 令牌只有 5 分钟：过期后挂起等页面重新签发，不擅自延长有效期、不停掉已采到的结果。 */
  async function waitToken() {
    state.phase = "waiting-token";
    state.needToken = true;
    broadcast("插件令牌已过期，等待获客页面重新签发…");
    while (!state.token && !state.stop) await sleep(TOKEN_POLL_MS);
    state.needToken = false;
    if (state.stop) return false;
    state.phase = state.pause ? "paused" : "running";
    broadcast("已重新连接，继续执行");
    return true;
  }

  async function report(job, body) {
    const payload = {
      jobId: clip(job?.jobId, 120),
      type: String(job?.type || state.type),
      runId: int(job?.runId),
      outreachId: int(job?.outreachId),
      status: body.status || "done",
      items: (Array.isArray(body.items) ? body.items : []).slice(0, REPORT_CHUNK),
      stats: body.stats || {},
      stopReason: clip(body.stopReason, 40),
      error: clip(body.error, 1000),
    };
    if (body.receiptStatus) payload.receiptStatus = body.receiptStatus;
    if (body.receiptRef) payload.receiptRef = clip(body.receiptRef, 160);
    try {
      const ack = await api("/enterprise/acquisition/plugin/report", payload);
      state.newLeads += int(ack?.newLeads, 0);
      return ack;
    } catch (error) {
      broadcast(`回执上报失败（结果未知，不自动重试）：${errMsg(error)}`);
      post("acq-unknown", { runId: int(job?.runId), outreachId: int(job?.outreachId), error: errMsg(error) });
      return null;
    }
  }

  const ctx = {
    stopped: () => state.stop,
    waitWhilePaused,
    interval: () => randomInterval(state.intervalMin, state.intervalMax),
    report,
    emit: post,
    trackTab: (tabId) => {
      if (!state.tabs.includes(tabId)) state.tabs.push(tabId);
    },
    forgetTab: (tabId) => {
      state.tabs = state.tabs.filter((item) => item !== tabId);
    },
    focusTab: (tabId) => chrome.tabs.update(tabId, { active: true }).catch(() => undefined),
    restore: () => {
      if (state.sourceTabId !== undefined) {
        chrome.tabs.update(state.sourceTabId, { active: true }).catch(() => undefined);
      }
    },
  };

  // ---------- 采集 ----------

  function isHttpUrl(raw) {
    try {
      const target = new URL(raw);
      return target.protocol === "http:" || target.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  /** 监控源 → 要打开的平台页清单。竞品名直接当搜索词（来源是品牌上下文的竞品名单）。 */
  function collectTargets(job) {
    const platform = String(job?.platform || "").toUpperCase();
    const mode = String(job?.mode || "KEYWORD").toUpperCase();
    const query = job?.query || {};
    if (mode === "URL" || mode === "ACCOUNT") {
      const raw = mode === "URL" ? [...strList(query.urls), ...strList(job?.urls)] : strList(query.accountUrls);
      const targets = uniq(raw.filter(isHttpUrl)).map((url) => ({
        url,
        kind: mode === "URL" ? "content" : "account",
      }));
      return { targets, reason: targets.length ? "" : "没有可打开的 http(s) 链接，请检查监控源里填的地址" };
    }
    const terms =
      mode === "COMPETITOR"
        ? strList(query.competitorIds)
        : mode === "TOPIC"
          ? strList(query.topicTags)
          : strList(query.keywords);
    if (!terms.length) return { targets: [], reason: "监控源没有填写搜索词" };
    const build = SEARCH_URLS[platform];
    if (!build) {
      return { targets: [], reason: NO_SEARCH_REASON[platform] || `插件暂不支持 ${platform} 的网页采集` };
    }
    return { targets: uniq(terms).map((term) => ({ url: build(term), kind: "search" })), reason: "" };
  }

  /** 条目按契约上限裁剪；平台统一用监控源声明的平台，避免页面里混入别的平台链接。 */
  function normalizeItems(raw, platform, remaining) {
    const list = Array.isArray(raw) ? raw : [];
    const items = [];
    for (const entry of list) {
      if (items.length >= remaining) break;
      if (!entry || typeof entry !== "object") continue;
      const url = clip(entry.url, 500).trim();
      const excerpt = clip(entry.excerpt, 4000).trim();
      if (!url && !excerpt) continue;
      items.push({
        platform: clip(platform, 20),
        platformUserId: clip(entry.platformUserId, 120).trim(),
        nickname: clip(entry.nickname, 120).trim(),
        profileUrl: clip(entry.profileUrl, 500).trim(),
        sourceType: ["SEARCH", "COMMENT", "POST", "PROFILE"].includes(entry.sourceType)
          ? entry.sourceType
          : "COMMENT",
        url,
        excerpt,
        metrics: entry.metrics && typeof entry.metrics === "object" ? entry.metrics : {},
        // 主页公开联系方式：collector 只给已公开可见字段，这里原样透传，服务端再收敛白名单。
        contacts: Array.isArray(entry.contacts) ? entry.contacts : [],
      });
    }
    return items;
  }

  async function harvestPage(job, target, remaining) {
    let tab;
    try {
      tab = await chrome.tabs.create({ url: target.url, active: false });
    } catch (error) {
      return { items: [], stopReason: "PAGE_CHANGED", error: `打开采集页失败：${errMsg(error)}` };
    }
    ctx.trackTab(tab.id);
    await waitForTabComplete(tab.id);
    await sleep(PAGE_SETTLE_MS);
    // 懒加载列表只在可见时渲染：与分发同一套做法，投递前切前台，结束后切回来源页。
    await ctx.focusTab(tab.id);
    await sleep(FOCUS_SETTLE_MS);
    let result;
    try {
      result = await sendToPage(
        tab.id,
        {
          type: "AIPDD_COLLECT",
          payload: {
            platform: String(job?.platform || ""),
            mode: String(job?.mode || ""),
            kind: target.kind,
            filters: job?.filters || {},
            limits: { ...(job?.limits || {}), maxItems: remaining },
          },
        },
        ["collector.js"],
      );
    } catch (error) {
      result = { items: [], stopReason: "PAGE_CHANGED", error: `采集脚本未就绪：${errMsg(error)}` };
    }
    const items = normalizeItems(result?.items, job?.platform, remaining);
    const stopReason = clip(result?.stopReason, 40);
    const blocked = Boolean(stopReason && stopReason !== "LIMIT_REACHED");
    if (blocked || (!items.length && result?.error)) {
      // 失败保留标签页并切到前台：用户就地登录 / 过验证码后可重新执行，草稿不随页丢失。
      ctx.restore();
      await ctx.focusTab(tab.id);
      return {
        items,
        nextUrls: [],
        stopReason: stopReason || "PAGE_CHANGED",
        error: clip(result?.error || STOP_LABELS[stopReason] || "采集页没有返回结果", 1000),
      };
    }
    ctx.restore();
    ctx.forgetTab(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => undefined);
    return {
      items,
      nextUrls: uniq(strList(result?.nextUrls).filter(isHttpUrl)).slice(0, NEXT_URLS_PER_PAGE),
      stopReason,
      error: clip(result?.error, 1000),
    };
  }

  async function runCollect(job) {
    const limits = job?.limits || {};
    const maxItems = Math.min(HARD_MAX_ITEMS, Math.max(1, int(limits.maxItems, 200)));
    const { targets, reason } = collectTargets(job);
    if (!targets.length) {
      return { status: "partial", stopReason: "PAGE_CHANGED", error: reason || "该监控源没有可执行的采集目标" };
    }
    const queue = targets.slice(0, MAX_TARGETS);
    const visited = new Set();
    const collected = [];
    let stopReason = "";
    let error = "";
    let blocked = false;
    for (let index = 0; index < queue.length; index += 1) {
      const target = queue[index];
      if (visited.has(target.url)) continue;
      visited.add(target.url);
      if (state.stop) {
        stopReason = "USER_STOPPED";
        break;
      }
      await waitWhilePaused();
      if (state.stop) {
        stopReason = "USER_STOPPED";
        break;
      }
      if (collected.length >= maxItems) {
        stopReason = "LIMIT_REACHED";
        break;
      }
      const outcome = await harvestPage(job, target, maxItems - collected.length);
      if (outcome.items.length) {
        collected.push(...outcome.items);
        post("harvest", { runId: int(job?.runId), items: outcome.items, done: false, error: "" });
      }
      // 每页都回执一次（哪怕是 0 条）：服务端按心跳判超时，空页不回执会被误判成插件掉线。
      await report(job, { status: "running", items: outcome.items });
      for (const url of outcome.nextUrls) {
        if (queue.length >= MAX_TARGETS) break;
        if (!visited.has(url) && !queue.some((item) => item.url === url)) {
          queue.push({ url, kind: "content" });
        }
      }
      if (outcome.stopReason && outcome.stopReason !== "LIMIT_REACHED") {
        stopReason = outcome.stopReason;
        error = outcome.error;
        blocked = true;
        break; // 登录墙/验证码/风控：立刻停，不再开下一个页面去撞
      }
      if (outcome.stopReason === "LIMIT_REACHED") stopReason = "LIMIT_REACHED";
      if (outcome.error) error = outcome.error;
      // 串行 + 随机间隔：每开一个平台页算一次操作；页内滚动只是等渲染，不另计操作。
      if (index < queue.length - 1) await sleep(ctx.interval());
    }
    if (collected.length >= maxItems && !stopReason) stopReason = "LIMIT_REACHED";
    const status = blocked
      ? "partial"
      : stopReason === "USER_STOPPED"
        ? "stopped"
        : collected.length
          ? "done"
          : "partial";
    if (!collected.length && !error) {
      error = "没有采到任何条目：可能是页面结构变化、未登录或该搜索词无结果";
    }
    return { status, stopReason, error: clip(error, 1000), collected: collected.length };
  }

  runners.set("collect", runCollect);

  // ---------- 调度 ----------

  async function runJob(job) {
    state.jobId = clip(job?.jobId, 120);
    const runner = runners.get(String(job?.type || ""));
    if (!runner) {
      await report(job, { status: "failed", error: `插件不支持 ${job?.type} 类任务，请升级到最新版` });
      state.done += 1;
      broadcast();
      return;
    }
    broadcast(`正在执行 ${state.jobId}`);
    let outcome;
    try {
      outcome = await runner(job);
    } catch (error) {
      outcome = { status: "failed", error: clip(errMsg(error), 1000) };
    }
    // 终态回执只发一次，且不再带条目（条目已在增量回执里入库），避免统计重复累加。
    const ack = await report(job, { ...outcome, items: [] });
    state.done += 1;
    post(state.type === "outreach" ? "outreach-result" : "harvest", {
      runId: int(job?.runId),
      outreachId: int(job?.outreachId),
      items: [],
      done: true,
      collected: int(outcome?.collected, 0),
      newLeads: state.newLeads,
      status: ack?.runStatus || ack?.outreachStatus || outcome.status,
      receipt: outcome?.receiptStatus || "",
      receiptRef: outcome?.receiptRef || "",
      stopReason: outcome?.stopReason || "",
      error: outcome?.error || "",
    });
    broadcast(
      outcome?.error
        ? `批次结束（${STOP_LABELS[outcome.stopReason] || outcome.status}）：${outcome.error}`
        : `批次结束：本次采到 ${int(outcome?.collected, 0)} 条`,
    );
  }

  /**
   * 执行前按任务的目标 URL 复核站点是否在声明范围内：不在范围就不开页，按 UNTRUSTED_SITE 停下。
   * 返回未覆盖的站点模式（空数组＝全部可执行）。
   */
  async function missingSitesOf(job) {
    const urls = [];
    if (job?.targetUrl) urls.push(String(job.targetUrl));
    for (const item of Array.isArray(job?.urls) ? job.urls : []) {
      urls.push(typeof item === "string" ? item : String(item?.url || ""));
    }
    return missingSites("acquisition", urls.filter(Boolean));
  }

  async function runLoop() {
    state.phase = "running";
    broadcast("已连接插件，开始领取任务");
    try {
      while (!state.stop) {
        await waitWhilePaused();
        if (state.stop) break;
        let pulled;
        try {
          pulled = await api("/enterprise/acquisition/plugin/pull", { type: state.type });
        } catch (error) {
          state.phase = "stopped";
          broadcast(`领取任务失败：${errMsg(error)}`);
          return;
        }
        state.intervalMin = int(pulled?.intervalMinSeconds, 20);
        state.intervalMax = int(pulled?.intervalMaxSeconds, 60);
        const jobs = Array.isArray(pulled?.jobs) ? pulled.jobs : [];
        if (!jobs.length) {
          await sleep(IDLE_POLL_MS);
          continue;
        }
        state.total += jobs.length;
        broadcast(`领到 ${jobs.length} 个任务，串行执行中`);
        for (const job of jobs) {
          if (state.stop) break;
          const missing = await missingSitesOf(job);
          if (missing.length) {
            // 站点不在插件声明范围内：不开空页、不猜结果，整体停下并如实提示。
            state.phase = "stopped";
            broadcast(
              `以下采集/触达站点不在插件可执行的声明范围内：${missing.join("、")}；请更新插件后重新连接`,
            );
            return;
          }
          await runJob(job);
          // 触达是真实对外动作：两次操作之间按服务端下发的区间随机等待，避免固定节奏。
          if (state.type === "outreach" && !state.stop) await sleep(ctx.interval());
        }
      }
    } finally {
      if (state.stop) {
        state.phase = "stopped";
        broadcast("已停止：不再领取新任务，已打开的平台页保留供人工接手");
      }
    }
  }

  function snapshot() {
    return {
      phase: state.phase,
      taskType: state.type,
      jobId: state.jobId,
      done: state.done,
      total: state.total,
      newLeads: state.newLeads,
      needToken: state.needToken,
      message: state.message,
      version: chrome.runtime.getManifest().version,
    };
  }

  /**
   * 启动前的两道校验：apiBase 必须是来源页自己的 origin
   * （否则恶意页能把令牌引到别的服务器）、任务类型已注册。
   * 站点权限在 runLoop 领取到具体任务后再按目标 URL 逐个复核（见 ensureTaskSites）。
   */
  async function start(message, sender) {
    const payload = message.payload || {};
    const taskType = String(payload.type || message.taskType || "");
    if (!runners.has(taskType)) {
      return { ok: false, errorMsg: `插件不支持 ${taskType || "该"} 类任务，请升级到最新版` };
    }
    const senderUrl = sender.tab?.url || sender.url || "";
    let senderOrigin = "";
    let apiBase = "";
    try {
      senderOrigin = new URL(senderUrl).origin;
      const target = new URL(String(payload.apiBase || ""));
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return { ok: false, errorMsg: "apiBase 必须是 http(s) 地址" };
      }
      // 保留路径前缀（线上后端挂在 /api/backend 下），只校验 origin 与来源页一致。
      apiBase = `${target.origin}${target.pathname.replace(/\/+$/, "")}`;
      if (target.origin !== senderOrigin) {
        return { ok: false, errorMsg: "apiBase 必须与当前站点同源，插件不把令牌发往第三方地址" };
      }
    } catch (_) {
      return { ok: false, errorMsg: "apiBase 无效" };
    }
    if (!senderOrigin || senderOrigin === "null") {
      return { ok: false, errorMsg: "apiBase 必须与当前站点同源，插件不把令牌发往第三方地址" };
    }
    const token = clip(payload.token, 200).trim();
    if (token.length < 8) return { ok: false, errorMsg: "缺少插件令牌：请在获客页面点「连接插件」" };
    if (state.phase === "running" || state.phase === "paused" || state.phase === "waiting-token") {
      return { ok: false, errorMsg: "已有获客任务在执行，请先停止再重新开始" };
    }
    state.type = taskType;
    state.apiBase = apiBase;
    state.token = token;
    state.sourceTabId = sender.tab?.id;
    state.jobId = clip(message.jobId, 120);
    state.done = 0;
    state.total = 0;
    state.newLeads = 0;
    state.stop = false;
    state.pause = false;
    state.needToken = false;
    state.tabs = [];
    state.phase = "running";
    // 先应答再跑：循环是分钟级的，页面拿到 ack 才把界面切到「执行中」。
    runLoop().catch((error) => {
      state.phase = "stopped";
      broadcast(`执行中断：${errMsg(error)}`);
    });
    return { ok: true, errorMsg: "", state: snapshot() };
  }

  function handle(message, sender, sendResponse) {
    const type = String(message?.type || "");
    if (!type.startsWith("AIPDD_ACQ_")) return false;
    (async () => {
      if (type === "AIPDD_ACQ_START") {
        sendResponse(await start(message, sender));
        return;
      }
      if (type === "AIPDD_ACQ_TOKEN") {
        const token = clip(message.token, 200).trim();
        if (token.length < 8) {
          sendResponse({ ok: false, errorMsg: "令牌无效" });
          return;
        }
        // 换令牌必须来自同一个来源页，别的标签页不能替它续期。
        if (state.sourceTabId !== undefined && sender.tab?.id !== state.sourceTabId) {
          sendResponse({ ok: false, errorMsg: "令牌只能由发起任务的页面续期" });
          return;
        }
        state.token = token;
        sendResponse({ ok: true, errorMsg: "", state: snapshot() });
        return;
      }
      if (type === "AIPDD_ACQ_PAUSE") {
        state.pause = !state.pause;
        state.phase = state.pause ? "paused" : state.phase === "paused" ? "running" : state.phase;
        broadcast(state.pause ? "已暂停：当前页面处理完后不再继续" : "已继续执行");
        sendResponse({ ok: true, errorMsg: "", state: snapshot() });
        return;
      }
      if (type === "AIPDD_ACQ_STOP") {
        state.stop = true;
        state.pause = false;
        // 令牌留着：当前页采到的条目还要发终态回执，清掉会让最后一批结果丢在半路。
        state.phase = "stopped";
        broadcast("已停止：不再领取新任务");
        sendResponse({ ok: true, errorMsg: "", state: snapshot() });
        return;
      }
      if (type === "AIPDD_ACQ_STATUS") {
        sendResponse({ ok: true, errorMsg: "", state: snapshot() });
        return;
      }
      sendResponse({ ok: false, errorMsg: `未知指令 ${type}` });
    })();
    return true;
  }

  self.AIPDD_ACQ = {
    handle,
    register: (taskType, runner) => runners.set(String(taskType), runner),
    snapshot,
    // 触达执行器要用同一套开页/等待/随机间隔逻辑，不再各写一份。
    helpers: { sleep, int, clip, strList, uniq, randomInterval, isHttpUrl, waitForTabComplete, ctx, state, STOP_LABELS },
  };
})();