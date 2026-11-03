import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { databaseTarget, loadEnvironment } from './lib/enterprise-environment.mjs';
import { main, verifyBackup } from './production-database.mjs';

const password = 'synthetic-test-password';
const productionUrl = `postgresql://ae_prod:${password}@8.219.81.18:15432/ae_prod?schema=public`;
const developmentUrl = productionUrl.replaceAll('ae_prod', 'ae_test');
const productionValues = `ENTERPRISE_ENV=production\nNODE_ENV=production\nDATABASE_URL=${productionUrl}\nDEV_AUTO_LOGIN=false\nJWT_SECRET=synthetic-signing-key\nEXTERNAL_CRED_KEY=synthetic-credential-key\n`;
function fixture(t) {
  const base = process.env.ENTERPRISE_TEMP_DIR || '/Volumes/Projects/tmp';
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'enterprise-env-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, '.env.production');
  writeFileSync(file, productionValues, { mode: 0o600 });
  return { root, file, load: (overrides = {}) => loadEnvironment({ environment: 'production', backendDir: root, inherited: {}, ...overrides }) };
}

test('production accepts only the dedicated production database and role', () => {
  assert.deepEqual(databaseTarget(productionUrl, 'production'), { host: '8.219.81.18', port: 15432, database: 'ae_prod', schema: 'public' });
  const invalid = [developmentUrl, productionUrl.replace('ae_prod:', 'ae_test:'), productionUrl.replace('8.219.81.18', '127.0.0.1'), productionUrl.replace(':15432/', ':5432/'), productionUrl.replace('schema=public', 'schema=sns'), productionUrl + '&schema=public', productionUrl.replace('?schema=public', ''), productionUrl + '&host=127.0.0.1', productionUrl.replace(password, 'REPLACE_WITH_PASSWORD')];
  for (const value of invalid) assert.throws(() => databaseTarget(value, 'production'));
});

test('development cannot use the production database', () => {
  assert.equal(databaseTarget(developmentUrl, 'development').database, 'ae_test');
  assert.throws(() => databaseTarget(productionUrl, 'development'));
});

test('production requires a production file and never falls back to .env', t => {
  const { root, file, load } = fixture(t);
  rmSync(file);
  writeFileSync(join(root, '.env'), productionValues, { mode: 0o600 });
  assert.throws(load, /禁止回退/);
});

test('environment identity, permissions, auto login and key placeholders fail closed', t => {
  const { file, load } = fixture(t);
  assert.equal(load().env.NODE_ENV, 'production');
  for (const values of [productionValues.replace('ENTERPRISE_ENV=production', 'ENTERPRISE_ENV=development'), productionValues.replace('DEV_AUTO_LOGIN=false', 'DEV_AUTO_LOGIN=true'), productionValues.replace('NODE_ENV=production', 'NODE_ENV=development'), productionValues.replace('synthetic-signing-key', 'REPLACE_WITH_JWT'), productionValues.replace('EXTERNAL_CRED_KEY=synthetic-credential-key', '')]) {
    writeFileSync(file, values); assert.throws(load);
  }
  writeFileSync(file, productionValues); chmodSync(file, 0o644); assert.throws(load, /600/);
});

test('production rejects inherited database or key overrides', t => {
  const { load } = fixture(t);
  assert.throws(() => load({ inherited: { DATABASE_URL: developmentUrl } }), /隐藏覆盖/);
  assert.throws(() => load({ inherited: { JWT_SECRET: 'different-key' } }), /隐藏/);
  assert.throws(() => load({ inherited: { ENTERPRISE_ENV: 'development' } }), /不一致/);
  assert.throws(() => load({ inherited: { DEV_AUTO_LOGIN: 'true' } }), /DEV_AUTO_LOGIN/);
});

test('existing configured keys are preserved without rotating them during database separation', t => {
  const { file, load } = fixture(t);
  writeFileSync(file, productionValues.replace('synthetic-signing-key', 'changed-by-existing-identity-service'));
  assert.equal(load().env.JWT_SECRET, 'changed-by-existing-identity-service');
});

test('dotenv override files cannot redirect the deployed app', t => {
  const { root, load } = fixture(t);
  for (const name of ['.env', '.env.local', '.env.production.local']) {
    const file = join(root, name);
    writeFileSync(file, `DATABASE_URL=${developmentUrl}\n`, { mode: 0o600 });
    assert.throws(load, /生产|development|production/);
    rmSync(file);
  }
});

test('valid check and missing-backup migration do not connect to any database', t => {
  const { root, file } = fixture(t);
  t.mock.method(console, 'log', () => {});
  main(['check', '--backend-dir', root, '--env-file', file]);
  assert.throws(() => main(['migrate', '--backend-dir', root, '--env-file', file]), /backup-manifest/);
});

