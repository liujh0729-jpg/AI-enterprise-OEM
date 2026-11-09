import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { httpRequest, TransportError } from '../http/transport';
import { assertOutboundUrl } from '../http/outbound-guard';
import {
  clip,
  issueFix,
  normalizeDomain,
  num,
  sameSite,
  text,
} from './seo-shared';

/**
 * 站点体检爬虫（免费层）：纯 HTTP + cheerio 解析，不在服务器装 Chrome/渲染服务。
 * 四阶段：发现（robots/sitemap）→ 爬取（同域、尊重 robots、并发窗口、有界读取）
 * → 解析（title/meta/canonical/h/字数/图片/链接/JSON-LD/hreflang）→ 检查（约 30 项规则）。
 * 口径：基于服务端 HTML，SPA 客户端渲染内容测不到（结果页明示）。
 */

export type RobotsRule = { agent: string; allow: string[]; disallow: string[] };
export type RobotsInfo = {
  rules: RobotsRule[];
  sitemaps: string[];
  raw: string;
  /** robots.txt 本身是否抓取成功（404 视为「无 robots」，不是错误）。 */
  found: boolean;
};

export type ParsedImage = { src: string; alt: string; lazy: boolean };
export type ParsedLink = { href: string; internal: boolean; rel: string };
export type ParsedPage = {
  url: string;
  finalUrl: string;
  fetchStatus: 'OK' | 'BLOCKED' | 'TIMEOUT' | 'NON_HTML' | 'ERROR';
  httpStatus: number;
  redirectChain: number;
  title: string;
  metaDescription: string;
  canonical: string;
  h1: string[];
  h2Count: number;
  headings: string[];
  wordCount: number;
  images: ParsedImage[];
  links: ParsedLink[];
  jsonLd: string[];
  jsonLdErrors: string[];
  hreflang: Array<{ lang: string; href: string }>;
  robotsMeta: string;
  xRobotsTag: string;
  noindex: boolean;
  bytes: number;
  blockingScripts: number;
  mixedContent: number;
  contentHash: string;
  html: string;
};

export type CrawlIssue = {
  url: string;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  detail: string;
  fixHint: string;
  pageUrl?: string;
};

export type CrawlResult = {
  pages: ParsedPage[];
  issues: CrawlIssue[];
  robots: RobotsInfo;
  sitemapUrls: string[];
  healthScore: number;
  criticalCount: number;
  warningCount: number;
  phase: string;
  errorCode: string;
};

const AI_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Google-Extended',
  'Bytespider',
  'CCBot',
];

const UA =
  'Mozilla/5.0 (compatible; OEMEnterpriseSEO/1.0; +https://aiworkin.com)';
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** robots.txt 解析：User-agent 分组 + Allow/Disallow + Sitemap 声明。 */
export function parseRobots(raw: string, found = true): RobotsInfo {
  const rules: RobotsRule[] = [];
  const sitemaps: string[] = [];
  let current: RobotsRule[] = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const clean = line.split('#')[0].trim();
    if (!clean) continue;
    const index = clean.indexOf(':');
    if (index < 0) continue;
    const field = clean.slice(0, index).trim().toLowerCase();
    const value = clean.slice(index + 1).trim();
    if (field === 'user-agent') {
      if (
        !current.length ||
        current[0].allow.length ||
        current[0].disallow.length
      )
        current = [];
      const rule: RobotsRule = {
        agent: value.toLowerCase(),
        allow: [],
        disallow: [],
      };
      rules.push(rule);
      current.push(rule);
    } else if (field === 'disallow' && value) {
      for (const rule of current) rule.disallow.push(value);
    } else if (field === 'allow' && value) {
      for (const rule of current) rule.allow.push(value);
    } else if (field === 'sitemap' && value) {
      sitemaps.push(value);
    }
  }
  return { rules, sitemaps, raw: String(raw || ''), found };
}

