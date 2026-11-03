import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const targetHost = '8.219.81.18';

export function databaseTarget(value, environment) {
  let url;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL 无效；不输出连接串'); }
  const database = environment === 'production' ? 'ae_prod' : 'ae_test';
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname !== targetHost || url.port !== '15432'
    || url.pathname !== `/${database}` || decodeURIComponent(url.username) !== database
    || url.searchParams.getAll('schema').length !== 1 || url.searchParams.get('schema') !== 'public') {
    throw new Error(`${environment} 只允许连接 ${targetHost}:15432/${database} 的 public schema 和专用账号`);
  }
  if (!url.password || /^(?:change-me|replace[-_])/i.test(decodeURIComponent(url.password))) {
    throw new Error('数据库密码未配置或仍为示例占位值');
  }
  if (['host', 'hostaddr', 'port', 'user', 'password', 'dbname', 'options'].some(key => url.searchParams.has(key))) {
    throw new Error('DATABASE_URL 不允许通过查询参数覆盖数据库目标或连接选项');
  }
  return { host: targetHost, port: 15432, database, schema: 'public' };
}

export function loadEnvironment({ environment, backendDir, envFile, inherited = process.env }) {
  if (!['development', 'production'].includes(environment)) throw new Error('必须明确选择 development 或 production');
  const production = environment === 'production';
  const candidates = production
    ? ['.env.production.local', '.env.production']
    : ['.env.development.local', '.env.development', '.env.local', '.env'];
  const selected = envFile ? [resolve(envFile)] : candidates.map(name => resolve(backendDir, name)).filter(existsSync);
  if (!selected.length) throw new Error('缺少所选环境文件；生产禁止回退到开发 .env');
  let fileValues = {};
  for (const file of selected) {
    if (production && (statSync(file).mode & 0o777) !== 0o600) throw new Error('生产环境文件权限必须为 600');
    fileValues = { ...parseEnv(readFileSync(file, 'utf8')), ...fileValues };
  }
  if (fileValues.ENTERPRISE_ENV !== environment) throw new Error('ENTERPRISE_ENV 与所选环境不一致');
  if (fileValues.NODE_ENV && fileValues.NODE_ENV !== environment) throw new Error('环境文件 NODE_ENV 与所选环境不一致');
  if (inherited.ENTERPRISE_ENV && inherited.ENTERPRISE_ENV !== environment) throw new Error('进程 ENTERPRISE_ENV 与所选环境不一致');
  if (production && inherited.DATABASE_URL && inherited.DATABASE_URL !== fileValues.DATABASE_URL) {
    throw new Error('进程 DATABASE_URL 与生产环境文件不同，拒绝隐藏覆盖');
  }
  const env = { ...fileValues, ...inherited, NODE_ENV: environment, ENTERPRISE_ENV: environment };
  const target = databaseTarget(env.DATABASE_URL, environment);
  if (production) {
    if (env.DEV_AUTO_LOGIN !== 'false') throw new Error('生产必须显式配置 DEV_AUTO_LOGIN=false');
    for (const key of ['JWT_SECRET', 'EXTERNAL_CRED_KEY']) {
      if (!env[key]?.trim() || /^REPLACE_/i.test(env[key])) throw new Error(`${key} 缺失或仍为生产模板占位值`);
      if (inherited[key] && fileValues[key] && inherited[key] !== fileValues[key]) throw new Error(`${key} 存在隐藏的进程覆盖`);
    }
    // The deployed application's dotenv order must resolve to this same target.
    for (const name of ['.env.production.local', '.env.production', '.env.local', '.env']) {
      const file = resolve(backendDir, name);
      if (!existsSync(file)) continue;
      const values = parseEnv(readFileSync(file, 'utf8'));
      if (values.DATABASE_URL && values.DATABASE_URL !== env.DATABASE_URL) throw new Error(`${name} 存在不同数据库连接，拒绝生产部署`);
      if (values.ENTERPRISE_ENV && values.ENTERPRISE_ENV !== 'production') throw new Error(`${name} 标记为开发环境，拒绝生产部署`);
    }
  }
  return { env, target, files: selected };
}

export function redact(text, env) {
  let result = String(text);
  for (const [key, value] of Object.entries(env)) {
    if (value && /DATABASE_URL|PASSWORD|SECRET|TOKEN|(?:^|_)KEY$/.test(key)) result = result.split(value).join('[REDACTED]');
  }
  return result.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[DATABASE_URL REDACTED]');
}
