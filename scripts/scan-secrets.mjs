// 敏感信息扫描（M7 开源收尾）：遍历将随仓库分发的文本文件，检出可能的真实凭据。
// 用法：node scripts/scan-secrets.mjs       （发现疑似泄露时以非 0 退出）
// 说明：占位符 / 演示值 / .env.example 已过滤；.env 与 node_modules 等被忽略的本就不入库。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "coverage", ".turbo", "generated",
  "test-results", ".pnpm-store", "playwright-report",
]);
// 只扫描文本源码；二进制 / 资源 / 锁文件跳过。
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".sql", ".prisma",
  ".yml", ".yaml", ".env", ".example", ".ps1", ".sh", ".conf", ".toml",
]);
const MAX_BYTES = 1_500_000;

// 明显是占位 / 演示 / 单测 fixture 的值，命中即忽略。
const PLACEHOLDER = /REPLACE_|CHANGE[-_]|change-me|change-this|your-|placeholder|synthetic|local-dev-|please-change|example\.com|\.example|xxxxxxxx|<[^>]+>|\$\{|process\.env|\bTODO\b|not-real|not-a-real|should-be-rejected|unit-|-unit|caller-|\btest-|-test\b|\bfake\b|verify-|smoke-|isolated-|legacy-|replacement|next-key|next-secret|new-key|new-secret|saved-|repaired-|db-secret|db-key|e2e-|sk-verify|sk-fake|P@ssw0rd|connections-|user:pass|:pass@|test-db|nsrsbh/i;

const PATTERNS = [
  { name: "私钥块", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "AWS AccessKeyId", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub Token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "Slack Token", re: /xox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "Google API Key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "连接串内嵌口令", re: /\b(?:mysql|postgresql|postgres|redis|mongodb)(?:\+\w+)?:\/\/[^\s'"]*:[^\s'"]+@[^\s'"]+/i },
  { name: "明文密钥赋值", re: /\b(?:password|passwd|secret|access_key|accesskey|api_key|apikey|token)\s*[:=]\s*["'`][^"'`]{8,}["'`]/i },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { yield* walk(full); }
    else if (st.isFile()) yield { full, name: entry };
  }
}

function isScannable(name) {
  if (name.endsWith(".log")) return false;
  const dot = name.lastIndexOf(".");
  // .env / .env.local 等真实环境文件不入库，无需扫描；仅扫 .env.example / .env.*.example 与源码
  if (/^\.env(\..+)?$/.test(name)) return /\.example$/.test(name) || name === ".env.example";
  return dot >= 0 && TEXT_EXT.has(name.slice(dot));
}

const findings = [];
for (const { full, name } of walk(ROOT)) {
  if (!isScannable(name)) continue;
  let st;
  try { st = statSync(full); } catch { continue; }
  if (st.size > MAX_BYTES) continue;
  let text;
  try { text = readFileSync(full, "utf8"); } catch { continue; }
  const rel = relative(ROOT, full).replace(/\\/g, "/");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { name: label, re } of PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      // 提取到的敏感片段若含占位标记则放行
      if (PLACEHOLDER.test(m[0]) || PLACEHOLDER.test(line)) continue;
      findings.push({ file: rel, line: i + 1, label, snippet: line.trim().slice(0, 160) });
    }
  });
}

if (findings.length === 0) {
  console.log(`SECRET SCAN CLEAN — 已扫描文本源码，未发现疑似真实凭据泄露。`);
  process.exit(0);
}
console.log(`SECRET SCAN FOUND ${findings.length} 处疑似泄露：`);
for (const f of findings) console.log(`  [${f.label}] ${f.file}:${f.line}  ${f.snippet}`);
process.exit(1);