/** 最长匹配优先（Google 口径）：Allow 与 Disallow 同长时 Allow 胜。 */
export function robotsAllowed(
  info: RobotsInfo,
  path: string,
  agent = '*',
): boolean {
  const target = agent.toLowerCase();
  const groups = info.rules.filter(
    (rule) => rule.agent === target || rule.agent === '*',
  );
  const specific = groups.filter((rule) => rule.agent === target);
  const applicable = specific.length ? specific : groups;
  let best: { length: number; allow: boolean } | null = null;
  for (const rule of applicable) {
    for (const pattern of rule.disallow) {
      if (matchRobotsPath(pattern, path)) {
        const length = pattern.replace(/[*$]/g, '').length;
        if (!best || length > best.length) best = { length, allow: false };
      }
    }
    for (const pattern of rule.allow) {
      if (matchRobotsPath(pattern, path)) {
        const length = pattern.replace(/[*$]/g, '').length;
        if (!best || length >= best.length) best = { length, allow: true };
      }
    }
  }
  return best ? best.allow : true;
}

function matchRobotsPath(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(
    `^${body
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}${anchored ? '$' : ''}`,
  );
  return regex.test(path);
}

/** robots 是否封锁某个 AI 爬虫（整站 Disallow: / 才算封锁）。 */
export function blockedAiBots(info: RobotsInfo): string[] {
  return AI_BOTS.filter((bot) => {
    const target = bot.toLowerCase();
    const groups = info.rules.filter((rule) => rule.agent === target);
    const applicable = groups.length
      ? groups
      : info.rules.filter((rule) => rule.agent === '*');
    return applicable.some(
      (rule) =>
        rule.disallow.some((pattern) => pattern.trim() === '/') &&
        !rule.allow.some((pattern) => pattern.trim() === '/'),
    );
  });
}

