/**
 * 回归护栏（Tier 3 · 通道隔离）。
 *
 * 两套脚本在各自配置的测试主体和专用隔离库上运行，走的是两条互斥的代码路径：
 *   - 本地口径套件（需求/消息/门控/筛选）要求 AIworkin 通道**关闭**，
 *     否则发布会真写到正式平台，跑一次回归就污染一次线上；
 *   - 平台通道实测套件（服务发布同步等）要求通道**打开**。
 * 打错实例不会报错，只会给出假绿或假红，所以每个套件启动前先问一次实例。
 *
 * 实例侧口径来自 `GET /health/version` 的 `aiworkin_enabled`（见 health.controller.ts）。
 * 本护栏只检查 AIworkin 通道，不检查数据库目标，也不拦截 GEO、企享云或 OSS 调用。
 * 启动前必须通过本机私有配置显式指定专用本机隔离库，禁止继承远端 ae_test.public 跑完整回归。
 * 起隔离实例：`node scripts/regression-instance.mjs`。
 * 确实要在通道打开的实例上跑本地套件时，显式 `ALLOW_LIVE_CHANNEL=1`（不留静默默认值）。
 */
import { LIVE_PORT, REGRESSION_PORT } from "./harness.mjs";

async function versionEnvelope(base) {
  let res;
  try {
    res = await fetch(`${base}/health/version`);
  } catch (error) {
    throw new Error(
      `护栏检查失败：${base} 未响应 /health/version（${error.message}）。\n` +
        `先在另一个终端起隔离实例：node scripts/regression-instance.mjs，` +
        `或用 BASE_URL 指到已在跑的实例。`,
    );
  }
  const payload = await res.json().catch(() => null);
  if (!payload?.data || typeof payload.data.aiworkin_enabled !== "boolean") {
    throw new Error(
      `护栏检查失败：${base}/health/version 未返回 aiworkin_enabled。` +
        `该实例跑的是旧构建代码，请重新 nest build 后再起实例。`,
    );
  }
  return payload.data;
}

/** 本地口径套件用：要求实例通道关闭。 */
export async function assertChannelOff(base) {
  if (process.env.ALLOW_LIVE_CHANNEL === "1") {
    console.log(
      `护栏已放行（ALLOW_LIVE_CHANNEL=1）：${base} 的 AIworkin 通道可能在写真实平台。`,
    );
    return;
  }
  const data = await versionEnvelope(base);
  if (data.aiworkin_enabled) {
    throw new Error(
      `护栏拦截：${base} 的 AIworkin 通道是打开的，本套件会真写正式平台。\n` +
        `请改用隔离实例：node scripts/regression-instance.mjs --port=${REGRESSION_PORT}\n` +
        `然后 BASE_URL=http://127.0.0.1:${REGRESSION_PORT} node <本脚本>；` +
        `确认要在活通道实例上跑就显式加 ALLOW_LIVE_CHANNEL=1。`,
    );
  }
}

/** 通道实测套件用：要求实例通道打开。 */
export async function assertChannelOn(base) {
  const data = await versionEnvelope(base);
  if (!data.aiworkin_enabled) {
    throw new Error(
      `护栏拦截：${base} 的 AIworkin 通道是关闭的，本套件必须真实调用平台。\n` +
        `请起通道实测隔离实例：node scripts/regression-instance.mjs --live-platform --port=${LIVE_PORT}\n` +
        `然后 BASE_URL=http://127.0.0.1:${LIVE_PORT} node <本脚本>；` +
        `不要把本套件指到 1690（用户日常实例，回归数据会经它写进正式平台）。`,
    );
  }
}
