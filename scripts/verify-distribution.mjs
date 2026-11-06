/**
 * 多平台内容分发（营销工具 + AIPDD Enterprise 插件的服务器侧）：接口层实测。
 *
 * 口径：
 * - 开源版鉴权只认本站 SSO 会话（issuer=enterprise-sso，密钥按 JWT_SECRET HKDF 派生），
 *   所以这里现场建一个一次性 Account，并按后端 token.ts 同一套派生签发会话令牌；
 *   跑完删除该账号与本次产生的台账/结果，库回到初始状态。
 * - 只测台账与结果回写链路（meta/create/update/page/mark/reportLogs/detail/remove），
 *   不实际驱动浏览器插件；插件产物 zip 由前端静态目录分发，这里顺带断言下载路径。
 *
 * 用法：node scripts/verify-distribution.mjs [BASE_URL]
 */
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const jwt = require("jsonwebtoken");

const target = process.argv[2] || "http://127.0.0.1:1690";
const env = Object.fromEntries(
  readFileSync(join(root, "backend/.env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const jwtSecret = env.JWT_SECRET;
if (!jwtSecret) throw new Error("backend/.env 缺少 JWT_SECRET");
process.env.DATABASE_URL = env.DATABASE_URL;

const { PrismaClient } = require("../backend/generated/prisma");
const prisma = new PrismaClient();

/** 与 backend/src/auth/token.ts 同口径的本地会话签发。 */
function issueSsoSession(userId, username, tokenVersion) {
  const secret = createHmac("sha256", jwtSecret).update("enterprise-sso-session").digest();
  return jwt.sign(
    { userId, username, role: "user", tokenVersion, type: "access" },
    secret,
    { algorithm: "HS256", issuer: "enterprise-sso", expiresIn: 600 },
  );
}

/** 顺序解析 zip 本地文件头，取条目名（只读头不 inflate，够用且零依赖）。 */
function listZipEntryNames(file) {
  const buf = readFileSync(file);
  const names = [];
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const compSize = buf.readUInt32LE(18);
    const nameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    names.push(buf.subarray(p + 30, p + 30 + nameLen).toString("utf8"));
    p += 30 + nameLen + extraLen + compSize;
  }
  return names;
}

const state = { passed: 0, failed: 0 };
const assert = (cond, name, extra) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  cond ? (state.passed += 1) : (state.failed += 1);
};

let bearer = "";
const call = async (method, path, body) => {
  const res = await fetch(`${target}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, message: text };
  }
};

console.log(`目标实例：${target}`);

const username = `dist-verify-${Date.now().toString(36)}`;
const account = await prisma.account.create({
  data: { username },
});
bearer = issueSsoSession(String(account.id), username, account.tokenVersion);

try {
  // ---------- 1) meta：平台注册表 + 插件信息 ----------
  const meta = await call("GET", "/enterprise/distribution/meta");
  assert(meta.code === 0 && meta.data, "meta 返回 code=0", `code=${meta.code} message=${meta.message}`);
  const platforms = meta.data?.platforms ?? [];
  // 与插件 background.js PUBLISH_TARGETS / manifest 注入域对齐的 13 家渠道（对齐 PostBot 国内图文/文章口径）。
  const EXPECTED_PLATFORMS = [
    "weibo", "xiaohongshu", "douyin", "zhihu", "toutiao", "kuaishou",
    "weixin_channels", "zsxq", "weixin", "baijiahao", "bilibili", "jianshu", "douban",
  ];
  assert(
    platforms.length === EXPECTED_PLATFORMS.length,
    `平台注册表 ${EXPECTED_PLATFORMS.length} 家渠道（实际 ${platforms.length}）`,
  );
  for (const code of EXPECTED_PLATFORMS) {
    assert(platforms.some((p) => p.code === code), `平台清单包含 ${code}`);
  }
  const extension = meta.data?.extension ?? {};
  assert(extension.name === "AIPDD Enterprise", "插件名 AIPDD Enterprise");
  assert(/^\/downloads\/aipdd-enterprise-v.+\.(zip)$/.test(extension.downloadPath || ""), `下载路径合规（${extension.downloadPath}）`);
  // 版本三处对齐：后台元数据 = manifest.json = 前端实际存在的 zip。
  // 只对得上版本号不够，用户点「下载插件」拿到 404 才是真故障。
  const manifestVersion = JSON.parse(readFileSync(join(root, "extensions/aipdd-enterprise/manifest.json"), "utf8")).version;
  assert(extension.version === manifestVersion, `元数据版本与 manifest 一致（${extension.version} / ${manifestVersion}）`);
  assert(existsSync(join(root, "frontend/public", extension.downloadPath)), "下载路径对应的 zip 确实在前端静态目录", extension.downloadPath);
  // zip 交付质量：用 Compress-Archive 重打包会写反斜杠条目名，macOS/Linux 解压后没有目录→装不上；
  // 重新打包一律走 scripts/pack-extension.mjs，这里钉住分隔符合规与文件名版本对齐。
  if (existsSync(join(root, "frontend/public", extension.downloadPath))) {
    const entryNames = listZipEntryNames(join(root, "frontend/public", extension.downloadPath));
    assert(entryNames.length > 0 && entryNames.every((name) => !name.includes("\\")), "zip 条目名不含反斜杠（POSIX 分隔符合规）", entryNames.filter((n) => n.includes("\\")).join(","));
    assert(
      entryNames.length > 0 && entryNames.every((name) => name.startsWith("aipdd-enterprise/")),
      "zip 内保留 aipdd-enterprise/ 目录层（README 安装第 3 步可加载）",
      entryNames[0],
    );
    assert(
      extension.downloadPath === `/downloads/aipdd-enterprise-v${manifestVersion}.zip`,
      "zip 文件名版本与 manifest 对齐", // 对不上就是改了 manifest 没重打包
      extension.downloadPath,
    );
  }

  // ---------- 2) create：正常建台账 ----------
  const created = await call("POST", "/enterprise/distribution/contents", {
    title: `回归-分发台账-${Date.now()}`,
    content: "这是一条用于接口回归的分发内容，正文。",
    mediaType: "MOMENT",
    images: [{ name: "a.png", url: "https://example.com/a.png" }],
    platformCodes: ["weibo", "xiaohongshu"],
    autoPublish: false,
    tags: "回归",
  });
  assert(created.code === 0 && created.data?.id, "create 返回台账 id", `message=${created.message}`);
  const contentId = created.data?.id;
  assert(created.data?.status === "DRAFT" && created.data?.statusLabel === "未分发", "新建默认 DRAFT/未分发");
  assert((created.data?.platformNames ?? []).join(",") === "微博,小红书", "platformNames 按注册表映射");

  // ---------- 3) 平台与类型不匹配要拒 ----------
  const mismatch = await call("POST", "/enterprise/distribution/contents", {
    title: "回归-错配",
    content: "正文",
    mediaType: "MOMENT",
    platformCodes: ["zhihu"],
  });
  assert(mismatch.code !== 0 && !String(mismatch.message || "").includes("invalid"), "MOMENT 内容勾 ARTICLE 平台被拒", `message=${mismatch.message}`);

  // ---------- 4) page：关键字过滤命中 ----------
  const page = await call("GET", `/enterprise/distribution/contents?page=1&pageSize=10&keyword=${encodeURIComponent("回归-分发台账")}`);
  assert(page.code === 0 && page.data?.list?.length === 1, "page 按关键字命中 1 条", `total=${page.data?.total}`);
  assert(page.data?.list?.[0]?.id === contentId, "命中记录就是刚建的那条");

  // ---------- 5) mark：置为已分发 ----------
  const marked = await call("POST", `/enterprise/distribution/contents/${contentId}/mark`);
  assert(marked.code === 0 && marked.data?.status === "DISTRIBUTED", "mark 后状态 DISTRIBUTED");
  assert(Boolean(marked.data?.lastDistributedAt), "mark 留下分发时间");

  // ---------- 6) reportLogs：插件回写 + 覆盖语义 ----------
  const reported = await call("POST", `/enterprise/distribution/contents/${contentId}/logs`, {
    source: "EXTENSION",
    logs: [
      { platformCode: "weibo", status: "SUCCESS", publishedUrl: "https://weibo.com/1", errorMsg: "" },
      { platformCode: "xiaohongshu", status: "FAILED", publishedUrl: "", errorMsg: "没找到发布按钮" },
    ],
  });
  assert(reported.code === 0 && reported.data?.length === 2, "reportLogs 返回 2 条结果", `message=${reported.message}`);
  const republished = await call("POST", `/enterprise/distribution/contents/${contentId}/logs`, {
    source: "MANUAL",
    logs: [{ platformCode: "xiaohongshu", status: "SUCCESS", publishedUrl: "", errorMsg: "" }],
  });
  assert(republished.code === 0 && republished.data?.[0]?.statusLabel === "已发布", "同平台重复上报＝覆盖（人工补记成功）");

  // ---------- 7) detail：台账 + 结果聚合 ----------
  const detail = await call("GET", `/enterprise/distribution/contents/${contentId}`);
  assert(detail.code === 0 && detail.data?.logs?.length === 2, "detail 汇总 2 条逐平台结果", `logs=${detail.data?.logs?.length}`);
  const xhs = (detail.data?.logs ?? []).find((l) => l.platformCode === "xiaohongshu");
  assert(xhs?.status === "SUCCESS" && xhs?.source === "MANUAL", "小红书结果已被人工补记覆盖");

  // ---------- 8) update + remove（无数据残留） ----------
  const updated = await call("PUT", `/enterprise/distribution/contents/${contentId}`, { tags: "回归-已改" });
  assert(updated.code === 0 && updated.data?.tags === "回归-已改", "update 部分字段生效");
  const removed = await call("DELETE", `/enterprise/distribution/contents/${contentId}`);
  assert(removed.code === 0 && removed.data?.removed === true, "remove 成功");
  const gone = await call("GET", `/enterprise/distribution/contents/${contentId}`);
  assert(gone.code !== 0, "删除后 detail 读不到（404）");

  // ---------- 9) 未知平台编码要拒 ----------
  const okDy = await call("POST", "/enterprise/distribution/contents", {
    title: "回归-坏编码",
    content: "正文",
    platformCodes: ["douyin"],
  });
  assert(okDy.code === 0, "只勾 douyin 创建成功（MOMENT 合法）");
  if (okDy.data?.id) {
    const bad = await call("POST", `/enterprise/distribution/contents/${okDy.data.id}/logs`, {
      source: "EXTENSION",
      logs: [{ platformCode: "facebook", status: "SUCCESS" }],
    });
    assert(bad.code !== 0, "reportLogs 未知平台编码被拒");
    await call("DELETE", `/enterprise/distribution/contents/${okDy.data.id}`);
  }

  // ---------- 10) 越权隔离：另一账号读不到这条台账（对现存台账验，配 owner 可读正对照） ----------
  const isoRow = await call("POST", "/enterprise/distribution/contents", {
    title: "回归-隔离台账",
    content: "正文",
    mediaType: "ARTICLE",
    platformCodes: ["zhihu"],
  });
  const isoId = isoRow.data?.id;
  assert(isoRow.code === 0 && isoId, "隔离台账创建成功（ARTICLE/zhihu 合法）");
  const ownerRead = await call("GET", `/enterprise/distribution/contents/${isoId}`);
  assert(ownerRead.code === 0, "本人可读该台账（正对照：台账确实存在）");
  const other = await prisma.account.create({ data: { username: `${username}-b` } });
  const originalBearer = bearer;
  bearer = issueSsoSession(String(other.id), `${username}-b`, other.tokenVersion);
  const cross = await call("GET", `/enterprise/distribution/contents/${isoId}`);
  assert(cross.code !== 0, "跨账号读取台账被拒（隔离生效，而非因已删除而恒真）");
  bearer = originalBearer;
  await call("DELETE", `/enterprise/distribution/contents/${isoId}`);
  await prisma.account.delete({ where: { id: other.id } });

  // ---------- 11) 富文本正文：后端写入是唯一信任边界，落库前必须洗 ----------
  // 台账正文存「受限 HTML」：它会经插件投递到第三方平台页面，也会被本页 innerHTML 预览，
  // 所以脚本/事件属性/危险协议在这里就要杀掉，不能指望前端与插件那两道。
  const rich = await call("POST", "/enterprise/distribution/contents", {
    title: "回归-富文本正文",
    content:
      '<h2>标题</h2><p style="color:red"><strong>重点</strong></p>'
      + '<script>alert(1)</script><img src=x onerror="alert(1)">'
      + '<a href="javascript:alert(1)">x</a>',
    mediaType: "ARTICLE",
    platformCodes: ["zhihu"],
  });
  assert(rich.code === 0 && rich.data?.id, "富文本台账创建成功", `message=${rich.message}`);
  const richId = rich.data?.id;
  const richBody = String(rich.data?.content ?? "");
  assert(richBody.includes("<h2>标题</h2>") && richBody.includes("<strong>重点</strong>"), "样式标签保留", richBody);
  assert(!/script|alert/i.test(richBody), "脚本在落库前就被剔除", richBody);
  assert(!/onerror|<img/i.test(richBody), "事件属性与 img 标签不留", richBody);
  assert(!/javascript:/i.test(richBody), "危险协议链接不留", richBody);
  await call("DELETE", `/enterprise/distribution/contents/${richId}`);

  // 老台账是纯文本：读回要能成段，且用户手写的尖括号不能变成活标签。
  const legacy = await call("POST", "/enterprise/distribution/contents", {
    title: "回归-纯文本转段落",
    content: "第一段\n继续\n\n第二段",
    mediaType: "ARTICLE",
    platformCodes: ["zhihu"],
  });
  assert(
    legacy.data?.content === "<p>第一段<br>继续</p><p>第二段</p>",
    "纯文本按空行切段",
    legacy.data?.content,
  );
  await call("DELETE", `/enterprise/distribution/contents/${legacy.data?.id}`);

  // 分两种情况：带富文本标签的走清洗通道，不带的走纯文本通道（整段转义成字面文字）。
  // 两条路都不能给注入留活标签，且用户的字面尖括号要能原样读回。
  const sneaky = await call("POST", "/enterprise/distribution/contents", {
    title: "回归-尖括号注入",
    content: '前<script>x</script>后<img src=y onerror=alert(2)>',
    mediaType: "ARTICLE",
    platformCodes: ["zhihu"],
  });
  const sneakyBody = String(sneaky.data?.content ?? "");
  // 只看真标签：`<` 后面紧跟字母/斜杠且以 `>` 闭合才算活标签；
  // 被转义成 &lt;…&gt; 的字面文字不构成标签（旧写法先整体解码会造出假标签）。
  const sneakyTags = [];
  for (const match of sneakyBody.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^<>]*>/g)) sneakyTags.push(match[1].toLowerCase());
  assert(sneakyTags.every((t) => ["p", "br"].includes(t)), "注入不能形成活标签", `${sneakyTags.join(",")} | ${sneakyBody}`);
  assert(sneakyBody.includes("&lt;script&gt;") && sneakyBody.startsWith("<p>"), "纯文本通道的尖括号转为字面文字", sneakyBody);
  await call("DELETE", `/enterprise/distribution/contents/${sneaky.data?.id}`);

  const mixed = await call("POST", "/enterprise/distribution/contents", {
    title: "回归-富文本夹带脚本",
    content: '<p>前<script>alert(3)</script>后</p>',
    mediaType: "ARTICLE",
    platformCodes: ["zhihu"],
  });
  assert(mixed.data?.content === "<p>前后</p>", "富文本通道只删代码段不误伤正文", mixed.data?.content);
  await call("DELETE", `/enterprise/distribution/contents/${mixed.data?.id}`);

  // 只剩样式的「空正文」不能当成有内容发布出去。
  const emptyRich = await call("POST", "/enterprise/distribution/contents", {
    title: "回归-空富文本",
    content: "<p></p><script>alert(1)</script>",
    mediaType: "ARTICLE",
    platformCodes: ["zhihu"],
  });
  assert(emptyRich.code !== 0, "清洗后无正文内容时拒写", `message=${emptyRich.message}`);
} finally {
  await prisma.distributionPublishLog.deleteMany({ where: { userId: String(account.id) } });
  await prisma.distributionContent.deleteMany({ where: { userId: String(account.id) } });
  await prisma.account.delete({ where: { id: account.id } });
  await prisma.$disconnect();
}

console.log(`${state.passed} 项通过，${state.failed} 项失败`);
process.exitCode = state.failed ? 1 : 0;
