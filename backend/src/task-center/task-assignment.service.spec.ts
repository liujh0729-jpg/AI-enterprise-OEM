import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { stub } from '../../test/doubles';
import type { IdentityService } from '../identity/identity.service';
import type { PrismaService } from '../prisma/prisma.service';
import { TaskAssignmentService } from './task-assignment.service';

const provider = new CurrentUser('p1', 'provider', 'user');
const admin = new CurrentUser('a1', 'admin', 'admin');

function ruleRow(over: Record<string, unknown> = {}) {
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
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    ...over,
  };
}

function setup(
  options: {
    rules?: Record<string, unknown>[];
    activeStaff?: string[];
    total?: number;
  } = {},
) {
  const rows = options.rules ?? [ruleRow()];
  const prisma = {
    taskAssignmentRule: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(options.total ?? rows.length),
      findUnique: jest.fn().mockResolvedValue(rows[0] ?? null),
      create: jest
        .fn()
        .mockImplementation(async (args: { data: Record<string, unknown> }) =>
          ruleRow({ id: 9, ...args.data }),
        ),
      update: jest
        .fn()
        .mockImplementation(
          async (args: {
            where: { id: number };
            data: Record<string, unknown>;
          }) => ruleRow({ id: args.where.id, ...args.data }),
        ),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    providerStaff: {
      findMany: jest.fn().mockResolvedValue(
        (options.activeStaff ?? ['s1']).map((staffUserId) => ({
          staffUserId,
        })),
      ),
    },
    providerApplication: {
      findFirst: jest.fn().mockResolvedValue({ orgName: '杭州供销' }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ userId: 'p1', orgName: '杭州供销' }]),
    },
  };
  const requireRoles = jest.fn().mockResolvedValue(undefined);
  const service = new TaskAssignmentService(
    stub<PrismaService>(prisma),
    stub<IdentityService>({ requireRoles }),
  );
  return { service, prisma, requireRoles };
}

const createInput = {
  orgType: 'PROVIDER' as const,
  source: 'supply',
  category: 'task',
  region: '',
  strategy: 'DIRECT' as const,
  targets: ['s1'],
  priority: 0,
  enabled: true,
};

async function rejectsWith(promise: Promise<unknown>, code: { code: number }) {
  await expect(promise).rejects.toBeInstanceOf(BusinessException);
  await expect(promise).rejects.toHaveProperty('errorCode.code', code.code);
}

describe('task assignment rules create', () => {
  it('creates a rule owned by the provider and resolves the org name', async () => {
    const { service, prisma } = setup({ activeStaff: ['s1'] });

    const row = await service.create(provider, createInput);

    expect(row.id).toBe(9);
    expect(row.orgUserId).toBe('p1');
    expect(row.orgName).toBe('杭州供销');
    expect(row.strategyLabel).toBe('指定承办人');
    expect(prisma.taskAssignmentRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgType: 'PROVIDER',
        orgUserId: 'p1',
        source: 'supply',
        targets: ['s1'],
      }),
    });
  });

  it('requires exactly one target for DIRECT rules', async () => {
    const { service, prisma } = setup();

    await rejectsWith(
      service.create(provider, { ...createInput, targets: ['s1', 's2'] }),
      ErrorCode.BAD_REQUEST,
    );
    expect(prisma.taskAssignmentRule.create).not.toHaveBeenCalled();
  });

  it('rejects targets that are not active staff of the organization', async () => {
    const { service } = setup({ activeStaff: ['s2'] });

    await rejectsWith(
      service.create(provider, createInput),
      ErrorCode.BAD_REQUEST,
    );
  });

  it('rejects rules filed for another organization and unknown categories', async () => {
    const { service } = setup();

    await rejectsWith(
      service.create(new CurrentUser('p2', 'other', 'user'), {
        ...createInput,
        orgUserId: 'p1',
      }),
      ErrorCode.FORBIDDEN,
    );
    await rejectsWith(
      service.create(provider, { ...createInput, category: 'nope' }),
      ErrorCode.BAD_REQUEST,
    );
  });
});

describe('task assignment rules maintenance', () => {
  it('lists rules with the org name', async () => {
    const { service } = setup();

    const list = await service.list(provider, {});

    expect(list).toHaveLength(1);
    expect(list[0].orgName).toBe('杭州供销');
  });

  it('updates only the provided fields and re-validates targets', async () => {
    const { service, prisma } = setup({ activeStaff: ['s1'] });

    const row = await service.update(provider, '3', {
      strategy: 'ROUND_ROBIN',
      targets: ['s1'],
      priority: 5,
    });

    expect(row.priority).toBe(5);
    expect(prisma.taskAssignmentRule.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({
        source: 'supply',
        strategy: 'ROUND_ROBIN',
        priority: 5,
      }),
    });
  });

  it('refuses updates from another organization', async () => {
    const { service, prisma } = setup();

    await rejectsWith(
      service.update(new CurrentUser('p2', 'other', 'user'), '3', {}),
      ErrorCode.FORBIDDEN,
    );
    expect(prisma.taskAssignmentRule.update).not.toHaveBeenCalled();
  });

  it('removes a rule owned by the provider', async () => {
    const { service, prisma } = setup();

    const result = await service.remove(provider, '3');

    expect(result).toEqual({ id: 3 });
    expect(prisma.taskAssignmentRule.delete).toHaveBeenCalledWith({
      where: { id: 3 },
    });
  });

  it('reports missing rules as not found', async () => {
    const { service, prisma } = setup();
    prisma.taskAssignmentRule.findUnique.mockResolvedValue(null);

    await rejectsWith(service.remove(provider, '404'), ErrorCode.NOT_FOUND);
  });
});

describe('task assignment rule audit', () => {
  it('is read-only and restricted to platform admins', async () => {
    const { service } = setup();

    await rejectsWith(service.audit(provider, {}), ErrorCode.FORBIDDEN);
  });

  it('pages every organization rule and resolves org names in batch', async () => {
    const { service, prisma } = setup({ total: 2 });

    const page = await service.audit(admin, { page: 1, pageSize: 20 });

    expect(page.total).toBe(2);
    expect(page.list[0].orgName).toBe('杭州供销');
    expect(prisma.providerApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { in: ['p1'] } } }),
    );
  });
});
