import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { BrowserTaskService } from '../platform/browser-task.service';
import { ExtensionCatalogService } from '../platform/extension-catalog.service';
import { DistributionService } from './distribution.service';
import { stub } from '../../test/doubles';

const user = new CurrentUser('u1', 'tester', 'user');

const baseRow = {
  id: 10,
  userId: 'u1',
  mediaType: 'ARTICLE',
  platformCodes: ['zhihu', 'toutiao'],
  title: 't',
  content: '<p>x</p>',
  images: [],
  autoPublish: false,
  status: 'DONE',
  tags: '',
  lastDistributedAt: null,
  createdAt: new Date('2026-11-10T01:00:00.000Z'),
  updatedAt: new Date('2026-11-10T01:00:00.000Z'),
};

const logRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  contentId: 10,
  userId: 'u1',
  platformCode: 'zhihu',
  platformName: '知乎',
  status: 'FILLED',
  publishedUrl: '',
  publishedItemId: '',
  errorMsg: '',
  source: '',
  views: 0,
  likes: 0,
  comments: 0,
  metricsSource: '',
  metricsCapturedAt: null,
  createdAt: new Date('2026-11-10T02:00:00.000Z'),
  ...overrides,
});

function prismaWith(options: {
  existing?: ReturnType<typeof logRow> | null;
  created?: ReturnType<typeof logRow>;
  updated?: ReturnType<typeof logRow>;
}) {
  const update = jest.fn().mockResolvedValue(options.updated ?? logRow());
  const create = jest.fn().mockResolvedValue(options.created ?? logRow());
  return stub<PrismaService>({
    __update: update,
    __create: create,
    distributionContent: {
      findFirst: jest.fn().mockResolvedValue(baseRow),
      update: jest.fn().mockResolvedValue(baseRow),
      delete: jest.fn().mockResolvedValue(baseRow),
    },
    distributionPublishLog: {
      findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
      update,
      create,
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaRef),
    ),
  });
}

let prismaRef: unknown;

/** 浏览器任务服务替身：只实现分发服务实际调用的成员。 */
function browserTaskStub() {
  return {
    dispatch: jest.fn().mockResolvedValue({ id: 1, status: 'CLAIMED' }),
    openForSource: jest.fn().mockResolvedValue(null),
    report: jest.fn().mockResolvedValue({ id: 1, status: 'SUCCEEDED' }),
    cancelBySource: jest.fn().mockResolvedValue(1),
  };
}

let browserTaskRef: ReturnType<typeof browserTaskStub>;

function serviceOf(options: {
  existing?: ReturnType<typeof logRow> | null;
  created?: ReturnType<typeof logRow>;
  updated?: ReturnType<typeof logRow>;
}) {
  const prisma = prismaWith(options);
  prismaRef = prisma;
  browserTaskRef = browserTaskStub();
  const catalog = stub<ExtensionCatalogService>({
    assertDispatchable: jest.fn().mockResolvedValue({}),
  });
  return new DistributionService(
    prisma,
    catalog,
    stub<BrowserTaskService>(browserTaskRef),
  );
}

