/** 只在自行创建的本机空库中运行角色与页面读取接口审计。 */
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const database = `enterprise_page_audit_${Date.now()}_${process.pid}`;
const url = new URL(`postgresql://127.0.0.1:5432/${database}?schema=public`);
url.username = process.env.PGUSER || userInfo().username;
if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
const output = fileURLToPath(new URL('../docs/performance/evidence/', import.meta.url));
mkdirSync(output, { recursive: true });
const env = { ...process.env, DATABASE_URL: url.href, ISOLATED_TEST: '1',
  JWT_SECRET: 'isolated-page-audit-signing-key', EXTERNAL_CRED_KEY: 'isolated-page-audit-encryption-key',
  JAVA_BASE_URL: 'http://127.0.0.1:1', AIWORKIN_BASE_URL: 'http://127.0.0.1:1',
  AIWORKIN_ENABLED: 'false', DEV_AUTO_LOGIN: 'false', GEO_AUTO_COLLECT_DISABLED: '1',
  NODE_OPTIONS: `--require=${root}backend/test/isolated-upstreams.cjs`, PAGE_AUDIT_OUTPUT: output,
};
function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, env, encoding: 'utf8' });
  let text = (result.stdout || '') + (result.stderr || '');
  text = text.replaceAll(url.href, '[isolated database]');
  if (process.env.PGPASSWORD) text = text.replaceAll(process.env.PGPASSWORD, '[redacted]');
  if (result.status !== 0 || result.error) throw new Error(text.slice(-15000) || `${program} failed`);
  return text;
}
let created = false;
try {
  run('createdb', ['-h', '127.0.0.1', database]); created = true;
  run('pnpm', ['--filter', 'aiworkin-enterprise-api', 'exec', 'prisma', 'migrate', 'deploy']);
  run('pnpm', ['--filter', 'aiworkin-enterprise-api', 'exec', 'tsx', 'prisma/seed.ts']);
  process.stdout.write(run('pnpm', ['--filter', 'aiworkin-enterprise-api', 'exec', 'tsx', 'test/page-role-audit.ts']));
  if (process.argv.includes('--browser')) {
    console.log('浏览器隔离环境：http://localhost:15989/audit');
    const child = spawnSync('pnpm', ['--filter', 'aiworkin-enterprise-api', 'exec', 'tsx', 'test/page-role-browser.ts'], { cwd: root, env: { ...env, CORS_ORIGIN_PATTERNS: 'http://localhost:15989' }, stdio: 'inherit' });
    if (child.status && child.status !== 130) throw new Error('浏览器隔离服务退出异常');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (created) { run('dropdb', ['-h', '127.0.0.1', database]); console.log('页面审计隔离库已清理'); } }
