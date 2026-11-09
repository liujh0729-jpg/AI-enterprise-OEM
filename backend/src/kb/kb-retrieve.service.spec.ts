import type { CurrentUser } from '../auth/current-user';
import type { ContentAgentLibraryService } from '../content/agent-library.service';
import type { HelpService } from '../help/help.service';
import type { PrismaService } from '../prisma/prisma.service';
import { KbRetrieveService } from './kb-retrieve.service';
import type { KbSearchService } from './kb-search.service';
import type { KbSpaceService } from './kb-space.service';
import { stub } from '../../test/doubles';

/**
 * P0-3 统一 RAG 出口单测：三源合并/引用字段、空间解析（显式/消费者/默认）、
 * 预算裁剪、来源限定、kb 过滤与降级（资料库失败不拖垮其他源）。
 */

const user = { userId: 'u1' } as CurrentUser;

function makeService(
  overrides: {
    kbHits?: unknown[];
    libraryResult?: unknown;
    libraryThrows?: boolean;
    helpHits?: unknown[];
    consumerRows?: unknown[];
    canRead?: boolean;
  } = {},
) {
  const prisma = {
    kbConsumer: {
      findMany: jest.fn(async () => overrides.consumerRows ?? []),
    },
    kbSpace: {
      findMany: jest.fn(
        async ({ where }: { where: { id: { in: number[] } } }) =>
          where.id.in.map((id) => ({ id, name: `空间${id}` })),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => ({
        id: where.id,
      })),
    },
    kbPage: {
      findMany: jest.fn(async () => [
        {
          id: 11,
          type: 'POLICY',
          createdAt: new Date('2026-10-01T00:00:00Z'),
          frontmatter: { tags: ['refund'] },
        },
      ]),
    },
  };
  const spaces = {
    loadReadable: jest.fn(async (id: number) => ({ id })),
    canRead: jest.fn(async (space?: { id: number }) => {
      void space;
      return overrides.canRead ?? true;
    }),
    resolveActiveSpace: jest.fn(async () => ({ id: 1, name: '主空间' })),
  };
  const search = {
    search: jest.fn(async () => ({
      hits: overrides.kbHits ?? [
        {
          pageId: 11,
          slug: 'refund-policy',
          title: '退款政策',
          score: 0.42,
          excerpt: '退款需在 7 日内提出',
        },
      ],
      modes: ['keyword'],
      total: 1,
    })),
  };
  const library = {
    search: jest.fn(async () => {
      if (overrides.libraryThrows) throw new Error('上游挂了');
      return (
        overrides.libraryResult ?? {
          question: 'q',
          semantic: true,
          scope: ['资料A'],
          hits: [
            {
              nodeId: 5,
              itemId: 2,
              itemName: '资料A',
              snippet: '片段甲',
              score: 0.9,
            },
          ],
          note: '',
        }
      );
    }),
  };
  const help = {
    search: jest.fn(
      () =>
        overrides.helpHits ?? [
          {
            code: 'points',
            title: '积分中心',
            summary: '',
            routePath: '/points',
            chapterTitle: '账户',
            excerpt: '积分可充值',
            score: 0.5,
          },
        ],
    ),
  };
  const service = new KbRetrieveService(
    stub<PrismaService>(prisma),
    stub<KbSpaceService>(spaces),
    stub<KbSearchService>(search),
    stub<ContentAgentLibraryService>(library),
    stub<HelpService>(help),
  );
  return { service, prisma, spaces, search, library, help };
}

