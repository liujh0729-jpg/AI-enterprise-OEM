import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { HrmScopeService } from '../hrm/hrm.scope';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import type { ChromeAgentService } from './chrome-agent.service';
import { RpaChromeScheduleService } from './chrome-schedule.service';

/**
 * 浏览器代理计划任务：三件事错了就会出事——
 * 越权动了别人的任务、账号停用后仍在跑、设备离线还照记「成功」。
 * 这里用内存替身把这三条与「到点推进下一次」钉住。
 */

type Row = Record<string, unknown>;

const owner = new CurrentUser('9001', 'owner', 'user');

const now = () => new Date();

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const bag = cond as Record<string, unknown>;
      if ('in' in bag) return (bag['in'] as unknown[]).includes(row[key]);
      if ('lte' in bag) {
        const value = row[key];
        return (
          value instanceof Date &&
          value.getTime() <= (bag['lte'] as Date).getTime()
        );
      }
      return true;
    }
    return row[key] === cond;
  });
}

function whereOf(opts: Row): Row {
  const where = opts['where'];
  return where && typeof where === 'object' ? (where as Row) : {};
}

/** 只实现本服务用到的表与动作：够跑 advanceDue / runNow / save / remove。 */
function fakePrisma() {
  const schedules: Row[] = [];
  const devices: Row[] = [];
  const sessions: Row[] = [];
  let seq = 0;

  const scheduleTable = {
    findMany: (opts: Row = {}) => {
      let rows = schedules.filter((row) => matches(row, whereOf(opts)));
      rows = [...rows].sort(
        (a, b) => (b['id'] as number) - (a['id'] as number),
      );
      if (opts['take'] !== undefined)
        rows = rows.slice(0, Number(opts['take']));
      return Promise.resolve(rows.map((row) => ({ ...row })));
    },
    findFirst: (opts: Row) => {
      const rows = schedules.filter((row) => matches(row, whereOf(opts)));
      return Promise.resolve(rows[0] ? { ...rows[0] } : null);
    },
    create: ({ data }: { data: Row }) => {
      const row: Row = {
        id: (seq += 1),
        lastRunAt: null,
        lastStatus: '',
        lastError: '',
        lastSessionId: 0,
        runCount: 0,
        createdAt: now(),
        ...data,
        updatedAt: now(),
      };
      schedules.push(row);
      return Promise.resolve({ ...row });
    },
    update: ({ where, data }: { where: Row; data: Row }) => {
      const row = schedules.find((item) => matches(item, where));
      if (!row) throw new Error('计划任务不存在');
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'increment' in value) {
          row[key] =
            Number(row[key] || 0) + Number((value as Row)['increment']);
        } else {
          row[key] = value;
        }
      }
      row['updatedAt'] = now();
      return Promise.resolve({ ...row });
    },
    deleteMany: ({ where }: { where: Row }) => {
      const kept = schedules.filter((row) => !matches(row, where));
      const removed = schedules.length - kept.length;
      schedules.length = 0;
      schedules.push(...kept);
      return Promise.resolve({ count: removed });
    },
  };

  const prisma = stub<PrismaService>({
    rpaChromeSchedule: scheduleTable,
    rpaChromeDevice: {
      findUnique: (opts: Row) => {
        const key =
          (whereOf(opts) as { createdBy_clientId?: Row }).createdBy_clientId ||
          {};
        const row = devices.find((item) => matches(item, key));
        return Promise.resolve(row ? { ...row } : null);
      },
      findMany: (opts: Row) =>
        Promise.resolve(
          devices
            .filter((row) => matches(row, whereOf(opts)))
            .map((row) => ({ ...row })),
        ),
    },
    rpaChromeSession: {
      findMany: (opts: Row) =>
        Promise.resolve(
          sessions
            .filter((row) => matches(row, whereOf(opts)))
            .map((row) => ({ ...row })),
        ),
    },
  });

  return { prisma, schedules, devices, sessions };
}

function fakeScope(standing = true) {
  return stub<HrmScopeService>({
    isStanding: () => Promise.resolve(standing),
  });
}

function fakeAgent(impl?: () => Promise<{ id: number }>) {
  const started: Row[] = [];
  const agent = stub<ChromeAgentService>({
    startSession: (_user: CurrentUser, body: Record<string, unknown>) => {
      started.push(body);
      if (impl) return impl();
      return Promise.resolve({ id: 77 });
    },
  });
  return { agent, started };
}

