#!/usr/bin/env node
/**
 * 类型逃逸盘点与预算门禁（零依赖，Node >= 18）。
 *
 *   node scripts/escape-audit.mjs --probe --json=docs/escape-report.json --md=docs/escape-report.md
 *   node scripts/escape-audit.mjs --write-budget      # 冻结基线（只允许下调）
 *   node scripts/escape-audit.mjs --check             # CI 门禁：超出预算即 exit 1
 *
 * 退出码：0 通过 / 1 超出预算或 allowlist 失效 / 2 环境不可用（文件数过少，拒绝把 0 当干净）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = resolve(fileURLToPath(import.meta.url));
// 量具本身与它的夹具测试都含模式字面量（那是测试数据，不是债务），同一处排除。
const INSTRUMENT = new Set([SELF, resolve(dirname(SELF), 'verify-escape-audit.mjs')]);

const EXTS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs', '.cjs', '.jsx']);
// 依赖、构建产物、Prisma 生成代码都在此一处判定（generated 同时覆盖 backend/generated 与 prisma/generated）。
const EXCLUDE_SEG = new Set([
  'node_modules', 'dist', '.next', 'coverage', '.nuxt', 'build', 'out', '.turbo', 'generated',
]);

/** 与 wc -l 同口径：末尾换行不产生额外一行。掩码与计数共用，避免行号错位。 */
function splitLines(text) {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const PATTERNS = [
  { key: 'asNever', re: /\bas\s+never\b/, label: 'as never' },
  { key: 'asAny', re: /\bas\s+any\b/, label: 'as any' },
  { key: 'asUnknownAs', re: /\bas\s+unknown\s+as\b/, label: 'as unknown as' },
  { key: 'tsIgnore', re: /@ts-ignore\b/, label: '@ts-ignore' },
  { key: 'tsExpectError', re: /@ts-expect-error\b/, label: '@ts-expect-error' },
  { key: 'eslintDisable', re: /eslint-disable(?:-next-line|-line)?\b/, label: 'eslint-disable' },
  { key: 'explicitAny', re: /(?::\s*any\b|<any>)/, label: ': any' },
  { key: 'tsNocheck', re: /@ts-nocheck\b/, label: '@ts-nocheck' },
];
const KEYS = PATTERNS.map((p) => p.key);
const zeroCats = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

function parseArgs(argv) {
  const o = {
    check: false, writeBudget: false, force: false, probe: false,
    root: process.cwd(), json: '', md: '', top: 20, minFiles: 50,
    budget: '.escape-budget.json', allow: '.escape-allowlist.json',
  };
  for (const arg of argv) {
    if (arg === '--check') o.check = true;
    else if (arg === '--write-budget') o.writeBudget = true;
    else if (arg === '--force') o.force = true;
    else if (arg === '--probe') o.probe = true;
    else if (arg.startsWith('--root=')) o.root = resolve(arg.slice(7));
    else if (arg.startsWith('--json=')) o.json = arg.slice(7);
    else if (arg.startsWith('--md=')) o.md = arg.slice(5);
    else if (arg.startsWith('--budget=')) o.budget = arg.slice(9);
    else if (arg.startsWith('--allow=')) o.allow = arg.slice(8);
    else if (arg.startsWith('--top=')) o.top = Number(arg.slice(6)) || 20;
    else if (arg.startsWith('--min-files=')) o.minFiles = Number(arg.slice(12)) || 0;
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node scripts/escape-audit.mjs [--probe] [--check] [--write-budget] [--force]\n'
        + '  --root=DIR --json=FILE --md=FILE --budget=FILE --allow=FILE --top=N --min-files=N');
      process.exit(0);
    } else {
      console.error(`[escape-audit] 未知参数: ${arg}`);
      process.exit(2);
    }
  }
  return o;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
}

/**
 * 盘点对象是工作树，不是 HEAD：--cached --others --exclude-standard 同时覆盖
 * 已跟踪文件与尚未 git add 的新文件（否则新写的模块整体逃过盘点）。
 * 索引里有、磁盘上没有的文件属于未提交的删除，单独列出而不是让扫描崩掉。
 */