/** sitemap 解析：urlset 取 loc；sitemapindex 取子 sitemap 地址（由调用方再抓）。 */
export function parseSitemap(raw: string): {
  urls: string[];
  children: string[];
  valid: boolean;
} {
  const source = String(raw || '');
  if (!/<(urlset|sitemapindex)/i.test(source))
    return { urls: [], children: [], valid: false };
  const isIndex = /<sitemapindex/i.test(source);
  const locs = [...source.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(
    (match) => decodeEntities(match[1].trim()),
  );
  return isIndex
    ? { urls: [], children: locs, valid: locs.length > 0 }
    : { urls: locs, children: [], valid: locs.length > 0 };
}

export function decodeEntities(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

/** 中英文混排字数：CJK 逐字计，拉丁按词计。 */
export function countWords(value: string): number {
  const source = String(value || '');
  const cjk = (source.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || [])
    .length;
  const latin = (
    source
      .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
      .match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []
  ).length;
  return cjk + latin;
}

const stripTags = (value: string): string =>
  decodeEntities(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

/** 单页 HTML 解析（cheerio，纯 JS，无浏览器）。 */
export function parsePage(
  html: string,
  url: string,
  domain: string,
  meta: {
    fetchStatus?: ParsedPage['fetchStatus'];
    httpStatus?: number;
    redirectChain?: number;
    xRobotsTag?: string;
    includeSubdomains?: boolean;
  } = {},
): ParsedPage {
  const source = String(html || '');
  const $ = load(source);
  const base = (() => {
    try {
      return new URL(url);
    } catch {
      return new URL(`https://${normalizeDomain(domain)}`);
    }
  })();
  const absolute = (href: string): string => {
    try {
      return new URL(href, base).toString();
    } catch {
      return '';
    }
  };
  const title = clip(
    $('head > title').first().text() || $('title').first().text(),
    500,
  );
  const metaDescription = clip(
    $('meta[name="description" i]').attr('content') || '',
    1000,
  );
  const canonical = clip(
    absolute($('link[rel="canonical" i]').attr('href') || ''),
    500,
  );
  const h1 = $('h1')
    .map((_, element) => stripTags($(element).html() || ''))
    .get()
    .filter(Boolean)
    .slice(0, 10);
  const headings = $('h1,h2,h3,h4,h5,h6')
    .map((_, element) => stripTags($(element).html() || ''))
    .get()
    .filter(Boolean)
    .slice(0, 60);
  const bodyText = stripTags($('body').html() || source);
  const images: ParsedImage[] = $('img')
    .map((_, element) => {
      const node = $(element);
      const src = node.attr('src') || node.attr('data-src') || '';
      return {
        src: clip(absolute(src), 500),
        alt: clip(node.attr('alt') ?? '', 300),
        lazy:
          String(node.attr('loading') || '').toLowerCase() === 'lazy' ||
          Boolean(node.attr('data-src')),
      };
    })
    .get()
    .slice(0, 500);
  const links: ParsedLink[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, element) => {
    const node = $(element);
    const href = absolute(node.attr('href') || '');
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:'))
      return;
    if (seen.has(href)) return;
    seen.add(href);
    links.push({
      href: clip(href, 500),
      internal: sameSite(href, domain, meta.includeSubdomains),
      rel: clip(node.attr('rel') || '', 60),
    });
  });
  const jsonLd: string[] = [];
  const jsonLdErrors: string[] = [];
  $('script[type="application/ld+json" i]').each((_, element) => {
    const raw = $(element).html() || '';
    jsonLd.push(raw);
    try {
      JSON.parse(raw);
    } catch (error) {
      jsonLdErrors.push(
        clip(error instanceof Error ? error.message : error, 200),
      );
    }
  });
  const hreflang = $('link[rel="alternate" i][hreflang]')
    .map((_, element) => ({
      lang: clip($(element).attr('hreflang') || '', 20),
      href: clip(absolute($(element).attr('href') || ''), 500),
    }))
    .get()
    .slice(0, 50);
  const robotsMeta = clip(
    $('meta[name="robots" i]').attr('content') || '',
    200,
  );
  const xRobotsTag = clip(meta.xRobotsTag || '', 200);
  const noindex = /noindex/i.test(`${robotsMeta} ${xRobotsTag}`);
  const blockingScripts = $('script[src]').filter((_, element) => {
    const node = $(element);
    return (
      !node.attr('defer') &&
      !node.attr('async') &&
      String(node.attr('type') || '').toLowerCase() !== 'module'
    );
  }).length;
  const mixedContent = $('img[src],script[src],link[href],iframe[src]').filter(
    (_, element) => {
      const node = $(element);
      const value = node.attr('src') || node.attr('href') || '';
      return /^http:\/\//i.test(value);
    },
  ).length;
  return {
    url,
    finalUrl: url,
    fetchStatus: meta.fetchStatus || 'OK',
    httpStatus: num(meta.httpStatus, 200),
    redirectChain: num(meta.redirectChain, 0),
    title,
    metaDescription,
    canonical,
    h1,
    h2Count: $('h2').length,
    headings,
    wordCount: countWords(bodyText),
    images,
    links: links.slice(0, 1000),
    jsonLd,
    jsonLdErrors,
    hreflang,
    robotsMeta,
    xRobotsTag,
    noindex,
    bytes: Buffer.byteLength(source, 'utf8'),
    blockingScripts,
    mixedContent,
    contentHash: createHash('sha256').update(bodyText).digest('hex'),
    html: source,
  };
}

/** 有界抓取：manual 重定向自限次数，逐跳过 outbound-guard，429 退避一次。 */
export async function fetchHtml(
  startUrl: string,
  domain: string,
  options: { includeSubdomains?: boolean; timeoutMs?: number } = {},
): Promise<ParsedPage> {
  let url = startUrl;
  let redirects = 0;
  for (;;) {
    await assertOutboundUrl(url, '体检目标页');
    let response;
    try {
      response = await httpRequest<string>(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
        },
        readAs: 'text',
        timeoutMs: options.timeoutMs ?? 20_000,
        maxBytes: MAX_PAGE_BYTES,
        concurrency: 4,
        limiterKey: `seo-crawl:${normalizeDomain(domain)}`,
        operation: 'seo.crawl',
        redirect: 'manual',
      });
    } catch (error) {
      const kind = error instanceof TransportError ? error.kind : 'network';
      return {
        ...parsePage('', url, domain, {
          fetchStatus: kind === 'timeout' ? 'TIMEOUT' : 'ERROR',
          httpStatus: 0,
          redirectChain: redirects,
          includeSubdomains: options.includeSubdomains,
        }),
      };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location') || '';
      redirects += 1;
      if (!location || redirects > MAX_REDIRECTS) {
        return parsePage('', url, domain, {
          fetchStatus: 'ERROR',
          httpStatus: response.status,
          redirectChain: redirects,
          includeSubdomains: options.includeSubdomains,
        });
      }
      let next: string;
      try {
        next = new URL(location, url).toString();
      } catch {
        return parsePage('', url, domain, {
          fetchStatus: 'ERROR',
          httpStatus: response.status,
          redirectChain: redirects,
        });
      }
      if (!sameSite(next, domain, options.includeSubdomains)) {
        return parsePage('', url, domain, {
          fetchStatus: 'BLOCKED',
          httpStatus: response.status,
          redirectChain: redirects,
        });
      }
      url = next;
      continue;
    }
    if (response.status === 429) {
      // 礼貌爬虫：退避一次后仍 429 就记 BLOCKED，不硬闯
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const retry = await httpRequest<string>(url, {
        headers: { 'User-Agent': UA },
        readAs: 'text',
        timeoutMs: options.timeoutMs ?? 20_000,
        maxBytes: MAX_PAGE_BYTES,
        concurrency: 2,
        limiterKey: `seo-crawl:${normalizeDomain(domain)}`,
        operation: 'seo.crawl.retry',
        redirect: 'manual',
      }).catch(() => null);
      if (!retry || retry.status === 429)
        return parsePage('', url, domain, {
          fetchStatus: 'BLOCKED',
          httpStatus: 429,
          redirectChain: redirects,
        });
      response = retry;
    }
    const contentType = String(response.headers.get('content-type') || '');
    if (response.status === 401 || response.status === 403)
      return parsePage('', url, domain, {
        fetchStatus: 'BLOCKED',
        httpStatus: response.status,
        redirectChain: redirects,
      });
    if (response.status >= 400)
      return parsePage('', url, domain, {
        fetchStatus: 'ERROR',
        httpStatus: response.status,
        redirectChain: redirects,
      });
    if (contentType && !/html|xml|text\/plain/i.test(contentType))
      return parsePage('', url, domain, {
        fetchStatus: 'NON_HTML',
        httpStatus: response.status,
        redirectChain: redirects,
      });
    const page = parsePage(text(response.data), url, domain, {
      fetchStatus: 'OK',
      httpStatus: response.status,
      redirectChain: redirects,
      xRobotsTag: response.headers.get('x-robots-tag') || '',
      includeSubdomains: options.includeSubdomains,
    });
    page.finalUrl = url;
    return page;
  }
}