function seed(prisma: ReturnType<typeof fakePrisma>, overrides: Row = {}) {
  const row: Row = {
    id: 1,
    createdBy: owner.userId,
    clientId: 'rc_dev_1',
    title: '每日导出',
    goal: '打开后台导出昨日订单',
    mode: 'act',
    startUrl: '',
    script: [],
    model: '',
    maxSteps: 25,
    scheduleType: 'recurring',
    scheduleConfig: { freq: 'daily', time: '09:00' },
    scheduledAt: new Date(Date.now() - 60_000),
    status: 'enabled',
    lastRunAt: null,
    lastStatus: '',
    lastError: '',
    lastSessionId: 0,
    runCount: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
  prisma.schedules.push(row);
  return row;
}

function build(
  prisma: ReturnType<typeof fakePrisma>,
  standing = true,
  agent = fakeAgent(),
) {
  const service = new RpaChromeScheduleService(
    prisma.prisma,
    fakeScope(standing),
    agent.agent,
  );
  return { service, agent };
}

describe('RpaChromeScheduleService', () => {
  it('越权：动别人的计划任务一律 404，且不真的删掉', async () => {
    const prisma = fakePrisma();
    seed(prisma);
    const { service } = build(prisma);
    const other = new CurrentUser('9002', 'other', 'user');
    await expect(service.remove(other, '1')).rejects.toBeInstanceOf(
      BusinessException,
    );
    await expect(service.runNow(other, '1')).rejects.toBeInstanceOf(
      BusinessException,
    );
    expect(prisma.schedules).toHaveLength(1);
  });

  it('复权：账号停用后到点不再跑，自动暂停并记「已跳过」', async () => {
    const prisma = fakePrisma();
    const row = seed(prisma);
    const { service, agent } = build(prisma, false);
    const count = await service.advanceDue();
    expect(count).toBe(1);
    expect(agent.started).toHaveLength(0);
    expect(row.status).toBe('paused');
    expect(row.scheduledAt).toBeNull();
    expect(row.lastStatus).toBe('skipped');
    expect(row.runCount).toBe(0);
  });

  it('绿灯闸：设备离线（发起抛「当前离线」）记跳过，不谎报成功', async () => {
    const prisma = fakePrisma();
    const row = seed(prisma);
    const { service } = build(
      prisma,
      true,
      fakeAgent(() =>
        Promise.reject(
          new BusinessException(
            ErrorCode.BAD_REQUEST,
            '设备「本机」当前离线（超过 90 秒没有心跳）',
          ),
        ),
      ),
    );
    await service.advanceDue();
    expect(row.lastStatus).toBe('skipped');
    expect(row.lastError).toContain('离线');
    expect(row.runCount).toBe(0);
  });

  it('到点推进：周期任务把下一次推走并在线时起一轮；定时一次跑完即置空', async () => {
    const prisma = fakePrisma();
    const recurring = seed(prisma, { id: 1, scheduleType: 'recurring' });
    const once = seed(prisma, {
      id: 2,
      scheduleType: 'scheduled',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const { service, agent } = build(prisma, true);
    const count = await service.advanceDue();
    expect(count).toBe(2);
    expect(agent.started).toHaveLength(2);
    expect(recurring.scheduledAt).toBeInstanceOf(Date);
    expect((recurring.scheduledAt as Date).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(recurring.lastStatus).toBe('running');
    expect(recurring.lastSessionId).toBe(77);
    expect(recurring.runCount).toBe(1);
    expect(once.scheduledAt).toBeNull();
  });

  it('保存校验：没有设备、或周期算不出下一次，都要当场报错', async () => {
    const prisma = fakePrisma();
    const { service } = build(prisma);
    await expect(
      service.save(owner, {
        title: 't',
        goal: 'g',
        clientId: 'rc_missing',
        scheduleType: 'recurring',
        scheduleConfig: { freq: 'daily', time: '09:00' },
      }),
    ).rejects.toBeInstanceOf(BusinessException);
    prisma.devices.push({
      clientId: 'rc_dev_1',
      name: '本机',
      status: 'ONLINE',
    });
    await expect(
      service.save(owner, {
        title: 't',
        goal: 'g',
        clientId: 'rc_dev_1',
        scheduleType: 'weekly',
        scheduleConfig: { freq: 'weekly', time: '09:00' },
      }),
    ).rejects.toBeInstanceOf(BusinessException);
  });
});
