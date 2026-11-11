import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 统一租户键 (orgType, orgUserId)：所有「组织内共享」的数据都挂在这对键下。
 * 历史模块（CRM/OKR/服务台）按 ownerUserId 归属，本次升级补上组织键后，
 * 取组织只走本服务，避免每个模块各写一套「我是谁的企业/服务商」。
 */
export type Tenant = {
  orgType: string;
  orgUserId: string;
  actorId: string;
  isOwner: boolean;
  roles: string[];
  department: string;
};

export const tenantKey = (orgType: string, orgUserId: string) => ({
  orgType,
  orgUserId,
});

const asRoles = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item).toUpperCase()).filter(Boolean)
    : [];

/**
 * 口径优先级：
 * 1. 主体切换器选过且关系仍有效 → 用它
 * 2. 自己名下的企业组织 → 用它
 * 3. 自己在册的 ACTIVE 成员组织 → 用它
 * 4. 旧 provider_staff 挂靠 → 用它
 * 5. 都没有 → 个人自组织（ENTERPRISE + 自己）
 */
export class TenantScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 主体切换器选过且关系仍有效时的组织归属；否则 null。
   * CRM / BI / OA 等按组织归属的模块统一用它做「当前主体」，避免各写一套选择逻辑。
   */
  async preferred(userId: string): Promise<Tenant | null> {
    const row = await this.prisma.userOrgContext.findUnique({
      where: { userId },
      select: { orgType: true, orgUserId: true },
    });
    if (!row?.orgUserId || !row.orgType) return null;
    const valid = await this.stillValid(row.orgType, row.orgUserId, userId);
    return valid ? { ...valid, actorId: userId } : null;
  }

  async resolve(user: CurrentUser): Promise<Tenant> {
    const actorId = user.userId;
    const preferred = await this.preferred(actorId);
    if (preferred) return preferred;

    const [owned, memberships, legacy] = await Promise.all([
      this.prisma.orgStaff.findFirst({
        where: { orgUserId: actorId, orgType: 'ENTERPRISE', status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      }),
      this.prisma.orgStaff.findMany({
        where: { memberUserId: actorId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      }),
      this.prisma.providerStaff.findFirst({
        where: { staffUserId: actorId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        select: { providerUserId: true },
      }),
    ]);
    if (owned) {
      const self = memberships.find(
        (row) =>
          row.orgType === owned.orgType && row.orgUserId === owned.orgUserId,
      );
      return {
        orgType: owned.orgType,
        orgUserId: owned.orgUserId,
        actorId,
        isOwner: true,
        roles: self ? asRoles(self.roles) : ['ADMIN'],
        department: self?.department || '',
      };
    }
    const joined = memberships[0];
    if (joined) {
      return {
        orgType: joined.orgType,
        orgUserId: joined.orgUserId,
        actorId,
        isOwner: false,
        roles: asRoles(joined.roles),
        department: joined.department || '',
      };
    }
    if (legacy?.providerUserId) {
      const self = await this.prisma.providerStaff.findFirst({
        where: {
          providerUserId: legacy.providerUserId,
          staffUserId: actorId,
          status: 'ACTIVE',
        },
        select: { roles: true },
      });
      return {
        orgType: 'PROVIDER',
        orgUserId: legacy.providerUserId,
        actorId,
        isOwner: false,
        roles: asRoles(self?.roles),
        department: '',
      };
    }
    return {
      orgType: 'ENTERPRISE',
      orgUserId: actorId,
      actorId,
      isOwner: true,
      roles: ['ADMIN'],
      department: '',
    };
  }

  private async stillValid(
    orgType: string,
    orgUserId: string,
    actorId: string,
  ): Promise<Omit<Tenant, 'actorId'> | null> {
    if (orgUserId === actorId) {
      const owned = await this.prisma.orgStaff.findFirst({
        where: { orgType, orgUserId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!owned) return null;
      const self = await this.prisma.orgStaff.findFirst({
        where: { orgType, orgUserId, memberUserId: actorId },
        select: { department: true },
      });
      return {
        orgType,
        orgUserId,
        isOwner: true,
        roles: ['ADMIN'],
        department: self?.department || '',
      };
    }
    const member = await this.prisma.orgStaff.findFirst({
      where: { orgType, orgUserId, memberUserId: actorId, status: 'ACTIVE' },
    });
    if (member) {
      return {
        orgType,
        orgUserId,
        isOwner: false,
        roles: asRoles(member.roles),
        department: member.department || '',
      };
    }
    if (orgType !== 'PROVIDER') return null;
    const legacy = await this.prisma.providerStaff.findFirst({
      where: {
        providerUserId: orgUserId,
        staffUserId: actorId,
        status: 'ACTIVE',
      },
    });
    if (!legacy) return null;
    return {
      orgType: 'PROVIDER',
      orgUserId,
      isOwner: false,
      roles: asRoles(legacy.roles),
      department: legacy.department || '',
    };
  }

  /** 查询条件：组织键统一从这里取，避免手写时漏掉一侧。 */
  where(tenant: Tenant) {
    return { orgType: tenant.orgType, orgUserId: tenant.orgUserId };
  }

  /** 组织在册成员（含主账号本人）。 */
  async memberIds(tenant: Tenant): Promise<string[]> {
    const rows = await this.prisma.orgStaff.findMany({
      where: {
        orgType: tenant.orgType,
        orgUserId: tenant.orgUserId,
        status: 'ACTIVE',
      },
      select: { memberUserId: true },
    });
    return [
      ...new Set([tenant.orgUserId, ...rows.map((row) => row.memberUserId)]),
    ];
  }

  /** 目标账号必须是本组织在册成员（或主账号本人）。 */
  async requireMember(tenant: Tenant, memberUserId: string): Promise<string> {
    const target = String(memberUserId || '').trim();
    if (!target) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请指定成员账号');
    }
    if (target === tenant.orgUserId || target === tenant.actorId) return target;
    const row = await this.prisma.orgStaff.findFirst({
      where: {
        orgType: tenant.orgType,
        orgUserId: tenant.orgUserId,
        memberUserId: target,
        status: 'ACTIVE',
      },
      select: { memberUserId: true },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该账号不是本组织在册成员，请先在「职员与代理人」加入组织',
      );
    }
    return row.memberUserId;
  }
}
