import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { HrmOrg, HrmScopeService } from '../hrm/hrm.scope';
import { HrmProfileService } from '../hrm/hrm-profile.service';
import { OnboardingService } from './onboarding.service';
import type { GapScopeService } from './gaps.scope';

/**
 * 人员闭环（docs §5.3）：
 * 1) 离职即撤权：OrgStaff 置 REMOVED 并清空角色/岗位，同时按 OFFBOARD 模板开工交接清单；
 * 2) 入职清单全部完成 → 按流程登记的岗位开通职能权限（OFFBOARD 流程不授权）。
 */

const USER = new CurrentUser('hr-1', 'hr', 'user');

function orgOf(overrides: Partial<HrmOrg> = {}): HrmOrg {
  return {
    orgType: 'ENTERPRISE',
    orgUserId: 'ent-1',
    actorId: 'hr-1',
    isOwner: false,
    isAdmin: true,
    roles: ['HR'],
    positions: [],
    department: '',
    ...overrides,
  };
}

const profileRow = {
  id: 1,
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-1',
  memberUserId: 'u-2',
  employeeNo: 'E001',
  employmentType: 'FULL_TIME',
  hourlyRate: 0,
  supervisorUserId: '',
  department: '销售',
  skills: [],
  status: 'ACTIVE',
  joinedAt: '2026-01-01',
  leftAt: '',
  note: '',
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function profileServiceStub(offboardTemplate: unknown) {
  const prisma = {
    hrmEmployeeProfile: {
      findUnique: jest.fn(async () => profileRow),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...profileRow,
        ...data,
      })),
    },
    orgStaff: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    onboardingRun: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 88,
        ...data,
      })),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 88,
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-1',
        templateId: 5,
        staffUserId: 'u-2',
        memberUserId: 'u-2',
        offerId: 0,
        positionName: '',
        status: 'ACTIVE',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: null,
        createdBy: 'hr-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        tasks: [],
      })),
    },
    onboardingTemplate: {
      findFirst: jest.fn(async () => offboardTemplate),
      findUnique: jest.fn(async () => ({ name: '离职交接模板' })),
    },
    onboardingTask: {
      create: jest.fn(async () => ({ id: 1 })),
    },
    $transaction: jest.fn(),
  };
  // 事务回调拿同一份内存替身：先建对象再回填，避免初始化器里的自引用推断
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  const scope = {
    resolve: jest.fn(async () => orgOf()),
    requireStaff: jest.fn(async (_org: HrmOrg, id: string) => id),
    requireAdmin: jest.fn(),
    requireAdminFor: jest.fn(),
  };
  const service = new HrmProfileService(
    stub<PrismaService>(prisma),
    stub<HrmScopeService>(scope),
  );
  return { service, prisma };
}

describe('离职撤权与交接', () => {
  it('离职时清空角色与岗位并把成员置为移除', async () => {
    const ctx = profileServiceStub(null);
    await ctx.service.updateStatus(
      { memberUserId: 'u-2', status: 'LEFT', leftAt: '2026-02-01' },
      USER,
    );
    expect(ctx.prisma.orgStaff.updateMany).toHaveBeenCalledWith({
      where: {
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-1',
        memberUserId: 'u-2',
      },
      data: { status: 'REMOVED', roles: [], positions: [] },
    });
  });

  it('存在离职交接模板时自动开工交接流程', async () => {
    const template = {
      id: 5,
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-1',
      name: '离职交接',
      kind: 'OFFBOARD',
      active: true,
      items: [
        {
          id: 1,
          title: '归还资产',
          description: '',
          ownerRole: 'IT',
          dueDays: 1,
          sort: 0,
        },
      ],
    };
    const ctx = profileServiceStub(template);
    await ctx.service.updateStatus(
      { memberUserId: 'u-2', status: 'LEFT', leftAt: '2026-02-01' },
      USER,
    );
    expect(ctx.prisma.onboardingRun.create).toHaveBeenCalled();
    expect(ctx.prisma.onboardingTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: '归还资产', ownerRole: 'IT' }),
    });
  });

  it('没有离职交接模板时不阻断离职', async () => {
    const ctx = profileServiceStub(null);
    await expect(
      ctx.service.updateStatus(
        { memberUserId: 'u-2', status: 'LEFT', leftAt: '2026-02-01' },
        USER,
      ),
    ).resolves.toMatchObject({ status: 'LEFT' });
  });
});

function onboardingServiceStub(kind: string) {
  const run = {
    id: 7,
    orgType: 'ENTERPRISE',
    orgUserId: 'ent-1',
    templateId: 3,
    staffUserId: 'u-2',
    memberUserId: 'u-2',
    offerId: 9,
    positionName: '销售专员',
    status: 'ACTIVE',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
    createdBy: 'hr-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const task = {
    id: 11,
    title: '熟悉业务流程',
    description: '',
    ownerRole: 'STAFF',
    assigneeUserId: 'u-2',
    dueAt: null,
    status: 'TODO',
    doneAt: null,
    note: '',
    sort: 0,
    run,
  };
  const prisma = {
    onboardingTask: {
      findUnique: jest.fn(async () => task),
      update: jest.fn(async () => ({ ...task, status: 'DONE' })),
      count: jest.fn(async () => 0),
    },
    onboardingRun: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...run,
        ...data,
      })),
      findUniqueOrThrow: jest.fn(async () => ({
        ...run,
        status: 'DONE',
        completedAt: new Date('2026-01-02T00:00:00Z'),
        tasks: [{ ...task, status: 'DONE' }],
      })),
    },
    onboardingTemplate: {
      findUnique: jest.fn(async () => ({ kind })),
      findFirst: jest.fn(async () => null),
    },
    orgPosition: {
      findFirst: jest.fn(async () => ({
        id: 21,
        name: '销售专员',
        description: '负责销售',
      })),
    },
    orgStaff: {
      findFirst: jest.fn(async () => ({
        id: 31,
        positions: [{ name: 'STAFF', description: '' }],
      })),
      update: jest.fn(async () => ({ id: 31 })),
    },
  };
  const scope = {
    resolve: jest.fn(async () => orgOf({ actorId: 'hr-1' })),
    requireAdmin: jest.fn(async () => orgOf({ actorId: 'hr-1' })),
    requireAdminFor: jest.fn(),
  };
  const service = new OnboardingService(
    stub<PrismaService>(prisma),
    stub<GapScopeService>(scope),
  );
  return { service, prisma };
}

describe('入职完成开通岗位权限', () => {
  it('清单全部完成后把登记的岗位追加到成员岗位清单', async () => {
    const ctx = onboardingServiceStub('HIRE');
    await ctx.service.completeTask(USER, '11', { status: 'DONE' });
    expect(ctx.prisma.orgStaff.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: {
        positions: [
          { name: 'STAFF', description: '' },
          { name: '销售专员', description: '负责销售' },
        ],
      },
    });
  });

  it('离职交接流程完成时不授予岗位', async () => {
    const ctx = onboardingServiceStub('OFFBOARD');
    await ctx.service.completeTask(USER, '11', { status: 'DONE' });
    expect(ctx.prisma.orgStaff.update).not.toHaveBeenCalled();
  });
});
