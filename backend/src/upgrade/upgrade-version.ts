import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDir } from './upgrade.config';

function git(args: string[]) {
  try {
    return execFileSync('git', args, {
      cwd: installDir(),
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function manifest() {
  const file = resolve(installDir(), 'release-manifest.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as {
      version?: string;
      commit?: string;
      publishedAt?: string;
    };
  } catch {
    return null;
  }
}

/** 版本优先级：显式环境变量 → release-manifest.json → git tag → unknown。 */
export function currentVersion(): string {
  const env = String(process.env.ENTERPRISE_RELEASE_VERSION || '').trim();
  if (env) return env.replace(/^v/i, '');
  const meta = manifest();
  if (meta?.version) return String(meta.version).replace(/^v/i, '');
  const described = git(['describe', '--tags', '--always']);
  const match = described.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  if (match) return match[1];
  return described || 'unknown';
}

export function currentCommit(): string {
  const env = String(process.env.ENTERPRISE_RELEASE_COMMIT || '').trim();
  if (env) return env;
  const meta = manifest();
  if (meta?.commit) return String(meta.commit);
  return git(['rev-parse', '--short', 'HEAD']) || 'unknown';
}

export function isGitRepo() {
  return existsSync(resolve(installDir(), '.git'));
}

/** 仅用于展示与比较：非标准版本一律按 v 前缀剥离，比较失败时视为“不同版本”。 */
export function normalizeVersion(value: string) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '');
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    normalizeVersion(value)
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function versionFromName(name: string, fallback = '') {
  const match = String(name || '').match(
    /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/,
  );
  return match ? match[1] : normalizeVersion(fallback);
}

export function versionFromManifest(candidateDir: string) {
  const file = resolve(candidateDir, 'release-manifest.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      version?: string;
      commit?: string;
      publishedAt?: string;
      dbDialect?: string;
      migrations?: string[];
    };
    return {
      version: normalizeVersion(String(parsed.version || '')),
      commit: String(parsed.commit || ''),
      publishedAt: String(parsed.publishedAt || ''),
      dbDialect: String(parsed.dbDialect || ''),
      migrations: Array.isArray(parsed.migrations)
        ? parsed.migrations.map(String)
        : [],
    };
  } catch {
    return null;
  }
}
