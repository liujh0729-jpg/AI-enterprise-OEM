import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { TenantScopeService } from './tenant-scope.service';
import { CrmScopeService } from '../crm/crm.scope';
import { BiScopeService } from '../bi/bi.scope';
import { OaScopeService } from '../oa/oa.scope';

/**
 * 设计方案 §1.2 / §二：切换组织后不同模块看到的数据范围要一致 —— 组织上下文收敛到
 * 统一租户解析服务，CRM / BI / OA 与 HRM/OKR 共用同一套「当前主体」口径，
 * 不再各写一套组织选择逻辑。
 */

const USER = new CurrentUser('actor-1', 'actor', 'user');

function tenantStub(preferred: unknown): TenantScopeService {
  return stub<TenantScopeService>({
    preferred: jest.fn(async () => preferred),
  });
}

describe('TenantScopeService.preferred 主体切换器口径', () => {
  it('切换器选过且关系仍在册 → 采用该组织（非主账号、带角色与部门）', async () => {
    const prisma = stub<PrismaService>({
      userOrgContext: {
        findUnique: jest.fn(async () => ({
          orgType: 'PROVIDER',
          orgUserId: 'prov-9',
        })),
      },
      orgStaff: {
        findFirst: jest.fn(async () => ({
          roles: ['ADMIN'],
          department: '销售部',
        })),
      },
    });
    const service = new TenantScopeService(prisma);
    await expect(service.preferred('actor-1')).resolves.toEqual({
      orgType: 'PROVIDER',
      orgUserId: 'prov-9',
      isOwner: false,
      roles: ['ADMIN'],
      department: '销售部',
      actorId: 'actor-1',
    });
  });

  it('切换器选过但关系已失效 → 返回 null，交回 fallback 规则', async () => {
    const prisma = stub<PrismaService>({
      userOrgContext: {
        findUnique: jest.fn(async () => ({
          orgType: 'ENTERPRISE',
          orgUserId: 'ghost-ent',
        })),
      },
      orgStaff: { findFirst: jest.fn(async () => null) },
    });
    const service = new TenantScopeService(prisma);
    await expect(service.preferred('actor-1')).resolves.toBeNull();
  });

  it('未切换过 → 返回 null', async () => {
    const prisma = stub<PrismaService>({
      userOrgContext: { findUnique: jest.fn(async () => null) },
    });
    const service = new TenantScopeService(prisma);
    await expect(service.preferred('actor-1')).resolves.toBeNull();
  });
});

describe('CRM 采用主体切换器选定的组织', () => {
  it('切换器指向服务商组织时，CRM 归属该组织并按成员角色取权', async () => {
    const prisma = stub<PrismaService>({
      crmMember: {
        findUnique: jest.fn(async () => ({
          status: 'ACTIVE',
          role: 'SALES',
          dataScope: 'DEPT',
          department: '销售部',
        })),
      },
    });
    const scope = new CrmScopeService(
      prisma,
      stub<UserLookupService>({}),
      tenantStub({
        orgType: 'PROVIDER',
        orgUserId: 'prov-9',
        actorId: 'actor-1',
        isOwner: false,
        roles: ['SALES'],
        department: '销售部',
      }),
    );
    const ctx = await scope.context(USER);
    expect(ctx.ownerUserId).toBe('prov-9');
    expect(ctx.orgType).toBe('PROVIDER');
    expect(ctx.role).toBe('SALES');
    expect(ctx.isOwner).toBe(false);
    expect(ctx.isAdmin).toBe(false);
  });
});

describe('BI 采用主体切换器选定的组织', () => {
  it('切换器指向服务商组织时，BI 归属该组织并按成员角色取权', async () => {
    const prisma = stub<PrismaService>({
      biMember: {
        findUnique: jest.fn(async () => ({
          status: 'ACTIVE',
          role: 'ANALYST',
        })),
      },
      orgStaff: { findFirst: jest.fn(async () => null) },
      providerStaff: { findFirst: jest.fn(async () => null) },
    });
    const scope = new BiScopeService(
      prisma,
      stub<UserLookupService>({}),
      tenantStub({
        orgType: 'PROVIDER',
        orgUserId: 'prov-9',
        actorId: 'actor-1',
        isOwner: false,
        roles: ['ANALYST'],
        department: '',
      }),
    );
    const ctx = await scope.context(USER);
    expect(ctx.ownerUserId).toBe('prov-9');
    expect(ctx.role).toBe('ANALYST');
    expect(ctx.isOwner).toBe(false);
  });
});

describe('OA 未显式指定组织时采用主体切换器选定的组织', () => {
  it('切换器指向服务商组织时，OA 默认组织为该服务商', async () => {
    const prisma = stub<PrismaService>({
      orgStaff: {
        findMany: jest.fn(async () => [
          {
            orgType: 'PROVIDER',
            orgUserId: 'prov-9',
            memberUserId: 'actor-1',
            memberKind: 'STAFF',
            status: 'ACTIVE',
            roles: [],
          },
        ]),
        findFirst: jest.fn(async () => null),
      },
      enterpriseProfile: {
        findFirst: jest.fn(async () => ({ name: 'A 公司' })),
        findMany: jest.fn(async () => []),
      },
      providerApplication: {
        findMany: jest.fn(async () => [{ orgName: '' }]),
      },
      oaSettings: { findUnique: jest.fn(async () => null) },
    });
    const users = stub<UserLookupService>({
      lookup: jest.fn(async () => []),
    });
    const scope = new OaScopeService(
      prisma,
      users,
      tenantStub({
        orgType: 'PROVIDER',
        orgUserId: 'prov-9',
        actorId: 'actor-1',
        isOwner: false,
        roles: [],
        department: '',
      }),
    );
    const ctx = await scope.resolve(USER, {});
    expect(ctx?.orgType).toBe('PROVIDER');
    expect(ctx?.orgUserId).toBe('prov-9');
  });

  it('显式指定组织时以显式参数为准，不经过切换器', async () => {
    const preferred = jest.fn(async () => ({
      orgType: 'PROVIDER',
      orgUserId: 'prov-9',
      actorId: 'actor-1',
      isOwner: false,
      roles: [],
      department: '',
    }));
    const prisma = stub<PrismaService>({
      orgStaff: {
        findMany: jest.fn(async () => [
          {
            orgType: 'ENTERPRISE',
            orgUserId: 'actor-1',
            memberUserId: 'actor-1',
            memberKind: 'STAFF',
            status: 'ACTIVE',
            roles: [],
          },
        ]),
        findFirst: jest.fn(async () => null),
      },
      enterpriseProfile: {
        findFirst: jest.fn(async () => ({ name: 'A 公司' })),
        findMany: jest.fn(async () => []),
      },
      providerApplication: { findMany: jest.fn(async () => []) },
      oaSettings: { findUnique: jest.fn(async () => null) },
    });
    const scope = new OaScopeService(
      prisma,
      stub<UserLookupService>({ lookup: jest.fn(async () => []) }),
      stub<TenantScopeService>({ preferred }),
    );
    const ctx = await scope.resolve(USER, {
      orgType: 'ENTERPRISE',
      orgUserId: 'actor-1',
    });
    expect(ctx?.orgType).toBe('ENTERPRISE');
    expect(preferred).not.toHaveBeenCalled();
  });
});
