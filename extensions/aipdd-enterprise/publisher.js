// 平台页发布器：注入到各平台的创作/发布页，接收后台的 AIPDD_FILL 指令，
// 在「用户本机已登录」的会话里填标题/正文/图片，autoPublish 时点发布按钮。
// 正文到达时是受限 HTML：支持样式的文章渠道带样式投递，不吃样式的渠道自动降纯文本/Markdown。
// 选择器是多平台自动化里最容易碎的一环：每个字段都给候选列表 + 兜底策略，
// 失败时保留标签页让用户手动接手（界面侧有人工补记入口）。
(() => {
  if (window.__AIPDD_ENTERPRISE_PUBLISHER__) return;
  window.__AIPDD_ENTERPRISE_PUBLISHER__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 富文本底座（packages/contracts/src/rich-text.ts 的插件侧等价镜像，改那边记得同步这里） ----------
  // 台账正文统一存「受限 HTML」。到了这里按渠道能力分流：
  //   html     —— 文章类富文本编辑器（Draft.js/ProseMirror）：带样式投递；
  //   markdown —— 简书写文页是 Markdown 文本框：转 md 后样式以语法形式保留；
  //   text     —— 动态/图文类根本不吃样式：降级纯文本。
  // 这段 HTML 会插进第三方平台页面，所以投递前再洗一道（与服务层同一份白名单，纵深防御）。
  // 连内容一起丢：里面的「文字」是代码/标记，不能当正文出现在平台上。
  const DROP_WITH_CONTENT = ["script", "style", "noscript", "template", "svg", "math"];
  // 只脱壳留文字：外联框架/表单/动画/媒体这些能力必须杀掉，但用户止文不能因它们缺字。
  const DROP_KEEPING_TEXT = [
    "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input",
    "textarea", "select", "option", "optgroup", "button", "link", "meta", "base",
    "audio", "video", "canvas", "marquee", "details", "summary", "dialog",
  ];
  const ALLOWED_TAGS = {
    p: [], div: [], br: [], span: ["style"], b: [], strong: [], i: [], em: [], u: [],
    s: [], strike: [], del: [], sub: [], sup: [], mark: [], h2: [], h3: [], h4: [],
    ul: [], ol: [], li: [], blockquote: [], a: ["href"], code: [], pre: [], font: ["color"],
  };
  const ALLOWED_STYLE = [
    "color", "background-color", "font-weight", "font-style", "text-decoration", "text-align",
  ];
  const SAFE_PROTOCOL = ["http:", "https:", "mailto:"];
  const RICH_TAG_RE =
    /<\/?(p|br|div|span|b|strong|i|em|u|s|strike|del|sub|sup|mark|h[1-6]|ul|ol|li|blockquote|a|code|pre|font)\b[^>]*>/i;
  const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

  function looksLikeHtml(text) {
    return !!text && RICH_TAG_RE.test(text);
  }

  function escapeAttr(value) {
    return String(value)
      // 已成立的实体不动，只补裸 `&`：清洗会多轮重写，转义不幂等就会吃出 &amp;amp;amp;。
      .replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeUrl(raw) {
    const value = String(raw || "").trim();
    if (!value) return false;
    if (/^[#/?.]/.test(value)) return true;
    try {
      return SAFE_PROTOCOL.includes(new URL(value).protocol);
    } catch (_) {
      return false;
    }
  }

  function cleanStyle(value) {
    const kept = [];
    for (const item of String(value).split(";")) {
      const index = item.indexOf(":");
      if (index < 0) continue;
      const prop = item.slice(0, index).trim().toLowerCase();
      const declaration = item.slice(index + 1).trim();
      if (!ALLOWED_STYLE.includes(prop)) continue;
      if (/url\(|expression|javascript:|@|<|>|\\/i.test(declaration)) continue;
      if (!/^[\w\s#(),.%/-]+$/.test(declaration)) continue;
      kept.push(prop + ":" + declaration);
    }
    return kept.join(";");
  }

  function rewriteTags(html) {
    return html.replace(
      /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g,
      (_match, closing, rawName, attrText) => {
        const name = rawName.toLowerCase();
        const allowed = ALLOWED_TAGS[name];
        if (!allowed) return "";
        if (closing) return "</" + name + ">";
        let selfClose = attrText.trimEnd().endsWith("/");
        const body = selfClose ? attrText.trimEnd().slice(0, -1) : attrText;
        const attrs = [];
        const re =
          /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        for (let token = re.exec(body); token !== null; token = re.exec(body)) {
          const attr = token[1].toLowerCase();
          if (!allowed.includes(attr)) continue;
          const value = token[2] ?? token[3] ?? token[4] ?? "";
          if (attr === "href") {
            if (safeUrl(value)) attrs.push('href="' + escapeAttr(value.trim()) + '"');
          } else if (attr === "style") {
            const style = cleanStyle(value);
            if (style) attrs.push('style="' + escapeAttr(style) + '"');
          } else if (attr === "color") {
            // 与契约 rich-text.ts 对齐：锚点要盖住整个值，否则 `#xyz` 这类非法色值会从尾部钻过。
            if (/^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(value.trim())) {
              attrs.push('color="' + escapeAttr(value.trim()) + '"');
            }
          }
        }
        if (name === "br") selfClose = true;
        return "<" + name + (attrs.length ? " " + attrs.join(" ") : "") + (selfClose ? "/" : "") + ">";
      },
    );
  }

  function sanitizeHtml(input) {
    if (!input) return "";
    let html = String(input)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<![^>]*>/g, "")
      .replace(/<\?[\s\S]*?\?>/g, "");
    for (const tag of DROP_WITH_CONTENT) {
      // 顺序很关键：先处理「没有配对的开标签」——从它一路丢到文尾。
      // 若先删开标签，`<script>alert(1)` 这种未闭合写法只剩 `alert(1)` 漏进正文。
      html = html.replace(new RegExp("<" + tag + "\\b(?![\\s\\S]*<\\/" + tag + "\\s*>)[\\s\\S]*$", "gi"), "");
      html = html.replace(
        new RegExp("<" + tag + "\\b[^>]*>[\\s\\S]*?<\\/" + tag + "\\s*>", "gi"),
        "",
      );
      html = html.replace(new RegExp("<" + tag + "\\b[^>]*/?>", "gi"), "");
    }
    for (const tag of DROP_KEEPING_TEXT) {
      // 拆外壳留内容，内容里的开/关标签交给后面的白名单重写。
      html = html.replace(
        new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + "\\s*>", "gi"),
        "$1",
      );
    }
    // 反复重写直到稳定，堵 `<scr<pt>ipt>` 这类跨 token 拼回来的绕过。
    let pass = html;
    for (let i = 0; i < 6; i += 1) {
      const next = rewriteTags(pass);
      if (next === pass) break;
      pass = next;
    }
    // 与契约 sanitizeRichTextHtml 对齐的尾部收敛：连续换行/空段不能糊成大块空白。
    return pass
      .replace(/(?:<br\/>?\s*){3,}/gi, "<br><br>")
      .replace(/(?:<p><\/p>\s*){3,}/gi, "<p></p>")
      .trim();
  }

  function decodeEntities(text) {
    return String(text)
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&([a-z]+);/gi, (match, name) => {
        const value = NAMED[name.toLowerCase()];
        return value === undefined ? match : value;
      });
  }

  function collapseNewlines(text) {
    return String(text)
      .replace(/[\t ]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function htmlToPlainText(html) {
    if (!html) return "";
    if (!looksLikeHtml(html)) return collapseNewlines(decodeEntities(html));
    const text = String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|pre)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "· ")
      .replace(/<[^>]*>/g, "");
    return collapseNewlines(decodeEntities(text)).replace(/\u00a0/g, " ");
  }

  function htmlToMarkdown(html) {
    if (!html) return "";
    if (!looksLikeHtml(html)) return collapseNewlines(decodeEntities(html));
    let md = String(html)
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n")
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n")
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n")
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<(s|del|strike)[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
        return "[" + label.replace(/<[^>]*>/g, "") + "](" + href + ")";
      })
      .replace(/<br\s*\/?>/gi, "  \n");
    md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => {
      let index = 0;
      return (
        "\n" +
        inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, item) => {
          index += 1;
          return index + ". " + item.replace(/<[^>]*>/g, "").trim() + "\n";
        }) +
        "\n"
      );
    });
    md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner) => {
      return (
        "\n" +
        inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, item) => {
          return "- " + item.replace(/<[^>]*>/g, "").trim() + "\n";
        }) +
        "\n"
      );
    });
    md = md
      .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
        return (
          "\n" +
          inner
            .replace(/<[^>]*>/g, "")
            .split("\n")
            .map((line) => (line.trim() ? "> " + line.trim() : ""))
            .join("\n") +
          "\n"
        );
      })
      .replace(/<\/(p|div|li|ul|ol|blockquote)>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    return collapseNewlines(decodeEntities(md));
  }

  function plainToHtml(text) {
    if (!text) return "";
    const escaped = String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped
      .split(/\n{2,}/)
      .map((paragraph) => "<p>" + paragraph.replace(/\n/g, "<br>") + "</p>")
      .join("");
  }

  /** 台账正文 → 该平台能吃的形态：html 渠道同时留一份纯文本兜底。 */
  function prepareContent(raw, kind) {
    const text = raw || "";
    const plain = looksLikeHtml(text) ? htmlToPlainText(text) : text;
    if (kind === "html") {
      return { rich: looksLikeHtml(text) ? sanitizeHtml(text) : plainToHtml(text), plain };
    }
    if (kind === "markdown") {
      return { rich: null, plain: looksLikeHtml(text) ? htmlToMarkdown(text) : text };
    }
    return { rich: null, plain };
  }

  /** 主文档 + 同源 iframe（百家号/B站/公众号编辑器常嵌框架）；跨源跳过，限两层深。 */
  function eachDoc(root = document, depth = 0) {
    const docs = [root];
    if (depth >= 2) return docs;
    for (const frame of root.querySelectorAll("iframe")) {
      try {
        if (frame.contentDocument && frame.contentDocument.body) {
          docs.push(...eachDoc(frame.contentDocument, depth + 1));
        }
      } catch (_) {
        /* 跨源 iframe 不可读，跳过 */
      }
    }
    return docs;
  }

  /** 在限时内轮询第一个可见命中的选择器；SPA 页面元素是渐次出现的。 */
  async function waitFor(selectors, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        for (const doc of eachDoc()) {
          try {
            const nodes = doc.querySelectorAll(selector);
            for (const node of nodes) {
              if (isVisible(node)) return node;
            }
          } catch (_) {
            /* 非法选择器跳过 */
          }
        }
      }
      await sleep(300);
    }
    return null;
  }

  function isVisible(node) {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function visibleAll(selectors) {
    const found = [];
    for (const selector of selectors) {
      for (const doc of eachDoc()) {
        try {
          doc.querySelectorAll(selector).forEach((node) => {
            if (isVisible(node) && !found.includes(node)) found.push(node);
          });
        } catch (_) {
          /* ignore */
        }
      }
    }
    return found;
  }

  /** React/Vue 受控 input：必须走原生 setter，否则值不进组件状态；跨 iframe 用元素自身 window 的原型。 */
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
    // 受控组件可能把值改回或拦赋值：回读校验，不一致即抛错降级为 FAILED，不谎报填充成功。
    if ((input.value || "") !== value) {
      throw new Error("输入框填充失败（页面框架拦截了赋值）");
    }
  }

  /** 富文本编辑器（contenteditable / Draft.js / ProseMirror）：focus + insertText 粘贴纯文本。 */
  async function setContentEditable(editor, text) {
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
    const before = (editor.textContent || "").length;
    win.document.execCommand("insertText", false, text);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    // execCommand 在非聚焦后台标签页上可能静默失败：回读断言内容确实变多，否则抛错降级。
    const after = (editor.textContent || "").length;
    if (text && text.trim() && after <= before) {
      throw new Error("富文本填充失败（标签页可能未聚焦），请切到该平台标签页重试");
    }
  }

  function placeCaretAtEnd(win, editor) {
    const selection = win.getSelection();
    if (!selection) return;
    const range = win.document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * 伪造一次粘贴：Draft.js/ProseMirror 只在 paste 处理器里解析 text/html，
   * 小标题/粗体/列表能不能带过去就看这一步；且后台标签页上粘贴不像 execCommand 那样依赖窗口焦点。
   */
  function pasteRich(win, editor, html, plain) {
    try {
      const transfer = new win.DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", plain || "");
      const event = new win.Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: transfer });
      editor.dispatchEvent(event);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * 带样式投递正文：合成粘贴 → insertHTML → 纯文本 insertText，逐级降级。
   * 每一级都靠“文本量确实变多”回读判定，避免静默失败却上报 FILLED。
   */
  async function setRichContent(editor, html, plain) {
    const win = (editor.ownerDocument && editor.ownerDocument.defaultView) || window;
    editor.scrollIntoView({ block: "center" });
    editor.click();
    await sleep(150);
    const textLength = () => ((editor.textContent || "") + (editor.innerText || "")).length;
    const before = textLength();
    if (html && pasteRich(win, editor, html, plain)) {
      await sleep(300);
      if (textLength() > before) return;
    }
    placeCaretAtEnd(win, editor);
    if (html) {
      win.document.execCommand("insertHTML", false, html);
      editor.dispatchEvent(new win.InputEvent("input", { bubbles: true }));
      await sleep(150);
      if (textLength() > before) return;
    }
    // 样式带不进（编辑器只认受信粘贴）不能把内容也弄丢：退到纯文本，样式丢弃但正文完整。
    placeCaretAtEnd(win, editor);
    win.document.execCommand("insertText", false, plain || "");
    editor.dispatchEvent(new win.InputEvent("input", { bubbles: true }));
    if (plain && plain.trim() && textLength() <= before) {
      throw new Error("正文填充失败（标签页可能未聚焦），请切到该平台标签页重试");
    }
  }

  /** 正文投递入口：有 rich 就走带样式通道，没 rich（纯文本/markdown）沿用原路径。 */
  async function fillRichBody(candidates, html, content) {
    for (const selector of candidates) {
      const nodes = visibleAll([selector]);
      for (const node of nodes) {
        if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
          node.focus();
          setInputValue(node, content);
          return true;
        }
        if (node.isContentEditable) {
          if (html) await setRichContent(node, html, content);
          else await setContentEditable(node, content);
          return true;
        }
      }
    }
    return false;
  }

  /** 依次尝试标题候选控件：input/textarea 走受控赋值，contenteditable 走 insertText。 */
  async function fillTitle(candidates, title) {
    const nodes = [];
    for (const selector of candidates) {
      nodes.push(...visibleAll([selector]));
    }
    for (const node of nodes) {
      if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
        node.focus();
        setInputValue(node, title);
        return true;
      }
      if (node.isContentEditable) {
        await setContentEditable(node, title);
        return true;
      }
    }
    return false;
  }

  async function fillBody(candidates, content) {
    for (const selector of candidates) {
      const nodes = visibleAll([selector]);
      for (const node of nodes) {
        if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
          node.focus();
          setInputValue(node, content);
          return true;
        }
        if (node.isContentEditable) {
          await setContentEditable(node, content);
          return true;
        }
      }
    }
    return false;
  }

  /** dataURL → File，塞进平台隐藏 file input，触发 change 让上传逻辑跑起来。 */
  async function uploadImages(images) {
    if (!images || !images.length) return true;
    const input = visibleAll(['input[type="file"]'])[0];
    if (!input) return images.length === 0;
    const transfer = new DataTransfer();
    for (const image of images) {
      try {
        const response = await fetch(image.dataUrl);
        const blob = await response.blob();
        const file = new File(
          [blob],
          image.name || "image.png",
          { type: blob.type || "image/png" },
        );
        transfer.items.add(file);
      } catch (_) {
        /* 单图失败继续下一张 */
      }
    }
    if (!transfer.files.length) return false;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /** 按可见文本找按钮：先精确再模糊，跨同源框架收集，排除「定时发布 / 预览」这类干扰项。 */
  function findButtonByLabel(labels, exclude = ["定时", "预览", "存草稿", "草稿"]) {
    const nodes = [];
    for (const doc of eachDoc()) {
      nodes.push(
        ...doc.querySelectorAll("button"),
        ...doc.querySelectorAll('[role="button"]'),
        ...doc.querySelectorAll("span,div"),
      );
    }
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const text = (node.textContent || "").trim();
      if (!text || text.length > 12) continue;
      if (exclude.some((word) => text.includes(word))) continue;
      if (labels.some((label) => text === label || text.includes(label))) {
        return node;
      }
    }
    return null;
  }

  const PLATFORMS = {
    weibo: {
      async run(task) {
        // 微博首页发布框：textarea + 底部「发布」按钮；图片走 file input。
        const box = await waitFor([
          'textarea[placeholder^="有什么"]',
          ".woo-rich-input textarea",
          "textarea",
        ]);
        if (!box) throw new Error("没有找到微博发布框（未登录或界面改版）");
        box.focus();
        setInputValue(box, task.content);
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发布"],
    },
    xiaohongshu: {
      async run(task) {
        const uploaded = await uploadImages(task.images);
        if (task.images.length && !uploaded) {
          throw new Error("没有找到小红书的图片上传入口（请先切到「上传图文」）");
        }
        const title = await waitFor([
          'input[placeholder*="标题"]',
          "#text-input",
          'div[contenteditable="true"][placeholder*="标题"]',
        ]);
        if (title) {
          if (title.isContentEditable) await setContentEditable(title, task.title);
          else {
            title.focus();
            setInputValue(title, task.title);
          }
        }
        const body = await waitFor([
          'div[contenteditable="true"]',
          'textarea[placeholder*="正文"]',
        ]);
        if (!body) throw new Error("没有找到小红书正文编辑器");
        if (body.isContentEditable) await setContentEditable(body, task.content);
        else {
          body.focus();
          setInputValue(body, task.content);
        }
        return true;
      },
      publishLabel: ["发布"],
    },
    douyin: {
      async run(task) {
        const uploaded = await uploadImages(task.images);
        if (task.images.length && !uploaded) {
          throw new Error("没有找到抖音的图片上传入口（请先切到「图文」）");
        }
        const title = await waitFor([
          'input[placeholder*="标题"]',
          'div[contenteditable="true"][placeholder*="标题"]',
        ]);
        if (title) {
          if (title.isContentEditable) await setContentEditable(title, task.title);
          else {
            title.focus();
            setInputValue(title, task.title);
          }
        }
        const body = await waitFor([
          'div[contenteditable="true"]',
          "textarea",
        ]);
        if (body) {
          if (body.isContentEditable) await setContentEditable(body, task.content);
          else {
            body.focus();
            setInputValue(body, task.content);
          }
        }
        return true;
      },
      publishLabel: ["发布"],
    },
    zhihu: {
      async run(task) {
        const title = await waitFor([
          "input#Title",
          'input[placeholder*="标题"]',
          'div[contenteditable="true"][role="textbox"]',
        ]);
        if (!title) throw new Error("没有找到知乎标题输入框（未登录或界面改版）");
        if (title.isContentEditable) await setContentEditable(title, task.title);
        else {
          title.focus();
          setInputValue(title, task.title);
        }
        const body = await waitFor([
          ".Draft-editor [contenteditable=\"true\"]",
          'div[contenteditable="true"]',
          "textarea",
        ]);
        if (!body) throw new Error("没有找到知乎正文编辑器");
        // 知乎是 Draft.js：走带样式通道（粘贴优先），样式带不进时自动降纯文本。
        if (body.isContentEditable) await setRichContent(body, task.rich, task.content);
        else {
          body.focus();
          setInputValue(body, task.content);
        }
        return true;
      },
      publishLabel: ["发布"],
      contentKind: "html",
    },
    toutiao: {
      async run(task) {
        const title = await waitFor([
          'input[placeholder*="标题"]',
          ".silian-editor-title input",
        ]);
        if (!title) throw new Error("没有找到头条号标题输入框（未登录或界面改版）");
        title.focus();
        setInputValue(title, task.title);
        const body = await waitFor([
          ".ProseMirror",
          ".ql-editor",
          'div[contenteditable="true"]',
        ]);
        if (!body) throw new Error("没有找到头条号正文编辑器");
        await setRichContent(body, task.rich, task.content);
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发布"],
      contentKind: "html",
    },
    kuaishou: {
      async run(task) {
        // 快手创作者中心「作品发布」：图文模式需先切换，控件改版频繁，尽力填充。
        const moment = findButtonByLabel(["图文"], ["视频", "长视频"]);
        if (moment) {
          moment.click();
          await sleep(1200);
        }
        const uploaded = task.images.length ? await uploadImages(task.images) : true;
        const titleFilled = task.title
          ? await fillTitle(['input[placeholder*="标题"]'], task.title)
          : true;
        const bodyFilled = await fillBody(
          ['div[contenteditable="true"]', "textarea"],
          task.content,
        );
        if (!uploaded || (!bodyFilled && !titleFilled)) {
          throw new Error("快手发布页控件未就绪（请先切到「图文」模式），标签页已保留，请人工接手");
        }
        return true;
      },
      publishLabel: ["发布"],
    },
    weixin_channels: {
      async run(task) {
        // 视频号「文字回答/动态」发布器：编辑区是 contenteditable，半自动兜底保留人工。
        const editor = await waitFor([
          'div[contenteditable="true"]',
          "textarea",
        ]);
        if (!editor) {
          throw new Error("没有找到视频号发布编辑器（未登录或需先选择发布形式），标签页已保留，请人工接手");
        }
        if (editor.isContentEditable) await setContentEditable(editor, task.content);
        else {
          editor.focus();
          setInputValue(editor, task.content);
        }
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发表", "发布"],
    },
    zsxq: {
      async run(task) {
        // 知识星球网页版：先点「主题发布」进入发布器（带动态参数，属半自动渠道）。
        const trigger = findButtonByLabel(["主题发布", "发布主题", "发布"]);
        if (trigger) {
          trigger.click();
          await sleep(1200);
        }
        const editor = await waitFor([
          'div[contenteditable="true"]',
          "textarea",
        ]);
        if (!editor) {
          throw new Error("没有找到知识星球发布编辑器（未登录或需手动打开发布器），标签页已保留，请人工接手");
        }
        if (editor.isContentEditable) await setContentEditable(editor, task.content);
        else {
          editor.focus();
          setInputValue(editor, task.content);
        }
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发布"],
    },
    weixin: {
      async run(task) {
        // 公众号：首页点「新的创作→写图文」进编辑器；编辑器常嵌 iframe，选择器走同源遍历。
        const write = findButtonByLabel(["新的创作", "写图文", "图文模板"]);
        if (write) {
          write.click();
          await sleep(2000);
        }
        const titleFilled = task.title
          ? await fillTitle(
              ['input[placeholder*="标题"]', "#title", 'input[name="title"]'],
              task.title,
            )
          : true;
        const bodyFilled = await fillRichBody(
          ["#editor", ".ProseMirror", '.rdw-editor-main[contenteditable="true"]', 'div[contenteditable="true"]'],
          task.rich,
          task.content,
        );
        if (!bodyFilled && !titleFilled) {
          throw new Error("没有找到公众号编辑器（未登录或需手动进入图文编辑器），标签页已保留，请人工接手");
        }
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发表"],
      contentKind: "html",
    },
    baijiahao: {
      async run(task) {
        // 百家号：编辑器多在 iframe 内，waitFor/visibleAll 已支持同源框架遍历。
        const titleFilled = task.title
          ? await fillTitle(
              ['input[placeholder*="标题"]', '.titleInput input', "input[type=\"text\"]"],
              task.title,
            )
          : false;
        const bodyFilled = await fillRichBody(
          ['div[contenteditable="true"]', ".ProseMirror", ".ql-editor"],
          task.rich,
          task.content,
        );
        if (!bodyFilled && !titleFilled) {
          throw new Error("没有找到百家号编辑器（未登录或界面改版），标签页已保留，请人工接手");
        }
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发布"],
      // 百家号编辑器是 contenteditable：不给 html 形态就会按纯文本贴，样式全丢。
      contentKind: "html",
    },
    bilibili: {
      async run(task) {
        // B 站专栏：add 页有标题栏与 ProseMirror 正文。
        const titleFilled = task.title
          ? await fillTitle(
              ['input[placeholder*="标题"]', "input.bilibili-dyn-content__plus__title", "input[type=\"text\"]"],
              task.title,
            )
          : false;
        const bodyFilled = await fillRichBody(
          [".ProseMirror", 'div[contenteditable="true"]'],
          task.rich,
          task.content,
        );
        if (!bodyFilled && !titleFilled) {
          throw new Error("没有找到 B 站专栏编辑器（未登录或界面改版），标签页已保留，请人工接手");
        }
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发布", "保存并发表"],
      contentKind: "html",
    },
    jianshu: {
      async run(task) {
        // 简书：写文页标题用「写一个标题」占位，正文是 markdown 编辑器 textarea。
        const titleFilled = task.title
          ? await fillTitle(
              ['input[placeholder*="标题"]', "input#note_title"],
              task.title,
            )
          : false;
        const bodyFilled = await fillBody(
          ["textarea#note_content", ".editor-textarea textarea", "textarea"],
          task.content,
        );
        if (!bodyFilled && !titleFilled) {
          throw new Error("没有找到简书编辑器（未登录或界面改版），标签页已保留，请人工接手");
        }
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发布", "发表"],
      // 简书是 Markdown 文本框：给它 HTML 只会当普文贴上去，转 md 才留得住样式。
      contentKind: "markdown",
    },
    douban: {
      async run(task) {
        // 豆瓣笔记：note/create 直接进编辑器，标题与正文都是常规控件。
        const titleFilled = task.title
          ? await fillTitle(
              ['input[placeholder*="标题"]', "#note_title", "input[type=\"text\"]"],
              task.title,
            )
          : false;
        const bodyFilled = await fillRichBody(
          ["#note_content", ".note-editor textarea", 'div[contenteditable="true"]', "textarea"],
          task.rich,
          task.content,
        );
        if (!bodyFilled && !titleFilled) {
          throw new Error("没有找到豆瓣笔记编辑器（未登录或界面改版），标签页已保留，请人工接手");
        }
        if (task.images.length) await uploadImages(task.images);
        return true;
      },
      publishLabel: ["发布"],
      // 豆瓣笔记正文可落 contenteditable，同百家号：声明 html 形态才带得去样式。
      contentKind: "html",
    },
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "AIPDD_FILL") return false;
    const payload = message.payload || {};
    const platform = PLATFORMS[payload.platformCode];
    (async () => {
      if (!platform) {
        sendResponse({ status: "FAILED", errorMsg: "插件不支持该平台" });
        return;
      }
      try {
        // 台账正文是受限 HTML：先按该平台的内容形态转好（带样式/Markdown/纯文本），
        // 标题不分形态一律纯文本（各平台标题框都不吃样式）。
        const prepared = prepareContent(payload.content, platform.contentKind || "text");
        const rawTitle = payload.title || "";
        const filled = await platform.run({
          title: looksLikeHtml(rawTitle) ? htmlToPlainText(rawTitle) : rawTitle,
          content: prepared.plain,
          rich: prepared.rich,
          images: payload.images || [],
          autoPublish: Boolean(payload.autoPublish),
        });
        if (!filled) throw new Error("内容已部分填充，但关键控件没找到");
        if (payload.autoPublish) {
          await sleep(800);
          const button = findButtonByLabel(platform.publishLabel);
          if (!button) throw new Error("已填充完成，但没找到发布按钮，请人工确认");
          button.click();
          await sleep(1500);
          sendResponse({
            status: "SUCCESS",
            publishedUrl: window.location.href,
            errorMsg: "",
          });
        } else {
          sendResponse({
            status: "FILLED",
            publishedUrl: window.location.href,
            errorMsg: "",
          });
        }
      } catch (error) {
        sendResponse({
          status: "FAILED",
          publishedUrl: "",
          errorMsg: String(error?.message || error),
        });
      }
    })();
    return true; // 异步应答
  });
})();
