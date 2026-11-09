import { createHash } from 'node:crypto';
import {
  matchBlacklistHost,
  scanPackageStatic,
  type BlacklistEntryLite,
  type StaticHit,
} from './skill-review.rules';

/**
 * 技能包上传的四组确定性安全检查（测试问题 1.1~1.4）：
 * 1.1 恶意代码与依赖扫描；1.2 权限声明与最小化校验；
 * 1.3 网络出口白名单（声明侧）；1.4 高危命令阻断（声明侧预检）。
 *
 * 本模块只做确定性判断，不调用模型：LLM 结论只能作为审核员的附加告警，
 * 放行/拒绝必须落在这里的规则上（防 Prompt 注入）。
 * 现有 §5.9 六道红线（skill-review.rules）不替换，作为补充规则的输入一起参与判定。
 */

export type SecurityGroupKey =
  'malicious' | 'permissions' | 'network' | 'commands';

export interface SkillPermissions {
  network: string[];
  fs: string[];
  exec: string[];
  secrets: string[];
}

export interface SkillSecurityMeta {
  category: string;
  permissions: SkillPermissions;
  /** 包内是否显式声明了 permissions；未声明按「无网络/无执行」默认拒绝，不阻断存量包 */
  declared: boolean;
  warnings: string[];
}

export interface SecurityFinding {
  group: SecurityGroupKey;
  rule: string;
  file: string;
  excerpt: string;
  detail: string;
}

export interface SecurityGroupResult {
  key: SecurityGroupKey;
  label: string;
  passed: boolean;
  findings: SecurityFinding[];
  warnings: string[];
}

export interface UploadSecurityResult {
  passed: boolean;
  category: string;
  permissions: SkillPermissions;
  metaDeclared: boolean;
  groups: SecurityGroupResult[];
  warnings: string[];
  firstFailure: SecurityGroupResult | null;
}

export interface SecurityScanFile {
  path: string;
  content: string;
}

const GROUP_LABELS: Record<SecurityGroupKey, string> = {
  malicious: '1.1 恶意代码与依赖扫描',
  permissions: '1.2 权限声明与最小化校验',
  network: '1.3 网络出口白名单（声明侧）',
  commands: '1.4 高危命令阻断（声明侧预检）',
};

const GROUP_ORDER: SecurityGroupKey[] = [
  'malicious',
  'permissions',
  'network',
  'commands',
];

function clip(value: string, max: number) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function unique(values: string[], max = 50) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function stripQuotes(value: string) {
  return value.replace(/^["']|["']$/g, '').trim();
}

function listOf(value: unknown, max = 50): string[] {
  if (Array.isArray(value)) {
    return unique(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
      max,
    );
  }
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return listOf(parsed, max);
    } catch {
      // 不是合法 JSON 就按逗号分隔继续尝试
    }
  }
  const unwrapped = raw.replace(/^\[|\]$/g, '');
  return unique(
    unwrapped
      .split(/[,，]/)
      .map((item) => stripQuotes(item))
      .filter(Boolean),
    max,
  );
}

// ---------------- 1.1 恶意代码与依赖 ----------------

const MINER_PATTERN =
  /\b(xmrig|minerd|cpuminer|ethminer|nbminer|lolminer|phoenixminer|t-rex|stratum\+(?:tcp|tls)|supportxmr|nanopool|minexmr|moneroocean)\b/i;
