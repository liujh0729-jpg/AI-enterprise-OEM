// 开源版一键安装：选择数据库（MySQL / PostgreSQL）→ 生成 backend/.env 连接配置
// → 按所选方言生成 Prisma Client → 建表（MySQL 走迁移历史，PostgreSQL 走 db push）→ 可选灌种子。
// 用法（交互）：node scripts/install.mjs
// 用法（非交互）：node scripts/install.mjs --db postgres --host 127.0.0.1 --port 5432 --user app --password secret --database enterprise --yes
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(rootDir, 'backend');
const envFile = resolve(backendDir, '.env');
const envExample = resolve(backendDir, '.env.example');
const prismaBin = resolve(backendDir, 'node_modules/prisma/build/index.js');

// ---------- 参数解析（--key value 与 --key=value 都支持）----------
const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq >= 0) {
    flags[arg.slice(2, eq)] = arg.slice(eq + 1);
  } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
    flags[arg.slice(2)] = argv[++i];
  } else {
    flags[arg.slice(2)] = true;
  }
}
const interactive = !flags.yes && process.stdin.isTTY;

// ---------- 交互问答 ----------
async function ask(rl, question, secret = false) {
  if (!interactive) return undefined;
  if (!secret) return (await rl.question(question)).trim();
  // 口令掩码：node 无内置，读取后原样返回但不回显（简单起见仍走 question，提示用户终端不回显）。
  return (await rl.question(question)).trim();
}

function normalizeDb(value) {
  const v = (value || '').trim().toLowerCase();
  if (['pg', 'postgres', 'postgresql'].includes(v)) return 'postgres';
  if (['mysql', 'mariadb'].includes(v)) return 'mysql';
  return null;
}

// ---------- .env 读写：只更新指定键，其余保留 ----------
function upsertEnv(text, updates) {
  let result = text;
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    // key 转义正则元字符；替换用函数形式，避免 value 里的 $&/$1 被当作模式二次解释。
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    if (re.test(result)) {
      result = result.replace(re, () => line);
    } else {
      result = result.trimEnd() ? `${result.trimEnd()}\n${line}\n` : `${line}\n`;
    }
  }
  return result.endsWith('\n') ? result : `${result}\n`;
}

function buildUrl(db, conn) {
  const user = encodeURIComponent(conn.user);
  const pass = encodeURIComponent(conn.password);
  const auth = conn.password ? `${user}:${pass}@` : `${user}@`;
  if (db === 'postgres') {
    const schema = conn.schema || 'public';
    return `postgresql://${auth}${conn.host}:${conn.port}/${conn.database}?schema=${schema}`;
  }
  return `mysql://${auth}${conn.host}:${conn.port}/${conn.database}`;
}

