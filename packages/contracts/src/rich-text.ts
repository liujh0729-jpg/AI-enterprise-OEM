/**
 * 分发正文的富文本底座：一条「受约束的 HTML」贯穿录入 → 落库 → 插件注入。
 *
 * 为什么存 HTML 而不是 Markdown 或私有标记：
 * - 文章类渠道（知乎/头条/百家号/B站/公众号/豆瓣）的创作页都是 contenteditable
 *   富文本编辑器，带样式进它们的唯一可靠方式就是投递 HTML（粘贴/insertHTML）；
 * - 动态/图文类渠道（微博/小红书/抖音/快手/视频号/知识星球）根本不认样式，
 *   投递前一律降级为纯文本；简书是 Markdown 文本框，降级为 Markdown。
 *
 * 安全边界：这段 HTML 会被塞进**第三方平台页面**，也会被本系统详情页 innerHTML 预览，
 * 因此必须白名单清洗——脚本、事件属性、危险协议、外链样式全削掉。清洗逻辑放在
 * contracts 里，前后端与烟测共用一份实现（插件是独立 plain JS，另有一份等价镜像）。
 */

/**
 * 连内容一起丢的元素：它们里的「文字」是代码或标记，绝不能以正文形式出现在平台上
 * （script 残留开标签后面还接得回 `ipt>` 这类拼框，所以一并处理未闭合的尾巴）。
 */
const DROPPED_WITH_CONTENT = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
];

/**
 * 只脱壳、保留文字的元素：能力（外联框架/表单/动画/媒体）必须杀掉，
 * 但用户真的正文不能因此被吐掉（常见于从别处复制过来的 marquee/details/备用文案）。
 */
const DROPPED_KEEPING_TEXT = [
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "textarea",
  "select",
  "option",
  "optgroup",
  "button",
  "link",
  "meta",
  "base",
  "audio",
  "video",
  "canvas",
  "marquee",
  "details",
  "summary",
  "dialog",
];

/**
 * 允许保留的标签 → 该标签允许的属性。富文本编辑器工具栏只产出这些；
 * 不在表内的标签会被脱壳（丢掉标签本身、保留里面的文字），杜绝样式外的任何能力。
 */
const ALLOWED_TAGS: Record<string, readonly string[]> = {
  p: [],
  div: [],
  br: [],
  span: ["style"],
  b: [],
  strong: [],
  i: [],
  em: [],
  u: [],
  s: [],
  strike: [],
  del: [],
  sub: [],
  sup: [],
  mark: [],
  h2: [],
  h3: [],
  h4: [],
  ul: [],
  ol: [],
  li: [],
  blockquote: [],
  a: ["href"],
  code: [],
  pre: [],
  font: ["color"],
};

/** 行内样式只放行这几项：挡掉 position/expression/background url 等可被滥用的声明。 */
const ALLOWED_STYLE_PROPERTIES = [
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
];

const SAFE_URL_PROTOCOLS = ["http:", "https:", "mailto:"];