const MONERO_WALLET = /\b[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93}\b/;
const REVERSE_SHELL_PATTERNS: RegExp[] = [
  /\b(?:nc|ncat|netcat)\b[^\n]{0,40}\s-e\s/i,
  /\bsocat\b[^\n]{0,80}\bexec[:=]/i,
  /\bbash\s+-i\s+>&\s*\/dev\/tcp\//i,
  /\/dev\/tcp\/\d{1,3}(?:\.\d{1,3}){3}\/\d{1,5}/i,
  /\bpython[23]?\b[^\n]{0,80}\bsocket\b[^\n]{0,80}\bsubprocess\b/i,
  /\bmkfifo\b[^\n]{0,40}\b(?:nc|ncat|netcat)\b/i,
];
const OBFUSCATION_PATTERNS: RegExp[] = [
  /(?:\\x[0-9a-f]{2}){16,}/i,
  /\b(?:eval|exec)\s*\(\s*(?:atob|base64_decode|Buffer\.from)\s*\(/i,
  /\b(?:base64\s+-d|--decode)\b[^\n]{0,40}\|\s*(?:ba|z|da)?sh\b/i,
  /String\.fromCharCode\s*\([^)]{40,}\)/,
];

/** CNCERT 等通报的已知恶意 Skill 家族名（可按需扩充）。 */
const KNOWN_MALICIOUS_SKILL_NAMES = [
  'bonero-miner',
  'bonero miner',
  'bonerominer',
];

/**
 * 已知恶意文本样本的 SHA-256 黑名单。
 * 生产环境可通过 SKILL_MALICIOUS_SHA256（逗号分隔）追加，无需改代码。
 */
const KNOWN_MALICIOUS_SHA256: string[] = [];

interface BadPackage {
  name: string;
  versions?: string[];
  reason: string;
}

/** 已知被投毒/植入载荷的依赖包（版本为空＝所有版本）。 */
const KNOWN_BAD_NPM: BadPackage[] = [
  {
    name: 'event-stream',
    versions: ['3.3.6'],
    reason: '该版本被植入 flatmap-stream 窃取钱包',
  },
  {
    name: 'flatmap-stream',
    reason: 'event-stream 事件中的恶意载荷包',
  },
  {
    name: 'node-ipc',
    versions: ['10.1.1', '10.1.2'],
    reason: '该版本携带破坏性载荷 peacenotwar',
  },
  {
    name: 'ua-parser-js',
    versions: ['0.7.29', '0.8.0', '1.0.0'],
    reason: '被劫持版本会下载挖矿/窃密脚本',
  },
  {
    name: 'coa',
    versions: ['2.0.3', '2.0.4'],
    reason: '被劫持版本会在安装时执行恶意脚本',
  },
  {
    name: 'rc',
    versions: ['1.2.8', '1.3.6'],
    reason: '被劫持版本会在安装时执行恶意脚本',
  },
];

const KNOWN_BAD_PYPI: BadPackage[] = [
  { name: 'ctx', reason: 'PyPI 抢注包，会窃取环境变量' },
  { name: 'jeilyfish', reason: '仿冒 jellyfish 的抢注包' },
  { name: 'python3-dateutil', reason: '仿冒 python-dateutil 的抢注包' },
  { name: 'libpeshka', reason: '被通报的恶意 PyPI 包' },
  { name: 'colourama', reason: '仿冒 colorama 的抢注包' },
];

function knownMaliciousHashes() {
  const fromEnv = String(process.env.SKILL_MALICIOUS_SHA256 || '')
    .split(/[,，\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[0-9a-f]{64}$/.test(item));
  return new Set([...KNOWN_MALICIOUS_SHA256, ...fromEnv]);
}

function versionMatches(raw: string, bad: BadPackage) {
  if (!bad.versions?.length) return true;
  const clean = raw.trim().replace(/^[~^<>=v\s]+/i, '');
  if (!clean || clean === '*' || clean === 'latest') return true;
  return bad.versions.some((version) => clean === version);
}

function dependencyFindings(files: SecurityScanFile[]): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    const path = file.path.toLowerCase();
    if (path.endsWith('package.json')) {
      let manifest: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(file.content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          continue;
        }
        manifest = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      for (const section of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
      ]) {
        const deps = manifest[section];
        if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
        for (const [name, version] of Object.entries(
          deps as Record<string, unknown>,
        )) {
          const bad = KNOWN_BAD_NPM.find(
            (item) => item.name === name.toLowerCase(),
          );
          if (!bad) continue;
          const rawVersion =
            typeof version === 'string' || typeof version === 'number'
              ? String(version)
              : '';
          if (!versionMatches(rawVersion, bad)) continue;
          findings.push({
            group: 'malicious',
            rule: 'r1.1-bad-dependency',
            file: file.path,
            excerpt: clip(`${name}@${rawVersion}`, 120),
            detail: `依赖 ${name} 命中已知恶意包黑名单：${bad.reason}`,
          });
        }
      }
    }
    if (path.endsWith('requirements.txt') || path.endsWith('pipfile')) {
      for (const line of file.content.split(/\r?\n/)) {
        const text = line.trim();
        if (!text || text.startsWith('#')) continue;
        const match = /^([A-Za-z0-9_.-]+)\s*(?:==|>=|~=|\s)\s*([^\s#;]+)?/.exec(
          text,
        );
        if (!match) continue;
        const bad = KNOWN_BAD_PYPI.find(
          (item) => item.name === match[1].toLowerCase(),
        );
        if (!bad) continue;
        findings.push({
          group: 'malicious',
          rule: 'r1.1-bad-dependency',
          file: file.path,
          excerpt: clip(text, 120),
          detail: `依赖 ${match[1]} 命中已知恶意包黑名单：${bad.reason}`,
        });
      }
    }
  }
  return findings;
}

