import { PrismaClient } from '../../generated/prisma';
import { readIdentitySnapshot } from './identity-snapshot';
import { runInRequestContext } from '../common/request-context';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';

const databaseUrl = process.env.IDENTITY_SNAPSHOT_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('identity snapshot PostgreSQL parity', () => {
  let prisma: PrismaClient;
  const userId = 'snapshot-database-unit';
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^\/aipdd_enterprise_identity_test_[a-z0-9_]+$/.test(url.pathname) ||
      [...url.searchParams.keys()].some((key) => key !== 'schema') ||
      (url.searchParams.get('schema') || 'public') !== 'public'
    )
      throw new Error(
        '身份快照测试仅允许本机 aipdd_enterprise_identity_test_* 隔离库',
      );
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    const createdAt = new Date('2026-10-24T08:30:00.123Z');
    await prisma.enterpriseProfile.createMany({
      data: [
        {
          userId,
          name: 'Approved older',
          uscc: '',
          status: 'APPROVED',
          createdAt,
        },
        {
          userId,
          name: 'Approved latest',
          uscc: '',
          status: 'APPROVED',
          createdAt,
        },
        {
          userId,
          name: 'Rejected newest',
          uscc: '',
          status: 'REJECTED',
          createdAt,
        },
        { userId: 'other-user', name: 'Other', uscc: '', createdAt },
      ],
    });
    await prisma.providerApplication.createMany({
      data: [
        {
          userId,
          providerType: 'TAX_FINANCE',
          orgName: 'Provider',
          intro: '',
          status: 'APPROVED',
          createdAt,
          itemAudits: [{ item: 'tax', status: 'APPROVED' }],
          attachments: [{ name: 'test' }],
          businessStaff: [{ name: 'Staff' }],
        },
        {
          userId,
          providerType: 'LEGAL_SERVICE',
          orgName: 'Pending',
          intro: '',
          createdAt,
        },
        {
          userId: 'other-user',
          providerType: 'LEGAL_SERVICE',
          orgName: 'Other',
          intro: '',
        },
      ],
    });
    await prisma.staffProfile.create({
      data: {
        userId,
        realName: 'Unit',
        phone: '',
        intro: '',
        categories: ['LEGAL_SERVICE'],
        createdAt,
      },
    });
    await prisma.providerStaff.createMany({
      data: [
        {
          providerUserId: 'active-provider',
          staffUserId: userId,
          status: 'ACTIVE',
          roles: ['legal'],
          createdAt,
        },
        {
          providerUserId: 'inactive-provider',
          staffUserId: userId,
          status: 'INACTIVE',
          createdAt,
        },
        {
          providerUserId: 'active-provider',
          staffUserId: 'other-user',
          createdAt,
        },
      ],
    });
    await prisma.identityPreference.create({
      data: { userId, currentIdentity: 'SERVICE_PROVIDER' },
    });
    await prisma.userDirectory.create({
      data: {
        userId,
        username: 'unit',
        enabled: 0,
        syncedAt: createdAt,
        createdAt,
      },
    });
    await prisma.systemSetting.create({
      data: { key: 'flex_payroll_enabled', value: 'true' },
    });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('equals the seven existing Prisma reads including full dates, JSON, filters and ordering', async () => {
    const [
      enterprise,
      providerApps,
      staffProfile,
      staffOf,
      pref,
      directory,
      flag,
    ] = await Promise.all([
      prisma.enterpriseProfile.findFirst({
        where: { userId, status: 'APPROVED' },
        orderBy: { id: 'desc' },
      }),
      prisma.providerApplication.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
      }),
      prisma.staffProfile.findUnique({ where: { userId } }),
      prisma.providerStaff.findMany({
        where: { staffUserId: userId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      }),
      prisma.identityPreference.findUnique({ where: { userId } }),
      prisma.userDirectory.findUnique({ where: { userId } }),
      prisma.systemSetting.findUnique({
        where: { key: 'flex_payroll_enabled' },
      }),
    ]);
    expect(
      await readIdentitySnapshot(stub<PrismaService>(prisma), userId),
    ).toEqual({
      enterprise,
      providerApps,
      staffProfile,
      staffOf,
      pref,
      directory,
      flexPayrollEnabled: flag?.value === 'true',
    });
  });

  it('returns empty qualifications for unknown ids and never interprets ids as SQL', async () => {
    for (const id of ['unknown-user', "x' OR 1=1 --"]) {
      expect(
        await readIdentitySnapshot(stub<PrismaService>(prisma), id),
      ).toEqual({
        enterprise: null,
        providerApps: [],
        staffProfile: null,
        staffOf: [],
        pref: null,
        directory: null,
        flexPayrollEnabled: true,
      });
    }
  });

  it('reads revoked qualifications and disabled flags again on the next request', async () => {
    await prisma.enterpriseProfile.updateMany({
      where: { userId },
      data: { status: 'REJECTED' },
    });
    await prisma.providerApplication.updateMany({
      where: { userId },
      data: { status: 'REJECTED' },
    });
    await prisma.providerStaff.updateMany({
      where: { staffUserId: userId },
      data: { status: 'INACTIVE' },
    });
    await prisma.systemSetting.update({
      where: { key: 'flex_payroll_enabled' },
      data: { value: 'false' },
    });
    const snapshot = await runInRequestContext(() =>
      readIdentitySnapshot(stub<PrismaService>(prisma), userId),
    );
    expect(snapshot.enterprise).toBeNull();
    expect(
      snapshot.providerApps.every((item) => item.status === 'REJECTED'),
    ).toBe(true);
    expect(snapshot.staffOf).toEqual([]);
    expect(snapshot.flexPayrollEnabled).toBe(false);
  });
});