function listFiles(root) {
  const raw = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const all = [...new Set(raw.split('\0').filter(Boolean))];
  const kept = [];
  const missing = [];
  let excludedDir = 0;
  let excludedInstrument = 0;
  let untracked = 0;
  const trackedSet = new Set(git(root, ['ls-files', '-z']).split('\0').filter(Boolean));
  for (const file of all) {
    const norm = file.split('\\').join('/');
    const dot = norm.lastIndexOf('.');
    if (dot < 0 || !EXTS.has(norm.slice(dot))) continue;
    const segs = norm.split('/');
    if (segs.some((s) => EXCLUDE_SEG.has(s))) { excludedDir += 1; continue; }
    const abs = resolve(root, norm);
    if (INSTRUMENT.has(abs)) { excludedInstrument += 1; continue; }
    if (!existsSync(abs)) { missing.push(norm); continue; }
    if (!trackedSet.has(file)) untracked += 1;
    kept.push(norm);
  }
  return { kept, missing, untracked, total: all.length, excludedDir, excludedInstrument };
}

function roleOf(file) {
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(file)) return 'test';
  if (/\.d\.ts$/.test(file)) return 'dts';
  if (/(^|\/)(scripts?|test|tests|e2e|__tests__|__mocks__)\//.test(file)) return 'script';
  if (/\.(mjs|cjs|js|jsx)$/.test(file) && !/(^|\/)src\//.test(file)) return 'script';
  return 'prod';
}

function workspaceOf(file) {
  const m = /^(?:apps|packages)\/[^/]+/.exec(file);
  if (m) return m[0];
  return file.split('/')[0];
}

/**
 * .vue 只有 <script> 段是代码；模板/样式里出现 "as never" 之类字样不是逃逸。
 * 返回逐行布尔掩码，保留原文件行号（loc 也按原文件算）。
 */
function scriptLineMask(text) {
  const count = splitLines(text).length;
  const mask = new Array(count).fill(false);
  const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const open = m[0].indexOf('>');
    const startIdx = m.index + open + 1;
    const endIdx = startIdx + m[1].length;
    const startLine = text.slice(0, startIdx).split('\n').length - 1;
    const endLine = text.slice(0, endIdx).split('\n').length - 1;
    for (let i = startLine; i <= endLine && i < count; i += 1) mask[i] = true;
  }
  return mask;
}

const QUICK = /any|never|unknown|@ts-|eslint-disable/;

function scanFile(root, file) {
  const text = readFileSync(resolve(root, file), 'utf8');
  const lines = splitLines(text);
  const mask = file.endsWith('.vue') ? scriptLineMask(text) : null;
  const hits = [];
  const rules = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!QUICK.test(line)) continue;
    if (mask && !mask[i]) continue;
    const matched = PATTERNS.filter((p) => p.re.test(line)).map((p) => p.key);
    if (!matched.length) continue;
    // `as unknown as never` 同时命中两条模式，按更强的那条计一次。
    const keys = matched.includes('asUnknownAs')
      ? matched.filter((k) => k !== 'asNever' && k !== 'asAny')
      : matched;
    for (const key of keys) {
      hits.push({ pattern: key, line: i + 1, text: line.trim().slice(0, 200) });
    }
    if (keys.includes('eslintDisable')) {
      // 规则名不含空格；`--` 之后是给人看的原因，不属于规则名。
      const ruleRe = /eslint-disable(?:-next-line|-line)?\s+([@a-zA-Z0-9/_-]+(?:\s*,\s*[@a-zA-Z0-9/_-]+)*)/g;
      let rm;
      while ((rm = ruleRe.exec(line)) !== null) {
        for (const name of rm[1].split(',')) {
          const rule = name.trim();
          if (rule) rules.push(rule);
        }
      }
    }
  }
  const cats = zeroCats();
  for (const h of hits) cats[h.pattern] += 1;
  return {
    file,
    ws: workspaceOf(file),
    role: roleOf(file),
    loc: lines.length,
    total: hits.length,
    cats,
    hits,
    rules,
  };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) {
    console.error(`[escape-audit] 无法解析 ${path}: ${err.message}`);
    process.exit(2);
  }
}

function writeOut(path, content) {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  console.log(`[escape-audit] 已写入 ${relative(process.cwd(), abs) || abs}`);
}

const o = parseArgs(process.argv.slice(2));

let gitVersion = '';
let commit = '';
try {
  gitVersion = git(o.root, ['--version']).trim();
  commit = git(o.root, ['rev-parse', '--short', 'HEAD']).trim();
} catch (err) {
  console.error(`[escape-audit] git 不可用或 root 不是仓库: ${o.root}\n${err.message}`);
  process.exit(2);
}

const listing = listFiles(o.root);
const files = listing.kept;

