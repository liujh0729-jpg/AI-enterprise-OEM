import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { RpaChromeLibraryService } from './chrome-library.service';

/**
 * 浏览器代理的本账号私有资产台账：一切按 createdBy 收口。
 * 这三件事错了就会串号：越权读别人的会话、同名技能重复建行、重复上报把消息写重。
 */

type Row = Record<string, unknown>;

const owner = new CurrentUser('9001', 'owner', 'user');
const other = new CurrentUser('9002', 'other', 'user');

/** 简化的 where 匹配：等值 + in + contains；够覆盖本服务用到的查询。 */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const bag = cond as Record<string, unknown>;
      if ('in' in bag) return (bag['in'] as unknown[]).includes(row[key]);
      if ('contains' in bag) {
        const value = row[key];
        return (
          typeof value === 'string' && value.includes(String(bag['contains']))
        );
      }
      return true;
    }
    return row[key] === cond;
  });
}

/** 取 opts.where（缺省给空表，类型收窄成 Row）。 */
function whereOf(opts: Row): Row {
  const where = opts['where'];
  return where && typeof where === 'object' ? (where as Row) : {};
}

/** 排序比较：日期与数字按大小，其余按字符串兜底（替身只需复现用到的 orderBy）。 */
function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() < right.getTime() ? -1 : 1;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left < right ? -1 : 1;
  }
  return String(left) < String(right) ? -1 : 1;
}

function sorter(orderBy: unknown) {
  const [field, dir] = Object.entries(
    (orderBy as Record<string, 'asc' | 'desc'>) || {},
  )[0] || ['id', 'asc'];
  return (a: Row, b: Row) => {
    const cmp = compareValues(a[field], b[field]);
    return dir === 'desc' ? -cmp : cmp;
  };
}

const now = () => new Date();

/** Prisma 会自动写 createdAt/updatedAt（以及模型的 startedAt 默认值），内存替身得自己补齐。 */
function fillCreate(table: string, data: Row): Row {
  const row: Row = {
    ...data,
    createdAt: data['createdAt'] ?? now(),
    updatedAt: now(),
  };
  if (table === 'agent') {
    row['startedAt'] = data['startedAt'] ?? now();
    row['endedAt'] = data['endedAt'] ?? null;
  }
  return row;
}