async function fetchText(url: string, domain: string, operation: string) {
  await assertOutboundUrl(url, '体检发现阶段地址');
  const response = await httpRequest<string>(url, {
    headers: { 'User-Agent': UA },
    readAs: 'text',
    timeoutMs: 15_000,
    maxBytes: 2 * 1024 * 1024,
    concurrency: 2,
    limiterKey: `seo-crawl:${normalizeDomain(domain)}`,
    operation,
    redirect: 'manual',
  }).catch(() => null);
  return response;
}

/** 发现阶段：robots.txt + sitemap（含 sitemapindex 一层展开，上限 2000 URL）。 */
export async function discover(
  domain: string,
  startUrl: string,
): Promise<{
  robots: RobotsInfo;
  sitemapUrls: string[];
  sitemapStatus: string;
}> {
  const origin = new URL(startUrl).origin;
  const robotsResponse = await fetchText(
    `${origin}/robots.txt`,
    domain,
    'seo.crawl.robots',
  );
  const robots =
    robotsResponse && robotsResponse.ok
      ? parseRobots(text(robotsResponse.data), true)
      : parseRobots('', false);
  const candidates = robots.sitemaps.length
    ? robots.sitemaps
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const urls = new Set<string>();
  let sitemapStatus = 'MISSING';
  for (const candidate of candidates.slice(0, 5)) {
    if (!sameSite(candidate, domain, true)) continue;
    const response = await fetchText(candidate, domain, 'seo.crawl.sitemap');
    if (!response || !response.ok) continue;
    const parsed = parseSitemap(text(response.data));
    if (!parsed.valid) {
      sitemapStatus = 'INVALID';
      continue;
    }
    sitemapStatus = 'OK';
    for (const url of parsed.urls) urls.add(url);
    for (const child of parsed.children.slice(0, 10)) {
      if (!sameSite(child, domain, true)) continue;
      const childResponse = await fetchText(
        child,
        domain,
        'seo.crawl.sitemap.child',
      );
      if (!childResponse?.ok) continue;
      const childParsed = parseSitemap(text(childResponse.data));
      for (const url of childParsed.urls) urls.add(url);
      if (urls.size >= 2000) break;
    }
    if (urls.size) break;
  }
  return { robots, sitemapUrls: [...urls].slice(0, 2000), sitemapStatus };
}