function patternFindings(files: SecurityScanFile[]): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const hashes = knownMaliciousHashes();
  for (const file of files) {
    if (typeof file.content !== 'string') continue;
    const hash = createHash('sha256').update(file.content).digest('hex');
    if (hashes.has(hash)) {
      findings.push({
        group: 'malicious',
        rule: 'r1.1-malicious-hash',
        file: file.path,
        excerpt: hash.slice(0, 16),
        detail: '文件 SHA-256 命中已知恶意样本黑名单',
      });
    }
    const lines = file.content.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      if (
        MINER_PATTERN.test(line) ||
        MONERO_WALLET.test(line) ||
        KNOWN_MALICIOUS_SKILL_NAMES.some((name) =>
          line.toLowerCase().includes(name),
        )
      ) {
        findings.push({
          group: 'malicious',
          rule: 'r1.1-miner',
          file: file.path,
          excerpt: clip(line, 160),
          detail: '命中挖矿程序/矿池/钱包地址特征',
        });
      }
      if (REVERSE_SHELL_PATTERNS.some((pattern) => pattern.test(line))) {
        findings.push({
          group: 'malicious',
          rule: 'r1.1-reverse-shell',
          file: file.path,
          excerpt: clip(line, 160),
          detail: '命中反弹 shell 特征（nc -e / /dev/tcp / socat exec 等）',
        });
      }
      if (OBFUSCATION_PATTERNS.some((pattern) => pattern.test(line))) {
        findings.push({
          group: 'malicious',
          rule: 'r1.1-obfuscation',
          file: file.path,
          excerpt: clip(line, 160),
          detail: '命中混淆执行特征（十六进制/Base64 + eval/exec）',
        });
      }
    }
  }
  findings.push(...dependencyFindings(files));
  return findings;
}

// ---------------- 1.2 权限声明与最小化 ----------------

/** 不具备网络能力的内容类技能：声明 network 即视为越权（对应基线表的 text_summarize 示例）。 */
const NON_NETWORK_CATEGORIES = new Set([
  'text_summarize',
  'summarize',
  'summarization',
  'writing',
  'translation',
  'text',
  'knowledge-management',
  'office-efficiency',
  'education',
  'uncategorized',
]);

/** 声明式 exec 基线：只有开发类技能允许少量构建/运行时命令。 */
const EXEC_BASELINE: Record<string, Set<string>> = {
  'dev-programming': new Set([
    'node',
    'npm',
    'pnpm',
    'npx',
    'python',
    'python3',
    'pip',
    'pip3',
    'pytest',
    'git',
    'tsc',
    'jest',
    'go',
    'cargo',
    'make',
    'bash',
    'sh',
  ]),
};

/** 平台自有/基础设施密钥，技能包一律不得声明访问。 */
const RESERVED_SECRETS = new Set([
  'DATABASE_URL',
  'DIRECT_DATABASE_URL',
  'JWT_SECRET',
  'AUTH_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'CONTENT_ENCRYPTION_KEY',
  'SMTP_PASSWORD',
  'REDIS_URL',
  'AWS_SECRET_ACCESS_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
]);

const TOP_LEVEL_RE = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/;
const LIST_ITEM_RE = /^-\s+(.*)$/;

