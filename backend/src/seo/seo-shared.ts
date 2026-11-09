import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** SEO 工作台共用口径：域名归一化、分页信封、研究日志参数指纹、问题类型中文标签。 */

export type Row = Record<string, unknown>;
export type PageQuery = { page: number; pageSize: number };

export const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;
export const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
};
export const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
export const clip = (value: unknown, max: number): string =>
  text(value).slice(0, max);
export const strArr = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
export const iso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

/** 域名归一化：去协议/端口/路径/www，统一小写；非法输入直接拒绝。 */
export function normalizeDomain(raw: string): string {
  const input = text(raw).trim();
  if (!input)
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写站点域名');
  let host = input;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '域名格式不正确');
    }
  }
  host = host
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .split(':')[0]
    .replace(/^www\./i, '')
    .toLowerCase()
    .trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !/^[\u4e00-\u9fa5]/.test(host))
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '域名格式不正确，例如 example.com',
    );
  return host.slice(0, 200);
}

export const siteOrigin = (domain: string): string =>
  `https://${normalizeDomain(domain)}`;

/** 同域判定：includeSubdomains 时允许子域，否则严格等于主域（www 视为同域）。 */
export function sameSite(
  candidate: string,
  domain: string,
  includeSubdomains = false,
): boolean {
  let host: string;
  try {
    host = new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return false;
  }
  const base = normalizeDomain(domain);
  return includeSubdomains
    ? host === base || host.endsWith(`.${base}`)
    : host === base;
}

/** 研究日志参数指纹：键排序后 sha256，保证同参数命中同一条缓存。 */
export function paramsHash(value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input as Row)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, stable(item)]),
      );
    return input;
  };
  return createHash('sha256')
    .update(JSON.stringify(stable(value)), 'utf8')
    .digest('hex');
}

export function pageOf<T>(
  list: T[],
  total: number,
  query: PageQuery,
): { list: T[]; total: number; page: number; pageSize: number } {
  const page = Math.max(1, Math.trunc(query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(query.pageSize || 20)));
  return { list, total, page, pageSize };
}

export const skipTake = (query: PageQuery) => ({
  skip: (Math.max(1, query.page || 1) - 1) * Math.max(1, query.pageSize || 20),
  take: Math.min(200, Math.max(1, query.pageSize || 20)),
});

/** 体检问题类型：中文标签 + 为什么影响排名 + 怎么修（规则式与 AI 解读共用）。 */
export const SEO_ISSUE_TYPES: Record<
  string,
  { label: string; why: string; fix: string }
