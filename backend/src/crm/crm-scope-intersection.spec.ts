import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { DataTableService } from '../data-table/data-table.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { CrmCustomerService } from './crm.customer.service';
import { CrmLeadService } from './crm.lead.service';
import { CrmReportService } from './crm.report.service';
import { CrmSettingsService } from './crm.settings.service';
import { CrmContext, CrmScopeService } from './crm.scope';

const user = new CurrentUser('actor-1', 'actor', 'user');

function ctxOf(overrides: Partial<CrmContext> = {}): CrmContext {
  return {
    ownerUserId: 'org-1',
    orgType: 'ENTERPRISE',
    actorId: 'actor-1',
    role: 'SALES',
    dataScope: 'SELF',
    department: '',
    isOwner: false,
    isMember: true,
    isAdmin: false,
    ...overrides,
  };
}

function scopeService(): CrmScopeService {
  return new CrmScopeService(
    stub<PrismaService>({}),
    stub<UserLookupService>({}),
  );
}

describe('CrmScopeService 数据范围裁剪', () => {
  it('SELF 范围按创建人字段收窄（导出场景）', async () => {
    const scope = scopeService();
    const where = await scope.scopeWhereAsync(
      ctxOf({ dataScope: 'SELF' }),
      'CORE',
      'createdBy',
    );
    expect(where).toEqual({ ownerUserId: 'org-1', createdBy: 'actor-1' });
  });

  it('组织级范围不额外收窄创建人', async () => {
    const scope = scopeService();
    const where = await scope.scopeWhereAsync(
      ctxOf({ isAdmin: true, role: 'ADMIN', dataScope: 'ALL' }),
      'CORE',
      'createdBy',
    );
    expect(where).toEqual({ ownerUserId: 'org-1' });
    expect(where).not.toHaveProperty('createdBy');
  });

  it('DEPT 范围取部门在职成员与本人交集', async () => {
    const prisma = stub<PrismaService>({
      crmMember: {
        findMany: jest.fn(async () => [{ memberUserId: 'peer-1' }]),
      },
    });
    const scope = new CrmScopeService(prisma, stub<UserLookupService>({}));
    const where = await scope.scopeWhereAsync(
      ctxOf({ dataScope: 'DEPT', department: 'sales' }),
      'CORE',
      'createdBy',
    );
    expect(where).toEqual({
      ownerUserId: 'org-1',
      createdBy: { in: ['peer-1', 'actor-1'] },
    });
  });

  it('ownerInScope：未限制放行、命中放行、越界拒绝', () => {
    const scope = scopeService();
    expect(scope.ownerInScope(undefined, 'anyone')).toBe(true);
    expect(scope.ownerInScope('a', 'a')).toBe(true);
    expect(scope.ownerInScope('a', 'b')).toBe(false);
    expect(scope.ownerInScope({ in: ['a', 'b'] }, 'b')).toBe(true);
    expect(scope.ownerInScope({ in: ['a', 'b'] }, 'z')).toBe(false);
  });
});

