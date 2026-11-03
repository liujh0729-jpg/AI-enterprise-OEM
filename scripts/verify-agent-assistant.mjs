/**
 * Agent 助理（第三方消息通道 → 一轮对话 → 原路回复）：接口层实测。
 *
 * 口径：
 * - 打开发实例 1690；只走接口，不连库、不碰远端业务数据。
 * - 企业微信应用做成一条真实配置的通道：用已知 Token / EncodingAESKey 加密并签名
 *   发一条回调，验证「公开回调 → 验签 → 解密 → 抽事件 → 白名单拦截 → 落消息日志」
 *   整条链路；白名单故意设成别人，避免真的跑一轮 Agent（会消耗模型额度）。
 * - 群机器人只出不进：测试连接打本机一个关闭的端口，只为拿「失败但不崩」的结果。
 * - 新建的通道与（必要时）临时模型渠道结束时全部删除，账号回到初始状态。
 *
 * 用法：node scripts/verify-agent-assistant.mjs [BASE_URL]
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { createSuite, httpJson } from "./harness.mjs";

const suite = createSuite({ base: process.argv[2] || "http://127.0.0.1:1690" });
const { call, assert } = suite;

const ACCOUNT = "demo_agent";
const CHANNELS = "/enterprise/content/agent/assistant/channels";
// 原始路由只挂在 business 的 /api/backend 下，不带前缀会 404
const CALLBACK = "/api/backend/enterprise/agent/assistant";

console.log(`目标实例：${suite.base}`);
console.log(`测试主体：${ACCOUNT}`);

function sha1(parts) {
  return createHash("sha1").update(parts.sort().join("")).digest("hex");
}

/** 企业微信/公众号回包加密：random(16) + 4字节长度 + 明文 + 接收方ID，32 字节 PKCS7 填充。 */
function wecomEncrypt(xml, encodingAesKey, receiveId) {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const body = Buffer.from(xml, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const plain = Buffer.concat([
    randomBytes(16),
    length,
    body,
    Buffer.from(receiveId, "utf8"),
  ]);
  const pad = 32 - (plain.length % 32);
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString(
    "base64",
  );
}

/** 回调体是原始 XML，不能走 JSON 封装的请求原语。 */
async function postRaw(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
  });
  return { status: res.status, text: await res.text() };
}

const created = { channels: [], modelChannel: 0 };

async function createAssistant(payload) {
  const res = await call("POST", CHANNELS, ACCOUNT, payload);
  if (res.code === 0 && res.data?.id) created.channels.push(res.data.id);
  return res;
}

