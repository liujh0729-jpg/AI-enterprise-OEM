import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnvironment, redact } from './lib/enterprise-environment.mjs';

export function verifyBackup(file, target, now = Date.now()) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const age = now - Date.parse(manifest.createdAt);
  if (!Number.isFinite(age) || age < 0 || age > 24 * 3600_000) throw new Error('迁移前必须提供最近 24 小时的生产备份');
  if (Object.keys(target).some(key => manifest.target?.[key] !== target[key])) throw new Error('备份目标与当前生产库不一致');
  if (!isAbsolute(manifest.archive || '') || (statSync(file).mode & 0o777) !== 0o600
    || (statSync(manifest.archive).mode & 0o777) !== 0o600) throw new Error('备份及清单必须为绝对路径且权限为 600');
  const data = readFileSync(manifest.archive);
  if (!data.length || data.length !== manifest.bytes || createHash('sha256').update(data).digest('hex') !== manifest.sha256) throw new Error('生产备份大小或 SHA-256 校验失败');
  return manifest;
}

export function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    environment: { type: 'string', default: 'production' }, 'env-file': { type: 'string' },
    'backend-dir': { type: 'string' }, 'backup-dir': { type: 'string' }, 'backup-manifest': { type: 'string' }, 'pg-bin': { type: 'string' },
  } });
  const [action = 'check'] = positionals;
  if (positionals.length > 1 || !['check', 'backup', 'migrate'].includes(action)) throw new Error('只支持 check、backup、migrate');
  if (action !== 'check' && values.environment !== 'production') throw new Error('备份和部署迁移入口仅用于生产');
  const backendDir = resolve(values['backend-dir'] || new URL('../backend', import.meta.url).pathname);
  const { env, target, files } = loadEnvironment({ environment: values.environment, backendDir, envFile: values['env-file'] });
  console.log(JSON.stringify({ environment: values.environment, target, files }));
  if (action === 'check') return;
  if (action === 'backup' && (!values['backup-dir'] || !isAbsolute(values['backup-dir']))) throw new Error('必须指定绝对路径 --backup-dir');
  if (action === 'migrate' && !values['backup-manifest']) throw new Error('生产迁移必须指定 --backup-manifest；禁止无备份迁移');
  const verifiedBackup = action === 'migrate' ? verifyBackup(resolve(values['backup-manifest']), target) : null;
  const url = new URL(env.DATABASE_URL);
  const pgEnv = { ...env, PGHOST: target.host, PGPORT: String(target.port), PGDATABASE: target.database,
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c statement_timeout=60000 -c lock_timeout=10000 -c default_transaction_read_only=on' };
  // Never let libpq inherited settings redirect a protected operation.
  for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE']) delete pgEnv[key];
  const tool = name => values['pg-bin'] ? resolve(values['pg-bin'], name) : name;
  const execute = (command, args, options = {}) => {
    const result = spawnSync(command, args, { env: pgEnv, encoding: 'utf8', timeout: 120_000, ...options });
    if (result.error || result.status !== 0) throw new Error(`${command.split('/').at(-1)} 执行失败：${redact(result.stderr || '', env).slice(-2000)}`);
    return result.stdout;
  };
  const identity = JSON.parse(execute(tool('psql'), ['-XAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-c',
    "SELECT json_build_object('database',current_database(),'schema',current_schema(),'role',current_user,'port',inet_server_port());"]));
  if (identity.database !== target.database || identity.schema !== target.schema || identity.role !== 'ae_prod' || identity.port !== 15432) throw new Error('生产数据库实际身份与配置不一致');
  if (action === 'backup') {
    if (!values['backup-dir'] || !isAbsolute(values['backup-dir'])) throw new Error('必须指定绝对路径 --backup-dir');
    mkdirSync(values['backup-dir'], { recursive: true, mode: 0o700 });
    if (statSync(values['backup-dir']).mode & 0o077) throw new Error('备份目录不得允许其他用户访问');
    const archive = resolve(values['backup-dir'], `ae_prod_public_${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID()}.dump`);
    const descriptor = openSync(archive, 'wx', 0o600);
    try { execute(tool('pg_dump'), ['--format=custom', '--schema=public', '--no-password'], { encoding: null, stdio: ['ignore', descriptor, 'pipe'] }); }
    finally { closeSync(descriptor); }
    execute(tool('pg_restore'), ['--list', archive]);
    const data = readFileSync(archive);
    const manifest = { createdAt: new Date().toISOString(), target, archive, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    const file = `${archive}.json`;
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ backupManifest: file, bytes: manifest.bytes, sha256: manifest.sha256 }));
    return;
  }
  execute(tool('pg_restore'), ['--list', verifiedBackup.archive]);
  const result = spawnSync(process.execPath, [resolve(backendDir, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(backendDir, 'prisma/schema.prisma')], {
    cwd: backendDir, env, encoding: 'utf8', timeout: 300_000,
  });
  const output = redact(`${result.stdout || ''}${result.stderr || ''}`, env);
  if (output) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error('生产数据库迁移失败；停止发布，不自动切回开发库');
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try { main(); } catch (error) { console.error(redact(error.message, process.env)); process.exitCode = 1; }
}