function parsePermissionsBlock(lines: string[], start: number) {
  const permissions: Record<string, string[]> = {};
  let current = '';
  let index = start;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) break;
    const trimmed = line.trim();
    const item = LIST_ITEM_RE.exec(trimmed);
    if (item && current) {
      permissions[current] = [
        ...(permissions[current] || []),
        stripQuotes(item[1]),
      ];
      continue;
    }
    const pair = TOP_LEVEL_RE.exec(trimmed);
    if (pair) {
      current = pair[1].toLowerCase();
      if (pair[2]) permissions[current] = listOf(pair[2]);
      else permissions[current] = [];
    }
  }
  return { permissions, end: index };
}

function parseFrontmatter(content: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  let category = '';
  let declared = false;
  let permissions: Record<string, string[]> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) continue;
    const pair = TOP_LEVEL_RE.exec(line.trim());
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = stripQuotes(pair[2]);
    if (key === 'category') category = value;
    if (key === 'permissions') {
      declared = true;
      if (value) {
        if (value.startsWith('{')) {
          try {
            const parsed: unknown = JSON.parse(value);
            if (
              parsed &&
              typeof parsed === 'object' &&
              !Array.isArray(parsed)
            ) {
              for (const [name, raw] of Object.entries(
                parsed as Record<string, unknown>,
              )) {
                permissions[name.toLowerCase()] = listOf(raw);
              }
            }
          } catch {
            // 内联对象写坏了就按空权限处理，交给后续告警
          }
        } else {
          permissions = { ...permissions, ...{} };
        }
      } else {
        const block = parsePermissionsBlock(lines, index + 1);
        permissions = { ...permissions, ...block.permissions };
        index = block.end - 1;
      }
    }
    if (key.startsWith('permissions.')) {
      declared = true;
      const name = key.slice('permissions.'.length).toLowerCase();
      permissions[name] = listOf(value);
    }
    if (key === 'metadata' && !value) {
      // metadata.category 也认，和 name/description 的宽松解析保持一致
      for (let sub = index + 1; sub < lines.length; sub += 1) {
        const nested = lines[sub];
        if (!nested.trim()) continue;
        if (!/^\s/.test(nested)) break;
        const subPair = TOP_LEVEL_RE.exec(nested.trim());
        if (subPair && subPair[1].toLowerCase() === 'category') {
          category = stripQuotes(subPair[2]);
        }
      }
    }
  }
  return { category, declared, permissions };
}

function permissionsFromManifest(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    out[name.toLowerCase()] = listOf(value);
  }
  return out;
}

export function parseSkillSecurityMeta(
  content: string,
  options: { manifest?: Record<string, unknown> } = {},
): SkillSecurityMeta {
  const parsed = parseFrontmatter(content);
  const warnings: string[] = [];
  const declared = Boolean(parsed?.declared);
  let category = parsed?.category || '';
  let rawPermissions = parsed?.permissions || {};

  const manifest = options.manifest;
  if (manifest) {
    if (!category && typeof manifest.category === 'string') {
      category = manifest.category.trim();
    }
    if (
      manifest.permissions &&
      typeof manifest.permissions === 'object' &&
      !Array.isArray(manifest.permissions)
    ) {
      rawPermissions = {
        ...permissionsFromManifest(manifest.permissions),
        ...rawPermissions,
      };
      if (!declared) warnings.push('权限声明来自插件清单 permissions 字段');
    }
  }

  const permissions: SkillPermissions = {
    network: unique(rawPermissions.network || [], 50),
    fs: unique(rawPermissions.fs || [], 50),
    exec: unique(rawPermissions.exec || [], 50),
    secrets: unique(rawPermissions.secrets || [], 50),
  };

  const permissionLists: string[][] = [
    permissions.network,
    permissions.fs,
    permissions.exec,
    permissions.secrets,
  ];

  if (!declared && !permissionLists.some((list) => list.length > 0)) {
    warnings.push(
      '未声明 permissions：按「无网络、无文件权限、无 exec、无密钥」默认拒绝处理；需要能力的技能请在 SKILL.md frontmatter 补齐',
    );
  } else {
    for (const key of ['network', 'fs', 'exec', 'secrets'] as const) {
      if (!(key in rawPermissions)) {
        warnings.push(`permissions.${key} 未声明，按空集处理`);
      }
    }
  }

  return {
    category: (category || 'uncategorized').slice(0, 60),
    permissions,
    declared: declared || permissionLists.some((list) => list.length > 0),
    warnings,
  };
}