test('backup manifests are bound to target, age, file permissions and content', t => {
  const { root } = fixture(t);
  const target = databaseTarget(productionUrl, 'production');
  const archive = join(root, 'ae_prod.dump');
  const file = `${archive}.json`;
  const bytes = Buffer.from('synthetic archive used only to test checksum validation');
  writeFileSync(archive, bytes, { mode: 0o600 });
  const manifest = { target, archive, createdAt: new Date().toISOString(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const save = value => writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  save(manifest); assert.equal(verifyBackup(file, target).archive, archive);
  save({ ...manifest, target: { ...target, database: 'ae_test' } }); assert.throws(() => verifyBackup(file, target), /目标/);
  save({ ...manifest, createdAt: '2000-01-01T00:00:00Z' }); assert.throws(() => verifyBackup(file, target), /24/);
  save({ ...manifest, sha256: 'incorrect' }); assert.throws(() => verifyBackup(file, target), /SHA-256/);
  save(manifest); chmodSync(archive, 0o644); assert.throws(() => verifyBackup(file, target), /600/);
});

test('backup and migration pass the verified production environment to tools without URL arguments', t => {
  const { root, file } = fixture(t);
  t.mock.method(console, 'log', () => {});
  const tools = join(root, 'tools'); mkdirSync(tools);
  for (const name of ['psql', 'pg_dump', 'pg_restore']) {
    const body = `#!${process.execPath}\nconst assert=require('node:assert/strict');assert.equal(process.env.PGDATABASE,'ae_prod');assert.equal(process.env.PGUSER,'ae_prod');assert.equal(process.argv.some(x=>x.includes('postgresql://')||x.includes(${JSON.stringify(password)})),false);\n`;
    const output = name === 'psql' ? `console.log(JSON.stringify({database:'ae_prod',schema:'public',role:'ae_prod',port:15432}));` : name === 'pg_dump' ? `process.stdout.write('simulated archive for command orchestration test');` : `console.log('simulated archive listing');`;
    writeFileSync(join(tools, name), body + output, { mode: 0o700 });
  }
  const backupDir = join(root, 'backups');
  main(['backup', '--backend-dir', root, '--env-file', file, '--backup-dir', backupDir, '--pg-bin', tools]);
  const manifest = join(backupDir, readdirSync(backupDir).find(name => name.endsWith('.json')));
  const record = join(root, 'prisma-invocation.json');
  const prismaDir = join(root, 'node_modules/prisma/build'); mkdirSync(prismaDir, { recursive: true });
  writeFileSync(join(prismaDir, 'index.js'), `const u=new URL(process.env.DATABASE_URL);require('node:fs').writeFileSync(${JSON.stringify(record)},JSON.stringify({database:u.pathname,schema:u.searchParams.get('schema'),environment:process.env.ENTERPRISE_ENV,args:process.argv.slice(2)}));`);
  main(['migrate', '--backend-dir', root, '--env-file', file, '--backup-manifest', manifest, '--pg-bin', tools]);
  assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')), { database: '/ae_prod', schema: 'public', environment: 'production', args: ['migrate', 'deploy', '--schema', join(root, 'prisma/schema.prisma')] });
});

test('production wrapper refuses the child command when given development config', t => {
  const { root, file } = fixture(t);
  writeFileSync(file, productionValues.replace(productionUrl, developmentUrl));
  const sentinel = join(root, 'command-started');
  const result = spawnSync(process.execPath, [resolve('scripts/run-with-environment.mjs'), '--environment', 'production', '--backend-dir', root, '--env-file', file, '--', process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'started')`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.notEqual(result.status, 0); assert.equal(existsSync(sentinel), false);
  assert.equal(result.stderr.includes(password), false); assert.equal(result.stderr.includes('postgresql://'), false);
});

test('bare production migrations and remote isolated-test bypass are rejected before Prisma starts', () => {
  for (const extra of [{ NODE_ENV: 'production' }, { ISOLATED_TEST: '1', DATABASE_URL: productionUrl }, { ISOLATED_TEST: '1', DATABASE_URL: 'postgresql://127.0.0.1:5432/enterprise_migration_123_456?host=8.219.81.18' }]) {
    const result = spawnSync(process.execPath, [resolve('scripts/prisma-migrate-deploy.mjs')], { env: { PATH: process.env.PATH, ...extra }, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /生产迁移|隔离迁移/);
    assert.equal(result.stderr.includes(password), false);
  }
});

test('production example templates contain no usable database password', () => {
  const template = readFileSync('backend/.env.production.example', 'utf8');
  assert.match(template, /ENTERPRISE_ENV=production/); assert.match(template, /ae_prod\?schema=public/);
  assert.throws(() => databaseTarget(template.match(/^DATABASE_URL=(.+)$/m)[1], 'production'), /占位/);
});
