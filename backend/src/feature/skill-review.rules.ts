import { createHash } from 'node:crypto';

/** 黑名单条目（与 AccessPolicyService 同形，rules 侧只做纯匹配不依赖库）。 */
export interface BlacklistEntryLite {
  type: 'domain' | 'ip' | 'cidr';
  value: string;
}

/** 静态命中项：规则号 + 所在文件 + 证据片段（进台账与前端展示）。 */
export interface StaticHit {
  rule: string;
  file: string;
  excerpt: string;
}

type ScanFile = { path: string; content: string };

/**
 * 单条黑名单匹配（域名含子域 / IP 精确 / CIDR 前段），供静态审查与出口守卫共用。
 */
export function matchBlacklistHost(
  entries: BlacklistEntryLite[],
  rawHost: string,
): boolean {
  const host = rawHost
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return false;
  return entries.some((entry) => {
    if (entry.type === 'domain') {
      return host === entry.value || host.endsWith(`.${entry.value}`);
    }
    if (entry.type === 'ip') return host === entry.value;
    // cidr：v4 按网段前缀字符串匹配（与出口治理口径一致，精细化留给 L1 连接器白名单）
    const seg = entry.value.split('/');
    const prefix = seg[0]
      .split('.')
      .slice(0, Number(seg[1]) > 8 ? 3 : 2)
      .join('.');
    return host.startsWith(`${prefix}.`);
  });
}

// —— 红线 1：端口扫描/爆破/批量注册/短信轰炸/表单自动提交（§5.9.2 用户红线）——
const R1_SCAN_ABUSE =
  /\b(nmap|masscan|zmap|hydra\b|medusa\b|bruteforce|brute[-\s]force|port[-\s]scan)\b|端口扫描|扫描端口|撞库|暴力破解|批量注册|接码|短信轰炸|轰炸.{0,6}(短信|验证码)/i;
const R1_AUTO_SUBMIT =
  /自动(提交|发送|下单|发布|报名|投递)|直接提交表单|无需(用户)?确认.{0,12}(提交|发送|下单|投递)|跳过(二次)?确认.{0,8}(提交|发送)|form\.submit\s*\(|\.submit\s*\(\s*\)/i;

// —— 红线 2：极低请求间隔（<1000ms）——
const R2_FAST_INTERVAL =
  /(?:sleep|delay|wait|interval|throttle|间隔|延迟)[^\d\n]{0,12}(\d{1,3})\s*(?:ms|毫秒)?(?![\d.]|\s*(?:s|sec|秒)\b)/i;

// —— 红线 3：无休眠死循环 / 写死超大并发 ——
const R3_DEAD_LOOP = /\bwhile\s*\(\s*(?:true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)/i;
const R3_BIG_CONCURRENCY =
  /(?:concurrency|并发(?:数|量)?|threads?|线程数?|workers?)[^\d\n]{0,10}(\d{3,})/i;

// —— 红线 5：硬编码密钥（对齐 scripts/scan-secrets.mjs PATTERNS，包内一律不容许）——
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: '私钥块',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  { name: 'AWS AccessKeyId', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub Token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'Slack Token', re: /xox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    name: '连接串内嵌口令',
    re: /\b(?:mysql|postgresql|postgres|redis|mongodb)(?:\+\w+)?:\/\/[^\s'"]*:[^\s'"]+@[^\s'"]+/i,
  },
  {
    name: '明文密钥赋值',
    re: /\b(?:password|passwd|secret|access_key|accesskey|api_key|apikey|token)\s*[:=]\s*["'`][^"'`]{8,}["'`]/i,
  },
  {
    name: '硬编码 Cookie/Authorization',
    re: /\b(?:cookie|authorization)\s*[:=]\s*["'`]?\s*(?:Bearer\s+)?[A-Za-z0-9_\-.=]{16,}/i,
  },
];
// 占位标记（示例文档常见）命中则放行，口径与 scan-secrets 一致。
const SECRET_PLACEHOLDER =
  /REPLACE_|CHANGE[-_]|change-me|change-this|your-|placeholder|example\.com|\.example|xxxxxxxx|<[^>]+>|\$\{|process\.env|\bTODO\b|not-real|fake|sk-xxx/i;

// —— 红线 6：内网地址字面量（SSRF）——
const R6_INTERNAL_ADDRESS: RegExp[] = [
  /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
  /\b169\.254\.\d{1,3}\.\d{1,3}\b/,
  /\b100\.64\.\d{1,3}\.\d{1,3}\b/,
  /\blocalhost\b/i,
  /\.internal\b/i,
  /\bmetadata\.google\b/i,
];

// 红线 4：包内 URL 域名对照平台黑名单。
const URL_HOST_RE = /https?:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])/g;

