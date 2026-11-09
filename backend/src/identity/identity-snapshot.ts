import type {
  EnterpriseProfile,
  ProviderApplication,
  StaffProfile,
  ProviderStaff,
  IdentityPreference,
  UserDirectory,
} from '../../generated/prisma';
import type { PrismaService } from '../prisma/prisma.service';
import { requestMemo } from '../common/request-context';
import { FLEX_PAYROLL_ENABLED_KEY } from '../common/constants';

export interface IdentitySnapshot {
  enterprise: EnterpriseProfile | null;
  providerApps: ProviderApplication[];
  staffProfile: StaffProfile | null;
  staffOf: ProviderStaff[];
  pref: IdentityPreference | null;
  directory: UserDirectory | null;
  flexPayrollEnabled: boolean;
}

/** 一次读取完整身份依据；只在本次请求内复用，身份表写入仍会作废请求缓存。 */
export function readIdentitySnapshot(
  prisma: PrismaService,
  userId: string,
): Promise<IdentitySnapshot> {
  return requestMemo(`identity-snapshot:${userId}`, async () => {
    const [
      enterprise,
      providerApps,
      staffProfile,
      staffOf,
      pref,
      directory,
      setting,
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
        where: { key: FLEX_PAYROLL_ENABLED_KEY },
        select: { value: true },
      }),
    ]);
    return {
      enterprise,
      providerApps,
      staffProfile,
      staffOf,
      pref,
      directory,
      // 缺省（无该行）即启用：只有管理员显式停用（'false'）才不出现灵工发薪页签。
      flexPayrollEnabled: setting?.value !== 'false',
    };
  });
}