// ---------------- 1.3 网络声明 ----------------

const DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const HARD_DENY_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  '0.0.0.0',
  '127.0.0.1',
  '169.254.169.254',
  '100.100.100.200',
  '::1',
]);
const HARD_DENY_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.localdomain',
];
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function networkEntryOf(raw: string) {
  let entry = stripQuotes(raw).trim();
  if (!entry) return { host: '', path: '', problem: '空域名' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) {
    try {
      const url = new URL(entry);
      return { host: url.hostname, path: url.pathname, problem: '' };
    } catch {
      return { host: '', path: '', problem: 'URL 格式不合法' };
    }
  }
  const slash = entry.indexOf('/');
  const hostPart = slash >= 0 ? entry.slice(0, slash) : entry;
  const path = slash >= 0 ? entry.slice(slash) : '';
  entry = hostPart;
  const colon = entry.lastIndexOf(':');
  if (colon > 0) {
    const port = entry.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) {
      return { host: '', path, problem: '端口不合法' };
    }
    entry = entry.slice(0, colon);
  }
  return { host: entry.toLowerCase().replace(/\.$/, ''), path, problem: '' };
}

function networkProblem(raw: string, blacklist: BlacklistEntryLite[]) {
  const { host, path, problem } = networkEntryOf(raw);
  if (problem) return problem;
  if (!host) return '空域名';
  if (host.includes('*') || host.startsWith('.')) {
    return '禁止通配符或泛域名，只能声明精确域名';
  }
  if (IPV4_RE.test(host) || host.includes(':')) {
    return '只允许域名，不允许 IP 字面量';
  }
  if (
    HARD_DENY_HOSTS.has(host) ||
    HARD_DENY_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return '内网/本机/云元数据地址一律拒绝';
  }
  if (!DOMAIN_RE.test(host)) return '域名格式不合法';
  if (path && (!path.startsWith('/') || path.includes('..'))) {
    return '路径前缀不合法或包含 ..';
  }
  if (matchBlacklistHost(blacklist, host)) {
    return '命中平台访问黑名单';
  }
  return '';
}

// ---------------- 1.4 高危命令 ----------------

const DANGEROUS_COMMANDS: Array<{ rule: string; re: RegExp; detail: string }> =
  [
    {
      rule: 'r1.4-rm-rf',
      re: /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\b/i,
      detail: '递归强制删除命令',
    },
    {
      rule: 'r1.4-curl-pipe-shell',
      re: /\b(?:curl|wget)\b[^\n]{0,160}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i,
      detail: '下载后直接管道执行 shell',
    },
    {
      rule: 'r1.4-reverse-shell',
      re: /\b(?:nc|ncat|netcat|socat)\b[^\n]{0,80}\s(?:-e|exec[:=])/i,
      detail: '反弹 shell / 反向连接',
    },
    {
      rule: 'r1.4-dev-tcp',
      re: /\/dev\/tcp\//i,
      detail: '通过 /dev/tcp 建立反向连接',
    },
    {
      rule: 'r1.4-disk',
      re: /\b(?:dd\s+if=|mkfs(?:\.|\s)|wipefs|fdisk|parted)\b/i,
      detail: '磁盘/分区破坏命令',
    },
    {
      rule: 'r1.4-shutdown',
      re: /\b(?:shutdown|reboot|poweroff|halt)\b|systemctl\s+(?:stop|disable|mask)/i,
      detail: '关机/重启/停服务命令',
    },
    {
      rule: 'r1.4-fork-bomb',
      re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
      detail: 'fork 炸弹',
    },
    {
      rule: 'r1.4-base64-shell',
      re: /\bbase64\s+(?:-d|--decode)\b[^\n]{0,60}\|\s*(?:ba|z|da)?sh\b/i,
      detail: 'Base64 解码后管道执行 shell',
    },
    {
      rule: 'r1.4-chmod-root',
      re: /\bchmod\s+(?:-R\s+)?777\s+\/(?!\S)|chown\s+(?:-R\s+)?root\b/i,
      detail: '对根目录/系统文件做危险权限变更',
    },
    {
      rule: 'r1.4-kernel',
      re: /\b(?:insmod|modprobe|ptrace)\b|\bmount\s+(?:-o\s+)?\//i,
      detail: '内核模块/挂载/调试注入命令',
    },
    {
      rule: 'r1.4-powershell-enc',
      re: /\bpowershell(?:\.exe)?\s+(?:-enc|-encodedcommand)\b/i,
      detail: 'PowerShell 编码命令（常见免杀载荷）',
    },
    {
      rule: 'r1.4-miner',
      re: /\b(?:xmrig|minerd|cpuminer|ethminer|nbminer|lolminer|phoenixminer)\b|stratum\+(?:tcp|tls):\/\//i,
      detail: '挖矿程序/矿池连接',
    },
  ];

