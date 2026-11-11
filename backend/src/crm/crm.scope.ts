import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantScopeService } from '../tenant/tenant-scope.service';
import { Prisma } from '../../generated/prisma';

/**
 * 数据范围裁剪后的 where 片段。字段与 crm_* 表一致，可直接展开进各模型的
 * `XWhereInput`；不用 `Record<string, unknown>` 是为了让调用点保持类型检查。
 */
export type CrmScopeWhere = {
  ownerUserId: string;
  ownerId?: string | Prisma.StringFilter;
  createdBy?: string | Prisma.StringFilter;
};

export type CrmRole =
  'ADMIN' | 'MANAGER' | 'SALES' | 'FINANCE' | 'READONLY' | '';
export type CrmAction =
  | 'read'
  | 'write'
  | 'delete'
  | 'transfer'
  | 'merge'
  | 'pick'
  | 'finance'
  | 'approve'
  | 'manage'
  | 'export'
  | 'import';

export type CrmContext = {
  ownerUserId: string;
  /** 统一租户键的组织侧；写入 crm_* 时与 ownerUserId 一起落库。 */
  orgType: string;
  actorId: string;
  role: CrmRole;
  dataScope: 'ALL' | 'DEPT' | 'SELF';
  department: string;
  isOwner: boolean;
  isMember: boolean;
  isAdmin: boolean;
};

const ROLE_ACTIONS: Record<Exclude<CrmRole, ''>, CrmAction[]> = {
  ADMIN: [
    'read',
    'write',
    'delete',
    'transfer',
    'merge',
    'pick',
    'finance',
    'approve',
    'manage',
    'export',
    'import',
  ],
  MANAGER: [
    'read',
    'write',
    'delete',
    'transfer',
    'merge',
    'pick',
    'approve',
    'export',
    'import',
  ],
  SALES: ['read', 'write', 'delete', 'pick', 'export'],
  FINANCE: ['read', 'finance', 'export'],
  READONLY: ['read'],
};

export type AccountStaffRow = {
  memberUserId: string;
  name: string;
  memberKind: string;
  memberKindLabel: string;
  department: string;
  roles: string[];
  source: 'ORG' | 'PROVIDER';
};

/**
 * CRM 账号与权限的唯一入口。
 * 账号级：ownerUserId 是这个 CRM 的归属账号（通常是当前客户组织的所有者）。
 * 成员：本账号「职员与代理人」中的唯一一套人（企业/服务商身份共用），角色固定五种。
 * 数据范围：ALL / DEPT / SELF，列表、详情、导出、报表、AI、MCP 全部经过 scopeWhere。
 */