if (o.probe) {
  console.log('[probe] root        =', o.root);
  console.log('[probe] node        =', process.version);
  console.log('[probe] git         =', gitVersion);
  console.log('[probe] commit      =', commit);
  console.log('[probe] candidates  =', listing.total, '(tracked + untracked, 已去重)');
  console.log('[probe] scannable   =', files.length, '其中未跟踪', listing.untracked);
  console.log('[probe] excluded    =', `${listing.excludedDir} 依赖/构建/生成目录 + ${listing.excludedInstrument} 量具自身`);
  console.log('[probe] missing     =', listing.missing.length, listing.missing.length ? `(索引有磁盘无: ${listing.missing.slice(0, 5).join(', ')})` : '');
}

if (files.length < o.minFiles) {
  console.error(
    `[escape-audit] 只发现 ${files.length} 个待扫文件（阈值 ${o.minFiles}）。\n`
    + '这通常意味着 root 不对、仓库未 clone、或 git 索引为空。\n'
    + '已中止，不产出报告——请勿把 0 当作「干净」。',
  );
  process.exit(2);
}

const scanned = files.map((f) => scanFile(o.root, f));

const agg = new Map();
const byCat = Object.fromEntries(KEYS.map((k) => [k, { total: 0, prod: 0, test: 0, script: 0, dts: 0 }]));
const byRole = {};
const ruleCounts = new Map();
let totalLoc = 0;
let prodLoc = 0;

for (const item of scanned) {
  totalLoc += item.loc;
  if (item.role === 'prod') prodLoc += item.loc;
  if (!agg.has(item.ws)) {
    agg.set(item.ws, {
      files: 0, loc: 0, prodFiles: 0, prodLoc: 0, total: 0, prodTotal: 0,
      cats: zeroCats(), prodCats: zeroCats(),
    });
  }
  const A = agg.get(item.ws);
  A.files += 1;
  A.loc += item.loc;
  A.total += item.total;
  if (!byRole[item.role]) byRole[item.role] = { files: 0, loc: 0, total: 0 };
  byRole[item.role].files += 1;
  byRole[item.role].loc += item.loc;
  byRole[item.role].total += item.total;
  for (const k of KEYS) {
    A.cats[k] += item.cats[k];
    byCat[k].total += item.cats[k];
    byCat[k][item.role] += item.cats[k];
    if (item.role === 'prod') {
      A.prodCats[k] += item.cats[k];
      A.prodTotal += item.cats[k];
    }
  }
  if (item.role === 'prod') { A.prodFiles += 1; A.prodLoc += item.loc; }
  for (const rule of item.rules) ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
}

const total = scanned.reduce((s, i) => s + i.total, 0);
const prodTotal = [...agg.values()].reduce((s, A) => s + A.prodTotal, 0);
const density = (n, loc) => (loc ? +(n / (loc / 1000)).toFixed(2) : 0);

// ---- allowlist ----
const allowDoc = readJson(resolve(o.root, o.allow)) ?? { entries: [] };
const allowEntries = Array.isArray(allowDoc.entries) ? allowDoc.entries : [];
const allowKeys = new Set(allowEntries.map((e) => `${e.file}:${e.line}:${e.pattern}`));
const hitKeys = new Map();
for (const item of scanned) {
  for (const h of item.hits) {
    const key = `${item.file}:${h.line}:${h.pattern}`;
    hitKeys.set(key, (hitKeys.get(key) ?? 0) + 1);
  }
}
const allowMatched = [...allowKeys].filter((k) => hitKeys.has(k)).length;
const allowStale = [...allowKeys].filter((k) => !hitKeys.has(k));
const unallowlisted = total - allowMatched;

// ---- budget ----
const budgetPath = resolve(o.root, o.budget);
const budget = readJson(budgetPath);

