import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { stub } from '../../test/doubles';
import type { IdentityService } from '../identity/identity.service';
import type { NotificationService } from '../notifications/notification.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TaskCenterService } from './task-center.service';
import { TaskDocumentRegistry } from './task-document.binding';
import { TaskRouterService } from './task-router.service';

const provider = new CurrentUser('p1', 'provider', 'user');
const staff = new CurrentUser('s1', 'staff', 'user');
const outsider = new CurrentUser('x1', 'outsider', 'user');

function taskRow(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    dedupKey: 'supply:so-1:org:p1',
    source: 'supply',
    sourceId: 'so-1',
    title: '订货单 SO-1',
    description: '',
    link: '/supply?tab=orders',
    category: 'task',
    priority: 'NORMAL',
    status: 'OPEN',
    orgType: 'PROVIDER',
    orgUserId: 'p1',
    assigneeType: 'ORG',
    assigneeUserId: '',
    assignedBy: 'system',
    assignedAt: new Date('2026-11-01T00:00:00.000Z'),
    assignPolicy: 'ORG_QUEUE',
    acceptedAt: null,
    createdBy: 'e1',
    dueAt: null,
    closedAt: null,
    closedBy: '',
    closeNote: '',
    sourceStatus: '',
    sourceStatusLabel: '',
    lastSyncedAt: new Date('2026-11-01T00:00:00.000Z'),
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...over,
  };
}

function rule(over: Record<string, unknown> = {}) {
  return {
    id: 3,
    orgType: 'PROVIDER',
    orgUserId: 'p1',
    source: 'supply',
    category: 'task',
    region: '',
    strategy: 'DIRECT',
    targets: ['s1'],
    priority: 0,
    enabled: true,
    ...over,
  };
}

function setup(
  options: {
    rules?: Record<string, unknown>[];
    activeStaff?: string[];
    bindStatus?: string | null;
    docsOk?: boolean;
    total?: number;
  } = {},
) {
  const order: string[] = [];
  const existing = taskRow();
  const tx = {
    myTask: {
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        order.push('task');
        return { ...existing, ...args.data };
      }),
    },
    taskAssignmentLog: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        order.push('log');
        return { id: 1, createdAt: new Date(), ...args.data };
      }),
    },
  };
  const setStaff = jest.fn(async () => {
    order.push('document');
    return options.docsOk ?? true;
  });
  const documents = new TaskDocumentRegistry().register({
    source: 'supply',
    idOf: (sourceId) => (sourceId === 'so-1' ? 11 : null),
    setStaff,
  });
  const groupBy = jest.fn().mockResolvedValue([]);
  const prisma = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    myTask: {
      findUnique: jest.fn().mockResolvedValue(existing),
      findFirst: jest.fn().mockResolvedValue(existing),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        ...existing,
        ...args.data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(options.total ?? 0),
      groupBy,
    },
    taskAssignmentRule: {
      findMany: jest.fn().mockResolvedValue(options.rules ?? []),
    },
    providerStaff: {
      findMany: jest.fn().mockResolvedValue(
        (options.activeStaff ?? ['s1']).map((staffUserId) => ({
          staffUserId,
        })),
      ),
      findUnique: jest.fn().mockImplementation(async () => {
        if (options.bindStatus === null) return null;
        return { status: options.bindStatus ?? 'ACTIVE' };
      }),
    },
    taskAssignmentLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const assign = jest.fn(async (draft: unknown) => draft);
  const tasks = {
    assign,
    toRow: jest.fn((row: { id: number; assigneeUserId: string }) => ({
      id: row.id,
      assigneeUserId: row.assigneeUserId,
    })),
  };
  const notify = jest.fn().mockResolvedValue(undefined);
  const requireRoles = jest.fn().mockResolvedValue(undefined);
  const router = new TaskRouterService(
    stub<PrismaService>(prisma),
    stub<TaskCenterService>(tasks),
    documents,
    stub<IdentityService>({ requireRoles }),
    stub<NotificationService>({ notify }),
  );
  return {
    router,
    prisma,
    order,
    setStaff,
    assign,
    notify,
    requireRoles,
    groupBy,
    existing,
  };
}

