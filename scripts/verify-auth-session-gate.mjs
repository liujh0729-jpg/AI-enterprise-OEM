/**
 * 登录态门控回归：验证「会话过期」不会被演示账号自动登录顶掉身份。
 * 用法：node scripts/verify-auth-session-gate.mjs [webBase]
 * 前置：测试前端（webBase，默认本机 15889）与账号服务在跑；测试后端使用专用本机隔离库，
 *       不连接保留业务数据的远端开发库。DEV_AUTO_LOGIN=true 仅在此测试前端显式开启，
 *       且 frontend/.env.local 的 JWT_SECRET 与测试后端一致；生产模式不开放演示会话。
 * 账号服务由测试前端 AUTH_BACKEND_URL 指定，线上账号服务仅使用专用测试账号。
 * 真实续签测试需通过进程环境提供 AUTH_TEST_USERNAME / AUTH_TEST_PASSWORD，
 * 不在脚本或命令行参数中保存账号密码。
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const WEB = process.argv[2] || "http://127.0.0.1:15889";
const ISSUER = "aipdd-java-core";

function envValue(file, key) {
  const raw = readFileSync(new URL(file, new URL("../", import.meta.url)), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim();
  }
  throw new Error(`${file} 缺少 ${key}`);
}

const secret = envValue("frontend/.env.local", "JWT_SECRET").replace(/^"|"$/g, "");
if (!secret) throw new Error("frontend/.env.local 的 JWT_SECRET 为空");

function accessToken(ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      userId: "gate-check-user",
      username: "gate_check",
      role: "user",
      type: "access",
      iat: now,
      exp: now + ttlSeconds,
      iss: ISSUER,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const failures = [];
function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ""}`);
  }
}

async function gate(cookie) {
  const response = await fetch(`${WEB}/smart`, {
    redirect: "manual",
    cache: "no-store",
    headers: cookie ? { cookie } : {},
  });
  return {
    status: response.status,
    location: response.headers.get("location") || "",
    setCookie: response.headers.get("set-cookie") || "",
  };
}

const expired = accessToken(-600);
const nearExpiry = accessToken(30);
const valid = accessToken(3600);

console.log(`门控目标：${WEB}/smart`);

console.log("1) 未登录（无任何会话 Cookie）→ 走演示自动登录");
{
  const r = await gate("gate_probe=1");
  assert(
    "307 到 /api/dev/session",
    r.status === 307 && r.location.startsWith("/api/dev/session"),
    `${r.status} ${r.location}`,
  );
}

console.log("2) access 已过期且无 refresh（刷新无从发起）→ 回登录页，且不改签演示账号");
{
  const r = await gate(`aiworkin_token=${expired}`);
  const toLogin = r.status === 307 && r.location.startsWith("/login?");
  assert("307 到 /login", toLogin, `${r.status} ${r.location}`);
  assert(
    "带 reason=expired 说明原因",
    toLogin && new URL(r.location, WEB).searchParams.get("reason") === "expired",
    r.location,
  );
  assert(
    "未下发新的演示账号 Cookie",
    !r.setCookie.includes("aiworkin_token="),
    r.setCookie.slice(0, 60),
  );
  assert(
    "没有跳到 /api/dev/session",
    !r.location.startsWith("/api/dev/session"),
    r.location,
  );
}

console.log("3) 只剩 refresh Cookie（access 已丢失）→ 同样不得顶身份");
{
  const r = await gate(`aiworkin_refresh_token=${expired}`);
  assert(
    "307 到 /login 而不是 dev session",
    r.status === 307 && r.location.startsWith("/login?"),
    `${r.status} ${r.location}`,
  );
}

console.log("4) access 有效期内 → 直接放行");
{
  const r = await gate(`aiworkin_token=${valid}`);
  assert("200 放行", r.status === 200, `${r.status} ${r.location}`);
  assert(
    "未改签身份",
    !r.setCookie.includes("aiworkin_token="),
    r.setCookie.slice(0, 60),
  );
}

console.log("5) access 即将过期且 refresh 可用 → 续签后放行（身份沿用本人）");
{
  const loginUser = process.env.AUTH_TEST_USERNAME;
  const loginPassword = process.env.AUTH_TEST_PASSWORD;
  if (!loginUser || !loginPassword) {
    console.log("  SKIP 真实账号续签：未配置专用测试账号");
  } else {
  const login = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: loginUser, password: loginPassword }),
    cache: "no-store",
  });
  const setCookies = login.headers.get("set-cookie") || "";
  const refresh = (setCookies.match(/aiworkin_refresh_token=([^;]+)/) || [])[1];
  assert(
    "账号服务下发 refresh",
    Boolean(refresh),
    `http=${login.status}，账号=${loginUser}（账号服务不可达或凭据不正确时此项必须失败）`,
  );
  if (refresh) {
    const r = await gate(
      `aiworkin_token=${nearExpiry}; aiworkin_refresh_token=${refresh}`,
    );
    assert("200 放行", r.status === 200, `${r.status} ${r.location}`);
    assert(
      "下发了续签后的 access Cookie",
      r.setCookie.includes("aiworkin_token="),
      r.setCookie.slice(0, 40),
    );
  }
  }
}

if (failures.length) {
  console.log(`\n失败 ${failures.length} 项：${failures.join(" / ")}`);
  process.exit(1);
}
console.log("\n已执行的会话门控检查通过");
