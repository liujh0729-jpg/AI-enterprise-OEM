import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { IdentityService } from '../identity/identity.service';
import { OssService } from '../oss/oss.service';
import { PrismaService } from '../prisma/prisma.service';
import { QxyService } from '../qixiangyun/qxy.service';
import { ContactResolver } from '../shared/contacts.service';
import { stub } from '../../test/doubles';
import { InvoiceService } from './invoice.service';

const reviewer = new CurrentUser('reviewer', 'reviewer', 'admin');
const outsider = new CurrentUser('outsider', 'outsider', 'user');
const invoice = () => ({
  id: 7,
  reqNo: 'KP-7',
  enterpriseId: 42,
  enterpriseName: '测试企业',
  requestedBy: 'owner',
  providerUserId: 'provider',
  staffUserId: 'reviewer',
  orderNo: '',
  invoiceType: '04',
  buyerType: '1',
  buyerName: '购方',
  buyerTaxNo: '',
  remark: '',
  items: [{ goodsName: '服务', quantity: 1, price: 100 }],
  amount: 100,
  tax: 6,
  status: 'REQUESTED',
});

describe('invoice authorization and submission', () => {
  it('rejects an invoice request for another enterprise before looking up a contract', async () => {
    const prisma = {
      enterpriseProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 42, userId: 'owner' }),
      },
      contract: { findFirst: jest.fn() },
    };
    const identity = { isPlatformAdmin: () => false };
    const service = new InvoiceService(
      stub<PrismaService>(prisma),
      stub<IdentityService>(identity),
      stub<QxyService>(),
      stub<ContactResolver>(),
    );
    await expect(
      service.create(outsider, { enterpriseId: 42, buyerName: '购方' }),
    ).rejects.toThrow('只能为本人所属企业申请开票');
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
  });

  it('submits at most one upstream task under concurrent approvals', async () => {
    const row = invoice();
    const prisma = {
      invoiceRequest: {
        findUnique: jest.fn(async () => ({ ...row })),
        findFirst: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { status: string };
            data: Record<string, unknown>;
          }) => {
            if (row.status !== where.status) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          },
        ),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(row, data);
          return { ...row };
        }),
      },
      staffProfile: { findMany: jest.fn().mockResolvedValue([]) },
      userDirectory: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const identity = {
      isPlatformAdmin: () => true,
      canWorkOn: jest.fn().mockResolvedValue(true),
      canServeEnterprise: jest.fn().mockResolvedValue(true),
      audit: jest.fn().mockResolvedValue(undefined),
    };
    const qxy = {
      assertAutoInvoiceReady: jest.fn().mockResolvedValue(undefined),
      autoIssueInvoice: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { code: 'OK', message: 'accepted', task: { taskId: 'task-1' } };
      }),
    };
    const contacts = { stage: jest.fn().mockResolvedValue({}) };
    const service = new InvoiceService(
      stub<PrismaService>(prisma),
      stub<IdentityService>(identity),
      stub<QxyService>(qxy),
      stub<ContactResolver>(contacts),
    );
    const outcomes = await Promise.allSettled([
      service.approve(reviewer, 7),
      service.approve(reviewer, 7),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(qxy.autoIssueInvoice).toHaveBeenCalledTimes(1);
    expect(qxy.autoIssueInvoice).toHaveBeenCalledWith(
      reviewer,
      42,
      expect.objectContaining({ orderNo: 'KP-7' }),
    );
    expect(row.status).toBe('SUBMITTED');
    expect(row).toMatchObject({ orderNo: 'KP-7', issueTaskId: 'task-1' });
  });

  it('marks uncertain upstream submission for reconciliation without retrying', async () => {
    const row = invoice();
    const prisma = {
      invoiceRequest: {
        findUnique: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { status: string };
            data: Record<string, unknown>;
          }) => {
            if (row.status !== where.status) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          },
        ),
      },
    };
    const identity = {
      isPlatformAdmin: () => true,
      canWorkOn: jest.fn().mockResolvedValue(true),
      canServeEnterprise: jest.fn().mockResolvedValue(true),
    };
    const qxy = {
      assertAutoInvoiceReady: jest.fn().mockResolvedValue(undefined),
      autoIssueInvoice: jest
        .fn()
        .mockRejectedValue(new Error('upstream timeout')),
    };
    const service = new InvoiceService(
      stub<PrismaService>(prisma),
      stub<IdentityService>(identity),
      stub<QxyService>(qxy),
      stub<ContactResolver>({ stage: async () => ({}) }),
    );
    await expect(service.approve(reviewer, 7)).rejects.toThrow(
      'upstream timeout',
    );
    expect(row.status).toBe('ISSUE_UNKNOWN');
    await expect(service.approve(reviewer, 7)).rejects.toThrow('不可审核');
    expect(qxy.autoIssueInvoice).toHaveBeenCalledTimes(1);
  });

  it('filters a stale staff invoice from list and detail after access is revoked', async () => {
    const row = invoice();
    const prisma = {
      invoiceRequest: {
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(row),
        findFirst: jest.fn().mockResolvedValue(row),
      },
      providerStaff: { findMany: jest.fn().mockResolvedValue([]) },
      staffProfile: { findMany: jest.fn().mockResolvedValue([]) },
      userDirectory: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const identity = {
      isPlatformAdmin: () => false,
      myEnterprises: jest.fn().mockResolvedValue([]),
      currentIdentity: jest.fn().mockResolvedValue('PROVIDER_STAFF'),
      canWorkOn: jest.fn().mockResolvedValue(false),
    };
    const service = new InvoiceService(
      stub<PrismaService>(prisma),
      stub<IdentityService>(identity),
      stub<QxyService>(),
      stub<ContactResolver>(),
    );
    expect(await service.list(outsider)).toEqual([]);
    await expect(service.detail(outsider, 7)).rejects.toThrow('无权查看');
  });
});

describe('provider assignment', () => {
  it('rejects a provider without an active contract', async () => {
    const prisma = {
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      providerStaff: { findUnique: jest.fn() },
      providerAssignment: { upsert: jest.fn() },
    };
    const identity = new IdentityService(
      stub<PrismaService>(prisma),
      stub<UserLookupService>(),
      stub<OssService>(),
    );
    jest
      .spyOn(identity, 'requireRoles')
      .mockResolvedValue(
        stub<Awaited<ReturnType<IdentityService['requireRoles']>>>(),
      );
    await expect(
      identity.assignEnterprise(outsider, 42, 'staff'),
    ).rejects.toThrow('未与该企业建立生效签约');
    expect(prisma.providerAssignment.upsert).not.toHaveBeenCalled();
  });
});