async function rejectsWith(promise: Promise<unknown>, code: { code: number }) {
  await expect(promise).rejects.toBeInstanceOf(BusinessException);
  await expect(promise).rejects.toHaveProperty('errorCode.code', code.code);
}

describe('task router resolve', () => {
  it('keeps the task in the org queue when no rule matches', async () => {
    const { router, prisma } = setup({ rules: [] });

    const resolved = await router.resolve({
      orgUserId: 'p1',
      source: 'supply',
      category: 'task',
    });

    expect(resolved).toEqual({
      assigneeType: 'ORG',
      assigneeUserId: '',
      strategy: 'ORG_QUEUE',
      ruleId: null,
    });
    expect(prisma.taskAssignmentRule.findMany).toHaveBeenCalledTimes(1);
  });

  it('picks the only target of a DIRECT rule', async () => {
    const { router } = setup({
      rules: [rule({ strategy: 'DIRECT', targets: ['s1'] })],
      activeStaff: ['s1', 's2'],
    });

    const resolved = await router.resolve({
      orgUserId: 'p1',
      source: 'supply',
      category: 'task',
    });

    expect(resolved.assigneeType).toBe('USER');
    expect(resolved.assigneeUserId).toBe('s1');
    expect(resolved.strategy).toBe('DIRECT');
    expect(resolved.ruleId).toBe(3);
  });

  it('ignores rules from another region or disabled target staff', async () => {
    const region = setup({
      rules: [rule({ region: 'CN' })],
      activeStaff: ['s1'],
    });
    const regionResolved = await region.router.resolve({
      orgUserId: 'p1',
      source: 'supply',
      category: 'task',
      region: 'US',
    });
    expect(regionResolved.strategy).toBe('ORG_QUEUE');

    const gone = setup({
      rules: [rule({ targets: ['gone'] })],
      activeStaff: ['s1'],
    });
    const goneResolved = await gone.router.resolve({
      orgUserId: 'p1',
      source: 'supply',
      category: 'task',
    });
    expect(goneResolved.strategy).toBe('ORG_QUEUE');
  });

  it('round-robins to the staff who was assigned longest ago', async () => {
    const { router, groupBy } = setup({
      rules: [rule({ strategy: 'ROUND_ROBIN', targets: [] })],
      activeStaff: ['s1', 's2'],
    });
    groupBy.mockImplementation(async (args: { _max?: unknown }) =>
      args._max
        ? [
            {
              assigneeUserId: 's1',
              _max: { assignedAt: new Date('2026-11-09T00:00:00.000Z') },
            },
            {
              assigneeUserId: 's2',
              _max: { assignedAt: new Date('2026-11-02T00:00:00.000Z') },
            },
          ]
        : [],
    );

    const resolved = await router.resolve({
      orgUserId: 'p1',
      source: 'supply',
      category: 'task',
    });

    expect(resolved.assigneeUserId).toBe('s2');
    expect(resolved.strategy).toBe('ROUND_ROBIN');
  });

  it('load-balances to the staff with the fewest open tasks', async () => {
    const { router, groupBy } = setup({
      rules: [rule({ strategy: 'LOAD', targets: [] })],
      activeStaff: ['s1', 's2'],
    });
    groupBy.mockImplementation(async (args: { _count?: unknown }) =>
      args._count
        ? [
            { assigneeUserId: 's1', _count: { _all: 4 } },
            { assigneeUserId: 's2', _count: { _all: 1 } },
          ]
        : [],
    );

    const resolved = await router.resolve({
      orgUserId: 'p1',
      source: 'supply',
      category: 'task',
    });

    expect(resolved.assigneeUserId).toBe('s2');
    expect(resolved.strategy).toBe('LOAD');
  });

  it('skips rule lookup for non-provider organizations', async () => {
    const { router, prisma } = setup({ rules: [rule()] });

    const resolved = await router.resolve({
      orgType: 'ENTERPRISE',
      orgUserId: 'e1',
      source: 'supply',
      category: 'task',
    });

    expect(resolved.strategy).toBe('ORG_QUEUE');
    expect(prisma.taskAssignmentRule.findMany).not.toHaveBeenCalled();
  });
});

