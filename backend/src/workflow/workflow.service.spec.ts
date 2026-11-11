import type { Prisma, Workflow } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { ErrorCode } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrgContextService } from '../gaps/org-context.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import { stub } from '../../test/doubles';
import {
  WorkflowService,
  type WorkflowCatalogSources,
} from './workflow.service';
import type { WorkflowEngine } from './workflow-engine';

/**
 * 两件事收在这份用例里：
 * 1）共享分组必须落到「具体哪一个公司 / 哪一个服务商」——不同主体数据域不同，绝不混在一个清单；
 * 2）进程内触发（定时 / 领域事件 / 任务事件 / invoke）的幂等锚与发起人取值。
 * 图编译与 cron 语义分别由 workflow-graph / workflow-cron / workflow-triggers 的用例覆盖，这里不重复。
 */

const CONTEXTS = [
  {
    orgType: 'ENTERPRISE',
    orgUserId: 'ent-a',
    name: '甲公司',
    roleLabel: '负责人',
    current: true,
  },
  {
    orgType: 'ENTERPRISE',
    orgUserId: 'ent-b',
    name: '乙公司',
    roleLabel: '成员',
    current: false,
  },
  {
    orgType: 'PROVIDER',
    orgUserId: 'prov-p',
    name: '丙服务商',
    roleLabel: '负责人',
    current: false,
  },
];

const USER = new CurrentUser('u1', '测试员', 'member');
const NOW = new Date('2026-11-09T01:00:00.000Z');

/** 图按 Json 列的真实形状造：读侧 fromJson 会还原成 WorkflowGraph，这里不需要第二份类型。 */
function triggerNode(
  id: string,
  kind: string,
  config: Prisma.JsonObject = {},
): Prisma.JsonObject {
  return {
    id,
    type: 'trigger',
    kind,
    name: id,
    operationId: '',
    params: {},
    position: { x: 0, y: 0 },
    config,
  };
}

function graphJson(nodes: Prisma.JsonObject[] = []): Prisma.JsonValue {
  return { nodes, edges: [] };
}

type WorkflowSeed = Partial<Omit<Workflow, 'graph'>> & {
  nodes?: Prisma.JsonObject[];
};

function workflowRow(id: number, overrides: WorkflowSeed = {}): Workflow {
  const { nodes, ...rest } = overrides;
  return {
    id,
    ownerUserId: USER.userId,
    orgType: 'ENTERPRISE',
    orgUserId: 'ent-a',
    name: `流程 ${id}`,
    description: '',
    businessKey: null,
    scope: 'PRIVATE',
    status: 'DRAFT',
    version: 1,
    graph: graphJson(nodes),
    budgets: {},
    inputSchema: {},
    outputSchema: {},
    createdBy: USER.userId,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
  };
}

/** 只实现被测代码用到的 where 形态；命中即返回，未实现的算子当作不命中，避免静默放行。 */
function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR') {
      const list = expected as Record<string, unknown>[];
      if (!list.some((item) => matches(row, item))) return false;
      continue;
    }
    if (key === 'AND') {
      const list = expected as Record<string, unknown>[];
      if (!list.every((item) => matches(row, item))) return false;
      continue;
    }
    const actual = row[key];
    if (expected !== null && typeof expected === 'object') {
      const clause = expected as Record<string, unknown>;
      if ('in' in clause) {
        if (!(clause.in as unknown[]).includes(actual)) return false;
        continue;
      }
      if ('not' in clause) {
        if (actual === clause.not) return false;
        continue;
      }
      if ('contains' in clause) {
        const needle = clause.contains;
        if (
          typeof actual !== 'string' ||
          typeof needle !== 'string' ||
          !actual.includes(needle)
        )
          return false;
        continue;
      }
      return false;
    }
    if (actual !== expected) return false;
  }
  return true;
}

/** 运行台账替身：只声明被测代码读到的列，避免为造一行数据去做双重断言。 */
type RunSeed = {
  workflowId: number;
  version: number;
  trigger: string;
  status: string;
  input: unknown;
  actorId: string;
  sourceType: string;
  sourceId: string;
  dedupeKey: string | null;
};