describe('CRM 列表：用户筛选只能与授权范围取交集', () => {
  it('客户：筛选负责人超出范围时返回空集且不查库', async () => {
    const scope = scopeService();
    jest.spyOn(scope, 'requireMember').mockResolvedValue(ctxOf());
    jest
      .spyOn(scope, 'scopeWhereAsync')
      .mockResolvedValue({ ownerUserId: 'org-1', ownerId: 'actor-1' });
    const findMany = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    const prisma = stub<PrismaService>({
      crmCustomer: { findMany, count },
    });
    const service = new CrmCustomerService(
      prisma,
      scope,
      stub<CrmSettingsService>({}),
    );
    const res = await service.list(user, { ownerId: 'someone-else' });
    expect(res).toEqual({ list: [], total: 0, page: 1, pageSize: 20 });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('客户：筛选负责人命中范围则带条件下发', async () => {
    const scope = scopeService();
    jest.spyOn(scope, 'requireMember').mockResolvedValue(ctxOf());
    jest
      .spyOn(scope, 'scopeWhereAsync')
      .mockResolvedValue({ ownerUserId: 'org-1', ownerId: 'actor-1' });
    const findMany = jest.fn(async () => []);
    const prisma = stub<PrismaService>({
      crmCustomer: { findMany, count: jest.fn(async () => 0) },
    });
    const service = new CrmCustomerService(
      prisma,
      scope,
      stub<CrmSettingsService>({}),
    );
    await service.list(user, { ownerId: 'actor-1' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: 'actor-1' }),
      }),
    );
  });

  it('客户：组织级范围可筛任意负责人', async () => {
    const scope = scopeService();
    jest
      .spyOn(scope, 'requireMember')
      .mockResolvedValue(ctxOf({ isAdmin: true, role: 'ADMIN' }));
    jest
      .spyOn(scope, 'scopeWhereAsync')
      .mockResolvedValue({ ownerUserId: 'org-1' });
    const findMany = jest.fn(async () => []);
    const prisma = stub<PrismaService>({
      crmCustomer: { findMany, count: jest.fn(async () => 0) },
    });
    const service = new CrmCustomerService(
      prisma,
      scope,
      stub<CrmSettingsService>({}),
    );
    await service.list(user, { ownerId: 'anyone' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: 'anyone' }),
      }),
    );
  });

  it('线索：筛选负责人超出范围时返回空集且不查库', async () => {
    const scope = scopeService();
    jest.spyOn(scope, 'requireMember').mockResolvedValue(ctxOf());
    jest
      .spyOn(scope, 'scopeWhereAsync')
      .mockResolvedValue({ ownerUserId: 'org-1', ownerId: 'actor-1' });
    const findMany = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    const prisma = stub<PrismaService>({ crmLead: { findMany, count } });
    const service = new CrmLeadService(
      prisma,
      scope,
      stub<CrmSettingsService>({}),
    );
    const res = await service.list(user, { ownerId: 'someone-else' });
    expect(res).toEqual({ list: [], total: 0, page: 1, pageSize: 20 });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});

describe('CrmReportService 导出/下载复核数据权限', () => {
  function build(scope: CrmScopeService, prisma: PrismaService) {
    return new CrmReportService(
      prisma,
      scope,
      stub<CrmSettingsService>({}),
      stub<DataTableService>({}),
    );
  }

  it('非组织级范围只见本人创建的导出任务', async () => {
    const scope = scopeService();
    jest.spyOn(scope, 'requireMember').mockResolvedValue(ctxOf());
    jest
      .spyOn(scope, 'scopeWhereAsync')
      .mockResolvedValue({ ownerUserId: 'org-1', createdBy: 'actor-1' });
    const findMany = jest.fn(async () => []);
    const prisma = stub<PrismaService>({ crmExportTask: { findMany } });
    await build(scope, prisma).exportTasks(user);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerUserId: 'org-1',
          createdBy: 'actor-1',
        }),
      }),
    );
  });

  it('组织级范围不加创建人限制', async () => {
    const scope = scopeService();
    jest.spyOn(scope, 'requireMember').mockResolvedValue(ctxOf());
    jest
      .spyOn(scope, 'scopeWhereAsync')
      .mockResolvedValue({ ownerUserId: 'org-1' });
    const whereArgs: Array<{ where: Record<string, unknown> }> = [];
    const findMany = jest.fn(
      async (args: { where: Record<string, unknown> }) => {
        whereArgs.push(args);
        return [];
      },
    );
    const prisma = stub<PrismaService>({ crmExportTask: { findMany } });
    await build(scope, prisma).exportTasks(user);
    expect(whereArgs[0].where).not.toHaveProperty('createdBy');
  });

  it('下载他人导出按不存在处理，不泄露存在性', async () => {
    const scope = scopeService();
    jest.spyOn(scope, 'requireMember').mockResolvedValue(ctxOf());
    jest
      .spyOn(scope, 'scopeWhereAsync')
      .mockResolvedValue({ ownerUserId: 'org-1', createdBy: 'actor-1' });
    const findFirst = jest.fn(async () => null);
    const prisma = stub<PrismaService>({ crmExportTask: { findFirst } });
    await expect(
      build(scope, prisma).download(user, '9'),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 9, ownerUserId: 'org-1', createdBy: 'actor-1' },
    });
  });
});
