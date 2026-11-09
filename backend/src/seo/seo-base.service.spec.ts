import { SeoBase, type SeoContext } from './seo-base.service';
import { paramsHash } from './seo-shared';
import { stub } from '../../test/doubles';

/** 暴露 protected research 以便单测；只注入 seoResearchLog 两个方法。 */
class TestSeo extends SeoBase {
  runResearch<T>(input: {
    org: { orgType: string; orgUserId: string };
    projectId: number;
    action: string;
    params: unknown;
    resultRef: string;
    load: () => Promise<T>;
  }) {
    return this.research(input);
  }
}

function setup() {
  const findFirst = jest.fn();
  const create = jest.fn().mockResolvedValue({ id: 1 });
  const ctx = stub<SeoContext>({
    prisma: { seoResearchLog: { findFirst, create } },
  });
  return { service: new TestSeo(ctx), findFirst, create };
}

const baseInput = {
  org: { orgType: 'ENTERPRISE', orgUserId: 'u1' },
  projectId: 7,
  action: 'keywords',
  params: { keyword: 'seo', limit: 30 },
  resultRef: 'ref',
};

describe('SeoBase.research 30 天同参复用', () => {
  it('未命中缓存：执行 loader、落日志、reused=false', async () => {
    const { service, findFirst, create } = setup();
    findFirst.mockResolvedValue(null);
    const load = jest.fn().mockResolvedValue({ volume: 100 });
    const result = await service.runResearch({ ...baseInput, load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ value: { volume: 100 }, reused: false });
    const where = findFirst.mock.calls[0][0].where as {
      paramsHash: string;
      projectId: number;
      action: string;
      createdAt: { gte: Date };
    };
    expect(where.paramsHash).toBe(paramsHash(baseInput.params));
    expect(where.projectId).toBe(7);
    expect(where.action).toBe('keywords');
    const ageMs = Date.now() - where.createdAt.gte.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(30 * 86_400_000 - 5000);
    expect(ageMs).toBeLessThanOrEqual(30 * 86_400_000 + 5000);
  });

  it('命中缓存：直接返回旧 payload，不再付费调用 loader', async () => {
    const { service, findFirst, create } = setup();
    findFirst.mockResolvedValue({ payload: { volume: 999 } });
    const load = jest.fn().mockResolvedValue({ volume: 100 });
    const result = await service.runResearch({ ...baseInput, load });
    expect(load).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ value: { volume: 999 }, reused: true });
  });

  it('键序不同的同参数命中同一缓存指纹', async () => {
    const { service, findFirst } = setup();
    findFirst.mockResolvedValue(null);
    await service.runResearch({
      ...baseInput,
      params: { limit: 30, keyword: 'seo' },
      load: jest.fn().mockResolvedValue({}),
    });
    expect(findFirst.mock.calls[0][0].where.paramsHash).toBe(
      paramsHash({ keyword: 'seo', limit: 30 }),
    );
  });
});