function fakePrisma() {
  const store: Record<string, Row[]> = {
    agent: [],
    message: [],
    skill: [],
    recording: [],
    extract: [],
    device: [],
  };
  const seq: Record<string, number> = {};
  const next = (table: string) => (seq[table] = (seq[table] ?? 0) + 1);
  const list = (table: string) => store[table];

  const find = (table: string, where: Row, opts: Row = {}) => {
    let rows = list(table).filter((row) => matches(row, where));
    if (opts['orderBy']) rows = [...rows].sort(sorter(opts['orderBy']));
    if (opts['skip']) rows = rows.slice(Number(opts['skip']));
    if (opts['take'] !== undefined) rows = rows.slice(0, Number(opts['take']));
    return rows.map((row) => ({ ...row }));
  };

  const prisma = stub<PrismaService>({
    rpaChromeAgent: {
      count: ({ where }: { where: Row }) =>
        Promise.resolve(find('agent', where).length),
      findMany: (opts: Row) =>
        Promise.resolve(find('agent', whereOf(opts), opts)),
      findFirst: (opts: Row) => {
        const [first] = find('agent', whereOf(opts), opts);
        return Promise.resolve(first ?? null);
      },
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { createdBy_clientId_clientAgentId: Row };
        create: Row;
        update: Row;
      }) => {
        const key = where.createdBy_clientId_clientAgentId;
        const existing = list('agent').find((row) => matches(row, key));
        if (existing) {
          Object.assign(existing, update);
          if (typeof update.credits === 'object') {
            // 本模型没有 increment 字段，保持原值即可
            existing.credits = create.credits ?? existing.credits;
          }
          existing.updatedAt = now();
          return Promise.resolve({ ...existing });
        }
        const row = { id: next('agent'), ...fillCreate('agent', create) };
        list('agent').push(row);
        return Promise.resolve({ ...row });
      },
    },
    rpaChromeMessage: {
      findFirst: (opts: Row) => {
        const rows = find('message', whereOf(opts), opts);
        if (opts['select']) {
          const picked: Row = {};
          for (const field of Object.keys(opts['select'])) {
            picked[field] = rows[0]?.[field];
          }
          return Promise.resolve(rows[0] ? picked : null);
        }
        return Promise.resolve(rows[0] ?? null);
      },
      findMany: (opts: Row) =>
        Promise.resolve(find('message', whereOf(opts), opts)),
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { agentId_seq: Row };
        create: Row;
        update: Row;
      }) => {
        const key = where.agentId_seq;
        const existing = list('message').find((row) => matches(row, key));
        if (existing) {
          Object.assign(existing, update);
          existing.updatedAt = now();
          return Promise.resolve({ ...existing });
        }
        const row = { id: next('message'), ...fillCreate('message', create) };
        list('message').push(row);
        return Promise.resolve({ ...row });
      },
    },
    rpaChromeSkill: {
      findMany: (opts: Row) =>
        Promise.resolve(find('skill', whereOf(opts), opts)),
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { createdBy_name: Row };
        create: Row;
        update: Row;
      }) => {
        const key = where.createdBy_name;
        const existing = list('skill').find((row) => matches(row, key));
        if (existing) {
          const patch = { ...update };
          if (patch['version'] && typeof patch['version'] === 'object') {
            patch['version'] = Number(existing['version'] || 0) + 1;
          }
          Object.assign(existing, patch);
          existing.updatedAt = now();
          return Promise.resolve({ ...existing });
        }
        const row = {
          id: next('skill'),
          version: 1,
          ...fillCreate('skill', create),
        };
        list('skill').push(row);
        return Promise.resolve({ ...row });
      },
      deleteMany: ({ where }: { where: Row }) => {
        const rows = list('skill');
        const kept = rows.filter((row) => !matches(row, where));
        const removed = rows.length - kept.length;
        store['skill'] = kept;
        return Promise.resolve({ count: removed });
      },
    },
    rpaChromeRecording: {
      findMany: (opts: Row) =>
        Promise.resolve(find('recording', whereOf(opts), opts)),
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { createdBy_name: Row };
        create: Row;
        update: Row;
      }) => {
        const key = where.createdBy_name;
        const existing = list('recording').find((row) => matches(row, key));
        if (existing) {
          Object.assign(existing, update);
          existing.updatedAt = now();
          return Promise.resolve({ ...existing });
        }
        const row = {
          id: next('recording'),
          ...fillCreate('recording', create),
        };
        list('recording').push(row);
        return Promise.resolve({ ...row });
      },
      deleteMany: ({ where }: { where: Row }) => {
        const rows = list('recording');
        const kept = rows.filter((row) => !matches(row, where));
        const removed = rows.length - kept.length;
        store['recording'] = kept;
        return Promise.resolve({ count: removed });
      },
    },
    rpaChromeExtract: {
      findMany: (opts: Row) =>
        Promise.resolve(find('extract', whereOf(opts), opts)),
      create: ({ data }: { data: Row }) => {
        const row = { id: next('extract'), ...fillCreate('extract', data) };
        list('extract').push(row);
        return Promise.resolve({ ...row });
      },
    },
    rpaChromeDevice: {
      findMany: (opts: Row) =>
        Promise.resolve(find('device', whereOf(opts), opts)),
    },
  });
  return { prisma, store };
}

