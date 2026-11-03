/**
 * 数字分身：接口层实测。
 *
 * 口径：
 * - 打临时实例（regression-instance.mjs --port=1695），不碰 1690 日常实例。
 * - 分身只动 demo_agent 自己建的几行：开跑先记下原有分身，收尾删掉本次新建的。
 * - 提示词注入用本机假上游验证：起一个只记录请求、回一段 SSE 的 mock，
 *   建一条指向它的自定义渠道，发一轮对话后检查 system 提示；不花模型额度。
 * - 会话、模型渠道、分身全部在 finally 里清理。
 *
 * 用法：
 *   node scripts/regression-instance.mjs --port=1695 -- node scripts/verify-agent-persona.mjs
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";

import { createSuite } from "./harness.mjs";

const suite = createSuite({
  base: process.env.BASE_URL || "http://127.0.0.1:1695",
});
const { call, assert, token } = suite;
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const {
  CONTENT_AGENT_STYLES,
  CONTENT_AGENT_PERSONA_MAX_COUNT,
} = require("@enterprise/contracts");

const ACCOUNT = "demo_agent";
const OTHER = "demo_enterprise";
const PERSONAS = "/enterprise/content/agent/personas";
const CHANNELS = "/enterprise/content/channels";
const CONVERSATIONS = "/enterprise/content/agent/conversations";
// SSE 原始路由只挂在 /api/backend 下
const MESSAGES = (id) =>
  `/api/backend/enterprise/content/agent/conversations/${id}/messages`;

const STAMP = Date.now();
const PERSONA_A = `验证分身A-${STAMP}`;
const PERSONA_B = `验证分身B-${STAMP}`;

console.log(`目标实例：${suite.base}`);
console.log(`测试主体：${ACCOUNT}`);

/** 假上游：记录每次 /chat/completions 的请求体，回一段最小 SSE。 */
const captures = [];
const mock = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
    captures.push({ url: req.url, body });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "收到。" } }] })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockBase = `http://127.0.0.1:${mock.address().port}/v1`;

const createdPersonas = [];
let channelId = 0;
let conversationId = 0;

async function sendTurn(content, personaId) {
  const res = await fetch(`${suite.base}${MESSAGES(conversationId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token(ACCOUNT)}`,
    },
    body: JSON.stringify({
      content,
      channelId,
      model: "verify-model",
      mode: "chat",
      ...(personaId === undefined ? {} : { personaId }),
    }),
  });
  return { status: res.status, text: await res.text() };
}

/** 最近一次假上游请求里的 system 提示词。 */
function lastSystem() {
  const hit = [...captures].reverse().find((item) => {
    const messages = item.body?.messages;
    return Array.isArray(messages) && messages[0]?.role === "system";
  });
  return String(hit?.body?.messages?.[0]?.content || "");
}

