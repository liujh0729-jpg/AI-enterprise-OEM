// 浏览器代理侧边栏 Agent（方案 §四 D1：编排在插件、模型与工具在平台）。
// 由 background.js 顶部 importScripts 载入，与分发 / 获客 / 设备通道共用同一个 SW 全局作用域。
//
// 本模块只做「编排」：
//   1) 每一步读当前页面观测（闭集动作 snapshot，复用 rpa-executor.js 的页面地图）；
//   2) 把目标 + 观测 + 最近历史发到设备通道 /decide，由平台调一次本系统模型拿「下一步动作」；
//   3) 敏感动作先在侧边栏等本人点「允许本次」，再落到本机执行（与云端指令同一条执行路径）；
//   4) 全过程记成消息卡，侧边栏轮询读出渲染。
// 目标平台口令永不经过这里：只传「做什么」与页面观测，不读 Cookie、不碰登录态。
(() => {
  if (self.AIPDD_AGENT) return;

  const MAX_STEP_TIMEOUT_MS = 10 * 60_000; // 敏感动作等待人工确认的上限
  const MAX_CONSECUTIVE_FAILURES = 3;
  const MAX_MESSAGES = 200;
  const HISTORY_LINES = 6;
  const STEP_TIMEOUT_SECONDS_FALLBACK = 60;
  // 插件本地偏好（唯一键）：目前只有「执行方式」——autoRun=true 自动执行，false 确认后执行。
  const PREFS_KEY = "AIPDD_AGENT_PREFS";

  const phaseOf = {
    idle: "空闲",
    running: "执行中",
    "waiting-confirm": "等待你确认敏感动作",
    done: "已完成",
    stopped: "已停止",
    error: "出错停止",
  };

  const state = {
    running: false,
    phase: "idle",
    goal: "",
    mode: "act",
    modelKey: "",
    autoRun: false, // 执行方式：false＝确认后执行（先给方案等用户确认），true＝自动执行
    stepIndex: 0,
    maxSteps: 25,
    messages: [],
    attachments: [],
    pendingConfirm: null, // { action, stepIndex, thought }
    errorMsg: "",
    startedAt: 0,
    endedAt: 0,
  };

  // 录制态：录在页面里（rpa-executor.js），这里只留「哪一页、录了几步」的账。
  const recording = { on: false, tabId: 0, count: 0, actions: [] };

  let seq = 0;
  let localSessionId = 0;
  let stopRequested = false;
  let confirmResolver = null;
  // 幂等锚：同一会话内同 code 的平台工具只执行一次（另有 code 时生效）。
  const executedCodes = new Set();

  const errMsg = (error) => String((error && error.message) || error || "未知错误");
  const clip = (value, max) => String(value == null ? "" : value).slice(0, max);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

  function pushMessage(message) {
    seq += 1;
    const item = { seq, createdAt: new Date().toISOString(), role: "agent", kind: "text", content: "", payload: {}, ...message };
    state.messages.push(item);
    if (state.messages.length > MAX_MESSAGES) {
      state.messages.splice(0, state.messages.length - MAX_MESSAGES);
    }
    return item;
  }

  function setPhase(phase, errorMsgText) {
    state.phase = phase;
    if (errorMsgText !== undefined) state.errorMsg = errorMsgText;
  }

  function snapshot() {
    return {
      ok: true,
      running: state.running,
      phase: state.phase,
      phaseLabel: phaseOf[state.phase] || state.phase,
      goal: state.goal,
      mode: state.mode,
      modelKey: state.modelKey,
      autoRun: state.autoRun,
      stepIndex: state.stepIndex,
      maxSteps: state.maxSteps,
      messages: state.messages.slice(),
      attachments: state.attachments.slice(),
      pendingConfirm: state.pendingConfirm
        ? {
            stepIndex: state.pendingConfirm.stepIndex,
            action: state.pendingConfirm.action,
            plan: state.pendingConfirm.plan || "",
            thought: state.pendingConfirm.thought || "",
          }
        : null,
      errorMsg: state.errorMsg,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      recording: { on: recording.on, count: recording.count, tabId: recording.tabId },
    };
  }

  // 执行方式：true＝自动执行（跳过方案确认，直接动手）；false＝确认后执行（先给方案等用户点确认）。
  let prefsPromise = null;
  function loadPrefs() {
    prefsPromise = (async () => {
      try {
        const stored = await chrome.storage.local.get(PREFS_KEY);
        const prefs = stored && stored[PREFS_KEY] && typeof stored[PREFS_KEY] === "object" ? stored[PREFS_KEY] : {};
        state.autoRun = prefs.autoRun === true;
      } catch (_) {
        state.autoRun = false;
      }
    })();
    return prefsPromise;
  }
  function ensurePrefs() {
    return prefsPromise || loadPrefs();
  }
  async function setAutoRun(value) {
    state.autoRun = value === true;
    try {
      await chrome.storage.local.set({ [PREFS_KEY]: { autoRun: state.autoRun } });
    } catch (_) {
      // 存不上不影响本次会话生效，下次冷启动回落默认。
    }
    return { ok: true, status: snapshot() };
  }

  /** 侧边栏 Header 引导：可用模型 + 额度 + 安全设置（同一设备令牌）。 */
  async function bootstrap() {
    try {
      const data = await self.AIPDD_RPA.agentRequest("/bootstrap", {});
      if (data && data.limits) {
        state.maxSteps = Math.max(1, Math.round(Number(data.limits.maxSteps) || 25));
      }
      return { ok: true, models: data.models || [], balance: Number(data.balance) || 0, rate: Number(data.rate) || 0, defaultModelKey: data.defaultModelKey || "", limits: data.limits || null };
    } catch (error) {
      return { ok: false, errorMsg: errMsg(error), models: [], balance: 0, rate: 0, limits: null };
    }
  }

  async function decide(payload) {
    try {
      const data = await self.AIPDD_RPA.agentRequest("/decide", payload);
      return { ok: true, decision: data };
    } catch (error) {
      return { ok: false, errorMsg: errMsg(error) };
    }
  }

  async function currentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch (_) {
      return null;
    }
  }

  /** 读当前页面观测：先归属一个页面，再跑一条 snapshot（失败也给出 url/标题兜底）。 */
  async function observe() {
    const tabId = await self.AIPDD_RPA.agentEnsureTab(localSessionId);
    if (!tabId) return null;
    const result = await self.AIPDD_RPA.agentExec(localSessionId, { action: "snapshot" });
    if (result && result.ok && result.data) return { tabId, ...result.data };
    const tab = await currentTab();
    return { tabId, url: clip(tab && tab.url, 500), title: clip(tab && tab.title, 200), elements: [], note: clip(result && result.errorMessage, 300) };
  }

  function actionLine(stepIndex, action, result) {
    const status = result && result.ok ? "DONE" : "FAILED";
    const err = result && result.errorMessage ? ` 错误=${clip(result.errorMessage, 160)}` : "";
    return `#${stepIndex + 1} 动作=${JSON.stringify(action)} 结果=${status}${err}`;
  }

  /** 调用平台工具（RPA 账号/脚本/矩阵任务、工作流、技能等）：与站内 Agent / MCP 同一条授权闸。 */
  async function callTool(call) {
    try {
      const data = await self.AIPDD_RPA.agentRequest("/tool", {
        tool: clip(call && call.tool, 120),
        args: (call && call.args) || {},
        code: clip(call && call.code, 64),
      });
      return { ok: Boolean(data && data.ok), data: (data && data.data) || {}, errorMessage: clip(data && data.errorMessage, 300), needsGrant: Boolean(data && data.needsGrant), elapsedMs: Number((data && data.elapsedMs) || 0) };
    } catch (error) {
      return { ok: false, data: {}, errorMessage: errMsg(error), needsGrant: false, elapsedMs: 0 };
    }
  }

  function toolLine(stepIndex, call, result) {
    const status = result && result.ok ? (result.needsGrant ? "NEEDS_GRANT" : "DONE") : "FAILED";
    const err = result && result.errorMessage ? ` 错误=${clip(result.errorMessage, 160)}` : "";
    return `#${stepIndex + 1} 工具=${clip(call && call.tool, 120)} 结果=${status}${err}`;
  }

  /**
   * 侧边栏自己的台账与库（会话 / 消息 / 技能 / 录制 / 抽取）：走同一条设备通道 /tool 网关。
   * 这些是本人私有数据，按设备令牌直连内部执行器，不套 MCP 勾选闸；别的平台工具仍走授权闸。
   */
  async function library(operation, args) {
    try {
      const data = await self.AIPDD_RPA.agentRequest("/tool", {
        tool: clip(operation, 120),
        args: args || {},
      });
      return {
        ok: Boolean(data && data.ok),
        data: (data && data.data) || {},
        errorMsg: clip(data && data.errorMessage, 300),
      };
    } catch (error) {
      return { ok: false, data: {}, errorMsg: errMsg(error) };
    }
  }

  /** 卡片里只留可读的结果摘要：太大就截断成预览，避免消息流被整页 JSON 撑爆。 */
  function clipData(data, max) {
    try {
      const json = JSON.stringify(data == null ? {} : data);
      if (json.length <= max) return data && typeof data === "object" ? data : {};
      return { truncated: true, preview: json.slice(0, max) };
    } catch (_) {
      return {};
    }
  }

  function waitConfirm(pending) {
    state.pendingConfirm = pending;
    setPhase("waiting-confirm");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (confirmResolver === resolve) {
          confirmResolver = null;
          state.pendingConfirm = null;
          resolve(false);
        }
      }, MAX_STEP_TIMEOUT_MS);
      confirmResolver = (allow) => {
        clearTimeout(timer);
        confirmResolver = null;
        state.pendingConfirm = null;
        resolve(allow === true);
      };
    });
  }

  function resolveConfirm(allow) {
    if (!confirmResolver) return { ok: false, errorMsg: "当前没有待确认的敏感动作" };
    const resolver = confirmResolver;
    resolver(allow);
    return { ok: true, status: snapshot() };
  }

  async function run(goal, mode, modelKey) {
    const history = [];
    let failures = 0;
    // 自动执行＝直接开跑；确认后执行＝先让模型给方案、等用户点确认再动手。
    let confirmed = state.autoRun === true;
    for (let step = 0; step < state.maxSteps; step += 1) {
      if (stopRequested) {
        pushMessage({ role: "system", kind: "error", content: "已按你的请求停止。" });
        setPhase("stopped");
        return;
      }
      state.stepIndex = step;
      const observation = await observe();

      const decided = await decide({ goal, mode, modelKey, stepIndex: step, confirmed, observation: observation || {}, history: history.join("\n"), attachments: state.attachments });
      if (!decided.ok) {
        pushMessage({ role: "system", kind: "error", content: `决策失败：${decided.errorMsg}` });
        setPhase("error", decided.errorMsg);
        return;
      }
      const decision = decided.decision || {};
      if (decision.thought) pushMessage({ role: "agent", kind: "thought", content: decision.thought });

      // 对话轮次：Agent 直接回答（纯提问/闲聊/要规划、不需操作页面）或反问澄清。
      if (decision.reply) pushMessage({ role: "agent", kind: "reply", content: decision.reply });
      if (decision.question) {
        pushMessage({ role: "agent", kind: "question", content: decision.question });
        setPhase("done");
        return;
      }
      if (decision.reply) {
        setPhase("done");
        return;
      }

      // 「确认后执行」的第一个闸：模型给了方案就复述方案、直接给了动作就拿它当方案，都要等用户点确认。
      if (!confirmed) {
        const plan = decision.confirm || (decision.action || decision.tool ? decision.thought || "我准备按你的目标操作页面，请确认后执行。" : "");
        if (plan) {
          const allow = await waitConfirm({ plan, stepIndex: step, thought: decision.thought });
          if (!allow) {
            pushMessage({ role: "system", kind: "note", content: "已取消本次操作。" });
            setPhase("done");
            return;
          }
          confirmed = true;
          history.push(`#${step + 1} 用户已确认按上述说明执行`);
          if (history.length > HISTORY_LINES) history.shift();
          continue;
        }
      }

      // 平台工具：与页面动作二选一。走本系统网关（授权闸同一口径），未授权只回草案。
      const tool = decision.tool;
      if (tool && tool.tool) {
        const code = clip(tool.code, 64);
        if (code && executedCodes.has(code)) {
          history.push(`#${step + 1} 工具=${clip(tool.tool, 120)} 结果=SKIPPED（重复指令，未重复执行）`);
          if (history.length > HISTORY_LINES) history.shift();
          continue;
        }
        const toolResult = await callTool(tool);
        pushMessage({
          role: "agent",
          kind: "tool",
          content: decision.thought || "",
          payload: {
            tool: clip(tool.tool, 120),
            args: tool.args || {},
            ok: toolResult.ok,
            needsGrant: toolResult.needsGrant,
            errorMessage: toolResult.errorMessage,
            data: clipData(toolResult.data, 4000),
          },
        });
        if (code) executedCodes.add(code);
        history.push(toolLine(step, tool, toolResult));
        if (history.length > HISTORY_LINES) history.shift();
        failures = toolResult.ok ? 0 : failures + 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          pushMessage({ role: "system", kind: "error", content: `连续 ${MAX_CONSECUTIVE_FAILURES} 步执行失败，已停止。` });
          setPhase("error", "连续执行失败");
          return;
        }
        continue;
      }

      if (!decision.action || String(decision.action.action) === "finish") {
        pushMessage({ role: "system", kind: "result", content: decision.finishReason || "目标已达成。" });
        setPhase("done");
        return;
      }

      const action = decision.action;
      if (decision.needsConfirm) {
        const allow = await waitConfirm({ action, stepIndex: step, thought: decision.thought });
        if (!allow) {
          pushMessage({ role: "system", kind: "note", content: `已跳过第 ${step + 1} 步敏感动作（未允许）。` });
          setPhase("running");
          history.push(`#${step + 1} 动作=${JSON.stringify(action)} 结果=DENIED（用户未允许）`);
          continue;
        }
        setPhase("running");
      }

      const result = await self.AIPDD_RPA.agentExec(localSessionId, action);
      const message = pushMessage({
        role: "agent",
        kind: String(action.action) === "screenshot" ? "screenshot" : "action",
        content: decision.thought || "",
        payload: { action, result: result && result.data ? result.data : {}, ok: Boolean(result && result.ok), errorMessage: clip(result && result.errorMessage, 300) },
      });
      if (message.kind === "screenshot" && result && result.data && result.data.screenshot) {
        message.payload.screenshot = result.data.screenshot;
      }
      history.push(actionLine(step, action, result));
      if (history.length > HISTORY_LINES) history.shift();

      failures = result && result.ok ? 0 : failures + 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        pushMessage({ role: "system", kind: "error", content: `连续 ${MAX_CONSECUTIVE_FAILURES} 步执行失败，已停止。` });
        setPhase("error", "连续执行失败");
        return;
      }
    }
    pushMessage({ role: "system", kind: "error", content: `已达最大步数 ${state.maxSteps}，已停止。` });
    setPhase("done");
  }

  async function start(input) {
    if (state.running) return { ok: false, errorMsg: "已有一个 Agent 会话在进行中，请先停止" };
    const goal = clip(input && input.goal, 1000).trim();
    if (!goal) return { ok: false, errorMsg: "请写下要完成的目标" };
    const limits = self.AIPDD_RPA.limits ? self.AIPDD_RPA.limits() : null;
    state.running = true;
    state.phase = "running";
    state.goal = goal;
    state.mode = clip(input && input.mode, 16) || "act";
    state.modelKey = clip(input && input.modelKey, 128);
    state.stepIndex = 0;
    state.maxSteps = Math.max(1, Math.round(Number((limits && limits.maxSteps) || 25)));
    state.messages = [];
    state.attachments = [];
    state.pendingConfirm = null;
    state.errorMsg = "";
    state.startedAt = Date.now();
    state.endedAt = 0;
    seq = 0;
    stopRequested = false;
    executedCodes.clear();
    localSessionId = Math.floor(Date.now() / 1000) % 1_000_000;
    pushMessage({ role: "user", kind: "text", content: goal });
    void run(goal, state.mode, state.modelKey)
      .catch((error) => {
        pushMessage({ role: "system", kind: "error", content: `Agent 执行异常：${errMsg(error)}` });
        setPhase("error", errMsg(error));
      })
      .finally(() => {
        state.running = false;
        state.endedAt = Date.now();
      });
    return { ok: true, status: snapshot() };
  }

  function stop() {
    stopRequested = true;
    if (confirmResolver) {
      const resolver = confirmResolver;
      resolver(false);
    }
    if (state.running) pushMessage({ role: "system", kind: "note", content: "正在停止…" });
    else setPhase("stopped");
    return { ok: true, status: snapshot() };
  }

  function reset() {
    if (state.running) return { ok: false, errorMsg: "请先停止当前会话" };
    state.messages = [];
    state.attachments = [];
    state.pendingConfirm = null;
    state.errorMsg = "";
    setPhase("idle");
    return { ok: true, status: snapshot() };
  }

  /** 附件：存进本账号数字资产，记一条卡片；失败如实回报。 */
  async function attach(input) {    const name = clip(input && input.name, 200) || "附件";
    const data = String((input && input.data) || "");
    if (!data) return { ok: false, errorMsg: "附件内容为空" };
    try {
      const uploaded = await self.AIPDD_RPA.agentRequest("/upload", { name, data });
      const item = { name: uploaded.name || name, key: String(uploaded.key || "") };
      state.attachments.push(item);
      if (state.attachments.length > 10) state.attachments.shift();
      pushMessage({ role: "system", kind: "note", content: `已附上「${item.name}」（数字资产，Agent 可在结果里引用）。` });
      return { ok: true, name: item.name, key: item.key, status: snapshot() };
    } catch (error) {
      return { ok: false, errorMsg: errMsg(error) };
    }
  }

  // ---------------- 录制 → 工具 / 回放 ----------------

  /** 开始录制：在当前活动页装上录制器，之后你在页面上的点击/输入/选择都会被拍成闭集动作。 */
  async function startRecording() {
    if (state.running) return { ok: false, errorMsg: "Agent 正在运行，请先停止再录制" };
    const tabId = await self.AIPDD_RPA.agentEnsureTab(localSessionId);
    if (!tabId) return { ok: false, errorMsg: "没有可录制的页面：请先打开要录制的站点" };
    const begun = await self.AIPDD_RPA.agentTabExec(tabId, { action: "record", on: true });
    if (!begun.ok) return { ok: false, errorMsg: begun.errorMessage || "录制未能开始" };
    recording.on = true;
    recording.tabId = tabId;
    recording.count = 0;
    recording.actions = [];
    pushMessage({ role: "system", kind: "note", content: "已开始录制：在页面上正常操作即可，录完点「停止并保存」。" });
    return { ok: true, tabId, status: snapshot() };
  }

  async function stopRecording() {
    if (!recording.on) {
      return { ok: true, actions: recording.actions.slice(), count: recording.actions.length, status: snapshot() };
    }
    const tabId = recording.tabId || (await self.AIPDD_RPA.agentEnsureTab(localSessionId));
    const done = tabId
      ? await self.AIPDD_RPA.agentTabExec(tabId, { action: "record", on: false })
      : { ok: false, data: {} };
    const actions = done.ok && Array.isArray(done.data && done.data.actions)
      ? done.data.actions
      : recording.actions.slice();
    recording.on = false;
    recording.actions = actions;
    recording.count = actions.length;
    pushMessage({ role: "system", kind: "note", content: `已停止录制：共 ${actions.length} 步。` });
    return { ok: true, actions, count: actions.length, status: snapshot() };
  }

  /** 存成可复用工具（落本账号库表，跨设备一致）。 */
  async function saveRecording(input) {
    const name = clip(input && input.name, 120).trim();
    if (!name) return { ok: false, errorMsg: "请给这个工具起个名字" };
    const actions = Array.isArray(input && input.actions) ? input.actions : recording.actions;
    if (!actions.length) return { ok: false, errorMsg: "还没有录到任何动作" };
    const site = clip(input && input.site, 200);
    const saved = await library("RpaChrome_saveRecording", { body: { name, site, actions } });
    if (!saved.ok) return { ok: false, errorMsg: saved.errorMsg || "保存失败" };
    recording.on = false;
    recording.actions = [];
    recording.count = 0;
    return { ok: true, recording: saved.data.recording || {} };
  }

  /** 回放一个录制工具：逐条走与 Agent 同一条本机执行路径，如实回报每一步。 */
  async function replayRecording(input) {
    if (state.running) return { ok: false, errorMsg: "有会话在执行，请先停止再回放工具" };
    const actions = Array.isArray(input && input.actions) ? input.actions : [];
    if (!actions.length) return { ok: false, errorMsg: "这个工具没有可回放的动作" };
    const name = clip(input && input.name, 120) || "录制工具";
    const tabId = await self.AIPDD_RPA.agentEnsureTab(localSessionId);
    if (!tabId) return { ok: false, errorMsg: "没有可操作的页面：请先打开要回放的站点" };
    state.running = true;
    state.phase = "running";
    state.goal = `回放工具：${name}`;
    state.stepIndex = 0;
    state.messages = [];
    state.errorMsg = "";
    state.startedAt = Date.now();
    state.endedAt = 0;
    seq = 0;
    stopRequested = false;
    pushMessage({ role: "user", kind: "text", content: `回放「${name}」（${actions.length} 步）` });
    void (async () => {
      try {
        for (let index = 0; index < actions.length; index += 1) {
          if (stopRequested) {
            pushMessage({ role: "system", kind: "error", content: "已按你的请求停止。" });
            setPhase("stopped");
            return;
          }
          state.stepIndex = index;
          const action = actions[index] || {};
          const result = await self.AIPDD_RPA.agentTabExec(tabId, action);
          pushMessage({
            role: "agent",
            kind: "action",
            content: "",
            payload: {
              action,
              result: (result && result.data) || {},
              ok: Boolean(result && result.ok),
              errorMessage: clip(result && result.errorMessage, 300),
            },
          });
          if (!result || !result.ok) {
            setPhase("error", clip(result && result.errorMessage, 300) || "回放中断");
            return;
          }
          await sleep(400);
        }
        pushMessage({ role: "system", kind: "result", content: `工具「${name}」回放完成，共 ${actions.length} 步。` });
        setPhase("done");
      } catch (error) {
        pushMessage({ role: "system", kind: "error", content: `回放异常：${errMsg(error)}` });
        setPhase("error", errMsg(error));
      } finally {
        state.running = false;
        state.endedAt = Date.now();
      }
    })();
    return { ok: true, status: snapshot() };
  }

  function handle(message, sender, sendResponse) {
    const type = String((message && message.type) || "");
    if (!type.startsWith("AIPDD_AGENT_")) return false;
    (async () => {
      await ensurePrefs();
      // 页面里的录制器每拍到一个动作就推一条：只记当前正在录的那一页。
      if (type === "AIPDD_AGENT_RECORD_EVENT") {
        const tabId = sender && sender.tab ? sender.tab.id : 0;
        if (recording.on && (!recording.tabId || tabId === recording.tabId)) {
          recording.actions.push(message.action);
          recording.count = recording.actions.length;
        }
        sendResponse({ ok: true });
        return;
      }
      if (type === "AIPDD_AGENT_LIBRARY") {
        sendResponse(await library(message.operation, message.args));
        return;
      }
      if (type === "AIPDD_AGENT_RECORD_START") {
        sendResponse(await startRecording());
        return;
      }
      if (type === "AIPDD_AGENT_RECORD_STOP") {
        sendResponse(await stopRecording());
        return;
      }
      if (type === "AIPDD_AGENT_RECORD_SAVE") {
        sendResponse(await saveRecording(message));
        return;
      }
      if (type === "AIPDD_AGENT_REPLAY") {
        sendResponse(await replayRecording(message));
        return;
      }
      if (type === "AIPDD_AGENT_START") {
        sendResponse(await start(message));
        return;
      }
      if (type === "AIPDD_AGENT_STOP") {
        sendResponse(stop());
        return;
      }
      if (type === "AIPDD_AGENT_RESET") {
        sendResponse(reset());
        return;
      }
      if (type === "AIPDD_AGENT_STATE") {
        sendResponse(snapshot());
        return;
      }
      if (type === "AIPDD_AGENT_BOOTSTRAP") {
        sendResponse(await bootstrap());
        return;
      }
      if (type === "AIPDD_AGENT_CONFIRM") {
        sendResponse(resolveConfirm(message.allow === true));
        return;
      }
      if (type === "AIPDD_AGENT_SET_AUTORUN") {
        sendResponse(await setAutoRun(message.autoRun === true));
        return;
      }
      if (type === "AIPDD_AGENT_ATTACH") {
        sendResponse(await attach(message));
        return;
      }
      if (type === "AIPDD_AGENT_ENHANCE") {
        try {
          const data = await self.AIPDD_RPA.agentRequest("/enhance", { goal: message.goal, modelKey: state.modelKey });
          sendResponse({ ok: true, goal: data.goal || message.goal });
        } catch (error) {
          sendResponse({ ok: false, errorMsg: errMsg(error) });
        }
        return;
      }
      sendResponse({ ok: false, errorMsg: `未知指令 ${type}` });
    })();
    return true;
  }

  self.AIPDD_AGENT = { handle, state: snapshot };
})();
