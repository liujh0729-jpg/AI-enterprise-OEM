import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { PrismaService } from '../prisma/prisma.service';
import { asArray, int, jsonObject, roleLabel, statusLabel } from './oa.helpers';

export const OA_BUSINESS_SCOPE = 'OA';

const MEMBER_KIND_LABELS: Record<string, string> = {
  STAFF: '职员',
  AGENT: '代理人',
  OWNER: '组织主账号',
};

export type OaMemberRow = {
  userId: string;
  name: string;
  memberKind: string;
  memberKindLabel: string;
  department: string;
  positions: { name: string; description: string }[];
  roles: string[];
  roleLabels: string[];
};

export type OaSettingsValue = {
  adminUserIds: string[];
  deptHeads: Record<string, string>;
  remindAfterHours: number;
  allowWithdraw: boolean;
};

export type OaOrgOption = {
  orgType: string;
  orgUserId: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'AGENT';
  roleLabel: string;
};

export type OaContext = OaOrgOption & {
  actorId: string;
  isOwner: boolean;
  isAdmin: boolean;
  department: string;
  member: OaMemberRow | null;
  settings: OaSettingsValue;
};

export const defaultSettings = (): OaSettingsValue => ({
  adminUserIds: [],
  deptHeads: {},
  remindAfterHours: 24,
  allowWithdraw: true,
});

const ROLE_LABELS: Record<string, string> = {
  OWNER: '组织主账号',
  ADMIN: '组织管理员',
  MEMBER: '普通成员',
  AGENT: '代理人',
};

/**
 * OA 的组织归属与权限入口。
 * 组织＝org_staff 的 (orgType, orgUserId)；企业＝ENTERPRISE + 企业主账号，服务商＝PROVIDER + 服务商账号。
 * 代理人只有被勾了 OA 板块才算组织内的 OA 成员，外部顾问默认看不到内部审批。
 */