type RunRow = RunSeed & {
  id: number;
  output: unknown;
  error: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

type StepRow = {
  id: number;
  runId: number;
  nodeId: string;
  nodeType: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string;
  attempts: number;
  durationMs: number;
  startedAt: Date | null;
  finishedAt: Date | null;
};

function runMatches(
  row: RunRow,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    const actual = (row as Record<string, unknown>)[key];
    if (expected !== null && typeof expected === 'object') {
      const clause = expected as Record<string, unknown>;
      if ('in' in clause) {
        if (!(clause.in as unknown[]).includes(actual)) return false;
        continue;
      }
      return false;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function build(seed: Workflow[] = [], contexts = CONTEXTS) {
  const workflows = [...seed];
  const versions: { workflowId: number; version: number }[] = seed
    .filter((row) => row.status === 'PUBLISHED')
    .map((row) => ({ workflowId: row.id, version: row.version }));
  const runs: RunRow[] = [];
  const steps: StepRow[] = [];
  const accounts = new Map<
    string,
    { username: string; role: string; enabled: number }
  >([[USER.userId, { username: USER.username, role: USER.role, enabled: 1 }]]);
  let nextRunId = 1;
  let failNextRunCreate = false;

  const findMany = jest.fn(
    ({
      where,
      select,
    }: {
      where?: Prisma.WorkflowWhereInput;
      select?: object;
    }) => {
      const hit = workflows.filter((row) => matches(row, where));
      // publishedVersions 只取 id/version，形状与整行不同，按 select 投影。
      if (select && 'version' in select) {
        return Promise.resolve(
          hit.map((row) => ({ id: row.id, version: row.version })),
        );
      }
      return Promise.resolve(hit);
    },
  );
  const createRun = jest.fn(({ data }: { data: RunSeed }) => {
    if (failNextRunCreate) {
      failNextRunCreate = false;
      return Promise.reject(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
    }
    const run: RunRow = {
      id: nextRunId++,
      output: {},
      error: '',
      startedAt: null,
      finishedAt: null,
      createdAt: NOW,
      ...data,
    };
    runs.push(run);
    return Promise.resolve(run);
  });

  const prisma = stub<PrismaService>({
    workflow: {
      findMany,
      count: jest.fn(({ where }: { where?: Prisma.WorkflowWhereInput }) =>
        Promise.resolve(workflows.filter((row) => matches(row, where)).length),
      ),
      findUnique: jest.fn(
        ({ where }: { where: { id?: number; businessKey?: string } }) =>
          Promise.resolve(
            workflows.find((row) =>
              where.id !== undefined
                ? row.id === where.id
                : row.businessKey === where.businessKey,
            ) ?? null,
          ),
      ),
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { businessKey?: string; id?: { not: number } };
        }) =>
          Promise.resolve(
            workflows.find(
              (row) =>
                row.businessKey === where.businessKey &&
                row.id !== where.id?.not,
            ) ?? null,
          ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = workflowRow(workflows.length + 1, {
          ...data,
          createdAt: NOW,
          updatedAt: NOW,
        });
        workflows.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const row = workflows.find((item) => item.id === where.id);
          if (!row) throw new Error('missing workflow');
          Object.assign(row, data, { updatedAt: NOW });
          return Promise.resolve(row);
        },
      ),
    },
    workflowVersion: {
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: {
            workflowId_version: { workflowId: number; version: number };
          };
          create: { workflowId: number; version: number };
        }) => {
          const key = where.workflowId_version;
          if (
            !versions.some(
              (item) =>
                item.workflowId === key.workflowId &&
                item.version === key.version,
            )
          ) {
            versions.push({
              workflowId: create.workflowId,
              version: create.version,
            });
          }
          return Promise.resolve({
            id: versions.length,
            ...key,
            publishedBy: USER.userId,
          });
        },
      ),
    },
    workflowRun: {
      create: createRun,
      findUnique: jest.fn(
        ({ where }: { where: { id?: number; dedupeKey?: string } }) =>
          Promise.resolve(
            runs.find((run) =>
              where.id !== undefined
                ? run.id === where.id
                : run.dedupeKey === where.dedupeKey,
            ) ?? null,
          ),
      ),
      findMany: jest.fn(
        ({
          where,
          skip = 0,
          take = 20,
        }: {
          where?: Record<string, unknown>;
          skip?: number;
          take?: number;
        }) =>
          Promise.resolve(
            runs
              .filter((run) => runMatches(run, where))
              .slice()
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(skip, skip + take),
          ),
      ),
      count: jest.fn(({ where }: { where?: Record<string, unknown> }) =>
        Promise.resolve(runs.filter((run) => runMatches(run, where)).length),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const row = runs.find((run) => run.id === where.id);
          if (!row) throw new Error('missing run');
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
    },
    workflowRunStep: {
      findMany: jest.fn(
        ({ where }: { where?: { runId?: number | { in: number[] } } }) => {
          const filter = where?.runId;
          const hit = steps.filter((step) =>
            filter === undefined
              ? true
              : typeof filter === 'number'
                ? step.runId === filter
                : filter.in.includes(step.runId),
          );
          return Promise.resolve(hit);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { runId: number; status: string };
          data: Record<string, unknown>;
        }) => {
          const hit = steps.filter(
            (step) =>
              step.runId === where.runId && step.status === where.status,
          );
          for (const step of hit) Object.assign(step, data);
          return Promise.resolve({ count: hit.length });
        },
      ),
    },
    userDirectory: {
      findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(accounts.get(where.userId) ?? null),
      ),
    },
  });

  const orgs = stub<OrgContextService>({
    contexts: jest.fn(() => Promise.resolve(contexts)),
  });
  const engineStart = jest.fn(() => Promise.resolve());
  const engineAnnounce = jest.fn();
  const engine = stub<WorkflowEngine>({
    start: engineStart,
    announce: engineAnnounce,
  });
  const standing = { value: true };
  const isStanding = jest.fn(async () => standing.value);
  const scope = stub<HrmScopeService>({ isStanding });
  const service = new WorkflowService(
    prisma,
    orgs,
    engine,
    stub<WorkflowCatalogSources>({}),
    scope,
  );
  return {
    service,
    prisma,
    engineStart,
    engineAnnounce,
    standing,
    isStanding,
    workflows,
    runs,
    steps,
    accounts,
    findMany,
    createRun,
    collideNextRun: () => {
      failNextRunCreate = true;
    },
    published: (id: number, version = 1) => {
      const row = workflows.find((item) => item.id === id);
      if (row) {
        row.status = 'PUBLISHED';
        row.version = version;
      }
      versions.push({ workflowId: id, version });
    },
  };
}

