/**
 * 内容创作 · 模型渠道预设（OpenAI / Claude / DeepSeek …）：接口层实测。
 *
 * 口径：
 * - 打开发实例 1690；只看本系统行为，外部渠道用一个假 Key 探到「上游拒绝」为止。
 * - 新增的渠道与改动的默认模型槽位结束时全部还原，账号回到初始状态。
 * - Claude 走 Anthropic 原生协议（/messages + x-api-key），因此文档、图片等
 *   不支持的能力必须当场被中文拒掉，而不是留给用户去猜 404。
 *
 * 用法：node scripts/verify-content-channel-presets.mjs [BASE_URL]
 */
import { createSuite } from "./harness.mjs";

const suite = createSuite({ base: process.argv[2] || "http://127.0.0.1:1690" });
const { call, assert } = suite;

const ACCOUNT = "demo_agent";
const CHANNEL_PATH = "/enterprise/content/channels";
const FAKE_KEY = "sk-preset-verify-not-a-real-key";

console.log(`目标实例：${suite.base}`);
console.log(`测试主体：${ACCOUNT}`);

const before = await call("GET", "/enterprise/content/settings", ACCOUNT);
assert(before.code === 0, "初始读取模型设置成功", `code=${before.code} message=${before.message}`);
const initialImageSlot = (before.data?.slots || []).find((slot) => slot.mediaType === "image");
const created = [];

async function saveChannel(payload) {
  const res = await call("POST", CHANNEL_PATH, ACCOUNT, payload);
  if (res.code === 0 && res.data?.id) created.push(res.data.id);
  return res;
}