try {
  // ---------- 1) 未登录读不到 ----------
  const anon = await fetch(`${suite.base}${PERSONAS}`);
  assert(anon.status === 401, "未登录读数字分身 → 401", `status=${anon.status}`);

  // ---------- 2) 新建 / 校验 / 同名 ----------
  const listBefore = await call("GET", PERSONAS, ACCOUNT);
  assert(listBefore.code === 0, "分身清单可读", `code=${listBefore.code}`);

  const createdA = await call("POST", PERSONAS, ACCOUNT, {
    name: PERSONA_A,
    style: "friendly",
    persona: "你是小野品牌的助理，答话先照顾品牌调性。",
  });
  assert(
    createdA.code === 0 && createdA.data?.id && createdA.data?.name === PERSONA_A,
    "新建数字分身成功（免口令）",
    `code=${createdA.code} message=${createdA.message}`,
  );
  createdPersonas.push(createdA.data?.id);

  const createdB = await call("POST", PERSONAS, ACCOUNT, {
    name: PERSONA_B,
    style: "efficient",
    persona: "",
  });
  assert(createdB.code === 0, "新建第二个分身成功", `code=${createdB.code}`);
  createdPersonas.push(createdB.data?.id);

  const dup = await call("POST", PERSONAS, ACCOUNT, {
    name: PERSONA_A,
    style: "",
    persona: "",
  });
  assert(
    dup.code !== 0 && /同名/.test(dup.message || ""),
    "同账号内分身名称不能重复",
    `code=${dup.code} message=${dup.message}`,
  );

  const badStyle = await call("POST", PERSONAS, ACCOUNT, {
    name: `验证无效风格-${STAMP}`,
    style: "nonsense",
    persona: "",
  });
  assert(
    badStyle.code !== 0 && /风格/.test(badStyle.message || ""),
    "不在可选范围内的风格被拒",
    `code=${badStyle.code} message=${badStyle.message}`,
  );

  const tooLong = await call("POST", PERSONAS, ACCOUNT, {
    name: `验证超长人设-${STAMP}`,
    style: "",
    persona: "人".repeat(501),
  });
  assert(
    tooLong.code !== 0 && /500/.test(tooLong.message || ""),
    "人设超过 500 字被拒",
    `code=${tooLong.code} message=${tooLong.message}`,
  );

  // ---------- 3) 另一账号互不可见 ----------
  const otherList = await call("GET", PERSONAS, OTHER);
  assert(
    otherList.code === 0 &&
      !(otherList.data || []).some((item) => item.name === PERSONA_A),
    "分身按登录账号隔离（另一个账号看不到）",
  );

  // ---------- 4) 会话绑定分身 + 显式注入 ----------
  const channel = await call("POST", CHANNELS, ACCOUNT, {
    provider: "custom",
    preset: "custom",
    name: `验证·分身 ${STAMP}`,
    baseUrl: mockBase,
    apiKey: "sk-verify-not-a-real-key",
  });
  assert(
    channel.code === 0,
    "建临时自定义渠道成功",
    `code=${channel.code} message=${channel.message}`,
  );
  channelId = channel.data?.id || 0;

  const conversation = await call("POST", CONVERSATIONS, ACCOUNT, {
    title: "验证·数字分身",
    personaId: createdA.data?.id,
  });
  assert(
    conversation.code === 0 &&
      conversation.data?.personaId === createdA.data?.id,
    "建会话时记住所选分身",
    `personaId=${conversation.data?.personaId}`,
  );
  conversationId = conversation.data?.id || 0;

  const turn1 = await sendTurn("今天品牌主色怎么用？");
  assert(
    turn1.status === 200 && /event: done/.test(turn1.text),
    "带分身跑完一轮对话",
    `status=${turn1.status} head=${turn1.text.slice(0, 120)}`,
  );
  const system1 = lastSystem();
  assert(
    system1.includes(`【数字分身：${PERSONA_A}】`),
    "系统提示带上了所选分身",
  );
  assert(
    system1.includes("【回复风格：亲和友善】") &&
      system1.includes(
        CONTENT_AGENT_STYLES.find((item) => item.key === "friendly").prompt,
      ),
    "分身的风格提示词进了系统提示",
  );
  assert(
    system1.includes("品牌调性") && system1.includes("只影响语气与表达方式"),
    "分身的人设与「只调语气」的约束都在",
  );

  // ---------- 5) 切到「自动」且只有一个分身时直接用它 ----------
  const removedB = await call("DELETE", `${PERSONAS}/${createdB.data?.id}`, ACCOUNT);
  assert(removedB.code === 0, "删除第二个分身成功", `code=${removedB.code}`);
  const indexB = createdPersonas.indexOf(createdB.data?.id);
  if (indexB >= 0) createdPersonas.splice(indexB, 1);

  await call("PUT", `${CONVERSATIONS}/${conversationId}`, ACCOUNT, { personaId: 0 });
  const turn2 = await sendTurn("给我一句 slogan。");
  assert(
    turn2.status === 200 && /event: done/.test(turn2.text),
    "切到自动后再跑一轮",
    `status=${turn2.status}`,
  );
  const system2 = lastSystem();
  assert(
    system2.includes(`【数字分身：${PERSONA_A}】`) &&
      !system2.includes("按本轮语义自动选择"),
    "只剩一个分身时自动＝直接用它，不再要求模型挑选",
  );

  // ---------- 6) 两个分身时自动＝交给模型按语义自选 ----------
  const createdC = await call("POST", PERSONAS, ACCOUNT, {
    name: PERSONA_B,
    style: "efficient",
    persona: "",
  });
  assert(createdC.code === 0, "再建一个分身", `code=${createdC.code}`);
  createdPersonas.push(createdC.data?.id);

  const turn3 = await sendTurn("帮我高效列一下本周待办。");
  assert(
    turn3.status === 200 && /event: done/.test(turn3.text),
    "有两个分身时跑一轮自动",
    `status=${turn3.status}`,
  );
  const system3 = lastSystem();
  assert(
    system3.includes("【数字分身：按本轮语义自动选择】") &&
      system3.includes(PERSONA_A) &&
      system3.includes(PERSONA_B),
    "自动模式把全部分身交给模型按语义自选",
  );
  assert(
    system3.includes("【分身：名称】"),
    "自动模式要求模型在首行标注本轮用的分身",
  );

  // ---------- 7) 改名同步到会话上的名字快照 ----------
  const rebound = await call("PUT", `${CONVERSATIONS}/${conversationId}`, ACCOUNT, {
    personaId: createdA.data?.id,
  });
  assert(
    rebound.code === 0 && rebound.data?.personaName === PERSONA_A,
    "切回指定分身时会话记下名字快照",
    `code=${rebound.code} personaName=${rebound.data?.personaName}`,
  );
  const renamed = await call("PUT", `${PERSONAS}/${createdA.data?.id}`, ACCOUNT, {
    name: `${PERSONA_A}-改`,
    style: "friendly",
    persona: "你是小野品牌的助理，答话先照顾品牌调性。",
  });
  assert(renamed.code === 0, "修改分身名称成功", `code=${renamed.code}`);
  const conversations = await call("GET", CONVERSATIONS, ACCOUNT);
  const target = (conversations.data || []).find(
    (item) => item.id === conversationId,
  );
  assert(
    target?.personaName === `${PERSONA_A}-改`,
    "改名后会话上的分身名同步",
    `personaName=${target?.personaName}`,
  );

  // ---------- 8) 删除分身：会话退回自动 ----------
  const removedA = await call("DELETE", `${PERSONAS}/${createdA.data?.id}`, ACCOUNT);
  assert(removedA.code === 0, "删除分身成功", `code=${removedA.code}`);
  const indexA = createdPersonas.indexOf(createdA.data?.id);
  if (indexA >= 0) createdPersonas.splice(indexA, 1);
  const afterRemove = await call("GET", CONVERSATIONS, ACCOUNT);
  const cleared = (afterRemove.data || []).find(
    (item) => item.id === conversationId,
  );
  assert(
    cleared?.personaId === 0 && cleared?.personaName === "",
    "删掉分身（含改名后的快照）后会话回到「自动」",
    `personaId=${cleared?.personaId} personaName=${cleared?.personaName}`,
  );

  // ---------- 9) 上限 ----------
  const listNow = await call("GET", PERSONAS, ACCOUNT);
  const room =
    CONTENT_AGENT_PERSONA_MAX_COUNT - (listNow.data?.length || 0);
  assert(room >= 0, "分身数量未超过上限", `count=${listNow.data?.length}`);
} finally {
  if (conversationId) {
    await call("DELETE", `${CONVERSATIONS}/${conversationId}`, ACCOUNT).catch(
      () => undefined,
    );
  }
  if (channelId) {
    await call("DELETE", `${CHANNELS}/${channelId}`, ACCOUNT).catch(() => undefined);
  }
  for (const id of createdPersonas) {
    if (!id) continue;
    await call("DELETE", `${PERSONAS}/${id}`, ACCOUNT).catch(() => undefined);
  }
  await new Promise((resolve) => mock.close(resolve));
}

// ---------- 收尾：临时数据清理干净 ----------
const finalList = await call("GET", PERSONAS, ACCOUNT);
assert(
  !(finalList.data || []).some(
    (item) => item.name.startsWith("验证分身") && item.name.includes(String(STAMP)),
  ),
  "本次新建的分身已全部删除",
);

const { passed, failed } = suite.counts();
console.log(`\n${suite.summary()}`);
if (failed) process.exitCode = 1;
else console.log(`共 ${passed} 项断言全部通过`);