describe('task router dispatch', () => {
  it('uses the rule winner when a rule matches', async () => {
    const { router, assign } = setup({
      rules: [rule({ strategy: 'DIRECT', targets: ['s2'] })],
      activeStaff: ['s1', 's2'],
    });

    await router.dispatch({
      source: 'supply',
      sourceId: 'so-1',
      orgUserId: 'p1',
      title: '订货单 SO-1',
      link: '/supply?tab=orders',
      createdBy: 'e1',
      staffUserId: 's1',
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeType: 'USER',
        assigneeUserId: 's2',
        assignPolicy: 'DIRECT',
        orgUserId: 'p1',
      }),
    );
  });

  it('falls back to the board default staff, then to the org queue', async () => {
    const withDefault = setup({ rules: [] });
    await withDefault.router.dispatch({
      source: 'supply',
      sourceId: 'so-1',
      orgUserId: 'p1',
      title: '订货单 SO-1',
      link: '/supply?tab=orders',
      createdBy: 'e1',
      staffUserId: 's1',
    });
    expect(withDefault.assign).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeType: 'USER', assigneeUserId: 's1' }),
    );

    const queue = setup({ rules: [] });
    await queue.router.dispatch({
      source: 'supply',
      sourceId: 'so-1',
      orgUserId: 'p1',
      title: '订货单 SO-1',
      link: '/supply?tab=orders',
      createdBy: 'e1',
    });
    expect(queue.assign).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeType: 'ORG',
        assigneeUserId: '',
        assignPolicy: 'ORG_QUEUE',
      }),
    );
  });
});