describe('浏览器代理台账（RpaChromeLibraryService）', () => {
  it('越权：别人的会话读不到、别人的技能删不掉', async () => {
    const { prisma, store } = fakePrisma();
    const service = new RpaChromeLibraryService(prisma);
    store['agent'].push({
      id: 1,
      createdBy: owner.userId,
      clientId: 'c-dev',
      clientAgentId: 's1',
      mode: 'act',
      goal: '抓一下',
      status: 'RUNNING',
      stepCount: 0,
      maxSteps: 25,
      model: '',
      credits: 0,
      stopReason: '',
      errorMessage: '',
      startedAt: new Date(),
      endedAt: null,
      createdAt: new Date(),
    });
    await service.saveSkill(owner, { name: '小红书发帖', content: '步骤' });

    await expect(service.agentView(other, 1)).rejects.toBeInstanceOf(
      BusinessException,
    );
    await expect(service.removeSkill(other, '1')).rejects.toBeInstanceOf(
      BusinessException,
    );
    await expect(
      service.appendMessage(other, '1', { content: 'x' }),
    ).rejects.toBeInstanceOf(BusinessException);
    // 属主自己不受影响
    const mine = await service.agentView(owner, 1);
    expect(mine.goal).toBe('抓一下');
  });

  it('幂等：同设备同本地会话号只更新不重复建行', async () => {
    const { prisma, store } = fakePrisma();
    const service = new RpaChromeLibraryService(prisma);
    await service.saveAgent(owner, {
      clientId: 'c-dev',
      clientAgentId: 's1',
      goal: '第一版',
      stepCount: 1,
    });
    await service.saveAgent(owner, {
      clientId: 'c-dev',
      clientAgentId: 's1',
      goal: '第二版',
      status: 'COMPLETED',
      stepCount: 3,
    });
    expect(store['agent']).toHaveLength(1);
    expect(store['agent'][0].goal).toBe('第二版');
    expect(store['agent'][0].status).toBe('COMPLETED');
  });

  it('幂等：同 seq 的消息重复上报只更新，不新增', async () => {
    const { prisma, store } = fakePrisma();
    const service = new RpaChromeLibraryService(prisma);
    await service.saveAgent(owner, {
      clientId: 'c-dev',
      clientAgentId: 's1',
      goal: 'g',
    });
    const first = await service.appendMessage(owner, '1', {
      seq: 1,
      content: '一',
    });
    const again = await service.appendMessage(owner, '1', {
      seq: 1,
      content: '一改',
    });
    expect(store['message']).toHaveLength(1);
    expect(first.id).toBe(again.id);
    expect(store['message'][0].content).toBe('一改');
    // 不传 seq 自动顺延
    await service.appendMessage(owner, '1', { content: '二' });
    expect(store['message']).toHaveLength(2);
    expect(store['message'][1].seq).toBe(2);
  });

  it('同名技能覆盖写、版本号自增；site 技能保留归属站点', async () => {
    const { prisma } = fakePrisma();
    const service = new RpaChromeLibraryService(prisma);
    const created = await service.saveSkill(owner, {
      name: '投稿流程',
      kind: 'site',
      site: 'mp.weixin.qq.com',
      content: '第一步',
    });
    expect(created.version).toBe(1);
    expect(created.site).toBe('mp.weixin.qq.com');
    const updated = await service.saveSkill(owner, {
      name: '投稿流程',
      kind: 'site',
      site: 'mp.weixin.qq.com',
      content: '第二步',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.version).toBe(2);
    expect(updated.content).toBe('第二步');
  });

  it('录制必须有动作；抽取结果空则不落库', async () => {
    const { prisma } = fakePrisma();
    const service = new RpaChromeLibraryService(prisma);
    await expect(
      service.saveRecording(owner, { name: '空录制', actions: [] }),
    ).rejects.toBeInstanceOf(BusinessException);
    const saved = await service.saveRecording(owner, {
      name: '每日签到',
      actions: [{ action: 'act', act: 'click', elementIndex: 1 }],
    });
    expect(saved.stepCount).toBe(1);
    await expect(
      service.saveExtract(owner, { rows: [], data: {} }),
    ).rejects.toBeInstanceOf(BusinessException);
  });
});
