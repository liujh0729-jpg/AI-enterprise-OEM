import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { GapScopeService } from './gaps.scope';
import { asText, Row } from './gaps.helpers';

type Context = {
  orgType: string;
  orgUserId: string;
  name: string;
  roleLabel: string;
  current: boolean;
};

/**
 * B3#29 主体切换器：一个自然人可以同时是企业成员与服务商成员；
 * 这里只列「确有关系」的组织，切过去的组织键会被 HRM 作用域优先采用（见 hrm.scope）。
 */
export class OrgContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private async orgName(orgType: string, orgUserId: string): Promise<string> {
    if (orgType === 'PROVIDER') {
      const row = await this.prisma.providerApplication.findFirst({
        where: { userId: orgUserId },
        orderBy: { id: 'desc' },
        select: { orgName: true },
      });
      return row?.orgName || orgUserId;
    }
    const row = await this.prisma.enterpriseProfile.findFirst({
      where: { userId: orgUserId },
      orderBy: { id: 'desc' },
      select: { name: true },
    });
    return row?.name || orgUserId;
  }

  private roleLabel(owned: boolean, roles: unknown): string {
    if (owned) return '负责人';
    const list = Array.isArray(roles)
      ? roles.map((role) => asText(role)).filter(Boolean)
      : [];
    return list.length ? list.join(' / ') : '成员';
  }

  async contexts(user: CurrentUser): Promise<Context[]> {
    const actorId = user.userId;
    const current = await this.scope.resolve(user);
    const [staffRows, providerRows, enterpriseProfile, providerProfile] =
      await Promise.all([
        this.prisma.orgStaff.findMany({
          where: {
            OR: [
              { orgUserId: actorId },
              { memberUserId: actorId, status: 'ACTIVE' },
            ],
          },
          orderBy: { id: 'asc' },
        }),
        this.prisma.providerStaff.findMany({
          where: {
            OR: [
              { providerUserId: actorId },
              { staffUserId: actorId, status: 'ACTIVE' },
            ],
          },
          orderBy: { id: 'asc' },
        }),
        this.prisma.enterpriseProfile.findFirst({
          where: { userId: actorId },
          select: { name: true },
        }),
        this.prisma.providerApplication.findFirst({
          where: { userId: actorId },
          orderBy: { id: 'desc' },
          select: { orgName: true },
        }),
      ]);
    const found = new Map<
      string,
      {
        orgType: string;
        orgUserId: string;
        owned: boolean;
        roles: unknown;
        name?: string;
      }
    >();
    const add = (
      orgType: string,
      orgUserId: string,
      owned: boolean,
      roles: unknown,
      name?: string,
    ) => {
      if (!orgUserId) return;
      const key = `${orgType}:${orgUserId}`;
      const prev = found.get(key);
      if (!prev || (!prev.owned && owned)) {
        found.set(key, {
          orgType,
          orgUserId,
          owned,
          roles,
          name: name || prev?.name,
        });
      }
    };
    // 企业侧：orgStaff 同时承载主账号与成员
    for (const row of staffRows) {
      const owned = row.orgUserId === actorId;
      add('ENTERPRISE', row.orgUserId, owned, row.roles);
    }
    if (enterpriseProfile)
      add('ENTERPRISE', actorId, true, ['ADMIN'], enterpriseProfile.name);
    // 服务商侧：providerStaff 承载机构主账号与员工
    for (const row of providerRows) {
      const owned = row.providerUserId === actorId;
      add('PROVIDER', row.providerUserId, owned, row.roles);
    }
    if (providerProfile)
      add('PROVIDER', actorId, true, ['ADMIN'], providerProfile.orgName);
    // 个人自组织兜底：至少有一个可显示的当前主体
    if (!found.size)
      add('ENTERPRISE', actorId, true, ['ADMIN'], enterpriseProfile?.name);

    const out: Context[] = [];
    for (const entry of found.values()) {
      const name =
        entry.name || (await this.orgName(entry.orgType, entry.orgUserId));
      out.push({
        orgType: entry.orgType,
        orgUserId: entry.orgUserId,
        name,
        roleLabel: this.roleLabel(entry.owned, entry.roles),
        current:
          entry.orgType === current.orgType &&
          entry.orgUserId === current.orgUserId,
      });
    }
    return out;
  }

  async switch(user: CurrentUser, body: Row) {
    const orgType = asText(body.orgType).trim().toUpperCase();
    const orgUserId = asText(body.orgUserId).trim();
    if (!orgUserId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要切换的主体');
    const available = await this.contexts(user);
    const target = available.find(
      (item) => item.orgType === orgType && item.orgUserId === orgUserId,
    );
    if (!target) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '你不属于该主体，不能切换',
      );
    }
    await this.prisma.userOrgContext.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, orgType, orgUserId },
      update: { orgType, orgUserId },
    });
    return { ...target, current: true };
  }
}