function listWhere(findMany: jest.Mock) {
  const call = findMany.mock.calls.find(([arg]) => arg?.where && !arg.select);
  return call?.[0].where as Prisma.WorkflowWhereInput;
}

describe('共享清单按主体拆分', () => {
  const seed = [
    workflowRow(1),
    workflowRow(2, { ownerUserId: 'u2', scope: 'ORG', orgUserId: 'ent-a' }),
    workflowRow(3, { ownerUserId: 'u3', scope: 'ORG', orgUserId: 'ent-b' }),
    workflowRow(4, {
      ownerUserId: 'u4',
      scope: 'PROVIDER',
      orgType: 'PROVIDER',
      orgUserId: 'prov-p',
    }),
  ];

  it('选中乙公司时只查乙公司的数据域，不退化成跨主体 in', async () => {
    const ctx = build(seed);
    const result = await ctx.service.list(USER, {
      group: 'org',
      orgUserId: 'ent-b',
    });
    expect(listWhere(ctx.findMany).OR).toEqual([
      { scope: 'ORG', orgUserId: 'ent-b' },
    ]);
    expect(result.list.map((row) => row.id)).toEqual([3]);
    expect(result.total).toBe(1);
  });

  it('服务商共享同样落到具体机构', async () => {
    const ctx = build(seed);
    const result = await ctx.service.list(USER, {
      group: 'provider',
      orgUserId: 'prov-p',
    });
    expect(listWhere(ctx.findMany).OR).toEqual([
      { scope: 'PROVIDER', orgUserId: 'prov-p' },
    ]);
    expect(result.list.map((row) => row.id)).toEqual([4]);
  });

  it('未指定主体时取当前主体，仍只给一个数据域', async () => {
    const ctx = build(seed);
    await ctx.service.list(USER, { group: 'org' });
    expect(listWhere(ctx.findMany).OR).toEqual([
      { scope: 'ORG', orgUserId: 'ent-a' },
    ]);
  });

  it('指定了不属于本人的主体时回落当前主体，不混合也不放行', async () => {
    const ctx = build(seed);
    const result = await ctx.service.list(USER, {
      group: 'org',
      orgUserId: 'outsider',
    });
    expect(listWhere(ctx.findMany).OR).toEqual([
      { scope: 'ORG', orgUserId: 'ent-a' },
    ]);
    expect(result.list.map((row) => row.id)).toEqual([2]);
  });

  it('不带分组时三个分支各自只含一个主体', async () => {
    const ctx = build(seed);
    await ctx.service.list(USER, {});
    expect(listWhere(ctx.findMany).OR).toEqual([
      { ownerUserId: 'u1' },
      { scope: 'ORG', orgUserId: 'ent-a' },
      { scope: 'PROVIDER', orgUserId: 'prov-p' },
    ]);
  });

  it('没有服务商挂靠时用哨兵挡住，不把全部服务商流程放进来', async () => {
    const ctx = build(
      seed,
      CONTEXTS.filter((item) => item.orgType !== 'PROVIDER'),
    );
    const result = await ctx.service.list(USER, { group: 'provider' });
    expect(listWhere(ctx.findMany).OR).toEqual([
      { scope: 'PROVIDER', orgUserId: '__none__' },
    ]);
    expect(result.list).toEqual([]);
  });

  it('回传主体名与按主体分开的计数，键与前端页签一一对应', async () => {
    const ctx = build(seed);
    const result = await ctx.service.list(USER, { group: 'mine' });
    expect(result.orgs).toEqual([
      {
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
        name: '甲公司',
        current: true,
      },
      {
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-b',
        name: '乙公司',
        current: false,
      },
      {
        orgType: 'PROVIDER',
        orgUserId: 'prov-p',
        name: '丙服务商',
        current: false,
      },
    ]);
    expect(result.counts).toEqual({
      mine: 1,
      'org:ent-a': 1,
      'org:ent-b': 1,
      'provider:prov-p': 1,
    });
  });

  it('完全没有公司主体时兜底到个人自组织，清单不空转', async () => {
    const ctx = build(seed, []);
    const result = await ctx.service.list(USER, { group: 'org' });
    expect(result.orgs).toEqual([
      { orgType: 'ENTERPRISE', orgUserId: 'u1', name: '测试员', current: true },
    ]);
    expect(listWhere(ctx.findMany).OR).toEqual([
      { scope: 'ORG', orgUserId: 'u1' },
    ]);
  });
});