/** 检查阶段：约 30 项确定性规则（严重/警告/提示三级），每项带「为什么 + 怎么修」。 */
export function runChecks(input: {
  pages: ParsedPage[];
  robots: RobotsInfo;
  sitemapUrls: string[];
  sitemapStatus: string;
  domain: string;
  includeSubdomains?: boolean;
}): CrawlIssue[] {
  const issues: CrawlIssue[] = [];
  const push = (
    type: string,
    severity: CrawlIssue['severity'],
    url: string,
    detail: string,
    pageUrl?: string,
  ) => {
    issues.push({
      type,
      severity,
      url: clip(url, 500),
      detail: clip(detail, 1000),
      fixHint: issueFix(type),
      pageUrl,
    });
  };
  const { pages, robots, sitemapUrls, sitemapStatus, domain } = input;
  const okPages = pages.filter((page) => page.fetchStatus === 'OK');
  const sitemapSet = new Set(
    sitemapUrls.map((url) => url.replace(/\/$/, '').toLowerCase()),
  );
  const inbound = new Map<string, number>();
  for (const page of okPages)
    for (const link of page.links)
      if (link.internal)
        inbound.set(
          link.href.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase(),
          (inbound.get(
            link.href.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase(),
          ) || 0) + 1,
        );

  // 站点级：robots / sitemap / AI 爬虫
  if (robots.found) {
    const blockedAll = robots.rules.some(
      (rule) =>
        rule.agent === '*' &&
        rule.disallow.some((pattern) => pattern.trim() === '/') &&
        !rule.allow.some((pattern) => pattern.trim() === '/'),
    );
    if (blockedAll)
      push(
        'ROBOTS_BLOCKED',
        'CRITICAL',
        `https://${domain}/robots.txt`,
        'robots.txt 对全部爬虫 Disallow: /，搜索引擎无法抓取任何页面。',
      );
  }
  const aiBlocked = blockedAiBots(robots);
  if (aiBlocked.length)
    push(
      'ROBOTS_AI_BLOCKED',
      'WARNING',
      `https://${domain}/robots.txt`,
      `robots.txt 封锁了 AI 爬虫：${aiBlocked.join(
        '、',
      )}。AI 引擎抓不到你的内容，GEO 可见度受损（可到「GEO-AI引擎优化」复核提及率）。`,
    );
  if (sitemapStatus === 'MISSING')
    push(
      'SITEMAP_MISSING',
      'WARNING',
      `https://${domain}/sitemap.xml`,
      '未发现可用 sitemap（robots 未声明，常见地址也取不到）。',
    );
  if (sitemapStatus === 'INVALID')
    push(
      'SITEMAP_INVALID',
      'WARNING',
      `https://${domain}/sitemap.xml`,
      'sitemap 地址可访问但不是合法 urlset/sitemapindex XML。',
    );

  // 页面级
  const titleMap = new Map<string, string[]>();
  const metaMap = new Map<string, string[]>();
  const hashMap = new Map<string, string[]>();
  for (const page of pages) {
    if (page.fetchStatus === 'BLOCKED') {
      push(
        'FETCH_BLOCKED',
        'WARNING',
        page.url,
        `抓取被拒（HTTP ${page.httpStatus}），该页未纳入检查。`,
        page.url,
      );
      continue;
    }
    if (page.fetchStatus === 'TIMEOUT') {
      push('FETCH_TIMEOUT', 'WARNING', page.url, '抓取超时（20s）。', page.url);
      continue;
    }
    if (page.fetchStatus === 'ERROR') {
      push(
        'BROKEN_LINK',
        'CRITICAL',
        page.url,
        `页面返回 HTTP ${page.httpStatus || '错误'}。`,
        page.url,
      );
      continue;
    }
    if (page.fetchStatus === 'NON_HTML') continue;

    if (!page.title)
      push(
        'TITLE_MISSING',
        'CRITICAL',
        page.url,
        '页面缺少 <title>。',
        page.url,
      );
    else {
      const key = page.title.trim().toLowerCase();
      titleMap.set(key, [...(titleMap.get(key) || []), page.url]);
      if ([...page.title].length > 60)
        push(
          'TITLE_TOO_LONG',
          'INFO',
          page.url,
          `标题 ${[...page.title].length} 字符，超过 60 字符会被截断。`,
          page.url,
        );
    }
    const metaKey = page.metaDescription.trim().toLowerCase();
    if (!metaKey)
      push(
        'META_MISSING',
        'WARNING',
        page.url,
        '页面缺少 meta description。',
        page.url,
      );
    else metaMap.set(metaKey, [...(metaMap.get(metaKey) || []), page.url]);
    if (!page.canonical)
      push(
        'CANONICAL_MISSING',
        'INFO',
        page.url,
        '页面缺少 rel=canonical。',
        page.url,
      );
    else if (!sameSite(page.canonical, domain, input.includeSubdomains))
      push(
        'CANONICAL_CONFLICT',
        'WARNING',
        page.url,
        `canonical 指向站外：${page.canonical}`,
        page.url,
      );
    if (page.noindex)
      push(
        'NOINDEX',
        'WARNING',
        page.url,
        `页面带 noindex（meta: ${page.robotsMeta || '无'}；X-Robots-Tag: ${
          page.xRobotsTag || '无'
        }），不会进索引。`,
        page.url,
      );
    for (const item of page.hreflang) {
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$|^x-default$/i.test(item.lang))
        push(
          'HREFLANG_INVALID',
          'WARNING',
          page.url,
          `hreflang 代码非法：${item.lang}`,
          page.url,
        );
    }
    if (page.wordCount < 300)
      push(
        'THIN_CONTENT',
        'WARNING',
        page.url,
        `正文约 ${page.wordCount} 字（词），低于 300 的薄内容阈值。`,
        page.url,
      );
    if (!page.h1.length)
      push('H1_MISSING', 'WARNING', page.url, '页面缺少 H1。', page.url);
    else if (page.h1.length > 1)
      push(
        'H1_MULTIPLE',
        'INFO',
        page.url,
        `页面有 ${page.h1.length} 个 H1。`,
        page.url,
      );
    if (!page.jsonLd.length)
      push(
        'JSONLD_MISSING',
        'INFO',
        page.url,
        '页面没有 JSON-LD 结构化数据。',
        page.url,
      );
    if (page.jsonLdErrors.length)
      push(
        'JSONLD_INVALID',
        'WARNING',
        page.url,
        `JSON-LD 解析失败：${page.jsonLdErrors.join('；')}`,
        page.url,
      );
    const missingAlt = page.images.filter((image) => !image.alt.trim()).length;
    if (missingAlt)
      push(
        'IMAGE_ALT_MISSING',
        'INFO',
        page.url,
        `${missingAlt}/${page.images.length} 张图片缺少 alt。`,
        page.url,
      );
    if (page.mixedContent)
      push(
        'MIXED_CONTENT',
        'WARNING',
        page.url,
        `${page.mixedContent} 处资源仍用 http://（混合内容）。`,
        page.url,
      );
    if (page.bytes > 500 * 1024)
      push(
        'PAGE_TOO_LARGE',
        'INFO',
        page.url,
        `HTML 体积 ${(page.bytes / 1024).toFixed(0)} KB，超过 500 KB。`,
        page.url,
      );
    if (page.blockingScripts > 5)
      push(
        'BLOCKING_SCRIPTS',
        'INFO',
        page.url,
        `${page.blockingScripts} 个同步阻塞脚本（无 defer/async）。`,
        page.url,
      );
    const noLazy = page.images.filter((image) => !image.lazy).length;
    if (page.images.length > 5 && noLazy === page.images.length)
      push(
        'IMAGE_NO_LAZY',
        'INFO',
        page.url,
        `${page.images.length} 张图片全部未懒加载。`,
        page.url,
      );
    if (page.redirectChain >= 2)
      push(
        'REDIRECT_CHAIN',
        'INFO',
        page.url,
        `到达该页经过 ${page.redirectChain} 次重定向。`,
        page.url,
      );
    const normalized = page.url.replace(/\/$/, '').toLowerCase();
    if (
      sitemapSet.size &&
      !sitemapSet.has(normalized) &&
      !(inbound.get(normalized) || 0)
    )
      push(
        'ORPHAN_PAGE',
        'WARNING',
        page.url,
        '该页既不在 sitemap，也没有其它已抓页面内链指向。',
        page.url,
      );
    hashMap.set(page.contentHash, [
      ...(hashMap.get(page.contentHash) || []),
      page.url,
    ]);
    // 断链：站内链接指向本次已抓到的失败页
    for (const link of page.links) {
      if (!link.internal) continue;
      const target = pages.find(
        (candidate) =>
          candidate.url.replace(/\/$/, '').toLowerCase() ===
          link.href.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase(),
      );
      if (
        target &&
        (target.fetchStatus === 'ERROR' || target.httpStatus >= 400)
      )
        push(
          'BROKEN_LINK',
          'WARNING',
          page.url,
          `内链指向失败页：${link.href}（HTTP ${target.httpStatus}）`,
          page.url,
        );
    }
  }
  for (const [title, urls] of titleMap)
    if (urls.length > 1)
      push(
        'TITLE_DUPLICATE',
        'WARNING',
        urls[0],
        `${urls.length} 个页面共用标题「${clip(title, 80)}」：${urls
          .slice(0, 5)
          .join('、')}`,
      );
  for (const [, urls] of metaMap)
    if (urls.length > 1)
      push(
        'META_DUPLICATE',
        'INFO',
        urls[0],
        `${urls.length} 个页面共用同一段描述：${urls.slice(0, 5).join('、')}`,
      );
  for (const [hash, urls] of hashMap)
    if (urls.length > 1 && hash)
      push(
        'KEYWORD_CANNIBALIZATION',
        'WARNING',
        urls[0],
        `${urls.length} 个页面正文完全相同（疑似重复/自蚕食）：${urls
          .slice(0, 5)
          .join('、')}`,
      );
  return issues;
}