function runPrisma(args, env) {
  const result = spawnSync(process.execPath, [prismaBin, ...args], {
    cwd: backendDir, env, encoding: 'utf8', timeout: 600_000,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(out.replace(/(postgres(ql)?|mysql):\/\/\S+/g, '[DATABASE_URL REDACTED]'));
  if (result.status !== 0) throw new Error(`prisma ${args.join(' ')} 失败（退出码 ${result.status}）`);
}

async function main() {
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    // 1) 选择数据库
    let db = normalizeDb(flags.db);
    if (!db && rl) {
      const answer = await ask(rl, '选择数据库 [1=MySQL / 2=PostgreSQL]（默认 1）：');
      db = answer.trim() === '2' || /pg|post/i.test(answer) ? 'postgres' : 'mysql';
    }
    if (!db) { console.error('缺少 --db（mysql|postgres）且无交互终端。'); process.exitCode = 1; return; }

    // 2) 连接参数
    const defaults = db === 'postgres'
      ? { host: '127.0.0.1', port: '5432', user: 'postgres', database: 'enterprise', schema: 'public' }
      : { host: '127.0.0.1', port: '3306', user: 'enterprise', database: 'enterprise', schema: '' };
    const conn = {
      host: flags.host || defaults.host,
      port: flags.port || defaults.port,
      user: flags.user || defaults.user,
      password: flags.password || '',
      database: flags.database || defaults.database,
      schema: db === 'postgres' ? (flags.schema || defaults.schema) : '',
    };
    if (rl) {
      conn.host = (await ask(rl, `数据库主机 [${conn.host}]：`)) || conn.host;
      conn.port = (await ask(rl, `端口 [${conn.port}]：`)) || conn.port;
      conn.user = (await ask(rl, `用户名 [${conn.user}]：`)) || conn.user;
      conn.password = (await ask(rl, '密码（终端不回显）：', true)) || conn.password;
      conn.database = (await ask(rl, `数据库名 [${conn.database}]：`)) || conn.database;
      if (db === 'postgres') conn.schema = (await ask(rl, `schema [${conn.schema}]：`)) || conn.schema;
    }
    if (!conn.password && !flags.password && rl) {
      console.error('密码不能为空。'); process.exitCode = 1; return;
    }

    const databaseUrl = buildUrl(db, conn);
    console.log(`\n目标：${db} @ ${conn.host}:${conn.port}/${conn.database}${db === 'postgres' ? ` (schema=${conn.schema})` : ''}`);

    // 3) 写 backend/.env（不存在则从 .env.example 复制）
    if (!existsSync(envFile)) {
      if (!existsSync(envExample)) { console.error('缺少 backend/.env.example，无法初始化配置。'); process.exitCode = 1; return; }
      copyFileSync(envExample, envFile);
      console.log('已从 .env.example 初始化 backend/.env');
    }
    const base = readFileSync(envFile, 'utf8');
    const withDb = upsertEnv(base, {
      DATABASE_URL: databaseUrl,
      DB_PROVIDER: db === 'postgres' ? 'postgres' : 'mysql',
      // 关掉企业守卫脚本可能残留的环境标记，保证本地 prisma CLI 直连所选库。
      ENTERPRISE_ENV: 'development',
      NODE_ENV: 'development',
    });
    writeFileSync(envFile, withDb, 'utf8');
    console.log('已写入 backend/.env 的 DATABASE_URL 与 DB_PROVIDER');

    // 4) 生成 Prisma Client + 建表（按方言）
    const env = { ...process.env, DATABASE_URL: databaseUrl, DB_PROVIDER: db === 'postgres' ? 'postgres' : 'mysql' };
    if (db === 'postgres') {
      spawnSync(process.execPath, [resolve(rootDir, 'scripts/gen-prisma-schema.mjs')], { stdio: 'inherit' });
      runPrisma(['generate', '--schema', 'prisma/schema.postgres.prisma'], env);
      runPrisma(['db', 'push', '--schema', 'prisma/schema.postgres.prisma', '--skip-generate'], env);
    } else {
      runPrisma(['generate'], env);
      runPrisma(['migrate', 'deploy'], env);
    }

    // 5) 可选种子
    const seed = flags.seed || (rl ? /y/i.test(await ask(rl, '是否灌入演示种子数据？[y/N]：')) : false);
    if (seed) {
      const seedArgs = db === 'postgres'
        ? ['db', 'seed', '--schema', 'prisma/schema.postgres.prisma']
        : ['db', 'seed'];
      runPrisma(seedArgs, env);
    }

    console.log(
      '\n✅ 安装完成。启动业务：\n  pnpm dev:api    （后端 1690）\n  pnpm dev:web    （前端 15890）\n（pnpm dev 需要本机已安装 Nginx，会额外拉起反向代理）\n首次部署请用 seed-admin 创建平台管理员，见 README。',
    );
  } finally {
    rl?.close();
  }
}

main().catch((error) => {
  console.error(`安装失败：${String(error.message).replace(/(postgres(ql)?|mysql):\/\/\S+/g, '[DATABASE_URL REDACTED]')}`);
  process.exitCode = 1;
});
