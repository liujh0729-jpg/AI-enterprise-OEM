/**
 * 回归/实测脚本的共用工装（Tier 3 · 工装合并）。
 *
 * 之前 16 个脚本各自复制同一段开场：读 seed-users.json、签 JWT、拼 fetch、
 * 计数打印。改一处口径（比如签发方、请求头、空响应体的处理）要连着改十几个文件，
 * 也容易出现「A 脚本发 GET 带 body、B 脚本不带」这种假差异。这里收一份实现，
 * 各脚本只留一次 `createSuite()` 适配，调用点写法不变。
 *
 * 约定（跟历史套件保持一致，别在脚本里重新发明）：
 * - 完整回归使用专用本机隔离库；本工装与 regression-instance.mjs 都不会创建隔离库。
 *   进程环境 DATABASE_URL 必须显式配置，实例与脚本连接同一目标，不能继承远端开发库。
 * - 目标实例一律由 BASE_URL 指定；本地口径套件的默认端口是隔离实例的默认端口，
 *   裸跑时被 regression-guard 拦下属预期（见 regression-instance.mjs 用法）。
 * - 登录态用 seed 用户签名 JWT（本机实例的既定测试通道），不碰正式平台凭据。
 * - 空响应体／非 JSON 响应返回 data=null，由调用方断言，不在这里吞掉错误。
 *
 * 以下脚本不共用 createSuite 的实例口径：
 * - verify-smart-service / verify-aiworkin-production-supply：必须打在通道**打开**的实例上
 *   （可能真连 AIworkin 正式平台）；regression-instance.mjs 只有显式 --live-platform 才开启通道。
 * - verify-auth-session-gate：验证前端会话 Cookie 与所配置账号服务的登录、续签握手；
 *   账号服务地址由测试前端的 AUTH_BACKEND_URL 决定，不固定为本机 1688。
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scriptJwtSecret } from "./jwt-secret.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const jwt = require("jsonwebtoken");

/** 隔离实例（regression-instance.mjs）的默认端口，脚本默认值与它同源。 */
export const REGRESSION_PORT = 1693;
/** 通道实测套件（真打 AIworkin 正式平台）的隔离端口：`--live-platform` 起的实例。 */
export const LIVE_PORT = 1694;

export function regressionBase() {
  return process.env.BASE_URL || `http://127.0.0.1:${REGRESSION_PORT}`;
}

/** 种子账号表：username → { userId, role, ... }。 */
export function seedUsers() {
  return JSON.parse(
    readFileSync(join(ROOT, "backend/prisma/seed-users.json"), "utf8"),
  );
}

export function createPrisma() {
  const { PrismaClient } = require("../backend/generated/prisma");
  return new PrismaClient();
}

/** 本地实例的 JWT 签发口径与后端一致：HS256 + 配置的 issuer。 */
export function tokenSigner(users) {
  const secret = scriptJwtSecret();
  const issuer = process.env.JWT_ISSUER || "aipdd-java-core";
  return function token(username) {
    const row = users[username];
    if (!row) throw new Error(`seed-users.json 里没有账号：${username}`);
    return jwt.sign(
      { userId: row.userId, username, role: row.role, type: "access" },
      secret,
      { algorithm: "HS256", issuer },
    );
  };
}

/**
 * 请求原语：返回状态码、重定向位置与响应体（JSON 解析失败时给文本）。
 * 需要读 HTML／302 的脚本（如 fe-be-integration）用它，其余用下面的封装。
 */
export async function httpJson({
  url,
  method,
  body,
  bearer,
  headers = {},
  redirect = "follow",
}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    // GET 调用点会传 null 占位，不能序列化成 "null" 报文（fetch 会拒收）
    body: body == null ? undefined : JSON.stringify(body),
    redirect,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text || null;
  }
  return { status: res.status, location: res.headers.get("location"), data };
}

/**
 * 套件开场：一次拿到目标地址、种子用户、token、请求封装与计数器。
 *
 * `api(method, path, body, username)` → `{ status, data }`（data 为整个响应信封）
 * `call(method, path, username, body)` → `{ status, ...信封 }`（code/message/data 平铺）
 * 两种写法都是历史套件里已有的，保留是为了不改动上千个调用点。
 */
export function createSuite({ base, okLabel = "OK  " } = {}) {
  const target = base || regressionBase();
  const users = seedUsers();
  const token = tokenSigner(users);
  const state = { passed: 0, failed: 0, failures: [] };

  const log = (name, ok, extra = "") => {
    console.log(`${ok ? okLabel : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
    if (ok) state.passed += 1;
    else {
      state.failed += 1;
      state.failures.push(`${name}${extra ? ` — ${extra}` : ""}`);
    }
  };
  const assert = (cond, name, extra) => log(name, !!cond, extra ?? "");

  const api = async (method, path, body, username) =>
    httpJson({
      url: `${target}${path}`,
      method,
      body,
      bearer: username ? token(username) : undefined,
    });

  const call = async (method, path, username, body) => {
    const res = await api(method, path, body, username);
    const envelope = res.data && typeof res.data === "object" ? res.data : {};
    return { status: res.status, ...envelope };
  };

  return {
    base: target,
    users,
    token,
    api,
    call,
    log,
    assert,
    counts: () => ({ ...state }),
    summary: () => `${state.passed} 项通过，${state.failed} 项失败`,
  };
}