describe('KbRetrieveService 统一 RAG 出口', () => {
  it('默认三源合并：按归一分排序，带来源与引用锚点，modes 汇总', async () => {
    const { service } = makeService();
    const result = await service.retrieve(user, { query: '退款流程' });
    expect(result.sources).toEqual(['kb', 'library', 'help']);
    expect(result.total).toBe(3);
    expect(result.modes).toContain('keyword');
    expect(result.modes).toContain('rerank');
    // 资料库原始分 0.9 > help 0.5 > kb 0.42，归一后同序
    expect(result.snippets.map((item) => item.source)).toEqual([
      'library',
      'help',
      'kb',
    ]);
    const [first, second, third] = result.snippets;
    expect(first.ref).toBe('资料A');
    expect(second.ref).toBe('points');
    expect(third).toMatchObject({
      source: 'kb',
      spaceId: 1,
      id: 11,
      slug: 'refund-policy',
      ref: 'refund-policy',
    });
    expect(result.spaces).toEqual([{ id: 1, name: '空间1' }]);
  });

  it('显式 spaceIds 走读闸校验，不再回落默认空间', async () => {
    const { service, spaces } = makeService();
    const result = await service.retrieve(user, {
      query: '政策',
      spaceIds: [7, 7, 9],
    });
    expect(spaces.loadReadable).toHaveBeenCalledTimes(2);
    expect(spaces.resolveActiveSpace).not.toHaveBeenCalled();
    expect(
      result.snippets.every(
        (item) => item.spaceId === undefined || [7, 9].includes(item.spaceId),
      ),
    ).toBe(true);
  });

  it('消费者绑定：按优先级聚合 READ 绑定，不可读空间静默跳过', async () => {
    const { service, prisma, spaces, help } = makeService({
      canRead: false,
      consumerRows: [
        { spaceId: 2, priority: 10 },
        { spaceId: 3, priority: 5 },
      ],
    });
    spaces.canRead.mockImplementation(
      async (space: { id: number }) => space.id === 3,
    );
    const result = await service.retrieve(user, {
      query: 'help only',
      sources: ['help'],
      consumerType: 'AVATAR',
      consumerId: 'avatar-1',
    });
    expect(prisma.kbConsumer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { consumerType: 'AVATAR', consumerId: 'avatar-1', role: 'READ' },
      }),
    );
    // help-only：没有 kb 调用，spaces 为空（不可读空间不进清单）
    expect(help.search).toHaveBeenCalled();
    expect(result.spaces).toEqual([]);
  });
  it('maxChars 预算裁剪：收不下就停，单条按剩余预算截断', async () => {
    const { service } = makeService();
    const result = await service.retrieve(user, {
      query: 'q',
      maxChars: 200,
    });
    expect(result.total).toBe(3);
    expect(result.snippets.length).toBeLessThan(3);
    expect(
      result.snippets.reduce((sum, item) => sum + item.text.length, 0),
    ).toBeLessThanOrEqual(210);
  });

  it('sources 限定 kb：资料库与帮助中心不参与', async () => {
    const { service, library, help } = makeService();
    const result = await service.retrieve(user, {
      query: 'q',
      sources: ['kb'],
    });
    expect(library.search).not.toHaveBeenCalled();
    expect(help.search).not.toHaveBeenCalled();
    expect(result.snippets.every((item) => item.source === 'kb')).toBe(true);
  });

  it('kb 类型/标签/时间过滤：只作用于 kb 片段，其余来源不受影响', async () => {
    const { service, prisma } = makeService();
    const result = await service.retrieve(user, {
      query: 'q',
      sources: ['kb', 'help'],
      types: ['POLICY'],
      tags: ['refund'],
      from: '2026-09-01',
      to: '2026-11-01',
    });
    expect(prisma.kbPage.findMany).toHaveBeenCalled();
    expect(result.snippets.map((item) => item.source)).toEqual(['help', 'kb']);
    // 类型不符的 kb 片段被滤掉
    prisma.kbPage.findMany = jest.fn(async () => [
      { id: 11, type: 'LOG', createdAt: new Date(), frontmatter: { tags: [] } },
    ]);
    const filtered = await service.retrieve(user, {
      query: 'q',
      sources: ['kb'],
      types: ['POLICY'],
    });
    expect(filtered.snippets).toEqual([]);
  });

  it('资料库失败降级：kb 与 help 照常返回', async () => {
    const { service } = makeService({ libraryThrows: true });
    const result = await service.retrieve(user, { query: 'q' });
    expect(result.snippets.map((item) => item.source).sort()).toEqual([
      'help',
      'kb',
    ]);
  });

  it('空 query 直接拒绝', async () => {
    const { service } = makeService();
    await expect(service.retrieve(user, { query: '  ' })).rejects.toThrow(
      '请输入要检索的问题',
    );
  });
});
