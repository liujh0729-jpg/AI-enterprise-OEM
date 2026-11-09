#!/usr/bin/env node
/**
 * 设备通道模拟器：在没有真机时验证「心跳 → 指令 → 回执」整条链路。
 * 用 Node 18+（自带 fetch），零依赖。
 *
 * 用法（先把一台设备的 hw_ 令牌准备好）：
 *   HW_BASE_URL=https://your-site.example.com \
 *   HW_DEVICE_TOKEN=hw_xxx \
 *   node simulate_device.mjs
 *
 * 环境变量：
 *   HW_BASE_URL         平台地址（必填），如 https://your-site.example.com
 *   HW_DEVICE_TOKEN     设备令牌 hw_...（必填）
 *   HW_FIRMWARE         固件版本（可选，默认 simulator-1.0.0）
 *   HW_INTERVAL         心跳间隔秒（可选，默认 15）
 *   HW_REPORT_BASE_URL  可选：本模拟器若同时开 HTTP 工具服务，填其对外地址
 */

const BASE = (process.env.HW_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.HW_DEVICE_TOKEN || "";
const FIRMWARE = process.env.HW_FIRMWARE || "simulator-1.0.0";
const INTERVAL = Math.max(5, Number(process.env.HW_INTERVAL || 15));
const REPORT_BASE_URL = process.env.HW_REPORT_BASE_URL || "";

if (!BASE || !TOKEN) {
  console.error("缺少环境变量：HW_BASE_URL 和 HW_DEVICE_TOKEN 必填");
  process.exit(1);
}
if (!TOKEN.startsWith("hw_")) {
  console.error("HW_DEVICE_TOKEN 应以 hw_ 开头（这是设备令牌，不是 ek_ API Key）");
  process.exit(1);
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-token": TOKEN },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}

async function heartbeat() {
  const meta = REPORT_BASE_URL ? { baseUrl: REPORT_BASE_URL } : {};
  const data = await post("/api/public/hardware/heartbeat", { firmwareVersion: FIRMWARE, meta });
  return Array.isArray(data.commands) ? data.commands : [];
}

async function reportResult(commandCode, ok, message = "", response = undefined) {
  const body = { commandCode, ok, message };
  if (response !== undefined) body.response = response;
  await post("/api/public/hardware/result", body);
}

async function handleCommand(cmd) {
  console.log(`  ↳ 指令 ${cmd.toolCommandCode}（命令号 ${cmd.commandCode}）args=${JSON.stringify(cmd.args || {})}`);
  let response;
  if (/STATUS|READ/i.test(cmd.toolCommandCode || "")) {
    response = { simulated: true, uptimeMs: Math.round(process.uptime() * 1000) };
  } else {
    response = { echo: cmd.args || {} };
  }
  await reportResult(cmd.commandCode, true, "", response);
}

let running = true;
process.on("SIGINT", () => {
  running = false;
  console.log("\n已退出模拟器");
  process.exit(0);
});

async function main() {
  console.log(`模拟设备上线：${BASE}（间隔 ${INTERVAL}s，固件 ${FIRMWARE}）`);
  while (running) {
    try {
      const commands = await heartbeat();
      for (const cmd of commands) {
        try {
          await handleCommand(cmd);
        } catch (cause) {
          console.error("  处理失败：", cause instanceof Error ? cause.message : cause);
          await reportResult(cmd.commandCode, false, String(cause?.message || cause).slice(0, 200));
        }
      }
    } catch (cause) {
      console.error("心跳失败：", cause instanceof Error ? cause.message : cause);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL * 1000));
  }
}

void main();
