import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import { LowCodeAccessService } from './lowcode.access.service';
import { stub } from '../../test/doubles';

/**
 * 设计方案 §四 低代码行：组织成员离职后，独立项目成员资格可能继续有效。
 * 组织项目授权必须叠加「当前仍是该组织在册成员」，即使项目成员表还没异步清理，
 * 也要立刻按「项目不存在」处理，不向非成员泄露项目是否存在。
 */

const PROJECT = {
  id: 5,
  ownerUserId: 'owner-1',
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-a',
  name: '组织项目',
  description: '',
  icon: 'appstore',
  type: 'BLANK',
  status: 'ACTIVE',
  settings: {},
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const USER = new CurrentUser('u2', '李四', 'member');

function build(opts: {
  member?: { id: number; roleId: number; status: string } | null;
  standing?: boolean;
}) {
  const prisma = {
    lowCodeProject: { findUnique: jest.fn(async () => PROJECT) },
    lowCodeProjectMember: {
      findUnique: jest.fn(async () => ('member' in opts ? opts.member : null)),
    },
    lowCodeRole: {
      findFirst: jest.fn(async () => ({
        id: 88,
        projectId: PROJECT.id,
        key: 'MEMBER',
        name: '成员',
      })),
    },
    orgStaff: { findFirst: jest.fn(async () => null) },
    lowCodeRolePermission: { findMany: jest.fn(async () => []) },
    lowCodeDataRule: { findMany: jest.fn(async () => []) },
  };
  const membershipValid = jest.fn(async () => opts.standing ?? true);
  const scope = stub<HrmScopeService>({ membershipValid });
  const service = new LowCodeAccessService(
    stub<PrismaService>(prisma),
    stub<IdentityService>({}),
    scope,
  );
  return { service, prisma, membershipValid };
}

describe('LowCodeAccessService：组织项目成员资格必须叠加在册关系', () => {
  it('项目成员表仍是 ACTIVE，但已离职（不在册）：按项目不存在处理', async () => {
    const ctx = build({
      member: { id: 1, roleId: 88, status: 'ACTIVE' },
      standing: false,
    });
    await expect(ctx.service.resolve(USER, '5')).rejects.toThrow('项目不存在');
    expect(ctx.membershipValid).toHaveBeenCalledWith(
      'ENTERPRISE',
      'ent-a',
      'u2',
    );
    expect(ctx.prisma.lowCodeRolePermission.findMany).not.toHaveBeenCalled();
  });

  it('项目成员表已清理（REMOVED）：非成员按项目不存在处理', async () => {
    const ctx = build({
      member: { id: 1, roleId: 88, status: 'REMOVED' },
      standing: true,
    });
    await expect(ctx.service.resolve(USER, '5')).rejects.toThrow('项目不存在');
  });

  it('仍在册的在册成员：正常解析出项目上下文', async () => {
    const ctx = build({
      member: { id: 1, roleId: 88, status: 'ACTIVE' },
      standing: true,
    });
    const access = await ctx.service.resolve(USER, '5');
    expect(access.project.id).toBe(5);
    expect(access.roleKey).toBe('MEMBER');
    expect(access.isOwner).toBe(false);
  });

  it('个人项目（无组织键）不做在册叠加', async () => {
    const ctx = build({
      member: { id: 1, roleId: 88, status: 'ACTIVE' },
      standing: false,
    });
    ctx.prisma.lowCodeProject.findUnique.mockResolvedValueOnce({
      ...PROJECT,
      orgType: '',
      orgUserId: '',
    });
    const access = await ctx.service.resolve(USER, '5');
    expect(access.project.id).toBe(5);
    expect(ctx.membershipValid).not.toHaveBeenCalled();
  });

  it('我自己的组织项目：所有者直接被授权（不查成员表）', async () => {
    const ctx = build({ member: null, standing: true });
    ctx.prisma.lowCodeProject.findUnique.mockResolvedValueOnce({
      ...PROJECT,
      ownerUserId: 'u2',
    });
    const access = await ctx.service.resolve(USER, '5');
    expect(access.isOwner).toBe(true);
    expect(access.roleKey).toBe('OWNER');
  });
});
