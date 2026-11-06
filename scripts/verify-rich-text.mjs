// 富文本底座回归：清洗白名单（安全边界）+ 三种投递形态 + 契约与插件镜像的等价性。
// 跑法：node scripts/verify-rich-text.mjs（需要先 pnpm --filter @enterprise/contracts build）
//
// 为什么值得单独钉住：
// 1) 台账正文是「受限 HTML」，它会被插件投递到第三方平台页面、也会被本页 innerHTML 预览，
//    清洗逻辑一旦退化就是存储型 XSS / 平台页注入；
// 2) 插件是独立 plain JS，无法 import 契约，只能镜像一份同样的规则——镜像漂移只能靠对拍发现。
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages", "contracts", "package.json"));
const contracts = require("./dist/index.js");

// 从 publisher.js 里取出富文本底座（纯字符串逻辑，不依赖 DOM），用同一份用例对拍。
const publisherSource = readFileSync(
  join(root, "extensions", "aipdd-enterprise", "publisher.js"),
  "utf8",
);
const blockStart = publisherSource.indexOf("const DROP_WITH_CONTENT");
const blockEnd = publisherSource.indexOf("  /** 主文档 + 同源 iframe", blockStart);
if (blockStart < 0 || blockEnd < 0) {
  console.error("插件里的富文本底座段落找不到，可能改动了结构：请同步本脚本的取片锚点");
  process.exit(1);
}
const ext = new Function(
  `${publisherSource.slice(blockStart, blockEnd)}
return { sanitizeHtml, htmlToPlainText, htmlToMarkdown, plainToHtml, looksLikeHtml, prepareContent };`,
)();

let passed = 0;
const failures = [];
const ok = (name, condition, got) => {
  if (condition) passed += 1;
  else failures.push(`${name}${got === undefined ? "" : ` — 实得 ${JSON.stringify(got)}`}`);
};

