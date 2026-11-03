// 只在本机一次性空库中验证身份快照 SQL；不读取 backend/.env，不访问上游。
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = join(dirname(fileURLToPath(import.meta.url)), '../backend');
const database = `aipdd_enterprise_identity_test_${process.pid}_${Date.now()}`;
const url = new URL('postgresql://127.0.0.1:5432');
url.username = process.env.PGUSER || userInfo().username;
if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
url.pathname = `/${database}`;
url.searchParams.set('schema', 'public');
const env = { ...process.env, DATABASE_URL: url.href, IDENTITY_SNAPSHOT_TEST_DATABASE_URL: url.href, ISOLATED_TEST: '1', TZ: 'Asia/Shanghai' };

function run(command, args) {
  const result = spawnSync(command, args, { cwd: backend, env, encoding: 'utf8' });
  for (let output of [result.stdout, result.stderr]) {
    if (!output) continue;
    output = output.replaceAll(url.href, '[isolated local database]');
    if (process.env.PGPASSWORD) output = output.replaceAll(process.env.PGPASSWORD, '[redacted]');
    process.stdout.write(output);
  }
  if (result.error || result.status !== 0) throw new Error(`${command} 执行失败`);
}

let created = false;
try {
  run('createdb', ['-h', '127.0.0.1', '-p', '5432', database]);
  created = true;
  run('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate']);
  run('pnpm', ['exec', 'jest', '--config', './test/jest-unit.json', '--runInBand', '--runTestsByPath', 'src/identity/identity-snapshot.database.spec.ts']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      run('dropdb', ['-h', '127.0.0.1', '-p', '5432', database]);
      console.log('身份快照测试隔离库已清理');
    } catch {
      console.error(`请清理本机测试库 ${database}`);
      process.exitCode = 1;
    }
  }
}
