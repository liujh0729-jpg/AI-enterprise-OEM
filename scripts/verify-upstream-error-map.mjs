/**
 * 上游故障 → 本系统错误码的映射验证（F3 收口后的常驻护栏）。
 *
 * 打什么：一个**本机替身上游**，绝不打正式平台。替身按路径回放三种故障：
 *   /market/agent-conversations*  → 404「上游说没这条单」（确实没有数据，必须原样透传）
 *   /market/listings/mine*        → 401「token expired」（规则 62：不得回流 code 401，否则前端跳登录页）
 *   其余（含 /market/listings）   → 503「服务器内部错误」（通道不可用总口径 24001，原文只留 data）
 *
 * 为什么要它：这类映射错误不报错，只会把「通道故障」显示成一句上游内部错误，
 * 或者把已登录用户顶出会话（规则 62 的历史事故）。原来只在代码里，没有回归网。
 *
 * 用法（替身由本套件自己起，实例侧把通道指向它）：
 *   AIWORKIN_BASE_URL=http://127.0.0.1:1999 node scripts/regression-instance.mjs \
 *     --no-build --live-platform --port=1694 -- node scripts/verify-upstream-error-map.mjs
 * 端口可用 DUMMY_UPSTREAM_PORT / BASE_URL 覆盖；实例必须**通道打开**（走真实映射分支），
 * 且自检确认实例确实指到这个替身，否则会把「通道关闭」的兜底当成本套件通过。
 */
import { createServer } from "node:http";
import { createSuite } from "./harness.mjs";
import { assertChannelOn } from "./regression-guard.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:1694";
const DUMMY_HOST = "127.0.0.1";
const DUMMY_PORT = Number(process.env.DUMMY_UPSTREAM_PORT || 1999);
const DUMMY_BASE = `http://${DUMMY_HOST}:${DUMMY_PORT}`;

await assertChannelOn(BASE);

function upstreamReply(url) {
  if (url.startsWith("/market/agent-conversations")) {
    return { status: 404, message: "上游说没这条单" };
  }
  if (url.startsWith("/market/listings/mine")) {
    return { status: 401, message: "token expired" };
  }
  return { status: 503, message: "服务器内部错误" };
}

const dummy = createServer((req, res) => {
  const { status, message } = upstreamReply(String(req.url || ""));
  const body = JSON.stringify({ code: 0, message });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
});
await new Promise((resolve, reject) => {
  dummy.once("error", reject);
  dummy.listen(DUMMY_PORT, DUMMY_HOST, resolve);
});

const s = createSuite({ base: BASE });
try {
  // 自检：实例的通道出口必须就是本替身，否则下面的断言可能在测别的东西
  const status = await s.api("GET", "/enterprise/aiworkin/status", null, "demo_enterprise");
  if (status.data?.data?.baseUrl !== DUMMY_BASE) {
    throw new Error(
      `自检失败：实例的 AIWORKIN_BASE_URL=${JSON.stringify(status.data?.data?.baseUrl)}，` +
        `期望 ${DUMMY_BASE}。请用 AIWORKIN_BASE_URL=${DUMMY_BASE} 起实例（见本文件头部）。`,
    );
  }

  const r503 = await s.api(
    "GET",
    "/enterprise/aiworkin/market/listings",
    null,
    "demo_enterprise",
  );
  s.assert(
    r503.data?.code === 24001 &&
      r503.data?.message === "AIworkin 能力暂不可用" &&
      r503.data?.data?.upstreamStatus === 503 &&
      String(r503.data?.data?.upstreamMessage || "").includes("服务器内部错误"),
    "上游 5xx 收口为 24001「AIworkin 能力暂不可用」（上游原文只留在 data）",
    JSON.stringify(r503.data),
  );

  const r404 = await s.api(
    "GET",
    "/enterprise/aiworkin/conversations/does-not-exist-404",
    null,
    "demo_enterprise",
  );
  s.assert(
    r404.status === 404 &&
      r404.data?.code === 404 &&
      r404.data?.message === "上游说没这条单" &&
      r404.data?.data === null,
    "上游 404 原样透传（code 404 + 上游文案，不被 24001 吞掉）",
    JSON.stringify(r404.data),
  );

  const r401 = await s.api(
    "GET",
    "/enterprise/aiworkin/demands",
    null,
    "demo_enterprise",
  );
  s.assert(
    r401.data?.code === 24001 &&
      String(r401.data?.message || "").startsWith("AIworkin 通道鉴权失败：") &&
      String(r401.data?.message || "").includes("token expired"),
    "规则 62：上游 401 改判 24001「通道鉴权失败」，不回流 code 401",
    JSON.stringify(r401.data),
  );

  console.log(s.summary());
  process.exitCode = s.counts().failed ? 1 : 0;
} finally {
  await new Promise((resolve) => dummy.close(resolve));
}