function hit(rule: string, file: string, text: string): StaticHit {
  return {
    rule,
    file,
    excerpt: String(text).replace(/\s+/g, ' ').trim().slice(0, 160),
  };
}

function scanText(
  file: ScanFile,
  blacklist: BlacklistEntryLite[],
): StaticHit[] {
  const hits: StaticHit[] = [];
  const content = file.content;
  for (const line of content.split(/\r?\n/)) {
    const m1 = R1_SCAN_ABUSE.exec(line) || R1_AUTO_SUBMIT.exec(line);
    if (m1) hits.push(hit('r1-scan-abuse', file.path, line));
    const m2 = R2_FAST_INTERVAL.exec(line);
    if (m2 && Number(m2[1]) > 0)
      hits.push(hit('r2-fast-interval', file.path, line));
    const m3 = R3_DEAD_LOOP.exec(line);
    if (m3) hits.push(hit('r3-dead-loop', file.path, line));
    const m3b = R3_BIG_CONCURRENCY.exec(line);
    if (m3b && Number(m3b[1]) >= 100)
      hits.push(hit('r3-big-concurrency', file.path, line));
    for (const re of R6_INTERNAL_ADDRESS) {
      const m6 = re.exec(line);
      if (m6) {
        hits.push(hit('r6-internal-address', file.path, line));
        break;
      }
    }
    for (const { name, re } of SECRET_PATTERNS) {
      const ms = re.exec(line);
      if (!ms) continue;
      if (SECRET_PLACEHOLDER.test(ms[0]) || SECRET_PLACEHOLDER.test(line))
        continue;
      hits.push(hit(`r5-hardcoded-secret(${name})`, file.path, line));
    }
  }
  URL_HOST_RE.lastIndex = 0;
  let mu: RegExpExecArray | null;
  const checked = new Set<string>();
  while ((mu = URL_HOST_RE.exec(content))) {
    const host = mu[1];
    if (checked.has(host)) continue;
    checked.add(host);
    if (matchBlacklistHost(blacklist, host))
      hits.push(hit('r4-blacklisted-domain', file.path, `http://${host}`));
  }
  return hits;
}

/**
 * 六道行为红线的静态扫描（§5.9.1 第①步，确定性、零 token）：
 * 命中即为硬红线，直接 rejected，LLM 结论不可推翻。
 * 输入是包正文 + files 全文（均按文本处理，本站不执行包内脚本）。
 */
export function scanPackageStatic(
  files: ScanFile[],
  blacklist: BlacklistEntryLite[],
): StaticHit[] {
  const hits: StaticHit[] = [];
  for (const file of files) {
    if (typeof file.content !== 'string') continue;
    hits.push(...scanText(file, blacklist));
    if (hits.length >= 30) break; // 台账留证够用了，别把恶意大包的全量命中塞进 JSON
  }
  // 去重（同规则同文件重复命中只记一次）
  const seen = new Set<string>();
  return hits.filter((item) => {
    const key = `${item.rule}|${item.file}|${item.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 包内容摘要（sha256）：台账去重与「同包重传是否变了内容」审计。 */
export function packageDigest(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n\u0000')).digest('hex');
}
