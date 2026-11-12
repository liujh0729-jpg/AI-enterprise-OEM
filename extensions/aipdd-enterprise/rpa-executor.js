// 本地 Chrome RPA 动作执行器（内容脚本，由后台 chrome.scripting.executeScript 动态注入到目标页）。
// 只做「闭集动作」：snapshot / read / act / wait，外加顶部横幅与停止按钮。
// 安全边界（方案 §4.4）：只接受扩展内部 chrome.runtime 消息，不监听页面 postMessage——
// 网页里的脚本无法指挥这台浏览器；不读 Cookie、不读密码框的值、不注入任意 JS（无 eval_script）。
(() => {
  if (self.__AIPDD_RPA_EXEC__) return;
  self.__AIPDD_RPA_EXEC__ = true;

  const MAX_ELEMENTS = 120;
  const BANNER_ID = "aipdd-rpa-banner";
  // 会话缓冲：snapshot 出的元素清单按 index 缓存，后续 act/read 的 elementIndex 指回同一份清单。
  let lastMap = [];

  const clip = (value, max) => String(value == null ? "" : value).slice(0, max);
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      if (typeof el.checkVisibility === "function") {
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      }
    } catch (_) {
      /* 老浏览器没有 checkVisibility：走下面的几何判断 */
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = self.getComputedStyle(el);
    if (!style || style.visibility === "hidden" || style.display === "none") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  function cssPath(el) {
    const esc = (value) => (self.CSS && CSS.escape ? CSS.escape(value) : value);
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
      const sel = `#${esc(el.id)}`;
      try {
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch (_) {
        /* 忽略非法选择器 */
      }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      node = parent;
    }
    return parts.join(" > ");
  }

  function roleOf(el) {
    const explicit = clip(el.getAttribute && el.getAttribute("role"), 24);
    if (explicit) return explicit.toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return tag;
  }

  function nameOf(el) {
    const candidates = [
      el.getAttribute && el.getAttribute("aria-label"),
      el.getAttribute && el.getAttribute("placeholder"),
      el.getAttribute && el.getAttribute("title"),
      el.getAttribute && el.getAttribute("name"),
      el.innerText,
      el.textContent,
    ];
    for (const value of candidates) {
      const text = clip(value, 120).replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return "";
  }

  const INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=tab]",
    "[role=menuitem]",
    "[contenteditable='']",
    "[contenteditable=true]",
    "[onclick]",
  ].join(",");

  function collectElements() {
    const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
    const list = [];
    for (const el of nodes) {
      if (list.length >= MAX_ELEMENTS) break;
      if (!isVisible(el)) continue;
      const type = el.tagName.toLowerCase() === "input" ? (el.getAttribute("type") || "text") : "";
      // 密码框绝不回传 value（不读密码）。
      const value =
        type === "password" ? "" : clip(el.value != null ? el.value : el.textContent, 120);
      list.push({
        i: list.length,
        role: roleOf(el),
        name: nameOf(el),
        selector: cssPath(el),
        value,
        href: clip(el.getAttribute && el.getAttribute("href"), 300),
      });
    }
    return list;
  }

  function buildSnapshot(maxChars) {
    lastMap = collectElements();
    let text = "";
    try {
      text = clip(document.body ? document.body.innerText : "", maxChars);
    } catch (_) {
      text = "";
    }
    return {
      url: location.href,
      title: document.title,
      pageMap: lastMap,
      text,
    };
  }

  /** 目标解析：优先 elementIndex（指回最近一次 snapshot 的清单），其次 selector。 */
  function resolveTarget(target) {
    if (target == null) return null;
    if (typeof target === "number") {
      return elementByIndex(target);
    }
    if (typeof target === "string") {
      return query(target);
    }
    if (typeof target === "object") {
      if (target.elementIndex !== undefined) return elementByIndex(Number(target.elementIndex));
      if (target.selector) return query(String(target.selector));
    }
    return null;
  }

  /** 决策器习惯把目标写成扁平的 elementIndex/selector，执行器内部只认 target：这里统一收口。 */
  function targetOf(action) {
    if (action.target != null) return action.target;
    if (action.elementIndex !== undefined) return { elementIndex: Number(action.elementIndex) };
    if (action.selector) return { selector: String(action.selector) };
    return null;
  }

  function elementByIndex(index) {
    if (!Number.isInteger(index) || index < 0) return null;
    const entry = lastMap[index] || collectElements()[index];
    if (!entry) return null;
    try {
      return document.querySelector(entry.selector);
    } catch (_) {
      return null;
    }
  }

  function query(selector) {
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof self.HTMLTextAreaElement
        ? self.HTMLTextAreaElement.prototype
        : self.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clickElement(el) {
    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (_) {
      /* 不可滚动时忽略 */
    }
    el.focus && el.focus();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: self }));
      } catch (_) {
        /* 合成事件失败则退回到原生 click */
      }
    }
    el.click && el.click();
  }

  async function runAct(action) {
    const act = clip(action.act, 24);
    if (act === "scroll") {
      const dir = clip(action.value, 8).toLowerCase() === "up" ? -1 : 1;
      self.scrollBy({ top: dir * Math.round(self.innerHeight * 0.9), behavior: "instant" });
      return { matched: true, effect: dir < 0 ? "向上滚动一屏" : "向下滚动一屏" };
    }
    const el = resolveTarget(targetOf(action));
    if (act === "key") {
      // 不给元素时作用于当前焦点，这是「输入完按回车搜索」的常用形态。
      const target = el || document.activeElement || document.body;
      const key = clip(action.key || action.value, 24) || "Enter";
      for (const type of ["keydown", "keypress", "keyup"]) {
        target.dispatchEvent(
          new KeyboardEvent(type, { key, bubbles: true, cancelable: true }),
        );
      }
      return { matched: true, effect: `已按键 ${key}` };
    }
    if (!el) return { matched: false, effect: "没有匹配到目标元素" };
    if (act === "click") {
      clickElement(el);
      return { matched: true, effect: `已点击「${clip(nameOf(el), 60)}」` };
    }
    if (act === "type") {
      el.focus && el.focus();
      const value = clip(action.value, 2000);
      if (action.clearFirst !== false) setNativeValue(el, "");
      if (el.isContentEditable) {
        el.textContent = action.clearFirst === false ? `${el.textContent}${value}` : value;
      } else {
        setNativeValue(el, action.clearFirst === false ? `${el.value || ""}${value}` : value);
      }
      fireInput(el);
      return { matched: true, effect: `已在「${clip(nameOf(el), 60)}」输入 ${value.length} 字` };
    }
    if (act === "select") {
      const value = clip(action.value, 200);
      setNativeValue(el, value);
      fireInput(el);
      return { matched: true, effect: `已选择「${value}」` };
    }
    if (act === "check") {
      const next = action.value === false ? false : true;
      el.checked = next;
      fireInput(el);
      return { matched: true, effect: next ? "已勾选" : "已取消勾选" };
    }
    if (act === "submit") {
      const form = el.form || (el.tagName === "FORM" ? el : el.closest && el.closest("form"));
      if (form && typeof form.requestSubmit === "function") {
        form.requestSubmit();
        return { matched: true, effect: "已提交表单" };
      }
      clickElement(el);
      return { matched: true, effect: "已触发提交" };
    }
    return { matched: false, effect: `不支持的动作 act=${act}` };
  }

  function runRead(action) {
    const mode = clip(action.mode, 24) || "text";
    const wanted = targetOf(action);
    const target = resolveTarget(wanted);
    if (mode === "count") {
      const base = wanted && wanted.selector ? String(wanted.selector) : "";
      if (!base) return { value: "", count: 0 };
      try {
        return { value: "", count: document.querySelectorAll(base).length };
      } catch (_) {
        return { value: "", count: 0 };
      }
    }
    if (!target) return { value: "" };
    if (mode === "attribute") {
      const attr = clip(action.value || action.attribute, 40) || "href";
      return { value: clip(target.getAttribute(attr), 2000) };
    }
    return { value: clip(target.innerText != null ? target.innerText : target.textContent, 2000) };
  }

  async function runWait(action) {
    const wanted = targetOf(action);
    if (wanted) {
      const timeoutMs = Math.min(30000, Math.max(0, Number(action.timeoutMs) || 10000));
      const start = Date.now();
      for (;;) {
        if (resolveTarget(wanted)) {
          return { ok: true, elapsedMs: Date.now() - start };
        }
        if (Date.now() - start >= timeoutMs) {
          return { ok: false, elapsedMs: Date.now() - start, errorMessage: "等待目标出现超时" };
        }
        await sleep(250);
      }
    }
    const ms = Math.min(30000, Math.max(0, Number(action.ms) || 1000));
    await sleep(ms);
    return { ok: true, elapsedMs: ms };
  }

  // ---------- 顶部横幅（AI 正在控制此页面 · 停止）----------

  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;
    const bar = document.createElement("div");
    bar.id = BANNER_ID;
    bar.setAttribute(
      "style",
      [
        "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647",
        "display:flex", "align-items:center", "gap:12px", "justify-content:center",
        "padding:8px 14px", "background:#1677ff", "color:#fff",
        "font:13px/1.5 'PingFang SC','Microsoft YaHei',sans-serif",
        "box-shadow:0 2px 8px rgba(0,0,0,.18)",
      ].join(";"),
    );
    const label = document.createElement("span");
    label.textContent = "AI 正在控制此页面";
    const button = document.createElement("button");
    button.textContent = "停止";
    button.setAttribute(
      "style",
      "padding:3px 12px;border:none;border-radius:5px;background:#fff;color:#1677ff;font-size:12px;cursor:pointer",
    );
    button.addEventListener("click", () => {
      // 停止指令只发给扩展后台，不经过页面（页面脚本无法伪造停止）。
      chrome.runtime.sendMessage({ type: "AIPDD_RPA_STOP" }).catch(() => undefined);
    });
    bar.appendChild(label);
    bar.appendChild(button);
    (document.body || document.documentElement).appendChild(bar);
  }

  function hideBanner() {
    const bar = document.getElementById(BANNER_ID);
    if (bar) bar.remove();
  }

  // ---------- 录制 → 工具（把本人在页面上的操作拍成闭集动作序列）----------
  // 只录交互（点击 / 输入 / 选择 / 勾选），用 selector 定位（回放时页面结构未必与录制时一致）；
  // 密码框一律不录，扩展自己的横幅不录，页面上限 200 步。

  const RECORD_MAX = 200;
  const recording = { on: false, actions: [], url: "" };

  function recordableNode(node) {
    let el = node && node.nodeType === 1 ? node : null;
    if (!el || typeof el.closest !== "function") return null;
    if (el.closest(`#${BANNER_ID}`)) return null;
    const hit = el.closest(INTERACTIVE_SELECTOR);
    return hit || null;
  }

  function pushRecord(action) {
    if (recording.actions.length >= RECORD_MAX) return;
    recording.actions.push(action);
    chrome.runtime.sendMessage({ type: "AIPDD_AGENT_RECORD_EVENT", action }).catch(() => undefined);
  }

  function onRecordClick(event) {
    const el = recordableNode(event.target);
    if (!el) return;
    pushRecord({ action: "act", act: "click", selector: cssPath(el), name: clip(nameOf(el), 80) });
  }

  function onRecordChange(event) {
    const el = recordableNode(event.target);
    if (!el) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "password") return; // 口令永不入库
    const selector = cssPath(el);
    if (tag === "select") {
      pushRecord({ action: "act", act: "select", selector, value: clip(el.value, 200) });
      return;
    }
    if (type === "checkbox" || type === "radio") {
      pushRecord({ action: "act", act: "check", selector, value: el.checked === true });
      return;
    }
    const value = clip(el.isContentEditable ? el.textContent : el.value, 2000);
    if (value) pushRecord({ action: "act", act: "type", selector, value });
  }

  function setRecording(on) {
    if (on === true) {
      if (recording.on) return { recording: true, count: recording.actions.length };
      recording.on = true;
      recording.actions = [];
      recording.url = location.href;
      document.addEventListener("click", onRecordClick, true);
      document.addEventListener("change", onRecordChange, true);
      return { recording: true, count: 0 };
    }
    if (recording.on) {
      document.removeEventListener("click", onRecordClick, true);
      document.removeEventListener("change", onRecordChange, true);
      recording.on = false;
    }
    return { recording: false, count: recording.actions.length };
  }

  // ---------- 消息入口（仅扩展内部）----------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (String(message?.type || "") !== "AIPDD_RPA_EXEC") return false;
    const action = message.action && typeof message.action === "object" ? message.action : {};
    const started = Date.now();
    (async () => {
      try {
        const name = String(action.action || "");
        let data;
        if (name === "snapshot") {
          data = buildSnapshot(Math.min(6000, Math.max(200, Number(action.maxChars) || 2000)));
        } else if (name === "read") {
          data = runRead(action);
        } else if (name === "act") {
          data = await runAct(action);
          if (data.matched === false) {
            sendResponse({
              ok: false,
              data,
              errorMessage: data.effect || "动作未生效",
              code: "NO_MATCH",
              elapsedMs: Date.now() - started,
            });
            return;
          }
        } else if (name === "wait") {
          data = await runWait(action);
          if (data.ok === false) {
            sendResponse({
              ok: false,
              data,
              errorMessage: data.errorMessage || "等待超时",
              code: "WAIT_TIMEOUT",
              elapsedMs: Date.now() - started,
            });
            return;
          }
        } else if (name === "banner") {
          if (action.show === false) hideBanner();
          else showBanner();
          data = { shown: action.show !== false };
        } else if (name === "record") {
          data = setRecording(action.on === true);
          if (data.recording === false) data.actions = recording.actions.slice();
        } else {
          sendResponse({
            ok: false,
            data: {},
            errorMessage: `执行器不认识的动作：${name}`,
            code: "UNKNOWN_ACTION",
            elapsedMs: Date.now() - started,
          });
          return;
        }
        sendResponse({ ok: true, data, errorMessage: "", code: "", elapsedMs: Date.now() - started });
      } catch (error) {
        sendResponse({
          ok: false,
          data: {},
          errorMessage: String(error?.message || error || "执行失败"),
          code: "EXEC_ERROR",
          elapsedMs: Date.now() - started,
        });
      }
    })();
    return true;
  });
})();