try {
  // ---------- 1) 清单可读，且未登录看不到 ----------
  const anon = await httpJson({
    url: `${suite.base}${CHANNELS}`,
    method: "GET",
  });
  assert(anon.status === 401, "未登录读助理通道 → 401", `status=${anon.status}`);

  const before = await call("GET", CHANNELS, ACCOUNT);
  assert(
    before.code === 0 && Array.isArray(before.data),
    "助理通道清单可读",
    `code=${before.code} message=${before.message}`,
  );

  // ---------- 2) 执行渠道：助理必须绑自定义渠道（内置槽位无人值守拿不到 Key） ----------
  const settings = await call("GET", "/enterprise/content/settings", ACCOUNT);
  assert(settings.code === 0, "读取模型设置成功", `code=${settings.code}`);
  let channelId = (settings.data?.channels || []).find(
    (item) => item.id > 0 && item.enabled,
  )?.id;
  if (!channelId) {
    const channel = await call("POST", "/enterprise/content/channels", ACCOUNT, {
      provider: "custom",
      preset: "deepseek",
      apiKey: "sk-assistant-verify-not-a-real-key",
    });
    if (channel.code === 0 && channel.data?.id) {
      channelId = channel.data.id;
      created.modelChannel = channel.data.id;
    }
  }
  assert(Boolean(channelId), "有可用的自定义模型渠道作为执行渠道", `channelId=${channelId}`);

  const zero = await createAssistant({
    kind: "wecom_app",
    name: "验证·零渠道",
    config: {
      corpId: "wwverify",
      agentId: "1000002",
      secret: "verify-secret",
      token: "verify-token",
      encodingAesKey: randomBytes(32).toString("base64").slice(0, 43),
    },
    channelId: 0,
    model: "verify-model",
  });
  assert(
    zero.code !== 0 && /渠道/.test(zero.message || ""),
    "执行渠道填 0（内置槽位）会被拒",
    `code=${zero.code} message=${zero.message}`,
  );

  const missing = await createAssistant({
    kind: "wecom_app",
    name: "验证·缺凭据",
    config: { corpId: "wwverify" },
    channelId,
    model: "verify-model",
  });
  assert(
    missing.code !== 0 && /请填写/.test(missing.message || ""),
    "缺必填凭据时报错点名缺哪几项",
    `code=${missing.code} message=${missing.message}`,
  );

  // ---------- 3) 建一条企业微信应用通道：敏感项只回「已填写」 ----------
  const token = `verify-assistant-${Date.now()}`;
  const encodingAesKey = randomBytes(32).toString("base64").slice(0, 43);
  const created_ = await createAssistant({
    kind: "wecom_app",
    name: "验证·企业微信应用",
    config: {
      corpId: "wwverify",
      agentId: "1000002",
      secret: "verify-secret-value",
      token,
      encodingAesKey,
    },
    channelId,
    model: "verify-model",
    allowedUsers: "someone-else",
    enabled: true,
  });
  assert(created_.code === 0, "新建企业微信通道成功", `code=${created_.code} message=${created_.message}`);
  const row = created_.data || {};
  assert(
    /^[a-f0-9]{32}$/.test(row.webhookToken || "") &&
      row.webhookPath?.endsWith(row.webhookToken),
    "回调地址带 32 位随机串",
    `webhookPath=${row.webhookPath}`,
  );
  assert(
    ["secret", "token", "encodingAesKey"].every((key) =>
      (row.secretKeys || []).includes(key),
    ),
    "敏感项都标记为已填写",
    `secretKeys=${(row.secretKeys || []).join(",")}`,
  );
  assert(
    !JSON.stringify(row).includes("verify-secret-value") &&
      !JSON.stringify(row).includes(encodingAesKey),
    "敏感项不回显明文",
  );
  assert(
    row.config?.corpId === "wwverify" && row.config?.agentId === "1000002",
    "非敏感项正常回显",
    `config=${JSON.stringify(row.config)}`,
  );

  // ---------- 4) 公开回调：未登录可访问，未知 token → 404 ----------
  const unknown = await httpJson({
    url: `${suite.base}${CALLBACK}/${"0".repeat(32)}`,
    method: "GET",
  });
  assert(
    unknown.status === 404,
    "未知 token 的回调 → 404（不是 401，说明公开路由已放行）",
    `status=${unknown.status}`,
  );
  const shortToken = await httpJson({
    url: `${suite.base}${CALLBACK}/${"0".repeat(31)}`,
    method: "GET",
  });
  assert(
    shortToken.status === 401,
    "非 32 位 token → 401（公开放行范围没放大）",
    `status=${shortToken.status}`,
  );

  // ---------- 5) GET 验签回 echostr ----------
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "778899";
  const getSignature = sha1([token, timestamp, nonce, ""]);
  const echo = await httpJson({
    url: `${suite.base}${CALLBACK}/${row.webhookToken}?timestamp=${timestamp}&nonce=${nonce}&echostr=hello-echo&signature=${getSignature}`,
    method: "GET",
  });
  assert(
    echo.status === 200 && echo.data === "hello-echo",
    "GET 验签通过并原样回 echostr",
    `status=${echo.status} body=${JSON.stringify(echo.data)}`,
  );

  // ---------- 6) 加密回调：验签 → 解密 → 抽事件 → 白名单拦截 ----------
  const msgId = String(Date.now());
  const xml = `<xml><ToUserName><![CDATA[wwverify]]></ToUserName><FromUserName><![CDATA[zhangsan]]></FromUserName><CreateTime>${timestamp}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[帮我看下今天的待办]]></Content><MsgId>${msgId}</MsgId><AgentID>1000002</AgentID></xml>`;
  const sealed = wecomEncrypt(xml, encodingAesKey, "wwverify");
  const callbackBody = `<xml><ToUserName><![CDATA[wwverify]]></ToUserName><Encrypt><![CDATA[${sealed}]]></Encrypt><AgentID><![CDATA[1000002]]></AgentID></xml>`;
  const msgSignature = sha1([token, timestamp, nonce, sealed]);
  const callbackUrl = `${suite.base}${CALLBACK}/${row.webhookToken}?msg_signature=${msgSignature}&timestamp=${timestamp}&nonce=${nonce}`;

  const badSign = await postRaw(
    `${suite.base}${CALLBACK}/${row.webhookToken}?msg_signature=bad&timestamp=${timestamp}&nonce=${nonce}`,
    callbackBody,
  );
  assert(badSign.status === 400, "签名不对 → 400", `status=${badSign.status}`);

  const ok = await postRaw(callbackUrl, callbackBody);
  assert(ok.status === 200, "加密回调处理成功", `status=${ok.status} body=${ok.text}`);

  const messages = await call("GET", `${CHANNELS}/${row.id}/messages`, ACCOUNT);
  assert(messages.code === 0, "消息日志可读", `code=${messages.code}`);
  const inbound = (messages.data || []).filter(
    (item) => item.externalChatId === "zhangsan",
  );
  assert(
    inbound.length === 1 && inbound[0].content === "帮我看下今天的待办",
    "解密出的正文落成一条入站消息",
    `count=${inbound.length} content=${inbound[0]?.content}`,
  );
  assert(
    inbound[0]?.status === "ignored" && /允许名单/.test(inbound[0]?.error || ""),
    "不在允许名单的发送者被拦下并记原因",
    `status=${inbound[0]?.status} error=${inbound[0]?.error}`,
  );

  // 平台重推同一条消息：按外部消息 ID 去重，不重复落库
  const retry = await postRaw(callbackUrl, callbackBody);
  const afterRetry = await call("GET", `${CHANNELS}/${row.id}/messages`, ACCOUNT);
  const retried = (afterRetry.data || []).filter(
    (item) => item.externalChatId === "zhangsan",
  );
  assert(
    retry.status === 200 && retried.length === 1,
    "同一条消息重复推送只落一条",
    `status=${retry.status} count=${retried.length}`,
  );

  const channelList = await call("GET", CHANNELS, ACCOUNT);
  const listed = (channelList.data || []).find((item) => item.id === row.id);
  assert(
    listed?.lastEventAt === null && listed?.eventCount === 0,
    "被拦下的消息不推进「最近消息 / 累计条数」",
    `lastEventAt=${listed?.lastEventAt} eventCount=${listed?.eventCount}`,
  );

  // 停用后：回调仍然 200，但不再落消息
  const paused = await call("PUT", `${CHANNELS}/${row.id}`, ACCOUNT, {
    enabled: false,
  });
  assert(paused.code === 0 && paused.data?.enabled === false, "可以停用通道");
  const pausedSealed = wecomEncrypt(
    xml.replace(msgId, `${msgId}1`),
    encodingAesKey,
    "wwverify",
  );
  const pausedBody = `<xml><ToUserName><![CDATA[wwverify]]></ToUserName><Encrypt><![CDATA[${pausedSealed}]]></Encrypt></xml>`;
  const pausedPost = await postRaw(
    `${suite.base}${CALLBACK}/${row.webhookToken}?msg_signature=${sha1([token, timestamp, nonce, pausedSealed])}&timestamp=${timestamp}&nonce=${nonce}`,
    pausedBody,
  );
  const afterPause = await call("GET", `${CHANNELS}/${row.id}/messages`, ACCOUNT);
  assert(
    pausedPost.status === 200 && (afterPause.data || []).length === 1,
    "停用后回调仍回 200，但不再记录消息",
    `status=${pausedPost.status} count=${(afterPause.data || []).length}`,
  );

  // ---------- 7) 群机器人（只出不进）：测试连接失败但不崩 ----------
  const pushOnly = await createAssistant({
    kind: "dingtalk_webhook",
    name: "验证·钉钉群机器人",
    config: { webhookUrl: "http://127.0.0.1:9/none" },
    channelId,
    model: "verify-model",
    enabled: true,
  });
  assert(pushOnly.code === 0, "新建只推送通道成功", `code=${pushOnly.code} message=${pushOnly.message}`);
  assert(
    (pushOnly.data?.secretKeys || []).includes("webhookUrl"),
    "Webhook 地址按敏感项保存",
  );
  const pushTest = await call(
    "POST",
    `${CHANNELS}/${pushOnly.data?.id}/test`,
    ACCOUNT,
  );
  assert(
    pushTest.code === 0 && pushTest.data?.ok === false && pushTest.data?.message,
    "连接测试如实返回失败原因",
    `ok=${pushTest.data?.ok} message=${pushTest.data?.message}`,
  );
  const pushCallback = await httpJson({
    url: `${suite.base}${CALLBACK}/${pushOnly.data?.webhookToken}`,
    method: "POST",
    body: { post_type: "message" },
  });
  assert(
    pushCallback.status === 404,
    "只推送通道的回调 → 404（收不了消息，不会误执行）",
    `status=${pushCallback.status}`,
  );

  // ---------- 8) 编辑：敏感项留空＝沿用已存的值 ----------
  const kept = await call("PUT", `${CHANNELS}/${row.id}`, ACCOUNT, {
    name: "验证·企业微信应用（改名）",
    config: { corpId: "wwverify", agentId: "1000002" },
  });
  assert(
    kept.code === 0 &&
      kept.data?.name === "验证·企业微信应用（改名）" &&
      ["secret", "token", "encodingAesKey"].every((key) =>
        (kept.data?.secretKeys || []).includes(key),
      ),
    "编辑时空着敏感项不会把凭据清空",
    `secretKeys=${(kept.data?.secretKeys || []).join(",")}`,
  );
  const kindChange = await call("PUT", `${CHANNELS}/${row.id}`, ACCOUNT, {
    kind: "wecom_kf",
  });
  assert(
    kindChange.code !== 0 && /不能修改/.test(kindChange.message || ""),
    "通道类型不允许改（要换类型得新建）",
    `code=${kindChange.code} message=${kindChange.message}`,
  );
} finally {
  for (const id of created.channels) {
    await call("DELETE", `${CHANNELS}/${id}`, ACCOUNT).catch(() => undefined);
  }
  if (created.modelChannel) {
    await call(
      "DELETE",
      `/enterprise/content/channels/${created.modelChannel}`,
      ACCOUNT,
    ).catch(() => undefined);
  }
}

const after = await call("GET", CHANNELS, ACCOUNT);
if (after.code === 0) {
  const leaked = (after.data || []).filter((item) =>
    created.channels.includes(item.id),
  );
  assert(leaked.length === 0, "验证数据已清理干净", `残留=${leaked.length}`);
}

const { passed, failed } = suite.counts();
console.log(`\n${suite.summary()}`);
if (failed) process.exitCode = 1;
else console.log(`共 ${passed} 项断言全部通过`);
