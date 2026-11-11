import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { HrmProfileService } from './hrm-profile.service';
import { HrmOrg, HrmScopeService } from './hrm.scope';

const actor = new CurrentUser('hr-1', 'hr', 'user');

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

function prismaStub(collections: {
  customers?: { id: number; name: string }[];
  projects?: { id: number; name: string }[];
  members?: { id: number; projectId: number }[];
  linkedProjects?: { id: number; name: string }[];
  tasks?: number;
  approvals?: number;
  profile?: { status: string } | null;
}) {
  return stub<PrismaService>({
    crmCustomer: {
      findMany: jest.fn(async () => collections.customers || []),
      updateMany: jest.fn(async () => ({
        count: (collections.customers || []).length,
      })),
    },
    pjProject: {
      findMany: jest.fn(async (args: { where?: { id?: unknown } }) =>
        args?.where?.id ? collections.linkedProjects || [] : collections.projects || [],
      ),
      updateMany: jest.fn(async () => ({
        count: (collections.projects || []).length,
      })),
    },
    pjProjectMember: {
      findMany: jest.fn(async () => collections.members || []),
      updateMany: jest.fn(async () => ({
        count: (collections.members || []).length,
      })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    myTask: { count: jest.fn(async () => collections.tasks || 0) },
    oaTask: { count: jest.fn(async () => collections.approvals || 0) },
    hrmEmployeeProfile: {
      findUnique: jest.fn(async () => collections.profile ?? null),
    },
    $transaction: jest.fn(async (operations: unknown[]) => operations),
  });
}

function scopeStub(): HrmScopeService {
  return stub<HrmScopeService>({
    resolve: jest.fn(async () => orgOf()),
    requireAdmin: jest.fn(),
    requireStaff: jest.fn(async (_org: HrmOrg, id: string) => id),
    names: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `名-${id}`]))),
  });
}

describe('HrmProfileService：离职交接', () => {
  it('清单把负责项目与参与项目合并计数，未清零前不可结案', async () => {
    const prisma = prismaStub({
      customers: [{ id: 1, name: '客户甲' }],
      projects: [{ id: 10, name: '项目 X' }],
      members: [
        { id: 100, projectId: 10 },
        { id: 101, projectId: 11 },
      ],
      linkedProjects: [
        { id: 10, name: '项目 X' },
        { id: 11, name: '项目 Y' },
      ],
      tasks: 3,
      approvals: 1,
      profile: { status: 'LEFT' },
    });
    const service = new HrmProfileService(prisma, scopeStub());
    const plan = await service.handover('user-9', actor);
    const projects = plan.checklist.find((item) => item.key === 'projects');
    expect(projects?.pending).toBe(2);
    expect(plan.checklist.find((item) => item.key === 'tasks')?.pending).toBe(3);
    expect(plan.checklist.find((item) => item.key === 'approvals')?.pending).toBe(1);
    expect(plan.closable).toBe(false);
    expect(plan.assets.find((item) => item.key === 'tasks')?.transferable).toBe(false);
  });

  it('全部清零且已离职才可结案', async () => {
    const prisma = prismaStub({ profile: { status: 'LEFT' } });
    const service = new HrmProfileService(prisma, scopeStub());
    const plan = await service.handover('user-9', actor);
    expect(plan.closable).toBe(true);
  });

  it('移交客户与项目负责人，并给接手人派一条交接任务', async () => {
    const prisma = prismaStub({
      customers: [{ id: 1, name: '客户甲' }],
      projects: [{ id: 10, name: '项目 X' }],
    });
    const assign = jest.fn(async () => ({ id: 77 }));
    const notify = jest.fn(async () => null);
    const service = new HrmProfileService(prisma, scopeStub(), { assign }, { notify });
    const result = await service.transferHandover(
      { memberUserId: 'user-9', toUserId: 'user-2' },
      actor,
    );
    expect(result.moved).toMatchObject({ customers: 1, projects: 1 });
    const customerWhere = (prisma.crmCustomer.updateMany as jest.Mock).mock
      .calls[0][0];
    expect(customerWhere.data.ownerId).toBe('user-2');
    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeUserId: 'user-2',
        source: 'hrm',
        sourceId: 'handover:user-9',
      }),
    );
    expect(notify).toHaveBeenCalled();
  });

  it('不接受把在途审批交给系统自动改派', async () => {
    const prisma = prismaStub({});
    const service = new HrmProfileService(prisma, scopeStub());
    await expect(
      service.transferHandover(
        { memberUserId: 'user-9', toUserId: 'user-2', assets: ['approvals'] },
        actor,
      ),
    ).rejects.toThrow('不支持自动改派');
  });

  it('接手人不能是离职人本人', async () => {
    const prisma = prismaStub({});
    const service = new HrmProfileService(prisma, scopeStub());
    await expect(
      service.transferHandover(
        { memberUserId: 'user-9', toUserId: 'user-9' },
        actor,
      ),
    ).rejects.toThrow('不能是离职人本人');
  });
});
