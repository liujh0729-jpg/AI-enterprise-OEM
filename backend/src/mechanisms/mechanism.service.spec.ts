import { MechanismService } from './mechanism.service';
import { CurrentUser } from '../auth/current-user';
import { stub } from '../../test/doubles';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { AccountCrypto } from '../account/account-crypto';
import type { StorageService } from '../storage/storage.service';
import type { NotificationService } from '../notifications/notification.service';

process.env.EXTERNAL_CRED_KEY = process.env.EXTERNAL_CRED_KEY || '0'.repeat(64);

describe('mechanism rules and overview', () => {
  const prisma = {
    webhookSubscription: { count: jest.fn() },
    webhookOutbox: { count: jest.fn() },
    importJob: { count: jest.fn() },
    exportJob: { count: jest.fn() },
    biReportCatalog: { count: jest.fn() },
    ruleDefinition: { count: jest.fn() },
    publicShare: { count: jest.fn() },
    oidcProvider: { count: jest.fn() },
  };
  const scope = {
    resolve: jest.fn().mockResolvedValue({
      orgType: 'ENTERPRISE',
      orgUserId: 'owner',
      actorId: 'owner',
      isOwner: true,
      isAdmin: true,
      department: '',
    }),
  };
  const user = new CurrentUser('owner', 'owner', 'user');
  let service: MechanismService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MechanismService(
      stub<PrismaService>(prisma),
      stub<HrmScopeService>(scope),
      stub<AccountCrypto>({}),
      stub<StorageService>({}),
      stub<NotificationService>({}),
      jest.fn(),
    );
  });

  it('matches all conditions and reports per-field evidence', async () => {
    const result = await service.testRule(user, {
      conditions: [
        { field: 'status', op: 'eq', value: 'DONE' },
        { field: 'amount', op: 'gte', value: 100 },
        { field: 'tags', op: 'in', value: ['vip', 'new'] },
        { field: 'ownerId', op: 'exists', value: true },
      ],
      context: { status: 'DONE', amount: 120, tags: 'vip', ownerId: 'u1' },
    });
    expect(result.matched).toBe(true);
    expect(result.details.map((item) => item.pass)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('fails the whole rule when any condition misses', async () => {
    const result = await service.testRule(user, {
      conditions: [
        { field: 'amount', op: 'gt', value: 500 },
        { field: 'status', op: 'neq', value: 'CANCELED' },
      ],
      context: { amount: 100, status: 'DONE' },
    });
    expect(result.matched).toBe(false);
    expect(result.details[0]).toMatchObject({ field: 'amount', pass: false });
    expect(result.details[1]).toMatchObject({ field: 'status', pass: true });
  });

  it('counts only the current organization when building the overview', async () => {
    prisma.webhookSubscription.count.mockResolvedValue(2);
    prisma.webhookOutbox.count.mockImplementation(
      ({ where }: { where: { status?: string } }) =>
        Promise.resolve(where.status === 'PENDING' ? 3 : 1),
    );
    prisma.importJob.count.mockResolvedValue(4);
    prisma.exportJob.count.mockResolvedValue(5);
    prisma.biReportCatalog.count.mockResolvedValue(6);
    prisma.ruleDefinition.count.mockResolvedValue(7);
    prisma.publicShare.count.mockResolvedValue(8);
    prisma.oidcProvider.count.mockResolvedValue(1);

    const overview = await service.overview(user);
    expect(overview).toEqual({
      webhooks: 2,
      outboxPending: 3,
      outboxFailed: 1,
      importJobs: 4,
      exportJobs: 5,
      reports: 6,
      rules: 7,
      shares: 8,
      oidcProviders: 1,
    });
    expect(prisma.webhookSubscription.count).toHaveBeenCalledWith({
      where: { orgType: 'ENTERPRISE', orgUserId: 'owner' },
    });
  });
});