> = {
  ROBOTS_BLOCKED: {
    label: 'robots 误封',
    why: 'robots.txt 禁止抓取会让搜索引擎完全看不到该路径。',
    fix: '检查 Disallow 规则，确认没有误封重要目录；改完用 robots 测试工具复核。',
  },
  ROBOTS_AI_BLOCKED: {
    label: 'AI 爬虫被封锁',
    why: 'GPTBot/ClaudeBot/PerplexityBot 等被禁止时，AI 引擎抓不到你的内容，GEO 可见度受损。',
    fix: '若希望被 AI 引擎引用，在 robots.txt 放开对应爬虫；到「GEO-AI引擎优化」页签复核提及率。',
  },
  SITEMAP_MISSING: {
    label: 'sitemap 缺失',
    why: '没有 sitemap 时新页面发现慢，深层页面可能长期不被抓取。',
    fix: '生成 sitemap.xml 并在 robots.txt 里用 Sitemap: 声明地址。',
  },
  SITEMAP_INVALID: {
    label: 'sitemap 失效',
    why: 'sitemap 返回非 200 或格式错误，搜索引擎会忽略它。',
    fix: '确认 sitemap 地址可访问且为合法 XML（urlset/sitemapindex）。',
  },
  ORPHAN_PAGE: {
    label: '孤儿页',
    why: '既不在 sitemap 也没有内链指向，搜索引擎很难发现与传递权重。',
    fix: '从枢纽页或相关文章加内链，或把该 URL 补进 sitemap。',
  },
  BROKEN_LINK: {
    label: '断链',
    why: '指向 4xx/5xx 的链接浪费抓取预算并损害用户体验。',
    fix: '修正链接目标或做 301 重定向到有效页面。',
  },
  REDIRECT_CHAIN: {
    label: '重定向链',
    why: '多次跳转拉长加载时间，权重传递也会衰减。',
    fix: '把链接直接改成最终目标地址，合并中间跳转。',
  },
  FETCH_BLOCKED: {
    label: '页面抓取被拒',
    why: '返回 403/429 说明站点在拦截抓取，审计覆盖不完整。',
    fix: '确认服务器/WAF 没有误拦搜索引擎与审计请求；降低抓取频率后重试。',
  },
  FETCH_TIMEOUT: {
    label: '页面抓取超时',
    why: '响应过慢的页面同样会被搜索引擎降权。',
    fix: '排查服务端渲染耗时、数据库慢查询与 CDN 缓存命中率。',
  },
  TITLE_MISSING: {
    label: '缺少标题',
    why: 'title 是搜索结果里最主要的点击依据，缺失会被搜索引擎自行拼凑。',
    fix: '为每页写唯一、含目标关键词、50–60 字符的 title。',
  },
  TITLE_DUPLICATE: {
    label: '标题重复',
    why: '多页同 title 会让搜索引擎难以判断该排哪一页，形成自蚕食。',
    fix: '按页面主题差异化标题，或合并重复页面并做 301。',
  },
  TITLE_TOO_LONG: {
    label: '标题过长',
    why: '超过 60 字符会在搜索结果里被截断，关键信息可能看不到。',
    fix: '把核心词前置，压缩到 60 字符以内。',
  },
  META_MISSING: {
    label: '缺少描述',
    why: 'meta description 影响搜索结果摘要与点击率。',
    fix: '写 120–160 字符、含关键词与行动号召的描述。',
  },
  META_DUPLICATE: {
    label: '描述重复',
    why: '重复描述降低差异化，搜索引擎可能改用正文片段。',
    fix: '每页写独立描述，突出该页独有价值。',
  },
  CANONICAL_MISSING: {
    label: '缺少 canonical',
    why: '带参数/分页/多入口 URL 会分散权重，产生重复内容。',
    fix: '在 head 里加 <link rel="canonical"> 指向规范地址。',
  },
  CANONICAL_CONFLICT: {
    label: 'canonical 冲突',
    why: 'canonical 指向其它域名或与自身不一致时，索引信号会混乱。',
    fix: '确认 canonical 指向本站规范 URL，且与 sitemap/内链一致。',
  },
  NOINDEX: {
    label: 'noindex 标记',
    why: 'noindex 会让页面完全不进索引；用在重要页面上等于自我屏蔽。',
    fix: '确认该页确实不该被收录；否则移除 noindex（含 X-Robots-Tag）。',
  },
  HREFLANG_INVALID: {
    label: 'hreflang 错误',
    why: '语言/地区标注错误会把用户导到错误语言版本。',
    fix: '使用合法的 ISO 语言-地区代码，并保证双向互指与 x-default。',
  },
  THIN_CONTENT: {
    label: '薄内容',
    why: '正文过少的页面难以满足搜索意图，容易被判低质。',
    fix: '补充实质内容（说明、案例、FAQ），或合并到更完整的页面。',
  },
  H1_MISSING: {
    label: '缺少 H1',
    why: 'H1 是页面主题的最强信号，缺失会让主题识别变弱。',
    fix: '每页设置一个含目标关键词的 H1。',
  },
  H1_MULTIPLE: {
    label: '多个 H1',
    why: '多个 H1 会稀释主题信号，结构层级混乱。',
    fix: '保留一个主 H1，其余降为 H2/H3。',
  },
  KEYWORD_CANNIBALIZATION: {
    label: '关键词自蚕食',
    why: '多页争同一个目标词，排名互相压制。',
    fix: '确定唯一目标页，其余页面改做长尾或 301 合并。',
  },
  JSONLD_MISSING: {
    label: '缺少结构化数据',
    why: '没有 JSON-LD 就拿不到富媒体结果（评分、FAQ、面包屑）。',
    fix: '用「结构化数据与收录」生成对应类型的 JSON-LD 并嵌入 head。',
  },
  JSONLD_INVALID: {
    label: '结构化数据解析错误',
    why: 'JSON 语法错误会让整段结构化数据被忽略。',
    fix: '修正 JSON 语法（引号、逗号、转义），用校验工具复核。',
  },
  JSONLD_FIELDS_MISSING: {
    label: '结构化数据必填字段缺失',
    why: '缺必填字段无法通过富媒体结果校验。',
    fix: '补齐该类型的必填属性（如 Article 的 headline/datePublished）。',
  },
  IMAGE_ALT_MISSING: {
    label: '图片缺少 alt',
    why: 'alt 缺失影响图片搜索收录与无障碍访问。',
    fix: '为每张内容图写描述性 alt，装饰图用空 alt。',
  },
  MIXED_CONTENT: {
    label: '混合内容',
    why: 'HTTPS 页面引用 HTTP 资源会被浏览器拦截或降级提示。',
    fix: '把资源地址改为 https 或协议相对地址。',
  },
  PAGE_TOO_LARGE: {
    label: '页面体积过大',
    why: 'HTML 过大拖慢首屏，移动端体验与抓取效率都受影响。',
    fix: '精简内联脚本/样式、压缩 HTML、拆分过长页面。',
  },
  BLOCKING_SCRIPTS: {
    label: '阻塞脚本过多',
    why: '同步脚本阻塞渲染，直接拉长 LCP。',
    fix: '给非关键脚本加 defer/async，或移到 body 末尾。',
  },
  IMAGE_NO_LAZY: {
    label: '图片未懒加载',
    why: '首屏外图片立即下载会浪费带宽、拖慢加载。',
    fix: '给首屏外 <img> 加 loading="lazy"。',
  },
};

