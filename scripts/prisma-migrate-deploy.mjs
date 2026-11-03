import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { loadEnvironment, redact } from './lib/enterprise-environment.mjs';

// `new URL(...).pathname` yields `/E:/...` on Windows and `resolve()` turns it into `E:\E:\...`.
const backendDir = resolve(fileURLToPath(new URL('../backend', import.meta.url)));
try {
  let env;
  if (process.env.ISOLATED_TEST === '1') {
    const database = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1' || database.port !== '5432'
      || !/^\/(?:enterprise_migration_\d+_\d+|aipdd_enterprise_geo_test_[a-zA-Z0-9_]+)$/.test(database.pathname)
      || ['host', 'hostaddr', 'port', 'user', 'password', 'dbname', 'options'].some(key => database.searchParams.has(key))
      || (database.searchParams.has('schema') && (database.searchParams.getAll('schema').length !== 1 || database.searchParams.get('schema') !== 'public'))) {
      throw new Error('隔离迁移只允许本机专用一次性测试库');
    }
    env = process.env;
  } else {
    const base = resolve(backendDir, '.env');
    const marker = existsSync(base) ? parseEnv(readFileSync(base, 'utf8')) : {};
    if (process.env.NODE_ENV === 'production' || process.env.ENTERPRISE_ENV === 'production' || marker.ENTERPRISE_ENV === 'production') {
      throw new Error('生产迁移必须使用 pnpm production:migrate，并指定生产环境文件和生产备份清单');
    }
    env = loadEnvironment({ environment: 'development', backendDir }).env;
  }
  const result = spawnSync(process.execPath, [resolve(backendDir, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: backendDir, env, encoding: 'utf8', timeout: 300_000,
  });
  process.stdout.write(redact(`${result.stdout || ''}${result.stderr || ''}`, env));
  process.exitCode = result.error ? 1 : result.status ?? 1;
} catch (error) {
  console.error(redact(error.message, process.env)); process.exitCode = 1;
}
