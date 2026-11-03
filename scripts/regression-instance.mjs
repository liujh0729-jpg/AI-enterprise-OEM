/**
 * 起一个临时后端实例，两种模式二选一（Tier 3 · 通道隔离；配套护栏见 scripts/regression-guard.mjs）：
 *   默认           —— AIworkin 通道强制关闭，用于跑本地口径回归（监听 1693）；
 *   --live-platform —— AIworkin 通道打开并指向正式平台，用于通道实测（默认监听 1694）。
 *
 * 为什么要它：回归套件写的是真实业务表，通道打开时发布会同步到 AIworkin 正式平台，
 * 跑一轮测试＝往正式环境灌一轮测试数据；而 1690 是用户日常在用的实例，不能为了跑测试
 * 去改它的 env 或重启它。所以另起一个进程，只在进程内覆盖 AIWORKIN_ENABLED/AIWORKIN_BASE_URL
 * （main.ts 读 process.env.PORT/env 优先于 backend/.env，不需要动 .env）。
 * 数据库边界：本脚本不创建隔离库。未提供进程环境 DATABASE_URL 时，仍会读取
 * backend/.env 并连接远端 ae_test.public；禁止在该保留业务数据的库运行完整回归。
 * 以下用法均以已通过本机私有配置设置专用本机隔离库为前提，且实例与测试脚本必须
 * 使用同一数据库。不要把含凭据的完整连接串写到命令行、日志或共享文档。
 * 关闭 AIworkin 通道不会关闭 GEO、企享云或 OSS 等独立外部能力。
 * 套件侧的护栏在 scripts/regression-guard.mjs：本地口径套件启动时会复查通道确实关着，
 * 通道实测套件（verify-smart-service / verify-aiworkin-production-supply /
 * verify-market-board-direct）反过来要求通道打开。
 *
 * 用法：
 *   node scripts/regression-instance.mjs                      # 前台常驻，打印 BASE_URL，Ctrl+C 收掉
 *   node scripts/regression-instance.mjs -- node scripts/e2e-test.mjs   # 起实例→跑命令→收实例
 *   node scripts/regression-instance.mjs --port=1694 -- node scripts/verify-demand-conversations.mjs
 *   # 通道实测（真写 AIworkin 正式平台）：把「关通道」换成「开通道并指向正式平台」
 *   node scripts/regression-instance.mjs --live-platform -- node scripts/verify-aiworkin-production-supply.mjs
 *
 * 选项：
 *   --port=1693       监听端口（端口被占用直接报错退出，不复用别人的实例）
 *   --live-platform   通道打开并打 AIWORKIN_BASE_URL（默认 https://api.aiworkin.com），
 *                     未显式给 --port 时监听 1694；自检改成「通道确实开着」
 *   --no-build         跳过 tsc build（默认先构建，保证跑的是当前源码）
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REGRESSION_PORT } from "./harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(root, "backend");
/** 「平台直连」套件（真写 AIworkin 正式平台）的默认端口。
 * 2026-09-26 从 1692 改为 1694：1692 已被本机另一个服务（aiworkin-sns）占用。 */
const LIVE_PLATFORM_PORT = 1694;

function parseArgs(argv) {
  const options = {
    port: REGRESSION_PORT,
    portExplicit: false,
    build: true,
    command: [],
    livePlatform: false,
  };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--") {
      options.command = rest;
      break;
    }
    if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
      options.portExplicit = true;
    } else if (arg === "--no-build") {
      options.build = false;
    } else if (arg === "--live-platform") {
      options.livePlatform = true;
    } else {
      throw new Error(`未知参数：${arg}（见脚本头部用法）`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1024) {
    throw new Error(`端口不合法：${options.port}`);
  }
  return options;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(true));
  });
}

