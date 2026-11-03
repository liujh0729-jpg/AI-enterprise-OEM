import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';

export type OrgKey = { orgType: string; orgUserId: string };

/**
 * 一个账号所属的全部组织：在职机构（org_staff）+ 旧服务商挂靠 + 本人企业 / 本人服务商。
 * IM 连接与 SNS 私信都按这份组织范围判定「谁能管谁」，只在这里实现一次。
 */
export async function listMyOrgs(
  prisma: PrismaService,
  identity: IdentityService,
  userId: string,
): Promise<OrgKey[]> {
  const [staff, legacy, q] = await Promise.all([
    prisma.orgStaff.findMany({
      where: { memberUserId: userId, status: 'ACTIVE' },
      select: { orgType: true, orgUserId: true },
    }),
    prisma.providerStaff.findMany({
      where: { staffUserId: userId, status: 'ACTIVE' },
      select: { providerUserId: true },
    }),
    identity.qualifications(userId),
  ]);
  const map = new Map<string, OrgKey>();
  const add = (orgType: string, orgUserId: string) => {
    if (orgUserId) map.set(`${orgType}:${orgUserId}`, { orgType, orgUserId });
  };
  for (const row of staff) add(row.orgType, row.orgUserId);
  for (const row of legacy) add('PROVIDER', row.providerUserId);
  if (q.enterprise) add('ENTERPRISE', userId);
  if (q.providerApps.some((item) => item.status === 'APPROVED'))
    add('PROVIDER', userId);
  return [...map.values()];
}
