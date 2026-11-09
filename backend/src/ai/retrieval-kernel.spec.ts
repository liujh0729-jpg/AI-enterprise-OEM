import {
  bm25Scores,
  cosine,
  excerpt,
  fieldScore,
  hashEmbed,
  hybridScore,
  keywordScore,
  LOCAL_EMBED_ID,
  normalizeScores,
  remoteEmbedId,
  RANK,
  snippet,
  tokenize,
} from './retrieval-kernel';

/**
 * 统一检索内核单测（P0-3）：分词/评分/融合/归一/BM25/字段加权的确定性行为。
 * kb 混合检索、资料库召回、帮助中心共用这套口径，回归就是全线回归。
 */

describe('retrieval-kernel 统一检索内核', () => {
  it('分词：中文二元组 + 拉丁词（小写），同一文本必得同一向量', () => {
    const tokens = tokenize('退款 Refund 流程');
    expect(tokens).toContain('refund');
    expect(tokens).toContain('退款');
    const a = hashEmbed('退款流程七日内提出');
    const b = hashEmbed('退款流程七日内提出');
    expect(a).toEqual(b);
    expect(a).toHaveLength(256);
  });

  it('keywordScore：覆盖率高者得分高，未命中为 0', () => {
    const hit = keywordScore('退款', '退款需在七日内提出，逾期不予受理');
    const miss = keywordScore('发票', '退款需在七日内提出');
    expect(hit).toBeGreaterThan(0.7);
    expect(miss).toBe(0);
  });

  it('hybridScore：词面 0.6 + 向量 0.4；向量缺失退化为词面加权', () => {
    expect(hybridScore(1, 0)).toBeCloseTo(RANK.keywordWeight, 6);
    expect(hybridScore(0, 1)).toBeCloseTo(RANK.vectorWeight, 6);
    expect(hybridScore(0.5, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('normalizeScores：本批最高分为 1，全零批次保持全零', () => {
    expect(normalizeScores([2, 1, 0])).toEqual([1, 0.5, 0]);
    expect(normalizeScores([0, 0])).toEqual([0, 0]);
  });

  it('bm25Scores：命中文档排序并归一 0~1，候选截断到上限', () => {
    const docs = [
      { key: 'a', text: '退款 退款 退款 流程 说明' },
      { key: 'b', text: '退款 流程' },
      { key: 'c', text: '完全无关的内容' },
    ];
    const scored = bm25Scores('退款', docs, 2);
    expect(scored).toHaveLength(2);
    expect(scored[0].key).toBe('a');
    expect(scored[0].score).toBeLessThanOrEqual(1);
    expect(scored.every((item) => item.key !== 'c')).toBe(true);
  });

  it('fieldScore：标题命中强于正文命中，各字段加权归一', () => {
    const titleHit = fieldScore('积分', {
      title: '积分中心',
      keywords: ['积分'],
      summary: '积分说明',
      body: '',
    });
    const bodyOnly = fieldScore('积分', {
      title: '别的页面',
      keywords: [],
      summary: '',
      body: '正文里提到积分一次',
    });
    expect(titleHit).toBeGreaterThan(bodyOnly);
    expect(titleHit).toBeLessThanOrEqual(1);
  });

  it('cosine：同向为 1、正交为 0、维度不符为 0', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 0], [1])).toBe(0);
  });

  it('excerpt/snippet：统一截断与命中窗口', () => {
    const long = '字'.repeat(500);
    expect(excerpt(long)).toHaveLength(RANK.excerptChars + 1);
    const win = snippet(
      '前文 '.repeat(150) + '目标词在这里' + ' 后文 '.repeat(150),
      ['目标词'],
    );
    expect(win.startsWith('…')).toBe(true);
    expect(win).toContain('目标词');
  });

  it('向量模型标识：本地与远端隔离', () => {
    expect(LOCAL_EMBED_ID).toBe('local-hash-256');
    expect(remoteEmbedId('text-embedding-3-small')).toBe(
      'embed:text-embedding-3-small',
    );
  });
});