function dangerousCommandFindings(
  files: SecurityScanFile[],
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    for (const line of file.content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      for (const rule of DANGEROUS_COMMANDS) {
        if (!rule.re.test(line)) continue;
        findings.push({
          group: 'commands',
          rule: rule.rule,
          file: file.path,
          excerpt: clip(line, 160),
          detail: rule.detail,
        });
      }
    }
  }
  return findings;
}

// ---------------- 汇总与串行执行 ----------------

function staticHitToFinding(hit: StaticHit): SecurityFinding {
  const rule = hit.rule;
  const group: SecurityGroupKey = rule.startsWith('r1')
    ? 'commands'
    : rule.startsWith('r2') || rule.startsWith('r3')
      ? 'malicious'
      : rule.startsWith('r5')
        ? 'permissions'
        : rule.startsWith('r4') || rule.startsWith('r6')
          ? 'network'
          : 'malicious';
  const detail = rule.startsWith('r1')
    ? '命中端口扫描/爆破/批量注册/自动提交等行为红线'
    : rule.startsWith('r2')
      ? '请求间隔低于 1 秒'
      : rule.startsWith('r3')
        ? '无休眠死循环或超大并发'
        : rule.startsWith('r5')
          ? '包内出现硬编码凭据'
          : rule.startsWith('r4')
            ? '引用平台访问黑名单中的域名'
            : '引用内网/云元数据地址（SSRF）';
  return {
    group,
    rule,
    file: hit.file,
    excerpt: hit.excerpt,
    detail,
  };
}

