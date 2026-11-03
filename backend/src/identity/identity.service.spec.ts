import { CurrentUser } from '../auth/current-user';
import { BUSINESS_IDENTITIES } from '../common/constants';
import { IdentityService } from './identity.service';
import { readIdentitySnapshot } from './identity-snapshot';

jest.mock('./identity-snapshot', () => ({ readIdentitySnapshot: jest.fn() }));

function setup(role = 'user', userId = 'identity-test') {
  let preference: { currentIdentity: string } | null = null;
  const prisma = {
    enterpriseProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    providerApplication: { findMany: jest.fn().mockResolvedValue([]) },
    staffProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    providerStaff: { findMany: jest.fn().mockResolvedValue([]) },
    identityPreference: {
      findUnique: jest
        .fn()
        .mockImplementation(() => Promise.resolve(preference)),
      upsert: jest.fn().mockImplementation(({ update }) => {
        preference = { ...update };
        return Promise.resolve(preference);
      }),
    },
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const users = {
    requireActiveUser: jest.fn().mockResolvedValue({
      username: 'identity-test',
      displayName: 'Identity Test',
    }),
  };
  const service = new IdentityService(
    prisma as never,
    users as never,
    {} as never,
  );
  jest.mocked(readIdentitySnapshot).mockImplementation(async (_, id) => {
    const [
      enterprise,
      providerApps,
      staffProfile,
      staffOf,
      pref,
      flexPayrollEnabled,
    ] = await Promise.all([
      prisma.enterpriseProfile.findFirst(),
      prisma.providerApplication.findMany(),
      prisma.staffProfile.findUnique(),
      prisma.providerStaff.findMany(),
      prisma.identityPreference.findUnique(),
      service.flexPayrollEnabled(),
    ]);
    return {
      enterprise,
      providerApps,
      staffProfile,
      staffOf,
      pref: pref
        ? {
            userId: id,
            currentIdentity: pref.currentIdentity,
            updatedAt: new Date(),
          }
        : null,
      directory: null,
      flexPayrollEnabled,
    };
  });
  return {
    service,
    prisma,
    users,
    user: new CurrentUser(userId, 'identity-test', role),
    setPreference: (identity: string) => {
      preference = { currentIdentity: identity };
    },
  };
}

describe('administrator business identity switching', () => {
  const originalAdminIds = process.env.ADMIN_USER_IDS;
  const identities = [...BUSINESS_IDENTITIES, 'PLATFORM_ADMIN'];

  beforeEach(() => {
    delete process.env.ADMIN_USER_IDS;
  });

  afterEach(() => {
    if (originalAdminIds === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = originalAdminIds;
  });

  it.each(['admin', 'super', 'allowlisted'])(
    '%s can switch all identities without business qualifications',
    async (kind) => {
      const { service, user, prisma } = setup(
        kind === 'allowlisted' ? 'user' : kind,
      );
      if (kind === 'allowlisted') {
        process.env.ADMIN_USER_IDS = ` another-user, ${user.userId} `;
      }

      expect(await service.me(user)).toMatchObject({
        roles: identities,
        identities,
        currentIdentity: 'PLATFORM_ADMIN',
        qualified: {
          ENTERPRISE_USER: false,
          SERVICE_PROVIDER: false,
          PROVIDER_STAFF: false,
        },
        enterprise: null,
        providerApps: [],
        staffProfile: null,
        staffOf: [],
      });

      for (const identity of identities) {
        expect(await service.switchIdentity(user, identity)).toEqual({
          currentIdentity: identity,
          identities,
        });
        expect(await service.currentIdentity(user)).toBe(identity);
        expect(await service.me(user)).toMatchObject({
          currentIdentity: identity,
          roles: identities,
          identities,
        });
        expect(() => service.requireAdmin(user)).not.toThrow();
        await expect(
          service.requireRoles(user, identity),
        ).resolves.toMatchObject({ roles: identities });
      }
      expect(prisma.identityPreference.upsert).toHaveBeenCalledTimes(4);
    },
  );

  it('rejects unknown identities even for administrators', async () => {
    const { service, user, prisma } = setup('admin');
    await expect(service.switchIdentity(user, 'ROOT')).rejects.toThrow(
      '不可切换',
    );
    expect(prisma.identityPreference.upsert).not.toHaveBeenCalled();
  });

  it.each(identities)(
    'does not let an unqualified ordinary account switch to %s',
    async (identity) => {
      const { service, user, prisma } = setup();
      await expect(service.switchIdentity(user, identity)).rejects.toThrow(
        '不可切换',
      );
      expect(prisma.identityPreference.upsert).not.toHaveBeenCalled();
    },
  );

  it('preserves switching among actually qualified identities for ordinary accounts', async () => {
    const { service, user, prisma } = setup();
    prisma.enterpriseProfile.findFirst.mockResolvedValue({ id: 1 });
    prisma.providerApplication.findMany.mockResolvedValue([
      { status: 'APPROVED', providerType: 'TAX_FINANCE', serviceItems: '' },
    ] as never);
    prisma.providerStaff.findMany.mockResolvedValue([
      { providerUserId: 'provider', status: 'ACTIVE' },
    ] as never);

    for (const identity of BUSINESS_IDENTITIES) {
      await service.switchIdentity(user, identity);
      expect(await service.currentIdentity(user)).toBe(identity);
      expect(await service.me(user)).toMatchObject({
        currentIdentity: identity,
        identities: [...BUSINESS_IDENTITIES],
        qualified: {
          ENTERPRISE_USER: true,
          SERVICE_PROVIDER: true,
          PROVIDER_STAFF: true,
        },
      });
    }
    await expect(
      service.switchIdentity(user, 'PLATFORM_ADMIN'),
    ).rejects.toThrow('不可切换');
  });

  it.each(identities)(
    'ignores a saved %s preference after administrator access is revoked',
    async (identity) => {
      const { service, user, prisma } = setup();
      process.env.ADMIN_USER_IDS = user.userId;
      await service.switchIdentity(user, identity);
      delete process.env.ADMIN_USER_IDS;
      prisma.enterpriseProfile.findFirst.mockResolvedValue({ id: 1 });

      expect(await service.currentIdentity(user)).toBe('ENTERPRISE_USER');
      expect(await service.me(user)).toMatchObject({
        currentIdentity: 'ENTERPRISE_USER',
        roles: ['ENTERPRISE_USER'],
        identities: ['ENTERPRISE_USER'],
      });
      expect(() => service.requireAdmin(user)).toThrow('需要平台管理员');
      await expect(
        service.requireRoles(user, 'SERVICE_PROVIDER', 'PROVIDER_STAFF'),
      ).rejects.toThrow('需要身份');
    },
  );

  it('discards a saved identity when an ordinary account loses its qualification', async () => {
    const { service, user, prisma, setPreference } = setup();
    prisma.enterpriseProfile.findFirst.mockResolvedValue({ id: 1 });
    setPreference('SERVICE_PROVIDER');
    expect(await service.currentIdentity(user)).toBe('ENTERPRISE_USER');
    expect(await service.hasRole(user, 'SERVICE_PROVIDER')).toBe(false);
  });
});

describe('identity startup checks', () => {
  it('starts qualifications and platform settings while account validation is pending', async () => {
    const { service, user, prisma, users } = setup();
    let finish!: (directory: { username: string; displayName: string }) => void;
    users.requireActiveUser.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let completed = false;
    const response = service.me(user).then((value) => {
      completed = true;
      return value;
    });
    expect(prisma.enterpriseProfile.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(completed).toBe(false);
    finish({ username: 'unit', displayName: 'Unit User' });
    await expect(response).resolves.toMatchObject({
      username: 'unit',
      platformFlags: { flexPayrollEnabled: false },
    });
  });

  it('never returns an identity after account validation fails', async () => {
    const { service, user, users } = setup('admin');
    users.requireActiveUser.mockRejectedValue(new Error('user disabled'));
    await expect(service.me(user)).rejects.toThrow('user disabled');
  });

  it('requires successful qualification and platform flag queries', async () => {
    const { service, user, prisma } = setup();
    prisma.enterpriseProfile.findFirst.mockRejectedValue(
      new Error('qualifications unavailable'),
    );
    await expect(service.me(user)).rejects.toThrow(
      'qualifications unavailable',
    );
    prisma.enterpriseProfile.findFirst.mockResolvedValue(null);
    prisma.systemSetting.findUnique.mockRejectedValue(
      new Error('settings unavailable'),
    );
    await expect(service.me(user)).rejects.toThrow('settings unavailable');
  });
});