const ATTACKS = [
  ["脚本整块移除", "<p>ok</p><script>alert(1)</script>", (r) => !/script/i.test(r) && r.includes("ok")],
  ["跨 token 拼回的脚本", "<scr<script>ipt>alert(1)</scr</script>ipt>", (r) => !/script/i.test(r)],
  ["未闭合脚本不留残片", "<script>alert(1)", (r) => !/script|alert/i.test(r)],
  ["未闭合脚本不留残片（带正文）", "<p>正文</p><script>alert(1)", (r) => !/script|alert/i.test(r) && r.includes("正文")],
  ["img onerror 脱壳", '<img src=x onerror="alert(1)">', (r) => !/onerror|<img/i.test(r)],
  ["事件属性一律丢弃", '<b onclick="alert(1)" onmouseover=x>y</b>', (r) => r === "<b>y</b>"],
  ["javascript: 链接不留", '<a href="javascript:alert(1)">x</a>', (r) => !/javascript:/i.test(r)],
  ["data: 链接不留", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', (r) => !/data:/i.test(r)],
  ["正常链接保留且转义幂等", '<a href="https://a.com/?x=1&y=2">t</a>', (r) => r === '<a href="https://a.com/?x=1&amp;y=2">t</a>'],
  ["样式白名单过滤", '<span style="color:red;position:fixed;background:url(javascript:1)">s</span>',
    (r) => r.includes("color:red") && !/position|url\(/i.test(r)],
  ["iframe 脱壳但留正文", '<iframe src="//evil">备用文字</iframe>tail', (r) => !/iframe|evil/i.test(r) && r.includes("备用文字") && r.includes("tail")],
  ["注释与 XML 声明清掉", "<!--[if IE]><script>e</script><![endif]--><?xml version=\"1.0\"?><p>p</p>",
    (r) => !/script|xml|!/i.test(r) && r.includes("<p>p</p>")],
  ["动画标签脱壳保文", "<marquee>hi</marquee>", (r) => r.includes("hi") && !/marquee/i.test(r)],
  ["svg/math 连内容丢弃", "<svg><onload>alert(1)</onload></svg><math>m</math>", (r) => !/svg|math|onload/i.test(r)],
  // 历史漂移点：契约版 color 正则缺锚时 `#xyz` 会从尾部字母段钻过，两份实现要同时拒。
  ["font 非法色值不留", '<font color="#xyz">红</font>', (r) => !/#xyz/.test(r) && r.includes("红")],
  ["font 合法色值保留", '<font color="#ff0000">红</font>', (r) => r.includes('color="#ff0000"')],
  // 历史漂移点：插件镜像曾不做尾部收敛，连续换行/空段要两份都压到两段。
  ["连续空行收敛", "a" + "<br><br><br><br>" + "b", (r) => (r.match(/<br\/?>/g) || []).length === 2],
  ["连续空段收敛", "<p></p><p></p><p></p><p>x</p>", (r) => (r.match(/<p><\/p>/g) || []).length === 1],
];

for (const [name, input, judge] of ATTACKS) {
  const cleaned = contracts.sanitizeRichTextHtml(input);
  const mirrored = ext.sanitizeHtml(input);
  ok(`契约清洗：${name}`, judge(cleaned), cleaned);
  ok(`插件镜像清洗：${name}`, judge(mirrored), mirrored);
  ok(`两份实现一致：${name}`, cleaned === mirrored, `${cleaned} vs ${mirrored}`);
}

const RICH =
  "<h2>标题</h2><p><strong>重点</strong>和<em>斜体</em>，<span style=\"color:#f5222d\">红字</span></p>"
  + "<ul><li>要点一</li><li>要点二</li></ul><blockquote>引用</blockquote><p>链接<a href=\"https://a.com\">点我</a></p>";
const richClean = contracts.sanitizeRichTextHtml(RICH);
ok("样式全保留（清洗不误伤）", richClean.includes("<h2>") && richClean.includes("<strong>")
  && richClean.includes("color:#f5222d") && richClean.includes("<blockquote>")
  && richClean.includes("href=\"https://a.com\""), richClean);
ok("富文本识别一致", contracts.looksLikeRichHtml(RICH) && ext.looksLikeHtml(RICH));
ok("纯文本里的尖括号不误判", !contracts.looksLikeRichHtml("价格 <100 且 a>b")
  && !ext.looksLikeHtml("价格 <100 且 a>b"));

const plain = contracts.richTextToPlainText(RICH);
ok("降级纯文本内容完整", ["标题", "重点", "要点一", "引用", "点我"].every((word) => plain.includes(word)), plain);
ok("降级纯文本无标签残留", !/</.test(plain), plain);
ok("列表降级为点号", plain.includes("· 要点一"), plain);
ok("纯文本降级与镜像一致", plain === ext.htmlToPlainText(RICH));
ok("可见字数不含样式标记", contracts.richTextVisibleLength("<p>abcd</p>") === 4,
  contracts.richTextVisibleLength("<p>abcd</p>"));

const markdown = contracts.richTextToMarkdown(RICH);
ok("Markdown 保留标题", markdown.includes("## 标题"), markdown);
ok("Markdown 保留粗斜体", markdown.includes("**重点**") && markdown.includes("*斜体*"), markdown);
ok("Markdown 保留列表与引用", markdown.includes("- 要点一") && markdown.includes("> 引用"), markdown);
ok("Markdown 保留链接", markdown.includes("[点我](https://a.com)"), markdown);
ok("Markdown 与镜像一致", markdown === ext.htmlToMarkdown(RICH));
const ordered = "<ol><li>一</li><li>二</li><li>三</li></ol>";
ok("有序列表按序编号", contracts.richTextToMarkdown(ordered).includes("2. 二")
  && contracts.richTextToMarkdown(ordered).includes("3. 三"),
contracts.richTextToMarkdown(ordered));
ok("有序列表与镜像一致", contracts.richTextToMarkdown(ordered) === ext.htmlToMarkdown(ordered));

const paragraphs = "第一段\n继续\n\n第二段";
ok("纯文本转段落", contracts.plainTextToRichHtml(paragraphs) === "<p>第一段<br>继续</p><p>第二段</p>",
  contracts.plainTextToRichHtml(paragraphs));
ok("纯文本转段落与镜像一致", contracts.plainTextToRichHtml(paragraphs) === ext.plainToHtml(paragraphs));
ok("标题一律降纯文本", contracts.richTextToTitleText("<p>两个\n空格</p>") === "两个 空格",
  contracts.richTextToTitleText("<p>两个\n空格</p>"));

const preparedHtml = ext.prepareContent(richClean, "html");
ok("html 渠道拿到带样式正文 + 纯文本兜底", preparedHtml.rich.includes("<h2>") && !/</.test(preparedHtml.plain));
const preparedMd = ext.prepareContent(richClean, "markdown");
ok("markdown 渠道不给 rich 且转 md", preparedMd.rich === null && preparedMd.plain.includes("## 标题"));
const preparedText = ext.prepareContent(richClean, "text");
ok("text 渠道不给 rich", preparedText.rich === null && preparedText.plain.includes("要点一"));
ok("老纯文本走 html 渠道也成段落", ext.prepareContent("两行\n文本", "html").rich === "<p>两行<br>文本</p>",
  ext.prepareContent("两行\n文本", "html").rich);

console.log(`富文本底座回归：${passed} 项通过，${failures.length} 项失败`);
for (const item of failures) console.log("  FAIL " + item);
process.exit(failures.length ? 1 : 0);
