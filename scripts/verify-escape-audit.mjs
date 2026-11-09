#!/usr/bin/env node
/**
 * escape-audit 的行为测试：度量工具自己必须先被度量。
 * 运行：node --test scripts/verify-escape-audit.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'escape-audit.mjs');
const repos = [];

function makeRepo(files, tracked = []) {
  const dir = mkdtempSync(join(tmpdir(), 'escape-audit-'));
  repos.push(dir);
  execFileSync('git', ['-c', 'core.autocrlf=false', 'init', '-q'], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const abs = join(dir, name);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  if (tracked.length) {
    execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '--', ...tracked], { cwd: dir });
  }
  execFileSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.email=t@example.com', '-c', 'user.name=t',
      'commit', '-qm', 'fixture', '--allow-empty'],
    { cwd: dir },
  );
  return dir;
}

function run(dir, args = []) {
  return spawnSync(process.execPath, [SCRIPT, `--root=${dir}`, '--min-files=0', ...args], {
    encoding: 'utf8',
  });
}

function audit(dir, args = []) {
  const json = join(dir, 'report.json');
  const res = run(dir, [`--json=${json}`, ...args]);
  assert.equal(res.status, 0, `审计应成功:\n${res.stdout}\n${res.stderr}`);
  return JSON.parse(readFileSync(json, 'utf8'));
}

test.after(() => {
  for (const dir of repos) rmSync(dir, { recursive: true, force: true });
});

test('.vue 只统计 <script> 段，模板里的同名字样不算逃逸', () => {
  const dir = makeRepo({
    'src/a.vue': [
      '<template>',
      '  <p>请不要写 as never 或 as any</p>',
      '</template>',
      '<script setup lang="ts">',
      'const x = foo as never;',
      '</script>',
      '<style>',
      '.as-never { color: red; }',
      '</style>',
    ].join('\n'),
  }, ['src/a.vue']);
  const r = audit(dir);
  assert.equal(r.byCat.asNever.total, 1);
  assert.equal(r.total, 1);
  assert.equal(r.loc, 9, 'loc 仍按原文件行数算');
});

test('as unknown as never 同行只计一次，归到 as unknown as', () => {
  const dir = makeRepo({
    'src/a.ts': 'const x = foo as unknown as never;\nconst y = bar as never;\n',
  }, ['src/a.ts']);
  const r = audit(dir);
  assert.equal(r.byCat.asUnknownAs.total, 1);
  assert.equal(r.byCat.asNever.total, 1, '第二行的独立 as never 仍要计');
  assert.equal(r.total, 2);
});

test('密度只用生产代码：测试文件的逃逸不进分子，测试行数不进分母', () => {
  const dir = makeRepo({
    'src/a.ts': 'const x = foo as never;\n'.repeat(2),
    'src/a.spec.ts': 'const x = foo as never;\n'.repeat(8),
  }, ['src/a.ts', 'src/a.spec.ts']);
  const r = audit(dir);
  assert.equal(r.total, 10);
  assert.equal(r.prodTotal, 2);
  assert.equal(r.loc, 10);
  assert.equal(r.prodLoc, 2);
  assert.equal(r.density, 1000, '2 处 / 0.002 kloc = 1000');
  assert.equal(r.byRole.test.total, 8);
  const ws = r.workspaces.find((w) => w.ws === 'src');
  assert.equal(ws.density, 1000, '落点密度与表头同口径');
});

test('尚未 git add 的新文件也纳入盘点', () => {
  const dir = makeRepo({
    'src/old.ts': 'const a = 1;\n',
    'src/new.ts': 'const x = foo as never;\n',
  }, ['src/old.ts']);
  const r = audit(dir);
  assert.equal(r.files, 2);
  assert.equal(r.untracked, 1);
  assert.equal(r.byCat.asNever.total, 1);
});

test('索引有磁盘无的文件被显式报出，不崩溃；只警告不阻断门禁', () => {
  const dir = makeRepo({
    'src/a.ts': 'const a = 1;\n',
    'src/gone.ts': 'const x = foo as never;\n',
  }, ['src/a.ts', 'src/gone.ts']);
  rmSync(join(dir, 'src/gone.ts'));
  const r = audit(dir);
  assert.deepEqual(r.missing, ['src/gone.ts']);
  assert.equal(r.files, 1);
  const budget = join(dir, 'budget.json');
  writeFileSync(budget, JSON.stringify({ total: 0, byCat: {}, allowlisted: 0 }));
  const res = run(dir, ['--check', `--budget=${budget}`]);
  assert.equal(res.status, 0, '工作树计数有效，删除未提交不该阻断门禁');
  assert.match(res.stderr, /索引里存在、磁盘上不存在/);
  assert.equal(run(dir, ['--write-budget', `--budget=${budget}`]).status, 0);
});

test('文件数低于阈值时 exit 2，绝不把 0 当干净', () => {
  const dir = makeRepo({ 'src/a.ts': 'const a = 1;\n' }, ['src/a.ts']);
  const res = spawnSync(process.execPath, [SCRIPT, `--root=${dir}`, '--min-files=50'], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /请勿把 0 当作/);
  assert.equal(existsSync(join(dir, 'report.json')), false);
});

test('预算只降不升：上调被拒，--force 才放行', () => {
  const files = { 'src/a.ts': 'const x = foo as never;\n' };
  const dir = makeRepo(files, ['src/a.ts']);
  const budget = join(dir, 'budget.json');
  assert.equal(run(dir, ['--write-budget', `--budget=${budget}`]).status, 0);
  assert.equal(JSON.parse(readFileSync(budget, 'utf8')).total, 1);

  writeFileSync(join(dir, 'src/a.ts'), 'const x = foo as never;\nconst y = bar as never;\n');
  const rejected = run(dir, ['--write-budget', `--budget=${budget}`]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /拒绝上调预算/);
  assert.equal(JSON.parse(readFileSync(budget, 'utf8')).total, 1, '预算文件未被改写');

  assert.equal(run(dir, ['--write-budget', '--force', `--budget=${budget}`]).status, 0);
  assert.equal(JSON.parse(readFileSync(budget, 'utf8')).total, 2);
});

test('--check 在超出预算时 exit 1，持平时 exit 0', () => {
  const dir = makeRepo({ 'src/a.ts': 'const x = foo as never;\n' }, ['src/a.ts']);
  const budget = join(dir, 'budget.json');
  run(dir, ['--write-budget', `--budget=${budget}`]);
  assert.equal(run(dir, ['--check', `--budget=${budget}`]).status, 0);
  writeFileSync(join(dir, 'src/a.ts'), 'const x = foo as never;\nconst y = bar as any;\n');
  const res = run(dir, ['--check', `--budget=${budget}`]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /总数 2 > 预算 1/);
});

test('allowlist 按 file:line:pattern 命中，行号漂移即判失效', () => {
  const dir = makeRepo({ 'src/a.ts': 'const x = foo as never;\n' }, ['src/a.ts']);
  const allow = join(dir, 'allow.json');
  writeFileSync(allow, JSON.stringify({
    entries: [{ file: 'src/a.ts', line: 1, pattern: 'asNever', reason: '历史债务' }],
  }));
  const ok = audit(dir, [`--allow=${allow}`]);
  assert.equal(ok.allowMatched, 1);
  assert.equal(ok.unallowlisted, 0);
  assert.equal(ok.allowStale.length, 0);

  writeFileSync(join(dir, 'src/a.ts'), '// 新增一行\nconst x = foo as never;\n');
  const drifted = audit(dir, [`--allow=${allow}`]);
  assert.equal(drifted.allowMatched, 0);
  assert.deepEqual(drifted.allowStale, ['src/a.ts:1:asNever']);
  const res = run(dir, ['--check', `--allow=${allow}`, `--budget=${join(dir, 'no-budget.json')}`]);
  assert.equal(res.status, 1);
});

test('eslint 规则名不被 `-- 原因` 后缀切碎，多规则逗号分隔逐个计数', () => {
  const dir = makeRepo({
    'src/a.tsx': [
      '// eslint-disable-next-line @next/next/no-img-element -- OSS 直链',
      'const a = 1;',
      '// eslint-disable-next-line react-hooks/exhaustive-deps -- org 切换时重取',
      'const b = 2;',
      '// eslint-disable-next-line react-hooks/exhaustive-deps',
      'const c = 3;',
      '/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 脚本输出 */',
      'const d = 4;',
    ].join('\n'),
  }, ['src/a.tsx']);
  const r = audit(dir);
  assert.equal(r.byCat.eslintDisable.total, 4);
  assert.deepEqual(r.eslintRules, [
    { rule: 'react-hooks/exhaustive-deps', n: 2 },
    { rule: '@next/next/no-img-element', n: 1 },
    { rule: 'no-console', n: 1 },
    { rule: '@typescript-eslint/no-explicit-any', n: 1 },
  ]);
});

test('生成物与 node_modules 不计入，脚本角色与生产角色分开', () => {
  const dir = makeRepo({
    'src/a.ts': 'const x = foo as never;\n',
    'generated/prisma/index.ts': 'const x = foo as never;\n',
    'node_modules/pkg/index.js': 'const x = foo as never;\n',
    'scripts/tool.mjs': 'const x = foo as never;\n',
  }, ['src/a.ts', 'generated/prisma/index.ts', 'scripts/tool.mjs']);
  const r = audit(dir);
  assert.equal(r.files, 2);
  assert.equal(r.excluded.dir, 2, 'generated 与 node_modules 各一');
  assert.equal(r.byCat.asNever.prod, 1);
  assert.equal(r.byCat.asNever.script, 1);
  assert.equal(r.prodTotal, 1);
});