function dedupe(findings: SecurityFinding[]) {
  const seen = new Set<string>();
  const out: SecurityFinding[] = [];
  for (const item of findings) {
    const key = `${item.rule}|${item.file}|${item.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 40) break;
  }
  return out;
}

function groupResult(
  key: SecurityGroupKey,
  findings: SecurityFinding[],
  warnings: string[] = [],
): SecurityGroupResult {
  return {
    key,
    label: GROUP_LABELS[key],
    passed: findings.length === 0,
    findings,
    warnings,
  };
}

export interface UploadSecurityInput {
  mainPath: string;
  content: string;
  files: SecurityScanFile[];
  blacklist?: BlacklistEntryLite[];
  /** 插件清单（plugin.json 解析后的对象）里的 category / permissions 也认 */
  manifest?: Record<string, unknown>;
  /** true＝缺少 permissions 声明直接拒绝；默认 false，存量/第三方包按默认拒绝能力放行并告警 */
  strictPermissions?: boolean;
}

/**
 * 串行执行四组检查：任意一组失败立即返回，调用方不得入库。
 * 现有六道红线的命中按语义并入对应组，不另起一套判定。
 */
export function runUploadSecurityGate(
  input: UploadSecurityInput,
): UploadSecurityResult {
  const mainFile = { path: input.mainPath, content: input.content };
  const files = [mainFile, ...input.files];
  const blacklist = input.blacklist || [];
  const meta = parseSkillSecurityMeta(input.content, {
    manifest: input.manifest,
  });
  const staticHits = scanPackageStatic(files, blacklist);
  const mapped = staticHits.map(staticHitToFinding);

  const groups: SecurityGroupResult[] = [];
  const allWarnings = [...meta.warnings];
  let firstFailure: SecurityGroupResult | null = null;

  for (const key of GROUP_ORDER) {
    let findings: SecurityFinding[] = [];
    const warnings: string[] = [];
    if (key === 'malicious') {
      findings = dedupe([
        ...mapped.filter((item) => item.group === 'malicious'),
        ...patternFindings(files),
      ]);
    }
    if (key === 'permissions') {
      findings = mapped.filter((item) => item.group === 'permissions');
      warnings.push(...meta.warnings);
      if (meta.declared || input.strictPermissions) {
        if (input.strictPermissions && !meta.declared) {
          findings.push({
            group: 'permissions',
            rule: 'r1.2-missing-permissions',
            file: input.mainPath,
            excerpt: 'frontmatter 缺少 permissions',
            detail: '技能包必须声明 permissions（network/fs/exec/secrets）',
          });
        }
        const networkOutsideBaseline =
          NON_NETWORK_CATEGORIES.has(meta.category.toLowerCase()) &&
          meta.permissions.network.length > 0;
        if (networkOutsideBaseline) {
          findings.push({
            group: 'permissions',
            rule: 'r1.2-network-outside-baseline',
            file: input.mainPath,
            excerpt: `category=${meta.category}，network=${meta.permissions.network.slice(0, 3).join(',')}`,
            detail: `能力基线不允许 ${meta.category} 申请网络权限`,
          });
        }
        for (const entry of meta.permissions.fs) {
          const problem = fsPathProblem(entry);
          if (!problem) continue;
          findings.push({
            group: 'permissions',
            rule: 'r1.2-fs-outside-baseline',
            file: input.mainPath,
            excerpt: clip(entry, 120),
            detail: `文件权限不合法：${problem}`,
          });
        }
        for (const entry of meta.permissions.exec) {
          if (!/^[A-Za-z0-9._/-]+$/.test(entry)) {
            findings.push({
              group: 'permissions',
              rule: 'r1.2-exec-shell',
              file: input.mainPath,
              excerpt: clip(entry, 120),
              detail: 'exec 只能声明单个命令名，不能带 shell 元字符或参数',
            });
            continue;
          }
          const allowed = EXEC_BASELINE[meta.category.toLowerCase()];
          if (!allowed?.has(entry.toLowerCase())) {
            findings.push({
              group: 'permissions',
              rule: 'r1.2-exec-outside-baseline',
              file: input.mainPath,
              excerpt: clip(entry, 120),
              detail: `能力基线不允许 ${meta.category} 执行命令 ${entry}`,
            });
          }
        }
        for (const entry of meta.permissions.secrets) {
          if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(entry)) {
            findings.push({
              group: 'permissions',
              rule: 'r1.2-secret-format',
              file: input.mainPath,
              excerpt: clip(entry, 120),
              detail: '密钥名必须是大写环境变量名（如 WEATHER_API_KEY）',
            });
            continue;
          }
          if (RESERVED_SECRETS.has(entry)) {
            findings.push({
              group: 'permissions',
              rule: 'r1.2-secret-reserved',
              file: input.mainPath,
              excerpt: entry,
              detail: `不允许声明访问平台密钥 ${entry}`,
            });
          }
        }
      }
      findings = dedupe(findings);
    }
    if (key === 'network') {
      findings = mapped.filter((item) => item.group === 'network');
      for (const entry of meta.permissions.network) {
        const problem = networkProblem(entry, blacklist);
        if (!problem) continue;
        findings.push({
          group: 'network',
          rule: 'r1.3-network-invalid',
          file: input.mainPath,
          excerpt: clip(entry, 120),
          detail: `网络白名单不合法：${problem}`,
        });
      }
      findings = dedupe(findings);
    }
    if (key === 'commands') {
      findings = dedupe([
        ...mapped.filter((item) => item.group === 'commands'),
        ...dangerousCommandFindings(files),
        ...meta.permissions.exec
          .filter((entry) =>
            DANGEROUS_COMMANDS.some((rule) => rule.re.test(entry)),
          )
          .map((entry): SecurityFinding => ({
            group: 'commands',
            rule: 'r1.4-exec-declaration',
            file: input.mainPath,
            excerpt: clip(entry, 120),
            detail: 'exec 声明本身命中高危命令黑名单',
          })),
      ]);
    }
    const result = groupResult(key, findings, warnings);
    groups.push(result);
    if (!result.passed) {
      firstFailure = result;
      break;
    }
  }

  return {
    passed: !firstFailure,
    category: meta.category,
    permissions: meta.permissions,
    metaDeclared: meta.declared,
    groups,
    warnings: unique(allWarnings, 20),
    firstFailure,
  };
}

function fsPathProblem(raw: string) {
  const entry = raw.trim();
  if (!entry) return '空路径';
  const match = /^(read|write)\s*:\s*(.+)$/i.exec(entry);
  const path = (match ? match[2] : entry).trim();
  if (!path) return '空路径';
  if (path === '*' || path.includes('*')) return '不允许通配路径';
  if (/^[A-Za-z]:[\\/]/.test(path)) return '不允许 Windows 盘符绝对路径';
  if (path.startsWith('/') || path.startsWith('~')) {
    return '不允许绝对路径或用户目录';
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(path)) return '不允许 .. 路径穿越';
  if (/^(etc|proc|sys|dev|root|home|boot|var)([\\/]|$)/i.test(path)) {
    return '不允许系统目录';
  }
  return '';
}

/** 审查失败时给上传人的可读结论（最多 3 条证据）。 */
export function formatSecurityFailure(result: UploadSecurityResult) {
  const failure = result.firstFailure;
  if (!failure) return '';
  const lines = failure.findings.slice(0, 3).map((item) => {
    const where = item.file ? `${item.file}：` : '';
    return `${item.detail}（${where}${item.excerpt}）`;
  });
  const more =
    failure.findings.length > lines.length
      ? `；另有 ${failure.findings.length - lines.length} 项命中`
      : '';
  return `技能包未通过上传安全检查「${failure.label}」：${lines.join('；')}${more}。未入库。`;
}

export function hasDeclaredPermissions(permissions: SkillPermissions) {
  return [
    permissions.network,
    permissions.fs,
    permissions.exec,
    permissions.secrets,
  ].some((list) => list.length > 0);
}

/** 把声明权限渲染成人类可读文案（用户二次确认弹窗与审计共用）。 */
export function describePermissions(permissions: SkillPermissions) {
  const lines: string[] = [];
  for (const entry of permissions.network) {
    lines.push(`访问网络域名 ${entry}`);
  }
  for (const entry of permissions.fs) {
    lines.push(`读写文件 ${entry}`);
  }
  for (const entry of permissions.exec) {
    lines.push(`执行命令 ${entry}`);
  }
  for (const entry of permissions.secrets) {
    lines.push(`使用密钥 ${entry}`);
  }
  return lines;
}

/** 审计日志只留证，不把整包内容写进去。 */
export function securityAuditDetail(result: UploadSecurityResult) {
  const failure = result.firstFailure;
  if (!failure) return '通过';
  return failure.findings
    .slice(0, 8)
    .map((item) => `${item.rule}@${item.file}:${item.excerpt}`)
    .join(' | ')
    .slice(0, 1200);
}

/**
 * 运行时复扫：存量技能/插件可能在上线前就已入库，load 时再按同一套确定性规则查一遍。
 * 只查代码/命令/外联风险，不查权限元数据（那是上传时的治理项）。
 */
export function scanRuntimeContent(
  files: SecurityScanFile[],
  blacklist: BlacklistEntryLite[] = [],
): SecurityFinding[] {
  const mapped = scanPackageStatic(files, blacklist)
    .map(staticHitToFinding)
    .filter((item) => item.group !== 'permissions');
  return dedupe([
    ...mapped,
    ...patternFindings(files),
    ...dangerousCommandFindings(files),
  ]);
}

export function describeFindings(findings: SecurityFinding[], max = 3) {
  return findings
    .slice(0, max)
    .map((item) => `${item.detail}（${item.file}：${item.excerpt}）`)
    .join('；');
}
