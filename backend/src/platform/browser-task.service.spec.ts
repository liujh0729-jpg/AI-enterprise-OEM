import { stub } from '../../test/doubles';
import { CurrentUser } from '../auth/current-user';
import type { BrowserTask } from '../../generated/prisma';
import type { PrismaService } from '../prisma/prisma.service';
import type { ExtensionCatalogService } from './extension-catalog.service';
import { BrowserTaskService } from './browser-task.service';

const user = new CurrentUser('u1', 'tester', 'user');

const OPEN = ['QUEUED', 'CLAIMED', 'RUNNING'];

const baseTask = (overrides: Partial<BrowserTask> = {}) => ({
  id: 1,
  capability: 'distribution',
  action: 'publish',
  jobId: 'bt-distribution-1',
  userId: 'u1',
  orgType: 'ENTERPRISE',
  orgUserId: '',
  platforms: ['zhihu'],
  source: 'distribution:#10',
  payload: { contentId: 10 },
  status: 'CLAIMED',
  leaseOwner: 'u1',
  leaseExpiresAt: new Date('2026-11-10T02:00:00.000Z'),
  attempts: 1,
  maxAttempts: 3,
  receiptStatus: '',
  receiptCode: '',
  receiptMessage: '',
  results: [],
  evidence: [],
  receiptData: {},
  pluginVersion: '1.3.0',
  expiresAt: new Date('2026-11-11T00:00:00.000Z'),
  enqueuedAt: new Date('2026-11-10T01:00:00.000Z'),
  claimedAt: new Date('2026-11-10T01:00:00.000Z'),
  finishedAt: null,
  createdAt: new Date('2026-11-10T01:00:00.000Z'),
  updatedAt: new Date('2026-11-10T01:00:00.000Z'),
  ...overrides,
});

/**
 * 浏览器任务表替身：create/findFirst/update 落内存 Map，
 * updateMany 支持按「状态集合 + 租约/失效时间」筛选，足以覆盖派发收口与队列清理。
 */
function prismaStub(rows: Partial<BrowserTask>[] = []) {
  const store = new Map<number, BrowserTask>();
  let seq = 0;
  for (const row of rows) {
    const id = row.id ?? (seq += 1);
    store.set(id, baseTask({ id, ...row }));
  }
  const updateMany = jest.fn(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<BrowserTask>;
    }) => {
      let count = 0;
      for (const [id, row] of store) {
        if (!matches(row, where)) continue;
        store.set(id, { ...row, ...data });
        count += 1;
      }
      return { count };
    },
  );
  return {
    __store: store,
    __updateMany: updateMany,
    browserTask: {
      create: jest.fn(async ({ data }: { data: Partial<BrowserTask> }) => {
        seq += 1;
        const row = baseTask({ id: seq, ...data });
        store.set(row.id, row);
        return row;
      }),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          for (const row of store.values()) if (matches(row, where)) return row;
          return null;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: number };
          data: Partial<BrowserTask>;
        }) => {
          const row = store.get(where.id);
          if (!row) throw new Error('task not found');
          const next = {
            ...row,
            ...Object.fromEntries(
              Object.entries(data).filter(([, value]) => value !== undefined),
            ),
          };
          store.set(where.id, next);
          return next;
        },
      ),
      updateMany,
    },
  };
}

/** 把 Prisma where 的常用子集（等值 / in / lt）落到内存行上。 */
function matches(row: BrowserTask, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = (row as Record<string, unknown>)[key];
    if (cond && typeof cond === 'object' && 'in' in cond) {
      return (cond.in as unknown[]).includes(value);
    }
    if (cond && typeof cond === 'object' && 'lt' in cond) {
      const at = cond.lt as Date;
      return value instanceof Date && value.getTime() < at.getTime();
    }
    return value === cond;
  });
}

function serviceOf(prisma: ReturnType<typeof prismaStub>) {
  const catalog = stub<ExtensionCatalogService>({
    assertDispatchable: jest.fn().mockResolvedValue({}),
  });
  return {
    service: new BrowserTaskService(stub<PrismaService>(prisma), catalog),
    catalog,
    prisma,
  };
}

