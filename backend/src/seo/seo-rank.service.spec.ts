import { SeoRankService } from './seo-rank.service';
import type { SeoContext } from './seo-base.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { stub } from '../../test/doubles';

function setup() {
  const runFindFirst = jest.fn();
  const runUpdate = jest.fn().mockResolvedValue({});
  const runCreate = jest.fn().mockResolvedValue({ id: 99 });
  const trackerFindUnique = jest.fn();
  const keywordCount = jest.fn();
  const ctx = stub<SeoContext>({
    prisma: {
      seoRankRun: {
        findFirst: runFindFirst,
        update: runUpdate,
        create: runCreate,
      },
      seoRankTracker: { findUnique: trackerFindUnique },
      seoRankKeyword: { count: keywordCount },
    },
  });
  return {
    service: new SeoRankService(ctx),
    runFindFirst,
    runUpdate,
    runCreate,
    trackerFindUnique,
    keywordCount,
  };
}

describe('SeoRankService.claim 单飞约束', () => {
  it('已有新鲜心跳的批次在跑 → 抛 CONFLICT，不新建', async () => {
    const s = setup();
    s.runFindFirst.mockResolvedValue({
      id: 1,
      heartbeatAt: new Date(),
      startedAt: new Date(),
    });
    await expect(s.service.claim(5, 'MANUAL')).rejects.toMatchObject({
      errorCode: ErrorCode.CONFLICT,
    });
    expect(s.runCreate).not.toHaveBeenCalled();
  });

  it('无在跑批次 → 新建并占用 activeLock=trackerId', async () => {
    const s = setup();
    s.runFindFirst.mockResolvedValue(null);
    s.trackerFindUnique.mockResolvedValue({ id: 5, reads: 1 });
    s.keywordCount.mockResolvedValue(3);
    await s.service.claim(5, 'MANUAL');
    expect(s.runCreate).toHaveBeenCalledTimes(1);
    const data = s.runCreate.mock.calls[0][0].data;
    expect(data.activeLock).toBe(5);
    expect(data.trackerId).toBe(5);
    expect(data.status).toBe('PENDING');
  });

  it('心跳超时的旧批次先回收为 FAILED 再新建', async () => {
    const s = setup();
    s.runFindFirst.mockResolvedValue({
      id: 1,
      heartbeatAt: new Date(Date.now() - 11 * 60_000),
      startedAt: new Date(Date.now() - 11 * 60_000),
    });
    s.trackerFindUnique.mockResolvedValue({ id: 5, reads: 1 });
    s.keywordCount.mockResolvedValue(2);
    await s.service.claim(5, 'SCHEDULED');
    expect(s.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'FAILED', activeLock: null }),
      }),
    );
    expect(s.runCreate).toHaveBeenCalledTimes(1);
  });

  it('跟踪器不存在 → NOT_FOUND', async () => {
    const s = setup();
    s.runFindFirst.mockResolvedValue(null);
    s.trackerFindUnique.mockResolvedValue(null);
    await expect(s.service.claim(5, 'MANUAL')).rejects.toBeInstanceOf(
      BusinessException,
    );
    expect(s.runCreate).not.toHaveBeenCalled();
  });

  it('跟踪器无关键词 → BAD_REQUEST，不新建', async () => {
    const s = setup();
    s.runFindFirst.mockResolvedValue(null);
    s.trackerFindUnique.mockResolvedValue({ id: 5, reads: 1 });
    s.keywordCount.mockResolvedValue(0);
    await expect(s.service.claim(5, 'MANUAL')).rejects.toMatchObject({
      errorCode: ErrorCode.BAD_REQUEST,
    });
    expect(s.runCreate).not.toHaveBeenCalled();
  });
});
