import type { CurrentUser } from '../auth/current-user';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PrismaService } from '../prisma/prisma.service';
import { KbSearchService } from './kb-search.service';
import type { KbPageService } from './kb-page.service';
import type { KbSpaceService } from './kb-space.service';
import { stub } from '../../test/doubles';

/**
 * 检索评测回归（AI 底座 §5 P1-A）：用真实评分内核（tokenize/keywordScore/hybridScore）
 * 跑「命中/引用正确率」——每个问题都必须把对应页排到第 1，且摘录与引用锚点齐全。
 * 这是纯函数 + 假库的确定性回归：不触网、不依赖向量槽位（走词面路径）。
 */

const user = { userId: 'u1' } as CurrentUser;

const PAGES = [
  {
    id: 1,
    slug: 'refund-policy',
    title: '退款政策',
    type: 'CONCEPT',
    body: '退款需在收到货 7 日内提出，逾期不受理。退款到账需 3 个工作日。',
  },
  {
    id: 2,
    slug: 'shipping-time',
    title: '配送时效',
    type: 'CONCEPT',
    body: '标准配送 3-5 个工作日达，偏远地区 7 个工作日。加急订单次日达。',
  },
  {
    id: 3,
    slug: 'invoice-guide',
    title: '发票开具',
    type: 'CONCEPT',
    body: '支持电子发票，下单后 24 小时内开具，可在订单详情页下载。',
  },
];

function chunkOf(page: (typeof PAGES)[number]) {
  return {
    id: page.id,
    spaceId: 1,
    pageId: page.id,
    ordinal: 0,
    text: `${page.title}\n${page.body}`,
    model: 'local-hash-256',
    embedding: [],
    meta: { type: page.type, tags: [], visibility: 'PRIVATE' },
  };
}

function makeService() {
  const prisma = {
    kbPage: { findMany: jest.fn(async () => PAGES) },
    kbChunk: { findMany: jest.fn(async () => PAGES.map(chunkOf)) },
    kbPageSource: {
      findMany: jest.fn(async () => [
        { pageId: 1, sourceId: 101 },
        { pageId: 2, sourceId: 102 },
        { pageId: 3, sourceId: 103 },
      ]),
    },
    kbIndex: {
      findUnique: jest.fn(async () => ({ spaceId: 1, stats: {} })),
      update: jest.fn(async () => ({})),
    },
  };
  const spaces = { loadReadable: jest.fn(async (id: number) => ({ id })) };
  const pages = { reindex: jest.fn() };
  const aiEval = { chargeByUsage: jest.fn(async () => 0) };
  const service = new KbSearchService(
    stub<PrismaService>(prisma),
    stub<KbSpaceService>(spaces),
    stub<KbPageService>(pages),
    stub<AiEvalService>(aiEval),
  );
  return { service, prisma };
}

describe('知识库检索召回质量回归', () => {
  const cases: Array<{ query: string; pageId: number; slug: string }> = [
    { query: '退款怎么申请', pageId: 1, slug: 'refund-policy' },
    { query: '配送多久能到', pageId: 2, slug: 'shipping-time' },
    { query: '发票在哪里下载', pageId: 3, slug: 'invoice-guide' },
  ];

  it('命中率 100%：每个问题第 1 名即目标页，摘录与引用锚点齐全', async () => {
    const { service } = makeService();
    let hits = 0;
    for (const item of cases) {
      const result = await service.search(1, item.query, 8, user);
      expect(result.hits.length).toBeGreaterThan(0);
      const top = result.hits[0];
      expect(top.pageId).toBe(item.pageId);
      expect(top.slug).toBe(item.slug);
      expect(top.excerpt.length).toBeGreaterThan(0);
      expect(top.sourceIds).toContain(100 + item.pageId);
      if (top.pageId === item.pageId) hits += 1;
    }
    expect(hits / cases.length).toBe(1);
  });

  it('无关问题不误命中：无重叠词时返回空（避免噪声污染上下文）', async () => {
    const { service } = makeService();
    const result = await service.search(1, '量子计算 拓扑 绝缘体', 8, user);
    expect(result.total).toBe(0);
    expect(result.hits).toEqual([]);
  });

  it('词面路径如实报告 mode=keyword（无向量时不谎称 vector）', async () => {
    const { service } = makeService();
    const result = await service.search(1, '退款', 8, user);
    expect(result.modes).toEqual(['keyword']);
  });
});
