// next build 在本仓库的页面规模下，默认的 V8 堆上限（约 4GB）会在编译完成后 OOM，
// 构建 worker 以退出码 134 结束。这里统一抬高上限：
//   - 已显式配置 --max-old-space-size 的 NODE_OPTIONS 原样透传，不覆盖使用者的设置；
//   - 需要调整时用 NEXT_BUILD_HEAP_MB（例如 8192）临时覆盖。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nextBin = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const heapMb = process.env.NEXT_BUILD_HEAP_MB || '6144';
const current = process.env.NODE_OPTIONS || '';
const nodeOptions = /--max-old-space-size=/.test(current)
  ? current
  : `${current} --max-old-space-size=${heapMb}`.trim();

const result = spawnSync(process.execPath, [nextBin, 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
process.exit(result.status ?? 1);