describe('BrowserTaskService（§10.3 持久队列 + 租约 + 回执）', () => {
  it('派发即落库并认领租约，未知能力动作直接拒绝', async () => {
    const { service, prisma } = serviceOf(prismaStub());
    const task = await service.dispatch(user, {
      capability: 'distribution',
      action: 'publish',
      platforms: ['zhihu', 'toutiao'],
      source: 'distribution:#10',
      payload: { contentId: 10, title: '标题', content: '正文' },
    });
    expect(task.status).toBe('CLAIMED');
    expect(task.leaseOwner).toBe('u1');
    expect(task.platforms).toEqual(['zhihu', 'toutiao']);
    expect(prisma.browserTask.create).toHaveBeenCalledTimes(1);

    await expect(
      service.dispatch(user, { capability: 'distribution', action: 'hack' }),
    ).rejects.toThrow('未登记的插件能力动作');
  });

  it('派发前过能力门槛：目录判定不可派发时抛错且不建任务', async () => {
    const { service, catalog, prisma } = serviceOf(prismaStub());
    (catalog.assertDispatchable as jest.Mock).mockRejectedValue(
      new Error('插件版本过低'),
    );
    await expect(
      service.dispatch(user, {
        capability: 'distribution',
        action: 'fill',
        pluginVersion: '0.0.1',
        payload: { contentId: 10, title: '标题', content: '正文' },
      }),
    ).rejects.toThrow('插件版本过低');
    expect(prisma.browserTask.create).not.toHaveBeenCalled();
  });

  it('同来源重复派发把旧的未终结任务按 EXPIRED 收尾，只留一条在办', async () => {
    const { service, prisma } = serviceOf(
      prismaStub([{ id: 7, status: 'RUNNING' }]),
    );
    await service.dispatch(user, {
      capability: 'distribution',
      action: 'fill',
      source: 'distribution:#10',
      payload: { contentId: 10, title: '标题', content: '正文' },
    });
    expect(prisma.__store.get(7)?.status).toBe('EXPIRED');
    const open = [...prisma.__store.values()].filter((row) =>
      OPEN.includes(row.status),
    );
    expect(open).toHaveLength(1);
  });

  it('回执 SUCCESS 终结任务并落结果/证据，重复回执幂等不覆盖', async () => {
    const { service, prisma } = serviceOf(
      prismaStub([{ id: 3, status: 'CLAIMED' }]),
    );
    const done = await service.report(user, 3, {
      results: [{ platform: 'zhihu', status: 'SUBMITTED' }],
      evidence: [{ kind: 'URL', value: 'https://zhihu.com/p/1', note: '' }],
      status: 'SUCCESS',
    });
    expect(done.status).toBe('SUCCEEDED');
    expect(prisma.__store.get(3)?.leaseOwner).toBe('');
    expect(prisma.__store.get(3)?.finishedAt).toBeInstanceOf(Date);

    const again = await service.report(user, 3, {
      results: [{ platform: 'zhihu', status: 'FAILED' }],
      status: 'FAILED',
    });
    expect(again.status).toBe('SUCCEEDED');
    expect(prisma.__store.get(3)?.results).toEqual([
      { platform: 'zhihu', status: 'SUBMITTED' },
    ]);
  });

  it('回执 ACCEPTED/RUNNING 只推进到执行中，不终结任务', async () => {
    const { service, prisma } = serviceOf(
      prismaStub([{ id: 4, status: 'CLAIMED' }]),
    );
    const running = await service.report(user, 4, { status: 'RUNNING' });
    expect(running.status).toBe('RUNNING');
    expect(prisma.__store.get(4)?.finishedAt).toBeNull();
  });

  it('逐条结果无显式状态时按汇总推断：全部已提交即 SUCCESS', async () => {
    const { service, prisma } = serviceOf(
      prismaStub([{ id: 5, status: 'RUNNING' }]),
    );
    const done = await service.report(user, 5, {
      results: [{ status: 'SUBMITTED' }, { status: 'SUBMITTED' }],
    });
    expect(done.status).toBe('SUCCEEDED');
    expect(prisma.__store.get(5)?.receiptStatus).toBe('SUCCESS');
  });

  it('回执未带插件版本时不覆盖派发时记下的版本', async () => {
    const { service } = serviceOf(
      prismaStub([{ id: 6, status: 'CLAIMED', pluginVersion: '1.3.0' }]),
    );
    const done = await service.report(user, 6, { status: 'SUCCESS' });
    expect(done.pluginVersion).toBe('1.3.0');
  });

  it('非本人任务回执返回未找到', async () => {
    const { service } = serviceOf(
      prismaStub([{ id: 8, userId: 'other', status: 'CLAIMED' }]),
    );
    await expect(
      service.report(user, 8, { status: 'SUCCESS' }),
    ).rejects.toThrow('浏览器任务不存在');
  });

  it('统一回执落库按能力挂到最近未终结任务，终态与回执数据一并写入', async () => {
    const { service, prisma } = serviceOf(
      prismaStub([
        { id: 11, status: 'CLAIMED', capability: 'acquisition' },
        { id: 12, status: 'SUCCEEDED', capability: 'acquisition' },
      ]),
    );
    const result = await service.recordReceipt(user, {
      capability: 'acquisition',
      action: 'collect',
      status: 'SUCCESS',
      receiptData: { runId: 9 },
      data: { runId: 9, newLeads: 2 },
    });
    expect(result).toEqual({ recorded: true });
    const row = prisma.__store.get(11);
    expect(row?.status).toBe('SUCCEEDED');
    expect(row?.receiptData).toEqual({ runId: 9, newLeads: 2 });
  });

  it('没有未终结任务时统一回执按幂等忽略，不抛错打断页面', async () => {
    const { service } = serviceOf(prismaStub());
    await expect(
      service.recordReceipt(user, {
        capability: 'acquisition',
        status: 'SUCCESS',
        data: { runId: 1 },
      }),
    ).resolves.toEqual({ recorded: false });
  });

  it('取消某来源的在办任务只影响该来源', async () => {
    const { service, prisma } = serviceOf(
      prismaStub([
        { id: 1, status: 'CLAIMED' },
        { id: 2, status: 'SUCCEEDED' },
        { id: 3, status: 'CLAIMED', source: 'distribution:#99' },
      ]),
    );
    const count = await service.cancelBySource(
      'u1',
      'distribution',
      'distribution:#10',
    );
    expect(count).toBe(1);
    expect(prisma.__store.get(1)?.status).toBe('CANCELLED');
    expect(prisma.__store.get(2)?.status).toBe('SUCCEEDED');
    expect(prisma.__store.get(3)?.status).toBe('CLAIMED');
  });

  it('队列清理回收租约过期与 TTL 到期的任务，不动仍在期内的', async () => {
    const now = new Date('2026-11-10T12:00:00.000Z');
    const { service, prisma } = serviceOf(
      prismaStub([
        {
          id: 1,
          status: 'RUNNING',
          leaseExpiresAt: new Date('2026-11-10T11:00:00.000Z'),
        },
        {
          id: 2,
          status: 'QUEUED',
          leaseExpiresAt: null,
          expiresAt: new Date('2026-11-10T11:00:00.000Z'),
        },
        {
          id: 3,
          status: 'CLAIMED',
          leaseExpiresAt: new Date('2026-11-10T13:00:00.000Z'),
        },
      ]),
    );
    const out = await service.sweep(now);
    expect(out).toEqual({ reclaimed: 1, expired: 1 });
    expect(prisma.__store.get(1)?.status).toBe('EXPIRED');
    expect(prisma.__store.get(2)?.status).toBe('EXPIRED');
    expect(prisma.__store.get(3)?.status).toBe('CLAIMED');
  });

  it('openForSource 返回该来源最新的未终结任务', async () => {
    const { service } = serviceOf(
      prismaStub([
        { id: 1, status: 'EXPIRED' },
        { id: 2, status: 'CLAIMED' },
      ]),
    );
    const open = await service.openForSource(
      'u1',
      'distribution',
      'distribution:#10',
    );
    expect(open?.id).toBe(2);
    expect(await service.openForSource('u1', 'distribution', '')).toBeNull();
  });
});
