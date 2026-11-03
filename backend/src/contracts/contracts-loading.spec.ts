import { ContractsService } from './contracts.service';
import { CurrentUser } from '../auth/current-user';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('dashboard contract reads', () => {
  const user = new CurrentUser('provider', 'fixture', 'user');
  it('loads independent visibility inputs concurrently and preserves the filter', async () => {
    const context = deferred<{ providers: string[] }>();
    const enterprises = deferred<{ id: number }[]>();
    const identity = {
      qualifications: jest
        .fn()
        .mockResolvedValue({ roles: ['SERVICE_PROVIDER'] }),
      effectiveRoles: jest.fn().mockReturnValue(['SERVICE_PROVIDER']),
      providerContext: jest.fn().mockReturnValue(context.promise),
      myEnterprises: jest.fn().mockReturnValue(enterprises.promise),
    };
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 2 } }]);
    const service = new ContractsService(
      { contract: { groupBy } } as never,
      identity as never,
      {} as never,
      {} as never,
    );
    const result = service.listStats(user);
    await Promise.resolve();
    expect(identity.providerContext).toHaveBeenCalledWith(user.userId);
    expect(identity.myEnterprises).toHaveBeenCalledWith(user.userId);
    expect(groupBy).not.toHaveBeenCalled();
    context.resolve({ providers: ['provider'] });
    enterprises.resolve([{ id: 7 }]);
    await expect(result).resolves.toEqual({ total: 2, active: 2, pending: 0 });
    expect(groupBy.mock.calls[0][0].where).toEqual({
      OR: [
        { providerUserId: { in: ['provider'] } },
        { enterpriseId: { in: [7] } },
      ],
    });
  });

  it('loads enterprise details and assignments concurrently after finding contracts', async () => {
    const enterprises = deferred<{ id: number; name: string }[]>();
    const assignments =
      deferred<{ enterpriseId: number; staffUserId: string }[]>();
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([{ enterpriseId: 7 }]),
      },
      enterpriseProfile: {
        findMany: jest.fn().mockReturnValue(enterprises.promise),
      },
      providerAssignment: {
        findMany: jest.fn().mockReturnValue(assignments.promise),
      },
    };
    const identity = {
      qualifications: jest
        .fn()
        .mockResolvedValue({ roles: ['SERVICE_PROVIDER'] }),
    };
    const service = new ContractsService(
      prisma as never,
      identity as never,
      {} as never,
      {} as never,
    );
    const result = service.myEnterprises(user);
    await Promise.resolve();
    await Promise.resolve();
    expect(prisma.enterpriseProfile.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
    });
    expect(prisma.providerAssignment.findMany).toHaveBeenCalledWith({
      where: { providerUserId: user.userId },
    });
    enterprises.resolve([{ id: 7, name: 'fixture' }]);
    assignments.resolve([{ enterpriseId: 7, staffUserId: 'staff' }]);
    await expect(result).resolves.toEqual([
      { id: 7, name: 'fixture', staffUserId: 'staff' },
    ]);
  });

  it.each([false, true])(
    'skips enterprise and assignment reads with no usable contracts (provider=%s)',
    async (provider) => {
      const prisma = {
        contract: { findMany: jest.fn().mockResolvedValue([]) },
        enterpriseProfile: { findMany: jest.fn() },
        providerAssignment: { findMany: jest.fn() },
      };
      const identity = {
        qualifications: jest
          .fn()
          .mockResolvedValue({ roles: provider ? ['SERVICE_PROVIDER'] : [] }),
      };
      const service = new ContractsService(
        prisma as never,
        identity as never,
        {} as never,
        {} as never,
      );
      await expect(service.myEnterprises(user)).resolves.toEqual([]);
      expect(prisma.contract.findMany).toHaveBeenCalledTimes(provider ? 1 : 0);
      expect(prisma.enterpriseProfile.findMany).not.toHaveBeenCalled();
      expect(prisma.providerAssignment.findMany).not.toHaveBeenCalled();
    },
  );
});