describe('共享写入落到指定主体', () => {
  it('新建公司共享时写入用户选中的那一个公司', async () => {
    const ctx = build();
    const row = await ctx.service.create(USER, {
      name: '乙公司对账',
      scope: 'ORG',
      orgUserId: 'ent-b',
    });
    expect(row.orgType).toBe('ENTERPRISE');
    expect(row.orgUserId).toBe('ent-b');
    expect(ctx.workflows[0].orgUserId).toBe('ent-b');
  });

  it('未选主体时沿用当前主体', async () => {
    const ctx = build();
    const row = await ctx.service.create(USER, {
      name: '甲公司对账',
      scope: 'ORG',
    });
    expect(row.orgUserId).toBe('ent-a');
  });

  it('共享到不属于本人的公司直接拒绝', async () => {
    const ctx = build();
    await expect(
      ctx.service.create(USER, {
        name: '越权',
        scope: 'ORG',
        orgUserId: 'outsider',
      }),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
      message: '你不属于该公司主体，不能共享到它',
    });
    expect(ctx.workflows).toHaveLength(0);
  });

  it('把公司主体当服务商共享同样拒绝', async () => {
    const ctx = build();
    await expect(
      ctx.service.create(USER, {
        name: '越权',
        scope: 'PROVIDER',
        orgUserId: 'ent-a',
      }),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
      message: '你不属于该服务商机构，不能共享到它',
    });
  });

  it('没有服务商挂靠时不允许设服务商共享', async () => {
    const ctx = build(
      [],
      CONTEXTS.filter((item) => item.orgType !== 'PROVIDER'),
    );
    await expect(
      ctx.service.create(USER, { name: '无机构', scope: 'PROVIDER' }),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
      message: '你不属于任何服务商机构，不能设为服务商共享',
    });
  });

  it('只传 orgUserId 也能改主体，可见性沿用原值', async () => {
    const ctx = build([workflowRow(1, { scope: 'ORG', orgUserId: 'ent-a' })]);
    const row = await ctx.service.save(USER, '1', { orgUserId: 'ent-b' });
    expect(row.scope).toBe('ORG');
    expect(row.orgUserId).toBe('ent-b');
    expect(ctx.workflows[0].orgUserId).toBe('ent-b');
  });

  it('改回私有时主体只作归属记录，仍取当前主体', async () => {
    const ctx = build([workflowRow(1, { scope: 'ORG', orgUserId: 'ent-b' })]);
    const row = await ctx.service.save(USER, '1', { scope: 'PRIVATE' });
    expect(row.scope).toBe('PRIVATE');
    expect(row.orgUserId).toBe('ent-a');
  });

  it('共享工作流不允许非创建人改主体', async () => {
    const ctx = build([
      workflowRow(1, { ownerUserId: 'u2', scope: 'ORG', orgUserId: 'ent-a' }),
    ]);
    await expect(
      ctx.service.save(USER, '1', { orgUserId: 'ent-b' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.FORBIDDEN });
    expect(ctx.workflows[0].orgUserId).toBe('ent-a');
  });
});

