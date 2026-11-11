// 触达执行器：一份文件两半，按运行环境自动选择。
// - 页面侧（内容脚本）：在平台页里找到评论/私信输入框，填已审通过的话术并提交，回报结果。
// - 后台侧（Service Worker）：领到 outreach 任务后开目标页、投递指令、把回执交回 acquisition.js。
// 不做登录、不读 Cookie、不绕验证码；找不到输入框就停在该页并把话术复制到剪贴板，交人工接手。
(function () {
  const isPage = typeof window !== "undefined";

  // ---------- 页面侧 ----------
  if (isPage) {
    if (window.__AIPDD_ENTERPRISE_OUTREACH__) return;
    window.__AIPDD_ENTERPRISE_OUTREACH__ = true;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clip = (value, max) => String(value == null ? "" : value).slice(0, max);
    const str = (value) => String(value == null ? "" : value);

    function visible(node) {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function eachDoc(root = document, depth = 0) {
      const docs = [root];
      if (depth >= 2) return docs;
      for (const frame of root.querySelectorAll("iframe")) {
        try {
          if (frame.contentDocument && frame.contentDocument.body) {
            docs.push(...eachDoc(frame.contentDocument, depth + 1));
          }
        } catch (_) {
          /* 跨源 iframe 不可读 */
        }
      }
      return;
    }

    function findOne(selectors) {
      for (const selector of selectors) {
        for (const doc of eachDoc()) {
          try {
            for (const node of doc.querySelectorAll(selector)) {
              if (visible(node)) return node;
            }
          } catch (_) {
            /* 非法选择器跳过 */
          }
        }
      }
      return null;
    }

    async function waitFor(selectors, timeoutMs = 12000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const node = findOne(selectors);
        if (node) return node;
        await sleep(300);
      }
      return null;
    }

    function textOf(node) {
      return clip(str(node?.textContent).replace(/\s+/g, " ").trim(), 80);
    }

    /** 按可见文字找按钮：平台的提交按钮 class 每次改版都会变，文字相对稳定。 */
    function buttonByText(words, root = document) {
      const wanted = words.map((word) => word.toLowerCase());
      for (const doc of eachDoc(root)) {
        const nodes = doc.querySelectorAll("button, [role='button'], a, span, div");
        for (const node of nodes) {
          if (!visible(node)) continue;
          const tag = node.tagName;
          // 只在短文字的节点上匹配，避免命中整块容器
          if (tag === "SPAN" || tag === "DIV") {
            if (node.querySelector("button, [role='button'], a")) continue;
          }
          const label = textOf(node);
          if (!label || label.length > 12) continue;
          if (wanted.includes(label.toLowerCase())) return node;
        }
      }
      return null;
    }

    function isLoginWall() {
      const body = str(document.body?.innerText);
      if (/扫码登录|账号密码登录|手机号登录/.test(body)) return "NEED_LOGIN";
      if (document.querySelector(".login-container, .login-modal, .login-mask")) {
        return "NEED_LOGIN";
      }
      return "";
    }

    function isCaptcha() {
      const body = str(document.body?.innerText);
      if (/拖动滑块|滑块验证|安全验证|访问过于频繁|请完成验证/.test(body)) {
        return "CAPTCHA";
      }
      if (document.querySelector(".captcha-container, .nc-container, .verify-wrap")) {
        return "CAPTCHA";
      }
      return "";
    }

    /** React/Vue 受控 textarea：走原生 setter，否则值不进组件状态。 */
    function setInputValue(input, value) {
      const win = (input.ownerDocument && input.ownerDocument.defaultView) || window;
      const proto =
        input instanceof win.HTMLTextAreaElement
          ? win.HTMLTextAreaElement.prototype
          : win.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if ((input.value || "") !== value) {
        throw new Error("输入框填充失败（页面框架拦截了赋值）");
      }
    }

    /** contenteditable（Draft.js / ProseMirror）：聚焦 + insertText，回读校验。 */
    async function setEditable(editor, text) {
      editor.scrollIntoView({ block: "center" });
      editor.click();
      await sleep(200);
      const win = (editor.ownerDocument && editor.ownerDocument.defaultView) || window;
      const selection = win.getSelection();
      const range = win.document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      const before = str(editor.textContent).length;
      win.document.execCommand("insertText", false, text);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
      if (text.trim() && str(editor.textContent).length <= before) {
        throw new Error("富文本填充失败（标签页可能未聚焦），请切到该平台标签页重试");
      }
    }

    function editorIsEmpty(editor) {
      if (!editor) return true;
      if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
        return !str(editor.value).trim();
      }
      return !str(editor.textContent).trim();
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        return false;
      }
    }

    /** 抖音评论：视频页评论区通常已展开；没有输入框就先点「评论」入口。 */
    async function runDouyinComment(text) {
      const editor = await waitFor(
        [
          '[data-e2e="comment-input"]',
          '.comment-input-inner-container [contenteditable="true"]',
          'div[contenteditable="true"][data-placeholder*="评论"]',
          'div[contenteditable="true"][data-placeholder*="善语"]',
          '.public-DraftEditor-content[contenteditable="true"]',
        ],
        8000,
      );
      if (!editor) {
        const opened = buttonByText(["评论"]);
        if (opened) {
          opened.click();
          await sleep(1200);
        }
      }
      const input =
        editor ||
        (await waitFor(
          [
            '[data-e2e="comment-input"]',
            '.comment-input-inner-container [contenteditable="true"]',
            'div[contenteditable="true"][data-placeholder*="评论"]',
            'div[contenteditable="true"][data-placeholder*="善语"]',
          ],
          6000,
        ));
      if (!input) {
        return { status: "manual", error: "没找到评论区输入框：可能是登录墙或页面结构变化" };
      }
      await setEditable(input, text);
      await sleep(400);
      const submit =
        findOne(['[data-e2e="comment-publish"]', '[data-e2e="comment-submit"]']) ||
        buttonByText(["发送", "发布", "评论"], input.closest("div") || document);
      if (!submit) {
        return { status: "manual", error: "已填入评论但没找到「发送」按钮，请在该页手动提交" };
      }
      submit.click();
      for (let i = 0; i < 20; i += 1) {
        await sleep(400);
        if (editorIsEmpty(input)) {
          return { status: "succeeded", ref: "" };
        }
      }
      return { status: "submitted", ref: "" };
    }

    /** 小红书私信：主页先点「私信」进入会话，再找聊天输入框。 */
    async function runXhsDm(text) {
      let input = findOne([
        "#chat-input",
        '.chat-input [contenteditable="true"]',
        '.chat-input textarea',
        'textarea[placeholder*="消息"]',
        'div[contenteditable="true"][data-placeholder*="消息"]',
      ]);
      if (!input) {
        const entry = buttonByText(["私信", "发消息"]);
        if (entry) {
          entry.click();
          await sleep(1500);
        }
      }
      input =
        input ||
        (await waitFor(
          [
            "#chat-input",
            '.chat-input [contenteditable="true"]',
            '.chat-input textarea',
            'textarea[placeholder*="消息"]',
            'div[contenteditable="true"][data-placeholder*="消息"]',
          ],
          8000,
        ));
      if (!input) {
        return { status: "manual", error: "该账号未开放私信或没找到会话输入框：请在该页手动发送" };
      }
      if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
        setInputValue(input, text);
      } else {
        await setEditable(input, text);
      }
      await sleep(400);
      const submit =
        findOne(['.chat-input button', '[class*="chat"] button[class*="send"]']) ||
        buttonByText(["发送"]);
      if (submit) {
        submit.click();
      } else {
        // 没有发送按钮时按回车（小红书会话输入框默认回车发送）
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }),
        );
      }
      for (let i = 0; i < 20; i += 1) {
        await sleep(400);
        if (editorIsEmpty(input)) {
          return { status: "succeeded", ref: "" };
        }
      }
      return { status: "submitted", ref: "" };
    }

    async function run(payload) {
      const action = str(payload?.action).toUpperCase();
      const text = clip(str(payload?.text).trim(), 4000);
      if (!text) return { status: "failed", error: "触达正文为空" };
      const blocked = isLoginWall();
      if (blocked) return { status: "failed", stopReason: "NEED_LOGIN", error: "页面要求登录：请在该平台标签页登录后重试" };
      const captcha = isCaptcha();
      if (captcha) return { status: "failed", stopReason: "CAPTCHA", error: "页面要求验证：请在该页手动通过后重试" };

      const outcome =
        action === "COMMENT" ? await runDouyinComment(text) : await runXhsDm(text);
      if (outcome.status === "manual") {
        const copied = await copyText(text);
        return {
          status: "failed",
          copied,
          stopReason: "PAGE_CHANGED",
          error: `${outcome.error}${copied ? "（话术已复制到剪贴板）" : "（无法自动复制，请从任务里复制话术）"}`,
        };
      }
      return outcome;
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "AIPDD_OUTREACH") return false;
      run(message.payload || {})
        .then((result) => sendResponse(result))
        .catch((error) =>
          sendResponse({
            status: "failed",
            error: clip(error?.message || error, 500),
          }),
        );
      return true;
    });
    return;
  }

  // ---------- 后台侧 ----------
  const acq = self.AIPDD_ACQ;
  if (!acq) return;
  const { sleep, clip, waitForTabComplete, ctx, STOP_LABELS } = acq.helpers;
  const PAGE_SETTLE_MS = 1500;
  const FOCUS_SETTLE_MS = 300;

  const isHttp = (raw) => {
    try {
      const target = new URL(raw);
      return target.protocol === "http:" || target.protocol === "https:";
    } catch (_) {
      return false;
    }
  };

  /** 任务目标页：评论必须落在内容页；私信优先主页，其次用平台用户 ID 拼主页。 */
  function targetOf(job) {
    const raw = clip(job?.targetUrl, 500).trim();
    if (isHttp(raw)) return raw;
    const action = String(job?.action || "").toUpperCase();
    const userId = clip(job?.externalUserId, 160).trim();
    const platform = String(job?.platform || "").toUpperCase();
    if (action === "DM" && userId && /^[0-9a-zA-Z_-]{4,64}$/.test(userId)) {
      if (platform === "XHS") {
        return `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(userId)}`;
      }
    }
    return "";
  }

  async function runOutreach(job) {
    const action = String(job?.action || "COMMENT").toUpperCase();
    const text = clip(job?.text, 4000).trim();
    if (!text) {
      return { status: "failed", receiptStatus: "failed", error: "触达正文为空" };
    }
    const url = targetOf(job);
    if (!url) {
      return {
        status: "failed",
        receiptStatus: "failed",
        stopReason: "PAGE_CHANGED",
        error: "这条任务没有可打开的目标页：评论需要内容页链接，私信需要平台用户 ID",
      };
    }
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (error) {
      return {
        status: "failed",
        receiptStatus: "failed",
        stopReason: "PAGE_CHANGED",
        error: `打开目标页失败：${error?.message || error}`,
      };
    }
    ctx.trackTab(tab.id);
    await waitForTabComplete(tab.id);
    await sleep(PAGE_SETTLE_MS);
    // 输入框只在可见的前台标签页里可靠渲染，与采集/分发同一套做法。
    await ctx.focusTab(tab.id);
    await sleep(FOCUS_SETTLE_MS);
    if (ctx.stopped()) {
      return { status: "stopped", receiptStatus: "unknown", stopReason: "USER_STOPPED", error: "用户已停止" };
    }
    let result;
    try {
      result = await sendToPage(
        tab.id,
        {
          type: "AIPDD_OUTREACH",
          payload: {
            platform: String(job?.platform || ""),
            action,
            text,
            targetUrl: url,
            externalUserId: clip(job?.externalUserId, 160),
          },
        },
        ["outreach.js"],
      );
    } catch (error) {
      result = {
        status: "failed",
        error: `触达脚本未就绪：${error?.message || error}（请确认插件已更新并刷新该平台页）`,
      };
    }
    ctx.restore();
    const status = String(result?.status || "failed");
    if (status === "succeeded") {
      ctx.forgetTab(tab.id);
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      return { status: "done", receiptStatus: "succeeded", receiptRef: clip(result?.ref, 160) };
    }
    // 未成功（含已提交待确认）：保留标签页并切到前台，用户就地核对/补发。
    await ctx.focusTab(tab.id);
    if (status === "submitted") {
      return {
        status: "done",
        receiptStatus: "submitted",
        receiptRef: clip(result?.ref, 160),
        error: "已提交，平台未给出最终确认：结果待对账，不自动重发",
      };
    }
    return {
      status: "failed",
      receiptStatus: "failed",
      stopReason: clip(result?.stopReason, 40) || "PAGE_CHANGED",
      error: clip(result?.error || STOP_LABELS[result?.stopReason] || "触达页没有返回结果", 1000),
    };
  }

  acq.register("outreach", runOutreach);
})();