export class CrmScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
    private readonly tenant?: TenantScopeService,
  ) {}

  async context(user: CurrentUser): Promise<CrmContext> {
    const owner = await this.ownerOf(user.userId);
    if (owner.orgUserId === user.userId) {
      return {
        ownerUserId: user.userId,
        orgType: owner.orgType,
        actorId: user.userId,
        role: 'ADMIN',
        dataScope: 'ALL',
        department: '',
        isOwner: true,
        isMember: true,
        isAdmin: true,
      };
    }
    const member = await this.prisma.crmMember.findUnique({
      where: {
        ownerUserId_memberUserId: {
          ownerUserId: owner.orgUserId,
          memberUserId: user.userId,
        },
      },
    });
    if (!member || member.status !== 'ACTIVE') {
      return {
        ownerUserId: owner.orgUserId,
        orgType: owner.orgType,
        actorId: user.userId,
        role: '',
        dataScope: 'SELF',
        department: '',
        isOwner: false,
        isMember: false,
        isAdmin: false,
      };
    }
    const role = (member.role as CrmRole) || 'SALES';
    return {
      ownerUserId: owner.orgUserId,
      orgType: owner.orgType,
      actorId: user.userId,
      role,
      dataScope: (member.dataScope as CrmContext['dataScope']) || 'SELF',
      department: member.department,
      isOwner: false,
      isMember: true,
      isAdmin: role === 'ADMIN',
    };
  }

  /**
   * 当前用户自己的组织归属。优先采用主体切换器选定的组织（与 HRM/OKR 同一口径，
   * 见 tenant-scope.service）；未选择时才按「自己是主账号的组织 → 所属 ACTIVE 成员组织」。
   */
  private async ownerOf(
    userId: string,
  ): Promise<{ orgType: string; orgUserId: string }> {
    const preferred = await this.tenant?.preferred(userId);
    if (preferred)
      return { orgType: preferred.orgType, orgUserId: preferred.orgUserId };
    const [orgOwner, providerOwner, enterpriseOwner] = await Promise.all([
      this.prisma.orgStaff.findFirst({
        where: { orgUserId: userId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.providerStaff.findFirst({
        where: { providerUserId: userId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.orgStaff.findFirst({
        where: { memberUserId: userId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        select: { orgType: true, orgUserId: true },
      }),
    ]);
    if (orgOwner) return { orgType: 'ENTERPRISE', orgUserId: userId };
    if (providerOwner) return { orgType: 'PROVIDER', orgUserId: userId };
    if (enterpriseOwner?.orgUserId) {
      return {
        orgType: enterpriseOwner.orgType || 'ENTERPRISE',
        orgUserId: enterpriseOwner.orgUserId,
      };
    }
    const providerMember = await this.prisma.providerStaff.findFirst({
      where: { staffUserId: userId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      select: { providerUserId: true },
    });
    return {
      orgType: 'PROVIDER',
      orgUserId: providerMember?.providerUserId || userId,
    };
  }

  /** 写入 crm_* 时的统一租户键。 */
  orgKey(ctx: CrmContext) {
    return { orgType: ctx.orgType, orgUserId: ctx.ownerUserId };
  }

  async requireMember(user: CurrentUser) {
    const ctx = await this.context(user);
    if (!ctx.isMember) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '你还没有被加入本账号的 CRM，请联系负责人添加成员权限',
      );
    }
    return ctx;
  }

  assertCan(ctx: CrmContext, action: CrmAction) {
    if (ctx.isAdmin) return;
    const allowed = ROLE_ACTIONS[ctx.role as Exclude<CrmRole, ''>] || [];
    if (!allowed.includes(action)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `当前角色（${ctx.role || '未授权'}）不能执行该操作`,
      );
    }
  }

  assertAdmin(ctx: CrmContext) {
    if (!ctx.isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有 CRM 负责人可以执行该操作',
      );
    }
  }

  /** 数据范围裁剪：所有业务查询的唯一入口。 */
  async scopeWhereAsync(
    ctx: CrmContext,
    kind: 'CORE' | 'FINANCE' = 'CORE',
    ownerField: 'ownerId' | 'createdBy' = 'ownerId',
  ): Promise<CrmScopeWhere> {
    const base: CrmScopeWhere = { ownerUserId: ctx.ownerUserId };
    if (ctx.isAdmin || ctx.role === 'MANAGER' || ctx.dataScope === 'ALL')
      return base;
    if (kind === 'FINANCE' && ctx.role === 'FINANCE') return base;
    if (ctx.dataScope === 'DEPT' && ctx.department) {
      const ids = await this.departmentMembers(ctx.ownerUserId, ctx.department);
      const filter = { in: [...new Set([...ids, ctx.actorId])] };
      return ownerField === 'createdBy'
        ? { ...base, createdBy: filter }
        : { ...base, ownerId: filter };
    }
    return ownerField === 'createdBy'
      ? { ...base, createdBy: ctx.actorId }
      : { ...base, ownerId: ctx.actorId };
  }

  /**
   * 用户输入的负责人筛选是否落在授权范围内。筛选只能与授权范围取交集，
   * 不能覆盖它（设计方案 §3.3）：不在范围内即视为空集，交由调用方返回空结果。
   */
  ownerInScope(scope: CrmScopeWhere['ownerId'], ownerId: string): boolean {
    if (scope === undefined) return true;
    if (typeof scope === 'string') return scope === ownerId;
    const list = scope.in;
    if (!Array.isArray(list)) return false;
    return list.some((item) => text(item) === ownerId);
  }

  async departmentMembers(ownerUserId: string, department: string) {
    const rows = await this.prisma.crmMember.findMany({
      where: { ownerUserId, department, status: 'ACTIVE' },
      select: { memberUserId: true },
    });
    return rows.map((row) => row.memberUserId);
  }

  async members(ownerUserId: string) {
    return this.prisma.crmMember.findMany({
      where: { ownerUserId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
  }

  /** 本账号职员与代理人的唯一一套人：org_staff（企业/服务商）= 旧 provider_staff 去重合并。 */
  async accountStaff(ownerUserId: string): Promise<AccountStaffRow[]> {
    const [orgRows, providerRows] = await Promise.all([
      this.prisma.orgStaff.findMany({
        where: { orgUserId: ownerUserId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      }),
      this.prisma.providerStaff.findMany({
        where: { providerUserId: ownerUserId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      }),
    ]);
    const merged = new Map<string, AccountStaffRow>();
    for (const row of orgRows) {
      merged.set(row.memberUserId, {
        memberUserId: row.memberUserId,
        name: '',
        memberKind: row.memberKind || 'STAFF',
        memberKindLabel: row.memberKind === 'AGENT' ? '代理人' : '职员',
        department: row.department || '',
        roles: Array.isArray(row.roles)
          ? row.roles.map((item) => text(item)).filter(Boolean)
          : [],
        source: 'ORG',
      });
    }
    for (const row of providerRows) {
      if (merged.has(row.staffUserId)) continue;
      merged.set(row.staffUserId, {
        memberUserId: row.staffUserId,
        name: '',
        memberKind: 'STAFF',
        memberKindLabel: '职员',
        department: '',
        roles: Array.isArray(row.roles)
          ? row.roles.map((item) => text(item)).filter(Boolean)
          : text(row.roles)
              .split(/[,，\s]+/)
              .filter(Boolean),
        source: 'PROVIDER',
      });
    }
    const rows = [...merged.values()];
    if (!rows.length) return rows;
    const ids = rows.map((row) => row.memberUserId);
    const [directory, profiles] = await Promise.all([
      this.users.lookup(ids),
      this.prisma.staffProfile.findMany({ where: { userId: { in: ids } } }),
    ]);
    const dir = new Map(directory.map((item) => [item.id, item]));
    const prof = new Map(profiles.map((item) => [item.userId, item]));
    return rows.map((row) => {
      const account = dir.get(row.memberUserId);
      const profile = prof.get(row.memberUserId);
      return {
        ...row,
        name:
          text(profile?.realName) ||
          text(account?.displayName) ||
          text(account?.username) ||
          row.memberUserId,
      };
    });
  }

  async names(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const [directory, profiles] = await Promise.all([
      this.users.lookup(unique),
      this.prisma.staffProfile.findMany({ where: { userId: { in: unique } } }),
    ]);
    const dir = new Map(directory.map((item) => [item.id, item]));
    const prof = new Map(profiles.map((item) => [item.userId, item]));
    return new Map(
      unique.map((id) => {
        const account = dir.get(id);
        const profile = prof.get(id);
        return [
          id,
          text(profile?.realName) ||
            text(account?.displayName) ||
            text(account?.username) ||
            id,
        ];
      }),
    );
  }
}