function build() {
  console.log("构建后端（tsc build）…");
  const result = spawnSync(
    process.execPath,
    [join(backend, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
    { cwd: backend, encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error("tsc build 失败，未启动隔离实例");
  }
}

async function waitForInstance(port, server, logFile) {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode) {
      throw new Error(
        `实例进程已退出（code=${server.exitCode}），详见 ${logFile}`,
      );
    }
    try {
      const res = await fetch(`${base}/health`);
      const payload = await res.json();
      if (payload?.code === 0) return base;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`实例 60s 内未就绪，详见 ${logFile}`);
}

/** 自检：确认这个实例真的把通道关了，别把「以为隔离了」当成隔离。 */
async function assertIsolated(base, port) {
  const payload = await (await fetch(`${base}/health/version`)).json();
  if (payload?.data?.aiworkin_enabled !== false) {
    throw new Error(
      `端口 ${port} 的实例自检失败：aiworkin_enabled=${JSON.stringify(
        payload?.data?.aiworkin_enabled,
      )}，期望 false（见 ${base}/health/version）`,
    );
  }
  // 数据库没连上时，套件会在第一个断言处报一堆「Can't reach database server」，
  // 看起来像代码回归失败；启动时就把它拦下来。
  const ready = await (await fetch(`${base}/health/ready`)).json();
  if (ready?.data?.checks?.database !== "up") {
    throw new Error(
      `端口 ${port} 的实例连不上数据库（/health/ready → ${JSON.stringify(
        ready?.data?.checks,
      )}）。先确认 PostgreSQL 在跑、并收掉其他占用连接数的实例。`,
    );
  }
}

/**
 * 自检「平台直连」实例：通道必须打开、且 base URL 真的是要打的那个平台。
 * （`--live-platform` 起的实例会真写 AIworkin 正式平台，端口 1694 是这套约定的默认值）
 */
async function assertLivePlatform(base, port, platformUrl) {
  const payload = await (await fetch(`${base}/health/version`)).json();
  if (payload?.data?.aiworkin_enabled !== true) {
    throw new Error(
      `端口 ${port} 的实例自检失败：aiworkin_enabled=${JSON.stringify(
        payload?.data?.aiworkin_enabled,
      )}，期望 true（--live-platform 需要通道打开）`,
    );
  }
  const ready = await (await fetch(`${base}/health/ready`)).json();
  if (ready?.data?.checks?.database !== "up") {
    throw new Error(
      `端口 ${port} 的实例连不上数据库（/health/ready → ${JSON.stringify(
        ready?.data?.checks,
      )}）。先确认 PostgreSQL 在跑、并收掉其他占用连接数的实例。`,
    );
  }
  console.log(`平台直连实例自检通过：通道已打开，套件将真实调用 ${platformUrl}`);
}

const {
  port: requestedPort,
  portExplicit,
  build: shouldBuild,
  command,
  livePlatform,
} = parseArgs(process.argv.slice(2));
// 平台直连套件默认独占 1694（1690 是日常实例、1693 是本地口径回归实例）
const platformUrl = (
  process.env.AIWORKIN_BASE_URL || "https://api.aiworkin.com"
).replace(/\/$/, "");
const port =
  livePlatform && !portExplicit ? LIVE_PLATFORM_PORT : requestedPort;
const base = `http://127.0.0.1:${port}`;
const logDir = process.env.REGRESSION_LOG_DIR || join(root, ".tmp");
mkdirSync(logDir, { recursive: true, mode: 0o700 });
const logFile = join(logDir, `.regression-${port}.log`);

if (!(await isPortFree(port))) {
  console.error(
    `端口 ${port} 已有进程监听。隔离实例必须独占一个端口，` +
      `否则会拿别人的实例当自己的（先收掉它，或换 --port=${port + 1}）。`,
  );
  process.exit(1);
}
if (!existsSync(join(backend, "generated/prisma"))) {
  console.error("缺少 backend/generated/prisma，先在 backend 目录执行 prisma generate");
  process.exit(1);
}
if (shouldBuild) build();

const server = spawn(
  process.execPath,
  ["dist/main"],
  {
    cwd: backend,
    env: {
      ...process.env,
      AIWORKIN_ENABLED: livePlatform ? "true" : "false",
      AIWORKIN_REQUIRED: "false",
      ...(livePlatform ? { AIWORKIN_BASE_URL: platformUrl } : {}),
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const capture = (stream, label) =>
  stream.on("data", (chunk) =>
    appendFileSync(logFile, `[${label}] ${chunk}`),
  );
capture(server.stdout, "out");
capture(server.stderr, "err");

let shuttingDown = false;
function stopServer() {
  if (shuttingDown || server.exitCode !== null) return;
  shuttingDown = true;
  server.kill();
}
process.on("SIGINT", stopServer);
process.on("SIGTERM", stopServer);

let status = 0;
try {
  await waitForInstance(port, server, logFile);
  if (livePlatform) await assertLivePlatform(base, port, platformUrl);
  else await assertIsolated(base, port);
  console.log(
    livePlatform
      ? `平台直连实例已就绪：${base}（AIWORKIN_ENABLED=true → ${platformUrl}，日志 ${logFile}）`
      : `隔离实例已就绪：${base}（AIWORKIN_ENABLED=false，日志 ${logFile}）`,
  );
  if (command.length) {
    console.log(`$ BASE_URL=${base} ${command.join(" ")}`);
    const run = spawnSync(command[0], command.slice(1), {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, BASE_URL: base },
    });
    status = run.status ?? 1;
    if (run.error) throw run.error;
  } else {
    console.log("前台常驻中，Ctrl+C 收掉实例。跑套件：");
    console.log(`  BASE_URL=${base} node scripts/e2e-test.mjs`);
    await new Promise((resolve) => {
      const tick = () =>
        server.exitCode !== null || shuttingDown ? resolve() : setTimeout(tick, 200);
      tick();
    });
  }
} catch (error) {
  console.error(error.message);
  status = 1;
} finally {
  stopServer();
  server.once("exit", () => process.exit(status));
  setTimeout(() => process.exit(status), 3_000).unref();
}
