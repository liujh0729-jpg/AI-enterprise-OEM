import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { HrmProfileService } from './hrm-profile.service';
import { HrmOrg, HrmScopeService } from './hrm.scope';

const user = new CurrentUser('user-9', 'cashier', 'user');

type ViewRow = Parameters<HrmProfileService['view']>[0];
type PrismaUpsertArgs = {
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function orgOf(overrides: Partial<HrmOrg> = {}): HrmOrg {
  return {
    orgType: 'ENTERPRISE',
    orgUserId: 'ent-1',
    actorId: 'user-9',
    isOwner: false,
    isAdmin: false,
    roles: [],
    positions: [],
    department: '',
    ...overrides,
  };
}

function profileRow(
  overrides: Partial<{
    id: number;
    memberUserId: string;
    employeeNo: string;
    employmentType: string;
    hourlyRate: string;
    supervisorUserId: string;
    department: string;
    skills: string[];
    status: string;
    joinedAt: string;
    leftAt: string;
    note: string;
  }> = {},
): ViewRow {
  return stub<ViewRow>({
    id: 1,
    memberUserId: 'user-9',
    employeeNo: 'E-001',
    employmentType: 'FULL_TIME',
    hourlyRate: '88.00',
    supervisorUserId: 'boss-1',
    department: 'sales',
    skills: ['谈判'],
    status: 'ACTIVE',
    joinedAt: '2024-01-01',
    leftAt: '',
    note: '内部备注',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

function build(prisma: PrismaService, scope: HrmScopeService) {
  return new HrmProfileService(prisma, scope);
}

function scopeStub(
  org: HrmOrg,
  requireStaff: jest.Mock = jest.fn(async (_o: HrmOrg, id: string) => id),
): HrmScopeService {
  return stub<HrmScopeService>({
    resolve: jest.fn(async () => org),
    requireAdmin: jest.fn(),
    requireStaff,
  });
}

describe('HrmProfileService：薪酬/备注敏感字段按角色分离', () => {
  it('普通成员看他人档案拿不到时薪与备注', () => {
    const service = build(stub<PrismaService>({}), scopeStub(orgOf()));
    const view = service.view(profileRow({ memberUserId: 'other-2' }), orgOf());
    expect(view.hourlyRate).toBe('');
    expect(view.note).toBe('');
    expect(view.employeeNo).toBe('E-001');
    expect(view.department).toBe('sales');
  });

  it('普通成员看本人档案保留时薪与备注', () => {
    const service = build(stub<PrismaService>({}), scopeStub(orgOf()));
    const view = service.view(profileRow(), orgOf());
    expect(view.hourlyRate).toBe('88.00');
    expect(view.note).toBe('内部备注');
  });

  it('HR 管理员看他人档案可见时薪与备注', () => {
    const org = orgOf({ isAdmin: true });
    const service = build(stub<PrismaService>({}), scopeStub(org));
    const view = service.view(profileRow({ memberUserId: 'other-2' }), org);
    expect(view.hourlyRate).toBe('88.00');
    expect(view.note).toBe('内部备注');
  });

  it('列表按同一口径对他人行脱敏', async () => {
    const prisma = stub<PrismaService>({
      hrmEmployeeProfile: {
        count: jest.fn(async () => 2),
        findMany: jest.fn(async () => [
          profileRow({ id: 1, memberUserId: 'user-9' }),
          profileRow({ id: 2, memberUserId: 'other-2' }),
        ]),
      },
    });
    const service = build(prisma, scopeStub(orgOf()));
    const res = await service.list({ page: 1, pageSize: 20 }, user);
    expect(res.list[0].hourlyRate).toBe('88.00');
    expect(res.list[1].hourlyRate).toBe('');
    expect(res.list[1].note).toBe('');
  });
});

describe('HrmProfileService：本人修改入口不改组织管理字段', () => {
  it('非管理员自建/改档只落技能，忽略工号/时薪/主管/部门/备注', async () => {
    const calls: PrismaUpsertArgs[] = [];
    const upsert = jest.fn(async (args: PrismaUpsertArgs) => {
      calls.push(args);
      return profileRow({ skills: ['谈判', '英语'] });
    });
    const prisma = stub<PrismaService>({
      account: {
        findFirst: jest.fn(async () => ({ id: 9, status: 'ACTIVE' })),
      },
      orgStaff: { upsert: jest.fn(async () => ({})) },
      hrmEmployeeProfile: { upsert },
    });
    const service = build(prisma, scopeStub(orgOf()));
    await service.upsert(
      {
        memberUserId: 'user-9',
        employeeNo: 'HACK-9',
        employmentType: 'AGENT',
        hourlyRate: 999,
        supervisorUserId: 'boss-x',
        department: 'ceo',
        skills: ['谈判', '英语'],
        joinedAt: '2030-01-01',
        note: '越权备注',
      },
      user,
    );
    const call = calls[0];
    // 更新只改自助资料（技能），组织管理字段一律不动
    expect(call.update).toEqual({ skills: ['谈判', '英语'] });
    expect(call.create).toMatchObject({
      employeeNo: '',
      employmentType: 'FULL_TIME',
      hourlyRate: 0,
      supervisorUserId: '',
      department: '',
      joinedAt: '',
      note: '',
      skills: ['谈判', '英语'],
    });
  });

  it('HR 管理员改档落全部管理字段', async () => {
    const calls: PrismaUpsertArgs[] = [];
    const upsert = jest.fn(async (args: PrismaUpsertArgs) => {
      calls.push(args);
      return profileRow();
    });
    const requireStaff = jest.fn(async (_o: HrmOrg, id: string) => id);
    const scope = scopeStub(
      orgOf({ isAdmin: true, actorId: 'hr-1' }),
      requireStaff,
    );
    const prisma = stub<PrismaService>({
      account: {
        findFirst: jest.fn(async () => ({ id: 9, status: 'ACTIVE' })),
      },
      orgStaff: { upsert: jest.fn(async () => ({})) },
      hrmEmployeeProfile: { upsert },
    });
    const service = build(prisma, scope);
    await service.upsert(
      {
        memberUserId: 'user-9',
        employeeNo: 'E-9',
        employmentType: 'LABOR',
        hourlyRate: 120,
        supervisorUserId: 'boss-1',
        department: 'sales',
        skills: ['谈判'],
        joinedAt: '2025-05-01',
        note: 'HR 备注',
      },
      user,
    );
    expect(requireStaff).toHaveBeenCalledWith(
      expect.anything(),
      'boss-1',
      false,
    );
    expect(calls[0].update).toMatchObject({
      employeeNo: 'E-9',
      employmentType: 'LABOR',
      hourlyRate: 120,
      supervisorUserId: 'boss-1',
      department: 'sales',
      note: 'HR 备注',
    });
  });
});