try {
  // ---------- 1) AIPDD 是内置渠道，本身也带 preset 标识 ----------
  const aipdd = (before.data?.channels || []).find((channel) => channel.id === 0);
  assert(aipdd?.provider === "aipdd", "内置 AIPDD 渠道存在");
  assert(aipdd?.preset === "aipdd", "内置 AIPDD 渠道 preset=aipdd");
  assert(
    (before.data?.channels || []).every((channel) => typeof channel.preset === "string"),
    "所有渠道都回带 preset 字段",
  );

  // ---------- 2) 预设决定默认地址与默认名称 ----------
  const deepseek = await saveChannel({ provider: "custom", preset: "deepseek", apiKey: FAKE_KEY });
  assert(deepseek.code === 0, "新增 DeepSeek 预设渠道成功", `code=${deepseek.code} message=${deepseek.message}`);
  assert(deepseek.data?.preset === "deepseek", "DeepSeek 渠道 preset 回显");
  assert(deepseek.data?.baseUrl === "https://api.deepseek.com/v1", "DeepSeek 默认地址", `baseUrl=${deepseek.data?.baseUrl}`);
  assert(deepseek.data?.name === "DeepSeek", "DeepSeek 默认渠道名", `name=${deepseek.data?.name}`);
  assert(
    Boolean(deepseek.data?.keyMasked) && deepseek.data?.keyMasked !== FAKE_KEY,
    "Key 只回掩码，不回明文",
    `keyMasked=${deepseek.data?.keyMasked}`,
  );

  const anthropic = await saveChannel({ provider: "custom", preset: "anthropic", apiKey: FAKE_KEY });
  assert(anthropic.code === 0, "新增 Claude（Anthropic）预设渠道成功", `code=${anthropic.code} message=${anthropic.message}`);
  assert(anthropic.data?.preset === "anthropic", "Claude 渠道 preset 回显");
  assert(anthropic.data?.baseUrl === "https://api.anthropic.com/v1", "Claude 默认地址", `baseUrl=${anthropic.data?.baseUrl}`);
  assert(anthropic.data?.name === "Claude（Anthropic）", "Claude 默认渠道名", `name=${anthropic.data?.name}`);

  // MiniMax 海外站与国内站 Key 不通用，是两条独立预设
  const minimax = await saveChannel({ provider: "custom", preset: "minimax", apiKey: FAKE_KEY });
  assert(minimax.code === 0, "新增 MiniMax（海外）预设渠道成功", `code=${minimax.code} message=${minimax.message}`);
  assert(minimax.data?.baseUrl === "https://api.minimax.io/v1", "MiniMax 海外默认地址", `baseUrl=${minimax.data?.baseUrl}`);
  assert(minimax.data?.name === "MiniMax（海外）", "MiniMax 海外默认渠道名", `name=${minimax.data?.name}`);

  const minimaxCn = await saveChannel({ provider: "custom", preset: "minimax_cn", apiKey: FAKE_KEY });
  assert(minimaxCn.code === 0, "新增 MiniMax（国内）预设渠道成功", `code=${minimaxCn.code} message=${minimaxCn.message}`);
  assert(minimaxCn.data?.baseUrl === "https://api.minimax.cn/v1", "MiniMax 国内默认地址", `baseUrl=${minimaxCn.data?.baseUrl}`);
  assert(minimaxCn.data?.name === "MiniMax（国内）", "MiniMax 国内默认渠道名", `name=${minimaxCn.data?.name}`);

  const siliconflow = await saveChannel({ provider: "custom", preset: "siliconflow", apiKey: FAKE_KEY });
  assert(siliconflow.code === 0, "新增硅基流动预设渠道成功", `code=${siliconflow.code} message=${siliconflow.message}`);
  assert(
    siliconflow.data?.baseUrl === "https://api.siliconflow.cn/v1",
    "硅基流动默认地址",
    `baseUrl=${siliconflow.data?.baseUrl}`,
  );

  // ---------- 3) 自定义：显式地址优先；未知预设被拒 ----------
  const custom = await saveChannel({
    provider: "custom",
    preset: "custom",
    name: "公司网关",
    baseUrl: "https://newapi.example.com/v1",
    apiKey: FAKE_KEY,
  });
  assert(custom.code === 0, "新增自定义渠道成功", `code=${custom.code} message=${custom.message}`);
  assert(custom.data?.baseUrl === "https://newapi.example.com/v1", "自定义渠道保留手填地址");
  assert(custom.data?.preset === "custom", "自定义渠道 preset=custom");

  const badPreset = await call("POST", CHANNEL_PATH, ACCOUNT, {
    provider: "custom",
    preset: "not-a-preset",
    apiKey: FAKE_KEY,
  });
  assert(badPreset.code !== 0, "未知预设被拒", `code=${badPreset.code} message=${badPreset.message}`);

  // ---------- 4) 保存后重读：预设与渠道都在 ----------
  const after = await call("GET", "/enterprise/content/settings", ACCOUNT);
  const presets = (after.data?.channels || []).map((channel) => `${channel.preset}:${channel.baseUrl}`);
  assert(presets.includes("deepseek:https://api.deepseek.com/v1"), "重读 DeepSeek 渠道预设");
  assert(presets.includes("anthropic:https://api.anthropic.com/v1"), "重读 Claude 渠道预设");
  assert(presets.includes("minimax:https://api.minimax.io/v1"), "重读 MiniMax 海外渠道预设");
  assert(presets.includes("minimax_cn:https://api.minimax.cn/v1"), "重读 MiniMax 国内渠道预设");

  // ---------- 5) Claude 渠道按 Anthropic 协议探活：错 Key 如实报上游拒绝 ----------
  const probe = await call("POST", `${CHANNEL_PATH}/test`, ACCOUNT, {
    id: anthropic.data?.id,
    provider: "custom",
  });
  assert(probe.code !== 0, "Claude 渠道错 Key 探活失败", `code=${probe.code}`);
  assert(
    /拉取模型列表失败|上游返回 HTTP/.test(String(probe.message || "")),
    "Claude 探活报上游拒绝（不伪装成本地 401）",
    `message=${probe.message}`,
  );

  // ---------- 6) Claude 渠道不能接图片/视频/语音：当场中文拒掉 ----------
  const slots = (before.data?.slots || []).map((slot) =>
    slot.mediaType === "image"
      ? { mediaType: "image", channelId: anthropic.data?.id, model: "claude-sonnet-4-5" }
      : { mediaType: slot.mediaType, channelId: slot.channelId, model: slot.model },
  );
  const assigned = await call("PUT", "/enterprise/content/settings", ACCOUNT, { slots });
  assert(assigned.code === 0, "把「图像」默认模型指到 Claude 渠道（用于验证拒收）", `code=${assigned.code} message=${assigned.message}`);
  const job = await call("POST", "/enterprise/content/jobs", ACCOUNT, {
    tool: "image",
    input: { prompt: "张图" },
  });
  assert(job.code !== 0, "Claude 渠道不接图片任务", `code=${job.code}`);
  assert(
    /不能用 Claude（Anthropic）渠道/.test(String(job.message || "")),
    "拒收文案指明 Claude 渠道只提供文本与视觉",
    `message=${job.message}`,
  );
} finally {
  // ---------- 清理：槽位还原 + 删除本次新建渠道 ----------
  const slots = (before.data?.slots || []).map((slot) =>
    slot.mediaType === "image"
      ? { mediaType: "image", channelId: initialImageSlot?.channelId || 0, model: initialImageSlot?.model || "" }
      : { mediaType: slot.mediaType, channelId: slot.channelId, model: slot.model },
  );
  const restored = await call("PUT", "/enterprise/content/settings", ACCOUNT, { slots });
  assert(restored.code === 0, "清理：默认模型槽位还原", `code=${restored.code}`);
  for (const id of created) {
    const removed = await call("DELETE", `${CHANNEL_PATH}/${id}`, ACCOUNT);
    assert(removed.code === 0, `清理：删除渠道 #${id}`, `code=${removed.code} message=${removed.message}`);
  }
  const final = await call("GET", "/enterprise/content/settings", ACCOUNT);
  const left = (final.data?.channels || []).filter((channel) => created.includes(channel.id));
  assert(left.length === 0, "清理：本次新建渠道全部删除", `left=${left.map((item) => item.id).join(",")}`);
}

console.log(suite.summary());
if (suite.counts().failed) process.exit(1);