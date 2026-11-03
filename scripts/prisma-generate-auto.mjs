// Prisma Client 生成（方言自适应）：供 backend 的 postinstall 调用。
// 读 backend/.env（或环境变量）里的 DB_PROVIDER / DATABASE_URL 判定当前方言：
//   - PostgreSQL：先由 gen-prisma-schema.mjs 派生 schema.postgres.prisma，再 --schema 生成；
//   - MySQL（默认，含无 .env 的全新克隆）：按默认 schema.prisma 生成。
// 目的：避免 PG 部署在每次 pnpm install 时被默认（MySQL）schema 覆盖客户端而导致启动方言不匹配。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(rootDir, 'backend');
const envFile = resolve(backendDir, '.env');
const prismaBin = resolve(backendDir, 'node_modules/prisma/build/index.js');
const genScript = resolve(rootDir, 'scripts/gen-prisma-schema.mjs');

function readEnvKey(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

function detectProvider() {
  let dbProvider = '';
  let url = '';
  if (existsSync(envFile)) {
    const text = readFileSync(envFile, 'utf8');
    dbProvider = readEnvKey(text, 'DB_PROVIDER');
    url = readEnvKey(text, 'DATABASE_URL');
  }
  // 进程环境变量优先（CI/容器可用 DB_PROVIDER 覆盖）。
  dbProvider = (process.env.DB_PROVIDER || dbProvider).trim().toLowerCase();
  url = process.env.DATABASE_URL || url;
  if (dbProvider === 'postgres' || dbProvider === 'postgresql') return 'postgres';
  if (dbProvider === 'mysql') return 'mysql';
  try {
    const p = new URL(url).protocol;
    if (p === 'mysql:') return 'mysql';
    if (p === 'postgres:' || p === 'postgresql:') return 'postgres';
  } catch {
    /* URL 非法则回落默认 */
  }
  return 'mysql';
}

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaBin, ...args], {
    cwd: backendDir,
    encoding: 'utf8',
    timeout: 600_000,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(out.replace(/(postgres(ql)?|mysql):\/\/\S+/g, '[DATABASE_URL REDACTED]'));
  if (result.status !== 0) {
    process.stderr.write(`prisma ${args.join(' ')} 失败（退出码 ${result.status}）\n`);
    process.exit(result.status ?? 1);
  }
}

const provider = detectProvider();
if (provider === 'postgres') {
  const gen = spawnSync(process.execPath, [genScript], { cwd: backendDir, stdio: 'inherit' });
  if (gen.status !== 0) {
    process.stderr.write('生成 schema.postgres.prisma 失败\n');
    process.exit(gen.status ?? 1);
  }
  runPrisma(['generate', '--schema', 'prisma/schema.postgres.prisma']);
} else {
  runPrisma(['generate']);
}
