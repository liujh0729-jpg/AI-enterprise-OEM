/** 极简 Markdown 渲染：先整体转义 HTML，再还原标题/列表/强调/代码等语法，避免报告正文注入脚本。 */
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

export function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let para: string[] = [];
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.type}>`);
      list = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (code) {
      if (/^```/.test(line.trim())) {
        out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    if (/^```/.test(line.trim())) {
      flushAll();
      code = [];
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      flushAll();
      out.push("<hr />");
      continue;
    }
    if (line.startsWith(">")) {
      flushAll();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      flushPara();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushAll();
  return out.join("\n");
}

export function markdownToHtmlDocument(title: string, markdown: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 40px 20px; background: #f6f7f9; color: #1f2329; font: 15px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 820px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px 48px; box-shadow: 0 2px 16px rgba(0, 0, 0, .06); }
  h1 { font-size: 26px; margin: 0 0 20px; }
  h2 { font-size: 20px; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e6eb; }
  h3, h4 { font-size: 16px; margin: 24px 0 8px; }
  p { margin: 10px 0; }
  ul, ol { margin: 10px 0; padding-left: 24px; }
  li { margin: 6px 0; }
  blockquote { margin: 12px 0; padding: 8px 14px; background: #f2f3f5; border-left: 3px solid #c9cdd4; color: #4e5969; }
  code { background: #f2f3f5; border-radius: 4px; padding: 1px 5px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; }
  pre { background: #f2f3f5; border-radius: 8px; padding: 14px 16px; overflow: auto; }
  pre code { background: none; padding: 0; }
  a { color: #165dff; }
  hr { border: none; border-top: 1px solid #e5e6eb; margin: 28px 0; }
  @media (max-width: 640px) { body { padding: 16px 10px; } main { padding: 24px 18px; } }
</style>
</head>
<body>
<main>
${markdownToHtml(markdown)}
</main>
</body>
</html>
`;
}
