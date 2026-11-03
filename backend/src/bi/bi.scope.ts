import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { PrismaService } from '../prisma/prisma.service';

export type BiRole = 'ADMIN' | 'EDITOR' | 'ANALYST' | 'VIEWER' | '';
export type BiAction = 'read' | 'write' | 'editor' | 'admin' | 'ask';

const ROLE_ACTIONS: Record<Exclude<BiRole, ''>, BiAction[]> = {
  ADMIN: ['read', 'write', 'editor', 'admin', 'ask'],
  EDITOR: ['read', 'write', 'editor', 'ask'],
  ANALYST: ['read', 'ask'],
  VIEWER: ['read', 'ask'],
};

export type BiContext = {
  ownerUserId: string;
  actorId: string;
  role: BiRole;
  isOwner: boolean;
  isMember: boolean;
  isAdmin: boolean;
};

export type BiStaff = {
  memberUserId: string;
  name: string;
  memberKind: string;
  memberKindLabel: string;
  department: string;
};

export const BI_ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理员',
  EDITOR: '编辑',
  ANALYST: '分析',
  VIEWER: '只读',
  '': '未授权',
};

/**
 * BI 账号与权限：成员来自本账号「职员与代理人」唯一一套人；
 * 与 CRM 一样按账号统一，企业/服务商身份切换不换人。
 */
export class BiScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
  ) {}

  async context(user: CurrentUser): Promise<BiContext> {
    const owner = await this.ownerOf(user.userId);
    if (!owner || owner === user.userId) {
      return {
        ownerUserId: user.userId,
        actorId: user.userId,
        role: 'ADMIN',
        isOwner: true,
        isMember: true,
        isAdmin: true,
      };
    }
    const member = await this.prisma.biMember.findUnique({
      where: {
        ownerUserId_memberUserId: {
          ownerUserId: owner,
          memberUserId: user.userId,
        },
      },
    });
    if (!member || member.status !== 'ACTIVE') {
      return {
        ownerUserId: owner,
        actorId: user.userId,
        role: '',
        isOwner: false,
        isMember: false,
        isAdmin: false,
      };
    }
    const role = (member.role as BiRole) || 'ANALYST';
    return {
      ownerUserId: owner,
      actorId: user.userId,
      role,
      isOwner: false,
      isMember: true,
      isAdmin: role === 'ADMIN',
    };
  }

  private async ownerOf(userId: string) {
    const [orgOwner, providerOwner, member] = await Promise.all([
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
        select: { orgUserId: true },
      }),
    ]);
    if (orgOwner || providerOwner) return userId;
    if (member?.orgUserId) return member.orgUserId;
    const providerMember = await this.prisma.providerStaff.findFirst({
      where: { staffUserId: userId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      select: { providerUserId: true },
    });
    return providerMember?.providerUserId || userId;
  }

  async requireMember(user: CurrentUser) {
    const ctx = await this.context(user);
    if (!ctx.isMember) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '你还没有被加入本账号的 BI，请联系管理员添加成员权限',
      );
    }
    return ctx;
  }

  assertCan(ctx: BiContext, action: BiAction) {
    if (ctx.isAdmin) return;
    const allowed = ROLE_ACTIONS[ctx.role as Exclude<BiRole, ''>] || [];
    if (!allowed.includes(action)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `当前 BI 权限（${ctx.role || '未授权'}）不能执行该操作`,
      );
    }
  }

  assertAdmin(ctx: BiContext) {
    if (!ctx.isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有 BI 管理员可以执行该操作',
      );
    }
  }

  async staff(ownerUserId: string): Promise<BiStaff[]> {
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
    const merged = new Map<string, BiStaff>();
    for (const row of orgRows) {
      merged.set(row.memberUserId, {
        memberUserId: row.memberUserId,
        name: '',
        memberKind: row.memberKind || 'STAFF',
        memberKindLabel: row.memberKind === 'AGENT' ? '代理人' : '职员',
        department: row.department || '',
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
      });
    }
    const rows = [...merged.values()];
    const names = await this.names(rows.map((row) => row.memberUserId));
    return rows.map((row) => ({
      ...row,
      name: names.get(row.memberUserId) || row.memberUserId,
    }));
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
