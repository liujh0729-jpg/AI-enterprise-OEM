import {
  escapeHtml,
  renderTemplate,
  renderPlain,
  templateKeys,
  slugify,
  uniqueSlug,
  defaultTemplate,
  pageUrl,
  sitemapXml,
} from './seo-programmatic';

describe('escapeHtml / renderTemplate / renderPlain', () => {
  it('转义 HTML 危险字符', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('renderTemplate 替换并转义，未知键原样保留', () => {
    expect(renderTemplate('<p>{{ name }}</p>', { name: '<b>甲</b>' })).toBe(
      '<p>&lt;b&gt;甲&lt;/b&gt;</p>',
    );
    expect(renderTemplate('{{ missing }}', {})).toBe('{{ missing }}');
  });

  it('renderPlain 替换但不转义（用于 title/slug）', () => {
    expect(renderPlain('{{ name }}', { name: 'A&B' })).toBe('A&B');
  });

  it('templateKeys 去重保序', () => {
    expect(templateKeys('{{ b }} {{ a }} {{ b }}')).toEqual(['b', 'a']);
  });
});

describe('slugify / uniqueSlug', () => {
  it('保留中文、转空格为连字符、去危险字符', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('北京 攻略')).toBe('北京-攻略');
    expect(slugify('a/b?c#d')).toBe('abcd');
  });
  it('空值退回 fallback', () => {
    expect(slugify('')).toBe('page');
    expect(slugify('///', 'fallback')).toBe('fallback');
  });
  it('uniqueSlug 冲突时追加序号', () => {
    const used = new Set<string>();
    expect(uniqueSlug('北京 攻略', used)).toBe('北京-攻略');
    expect(uniqueSlug('北京 攻略', used)).toBe('北京-攻略-2');
    expect(uniqueSlug('北京 攻略', used)).toBe('北京-攻略-3');
    expect(used.size).toBe(3);
  });
});

describe('defaultTemplate / pageUrl / sitemapXml', () => {
  it('缺模板时按列名生成确定性骨架', () => {
    const tpl = defaultTemplate(['城市', '价格'], '{{城市}} 攻略');
    expect(tpl).toContain('{{城市}}');
    expect(tpl).toContain('{{价格}}');
    expect(templateKeys(tpl)).toEqual(['城市', '价格']);
  });

  it('pageUrl 规整 origin  trailing slash', () => {
    expect(pageUrl('https://example.com/', 'beijing')).toBe(
      'https://example.com/beijing/',
    );
  });

  it('sitemapXml 输出 urlset 并转义 loc', () => {
    const xml = sitemapXml(
      ['https://example.com/a?x=1&y=2'],
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>https://example.com/a?x=1&amp;y=2</loc>');
    expect(xml).toContain('<lastmod>2026-01-01</lastmod>');
  });
});
