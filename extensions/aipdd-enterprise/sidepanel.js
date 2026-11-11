// 浏览器代理侧边栏（复刻 rtrvr 的四区骨架：Header / Main / Composer / Footer + Drawer）。
// 本文件负责界面与交互，不碰分发 / 获客既有链路：
//   · 真数据：设备与状态灯、额度、待确认敏感动作、停止控制；
//   · 真交互：模式切换、示例填充、附件选择、发送、抽屉与浮层；
//   · Agent 决策通过 AIPDD_AGENT_* 交后台（chrome-agent.js）编排：模型与工具在平台，动作在本机。
//   · 模型下拉与额度条读平台「模型广场 / 积分」；敏感动作由侧边栏确认卡放行。
(() => {
  const $ = (id) => document.getElementById(id);

  const el = {
    device: $("hdDevice"),
    dot: $("hdDot"),
    phase: $("hdPhase"),
    state: $("hdState"),
    modelBtn: $("modelBtn"),
    modelLabel: $("modelLabel"),
    creditsBtn: $("creditsBtn"),
    creditsLabel: $("creditsLabel"),
    accountBtn: $("accountBtn"),
    main: $("main"),
    empty: $("empty"),
    samples: $("samples"),
    stream: $("stream"),
    modeBtn: $("modeBtn"),
    runGateBtn: $("runGateBtn"),
    attachBtn: $("attachBtn"),
    enhanceBtn: $("enhanceBtn"),
    goal: $("goal"),
    sendBtn: $("sendBtn"),
    fileInput: $("fileInput"),
    scrim: $("scrim"),
    drawer: $("drawer"),
    dwBack: $("dwBack"),
    dwTitle: $("dwTitle"),
    dwBody: $("dwBody"),
    modePop: $("modePop"),
    modelPop: $("modelPop"),
    accountPop: $("accountPop"),
  };

  const PHASE = {
    "signed-out": { cls: "", label: "未连接本系统" },
    online: { cls: "online", label: "在线 · 绿灯可被调用" },
    "waiting-confirm": { cls: "waiting", label: "有操作待你确认" },
    offline: { cls: "offline", label: "离线" },
    error: { cls: "offline", label: "连接失败" },
  };

  const MODES = [
    { key: "act", label: "Act", desc: "在页面上执行操作：点击 / 输入 / 提交" },
    { key: "crawl", label: "Crawl", desc: "顺着链接批量抓取多个页面" },
    { key: "extract", label: "Extract", desc: "把当前页抽成结构化数据" },
  ];

  const SAMPLES = [
    "在小红书搜索「露营装备」，把前 20 条笔记的标题与点赞数整理成表格",
    "打开我司后台，导出本月新增的客户名单",
    "把当前页面的商品信息抽取成 JSON",
    "在知乎搜索「企业微信 SCRM」，收集 10 个高赞回答的链接",
  ];

  // 插件 Agent 可调用的浏览器侧语义工具（与契约 RC_AGENT_TOOL_NAMES 同源，供 MCP 抽屉展示）。
  const AGENT_TOOLS = [
    "browser_agent_start",
    "browser_agent_status",
    "browser_agent_result",
    "browser_agent_stop",
    "browser_extract",
    "browser_skill_list",
    "browser_skill_run",
  ];

  const state = {
    status: null,
    mode: "act",
    modelKey: "",
    models: [],
    balance: 0,
    rate: 0,
    agent: { messages: [], phase: "idle", pendingConfirm: null, running: false, maxSteps: 25, autoRun: false },
    drawer: "",
    counts: { history: 0, skills: 0, schedules: 0 },
    skills: { list: [], filter: "", loaded: false, editing: null, errorMsg: "" },
    schedules: { list: [], loaded: false, editing: null, errorMsg: "" },
    recordings: { list: [], loaded: false, errorMsg: "", pending: null },
    history: { list: [], loaded: false, errorMsg: "", keyword: "", openId: 0, messages: [], box: null },
    recording: { on: false, count: 0 },
  };

  // ---------------- 基础工具 ----------------

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve({ ok: false, errorMsg: chrome.runtime.lastError.message });
          else resolve(response || { ok: false });
        });
      } catch (error) {
        resolve({ ok: false, errorMsg: String(error?.message || error) });
      }
    });
  }

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function openTab(url) {
    if (url) chrome.tabs.create({ url }).catch(() => undefined);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取失败"));
      reader.readAsDataURL(file);
    });
  }

  /** 站点路径统一拼在已登录域名下；未登录时返回空串。 */
  function siteUrl(path) {
    const domain = String(state.status?.domain || "").replace(/\/+$/, "");
    return domain ? `${domain}${path}` : "";
  }

  // ---------------- Header ----------------

  function renderHeader() {
    const status = state.status || {};
    const phase = PHASE[status.phase] || PHASE["signed-out"];
    el.device.textContent = status.deviceName || "本地 Chrome";
    el.dot.className = `dot ${phase.cls}`.trim();
    el.phase.textContent = status.message || phase.label;
    // 未连接时点头部状态可直接拉起登录浮层，不必去猜右上角那个「⋯」。
    const connected = Boolean(status.hasToken);
    el.state.classList.toggle("is-link", !connected);
    el.state.title = connected ? "" : "点击登录本系统";

    const credits = state.status?.hasToken ? `额度 ${formatCredits(state.balance)}` : "未连接";
    el.creditsLabel.textContent = credits;
    el.creditsBtn.title = state.status?.hasToken
      ? `积分余额 ${formatCredits(state.balance)}${state.rate ? `（1 元 = ${state.rate} 积分）` : ""}`
      : "点击登录本系统";

    const selected = state.models.find((item) => item.key === state.modelKey);
    el.modelLabel.textContent = selected ? selected.label : "默认模型";

    renderRunGate();
  }

  /** 执行方式芯片：显示当前值，点一下在「确认后执行 / 自动执行」间切换（值存在插件本地）。 */
  function renderRunGate() {
    if (!el.runGateBtn) return;
    const auto = state.agent.autoRun === true;
    el.runGateBtn.textContent = auto ? "自动执行" : "确认后执行";
    el.runGateBtn.classList.toggle("on", auto);
    el.runGateBtn.title = auto
      ? "当前：自动执行——分析好方案后直接动手，不再等你点确认。点击切回「确认后执行」"
      : "当前：确认后执行——先给方案，等你点确认再动手。点击切到「自动执行」";
  }

  function formatCredits(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "—";
    return num >= 10000 ? `${(num / 10000).toFixed(1)}万` : String(num);
  }

  // ---------------- Main：会话流 ----------------

  function renderStream() {
    const messages = state.agent.messages || [];
    el.empty.hidden = messages.length > 0 || Boolean(state.agent.pendingConfirm);
    el.stream.textContent = "";
    for (const message of messages) el.stream.appendChild(renderMessage(message));
    if (state.agent.pendingConfirm) el.stream.appendChild(renderConfirm(state.agent.pendingConfirm));
    el.main.scrollTop = el.main.scrollHeight;
  }

  function renderMessage(message) {
    const kind = String(message.kind || "text");
    if (message.role === "user") {
      const wrap = h("div", "msg msg-user");
      wrap.appendChild(h("div", null, message.content));
      return wrap;
    }
    if (kind === "thought") return renderCard("思考", message.content, "", "thought");
    if (kind === "reply") return renderCard("回复", message.content, "", "result");
    if (kind === "question") return renderCard("追问", message.content, "", "question");
    if (kind === "error") return renderCard("错误", message.content, "", "error");
    if (kind === "result") return renderCard("结果", message.content, summarizeResult(message.payload), "result");
    if (kind === "screenshot") return renderScreenshot(message);
    if (kind === "action") return renderCard("动作", actionSummary(message.payload), message.payload?.errorMessage || "", message.payload?.ok === false ? "error" : "action");
    if (kind === "tool") return renderTool(message);
    const cls = kind === "error" ? "msg msg-note err" : "msg msg-note";
    return h("div", cls, message.content);
  }

  function renderCard(title, body, extra, variant) {
    const box = h("div", `card card-${variant}`);
    const head = h("div", "card-hd");
    head.appendChild(h("span", "tag", title));
    if (body) head.appendChild(h("span", null, body));
    box.appendChild(head);
    if (extra) box.appendChild(h("div", "card-bd", extra));
    return box;
  }

  function renderScreenshot(message) {
    const box = h("div", "card card-screenshot");
    box.appendChild(h("div", "card-hd")).appendChild(h("span", "tag", "截图"));
    const src = message.payload?.screenshot;
    if (src) {
      const img = h("img", "shot");
      img.src = src;
      img.alt = "页面截图";
      box.appendChild(img);
    } else {
      box.appendChild(h("div", "card-bd", message.payload?.errorMessage || "截图不可用"));
    }
    return box;
  }

  function actionSummary(payload) {
    const action = payload?.action || {};
    return [String(action.action || "动作"), action.act ? `→ ${action.act}` : "", action.elementIndex != null ? `元素 #${action.elementIndex}` : "", action.value != null ? JSON.stringify(action.value) : "", action.url || ""].filter(Boolean).join(" ");
  }

  /** 平台工具卡：工具名 + 参数摘要；未授权只回草案时点明去哪勾选，失败时回错误。 */
  function renderTool(message) {
    const payload = message.payload || {};
    const args = payload.args && Object.keys(payload.args).length ? JSON.stringify(payload.args).slice(0, 200) : "";
    const variant = payload.ok === false ? "error" : payload.needsGrant ? "question" : "tool";
    const note = payload.needsGrant
      ? "未授权：只回了草案。请到本系统「智能体记忆 → 可自动执行的动作」勾选该动作后重试。"
      : payload.errorMessage || summarizeResult(payload.data);
    return renderCard("工具", `${payload.tool || "工具"}${args ? ` ${args}` : ""}`, note, variant);
  }

  function summarizeResult(payload) {
    if (!payload || typeof payload !== "object") return "";
    const text = JSON.stringify(payload);
    return text === "{}" ? "" : text.slice(0, 400);
  }

  function renderConfirm(item) {
    const isPlan = Boolean(item.plan);
    const action = item.action || {};
    const box = h("div", "card confirm");
    const head = h("div", "card-hd");
    head.appendChild(h("span", "tag", "待确认"));
    head.appendChild(h("span", null, isPlan ? "请确认要执行的操作" : `第 ${Number(item.stepIndex) + 1} 步 · 敏感动作`));
    box.appendChild(head);
    if (item.thought) box.appendChild(h("div", "card-bd", item.thought));
    if (isPlan) {
      box.appendChild(h("div", "card-bd", item.plan));
    } else {
      const detail = [String(action.action || "动作"), action.act ? `→ ${action.act}` : "", action.value != null ? JSON.stringify(action.value) : "", action.url || ""].filter(Boolean).join(" ");
      box.appendChild(h("div", "card-bd", detail));
    }
    const actions = h("div", "confirm-actions");
    const allow = h("button", "allow", isPlan ? "确认执行" : "允许本次");
    allow.type = "button";
    allow.addEventListener("click", () => decide(true));
    const deny = h("button", null, isPlan ? "取消" : "拒绝");
    deny.type = "button";
    deny.addEventListener("click", () => decide(false));
    actions.appendChild(allow);
    actions.appendChild(deny);
    box.appendChild(actions);
    return box;
  }

  async function decide(allow) {
    const result = await send({ type: "AIPDD_AGENT_CONFIRM", allow });
    if (result?.errorMsg) pushNote(result.errorMsg);
    await refreshAgent();
  }

  function pushNote(content) {
    state.agent.messages.push({ role: "system", kind: "note", content });
    renderStream();
  }

  // ---------------- Composer ----------------

  async function submit() {
    const goal = String(el.goal.value || "").trim();
    if (!goal) return;
    if (state.agent.running) {
      pushNote("已有一个 Agent 会话在进行中，请先停止再发新目标。");
      return;
    }
    el.goal.value = "";
    autosize();
    const result = await send({ type: "AIPDD_AGENT_START", goal, mode: state.mode, modelKey: state.modelKey });
    if (!result?.ok) {
      pushNote(`未能启动 Agent：${result?.errorMsg || "后台未返回结果"}`);
    } else if (result.status) {
      applyAgentState(result.status);
    }
    await refreshAgent();
    startFastPoll();
  }

  function autosize() {
    el.goal.style.height = "auto";
    el.goal.style.height = `${Math.min(el.goal.scrollHeight, 120)}px`;
  }

  // ---------------- Drawer ----------------

  /** 侧边栏自己的台账与库：走同一条设备通道 /tool 网关（本人私有数据，不过 MCP 勾选闸）。 */
  async function lib(operation, args) {
    const res = await send({ type: "AIPDD_AGENT_LIBRARY", operation, args });
    if (!res) return { ok: false, errorMsg: "后台未返回结果", data: {} };
    return res;
  }

  function loadError(text) {
    const box = h("div", "dw-note err", text);
    return box;
  }

  function emptyNote(text) {
    return h("div", "dw-empty", text);
  }

  const drawers = {
    history: {
      title: "会话历史",
      render(body) {
        const search = h("input", "dw-search");
        search.placeholder = "搜索历史会话…";
        search.value = state.history.keyword || "";
        const box = h("div", "dw-live");
        let timer = null;
        search.addEventListener("input", () => {
          state.history.keyword = search.value;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            state.history.loaded = false;
            void ensureHistory().then(() => renderHistoryList(box));
          }, 300);
        });
        body.appendChild(search);
        body.appendChild(box);
        state.history.box = box;
        renderHistoryList(box);
        void ensureHistory().then(() => renderHistoryList(box));
      },
    },
    skills: {
      title: "技能库",
      render(body) {
        const pills = h("div", "dw-pills");
        for (const [key, label] of [["", "全部"], ["personal", "个人技能"], ["site", "站点技能"]]) {
          const pill = h("button", `pill${state.skills.filter === key ? " on" : ""}`, label);
          pill.type = "button";
          pill.addEventListener("click", () => {
            state.skills.filter = key;
            renderDrawer();
          });
          pills.appendChild(pill);
        }
        body.appendChild(pills);

        const add = h("button", "dw-btn", "＋ 新建技能");
        add.type = "button";
        add.addEventListener("click", () => {
          state.skills.editing = { name: "", kind: "personal", site: "", description: "", content: "", enabled: true, id: 0 };
          renderDrawer();
        });
        body.appendChild(add);

        if (state.skills.errorMsg) body.appendChild(loadError(state.skills.errorMsg));
        if (state.skills.editing) {
          body.appendChild(skillForm(state.skills.editing));
        }
        const list = (state.skills.list || []).filter(
          (item) => !state.skills.filter || item.kind === state.skills.filter,
        );
        if (!state.skills.loaded) body.appendChild(emptyNote("正在读取…"));
        else if (!list.length && !state.skills.editing) {
          body.appendChild(emptyNote("还没有技能。"));
        }
        for (const item of list) body.appendChild(skillItem(item));
        body.appendChild(
          h(
            "div",
            "dw-note",
            "个人技能：你与 Agent 沉淀的常驻指令与偏好；站点技能：关于「怎么操作某个网站」的知识。启用的技能会在 Agent 每一步决策时作为长期知识注入。两者默认只在本账号可用，要共享需走发布审核。",
          ),
        );
        void ensureSkills();
      },
    },
    schedules: {
      title: "计划任务",
      render(body) {
        const add = h("button", "dw-btn", "＋ 新建计划任务");
        add.type = "button";
        add.addEventListener("click", () => {
          const clientId = state.status?.clientId || "";
          state.schedules.editing = {
            id: 0,
            title: "",
            goal: "",
            mode: state.mode || "act",
            startUrl: "",
            clientId,
            scheduleType: "recurring",
            freq: "daily",
            time: "09:00",
            weekdays: [1, 2, 3, 4, 5],
            day: 1,
            interval: 30,
            minute: 0,
            scheduledAt: "",
            status: "enabled",
          };
          renderDrawer();
        });
        body.appendChild(add);

        if (state.schedules.errorMsg) body.appendChild(loadError(state.schedules.errorMsg));
        if (state.schedules.editing) body.appendChild(scheduleForm(state.schedules.editing));
        const list = state.schedules.list || [];
        if (!state.schedules.loaded) body.appendChild(emptyNote("正在读取…"));
        else if (!list.length && !state.schedules.editing) {
          body.appendChild(emptyNote("还没有计划任务。"));
        }
        for (const item of list) body.appendChild(scheduleItem(item));
        body.appendChild(
          h(
            "div",
            "dw-note",
            "计划任务会按你设的频率，到点让本机这台设备自动跑一个目标。只在设备在线（插件已登录、Chrome 打开）时执行：离线的那一轮直接跳过、不补跑；账号停用会自动暂停。想立刻验证就点「立即执行」。",
          ),
        );
        void ensureSchedules();
      },
    },
    triggers: {
      title: "触发器",
      render(body) {
        body.appendChild(emptyNote("本版本未开放。"));
        body.appendChild(
          h(
            "div",
            "dw-note",
            "触发器（打开某站点 / 收到新消息时自动执行）依赖平台事件源，本次升级未纳入；这里先留入口。",
          ),
        );
      },
    },
    recordings: {
      title: "录制 → 工具",
      render(body) {
        state.recordings.liveNode = null;
        const live = state.recording;
        if (live.on) {
          const bar = h("div", "dw-note on", `正在录制…已录 ${live.count} 步`);
          state.recordings.liveNode = bar;
          body.appendChild(bar);
          const stop = h("button", "dw-btn", "停止");
          stop.type = "button";
          stop.addEventListener("click", () => void stopRecording());
          body.appendChild(stop);
        } else if (state.recordings.pending) {
          const pending = state.recordings.pending;
          const form = h("div", "dw-form");
          form.appendChild(h("div", "dw-note", `录到了 ${pending.actions.length} 步，给它起个名字存成工具：`));
          const name = h("input", "dw-input");
          name.placeholder = "工具名称，如「每日签到」";
          name.maxLength = 120;
          name.value = pending.name || "";
          form.appendChild(name);
          const actions = h("div", "dw-actions");
          const save = h("button", "dw-btn", "保存");
          save.type = "button";
          save.addEventListener("click", () => void savePendingRecording(name.value.trim()));
          actions.appendChild(save);
          const discard = h("button", "dw-btn sub", "丢弃");
          discard.type = "button";
          discard.addEventListener("click", () => {
            state.recordings.pending = null;
            renderDrawer();
          });
          actions.appendChild(discard);
          form.appendChild(actions);
          body.appendChild(form);
        } else {
          const start = h("button", "dw-btn", "● 开始录制当前页");
          start.type = "button";
          start.disabled = Boolean(state.agent.running);
          start.addEventListener("click", () => void beginRecording());
          body.appendChild(start);
        }
        if (state.recordings.errorMsg) body.appendChild(loadError(state.recordings.errorMsg));
        const list = state.recordings.list || [];
        if (!state.recordings.loaded) body.appendChild(emptyNote("正在读取…"));
        else if (!list.length) body.appendChild(emptyNote("还没有录制。"));
        for (const item of list) body.appendChild(recordingItem(item));
        body.appendChild(
          h(
            "div",
            "dw-note",
            "录制一段你的操作，即可生成可复用的动作序列（工具）。回放时逐条走与 Agent 同一条本机执行路径；密码框不会被录下来。",
          ),
        );
        void ensureRecordings();
      },
    },
    mcp: {
      title: "MCP 服务器",
      render(body) {
        const domain = String(state.status?.domain || "").replace(/\/+$/, "");
        const endpoint = domain ? `${domain}/api/v1/mcp` : "";
        body.appendChild(
          h(
            "div",
            "dw-note",
            "本插件自带一个默认 MCP：设备状态为绿灯（在线）时，平台 Agent 与外部 MCP 客户端都可通过该端点调用这台浏览器执行任务。",
          ),
        );
        body.appendChild(h("div", "dw-group", "端点"));
        body.appendChild(codeRow(endpoint || "登录本系统后显示"));
        body.appendChild(h("div", "dw-group", "鉴权"));
        body.appendChild(codeRow("x-api-key: ek_xxx（本账号在「模型广场 / 机器通道」里创建的 Key）"));
        body.appendChild(h("div", "dw-group", `可用工具（${AGENT_TOOLS.length}）`));
        for (const name of AGENT_TOOLS) body.appendChild(h("div", "dw-item", name));
        body.appendChild(h("div", "dw-group", "客户端配置（Claude / Cursor 等）"));
        body.appendChild(
          codeRow(
            endpoint
              ? JSON.stringify(
                  { mcpServers: { "aipdd-browser": { url: endpoint, headers: { "x-api-key": "ek_xxx" } } } },
                  null,
                  2,
                )
              : "登录本系统后显示",
          ),
        );
        const open = h("button", "dw-btn sub", "打开本系统「MCP Server」页");
        open.type = "button";
        open.disabled = !domain;
        open.addEventListener("click", () => openTab(siteUrl("/help?topic=mcp")));
        body.appendChild(open);
      },
    },
    models: {
      title: "模型与 Key",
      render(body) {
        body.appendChild(h("div", "dw-note", "模型来自本系统「模型广场 / 模型设置」，插件用本账号的 ek_ Key 调用，不内置第三方付费模型。"));
        body.appendChild(h("div", "dw-group", "会话模型"));
        body.appendChild(modelRow({ key: "", label: "本账号默认模型", desc: "跟随本系统设置，无需每次选择" }));
        for (const item of state.models) body.appendChild(modelRow(item));
        const open = h("button", "dw-btn sub", "打开模型广场");
        open.type = "button";
        open.disabled = !state.status?.domain;
        open.addEventListener("click", () => openTab(siteUrl("/models")));
        body.appendChild(open);
      },
    },
  };

  // ---------------- 技能库 ----------------

  async function ensureSkills(force) {
    if (state.skills.loaded && !force) return;
    const res = await lib("RpaChrome_skills", { query: {} });
    state.skills.loaded = true;
    if (!res.ok) {
      state.skills.errorMsg = res.errorMsg || "读取技能失败";
    } else {
      state.skills.errorMsg = "";
      state.skills.list = Array.isArray(res.data.list) ? res.data.list : [];
    }
    state.counts.skills = state.skills.list.length;
    renderBadges();
    if (state.drawer === "skills") renderDrawer();
  }

  function skillItem(item) {
    const row = h("button", "dw-item");
    row.type = "button";
    row.appendChild(h("span", "t", `${item.name}${item.enabled === false ? "（停用）" : ""}`));
    row.appendChild(h("span", "d", `${item.kindLabel || item.kind}${item.site ? ` · ${item.site}` : ""} · v${item.version}`));
    row.addEventListener("click", () => {
      state.skills.editing = { ...item };
      renderDrawer();
    });
    return row;
  }

  function skillForm(item) {
    const form = h("div", "dw-form");
    const name = h("input", "dw-input");
    name.placeholder = "技能名称";
    name.value = item.name || "";
    name.maxLength = 120;
    form.appendChild(name);

    const kind = h("select", "dw-input");
    for (const [value, label] of [["personal", "个人技能"], ["site", "站点技能"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (item.kind === value) option.selected = true;
      kind.appendChild(option);
    }
    form.appendChild(kind);

    const site = h("input", "dw-input");
    site.placeholder = "归属站点，如 mp.weixin.qq.com（站点技能必填）";
    site.value = item.site || "";
    site.maxLength = 200;
    form.appendChild(site);
    const syncSite = () => {
      site.hidden = kind.value !== "site";
    };
    kind.addEventListener("change", syncSite);
    syncSite();

    const description = h("input", "dw-input");
    description.placeholder = "一句话说明（可选）";
    description.value = item.description || "";
    description.maxLength = 500;
    form.appendChild(description);

    const content = document.createElement("textarea");
    content.className = "dw-input";
    content.rows = 6;
    content.maxLength = 20000;
    content.placeholder = "技能正文（markdown）：偏好 / 站点操作知识 / 工作流步骤";
    content.value = item.content || "";
    form.appendChild(content);

    const actions = h("div", "dw-actions");
    const save = h("button", "dw-btn", "保存");
    save.type = "button";
    save.addEventListener("click", async () => {
      const payload = {
        name: name.value.trim(),
        kind: kind.value,
        site: kind.value === "site" ? site.value.trim() : "",
        description: description.value.trim(),
        content: content.value,
        enabled: true,
      };
      if (!payload.name) return pushNote("请填写技能名称。");
      if (!payload.content.trim()) return pushNote("请填写技能内容。");
      save.disabled = true;
      save.textContent = "保存中…";
      const res = await lib("RpaChrome_saveSkill", { body: payload });
      save.disabled = false;
      save.textContent = "保存";
      if (!res.ok) {
        pushNote(`技能保存失败：${res.errorMsg || "未知错误"}`);
        return;
      }
      state.skills.editing = null;
      await ensureSkills(true);
    });
    actions.appendChild(save);

    const cancel = h("button", "dw-btn sub", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      state.skills.editing = null;
      renderDrawer();
    });
    actions.appendChild(cancel);

    if (item.id) {
      const remove = h("button", "dw-btn danger", "删除");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const res = await lib("RpaChrome_removeSkill", { pathParams: { id: item.id } });
        if (!res.ok) {
          remove.disabled = false;
          pushNote(`技能删除失败：${res.errorMsg || "未知错误"}`);
          return;
        }
        state.skills.editing = null;
        await ensureSkills(true);
      });
      actions.appendChild(remove);
    }
    form.appendChild(actions);
    return form;
  }

  // ---------------- 录制 → 工具 ----------------

  async function ensureRecordings(force) {
    if (state.recordings.loaded && !force) return;
    const res = await lib("RpaChrome_recordings", {});
    state.recordings.loaded = true;
    if (!res.ok) {
      state.recordings.errorMsg = res.errorMsg || "读取录制失败";
    } else {
      state.recordings.errorMsg = "";
      state.recordings.list = Array.isArray(res.data.list) ? res.data.list : [];
    }
    state.counts.recordings = state.recordings.list.length;
    renderBadges();
    if (state.drawer === "recordings") renderDrawer();
  }

  function recordingItem(item) {
    const row = h("div", "dw-item static");
    const main = h("div", "grow");
    main.appendChild(h("span", "t", item.name));
    main.appendChild(h("span", "d", `${item.stepCount || 0} 步${item.site ? ` · ${item.site}` : ""}`));
    row.appendChild(main);
    const play = h("button", "dw-btn sm", "回放");
    play.type = "button";
    play.disabled = Boolean(state.agent.running);
    play.addEventListener("click", () => void replay(item));
    row.appendChild(play);
    const remove = h("button", "dw-btn sm danger", "删除");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      const res = await lib("RpaChrome_removeRecording", { pathParams: { id: item.id } });
      if (!res.ok) {
        remove.disabled = false;
        pushNote(`删除失败：${res.errorMsg || "未知错误"}`);
        return;
      }
      await ensureRecordings(true);
    });
    row.appendChild(remove);
    return row;
  }

  async function beginRecording() {
    const res = await send({ type: "AIPDD_AGENT_RECORD_START" });
    if (!res?.ok) {
      pushNote(`无法开始录制：${res?.errorMsg || "未知错误"}`);
      return;
    }
    state.recordings.pending = null;
    state.recording = { on: true, count: 0 };
    renderDrawer();
  }

  async function stopRecording() {
    const stopped = await send({ type: "AIPDD_AGENT_RECORD_STOP" });
    const actions = Array.isArray(stopped?.actions) ? stopped.actions : [];
    state.recording = { on: false, count: actions.length };
    if (!actions.length) {
      pushNote("这次录制没有录到任何动作。");
      state.recordings.pending = null;
      renderDrawer();
      return;
    }
    state.recordings.pending = { actions, name: `录制 ${new Date().toLocaleString()}` };
    renderDrawer();
  }

  async function savePendingRecording(name) {
    const pending = state.recordings.pending;
    if (!pending) return;
    if (!name) {
      pushNote("请给这个工具起个名字。");
      return;
    }
    const res = await send({ type: "AIPDD_AGENT_RECORD_SAVE", name, actions: pending.actions });
    if (!res?.ok) {
      pushNote(`工具保存失败：${res?.errorMsg || "未知错误"}`);
      return;
    }
    state.recordings.pending = null;
    pushNote(`已保存工具「${name}」，可在「录制」抽屉里回放。`);
    await ensureRecordings(true);
  }

  async function replay(item) {
    closeDrawer();
    const res = await send({ type: "AIPDD_AGENT_REPLAY", name: item.name, actions: item.actions || [] });
    if (!res?.ok) {
      pushNote(`回放失败：${res?.errorMsg || "未知错误"}`);
      return;
    }
    if (res.status) applyAgentState(res.status);
    renderStream();
    startFastPoll();
  }

  // ---------------- 计划任务 ----------------

  const PLAN_FREQS = [
    { key: "daily", label: "每天" },
    { key: "weekly", label: "每周" },
    { key: "monthly", label: "每月" },
    { key: "hourly", label: "每小时" },
    { key: "minutes", label: "按分钟" },
  ];

  async function ensureSchedules(force) {
    if (state.schedules.loaded && !force) return;
    const res = await lib("RpaChrome_schedules", { query: {} });
    state.schedules.loaded = true;
    if (!res.ok) {
      state.schedules.errorMsg = res.errorMsg || "读取计划任务失败";
    } else {
      state.schedules.errorMsg = "";
      state.schedules.list = Array.isArray(res.data.list) ? res.data.list : [];
    }
    state.counts.schedules = state.schedules.list.length;
    renderBadges();
    if (state.drawer === "schedules") renderDrawer();
  }

  function scheduleSummary(item) {
    if (item.scheduleType === "scheduled") {
      return item.scheduledAt ? `定时一次 · ${new Date(item.scheduledAt).toLocaleString()}` : "定时一次 · 已跑完";
    }
    const cfg = item.scheduleConfig || {};
    const freq = cfg.freq || "";
    if (freq === "minutes") return `每 ${cfg.interval || 30} 分钟`;
    if (freq === "hourly") return `每小时第 ${cfg.minute || 0} 分`;
    if (freq === "daily") return `每天 ${cfg.time || "09:00"}`;
    if (freq === "weekly") {
      const names = ["一", "二", "三", "四", "五", "六", "日"];
      const days = (cfg.weekdays || []).map((d) => `周${names[d - 1] || d}`).join("、");
      return `${days || "每周"} ${cfg.time || "09:00"}`;
    }
    if (freq === "monthly") return `每月 ${cfg.day || 1} 号 ${cfg.time || "09:00"}`;
    return "周期重复";
  }

  function scheduleItem(item) {
    const row = h("div", "dw-item static");
    const main = h("div", "grow");
    main.appendChild(h("span", "t", `${item.title}${item.status === "paused" ? "（已暂停）" : ""}`));
    main.appendChild(h("span", "d", `${scheduleSummary(item)}${item.deviceName ? ` · ${item.deviceName}` : ""}`));
    if (item.lastStatusLabel) {
      const tail = item.lastStatus === "failed" && item.lastError ? `：${item.lastError}` : "";
      main.appendChild(h("span", "d", `上次：${item.lastStatusLabel}${tail}`));
    }
    main.addEventListener("click", () => {
      state.schedules.editing = scheduleDraft(item);
      renderDrawer();
    });
    row.appendChild(main);

    const run = h("button", "dw-btn sm", "立即执行");
    run.type = "button";
    run.addEventListener("click", () => void runScheduleNow(item, run));
    row.appendChild(run);

    const toggle = h("button", "dw-btn sm sub", item.status === "paused" ? "启用" : "暂停");
    toggle.type = "button";
    toggle.addEventListener("click", () => void toggleSchedule(item, toggle));
    row.appendChild(toggle);
    return row;
  }

  /** 列表项 → 表单草稿：把已存的 scheduleConfig 摊平成表单字段。 */
  function scheduleDraft(item) {
    const cfg = item.scheduleConfig || {};
    return {
      id: item.id,
      title: item.title || "",
      goal: item.goal || "",
      mode: item.mode || "act",
      startUrl: item.startUrl || "",
      clientId: item.clientId || "",
      scheduleType: item.scheduleType || "recurring",
      freq: cfg.freq || "daily",
      time: cfg.time || "09:00",
      weekdays: Array.isArray(cfg.weekdays) && cfg.weekdays.length ? cfg.weekdays : [1, 2, 3, 4, 5],
      day: cfg.day || 1,
      interval: cfg.interval || 30,
      minute: cfg.minute || 0,
      scheduledAt: toLocalInput(item.scheduledAt),
      status: item.status || "enabled",
    };
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function runScheduleNow(item, btn) {
    btn.disabled = true;
    btn.textContent = "执行中…";
    const res = await lib("RpaChrome_runSchedule", { pathParams: { id: item.id } });
    if (!res.ok) {
      btn.disabled = false;
      btn.textContent = "立即执行";
      pushNote(`执行失败：${res.errorMsg || "未知错误"}`);
      return;
    }
    pushNote(`已起一轮「${item.title}」，可在「本地RPA状态」里看这次会话的进展。`);
    await ensureSchedules(true);
  }

  async function toggleSchedule(item, btn) {
    btn.disabled = true;
    const next = item.status === "paused" ? "enabled" : "paused";
    const res = await lib("RpaChrome_saveSchedule", {
      body: {
        id: item.id,
        title: item.title,
        goal: item.goal,
        mode: item.mode,
        startUrl: item.startUrl,
        clientId: item.clientId,
        scheduleType: item.scheduleType,
        scheduleConfig: item.scheduleConfig || {},
        scheduledAt: item.scheduledAt || undefined,
        status: next,
      },
    });
    if (!res.ok) {
      btn.disabled = false;
      pushNote(`操作失败：${res.errorMsg || "未知错误"}`);
      return;
    }
    await ensureSchedules(true);
  }

  function scheduleForm(item) {
    const form = h("div", "dw-form");

    const title = h("input", "dw-input");
    title.placeholder = "任务名称，如「每日导出昨日订单」";
    title.maxLength = 80;
    title.value = item.title || "";
    title.addEventListener("input", () => {
      item.title = title.value;
    });
    form.appendChild(title);

    const goal = document.createElement("textarea");
    goal.className = "dw-input";
    goal.rows = 3;
    goal.maxLength = 1000;
    goal.placeholder = "到点要执行的一句话目标";
    goal.value = item.goal || "";
    goal.addEventListener("input", () => {
      item.goal = goal.value;
    });
    form.appendChild(goal);

    const startUrl = h("input", "dw-input");
    startUrl.placeholder = "起始地址（可选），如 https://mp.weixin.qq.com/";
    startUrl.maxLength = 2000;
    startUrl.value = item.startUrl || "";
    startUrl.addEventListener("input", () => {
      item.startUrl = startUrl.value;
    });
    form.appendChild(startUrl);

    const mode = h("select", "dw-input");
    for (const m of MODES) {
      const opt = document.createElement("option");
      opt.value = m.key;
      opt.textContent = `能力档：${m.label} · ${m.desc}`;
      if (item.mode === m.key) opt.selected = true;
      mode.appendChild(opt);
    }
    mode.addEventListener("change", () => {
      item.mode = mode.value;
    });
    form.appendChild(mode);

    const type = h("select", "dw-input");
    for (const [value, label] of [["recurring", "周期重复"], ["scheduled", "定时一次"]]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (item.scheduleType === value) opt.selected = true;
      type.appendChild(opt);
    }
    form.appendChild(type);

    const whenBox = h("div", "dw-form");
    form.appendChild(whenBox);
    const renderWhen = () => {
      whenBox.textContent = "";
      if (type.value === "scheduled") {
        const at = h("input", "dw-input");
        at.type = "datetime-local";
        at.value = item.scheduledAt || "";
        at.addEventListener("change", () => {
          item.scheduledAt = at.value;
        });
        whenBox.appendChild(at);
        whenBox.appendChild(h("div", "dw-note", "到点执行一次；设备离线则当轮跳过，跑完即结束。"));
        return;
      }
      const freq = h("select", "dw-input");
      for (const f of PLAN_FREQS) {
        const opt = document.createElement("option");
        opt.value = f.key;
        opt.textContent = `频率：${f.label}`;
        if (item.freq === f.key) opt.selected = true;
        freq.appendChild(opt);
      }
      whenBox.appendChild(freq);

      const detail = h("div", "dw-form");
      whenBox.appendChild(detail);
      const renderDetail = () => {
        detail.textContent = "";
        const key = freq.value;
        if (key === "minutes") {
          const interval = h("select", "dw-input");
          for (const value of [10, 30]) {
            const opt = document.createElement("option");
            opt.value = String(value);
            opt.textContent = `每 ${value} 分钟`;
            if (Number(item.interval) === value) opt.selected = true;
            interval.appendChild(opt);
          }
          interval.addEventListener("change", () => {
            item.interval = Number(interval.value) || 30;
          });
          detail.appendChild(interval);
          return;
        }
        if (key === "hourly") {
          const minute = h("input", "dw-input");
          minute.type = "number";
          minute.min = "0";
          minute.max = "59";
          minute.value = String(item.minute ?? 0);
          minute.placeholder = "每小时第几分（0-59）";
          minute.addEventListener("input", () => {
            item.minute = Number(minute.value) || 0;
          });
          detail.appendChild(minute);
          return;
        }
        if (key === "weekly") {
          const days = h("div", "dw-pills");
          const names = ["一", "二", "三", "四", "五", "六", "日"];
          names.forEach((label, index) => {
            const day = index + 1;
            const on = (item.weekdays || []).includes(day);
            const pill = h("button", `pill${on ? " on" : ""}`, `周${label}`);
            pill.type = "button";
            pill.addEventListener("click", () => {
              const set = new Set(item.weekdays || []);
              if (set.has(day)) set.delete(day);
              else set.add(day);
              item.weekdays = [...set].sort((a, b) => a - b);
              renderDrawer();
            });
            days.appendChild(pill);
          });
          detail.appendChild(days);
        }
        if (key === "monthly") {
          const day = h("input", "dw-input");
          day.type = "number";
          day.min = "1";
          day.max = "31";
          day.value = String(item.day || 1);
          day.placeholder = "每月几号（1-31）";
          day.addEventListener("input", () => {
            item.day = Number(day.value) || 1;
          });
          detail.appendChild(day);
        }
        if (key !== "minutes") {
          const time = h("input", "dw-input");
          time.type = "time";
          time.value = item.time || "09:00";
          time.addEventListener("change", () => {
            item.time = time.value || "09:00";
          });
          detail.appendChild(time);
        }
      };
      freq.addEventListener("change", () => {
        item.freq = freq.value;
        renderDetail();
      });
      renderDetail();
    };
    type.addEventListener("change", () => {
      item.scheduleType = type.value;
      renderWhen();
    });
    renderWhen();

    const statePills = h("div", "dw-pills");
    for (const [value, label] of [["enabled", "启用"], ["paused", "暂停"]]) {
      const pill = h("button", `pill${item.status === value ? " on" : ""}`, label);
      pill.type = "button";
      pill.addEventListener("click", () => {
        item.status = value;
        renderDrawer();
      });
      statePills.appendChild(pill);
    }
    form.appendChild(statePills);
    form.appendChild(h("div", "dw-note", "选「暂停」＝先存着不跑；到点只有设备在线才会执行，离线的那一轮直接跳过。"));

    const actions = h("div", "dw-actions");
    const save = h("button", "dw-btn", "保存");
    save.type = "button";
    save.addEventListener("click", async () => {
      const payload = {
        id: item.id,
        title: title.value.trim(),
        goal: goal.value.trim(),
        mode: mode.value,
        startUrl: startUrl.value.trim(),
        clientId: item.clientId || state.status?.clientId || "",
        scheduleType: type.value,
        status: item.status === "paused" ? "paused" : "enabled",
      };
      if (!payload.title) return pushNote("请填写任务名称。");
      if (!payload.goal) return pushNote("请填写要执行的目标。");
      if (!payload.clientId) return pushNote("这台设备还没登录，先在插件里登录本系统。");
      if (type.value === "scheduled") {
        if (!item.scheduledAt) return pushNote("请选择执行时间。");
        payload.scheduledAt = item.scheduledAt;
      } else {
        payload.scheduleConfig = {};
        if (item.freq === "minutes") payload.scheduleConfig.interval = item.interval || 30;
        if (item.freq === "weekly") {
          if (!(item.weekdays || []).length) return pushNote("每周重复至少要选一天。");
          payload.scheduleConfig.weekdays = item.weekdays;
        }
        if (item.freq === "monthly") payload.scheduleConfig.day = item.day || 1;
        if (item.freq === "hourly") payload.scheduleConfig.minute = item.minute || 0;
        payload.scheduleConfig.freq = item.freq;
        if (item.freq !== "minutes") payload.scheduleConfig.time = item.time || "09:00";
      }
      save.disabled = true;
      save.textContent = "保存中…";
      const res = await lib("RpaChrome_saveSchedule", { body: payload });
      save.disabled = false;
      save.textContent = "保存";
      if (!res.ok) {
        pushNote(`计划任务保存失败：${res.errorMsg || "未知错误"}`);
        return;
      }
      state.schedules.editing = null;
      await ensureSchedules(true);
    });
    actions.appendChild(save);

    const cancel = h("button", "dw-btn sub", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      state.schedules.editing = null;
      renderDrawer();
    });
    actions.appendChild(cancel);

    if (item.id) {
      const remove = h("button", "dw-btn danger", "删除");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const res = await lib("RpaChrome_removeSchedule", { pathParams: { id: item.id } });
        if (!res.ok) {
          remove.disabled = false;
          pushNote(`删除失败：${res.errorMsg || "未知错误"}`);
          return;
        }
        state.schedules.editing = null;
        await ensureSchedules(true);
      });
      actions.appendChild(remove);
    }
    form.appendChild(actions);
    return form;
  }

  // ---------------- 会话历史 ----------------

  async function ensureHistory(force) {
    if (state.history.loaded && !force) return;
    const query = state.history.keyword ? { keyword: state.history.keyword } : {};
    const res = await lib("RpaChrome_agents", { query });
    state.history.loaded = true;
    if (!res.ok) {
      state.history.errorMsg = res.errorMsg || "读取历史失败";
    } else {
      state.history.errorMsg = "";
      state.history.list = Array.isArray(res.data.list) ? res.data.list : [];
    }
    state.counts.history = Number(res.data.total) || state.history.list.length;
    renderBadges();
  }

  function renderHistoryList(box) {
    if (!box) return;
    box.textContent = "";
    if (state.history.errorMsg) box.appendChild(loadError(state.history.errorMsg));
    const list = state.history.list || [];
    if (!state.history.loaded) box.appendChild(emptyNote("正在读取…"));
    else if (!list.length) box.appendChild(emptyNote("还没有会话记录。发送第一个目标后，这里会按时间列出历史会话。"));
    for (const item of list) box.appendChild(historyItem(item));
  }

  function historyItem(item) {
    const wrap = h("div", "dw-hist");
    const row = h("button", "dw-item");
    row.type = "button";
    row.appendChild(h("span", "t", item.goal || "（无目标）"));
    row.appendChild(
      h("span", "d", `${item.statusLabel || item.status} · ${item.deviceName || ""} · ${item.stepCount || 0} 步`),
    );
    row.addEventListener("click", async () => {
      if (state.history.openId === item.id) {
        state.history.openId = 0;
        state.history.messages = [];
        renderHistoryList(state.history.box);
        return;
      }
      const res = await lib("RpaChrome_agent", { pathParams: { id: item.id } });
      if (!res.ok) {
        pushNote(`读取会话失败：${res.errorMsg || "未知错误"}`);
        return;
      }
      state.history.openId = item.id;
      state.history.messages = res.data.agent?.messages || [];
      renderHistoryList(state.history.box);
    });
    wrap.appendChild(row);
    if (state.history.openId === item.id) {
      const log = h("div", "dw-log");
      if (!state.history.messages.length) log.appendChild(h("div", "dw-note", "这条会话还没有留痕消息。"));
      for (const message of state.history.messages) {
        const line = `[${message.kind}] ${message.role === "user" ? "你" : "Agent"}：${message.content || ""}`;
        log.appendChild(h("div", "dw-log-line", line.slice(0, 400)));
      }
      wrap.appendChild(log);
    }
    return wrap;
  }

  function codeRow(text) {
    const row = h("div", "dw-item");
    const code = h("code", null, text);
    row.appendChild(code);
    const copy = h("button", "dw-btn sub", "复制");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "已复制";
        setTimeout(() => {
          copy.textContent = "复制";
        }, 1200);
      } catch (_) {
        copy.textContent = "复制失败";
      }
    });
    row.appendChild(copy);
    return row;
  }

  function modelRow(item) {
    const row = h("button", "dw-item");
    row.type = "button";
    row.appendChild(h("span", "t", `${item.label}${item.key === state.modelKey ? " · 当前" : ""}`));
    if (item.desc) row.appendChild(h("span", "d", item.desc));
    row.addEventListener("click", () => {
      state.modelKey = item.key;
      renderHeader();
      renderDrawer();
      closePop();
    });
    return row;
  }

  function renderDrawer() {
    const def = drawers[state.drawer];
    if (!def) return;
    el.dwTitle.textContent = def.title;
    el.dwBody.textContent = "";
    try {
      const result = def.render(el.dwBody);
      if (result && typeof result.catch === "function") {
        result.catch((error) => pushNote(`抽屉加载失败：${String(error?.message || error)}`));
      }
    } catch (error) {
      pushNote(`抽屉加载失败：${String(error?.message || error)}`);
    }
  }

  function openDrawer(key) {
    state.drawer = key;
    if (key === "skills") {
      state.skills.editing = null;
      state.skills.loaded = false;
    }
    if (key === "recordings") state.recordings.loaded = false;
    if (key === "schedules") {
      state.schedules.loaded = false;
      state.schedules.editing = null;
    }
    if (key === "history") state.history.loaded = false;
    el.drawer.hidden = false;
    el.scrim.hidden = false;
    renderDrawer();
    for (const btn of document.querySelectorAll(".ft-btn")) {
      btn.classList.toggle("active", btn.dataset.drawer === key);
    }
  }

  function closeDrawer() {
    state.drawer = "";
    el.drawer.hidden = true;
    el.scrim.hidden = true;
    for (const btn of document.querySelectorAll(".ft-btn")) btn.classList.remove("active");
  }

  // ---------------- 浮层（模式 / 模型 / 账号） ----------------

  function placePop(pop, anchor, align) {
    pop.hidden = false;
    pop.style.top = `${anchor.getBoundingClientRect().bottom + 6}px`;
    if (align === "right") {
      pop.style.right = "8px";
      pop.style.left = "auto";
    } else {
      pop.style.left = "8px";
      pop.style.right = "auto";
    }
  }

  function closePop() {
    el.modePop.hidden = true;
    el.modelPop.hidden = true;
    el.accountPop.hidden = true;
  }

  function toggleMode() {
    const anchor = el.modeBtn;
    const wasHidden = el.modePop.hidden;
    closePop();
    if (!wasHidden) return;
    el.modePop.textContent = "";
    el.modePop.appendChild(h("div", "pop-title", "运行模式"));
    for (const item of MODES) {
      const btn = h("button", "pop-item");
      btn.type = "button";
      btn.appendChild(h("span", null, item.label));
      btn.appendChild(h("span", "d", item.desc));
      btn.addEventListener("click", () => {
        state.mode = item.key;
        el.modeBtn.textContent = item.label;
        el.modeBtn.appendChild(h("span", "caret", "▾"));
        closePop();
      });
      el.modePop.appendChild(btn);
    }
    el.modePop.style.top = "auto";
    el.modePop.style.bottom = `${window.innerHeight - anchor.getBoundingClientRect().top + 6}px`;
    el.modePop.style.left = "8px";
    el.modePop.style.right = "auto";
    el.modePop.hidden = false;
  }

  function toggleModelPop() {
    const wasHidden = el.modelPop.hidden;
    closePop();
    if (!wasHidden) return;
    el.modelPop.textContent = "";
    el.modelPop.appendChild(h("div", "pop-title", "模型（本系统模型广场）"));
    el.modelPop.appendChild(popModelItem({ key: "", label: "默认模型", desc: "跟随本账号设置" }));
    for (const item of state.models) el.modelPop.appendChild(popModelItem(item));
    if (!state.models.length) {
      el.modelPop.appendChild(h("div", "pop-title", "模型清单随登录后从模型广场读取"));
    }
    placePop(el.modelPop, el.modelBtn, "right");
  }

  function popModelItem(item) {
    const btn = h("button", "pop-item");
    btn.type = "button";
    btn.appendChild(h("span", null, `${item.label}${item.key === state.modelKey ? " ✓" : ""}`));
    if (item.desc) btn.appendChild(h("span", "d", item.desc));
    btn.addEventListener("click", () => {
      state.modelKey = item.key;
      renderHeader();
      closePop();
    });
    return btn;
  }

  function toggleAccountPop() {
    const wasHidden = el.accountPop.hidden;
    closePop();
    if (!wasHidden) return;
    renderAccountPop();
  }

  /** 未连接时点顶部状态直接拉起登录浮层（与右上角「⋯」同一个浮层）。 */
  function openAccountPop() {
    closePop();
    renderAccountPop();
  }

  function renderAccountPop() {
    const pop = el.accountPop;
    pop.textContent = "";
    const connected = Boolean(state.status?.hasToken);
    const domain = String(state.status?.domain || "").replace(/\/+$/, "");
    pop.appendChild(h("div", "pop-title", connected ? state.status?.username || "已连接" : "未连接本系统"));

    // 未登录时把「设备登录」表单直接放在浮层里：登录入口随图标点击一起进侧边栏，不再另开弹窗。
    if (!connected) {
      pop.appendChild(buildLoginForm());
      pop.appendChild(h("div", "pop-sep"));
    }

    popItem(pop, "打开本系统", connected, () => openTab(domain));
    popItem(pop, "帮助中心 · 浏览器代理", connected, () => openTab(siteUrl("/help")));
    pop.appendChild(h("div", "pop-sep"));

    popItem(pop, "停止所有控制", connected, stopAll, "停止侧边栏 Agent 与云端下发到本机的会话");
    popItem(pop, "重新登录 / 断开", connected, () => send({ type: "AIPDD_RPA_DISCONNECT" }));
    placePop(pop, el.accountBtn, "right");
  }

  /** 设备登录表单：域名 + 账号 + 密码 + 记住域名。口令只用于这一次请求，成功后立即清空输入框。 */
  function buildLoginForm() {
    const wrap = h("div");
    // 协议由用户自己填 / 改（本机开发常为 http），不再由界面写死 https。
    const domainInput = popInput(wrap, "本系统域名", "text", "https://oem.example.com");
    const userInput = popInput(wrap, "账号", "text", "本系统登录账号");
    const passInput = popInput(wrap, "密码", "password", "本系统登录密码");
    const remember = h("label", "pop-remember");
    const rememberBox = document.createElement("input");
    rememberBox.type = "checkbox";
    rememberBox.checked = state.status?.remember !== false;
    remember.appendChild(rememberBox);
    remember.appendChild(h("span", null, "记住域名（不保存密码）"));
    wrap.appendChild(remember);

    const status = h("div", "pop-status", "");
    const submit = h("button", "pop-submit", "登录并连接");
    submit.type = "button";
    submit.addEventListener("click", () =>
      void connectDevice({ domainInput, userInput, passInput, rememberBox, submit, status }),
    );
    wrap.appendChild(submit);
    wrap.appendChild(status);

    const saved = String(state.status?.domain || "").trim();
    domainInput.value = saved || "https://";
    if (state.status?.username) userInput.value = state.status.username;
    return wrap;
  }

  /** 浮层里的一行输入，返回 input 元素。 */
  function popInput(parent, label, type, placeholder) {
    const field = h("div", "pop-field");
    field.appendChild(h("span", "lb", label));
    const row = h("div", "pop-input");
    const input = document.createElement("input");
    input.type = type;
    input.placeholder = placeholder;
    input.autocomplete = "off";
    row.appendChild(input);
    field.appendChild(row);
    parent.appendChild(field);
    return input;
  }

  async function connectDevice(fields) {
    const domain = fields.domainInput.value.trim();
    const username = fields.userInput.value.trim();
    const password = fields.passInput.value;
    if (!domain || !username || !password) {
      fields.status.textContent = "请填写域名、账号与密码";
      return;
    }
    fields.submit.disabled = true;
    fields.status.textContent = "正在登录…";
    // 目标站点的 host 权限（<all_urls>）必须在用户手势里申请（后台收消息时手势已失效）；
    // scripting 已随插件声明为必需权限，这里只申请站点访问。
    await chrome.permissions.request({ origins: ["<all_urls>"] }).catch(() => false);
    const result = await send({
      type: "AIPDD_RPA_CONNECT",
      domain,
      username,
      password,
      remember: fields.rememberBox.checked,
      deviceName: `Chrome · ${chrome.runtime.getManifest().version}`.trim(),
    });
    fields.passInput.value = "";
    fields.submit.disabled = false;
    if (!result?.ok) {
      fields.status.textContent = result?.errorMsg || "登录失败";
      return;
    }
    closePop();
    await refresh();
  }

  async function stopAll() {
    await send({ type: "AIPDD_AGENT_STOP" });
    await send({ type: "AIPDD_RPA_STOP", sessionId: 0 });
    await refreshAgent();
  }

  function popItem(pop, label, enabled, onClick, desc) {
    const btn = h("button", "pop-item");
    btn.type = "button";
    btn.disabled = !enabled;
    btn.appendChild(h("span", null, label));
    if (desc) btn.appendChild(h("span", "d", desc));
    btn.addEventListener("click", async () => {
      closePop();
      await onClick();
    });
    pop.appendChild(btn);
    return btn;
  }

  // ---------------- 状态刷新 ----------------

  function applyAgentState(agent) {
    if (!agent || typeof agent !== "object") return;
    state.agent = {
      messages: Array.isArray(agent.messages) ? agent.messages : [],
      phase: String(agent.phase || "idle"),
      pendingConfirm: agent.pendingConfirm || null,
      running: agent.running === true,
      maxSteps: Number(agent.maxSteps) || 25,
      autoRun: agent.autoRun === true,
    };
    if (agent.recording && typeof agent.recording === "object") {
      state.recording = { on: agent.recording.on === true, count: Number(agent.recording.count) || 0 };
    }
  }

  async function refreshAgent() {
    const agent = await send({ type: "AIPDD_AGENT_STATE" });
    if (agent && agent.ok !== false) applyAgentState(agent);
    renderStream();
    renderComposer();
    updateRecordingLive();
  }

  /** 录制中只改那一行计数，不重画整个抽屉（否则输入框与滚动位置都会被清掉）。 */
  function updateRecordingLive() {
    const node = state.recordings.liveNode;
    if (node) node.textContent = `正在录制…已录 ${state.recording.count} 步`;
  }

  function renderComposer() {
    const running = state.agent.running;
    el.sendBtn.textContent = running ? "停止" : "发送";
    el.sendBtn.classList.toggle("stop", running);
    el.modeBtn.disabled = running;
    renderRunGate();
  }

  async function stopAgent() {
    await send({ type: "AIPDD_AGENT_STOP" });
    await refreshAgent();
  }

  async function refresh() {
    const status = await send({ type: "AIPDD_RPA_STATUS" });
    if (status?.ok) state.status = status;
    await refreshAgent();
    renderHeader();
    if (!state.models.length && state.status?.hasToken) await loadBootstrap();
  }

  /** 从平台读「可用模型 + 额度」（同一设备令牌）；失败保持原状，界面显示「默认模型」。 */
  async function loadBootstrap() {
    const data = await send({ type: "AIPDD_AGENT_BOOTSTRAP" });
    if (!data?.ok) return;
    state.models = Array.isArray(data.models) ? data.models : [];
    state.balance = Number(data.balance) || 0;
    state.rate = Number(data.rate) || 0;
    renderHeader();
    if (state.drawer) renderDrawer();
  }

  let fastPoll = null;
  function startFastPoll() {
    if (fastPoll) return;
    fastPoll = setInterval(() => {
      if (document.hidden) return;
      void refreshAgent().then(() => {
        if (!state.agent.running) stopFastPoll();
      });
    }, 1000);
  }

  function stopFastPoll() {
    if (fastPoll) clearInterval(fastPoll);
    fastPoll = null;
  }

  function bind() {
    for (const sample of SAMPLES) {
      const btn = h("button", "sample", sample);
      btn.type = "button";
      btn.addEventListener("click", () => {
        el.goal.value = sample;
        autosize();
        el.goal.focus();
      });
      el.samples.appendChild(btn);
    }

    el.sendBtn.addEventListener("click", () => {
      if (state.agent.running) void stopAgent();
      else void submit();
    });
    el.goal.addEventListener("input", autosize);
    el.goal.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    });

    el.modeBtn.addEventListener("click", toggleMode);
    if (el.runGateBtn) {
      el.runGateBtn.addEventListener("click", async () => {
        const result = await send({ type: "AIPDD_AGENT_SET_AUTORUN", autoRun: state.agent.autoRun !== true });
        if (result?.ok !== false) await refreshAgent();
        else pushNote(`切换执行方式失败：${result?.errorMsg || "未知错误"}`);
      });
    }
    el.modelBtn.addEventListener("click", toggleModelPop);
    el.accountBtn.addEventListener("click", toggleAccountPop);
    el.state.addEventListener("click", () => {
      if (!state.status?.hasToken) openAccountPop();
    });
    // 未连接时这个胶囊显示「未连接」，点它同样直接给登录浮层（别去打开模型抽屉）。
    el.creditsBtn.addEventListener("click", () => {
      if (!state.status?.hasToken) openAccountPop();
      else openDrawer("models");
    });

    el.attachBtn.addEventListener("click", () => el.fileInput.click());
    el.fileInput.addEventListener("change", async () => {
      const files = Array.from(el.fileInput.files || []);
      el.fileInput.value = "";
      if (!files.length) return;
      for (const file of files.slice(0, 3)) {
        try {
          const data = await readFileAsDataUrl(file);
          const result = await send({ type: "AIPDD_AGENT_ATTACH", name: file.name, data });
          if (!result?.ok) pushNote(`「${file.name}」上传失败：${result?.errorMsg || "未知错误"}`);
        } catch (error) {
          pushNote(`「${file.name}」读取失败：${String(error?.message || error)}`);
        }
      }
      await refreshAgent();
    });

    el.enhanceBtn.addEventListener("click", async () => {
      const goal = String(el.goal.value || "").trim();
      if (!goal) {
        pushNote("先写下目标，再用「增强提示」把它扩写清楚。");
        return;
      }
      const result = await send({ type: "AIPDD_AGENT_ENHANCE", goal, modelKey: state.modelKey });
      if (result?.ok && result.goal) {
        el.goal.value = result.goal;
        autosize();
      } else {
        pushNote(`增强提示不可用：${result?.errorMsg || "模型未返回结果"}`);
      }
    });

    for (const btn of document.querySelectorAll(".ft-btn")) {
      btn.addEventListener("click", () => {
        const key = btn.dataset.drawer;
        if (state.drawer === key) closeDrawer();
        else openDrawer(key);
      });
    }
    el.dwBack.addEventListener("click", closeDrawer);
    el.scrim.addEventListener("click", closeDrawer);

    document.addEventListener("click", (event) => {
      if (event.target.closest(".pop") || event.target.closest(".chip") || event.target.closest("#accountBtn") || event.target.closest("#hdState")) return;
      if (event.target.closest(".mode")) return;
      closePop();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePop();
        if (state.drawer) closeDrawer();
      }
    });
  }

  function renderBadges() {
    const map = {
      badgeHistory: state.counts.history,
      badgeSkills: state.counts.skills,
      badgeSchedules: state.counts.schedules,
      badgeRecordings: state.counts.recordings,
    };
    for (const [id, count] of Object.entries(map)) {
      const node = $(id);
      if (!node) continue;
      node.hidden = !count;
      node.textContent = String(count);
    }
  }

  bind();
  renderBadges();
  renderStream();
  void refresh().then(() => {
    if (state.agent.running) startFastPoll();
  });
  // 侧边栏可能长期开着：3 秒一轮足够反映在线/离线与待确认变化，又不会一直占着 Service Worker。
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 3000);
})();