const perFile = scanned.filter((i) => i.total > 0).sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
const workspaces = [...agg.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
const date = new Date().toISOString().slice(0, 10);

const payload = {
  tool: 'escape-audit', version: 2, commit, date, root: o.root,
  files: files.length, candidates: listing.total, untracked: listing.untracked,
  missing: listing.missing,
  excluded: { dir: listing.excludedDir, instrument: listing.excludedInstrument },
  loc: totalLoc, prodLoc,
  total, prodTotal, unallowlisted, allowMatched, allowStale,
  density: density(prodTotal, prodLoc),
  byCat, byRole,
  workspaces: workspaces.map(([ws, A]) => ({
    ws, files: A.files, loc: A.loc, prodFiles: A.prodFiles, prodLoc: A.prodLoc,
    total: A.total, prodTotal: A.prodTotal, density: density(A.prodTotal, A.prodLoc),
    cats: A.cats, prodCats: A.prodCats,
  })),
  topFiles: perFile.slice(0, o.top).map((i) => ({
    file: i.file, role: i.role, loc: i.loc, total: i.total, cats: i.cats,
  })),
  eslintRules: [...ruleCounts.entries()].sort((a, b) => b[1] - a[1]).map(([rule, n]) => ({ rule, n })),
  budget: budget ?? null,
};

// ---- markdown ----
const md = [];
md.push('# 类型逃逸盘点报告', '');
md.push(`- 生成工具：\`scripts/escape-audit.mjs\` v2（commit \`${commit}\`，${date}）`);
md.push(`- 候选文件 ${listing.total}（已跟踪 + 未跟踪，去重），纳入扫描 ${files.length}，其中尚未 git add 的 ${listing.untracked}`);
md.push(`- 排除：依赖/构建/生成目录内 ${listing.excludedDir} / 量具自身 ${listing.excludedInstrument} / 索引有磁盘无 ${listing.missing.length}`);
md.push(`- 代码行 ${totalLoc.toLocaleString('en-US')}（其中生产 ${prodLoc.toLocaleString('en-US')}）`);
md.push(`- 逃逸总数 **${total}**，其中生产代码 **${prodTotal}**，已登记 allowlist ${allowMatched}，未登记 ${unallowlisted}`);
md.push(`- 生产密度 **${density(prodTotal, prodLoc)} 处/kloc**（口径：仅 role=prod 的命中 ÷ 生产代码千行）`);
md.push(`- 预算文件：${budget ? `\`${o.budget}\`（total=${budget.total}）` : '未冻结'}`);
md.push('', '> 计数为「文本命中」，注释与字符串中的同名字样也会计入；.vue 仅统计 `<script>` 段。', '');

if (listing.missing.length) {
  md.push('## 索引与磁盘不一致（未扫）', '',
    `以下 ${listing.missing.length} 个文件在 git 索引里、磁盘上不存在（未提交的删除）。盘点对象是工作树，故不纳入统计；计数有效，但 git 状态待收口：`, '');
  for (const f of listing.missing) md.push(`- \`${f}\``);
  md.push('');
}

md.push('## 分类计数', '', '| 类别 | 合计 | 生产 | 测试 | 脚本 | .d.ts |', '| --- | ---: | ---: | ---: | ---: | ---: |');
for (const p of PATTERNS) {
  const c = byCat[p.key];
  md.push(`| \`${p.label}\` | ${c.total} | ${c.prod} | ${c.test} | ${c.script} | ${c.dts} |`);
}
md.push(`| **合计** | **${total}** | **${prodTotal}** | ${byRole.test?.total ?? 0} | ${byRole.script?.total ?? 0} | ${byRole.dts?.total ?? 0} |`, '');

md.push('## 按落点（密度只算生产代码）', '', '| 模块 | 文件 | kloc | 生产 kloc | 合计 | 生产 | 密度 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const [ws, A] of workspaces) {
  md.push(`| ${ws} | ${A.files} | ${(A.loc / 1000).toFixed(1)} | ${(A.prodLoc / 1000).toFixed(1)} | ${A.total} | ${A.prodTotal} | ${density(A.prodTotal, A.prodLoc)} |`);
}
md.push('');

md.push('## 按角色', '', '| 角色 | 文件 | 行数 | 命中 |', '| --- | ---: | ---: | ---: |');
for (const role of ['prod', 'test', 'script', 'dts']) {
  const r = byRole[role];
  if (r) md.push(`| ${role} | ${r.files} | ${r.loc} | ${r.total} |`);
}
md.push('');

md.push(`## Top ${Math.min(o.top, perFile.length)} 文件`, '', '| 文件 | 角色 | 行数 | 命中 | 明细 |', '| --- | --- | ---: | ---: | --- |');
for (const i of perFile.slice(0, o.top)) {
  const detail = KEYS.filter((k) => i.cats[k]).map((k) => `${PATTERNS.find((p) => p.key === k).label}×${i.cats[k]}`).join('，');
  md.push(`| \`${i.file}\` | ${i.role} | ${i.loc} | ${i.total} | ${detail} |`);
}
md.push('');

