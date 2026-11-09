// 本仓库前端体量（53 个页面 / 大量 antd 与 pro-components）在默认约 4GB 的 V8 堆下会 OOM：
// next build、tsc --noEmit 与类型感知的 eslint 都会以退出码 134 失败，因此统一在这里抬高堆上限。
//   - 已显式配置 --max-old-space-size 的 NODE_OPTIONS 原样透传，不覆盖使用者设置；
//   - 需要调整时用 NODE_HEAP_MB（例如 8192）临时覆盖。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 只暴露本包实际用到的入口，避免变成任意命令执行器。
const BINS = {
  next: '../node_modules/next/dist/bin/next',
  tsc: '../node_modules/typescript/bin/tsc',
  eslint: '../node_modules/eslint/bin/eslint.js',
};

const [name, ...args] = process.argv.slice(2);
const target = BINS[name];
if (!target) {
  console.error(`不支持的入口：${name}（可用：${Object.keys(BINS).join('、')}）`);
  process.exit(1);
}

const heapMb = process.env.NODE_HEAP_MB || '10240';
const current = process.env.NODE_OPTIONS || '';
const nodeOptions = /--max-old-space-size=/.test(current)
  ? current
  : `${current} --max-old-space-size=${heapMb}`.trim();

const result = spawnSync(process.execPath, [fileURLToPath(new URL(target, import.meta.url)), ...args], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
process.exit(result.status ?? 1);