describe('task router reassign', () => {
  it('writes task, business document and log in that order', async () => {
    const { router, order, prisma } = setup();

    const row = await router.reassign(provider, '7', {
      toUserId: 's1',
      note: '交给小张',
    });

    expect(order).toEqual(['task', 'document', 'log']);
    expect(row).toEqual({ id: 7, assigneeUserId: 's1' });
    const log = prisma.$transaction.mock.calls.length;
    expect(log).toBe(1);
  });

  it('rolls back and keeps no log when the document cannot be updated', async () => {
    const { router, order } = setup({ docsOk: false });

    await rejectsWith(
      router.reassign(provider, '7', { toUserId: 's1' }),
      ErrorCode.NOT_FOUND,
    );
    expect(order).toEqual(['task', 'document']);
  });

  it('rejects managers of another organization', async () => {
    const { router, order } = setup();

    await rejectsWith(
      router.reassign(outsider, '7', { toUserId: 's1' }),
      ErrorCode.FORBIDDEN,
    );
    expect(order).toEqual([]);
  });

  it('rejects staff who are not bound to the organization', async () => {
    const { router, order } = setup({ bindStatus: null });

    await rejectsWith(
      router.reassign(provider, '7', { toUserId: 's1' }),
      ErrorCode.BAD_REQUEST,
    );
    expect(order).toEqual([]);
  });

  it('puts the task back into the org queue when no target is given', async () => {
    const { router, prisma } = setup();

    await router.reassign(provider, '7', {});

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const tx = prisma.$transaction.mock.calls[0][0];
    expect(tx).toBeInstanceOf(Function);
    expect(prisma.myTask.findUnique).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});

describe('task router claim', () => {
  it('lets an active staff member claim an org-queue task', async () => {
    const { router, prisma } = setup();

    const row = await router.claim(staff, '7');

    expect(row).toEqual({ id: 7, assigneeUserId: 's1' });
    expect(prisma.providerStaff.findUnique).toHaveBeenCalledTimes(1);
  });

  it('refuses tasks that already have an assignee', async () => {
    const { router, prisma } = setup();
    prisma.myTask.findUnique.mockResolvedValue(
      taskRow({ assigneeType: 'USER', assigneeUserId: 's2' }),
    );

    await rejectsWith(router.claim(staff, '7'), ErrorCode.CONFLICT);
  });

  it('refuses outsiders who are not staff of the organization', async () => {
    const { router } = setup({ bindStatus: null });

    await rejectsWith(router.claim(outsider, '7'), ErrorCode.BAD_REQUEST);
  });
});

describe('task router board assignment', () => {
  it('moves the business document together with the task', async () => {
    const { router, order } = setup();

    const staffUserId = await router.assignDocument({
      source: 'supply',
      sourceId: 'so-1',
      orgUserId: 'p1',
      staffUserId: 's1',
      actorId: 'p1',
      note: '指派承办',
    });

    expect(staffUserId).toBe('s1');
    expect(order).toEqual(['task', 'document', 'log']);
  });

  it('only touches the business document when the task row is missing', async () => {
    const { router, order, prisma } = setup();
    prisma.myTask.findFirst.mockResolvedValue(null);

    await router.assignDocument({
      source: 'supply',
      sourceId: 'so-1',
      orgUserId: 'p1',
      staffUserId: 's1',
      actorId: 'p1',
    });

    expect(order).toEqual(['document']);
  });

  it('refuses sources that have no document binding', async () => {
    const { router, prisma } = setup();

    await rejectsWith(
      router.assignDocument({
        source: 'unknown-board',
        sourceId: 'so-1',
        orgUserId: 'p1',
        staffUserId: 's1',
        actorId: 'p1',
      }),
      ErrorCode.BAD_REQUEST,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('task router unassigned sweep', () => {
  it('auto-assigns org-queue tasks older than one day', async () => {
    const { router, prisma, order } = setup({
      rules: [rule({ strategy: 'DIRECT', targets: ['s1'] })],
    });
    prisma.myTask.findMany.mockResolvedValue([existingRow()]);

    const assigned = await router.sweepUnassigned(
      new Date('2026-11-10T00:00:00.000Z'),
    );

    expect(assigned).toBe(1);
    expect(order).toEqual(['task', 'document', 'log']);
    expect(prisma.myTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedAt: expect.any(Object) }),
      }),
    );
  });

  it('notifies the owner when no staff is available', async () => {
    const { router, prisma, notify } = setup({ rules: [] });
    prisma.myTask.findMany.mockResolvedValue([existingRow()]);

    const assigned = await router.sweepUnassigned(
      new Date('2026-11-10T00:00:00.000Z'),
    );

    expect(assigned).toBe(0);
    expect(prisma.myTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
    expect(notify).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ link: '/tasks?view=org' }),
    );
  });
});

describe('task router org inbox', () => {
  it('returns the page plus pending and overdue counts', async () => {
    const { router, prisma, requireRoles } = setup({ total: 4 });
    prisma.myTask.findMany.mockResolvedValue([
      taskRow({ id: 7 }),
      taskRow({ id: 8 }),
    ]);

    const inbox = await router.orgInbox(provider, { page: 1, pageSize: 20 });

    expect(requireRoles).toHaveBeenCalledWith(provider, 'SERVICE_PROVIDER');
    expect(inbox.pending).toBe(4);
    expect(inbox.list).toHaveLength(2);
    expect(inbox.total).toBe(4);
  });
});

function existingRow(over: Record<string, unknown> = {}) {
  return taskRow({
    assignedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  });
}
