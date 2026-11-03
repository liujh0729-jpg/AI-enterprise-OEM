import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const observer = fileURLToPath(new URL('./benchmark-backend-observer.cjs', import.meta.url));
const database = 'postgresql://127.0.0.1:5432/enterprise_benchmark_1_2_abcdef';
function probe(code, overrides = {}) {
  return spawnSync(process.execPath, ['--require', observer, '-e', code], {
    env: { PATH: process.env.PATH, ISOLATED_BENCHMARK: '1', DATABASE_URL: database, BENCHMARK_MOCK_PORT: '43210', ...overrides },
    encoding: 'utf8', timeout: 5000,
  });
}

test('observer requires explicit isolated benchmark mode', () => {
  const result = probe('', { ISOLATED_BENCHMARK: '' });
  assert.notEqual(result.status, 0);
});
test('observer rejects remote database targets before running application code', () => {
  const result = probe('console.log("application-started")', { DATABASE_URL: 'postgresql://192.0.2.1:5432/enterprise_benchmark_1_2_abcdef' });
  assert.notEqual(result.status, 0);
  assert(!result.stdout.includes('application-started'));
});
test('observer rejects an existing local business database', () => {
  const result = probe('', { DATABASE_URL: 'postgresql://127.0.0.1:5432/business' });
  assert.notEqual(result.status, 0);
});
test('observer blocks remote HTTP before network access', () => {
  const result = probe('fetch("https://example.invalid/")');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /隔离压测禁止访问非本机网络/);
});
test('observer blocks connections to unrelated localhost services', () => {
  const result = probe('require("node:net").connect({host:"127.0.0.1",port:1690})');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /隔离压测禁止连接其他本机服务/);
});
test('observer blocks direct remote TCP access', () => {
  const result = probe('require("node:net").connect({host:"192.0.2.1",port:5432})');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /隔离压测禁止访问非本机网络/);
});
test('observer accepts synthetic localhost configuration', () => {
  assert.equal(probe('console.log("isolated-ready")').status, 0);
});