export const issueLabel = (type: string): string =>
  SEO_ISSUE_TYPES[type]?.label || type;
export const issueFix = (type: string): string =>
  SEO_ISSUE_TYPES[type]?.fix || '请结合页面实际情况排查修复。';

/** DataForSEO 引擎：百度侧未验证前不放开（方案 §4.2 口径）。 */
export const SEO_SERP_ENGINES = ['google', 'bing', 'yahoo'] as const;

/** 预估单价（美元/次，参考值非账单；可用 SEO_DFS_UNIT_USD 覆盖）。 */
export function dfsUnitPrice(kind: string): number {
  const override = Number(process.env.SEO_DFS_UNIT_USD || 0);
  if (Number.isFinite(override) && override > 0) return override;
  const table: Record<string, number> = {
    serp: 0.002,
    maps: 0.002,
    keywords: 0.05,
    backlinks: 0.02,
    lighthouse: 0.01,
  };
  return table[kind] ?? 0.002;
}

export const COST_NOTE =
  '参考预估，非账单：单价按 DataForSEO 官方当期价折算，不同端点/引擎价格不同，以实际扣费为准。';

/** 多次 SERP 读取取信：有命中的读数取中位数；全部未命中返回 null（= 未进前 N）。 */
export function medianPosition(reads: Array<number | null>): number | null {
  const hits = reads
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .sort((a, b) => a - b);
  if (!hits.length) return null;
  const middle = Math.floor(hits.length / 2);
  return hits.length % 2
    ? hits[middle]
    : Math.round((hits[middle - 1] + hits[middle]) / 2);
}

const FREQUENCY_DAYS: Record<string, number> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
};

export function nextRunDate(frequency: string, from = new Date()): Date {
  const days = FREQUENCY_DAYS[frequency] ?? 7;
  return new Date(from.getTime() + days * 86_400_000);
}

/** 本地 SEO 网格：以中心点向四周等距铺 gridSize×gridSize 个采样点（纬度按半径换算，经度按纬度余弦修正）。 */
export function gridPoints(input: {
  centerLat: number;
  centerLng: number;
  gridSize: number;
  radiusKm: number;
}): Array<{ row: number; col: number; lat: number; lng: number }> {
  const size = input.gridSize === 5 ? 5 : 3;
  const stepKm = (input.radiusKm * 2) / (size - 1);
  const latStep = stepKm / 111.32;
  const lngStep =
    stepKm /
    (111.32 * Math.max(0.01, Math.cos((input.centerLat * Math.PI) / 180)));
  const half = (size - 1) / 2;
  const points: Array<{ row: number; col: number; lat: number; lng: number }> =
    [];
  for (let row = 0; row < size; row += 1)
    for (let col = 0; col < size; col += 1)
      points.push({
        row,
        col,
        lat: round6(input.centerLat + (half - row) * latStep),
        lng: round6(input.centerLng + (col - half) * lngStep),
      });
  return points;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
