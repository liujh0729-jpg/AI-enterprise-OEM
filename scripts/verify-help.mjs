/**
 * 帮助中心（章节知识库）：接口层实测。
 *
 * 口径：
 * - 与 verify-distribution 同一套 SSO 会话签发（backend/.env 的 JWT_SECRET 派生），现场建一次性账号，跑完删除；
 * - 知识内容内置不落库，所以断言全部针对读接口：目录结构、详情、搜索排序、错误口径与未登录拦截。
 *
 * 用法：node scripts/verify-help.mjs [BASE_URL]
 */
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
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
    return { status: res.status, ...(JSON.parse(text) ?? {}) };
  } catch {
    return { status: res.status, code: -1, message: text };
  }
};

console.log(`目标实例：${target}`);

const username = `help-verify-${Date.now().toString(36)}`;
const account = await prisma.account.create({ data: { username } });
bearer = issueSsoSession(String(account.id), username, account.tokenVersion);

try {
  // ---------- 1) chapters：目录结构与瘦身 ----------
  const chapters = await call("GET", "/enterprise/help/chapters");
  assert(chapters.code === 0 && Array.isArray(chapters.data), "chapters 返回 code=0", `code=${chapters.code} message=${chapters.message}`);
  const list = chapters.data ?? [];
  assert(list.length >= 8, `章节数 8+（实际 ${list.length}）`);
  for (const code of ["quick-start", "workbench", "distribution", "integration", "faq"]) {
    assert(list.some((c) => c.code === code), `章节包含 ${code}`);
  }
  const allTopics = list.flatMap((c) => c.topics ?? []);
  assert(allTopics.length >= 25, `主题总数 25+（实际 ${allTopics.length}）`);
  assert(
    allTopics.every((t) => t.code && t.title && t.summary && "routePath" in t && !("content" in t)),
    "目录主题瘦身（有摘要无正文）",
  );
  assert(new Set(allTopics.map((t) => t.code)).size === allTopics.length, "主题编码全局唯一");

  // ---------- 2) topic：详情与错误口径 ----------
  const detail = await call("GET", "/enterprise/help/topics/dist-extension");
  assert(detail.code === 0 && detail.data?.content?.includes("chrome://extensions"), "详情正文含插件安装步骤");
  assert(detail.data?.chapterTitle === "多平台内容分发", "详情附所属章节", `chapter=${detail.data?.chapterTitle}`);
  const missing = await call("GET", "/enterprise/help/topics/no-such-topic");
  assert(missing.code !== 0 && missing.status === 404, "未知主题 404", `status=${missing.status} message=${missing.message}`);

  // ---------- 3) search：命中排序 / 参数校验 / 空结果 ----------
  const hit = await call("GET", "/enterprise/help/search?keyword=" + encodeURIComponent("插件 安装"));
  assert(hit.code === 0 && (hit.data?.length ?? 0) >= 1, "搜索「插件 安装」有命中", `hits=${hit.data?.length}`);
  assert(hit.data?.[0]?.code === "dist-extension", "插件类关键词首位是插件安装主题", `first=${hit.data?.[0]?.code}`);
  assert(hit.data?.every((h) => h.excerpt && h.chapterTitle), "命中带章节名与摘要片段");

  const crm = await call("GET", "/enterprise/help/search?keyword=" + encodeURIComponent("线索"));
  assert((crm.data ?? []).some((h) => h.code === "wb-crm"), "搜索「线索」命中 CRM 主题");

  const emptyKeyword = await call("GET", "/enterprise/help/search?keyword=");
  // 空关键词在契约 zod min(1) 校验层就被拦下（422），轮不到服务层兼底；两种拒错都算合规。
  assert(emptyKeyword.code !== 0 && [400, 422].includes(emptyKeyword.status), "空关键词拒错", `status=${emptyKeyword.status}`);
  const noHit = await call("GET", "/enterprise/help/search?keyword=" + encodeURIComponent("zzz-不存在的词"));
  assert(noHit.code === 0 && noHit.data?.length === 0, "无命中回空数组");

  // ---------- 4) 未登录拦截 ----------
  const original = bearer;
  bearer = "";
  const anon = await call("GET", "/enterprise/help/chapters");
  assert(anon.code !== 0, "未登录访问帮助中心被拒", `status=${anon.status}`);
  bearer = original;
} finally {
  await prisma.account.delete({ where: { id: account.id } });
  await prisma.$disconnect();
}

console.log(`${state.passed} 项通过，${state.failed} 项失败`);
process.exitCode = state.failed ? 1 : 0;
