import {
  parseRobots,
  robotsAllowed,
  blockedAiBots,
  parseSitemap,
  decodeEntities,
  countWords,
  parsePage,
  runChecks,
  healthScoreOf,
  type CrawlIssue,
} from './seo-crawler';

describe('parseRobots / robotsAllowed', () => {
  const raw = [
    'User-agent: *',
    'Disallow: /admin',
    'Allow: /admin/public',
    'Sitemap: https://example.com/sitemap.xml',
    '',
    'User-agent: GPTBot',
    'Disallow: /',
  ].join('\n');

  it('解析分组、Allow/Disallow 与 Sitemap 声明', () => {
    const info = parseRobots(raw);
    expect(info.found).toBe(true);
    expect(info.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(info.rules).toHaveLength(2);
    expect(info.rules[0].agent).toBe('*');
    expect(info.rules[0].disallow).toEqual(['/admin']);
    expect(info.rules[0].allow).toEqual(['/admin/public']);
    expect(info.rules[1].agent).toBe('gptbot');
  });

  it('最长匹配优先：Allow 比 Disallow 更具体时放行', () => {
    const info = parseRobots(raw);
    expect(robotsAllowed(info, '/admin')).toBe(false);
    expect(robotsAllowed(info, '/admin/public')).toBe(true);
    expect(robotsAllowed(info, '/about')).toBe(true);
  });

  it('特定 agent 规则覆盖通配组', () => {
    const info = parseRobots(raw);
    expect(robotsAllowed(info, '/about', 'GPTBot')).toBe(false);
    expect(robotsAllowed(info, '/about', '*')).toBe(true);
  });

  it('无 robots（found=false）默认放行', () => {
    const info = parseRobots('', false);
    expect(info.found).toBe(false);
    expect(robotsAllowed(info, '/anything')).toBe(true);
  });

  it('整站 Disallow: / 才算封锁 AI 爬虫', () => {
    expect(blockedAiBots(parseRobots(raw))).toContain('GPTBot');
    const partial = parseRobots('User-agent: *\nDisallow: /admin');
    expect(blockedAiBots(partial)).toEqual([]);
    const allowedBack = parseRobots(
      'User-agent: GPTBot\nDisallow: /\nAllow: /',
    );
    expect(blockedAiBots(allowedBack)).toEqual([]);
  });
});

describe('parseSitemap', () => {
  it('urlset 取 loc 并解码实体', () => {
    const xml =
      '<urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url><url><loc>https://example.com/b</loc></url></urlset>';
    const result = parseSitemap(xml);
    expect(result.valid).toBe(true);
    expect(result.urls).toEqual([
      'https://example.com/a?x=1&y=2',
      'https://example.com/b',
    ]);
    expect(result.children).toEqual([]);
  });

  it('sitemapindex 取子 sitemap 地址', () => {
    const xml =
      '<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>';
    const result = parseSitemap(xml);
    expect(result.children).toEqual(['https://example.com/s1.xml']);
    expect(result.urls).toEqual([]);
  });

  it('非 sitemap 内容判无效', () => {
    expect(parseSitemap('<html></html>').valid).toBe(false);
    expect(parseSitemap('').valid).toBe(false);
  });
});

describe('decodeEntities / countWords', () => {
  it('解码常见 HTML 实体与数字实体', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&#39;&apos;&#65;')).toBe(
      "&<>\"''A",
    );
  });

  it('中英文混排：CJK 逐字、拉丁按词', () => {
    expect(countWords('你好世界')).toBe(4);
    expect(countWords('hello world foo')).toBe(3);
    expect(countWords('你好 hello 世界 world')).toBe(6);
    expect(countWords('')).toBe(0);
  });
});

const GOOD_HTML = `<!doctype html><html><head>
<title>优质页面标题</title>
<meta name="description" content="这是一段足够长的描述文字，用于通过体检的 meta 检查项。">
<link rel="canonical" href="https://example.com/good">
</head><body>
<h1>主标题</h1><h2>副标题</h2>
<p>${'这是一段正文内容。'.repeat(60)}</p>
<img src="/img/a.png" alt="示意图">
<a href="https://example.com/other">内链</a>
<a href="https://external.com/x">外链</a>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"优质页面标题"}</script>
</body></html>`;