const ATTRIBUTE_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeAttrValue(value: string): string {
  return (
    value
      // 已成立的实体（&amp; / &#39; / &#x27;）不动，只补裸 `&`：
      // 清洗会多轮重写，转义不幂等就会把链接里的 & 吃成 &amp;amp;amp;…。
      .replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

function isSafeUrl(raw: string): boolean {
  const value = raw.trim().replace(/\s+/g, "");
  if (!value) return false;
  // 相对/锚点地址没有协议头：对正文而言无外联能力，直接放行。
  if (/^[#/?.]/.test(value)) return true;
  try {
    const url = new URL(value);
    return SAFE_URL_PROTOCOLS.includes(url.protocol);
  } catch (_) {
    return false;
  }
}

/** style 属性逐条过滤，全空则返回空串（调用侧据此丢掉该属性）。 */
function sanitizeStyle(value: string): string {
  const kept: string[] = [];
  for (const declaration of value.split(";")) {
    const index = declaration.indexOf(":");
    if (index < 0) continue;
    const prop = declaration.slice(0, index).trim().toLowerCase();
    const rawValue = declaration.slice(index + 1).trim();
    if (!ALLOWED_STYLE_PROPERTIES.includes(prop)) continue;
    // 挡掉 url(...)、expression、注入分号后的新声明、以及任何标签字符。
    if (/url\(|expression|javascript:|@|<|>|\\/i.test(rawValue)) continue;
    if (!/^[\w\s#(),.%/-]+$/.test(rawValue)) continue;
    kept.push(`${prop}:${rawValue}`);
  }
  return kept.join(";");
}

/** 单遍标签重写：白名单内重建（属性同样重建），白名单外整体脱壳。 */
function rewritePass(html: string): string {
  return html.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g,
    (_match, closing: string, nameRaw: string, attrText: string) => {
      const name = nameRaw.toLowerCase();
      const allowedAttrs = ALLOWED_TAGS[name];
      if (!allowedAttrs) return "";
      if (closing) return `</${name}>`;
      let selfClosing = attrText.trimEnd().endsWith("/");
      const body = selfClosing ? attrText.trimEnd().slice(0, -1) : attrText;
      const kept: string[] = [];
      ATTRIBUTE_RE.lastIndex = 0;
      for (
        let token = ATTRIBUTE_RE.exec(body);
        token !== null;
        token = ATTRIBUTE_RE.exec(body)
      ) {
        const attr = token[1].toLowerCase();
        if (!allowedAttrs.includes(attr)) continue;
        const value = token[2] ?? token[3] ?? token[4] ?? "";
        if (attr === "href") {
          if (!isSafeUrl(value)) continue;
          kept.push(`href="${escapeAttrValue(value.trim())}"`);
        } else if (attr === "style") {
          const style = sanitizeStyle(value);
          if (style) kept.push(`style="${escapeAttrValue(style)}"`);
        } else if (attr === "color") {
          // 两个交替支各自带锚：缺 `^` 时 `#xyz` 这类非法色值会从尾部字母段钻过。
          if (!/^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(value.trim())) continue;
          kept.push(`color="${escapeAttrValue(value.trim())}"`);
        }
      }
      if (name === "br") selfClosing = true;
      return `<${name}${kept.length ? " " + kept.join(" ") : ""}${selfClosing ? "/" : ""}>`;
    },
  );
}

/**
 * 清洗成「可安全落库并可投递到第三方页面」的 HTML。
 * 反复重写直到稳定，是为了挡住 `<scr<pt>ipt>` 这类跨 token 拼回来的绕过。
 */
export function sanitizeRichTextHtml(input: string): string {
  if (!input) return "";
  let html = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<![^>]*>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  for (const tag of DROPPED_WITH_CONTENT) {
    // 顺序很关键：先处理「没有配对的开标签」——从它一路丢到文尾。
    // 若先删开标签，`<script>alert(1)` 这种未闭合写法只剩 `alert(1)` 漏进正文；
    // 宁可保守（丢弃开标签之后全部内容），也不给代码/残片留活口。
    html = html.replace(new RegExp(`<${tag}\\b(?![\\s\\S]*<\\/${tag}\\s*>)[\\s\\S]*$`, "gi"), "");
    html = html.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"),
      "",
    );
    html = html.replace(new RegExp(`<${tag}\\b[^>]*/?>`, "gi"), "");
  }
  for (const tag of DROPPED_KEEPING_TEXT) {
    // 拆掉外壳留下内容，内容背下的开/关标签交给白名单重写处理。
    html = html.replace(
      new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"),
      "$1",
    );
  }
  // `</b` 之类未闭合的残骸：清掉所有孤立的尖括号声明起点。
  let pass = html;
  for (let i = 0; i < 6; i += 1) {
    const next = rewritePass(pass);
    if (next === pass) break;
    pass = next;
  }
  return pass
    .replace(/(?:<br\/?>\s*){3,}/gi, "<br><br>")
    .replace(/(?:<p><\/p>\s*){3,}/gi, "<p></p>")
    .trim();
}

/** 判定正文是否已是富文本：老台账是纯文本，走纯文本通道不受影响。 */
export function looksLikeRichHtml(text: string): boolean {
  if (!text) return false;
  return /<\/?(p|br|div|span|b|strong|i|em|u|s|strike|del|sub|sup|mark|h[1-6]|ul|ol|li|blockquote|a|code|pre|font)\b[^>]*>/i.test(
    text,
  );
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeRichTextEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const value = NAMED_ENTITIES[name.toLowerCase()];
      return value === undefined ? match : value;
    });
}

function collapseNewlines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 富文本 → 纯文本：动态/图文渠道只吃这个（段落/换行保留，列表转「· 」。 */
export function richTextToPlainText(html: string): string {
  if (!html) return "";
  if (!looksLikeRichHtml(html)) return collapseNewlines(decodeRichTextEntities(html));
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "· ")
    .replace(/<[^>]*>/g, "");
  return collapseNewlines(decodeRichTextEntities(text)).replace(/\u00a0/g, " ");
}

/** 富文本 → Markdown：简书这类「Markdown 文本框」编辑器只有吃 md 才保得住样式。 */
export function richTextToMarkdown(html: string): string {
  if (!html) return "";
  if (!looksLikeRichHtml(html)) return collapseNewlines(decodeRichTextEntities(html));
  let md = html
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n")
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<(s|del|strike)[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(
      /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, label: string) => `[${label.replace(/<[^>]*>/g, "")}](${href})`,
    )
    .replace(/<br\s*\/?>/gi, "  \n");
  // 有序列表要按出现顺序编号，只能带状态地走一遍。
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    let index = 0;
    const body = inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, item: string) => {
      index += 1;
      return `${index}. ${item.replace(/<[^>]*>/g, "").trim()}\n`;
    });
    return `\n${body}\n`;
  });
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) => {
    const body = inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, item: string) => {
      return `- ${item.replace(/<[^>]*>/g, "").trim()}\n`;
    });
    return `\n${body}\n`;
  });
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const body = inner
      .replace(/<[^>]*>/g, "")
      .split("\n")
      .map((line) => (line.trim() ? `> ${line.trim()}` : ""))
      .join("\n");
    return `\n${body}\n`;
  });
  md = md
    .replace(/<\/(p|div|li|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return collapseNewlines(decodeRichTextEntities(md));
}

/** 纯文本 → 富文本：段落成 <p>、行内换行成 <br>，供老台账在富文本渠道保形投递。 */
export function plainTextToRichHtml(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** 标题永远以纯文本投递（各平台标题框都不吃样式）。 */
export function richTextToTitleText(text: string, max = 200): string {
  const plain = looksLikeRichHtml(text) ? richTextToPlainText(text) : text;
  return plain.replace(/\s+/g, " ").trim().slice(0, max);
}

/** 界面计数用：样式标记不该占用户的字数额度。 */
export function richTextVisibleLength(html: string): number {
  return richTextToPlainText(html || "").length;
}
