import {
  buildJsonLd,
  validateJsonLd,
  mergeLlmText,
  requiredHints,
} from './seo-jsonld';

describe('buildJsonLd', () => {
  it('生成可解析、带 @context 的文章结构化数据', () => {
    const raw = buildJsonLd({
      type: 'ARTICLE',
      fields: { headline: '标题', author: '张三', datePublished: '2026-01-01' },
      pageUrl: 'https://example.com/post',
    });
    const node = JSON.parse(raw);
    expect(node['@context']).toContain('schema.org');
    expect(node['@type']).toBe('Article');
    expect(node.headline).toBe('标题');
  });

  it('产品节点带 offers', () => {
    const node = JSON.parse(
      buildJsonLd({
        type: 'PRODUCT',
        fields: { name: '产品', price: '99', priceCurrency: 'CNY' },
      }),
    );
    expect(node['@type']).toBe('Product');
    expect(node.name).toBe('产品');
  });

  it('requiredHints 按类型给必填提示', () => {
    expect(requiredHints('ARTICLE').length).toBeGreaterThan(0);
    expect(requiredHints('UNKNOWN')).toEqual([]);
  });
});

describe('validateJsonLd', () => {
  const validArticle = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: '标题',
    author: { '@type': 'Person', name: '张三' },
    datePublished: '2026-01-01',
  });

  it('完整文章判通过', () => {
    const result = validateJsonLd(validArticle);
    expect(result.valid).toBe(true);
  });

  it('缺 headline 判不通过并给出错误', () => {
    const result = validateJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        author: { name: '张三' },
        datePublished: '2026-01-01',
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((s) => s.includes('headline'))).toBe(true);
  });

  it('缺 @context 判不通过', () => {
    const result = validateJsonLd(
      JSON.stringify({ '@type': 'Article', headline: 'x' }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((s) => s.includes('@context'))).toBe(true);
  });

  it('产品有 price 缺 priceCurrency 判不通过', () => {
    const result = validateJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: '产品',
        offers: { '@type': 'Offer', price: '99' },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((s) => s.includes('priceCurrency'))).toBe(true);
  });

  it('非法 JSON 与空内容判不通过', () => {
    expect(validateJsonLd('{bad').valid).toBe(false);
    expect(validateJsonLd('  ').valid).toBe(false);
    expect(validateJsonLd('').issues).toContain('JSON-LD 内容为空');
  });

  it('范围外 @type 只做 JSON/@context 检查（告警不判错）', () => {
    const result = validateJsonLd(
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event' }),
    );
    expect(result.valid).toBe(true);
    expect(result.issues.some((s) => s.includes('校验范围'))).toBe(true);
  });
});

describe('mergeLlmText（只补空白文案字段，不改用户事实）', () => {
  const base = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: '用户标题',
  });

  it('原字段为空时采纳模型 description', () => {
    const result = mergeLlmText(
      base,
      JSON.stringify({ description: '模型补写的描述' }),
      {},
    );
    expect(result.used).toBe(true);
    expect(JSON.parse(result.jsonLd).description).toBe('模型补写的描述');
  });

  it('用户已填的 headline 不被模型覆盖', () => {
    const result = mergeLlmText(
      base,
      JSON.stringify({ headline: '模型改的标题', description: '描述' }),
      { headline: '用户标题' },
    );
    expect(JSON.parse(result.jsonLd).headline).toBe('用户标题');
  });

  it('非白名单字段（如价格）一律忽略', () => {
    const productBase = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: '产品',
    });
    const result = mergeLlmText(
      productBase,
      JSON.stringify({ price: '1', description: '描述' }),
      {},
    );
    const node = JSON.parse(result.jsonLd);
    expect(node.price).toBeUndefined();
    expect(node.description).toBe('描述');
  });

  it('模型输出非法 JSON 时原样返回、used=false', () => {
    const result = mergeLlmText(base, '{bad', {});
    expect(result.used).toBe(false);
    expect(result.jsonLd).toBe(base);
  });
});
