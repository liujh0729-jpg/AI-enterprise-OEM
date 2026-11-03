// 一次性清理：Prisma MySQL provider 不支持 mode:'insensitive'（PG 专有）。
// utf8mb4_unicode_ci 排序下 contains 本身不区分大小写，直接删除该属性即可。
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || new URL('../backend/src', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const patterns = [
  // { contains: x, mode: 'insensitive' } / "insensitive" / as const 变体
  /,\s*mode:\s*['"]insensitive['"](\s+as\s+const)?/g,
  // 独立成行或位于开头的 mode: 'insensitive' as const,
  /mode:\s*['"]insensitive['"](\s+as\s+const)?\s*,\s*/g,
  /mode:\s*['"]insensitive['"](\s+as\s+const)?/g,
];
let changed = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.ts')) {
      const text = readFileSync(full, 'utf8');
      let next = text;
      for (const p of patterns) next = next.replace(p, '');
      if (next !== text) {
        writeFileSync(full, next, 'utf8');
        changed += 1;
        console.log(`stripped: ${full}`);
      }
    }
  }
};
walk(root);
console.log(`done, files changed: ${changed}`);