describe('distribution reportMetrics (D8)', () => {
  it('已存在同平台结果行时按「内容+平台」覆盖写效果列，幂等', async () => {
    const service = serviceOf({
      existing: logRow({ id: 55 }),
      updated: logRow({ id: 55, views: 12000, likes: 300, comments: 42 }),
    });

    const result = await service.reportMetrics(user, 10, {
      source: 'MANUAL',
      metrics: [
        {
          platformCode: 'zhihu',
          publishedItemId: 'art-1',
          views: 12000,
          likes: 300,
          comments: 42,
          capturedAt: '2026-11-10T03:00:00.000Z',
        },
      ],
    });

    const prisma = prismaRef as {
      distributionPublishLog: { update: jest.Mock; create: jest.Mock };
    };
    expect(prisma.distributionPublishLog.update).toHaveBeenCalledTimes(1);
    expect(prisma.distributionPublishLog.create).not.toHaveBeenCalled();
    const call = prisma.distributionPublishLog.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 55 });
    expect(call.data).toMatchObject({
      publishedItemId: 'art-1',
      views: 12000,
      likes: 300,
      comments: 42,
      metricsSource: 'MANUAL',
    });
    expect(result[0].views).toBe(12000);
  });

  it('该平台尚无结果行时补建一行 FILLED，并带上效果列', async () => {
    const created = logRow({
      id: 77,
      platformCode: 'toutiao',
      platformName: '今日头条',
      status: 'FILLED',
      views: 5,
      metricsSource: 'EXTENSION',
    });
    const service = serviceOf({ existing: null, created });

    const result = await service.reportMetrics(user, 10, {
      metrics: [{ platformCode: 'toutiao', views: 5, likes: 0, comments: 0 }],
    });

    const prisma = prismaRef as {
      distributionPublishLog: { update: jest.Mock; create: jest.Mock };
    };
    expect(prisma.distributionPublishLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.distributionPublishLog.update).not.toHaveBeenCalled();
    const call = prisma.distributionPublishLog.create.mock.calls[0][0];
    expect(call.data).toMatchObject({
      contentId: 10,
      userId: 'u1',
      platformCode: 'toutiao',
      status: 'FILLED',
      views: 5,
      source: 'EXTENSION',
    });
    expect(result[0].id).toBe(77);
  });

  it('回写未勾选的平台被拒，防止伪造效果记到别的平台行', async () => {
    const service = serviceOf({});
    await expect(
      service.reportMetrics(user, 10, {
        metrics: [{ platformCode: 'weibo', views: 1, likes: 0, comments: 0 }],
      }),
    ).rejects.toThrow('未在该内容勾选');

    const prisma = prismaRef as {
      distributionPublishLog: { update: jest.Mock };
    };
    expect(prisma.distributionPublishLog.update).not.toHaveBeenCalled();
  });

  it('未登记的平台编码被拒，不落任何效果行', async () => {
    const service = serviceOf({});
    await expect(
      service.reportMetrics(user, 10, {
        metrics: [
          { platformCode: 'not-a-platform', views: 1, likes: 0, comments: 0 },
        ],
      }),
    ).rejects.toThrow('不支持的平台编码');
  });
});

describe('distribution ↔ 统一浏览器任务接线（P3-4）', () => {
  it('mark 落一条持久浏览器任务并按内容锚定来源，动作随自动发布切换', async () => {
    const service = serviceOf({});
    await service.mark(user, 10, '1.3.0');

    expect(browserTaskRef.dispatch).toHaveBeenCalledTimes(1);
    const [taskUser, input] = browserTaskRef.dispatch.mock.calls[0];
    expect(taskUser).toBe(user);
    expect(input).toMatchObject({
      capability: 'distribution',
      action: 'fill',
      platforms: ['zhihu', 'toutiao'],
      source: 'distribution:#10',
      pluginVersion: '1.3.0',
    });
  });

  it('reportLogs 有在办任务时按统一口径回执：SUCCESS 落 SUBMITTED 且带结果链接证据', async () => {
    const service = serviceOf({
      existing: logRow({ id: 9, status: 'FILLED' }),
      updated: logRow({
        id: 9,
        status: 'SUCCESS',
        publishedUrl: 'https://zhihu.com/p/1',
      }),
    });
    browserTaskRef.openForSource.mockResolvedValue({ id: 42 });

    await service.reportLogs(user, 10, {
      source: 'EXTENSION',
      logs: [
        {
          platformCode: 'zhihu',
          status: 'SUCCESS',
          publishedUrl: 'https://zhihu.com/p/1',
        },
      ],
    });

    expect(browserTaskRef.openForSource).toHaveBeenCalledWith(
      'u1',
      'distribution',
      'distribution:#10',
    );
    expect(browserTaskRef.report).toHaveBeenCalledTimes(1);
    const [taskUser, taskId, input] = browserTaskRef.report.mock.calls[0];
    expect(taskUser).toBe(user);
    expect(taskId).toBe(42);
    expect(input.results).toEqual([
      { platform: 'zhihu', status: 'SUBMITTED', url: 'https://zhihu.com/p/1' },
    ]);
    expect(input.evidence).toEqual([
      { kind: 'URL', value: 'https://zhihu.com/p/1', note: '知乎' },
    ]);
  });

  it('reportLogs 无在办任务（人工补记）时不回执，仅落发布结果行', async () => {
    const service = serviceOf({ existing: null, created: logRow({ id: 3 }) });

    await service.reportLogs(user, 10, {
      source: 'MANUAL',
      logs: [{ platformCode: 'zhihu', status: 'FILLED' }],
    });

    expect(browserTaskRef.report).not.toHaveBeenCalled();
  });

  it('remove 删除内容同时按来源取消在办任务', async () => {
    const service = serviceOf({});
    const out = await service.remove(user, 10);

    expect(out).toEqual({ removed: true });
    expect(browserTaskRef.cancelBySource).toHaveBeenCalledWith(
      'u1',
      'distribution',
      'distribution:#10',
    );
  });
});
