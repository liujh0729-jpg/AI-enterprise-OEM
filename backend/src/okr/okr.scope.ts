import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  OkrDimension,
  OkrPosition,
  asArray,
  asDimensions,
  asPositions,
  defaultDimensions,
  int,
  jsonObject,
} from './okr.helpers';

export type OkrMemberRow = {
  memberUserId: string;
  name: string;
  memberKind: string;
  memberKindLabel: string;
  department: string;
  positions: OkrPosition[];
  capabilities: string;
  roles: string[];
  dualKind: boolean;
};

export type OkrSettingsValue = {
  managers: string[];
  defaultVisibility: string;
  weekStart: number;
  autoDraftEnabled: boolean;
  reportTemplates: Record<string, unknown>;
  reportSchedules: Record<string, unknown>;
  scoreDimensions: OkrDimension[];
  metricRefreshHour: number;
};

export type OkrContext = {
  ownerUserId: string;
  actorId: string;
  isOwner: boolean;
  isManager: boolean;
  isMember: boolean;
  department: string;
  managerIds: string[];
  settings: OkrSettingsValue;
};

export const defaultSettings = (): OkrSettingsValue => ({
  managers: [],
  defaultVisibility: 'ORG',
  weekStart: 1,
  autoDraftEnabled: true,
  reportTemplates: {},
  reportSchedules: {},
  scoreDimensions: defaultDimensions(),
  metricRefreshHour: 5,
});

/**
 * OKR 账号归属与权限的唯一入口。
 * 账号＝ownerUserId；成员只看该账号的 org_staff（企业/服务商共用），
 * 与 CRM 不同，OKR 不要求成员已被加入 CRM——只要在本账号的组织名册里即可。
 */
export class OkrScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
  ) {}

  async context(user: CurrentUser): Promise<OkrContext> {
    const ownerUserId = await this.ownerOf(user.userId);
    const settings = await this.settings(ownerUserId);
    const isOwner = ownerUserId === user.userId;
    const isManager = !isOwner && settings.managers.includes(user.userId);
    const members = await this.members(ownerUserId);
    const row = members.find((item) => item.memberUserId === user.userId);
    return {
      ownerUserId,
      actorId: user.userId,
      isOwner,
      isManager,
      isMember: isOwner || Boolean(row),
      department: row?.department || '',
      managerIds: settings.managers,
      settings,
    };
  }

  /** 有自己组织（企业或服务商）就用自己账号；否则看其所属组织。 */
  private async ownerOf(userId: string) {
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
        select: { orgUserId: true },
      }),
    ]);
    if (orgOwner || providerOwner) return userId;
    if (enterpriseOwner?.orgUserId) return enterpriseOwner.orgUserId;
    const providerMember = await this.prisma.providerStaff.findFirst({
      where: { staffUserId: userId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      select: { providerUserId: true },
    });
    return providerMember?.providerUserId || userId;
  }

  async settings(ownerUserId: string): Promise<OkrSettingsValue> {
    const row = await this.prisma.okrSettings.findUnique({
      where: { ownerUserId },
    });
    const base = defaultSettings();
    if (!row) return base;
    return {
      managers: asArray(row.managers),
      defaultVisibility: text(row.defaultVisibility) || base.defaultVisibility,
      weekStart: Math.min(Math.max(int(row.weekStart, 1), 0), 6),
      autoDraftEnabled: Boolean(row.autoDraftEnabled),
      reportTemplates: jsonObject(row.reportTemplates),
      reportSchedules: jsonObject(row.reportSchedules),
      scoreDimensions: asDimensions(row.scoreDimensions),
      metricRefreshHour: Math.min(
        Math.max(int(row.metricRefreshHour, 5), 0),
        23,
      ),
    };
  }

  /** 本账号成员：org_staff（企业/服务商）+ 旧 provider_staff（去重）。 */
  async members(ownerUserId: string): Promise<OkrMemberRow[]> {
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
    const merged = new Map<string, OkrMemberRow>();
    for (const row of orgRows) {
      const existing = merged.get(row.memberUserId);
      const mine: OkrMemberRow = {
        memberUserId: row.memberUserId,
        name: '',
        memberKind: row.memberKind || 'STAFF',
        memberKindLabel: row.memberKind === 'AGENT' ? '代理人' : '职员',
        department: row.department || '',
        positions: asPositions(row.positions),
        capabilities: text(row.capabilities).slice(0, 1000),
        roles: asArray(row.roles),
        dualKind: Boolean(existing),
      };
      if (existing) {
        // 同一账号既是企业又是服务商：保留企业侧档案，标记双身份。
        mine.positions = existing.positions.length
          ? existing.positions
          : mine.positions;
        mine.capabilities = existing.capabilities || mine.capabilities;
        mine.department = existing.department || mine.department;
        mine.dualKind = true;
      }
      merged.set(row.memberUserId, mine);
    }
    for (const row of providerRows) {
      const existing = merged.get(row.staffUserId);
      if (existing) {
        existing.dualKind = true;
        continue;
      }
      merged.set(row.staffUserId, {
        memberUserId: row.staffUserId,
        name: '',
        memberKind: 'STAFF',
        memberKindLabel: '职员',
        department: '',
        positions: [],
        capabilities: '',
        roles: Array.isArray(row.roles)
          ? asArray(row.roles)
          : asArray(text(row.roles)),
        dualKind: false,
      });
    }
    const rows = [...merged.values()];
    if (!rows.length) return rows;
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

  assertMember(ctx: OkrContext) {
    if (!ctx.isMember) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '你还没有被加入本账号的 OKR，请联系负责人添加成员',
      );
    }
  }

  assertManager(ctx: OkrContext) {
    if (!ctx.isOwner && !ctx.isManager) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有账号所有者或 OKR 管理者可以执行该操作',
      );
    }
  }

  assertOwner(ctx: OkrContext) {
    if (!ctx.isOwner) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有账号所有者可以执行该操作',
      );
    }
  }

  /** 承接人必须是本账号 ACTIVE 成员；账号所有者本人可直接作为承接人。 */
  async requireMember(ctx: OkrContext, memberUserId: string) {
    if (!memberUserId || memberUserId === ctx.ownerUserId) return '';
    const members = await this.members(ctx.ownerUserId);
    const row = members.find((item) => item.memberUserId === memberUserId);
    if (!row) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '承接人不在本账号的职员与代理人名单里',
      );
    }
    return memberUserId;
  }

  /** 当前用户可写入的成员集合：所有者/管理者可写全员，成员只写自己。 */
  assertCanWriteMember(ctx: OkrContext, memberUserId: string) {
    if (ctx.isOwner || ctx.isManager) return;
    const target = memberUserId || ctx.actorId;
    if (target !== ctx.actorId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能维护自己的目标、计划与汇报',
      );
    }
  }
}
