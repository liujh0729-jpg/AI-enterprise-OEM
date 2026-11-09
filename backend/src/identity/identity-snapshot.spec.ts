import { readIdentitySnapshot } from './identity-snapshot';
import {
  runInRequestContext,
  clearRequestMemo,
  isIdentityWrite,
} from '../common/request-context';
import { FLEX_PAYROLL_ENABLED_KEY } from '../common/constants';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';

/** 按当前实现（Prisma 委托）构造最小桩：七个身份依据读取各一条。 */
function setup() {
  const enterprise = {
    id: 1,
    userId: 'snapshot-unit',
    status: 'APPROVED',
    name: 'unit enterprise',
  };
  const providerApps = [
    {
      id: 2,
      userId: 'snapshot-unit',
      status: 'APPROVED',
      providerType: 'TAX_FINANCE',
      serviceItems: '',
    },
  ];
  const staffProfile = { id: 3, userId: 'snapshot-unit' };
  const staffOf = [{ id: 4, staffUserId: 'snapshot-unit', status: 'ACTIVE' }];
  const pref = {
    id: 5,
    userId: 'snapshot-unit',
    currentIdentity: 'SERVICE_PROVIDER',
  };
  const directory = {
    id: 6,
    userId: 'snapshot-unit',
    username: 'unit',
    enabled: true,
  };
  const prisma = {
    enterpriseProfile: { findFirst: jest.fn().mockResolvedValue(enterprise) },
    providerApplication: {
      findMany: jest.fn().mockResolvedValue(providerApps),
    },
    staffProfile: { findUnique: jest.fn().mockResolvedValue(staffProfile) },
    providerStaff: { findMany: jest.fn().mockResolvedValue(staffOf) },
    identityPreference: { findUnique: jest.fn().mockResolvedValue(pref) },
    userDirectory: { findUnique: jest.fn().mockResolvedValue(directory) },
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  return {
    prisma,
    rows: { enterprise, providerApps, staffProfile, staffOf, pref, directory },
  };
}

describe('identity snapshot', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    'EnterpriseProfile',
    'ProviderApplication',
    'StaffProfile',
    'ProviderStaff',
    'IdentityPreference',
    'UserDirectory',
    'SystemSetting',
  ])('invalidates the request snapshot when %s changes', (name) => {
    expect(isIdentityWrite(name, 'update')).toBe(true);
    expect(isIdentityWrite(name, 'deleteMany')).toBe(true);
    expect(isIdentityWrite(name, 'findUnique')).toBe(false);
  });

  it('assembles every identity basis and defaults the payroll flag to enabled', async () => {
    const { prisma, rows } = setup();
    const snapshot = await runInRequestContext(() =>
      readIdentitySnapshot(stub<PrismaService>(prisma), 'snapshot-unit'),
    );
    expect(snapshot).toEqual({
      ...rows,
      // 无 system_setting 行即视为启用；只有显式 'false' 才关闭。
      flexPayrollEnabled: true,
    });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({
      where: { key: FLEX_PAYROLL_ENABLED_KEY },
      select: { value: true },
    });
    expect(prisma.enterpriseProfile.findFirst).toHaveBeenCalledWith({
      where: { userId: 'snapshot-unit', status: 'APPROVED' },
      orderBy: { id: 'desc' },
    });
  });

  it('disables the payroll flag only when the setting row is explicitly false', async () => {
    const { prisma } = setup();
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'false' });
    const snapshot = await runInRequestContext(() =>
      readIdentitySnapshot(stub<PrismaService>(prisma), 'snapshot-unit'),
    );
    expect(snapshot.flexPayrollEnabled).toBe(false);
  });

  it('shares the snapshot only within one request and reloads after an identity write', async () => {
    const { prisma } = setup();
    await runInRequestContext(async () => {
      const first = readIdentitySnapshot(
        stub<PrismaService>(prisma),
        'snapshot-unit',
      );
      expect(
        readIdentitySnapshot(stub<PrismaService>(prisma), 'snapshot-unit'),
      ).toBe(first);
      await first;
      clearRequestMemo();
      await readIdentitySnapshot(stub<PrismaService>(prisma), 'snapshot-unit');
    });
    await runInRequestContext(() =>
      readIdentitySnapshot(stub<PrismaService>(prisma), 'snapshot-unit'),
    );
    expect(prisma.enterpriseProfile.findFirst).toHaveBeenCalledTimes(3);
  });

  it('does not retain failed snapshots and retries on the next read', async () => {
    const { prisma } = setup();
    prisma.enterpriseProfile.findFirst.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await runInRequestContext(async () => {
      await expect(
        readIdentitySnapshot(stub<PrismaService>(prisma), 'snapshot-unit'),
      ).rejects.toThrow('database unavailable');
      await expect(
        readIdentitySnapshot(stub<PrismaService>(prisma), 'snapshot-unit'),
      ).resolves.toMatchObject({ flexPayrollEnabled: true });
    });
    expect(prisma.enterpriseProfile.findFirst).toHaveBeenCalledTimes(2);
  });
});
