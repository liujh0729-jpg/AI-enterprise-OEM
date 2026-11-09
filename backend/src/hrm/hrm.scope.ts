import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import type { IdentityService } from '../identity/identity.service';
import type { PrismaService } from '../prisma/prisma.service';
import { orgKeyOf } from './hrm.helpers';

/**
 * HRM 组织归属（方案 §5.1）：数据一律挂在 (orgType, orgUserId) 组织键下。
 * 口径优先级＝自己是主账号的组织 → 自己在册的 ACTIVE 成员组织 → 个人自组织兜底
 * （多组织切换器属 §5.8 机制，业务侧接入后只需在此处加一个 query 参数）。
 * 管理员（HR 权限）＝组织主账号 / 平台管理员 / 成员 roles 含 HR·ADMIN。
 */

export type HrmOrg = {
  orgType: string;
  orgUserId: string;
  actorId: string;
  isOwner: boolean;
  isAdmin: boolean;
  department: string;
};

const HR_ROLE_KEYS = ['HR', 'ADMIN', 'OWNER', 'HUMAN_RESOURCE'];

const asRoles = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).toUpperCase()).filter(Boolean) : [];

export class HrmScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async resolve(user: CurrentUser): Promise<HrmOrg> {
    const actorId = user.userId;
    const platformAdmin = user.isAdmin() || this.identity.isPlatformAdmin(user);
    // 主体切换器（B3#29）：用户显式选择过组织且关系仍有效时优先用它；
    // 关系失效（被移除/组织不存在）则静默回落到默认口径，不阻断业务。
    const preferred = await this.prisma.userOrgContext.findUnique({
      where: { userId: actorId },
      select: { orgType: true, orgUserId: true },
    });
    if (preferred?.orgUserId) {
      if (preferred.orgUserId === actorId) {
        const ownedOrg = await this.prisma.orgStaff.findFirst({
          where: { orgType: preferred.orgType, orgUserId: actorId },
          select: { orgType: true, orgUserId: true },
        });
        if (ownedOrg) {
          const self = await this.prisma.orgStaff.findFirst({
            where: {
              orgType: preferred.orgType,
              orgUserId: actorId,
              memberUserId: actorId,
            },
            select: { department: true },
          });
          return {
            orgType: preferred.orgType,
            orgUserId: actorId,
            actorId,
            isOwner: true,
            isAdmin: true,
            department: self?.department || '',
          };
        }
      } else {
        const member = await this.prisma.orgStaff.findFirst({
          where: {
            orgType: preferred.orgType,
            orgUserId: preferred.orgUserId,
            memberUserId: actorId,
            status: 'ACTIVE',
          },
        });
        if (member) {
          const roles = asRoles(member.roles);
          return {
            orgType: preferred.orgType,
            orgUserId: preferred.orgUserId,
            actorId,
            isOwner: false,
            isAdmin:
              platformAdmin || roles.some((r) => HR_ROLE_KEYS.includes(r)),
            department: member.department || '',
          };
        }
      }
    }
    const [owned, memberships] = await Promise.all([
      this.prisma.orgStaff.findFirst({
        where: { orgUserId: actorId, orgType: 'ENTERPRISE' },
        orderBy: { id: 'asc' },
        select: { orgType: true, orgUserId: true },
      }),
      this.prisma.orgStaff.findMany({
        where: { memberUserId: actorId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
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
        isAdmin: true,
        department: self?.department || '',
      };
    }
    const joined = memberships[0];
    if (joined) {
      const roles = asRoles(joined.roles);
      return {
        orgType: joined.orgType,
        orgUserId: joined.orgUserId,
        actorId,
        isOwner: false,
        isAdmin: platformAdmin || roles.some((r) => HR_ROLE_KEYS.includes(r)),
        department: joined.department || '',
      };
    }
    // 兜底：没有任何组织关系的账号，HRM 数据落在自己名下（个人自组织）。
    return {
      ...orgKeyOf(user),
      actorId,
      isOwner: true,
      isAdmin: platformAdmin,
      department: '',
    };
  }

  requireAdmin(org: HrmOrg) {
    if (!org.isAdmin) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该操作需要组织 HR 管理员（主账号或 HR/ADMIN 角色成员）',
      );
    }
  }

  /** 组织在册成员（含主账号本人）：档案/请假/面试参与人的合法候选集。 */
  async memberUserIds(org: HrmOrg): Promise<string[]> {
    const rows = await this.prisma.orgStaff.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        status: 'ACTIVE',
      },
      select: { memberUserId: true },
    });
    return [
      ...new Set([org.orgUserId, ...rows.map((row) => row.memberUserId)]),
    ];
  }

  /**
   * 解析被操作成员：主账号本人或本组织在册成员；
   * 非管理员只能操作本人（代录他人档案/假勤需要 HR 权限）。
   */
  async requireStaff(org: HrmOrg, staffUserId: string, allowSelfOnly: boolean) {
    const target = String(staffUserId || '').trim();
    if (!target) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请指定成员账号');
    }
    if (allowSelfOnly && target !== org.actorId) {
      this.requireAdmin(org);
    }
    if (target === org.orgUserId) return target;
    const row = await this.prisma.orgStaff.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
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

  /** 账号展示名（username / 实名兜底到 id），供列表视图补 name。 */
  async names(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const numeric = unique.map((v) => Number(v)).filter(Number.isInteger);
    const rows = await this.prisma.account.findMany({
      where: { id: { in: numeric } },
      select: { id: true, username: true },
    });
    const byId = new Map(rows.map((row) => [String(row.id), row.username]));
    return new Map(unique.map((id) => [id, byId.get(id) || id]));
  }
}