export class OaScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
  ) {}

  /** 当前账号可选的组织：自己是主账号的组织排前面，其次是 ACTIVE 成员关系。 */
  async organizations(user: CurrentUser): Promise<OaOrgOption[]> {
    const actorId = user.userId;
    const [staffRows, enterprise, providerApps] = await Promise.all([
      this.prisma.orgStaff.findMany({
        where: {
          OR: [{ orgUserId: actorId }, { memberUserId: actorId }],
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.enterpriseProfile.findFirst({
        where: { userId: actorId, status: 'APPROVED' },
        select: { name: true },
      }),
      this.prisma.providerApplication.findMany({
        where: { userId: actorId, status: 'APPROVED' },
        orderBy: { id: 'asc' },
        select: { orgName: true },
      }),
    ]);

    const keys = new Map<string, { orgType: string; orgUserId: string }>();
    const add = (orgType: string, orgUserId: string) => {
      if (!orgType || !orgUserId) return;
      keys.set(`${orgType}:${orgUserId}`, { orgType, orgUserId });
    };
    if (enterprise?.name) add('ENTERPRISE', actorId);
    if (providerApps.length) add('PROVIDER', actorId);
    for (const row of staffRows) {
      if (row.orgUserId === actorId) {
        add(row.orgType, row.orgUserId);
      } else if (row.memberUserId === actorId && row.status === 'ACTIVE') {
        const roles = asArray(row.roles);
        // 代理人不带 OA 板块就没有本组织的 OA 身份。
        if (row.memberKind === 'AGENT' && !roles.includes(OA_BUSINESS_SCOPE)) {
          continue;
        }
        add(row.orgType, row.orgUserId);
      }
    }
    if (!keys.size) return [];

    const orgIds = [...keys.values()].map((item) => item.orgUserId);
    const names = await this.orgNames(orgIds);
    const out: OaOrgOption[] = [];
    for (const item of keys.values()) {
      const isOwner = item.orgUserId === actorId;
      const memberRow = staffRows.find(
        (row) =>
          row.orgType === item.orgType &&
          row.orgUserId === item.orgUserId &&
          row.memberUserId === actorId,
      );
      const memberKind = memberRow?.memberKind || 'STAFF';
      const settings = await this.settings(item.orgType, item.orgUserId);
      const role = isOwner
        ? 'OWNER'
        : settings.adminUserIds.includes(actorId)
          ? 'ADMIN'
          : memberKind === 'AGENT'
            ? 'AGENT'
            : 'MEMBER';
      out.push({
        ...item,
        name: names.get(item.orgUserId) || item.orgUserId,
        role,
        roleLabel: ROLE_LABELS[role] || role,
      });
    }
    out.sort((a, b) => {
      const aOwn = a.orgUserId === actorId ? 0 : 1;
      const bOwn = b.orgUserId === actorId ? 0 : 1;
      return aOwn - bOwn || a.name.localeCompare(b.name);
    });
    return out;
  }

  /** 解析当前请求的组织：显式指定必须是自己的组织，否则按默认规则取。 */
  async resolve(
    user: CurrentUser,
    query: Record<string, unknown> = {},
  ): Promise<OaContext | null> {
    const orgs = await this.organizations(user);
    if (!orgs.length) return null;
    const orgType = text(query.orgType).trim().toUpperCase();
    const orgUserId = text(query.orgUserId).trim();
    const target =
      orgType && orgUserId
        ? orgs.find(
            (item) => item.orgType === orgType && item.orgUserId === orgUserId,
          )
        : orgs[0];
    if (!target) return null;
    const memberRow = await this.prisma.orgStaff.findFirst({
      where: {
        orgType: target.orgType,
        orgUserId: target.orgUserId,
        memberUserId: user.userId,
      },
    });
    const settings = await this.settings(target.orgType, target.orgUserId);
    const member = memberRow
      ? this.toMember(memberRow, await this.names([memberRow.memberUserId]))
      : null;
    const isOwner = target.orgUserId === user.userId;
    return {
      ...target,
      actorId: user.userId,
      isOwner,
      isAdmin: isOwner || settings.adminUserIds.includes(user.userId),
      department: memberRow?.department || '',
      member,
      settings,
    };
  }

  /** 业务端点统一入口：没有可用组织时给出引导文案。 */
  async context(
    user: CurrentUser,
    query: Record<string, unknown> = {},
  ): Promise<OaContext> {
    const orgType = text(query.orgType).trim().toUpperCase();
    const orgUserId = text(query.orgUserId).trim();
    const ctx = await this.resolve(user, query);
    if (ctx) return ctx;
    const hasOrgs = (await this.organizations(user)).length > 0;
    if (hasOrgs && orgType && orgUserId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '你不是该组织的成员，无法访问其 OA 数据',
      );
    }
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      'OA 按组织归属，请先在「身份与资质」完成企业或服务商认证，或在「职员与代理人」加入组织',
    );
  }

  requireAdmin(ctx: OaContext) {
    if (!ctx.isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有组织管理员可以执行该操作',
      );
    }
  }

  async settings(orgType: string, orgUserId: string): Promise<OaSettingsValue> {
    const row = await this.prisma.oaSettings.findUnique({
      where: { orgType_orgUserId: { orgType, orgUserId } },
    });
    const base = defaultSettings();
    if (!row) return base;
    const deptHeads: Record<string, string> = {};
    for (const [key, value] of Object.entries(jsonObject(row.deptHeads))) {
      const name = key.trim();
      const userId = text(value).trim();
      if (name && userId) deptHeads[name] = userId;
    }
    return {
      adminUserIds: asArray(row.adminUserIds),
      deptHeads,
      remindAfterHours: Math.min(
        Math.max(int(row.remindAfterHours, 24), 0),
        720,
      ),
      allowWithdraw: Boolean(row.allowWithdraw),
    };
  }

  async saveSettings(
    orgType: string,
    orgUserId: string,
    value: OaSettingsValue,
  ) {
    return this.prisma.oaSettings.upsert({
      where: { orgType_orgUserId: { orgType, orgUserId } },
      create: {
        orgType,
        orgUserId,
        adminUserIds: value.adminUserIds,
        deptHeads: value.deptHeads,
        remindAfterHours: value.remindAfterHours,
        allowWithdraw: value.allowWithdraw,
      },
      update: {
        adminUserIds: value.adminUserIds,
        deptHeads: value.deptHeads,
        remindAfterHours: value.remindAfterHours,
        allowWithdraw: value.allowWithdraw,
      },
    });
  }

  /** 组织成员（含主账号本人）：审批人解析、转交/加签候选、设置页清单同源。 */
  async members(ctx: OaContext): Promise<OaMemberRow[]> {
    const rows = await this.prisma.orgStaff.findMany({
      where: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        status: 'ACTIVE',
      },
      orderBy: { id: 'asc' },
    });
    const names = await this.names([
      ...rows.map((row) => row.memberUserId),
      ctx.orgUserId,
    ]);
    const list = rows.map((row) => this.toMember(row, names));
    if (list.some((item) => item.userId === ctx.orgUserId)) return list;
    return [
      {
        userId: ctx.orgUserId,
        name: names.get(ctx.orgUserId) || ctx.name,
        memberKind: 'OWNER',
        memberKindLabel: '组织主账号',
        department: '',
        positions: [],
        roles: [],
        roleLabels: [],
      },
      ...list,
    ];
  }

  private toMember(
    row: {
      memberUserId: string;
      memberKind: string;
      department: string;
      positions: unknown;
      roles: unknown;
    },
    names: Map<string, string>,
  ): OaMemberRow {
    const roles = asArray(row.roles);
    const memberKind = row.memberKind || 'STAFF';
    return {
      userId: row.memberUserId,
      name: names.get(row.memberUserId) || row.memberUserId,
      memberKind,
      memberKindLabel: statusLabel(MEMBER_KIND_LABELS, memberKind) || '职员',
      department: row.department || '',
      positions: Array.isArray(row.positions)
        ? row.positions
            .map((item) => {
              const position = jsonObject(item);
              const name = text(position.name).trim().slice(0, 64);
              return name
                ? {
                    name,
                    description: text(position.description)
                      .trim()
                      .slice(0, 500),
                  }
                : null;
            })
            .filter((item): item is { name: string; description: string } =>
              Boolean(item),
            )
            .slice(0, 5)
        : [],
      roles,
      roleLabels: roles.map((code) => roleLabel(code)),
    };
  }

  /** 审批人/转交目标必须仍是本组织 ACTIVE 成员（或组织主账号）。 */
  async requireOrgMember(ctx: OaContext, userId: string) {
    const target = text(userId).trim();
    if (!target) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择组织成员');
    }
    if (target === ctx.orgUserId) return target;
    const row = await this.prisma.orgStaff.findFirst({
      where: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        memberUserId: target,
        status: 'ACTIVE',
      },
      select: { memberUserId: true },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该人员不是本组织的在职职员或代理人',
      );
    }
    return target;
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

  /** 组织名：企业主档案或服务商备案机构名，取不到时回落账号 id。 */
  private async orgNames(userIds: string[]) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const [enterprises, providers, accounts] = await Promise.all([
      this.prisma.enterpriseProfile.findMany({
        where: { userId: { in: unique }, status: 'APPROVED' },
        select: { userId: true, name: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.providerApplication.findMany({
        where: { userId: { in: unique }, status: 'APPROVED' },
        select: { userId: true, orgName: true },
        orderBy: { id: 'asc' },
      }),
      this.users.lookup(unique),
    ]);
    const dir = new Map(
      accounts.map((item) => [
        item.id,
        text(item.displayName) || text(item.username),
      ]),
    );
    return new Map(
      unique.map((id) => {
        const enterprise = enterprises.find((item) => item.userId === id);
        const provider = providers.find((item) => item.userId === id);
        return [
          id,
          text(enterprise?.name) ||
            text(provider?.orgName) ||
            text(dir.get(id)) ||
            id,
        ];
      }),
    );
  }
}