describe('invoke 幂等', () => {
  function published(ctx: ReturnType<typeof build>) {
    ctx.workflows.push(
      workflowRow(9, {
        scope: 'ORG',
        status: 'PUBLISHED',
        businessKey: 'wf.reconcile',
        nodes: [triggerNode('n1', 'trigger.manual')],
      }),
    );
    ctx.published(9);
    return ctx;
  }

  it('按业务标识起流程并回 runId', async () => {
    const ctx = published(build());
    const result = await ctx.service.invoke(USER, {
      businessKey: 'wf.reconcile',
    });
    expect(result).toEqual({ runId: 1, duplicated: false });
    expect(ctx.engineStart).toHaveBeenCalledWith(1, USER);
    expect(ctx.runs[0].trigger).toBe('MANUAL');
  });

  it('dedupeKey 撞键时交回既有 runId，不再启动引擎', async () => {
    const ctx = published(build());
    const first = await ctx.service.invoke(USER, {
      workflowId: 9,
      dedupeKey: 'wf:event:9:77',
    });
    ctx.collideNextRun();
    const second = await ctx.service.invoke(USER, {
      workflowId: 9,
      dedupeKey: 'wf:event:9:77',
    });
    expect(second).toEqual({ runId: first.runId, duplicated: true });
    expect(ctx.engineStart).toHaveBeenCalledTimes(1);
    expect(ctx.runs).toHaveLength(1);
  });

  it('没有 dedupeKey 时撞键不吞错', async () => {
    const ctx = published(build());
    ctx.collideNextRun();
    await expect(
      ctx.service.invoke(USER, { workflowId: 9 }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('触发方式取值不合法直接拒绝', async () => {
    const ctx = published(build());
    await expect(
      ctx.service.invoke(USER, { workflowId: 9, trigger: 'WEBHOOK' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
    expect(ctx.runs).toHaveLength(0);
  });
});

describe('规则动作按账号触发', () => {
  function published(ctx: ReturnType<typeof build>) {
    ctx.workflows.push(
      workflowRow(9, {
        status: 'PUBLISHED',
        businessKey: 'wf.reconcile',
        nodes: [
          triggerNode('n1', 'trigger.event', { event: 'crm.order.paid' }),
        ],
      }),
    );
    ctx.published(9);
    return ctx;
  }

  it('以工作流创建人身份、按 EVENT 触发并透传规则幂等锚', async () => {
    const ctx = published(build());
    const started = await ctx.service.invokeByUser('u1', {
      businessKey: 'wf.reconcile',
      trigger: 'EVENT',
      input: { orderId: 'O-1' },
      sourceType: 'rule',
      sourceId: '9:77',
      dedupeKey: '9:77',
    });
    expect(started).toBe(true);
    expect(ctx.engineStart).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ userId: 'u1' }),
    );
    expect(ctx.runs[0]).toMatchObject({
      trigger: 'EVENT',
      sourceType: 'rule',
      sourceId: '9:77',
      dedupeKey: '9:77',
    });
  });

  it('账号不存在或已停用时抛错，交给规则执行台账记 FAILED', async () => {
    const ctx = published(build());
    await expect(
      ctx.service.invokeByUser('ghost', { businessKey: 'wf.reconcile' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
    expect(ctx.runs).toHaveLength(0);
  });
});

describe('进程内触发扫描', () => {
  function scheduled() {
    const ctx = build();
    ctx.workflows.push(
      workflowRow(11, {
        scope: 'ORG',
        status: 'PUBLISHED',
        nodes: [triggerNode('n1', 'trigger.schedule', { cron: '0 9 * * *' })],
      }),
    );
    ctx.published(11);
    return ctx;
  }

  it('定时触发按「工作流 + 分钟槽」落幂等锚', async () => {
    const ctx = scheduled();
    expect(await ctx.service.runScheduled(NOW)).toBe(1);
    expect(ctx.runs[0]).toMatchObject({
      trigger: 'SCHEDULE',
      sourceType: 'schedule',
      sourceId: '11',
      dedupeKey: 'wf:schedule:11:2026-11-09T01:00:00Z',
    });
  });

  it('同一分钟重复 tick 不再起第二条', async () => {
    const ctx = scheduled();
    expect(await ctx.service.runScheduled(NOW)).toBe(1);
    ctx.collideNextRun();
    expect(await ctx.service.runScheduled(NOW)).toBe(0);
    expect(ctx.runs).toHaveLength(1);
  });

  it('创建人账号被禁用即不触发', async () => {
    const ctx = scheduled();
    ctx.accounts.set(USER.userId, {
      username: '测试员',
      role: 'member',
      enabled: 0,
    });
    expect(await ctx.service.runScheduled(NOW)).toBe(0);
    expect(ctx.runs).toHaveLength(0);
  });

  it('创建人离职（组织在册失效）时定时与事件触发都不起流程', async () => {
    const ctx = scheduled();
    ctx.standing.value = false;
    expect(await ctx.service.runScheduled(NOW)).toBe(0);
    expect(ctx.runs).toHaveLength(0);
    expect(ctx.isStanding).toHaveBeenCalledWith('u1', {
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-a',
    });
  });

  it('发起人取账号目录里的真实用户名与角色', async () => {
    const ctx = scheduled();
    ctx.accounts.set(USER.userId, {
      username: '真实名',
      role: 'admin',
      enabled: 1,
    });
    await ctx.service.runScheduled(NOW);
    expect(ctx.runs[0].actorId).toBe('u1');
    expect(ctx.engineStart).toHaveBeenCalledWith(
      1,
      new CurrentUser('u1', '真实名', 'admin'),
    );
  });

  it('事件台账 id 非法时直接短路，不扫库', async () => {
    const ctx = build();
    expect(
      await ctx.service.runOnEvent({
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
        event: 'order.created',
        payload: {},
        eventLogId: 0,
      }),
    ).toBe(0);
    expect(ctx.findMany).not.toHaveBeenCalled();
  });

  it('领域事件只命中同主体的流程，并按事件台账 id 幂等', async () => {
    const ctx = build();
    ctx.workflows.push(
      workflowRow(12, {
        scope: 'ORG',
        status: 'PUBLISHED',
        orgUserId: 'ent-a',
        nodes: [triggerNode('n1', 'trigger.event', { event: 'order.created' })],
      }),
      workflowRow(13, {
        scope: 'ORG',
        status: 'PUBLISHED',
        orgUserId: 'ent-b',
        nodes: [triggerNode('n1', 'trigger.event', { event: 'order.created' })],
      }),
    );
    ctx.published(12);
    ctx.published(13);
    expect(
      await ctx.service.runOnEvent({
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
        event: 'order.created',
        payload: { orderId: 5 },
        eventLogId: 77,
      }),
    ).toBe(1);
    expect(ctx.runs[0]).toMatchObject({
      trigger: 'EVENT',
      sourceType: 'event',
      sourceId: '77',
      dedupeKey: 'wf:event:12:77',
    });
    expect(listWhere(ctx.findMany)).toMatchObject({
      status: 'PUBLISHED',
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-a',
    });
  });

  it('事件名不匹配的流程不触发', async () => {
    const ctx = build();
    ctx.workflows.push(
      workflowRow(14, {
        scope: 'ORG',
        status: 'PUBLISHED',
        nodes: [triggerNode('n1', 'trigger.event', { event: 'order.closed' })],
      }),
    );
    ctx.published(14);
    expect(
      await ctx.service.runOnEvent({
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
        event: 'order.created',
        payload: {},
        eventLogId: 78,
      }),
    ).toBe(0);
  });

  it('任务事件命中同主体或办理人自己的流程，按任务 + 变化类型幂等', async () => {
    const ctx = build();
    ctx.workflows.push(
      workflowRow(15, {
        scope: 'ORG',
        status: 'PUBLISHED',
        orgUserId: 'ent-a',
        nodes: [triggerNode('n1', 'trigger.task', { event: 'created' })],
      }),
      workflowRow(16, {
        ownerUserId: 'u9',
        scope: 'PRIVATE',
        status: 'PUBLISHED',
        orgUserId: 'ent-z',
        nodes: [triggerNode('n1', 'trigger.task', { event: 'created' })],
      }),
    );
    ctx.published(15);
    ctx.published(16);
    ctx.accounts.set('u9', { username: '办理人', role: 'member', enabled: 1 });
    expect(
      await ctx.service.runOnTaskEvent({
        kind: 'created',
        task: {
          id: 31,
          source: 'supplyOrder',
          assigneeUserId: 'u9',
          orgType: 'ENTERPRISE',
          orgUserId: 'ent-a',
          title: '待派单',
          status: 'TODO',
          link: '/supply',
        },
      }),
    ).toBe(2);
    expect(ctx.runs.map((run) => run.dedupeKey)).toEqual([
      'wf:task:15:31:created',
      'wf:task:16:31:created',
    ]);
    expect(ctx.runs.every((run) => run.sourceType === 'myTask')).toBe(true);
  });

  it('任务事件限定了单据来源时，别的来源不触发', async () => {
    const ctx = build();
    ctx.workflows.push(
      workflowRow(17, {
        scope: 'ORG',
        status: 'PUBLISHED',
        nodes: [
          triggerNode('n1', 'trigger.task', {
            event: 'created',
            source: 'legalRequest',
          }),
        ],
      }),
    );
    ctx.published(17);
    expect(
      await ctx.service.runOnTaskEvent({
        kind: 'created',
        task: {
          id: 32,
          source: 'supplyOrder',
          assigneeUserId: USER.userId,
          orgType: 'ENTERPRISE',
          orgUserId: 'ent-a',
          title: '待派单',
          status: 'TODO',
          link: '/supply',
        },
      }),
    ).toBe(0);
  });
});

/** 运行记录与取消：可见范围与工作流一致，取消只作废等待步骤、终态幂等。 */
describe('运行记录与取消', () => {
  const seed = [
    workflowRow(1),
    workflowRow(2, { ownerUserId: 'u2', scope: 'ORG', orgUserId: 'ent-a' }),
    // 既有 ent-a/ent-b，后者属外部主体：它名下的运行不该出现在当前账号的清单里。
    workflowRow(3, { ownerUserId: 'u3', scope: 'ORG', orgUserId: 'ent-z' }),
  ];

  function addRun(
    ctx: ReturnType<typeof build>,
    over: Partial<RunRow> & { id: number },
  ): RunRow {
    const run: RunRow = {
      workflowId: 1,
      version: 1,
      trigger: 'MANUAL',
      status: 'DONE',
      input: {},
      actorId: USER.userId,
      sourceType: '',
      sourceId: '',
      dedupeKey: null,
      output: {},
      error: '',
      startedAt: NOW,
      finishedAt: NOW,
      // 递增时间戳，保证排序断言稳定。
      createdAt: new Date(NOW.getTime() + over.id * 1000),
      ...over,
    };
    ctx.runs.push(run);
    return run;
  }

  function addStep(
    ctx: ReturnType<typeof build>,
    id: number,
    runId: number,
    status: string,
  ): StepRow {
    const step: StepRow = {
      id,
      runId,
      nodeId: `n${id}`,
      nodeType: 'action',
      status,
      input: {},
      output: {},
      error: '',
      attempts: 1,
      durationMs: 0,
      startedAt: NOW,
      finishedAt: NOW,
    };
    ctx.steps.push(step);
    return step;
  }

  it('只列可见工作流的运行，跨主体运行不出现', async () => {
    const ctx = build(seed);
    addRun(ctx, { id: 1, workflowId: 1 });
    addRun(ctx, { id: 2, workflowId: 2 });
    addRun(ctx, { id: 3, workflowId: 3 });
    const result = await ctx.service.runList(USER, {});
    expect(result.total).toBe(2);
    expect(result.list.map((row) => row.id)).toEqual([2, 1]);
    expect(result.list.map((row) => row.workflowName)).toEqual([
      '流程 2',
      '流程 1',
    ]);
  });

  it('状态与业务关联按条件过滤', async () => {
    const ctx = build(seed);
    addRun(ctx, { id: 1, workflowId: 1, status: 'FAILED' });
    addRun(ctx, {
      id: 2,
      workflowId: 1,
      status: 'DONE',
      sourceType: 'crm',
      sourceId: '77',
    });
    const failed = await ctx.service.runList(USER, { status: 'FAILED' });
    expect(failed.list.map((row) => row.id)).toEqual([1]);
    const bound = await ctx.service.runList(USER, {
      sourceType: 'crm',
      sourceId: '77',
    });
    expect(bound.list.map((row) => row.id)).toEqual([2]);
  });

  it('按工作流编号过滤时先校验可见性', async () => {
    const ctx = build(seed);
    await expect(
      ctx.service.runList(USER, { workflowId: 3 }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.FORBIDDEN });
  });

  it('管理员看到全部运行，不受可见工作流限制', async () => {
    const ctx = build(seed);
    const admin = new CurrentUser('root', '管理员', 'admin');
    addRun(ctx, { id: 3, workflowId: 3, actorId: 'u3' });
    const result = await ctx.service.runList(admin, {});
    expect(result.list.map((row) => row.id)).toEqual([3]);
  });

  it('取消等待中的运行：作废等待步骤并把运行置 CANCELED', async () => {
    const ctx = build(seed);
    addRun(ctx, { id: 5, workflowId: 1, status: 'WAITING' });
    addStep(ctx, 51, 5, 'WAITING');
    addStep(ctx, 52, 5, 'DONE');
    const row = await ctx.service.cancelRun(USER, '5');
    expect(row.status).toBe('CANCELED');
    expect(ctx.steps.find((step) => step.id === 51)?.status).toBe('CANCELED');
    expect(ctx.steps.find((step) => step.id === 52)?.status).toBe('DONE');
    expect(ctx.engineAnnounce).toHaveBeenCalledWith(5, 'CANCELED');
  });

  it('终态运行取消是幂等的，不再改状态也不再广播', async () => {
    const ctx = build(seed);
    addRun(ctx, { id: 6, workflowId: 1, status: 'DONE' });
    const row = await ctx.service.cancelRun(USER, '6');
    expect(row.status).toBe('DONE');
    expect(ctx.engineAnnounce).not.toHaveBeenCalled();
  });

  it('非发起人、非创建人、非管理员不能取消', async () => {
    const ctx = build(seed);
    // 流程 2 归 u2 所有，运行发起人也是 u2；u1 既非发起人也非创建人。
    addRun(ctx, { id: 7, workflowId: 2, status: 'RUNNING', actorId: 'u2' });
    await expect(ctx.service.cancelRun(USER, '7')).rejects.toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
    });
  });
});
