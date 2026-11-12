import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import type { ContentJobService } from './content-job.service';
import { ContentJobWorkerPool } from './content-job.worker-pool';

/**
 * 调度池只依赖三件事：prisma 捞 PENDING、jobs.claim 抢锁、jobs.start 起跑。
 * jest.fn 保留原始引用给断言用（先 stub 成服务类型会让 expect(obj.method) 触发 unbound-method）。
 */
function poolWith(
  pending: number[],
  claimed: Set<number>,
  inFlight = 0,
  limit = 4,
) {
  process.env.CONTENT_JOB_CONCURRENCY = String(limit);
  const findMany = jest.fn(async (): Promise<{ id: number }[]> =>
    pending.slice(0, limit).map((id) => ({ id })),
  );
  const prisma = stub<PrismaService>({
    contentGenerationJob: { findMany },
  });
  const healStale = jest.fn(async () => undefined);
  const inflight = jest.fn(() => inFlight);
  const claim = jest.fn(async (id: number) => claimed.has(id));
  const start = jest.fn<void, [number]>();
  const jobs = stub<ContentJobService>({ healStale, inflight, claim, start });
  return {
    pool: new ContentJobWorkerPool(prisma, jobs),
    mocks: { findMany, healStale, inflight, claim, start },
  };
}

describe('ContentJobWorkerPool', () => {
  afterEach(() => {
    delete process.env.CONTENT_JOB_CONCURRENCY;
  });

  it('只起跑条件更新成功的任务（抢失败的不重复起跑）', async () => {
    const { pool, mocks } = poolWith([1, 2, 3], new Set([2, 3]));
    await pool.tick();
    expect(mocks.claim).toHaveBeenCalledTimes(3);
    expect(mocks.start.mock.calls.map((call) => call[0])).toEqual([2, 3]);
  });

  it('没有剩余并发槽时不捞任务', async () => {
    const { pool, mocks } = poolWith([1, 2], new Set([1, 2]), 4);
    await pool.tick();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('每轮先收口僵尸 RUNNING 任务', async () => {
    const { pool, mocks } = poolWith([], new Set());
    await pool.tick();
    expect(mocks.healStale).toHaveBeenCalled();
  });

  it('收口抛错只记日志，不影响下一轮', async () => {
    const { pool, mocks } = poolWith([1], new Set([1]));
    mocks.healStale.mockRejectedValueOnce(new Error('db down'));
    await expect(pool.tick()).resolves.toBeUndefined();
    await pool.tick();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