describe('parsePage（fixture HTML，cheerio 纯 JS）', () => {
  it('抽取 title/meta/canonical/h1/字数/图片/链接/JSON-LD', () => {
    const page = parsePage(
      GOOD_HTML,
      'https://example.com/good',
      'example.com',
    );
    expect(page.fetchStatus).toBe('OK');
    expect(page.title).toBe('优质页面标题');
    expect(page.metaDescription).toContain('足够长的描述');
    expect(page.canonical).toBe('https://example.com/good');
    expect(page.h1).toEqual(['主标题']);
    expect(page.wordCount).toBeGreaterThanOrEqual(300);
    expect(page.images[0].alt).toBe('示意图');
    expect(
      page.links.find((l) => l.href === 'https://example.com/other')?.internal,
    ).toBe(true);
    expect(
      page.links.find((l) => l.href === 'https://external.com/x')?.internal,
    ).toBe(false);
    expect(page.jsonLd).toHaveLength(1);
    expect(page.jsonLdErrors).toEqual([]);
    expect(page.noindex).toBe(false);
  });

  it('noindex 由 meta robots 与 X-Robots-Tag 共同判定', () => {
    const page = parsePage(
      '<html><head><meta name="robots" content="noindex"></head><body></body></html>',
      'https://example.com/x',
      'example.com',
    );
    expect(page.noindex).toBe(true);
    const header = parsePage(
      '<html><body></body></html>',
      'https://example.com/x',
      'example.com',
      { xRobotsTag: 'noindex, nofollow' },
    );
    expect(header.noindex).toBe(true);
  });

  it('非法 JSON-LD 记录解析错误', () => {
    const page = parsePage(
      '<html><body><script type="application/ld+json">{bad json</script></body></html>',
      'https://example.com/x',
      'example.com',
    );
    expect(page.jsonLd).toHaveLength(1);
    expect(page.jsonLdErrors.length).toBeGreaterThan(0);
  });
});

describe('runChecks / healthScoreOf', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /admin', true);

  it('优质页面不产生严重问题', () => {
    const page = parsePage(
      GOOD_HTML,
      'https://example.com/good',
      'example.com',
    );
    const issues = runChecks({
      pages: [page],
      robots,
      sitemapUrls: ['https://example.com/good'],
      sitemapStatus: 'OK',
      domain: 'example.com',
    });
    expect(issues.filter((i) => i.severity === 'CRITICAL')).toEqual([]);
  });

  it('缺 title/meta/H1 与薄内容触发对应检查项', () => {
    const page = parsePage(
      '<html><head></head><body><p>短</p></body></html>',
      'https://example.com/bad',
      'example.com',
    );
    const issues = runChecks({
      pages: [page],
      robots,
      sitemapUrls: [],
      sitemapStatus: 'MISSING',
      domain: 'example.com',
    });
    const types = issues.map((i) => i.type);
    expect(types).toContain('TITLE_MISSING');
    expect(types).toContain('META_MISSING');
    expect(types).toContain('H1_MISSING');
    expect(types).toContain('THIN_CONTENT');
    expect(types).toContain('SITEMAP_MISSING');
    expect(issues.find((i) => i.type === 'TITLE_MISSING')?.severity).toBe(
      'CRITICAL',
    );
  });

  it('robots 全站封锁判 CRITICAL', () => {
    const issues = runChecks({
      pages: [],
      robots: parseRobots('User-agent: *\nDisallow: /', true),
      sitemapUrls: [],
      sitemapStatus: 'OK',
      domain: 'example.com',
    });
    expect(issues.find((i) => i.type === 'ROBOTS_BLOCKED')?.severity).toBe(
      'CRITICAL',
    );
  });

  it('健康分按严重度扣分并 clamp 到 0..100', () => {
    const issue = (severity: CrawlIssue['severity']): CrawlIssue => ({
      type: 'X',
      severity,
      url: '',
      detail: '',
      fixHint: '',
    });
    expect(healthScoreOf([])).toBe(100);
    expect(healthScoreOf([issue('CRITICAL')])).toBe(92);
    expect(healthScoreOf([issue('WARNING')])).toBe(97);
    expect(healthScoreOf([issue('INFO')])).toBe(99);
    expect(
      healthScoreOf(Array.from({ length: 20 }, () => issue('CRITICAL'))),
    ).toBe(0);
  });
});