export function healthScoreOf(issues: CrawlIssue[]): number {
  const critical = issues.filter((item) => item.severity === 'CRITICAL').length;
  const warning = issues.filter((item) => item.severity === 'WARNING').length;
  const info = issues.filter((item) => item.severity === 'INFO').length;
  return Math.max(0, Math.min(100, 100 - critical * 8 - warning * 3 - info));
}

/** 爬取编排：广度优先、同域限定、尊重 robots、并发窗口 4、页数上限。 */
export async function crawlSite(input: {
  domain: string;
  startUrl: string;
  maxPages: number;
  includeSubdomains: boolean;
  onPhase?: (phase: string, pageCount: number) => Promise<void> | void;
}): Promise<CrawlResult> {
  const domain = normalizeDomain(input.domain);
  const maxPages = Math.min(200, Math.max(1, input.maxPages));
  await input.onPhase?.('DISCOVER', 0);
  const { robots, sitemapUrls, sitemapStatus } = await discover(
    domain,
    input.startUrl,
  );
  const queue: string[] = [input.startUrl];
  const seen = new Set<string>([canonicalKey(input.startUrl)]);
  for (const url of sitemapUrls) {
    if (!sameSite(url, domain, input.includeSubdomains)) continue;
    const key = canonicalKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(url);
  }
  const pages: ParsedPage[] = [];
  await input.onPhase?.('CRAWL', 0);
  while (queue.length && pages.length < maxPages) {
    const batch = queue.splice(0, 4);
    const results = await Promise.all(
      batch.map(async (url) => {
        const path = (() => {
          try {
            return new URL(url).pathname;
          } catch {
            return '/';
          }
        })();
        if (!robotsAllowed(robots, path)) {
          return parsePage('', url, domain, {
            fetchStatus: 'BLOCKED',
            httpStatus: 0,
            includeSubdomains: input.includeSubdomains,
          });
        }
        return fetchHtml(url, domain, {
          includeSubdomains: input.includeSubdomains,
        });
      }),
    );
    for (const page of results) {
      pages.push(page);
      if (page.fetchStatus !== 'OK') continue;
      for (const link of page.links) {
        if (!link.internal) continue;
        if (/noindex/i.test(page.robotsMeta)) continue;
        const key = canonicalKey(link.href);
        if (seen.has(key)) continue;
        seen.add(key);
        if (/\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|css|js)$/i.test(link.href))
          continue;
        queue.push(link.href.split('#')[0]);
      }
    }
    await input.onPhase?.('CRAWL', pages.length);
  }
  await input.onPhase?.('CHECK', pages.length);
  const issues = runChecks({
    pages,
    robots,
    sitemapUrls,
    sitemapStatus,
    domain,
    includeSubdomains: input.includeSubdomains,
  });
  return {
    pages,
    issues,
    robots,
    sitemapUrls,
    healthScore: healthScoreOf(issues),
    criticalCount: issues.filter((item) => item.severity === 'CRITICAL').length,
    warningCount: issues.filter((item) => item.severity === 'WARNING').length,
    phase: 'DONE',
    errorCode: '',
  };
}

const canonicalKey = (url: string): string =>
  String(url || '')
    .split('#')[0]
    .replace(/\/$/, '')
    .toLowerCase();