if (ruleCounts.size) {
  md.push('## eslint-disable 规则分布', '', '| 规则 | 次数 |', '| --- | ---: |');
  for (const [rule, n] of [...ruleCounts.entries()].sort((a, b) => b[1] - a[1])) md.push(`| \`${rule}\` | ${n} |`);
  md.push('');
}

md.push('## allowlist', '');
if (!allowEntries.length) md.push('未登记任何条目。', '');
else {
  md.push(`登记 ${allowKeys.size} 条，命中 ${allowMatched} 条，失效 ${allowStale.length} 条。`, '');
  if (allowStale.length) {
    md.push('失效条目（行号漂移或债务已清，应删除）：', '');
    for (const k of allowStale) md.push(`- \`${k}\``);
    md.push('');
  }
}

if (o.md) writeOut(o.md, md.join('\n'));
if (o.json) writeOut(o.json, `${JSON.stringify(payload, null, 2)}\n`);

// ---- console summary ----
console.log(`\n[escape-audit] 文件 ${files.length}（未跟踪 ${listing.untracked}，索引有磁盘无 ${listing.missing.length}）/ 行 ${totalLoc} (生产 ${prodLoc})`);
if (listing.missing.length) {
  // 盘的是工作树：磁盘上没有的文件本来就不是代码，计数有效，只提示 git 状态待收口。
  console.warn(`[escape-audit] 提示：${listing.missing.length} 个文件索引里存在、磁盘上不存在（未提交的删除），未纳入统计：${listing.missing.slice(0, 3).join(', ')}`);
}
console.log(`[escape-audit] 逃逸 ${total}（生产 ${prodTotal}，密度 ${density(prodTotal, prodLoc)}/kloc，allowlist ${allowMatched}，失效 ${allowStale.length}）`);
for (const p of PATTERNS) {
  const c = byCat[p.key];
  console.log(`  ${p.label.padEnd(18)} 合计 ${String(c.total).padStart(4)}  生产 ${String(c.prod).padStart(4)}  测试 ${String(c.test).padStart(4)}  脚本 ${String(c.script).padStart(4)}`);
}
console.log('[escape-audit] 落点 Top 8:');
for (const [ws, A] of workspaces.slice(0, 8)) {
  console.log(`  ${ws.padEnd(28)} 合计 ${String(A.total).padStart(4)}  生产 ${String(A.prodTotal).padStart(4)}  密度 ${density(A.prodTotal, A.prodLoc)}/kloc`);
}

// ---- write-budget ----
if (o.writeBudget) {
  const next = { total, byCat: Object.fromEntries(KEYS.map((k) => [k, byCat[k].total])), allowlisted: allowMatched, commit, date };
  if (budget && !o.force) {
    const grew = next.total > budget.total
      || KEYS.some((k) => next.byCat[k] > (budget.byCat?.[k] ?? 0))
      || next.allowlisted > (budget.allowlisted ?? 0);
    if (grew) {
      console.error(`[escape-audit] 拒绝上调预算：${budget.total} → ${next.total}。预算只降不升；确需上调请加 --force 并说明原因。`);
      process.exit(1);
    }
  }
  writeOut(budgetPath, `${JSON.stringify(next, null, 2)}\n`);
}

// ---- check ----
if (o.check) {
  const problems = [];
  if (!budget) problems.push(`预算文件 ${o.budget} 不存在，先运行 --write-budget 冻结基线`);
  else {
    if (total > budget.total) problems.push(`总数 ${total} > 预算 ${budget.total}（+${total - budget.total}）`);
    for (const k of KEYS) {
      const b = budget.byCat?.[k] ?? 0;
      if (byCat[k].total > b) problems.push(`${PATTERNS.find((p) => p.key === k).label}: ${byCat[k].total} > 预算 ${b}`);
    }
    if (allowMatched > (budget.allowlisted ?? 0)) problems.push(`allowlist 命中 ${allowMatched} > 预算 ${budget.allowlisted ?? 0}`);
  }
  if (allowStale.length) problems.push(`allowlist 有 ${allowStale.length} 条失效（行号漂移），请更新或删除`);
  if (problems.length) {
    console.error('\n[escape-audit] 门禁未通过：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\n[escape-audit] 门禁通过：${total} <= ${budget.total}，各类别均未超预算。`);
}

if (!o.check && !o.writeBudget && !o.json && !o.md) {
  console.log('\n提示：加 --json= / --md= 产出报告，--write-budget 冻结基线，--check 作为门禁。');
}