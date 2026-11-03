import {
  MEMBER_KIND_LABELS,
  ORG_APPLICATION_STATUS_LABELS,
  ORG_BUSINESS_SCOPE_LABELS,
  ORG_MEMBER_STATUS_LABELS,
  type OrgType,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';

const ROLE_LABELS: Record<string, string> = {
  TAX: '财税服务',
  MARKETING: '营销服务',
  LEGAL: '法律服务',
  IP: '知识产权',
  FLEX: '灵活用工',
  LOGISTICS: '物流服务',
  SMART: 'IT服务',
  ASSET: '资产交易',
  OVERSEAS: '跨境出海',
  SUPPLY: '供销网络',
  THINK_TANK: '智库服务',
  CONTRACT: '签约管理',
};

const roleLabel = (code: string) =>
  ROLE_LABELS[code] || ORG_BUSINESS_SCOPE_LABELS[code] || code;

const asArray = (value: unknown): string[] => {
  if (Array.isArray(value))
    return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const asPositions = (
  value: unknown,
): { name: string; description: string }[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      name: text((item as { name?: unknown })?.name)
        .trim()
        .slice(0, 64),
      description: text((item as { description?: unknown })?.description)
        .trim()
        .slice(0, 500),
    }))
    .filter((item) => item.name)
    .slice(0, 5);
};

/**
 * 统一组织成员：企业照抄服务商的「职员与代理人」。
 * - 服务商读写仍走旧接口（provider_staff / staff_applications），本服务只读回统一结构，保证页面一致；
 * - 企业使用 org_staff / org_applications，不修改服务商任何行为；
 * - 企业职员＝本企业全量业务数据；企业代理人＝仅被抓派的业务（scope）。
 */
export class OrgStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationService,
  ) {}

  private async orgOf(user: CurrentUser, orgType?: string) {
    const q = await this.identity.qualifications(user.userId);
    const canEnterprise = Boolean(q.enterprise);
    const canProvider = q.providerApps.some(
      (item) => item.status === 'APPROVED',
    );
    const type: OrgType =
      orgType === 'PROVIDER' || orgType === 'ENTERPRISE'
        ? orgType
        : user.isAdmin() || canEnterprise
          ? 'ENTERPRISE'
          : 'PROVIDER';
    if (type === 'ENTERPRISE' && !canEnterprise && !user.isAdmin()) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '请先完成企业认证，再管理职员与代理人',
      );
    }
    if (type === 'PROVIDER' && !canProvider && !user.isAdmin()) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '请先完成服务商备案，再管理职员与代理人',
      );
    }
    const app = q.providerApps.find((item) => item.status === 'APPROVED');
    return {
      type,
      orgUserId: user.userId,
      orgName:
        type === 'ENTERPRISE'
          ? text(q.enterprise?.name)
          : text(app?.orgName) || text(app?.providerType),
      manageable: true,
    };
  }

  private async names(userIds: string[]) {
    const ids = [...new Set(userIds.filter(Boolean))];
    const [directory, profiles] = await Promise.all([
      ids.length ? this.users.lookup(ids) : Promise.resolve([]),
      ids.length
        ? this.prisma.staffProfile.findMany({
            where: { userId: { in: ids } },
          })
        : Promise.resolve([]),
    ]);
    const dir = new Map(directory.map((item) => [item.id, item]));
    const prof = new Map(profiles.map((item) => [item.userId, item]));
    return { dir, prof };
  }

  private staffView(
    row: {
      id: number;
      orgType: string;
      orgUserId: string;
      memberUserId: string;
      memberKind: string;
      roles: unknown;
      scope: unknown;
      department: string;
      positions: unknown;
      capabilities: string;
      status: string;
      createdAt: Date;
      confirmedAt: Date | null;
    },
    meta: {
      dir: Map<
        string,
        {
          displayName?: string;
          username?: string;
          email?: string | null;
        }
      >;
      prof: Map<
        string,
        {
          realName: string;
          phone: string;
          email: string;
          province: string;
          city: string;
        }
      >;
    },
  ) {
    const roles = asArray(row.roles);
    const scope = asArray(row.scope);
    const account = meta.dir.get(row.memberUserId);
    const profile = meta.prof.get(row.memberUserId);
    return {
      id: row.id,
      orgType: row.orgType,
      orgUserId: row.orgUserId,
      memberUserId: row.memberUserId,
      memberKind: row.memberKind,
      memberKindLabel: MEMBER_KIND_LABELS[row.memberKind] || row.memberKind,
      roles,
      roleLabels: roles.map(roleLabel),
      scope,
      scopeLabels: scope.map(roleLabel),
      department: row.department,
      positions: asPositions(row.positions),
      capabilities: text(row.capabilities),
      status: row.status,
      statusLabel: ORG_MEMBER_STATUS_LABELS[row.status] || row.status,
      realName:
        text(profile?.realName) ||
        text(account?.displayName) ||
        text(account?.username) ||
        row.memberUserId,
      phone: text(profile?.phone),
      email: text(profile?.email) || text(account?.email),
      province: text(profile?.province),
      city: text(profile?.city),
      createdAt: row.createdAt.toISOString(),
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : '',
    };
  }

  private applicationView(
    row: {
      id: number;
      orgType: string;
      orgUserId: string;
      memberUserId: string;
      memberKind: string;
      direction: string;
      roles: unknown;
      department: string;
      positions: unknown;
      capabilities: string;
      note: string;
      status: string;
      createdAt: Date;
      decidedAt: Date | null;
    },
    meta: {
      dir: Map<string, { displayName?: string; username?: string }>;
      orgNames: Map<string, string>;
    },
  ) {
    const roles = asArray(row.roles);
    const account = meta.dir.get(row.memberUserId);
    return {
      id: row.id,
      orgType: row.orgType,
      orgUserId: row.orgUserId,
      memberUserId: row.memberUserId,
      memberKind: row.memberKind,
      memberKindLabel: MEMBER_KIND_LABELS[row.memberKind] || row.memberKind,
      direction: row.direction,
      roles,
      roleLabels: roles.map(roleLabel),
      department: row.department,
      positions: asPositions(row.positions),
      capabilities: text(row.capabilities),
      note: row.note,
      status: row.status,
      statusLabel: ORG_APPLICATION_STATUS_LABELS[row.status] || row.status,
      memberName:
        text(account?.displayName) ||
        text(account?.username) ||
        row.memberUserId,
      orgName: meta.orgNames.get(row.orgUserId) || row.orgUserId,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : '',
    };
  }

  /** 服务商：读旧表，保持页面与行为完全不变。 */
  private async providerWorkspace(user: CurrentUser, orgName: string) {
    const rows = await this.prisma.providerStaff.findMany({
      where: { providerUserId: user.userId },
      orderBy: { id: 'desc' },
    });
    const apps = await this.prisma.staffApplication.findMany({
      where: { providerUserId: user.userId },
      orderBy: { id: 'desc' },
      take: 100,
    });
    const { dir, prof } = await this.names([
      ...rows.map((row) => row.staffUserId),
      ...apps.map((row) => row.staffUserId),
    ]);
    const orgNames = new Map<string, string>([[user.userId, orgName]]);
    const staff = rows.map((row) =>
      this.staffView(
        {
          id: row.id,
          orgType: 'PROVIDER',
          orgUserId: row.providerUserId,
          memberUserId: row.staffUserId,
          memberKind: 'STAFF',
          roles: row.roles,
          scope: [],
          department: row.department,
          positions: row.positions,
          capabilities: '',
          status: row.status,
          createdAt: row.createdAt,
          confirmedAt: row.createdAt,
        },
        { dir, prof },
      ),
    );
    const applications = apps.map((row) =>
      this.applicationView(
        {
          id: row.id,
          orgType: 'PROVIDER',
          orgUserId: row.providerUserId,
          memberUserId: row.staffUserId,
          memberKind: 'STAFF',
          direction: row.direction === 'PROVIDER_INVITE' ? 'INVITE' : 'JOIN',
          roles: row.roles || row.category,
          department: '',
          positions: [],
          capabilities: '',
          note: row.note,
          status: row.status,
          createdAt: row.createdAt,
          decidedAt: row.auditedAt,
        },
        { dir, orgNames },
      ),
    );
    const myInvitations = await this.myInvitations(user, dir, orgNames);
    return {
      orgType: 'PROVIDER',
      orgName,
      manageable: true,
      staff,
      applications,
      myInvitations,
    };
  }

  private functionItem(row: {
    id: number;
    name: string;
    description: string;
    sortOrder: number;
  }) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sortOrder: row.sortOrder,
    };
  }

  /** 组织职能目录：部门与岗位（OA 流程按部门 + 岗位派签批人时同源）。 */
  private async functionCatalog(orgType: string, orgUserId: string) {
    const [departments, positions] = await Promise.all([
      this.prisma.orgDepartment.findMany({
        where: { orgType, orgUserId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.orgPosition.findMany({
        where: { orgType, orgUserId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      departments: departments.map((row) => this.functionItem(row)),
      positions: positions.map((row) => this.functionItem(row)),
    };
  }

  private async functionMembers(orgType: string, orgUserId: string) {
    const rows = await this.prisma.orgStaff.findMany({
      where: { orgType, orgUserId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    const { dir, prof } = await this.names(rows.map((row) => row.memberUserId));
    return rows.map((row) => {
      const roles = asArray(row.roles);
      const account = dir.get(row.memberUserId);
      const profile = prof.get(row.memberUserId);
      return {
        id: row.id,
        memberUserId: row.memberUserId,
        realName:
          text(profile?.realName) ||
          text(account?.displayName) ||
          text(account?.username) ||
          row.memberUserId,
        memberKind: row.memberKind,
        memberKindLabel: MEMBER_KIND_LABELS[row.memberKind] || row.memberKind,
        roles,
        roleLabels: roles.map(roleLabel),
        department: row.department,
        positions: asPositions(row.positions),
        status: row.status,
        statusLabel: ORG_MEMBER_STATUS_LABELS[row.status] || row.status,
      };
    });
  }

  async functions(user: CurrentUser, orgType?: string) {
    const org = await this.orgOf(user, orgType);
    const [catalog, members] = await Promise.all([
      this.functionCatalog(org.type, org.orgUserId),
      this.functionMembers(org.type, org.orgUserId),
    ]);
    return {
      orgType: org.type,
      orgName: org.orgName,
      manageable: true,
      ...catalog,
      members,
    };
  }

  async saveDepartment(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.orgOf(user, text(body.orgType) || undefined);
    const name = text(body.name).trim().slice(0, 64);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写部门名称');
    }
    const description = text(body.description).trim().slice(0, 500);
    const sortOrder = Math.min(
      Math.max(Math.floor(Number(body.sortOrder) || 0), 0),
      9999,
    );
    const id = Math.floor(Number(body.id) || 0);
    const duplicate = await this.prisma.orgDepartment.findFirst({
      where: {
        orgType: org.type,
        orgUserId: org.orgUserId,
        name,
        ...(id ? { id: { not: id } } : {}),
      },
    });
    if (duplicate) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '同名部门已存在');
    }
    if (!id) {
      const created = await this.prisma.orgDepartment.create({
        data: {
          orgType: org.type,
          orgUserId: org.orgUserId,
          name,
          description,
          sortOrder,
        },
      });
      return this.functionItem(created);
    }
    const row = await this.prisma.orgDepartment.findFirst({
      where: { id, orgType: org.type, orgUserId: org.orgUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '部门不存在');
    }
    const updated = await this.prisma.orgDepartment.update({
      where: { id },
      data: { name, description, sortOrder },
    });
    if (row.name !== name) {
      await this.renameDeptHead(org.type, org.orgUserId, row.name, name);
    }
    return this.functionItem(updated);
  }

  async removeDepartment(user: CurrentUser, id: string, orgType?: string) {
    const org = await this.orgOf(user, orgType);
    const row = await this.prisma.orgDepartment.findFirst({
      where: { id: Number(id), orgType: org.type, orgUserId: org.orgUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '部门不存在');
    }
    await this.prisma.$transaction([
      this.prisma.orgDepartment.delete({ where: { id: row.id } }),
      this.prisma.orgStaff.updateMany({
        where: {
          orgType: org.type,
          orgUserId: org.orgUserId,
          department: row.name,
        },
        data: { department: '' },
      }),
      ...(org.type === 'PROVIDER'
        ? [
            this.prisma.providerStaff.updateMany({
              where: { providerUserId: org.orgUserId, department: row.name },
              data: { department: '' },
            }),
          ]
        : []),
    ]);
    await this.renameDeptHead(org.type, org.orgUserId, row.name, '');
    return { removed: true };
  }

  async savePosition(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.orgOf(user, text(body.orgType) || undefined);
    const name = text(body.name).trim().slice(0, 64);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写岗位名称');
    }
    const description = text(body.description).trim().slice(0, 500);
    const sortOrder = Math.min(
      Math.max(Math.floor(Number(body.sortOrder) || 0), 0),
      9999,
    );
    const id = Math.floor(Number(body.id) || 0);
    const duplicate = await this.prisma.orgPosition.findFirst({
      where: {
        orgType: org.type,
        orgUserId: org.orgUserId,
        name,
        ...(id ? { id: { not: id } } : {}),
      },
    });
    if (duplicate) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '同名岗位已存在');
    }
    if (!id) {
      const created = await this.prisma.orgPosition.create({
        data: {
          orgType: org.type,
          orgUserId: org.orgUserId,
          name,
          description,
          sortOrder,
        },
      });
      return this.functionItem(created);
    }
    const row = await this.prisma.orgPosition.findFirst({
      where: { id, orgType: org.type, orgUserId: org.orgUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '岗位不存在');
    }
    const updated = await this.prisma.orgPosition.update({
      where: { id },
      data: { name, description, sortOrder },
    });
    if (row.name !== name || row.description !== description) {
      await this.syncPositionOnStaff(org.type, org.orgUserId, row.name, {
        name,
        description,
      });
    }
    return this.functionItem(updated);
  }

  async removePosition(user: CurrentUser, id: string, orgType?: string) {
    const org = await this.orgOf(user, orgType);
    const row = await this.prisma.orgPosition.findFirst({
      where: { id: Number(id), orgType: org.type, orgUserId: org.orgUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '岗位不存在');
    }
    await this.prisma.orgPosition.delete({ where: { id: row.id } });
    await this.syncPositionOnStaff(org.type, org.orgUserId, row.name, null);
    return { removed: true };
  }

  async assignFunctions(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const org = await this.orgOf(user, text(body.orgType) || undefined);
    const row = await this.prisma.orgStaff.findFirst({
      where: { id: Number(id), orgType: org.type, orgUserId: org.orgUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    }
    const department = text(body.department).trim().slice(0, 64);
    if (department) {
      const match = await this.prisma.orgDepartment.findFirst({
        where: {
          orgType: org.type,
          orgUserId: org.orgUserId,
          name: department,
        },
      });
      if (!match) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '所选部门不在本组织职能目录里',
        );
      }
    }
    const requested = asArray(
      Array.isArray(body.positions)
        ? body.positions.map((item) => text((item as { name?: unknown })?.name))
        : body.positions,
    ).slice(0, 5);
    const catalog = await this.prisma.orgPosition.findMany({
      where: { orgType: org.type, orgUserId: org.orgUserId },
    });
    const positions = requested.map((name) => {
      const match = catalog.find((item) => item.name === name);
      if (!match) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `岗位「${name}」不在本组织职能目录里`,
        );
      }
      return { name: match.name, description: match.description };
    });
    await this.prisma.orgStaff.update({
      where: { id: row.id },
      data: { department, positions },
    });
    // 服务商的在职职员列表读 provider_staff：同一动作同步镜像行，避免两处显示不一致。
    if (org.type === 'PROVIDER') {
      await this.prisma.providerStaff.updateMany({
        where: {
          providerUserId: org.orgUserId,
          staffUserId: row.memberUserId,
        },
        data: { department, positions },
      });
    }
    const members = await this.functionMembers(org.type, org.orgUserId);
    return (
      members.find((item) => item.id === row.id) ?? {
        id: row.id,
        memberUserId: row.memberUserId,
        realName: row.memberUserId,
        memberKind: row.memberKind,
        memberKindLabel: MEMBER_KIND_LABELS[row.memberKind] || row.memberKind,
        roles: asArray(row.roles),
        roleLabels: asArray(row.roles).map(roleLabel),
        department,
        positions,
        status: row.status,
        statusLabel: ORG_MEMBER_STATUS_LABELS[row.status] || row.status,
      }
    );
  }

  /** 部门改名时保留 OA 设置里的部门负责人绑定；传空 newName＝删除绑定。 */
  private async renameDeptHead(
    orgType: string,
    orgUserId: string,
    oldName: string,
    newName: string,
  ) {
    const settings = await this.prisma.oaSettings.findUnique({
      where: { orgType_orgUserId: { orgType, orgUserId } },
    });
    if (!settings) return;
    const heads = { ...((settings.deptHeads as Record<string, string>) || {}) };
    if (!(oldName in heads)) return;
    const head = heads[oldName];
    delete heads[oldName];
    if (newName) heads[newName] = head;
    await this.prisma.oaSettings.update({
      where: { id: settings.id },
      data: { deptHeads: heads },
    });
  }

  /** 岗位改名/删除时同步成员身上已赋的岗位快照。 */
  private async syncPositionOnStaff(
    orgType: string,
    orgUserId: string,
    oldName: string,
    next: { name: string; description: string } | null,
  ) {
    const replace = (value: unknown) => {
      const list = asPositions(value);
      if (!list.some((item) => item.name === oldName)) return null;
      return list
        .map((item) => (item.name === oldName ? next : item))
        .filter((item): item is { name: string; description: string } =>
          Boolean(item),
        );
    };
    const rows = await this.prisma.orgStaff.findMany({
      where: { orgType, orgUserId },
      select: { id: true, positions: true },
    });
    for (const row of rows) {
      const positions = replace(row.positions);
      if (positions) {
        await this.prisma.orgStaff.update({
          where: { id: row.id },
          data: { positions },
        });
      }
    }
    if (orgType !== 'PROVIDER') return;
    const mirrors = await this.prisma.providerStaff.findMany({
      where: { providerUserId: orgUserId },
      select: { id: true, positions: true },
    });
    for (const row of mirrors) {
      const positions = replace(row.positions);
      if (positions) {
        await this.prisma.providerStaff.update({
          where: { id: row.id },
          data: { positions },
        });
      }
    }
  }

  private async myInvitations(
    user: CurrentUser,
    dir: Map<string, { displayName?: string; username?: string }>,
    orgNames: Map<string, string>,
  ) {
    const rows = await this.prisma.orgApplication.findMany({
      where: {
        memberUserId: user.userId,
        direction: 'INVITE',
        status: 'PENDING',
      },
      orderBy: { id: 'desc' },
      take: 50,
    });
    if (!rows.length) return [];
    const extra = await this.users.lookup(
      [...new Set(rows.map((row) => row.orgUserId))].filter(Boolean),
    );
    for (const item of extra) {
      dir.set(item.id, item);
    }
    const enterprises = await this.prisma.enterpriseProfile.findMany({
      where: { userId: { in: rows.map((row) => row.orgUserId) } },
    });
    const providerApps = await this.prisma.providerApplication.findMany({
      where: {
        userId: { in: rows.map((row) => row.orgUserId) },
        status: 'APPROVED',
      },
    });
    for (const row of rows) {
      const ent = enterprises.find((item) => item.userId === row.orgUserId);
      const app = providerApps.find((item) => item.userId === row.orgUserId);
      if (ent?.name || app?.orgName) {
        orgNames.set(row.orgUserId, ent?.name || app?.orgName || '');
      }
    }
    return rows.map((row) => this.applicationView(row, { dir, orgNames }));
  }

  async workspace(user: CurrentUser, orgType?: string) {
    const org = await this.orgOf(user, orgType);
    if (org.type === 'PROVIDER') {
      return this.providerWorkspace(user, org.orgName);
    }
    const rows = await this.prisma.orgStaff.findMany({
      where: { orgType: 'ENTERPRISE', orgUserId: org.orgUserId },
      orderBy: [{ status: 'asc' }, { id: 'desc' }],
    });
    const apps = await this.prisma.orgApplication.findMany({
      where: { orgType: 'ENTERPRISE', orgUserId: org.orgUserId },
      orderBy: { id: 'desc' },
      take: 100,
    });
    const { dir, prof } = await this.names([
      ...rows.map((row) => row.memberUserId),
      ...apps.map((row) => row.memberUserId),
    ]);
    const orgNames = new Map<string, string>([[org.orgUserId, org.orgName]]);
    return {
      orgType: 'ENTERPRISE',
      orgName: org.orgName,
      manageable: true,
      staff: rows.map((row) => this.staffView(row, { dir, prof })),
      applications: apps.map((row) =>
        this.applicationView(row, { dir, orgNames }),
      ),
      myInvitations: await this.myInvitations(user, dir, orgNames),
    };
  }

  async search(user: CurrentUser, query: string, orgType?: string) {
    const org = await this.orgOf(user, orgType);
    const q = query.trim();
    if (!q) return [];
    const rows = await this.prisma.staffProfile.findMany({
      where: {
        OR: [
          { realName: { contains: q } },
          { phone: { contains: q } },
        ],
      },
      take: 20,
    });
    if (!rows.length) return [];
    const ids = rows.map((row) => row.userId);
    const memberRows =
      org.type === 'ENTERPRISE'
        ? await this.prisma.orgStaff.findMany({
            where: {
              orgType: 'ENTERPRISE',
              orgUserId: org.orgUserId,
              memberUserId: { in: ids },
            },
          })
        : await this.prisma.providerStaff.findMany({
            where: { providerUserId: org.orgUserId, staffUserId: { in: ids } },
          });
    const inOrg = new Set(
      memberRows.map((row) =>
        'staffUserId' in row ? row.staffUserId : row.memberUserId,
      ),
    );
    return rows.map((row) => ({
      userId: row.userId,
      realName: row.realName,
      phone: row.phone,
      province: row.province,
      city: row.city,
      inOrg: inOrg.has(row.userId),
    }));
  }

  async invite(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.orgOf(user, text(body.orgType) || undefined);
    if (org.type === 'PROVIDER') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务商请继续使用「添加职员」，企业与服务商共用同一套成员关系',
      );
    }
    const memberUserId = text(body.memberUserId).trim();
    if (!memberUserId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要添加的账号');
    }
    if (memberUserId === org.orgUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '不能把自己添加为职员（企业主本人无需添加）',
      );
    }
    await this.users.requireActiveUser(memberUserId);
    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId: memberUserId },
    });
    if (!profile) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该账号尚未提交个人资料（职员/代理人身份），不可添加',
      );
    }
    const exist = await this.prisma.orgStaff.findUnique({
      where: {
        orgType_orgUserId_memberUserId: {
          orgType: 'ENTERPRISE',
          orgUserId: org.orgUserId,
          memberUserId,
        },
      },
    });
    if (exist?.status === 'ACTIVE') {
      throw new BusinessException(ErrorCode.CONFLICT, '该账号已是本企业成员');
    }
    const pending = await this.prisma.orgApplication.findFirst({
      where: {
        orgType: 'ENTERPRISE',
        orgUserId: org.orgUserId,
        memberUserId,
        status: 'PENDING',
      },
    });
    if (pending) {
      throw new BusinessException(ErrorCode.CONFLICT, '该账号已有待处理的邀请');
    }
    const roles = asArray(body.roles);
    const scope = asArray(body.scope);
    const memberKind = text(body.memberKind) === 'AGENT' ? 'AGENT' : 'STAFF';
    const positions = asPositions(body.positions);
    if (!positions.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少填写一个岗位');
    }
    const row = await this.prisma.orgApplication.create({
      data: {
        orgType: 'ENTERPRISE',
        orgUserId: org.orgUserId,
        memberUserId,
        memberKind,
        direction: 'INVITE',
        roles,
        scope,
        department: text(body.department).slice(0, 64),
        positions,
        capabilities: text(body.capabilities).slice(0, 1000),
        createdBy: org.orgUserId,
      },
    });
    await this.notifications.notify(memberUserId, {
      category: 'identity',
      title: `「${org.orgName || '企业'}」邀请你成为${
        memberKind === 'AGENT' ? '代理人' : '职员'
      }`,
      body: '在「职员与代理人」页确认后生效',
      link: '/staff',
      entityType: 'org_application',
      entityId: row.id,
    });
    return { id: row.id, status: row.status };
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const org = await this.orgOf(user);
    if (org.type === 'PROVIDER') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务商请继续使用原有成员管理入口',
      );
    }
    const row = await this.prisma.orgStaff.findFirst({
      where: { id, orgType: 'ENTERPRISE', orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    const updated = await this.prisma.orgStaff.update({
      where: { id: row.id },
      data: {
        ...(typeof body.memberKind === 'string'
          ? { memberKind: body.memberKind === 'AGENT' ? 'AGENT' : 'STAFF' }
          : {}),
        ...(Array.isArray(body.roles) ? { roles: body.roles as never } : {}),
        ...(Array.isArray(body.scope) ? { scope: body.scope as never } : {}),
        ...(typeof body.department === 'string'
          ? { department: body.department.slice(0, 64) }
          : {}),
        ...(Array.isArray(body.positions)
          ? { positions: asPositions(body.positions) }
          : {}),
        ...(typeof body.capabilities === 'string'
          ? { capabilities: body.capabilities.slice(0, 1000) }
          : {}),
        ...(body.status === 'ACTIVE' || body.status === 'REMOVED'
          ? { status: body.status }
          : {}),
      } as never,
    });
    const { dir, prof } = await this.names([updated.memberUserId]);
    return this.staffView(updated, { dir, prof });
  }

  async remove(user: CurrentUser, id: number) {
    const org = await this.orgOf(user);
    if (org.type === 'PROVIDER') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务商请继续使用原有成员管理入口',
      );
    }
    const row = await this.prisma.orgStaff.findFirst({
      where: { id, orgType: 'ENTERPRISE', orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    await this.prisma.orgStaff.update({
      where: { id: row.id },
      data: { status: 'REMOVED' },
    });
    await this.notifications.notify(row.memberUserId, {
      category: 'identity',
      title: `你已从「${org.orgName || '企业'}」移除`,
      body: '如有疑问请联系企业管理员',
      link: '/staff',
      level: 'warning',
    });
    return { removed: true };
  }

  async decide(user: CurrentUser, id: number, action: string) {
    const row = await this.prisma.orgApplication.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '申请不存在');
    if (action === 'CANCEL') {
      if (row.orgUserId !== user.userId) {
        throw new BusinessException(
          ErrorCode.ROLE_MISMATCH,
          '仅发起方可撤回该邀请',
        );
      }
      if (row.status !== 'PENDING') {
        throw new BusinessException(ErrorCode.CONFLICT, '该申请已处理');
      }
      await this.prisma.orgApplication.update({
        where: { id },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });
      return { id, status: 'CANCELLED' };
    }
    if (row.memberUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅被邀请人本人可确认该邀请',
      );
    }
    if (row.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该申请已处理');
    }
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.$transaction(async (tx) => {
      await tx.orgApplication.update({
        where: { id },
        data: { status, decidedAt: new Date() },
      });
      if (action === 'APPROVE') {
        await tx.orgStaff.upsert({
          where: {
            orgType_orgUserId_memberUserId: {
              orgType: row.orgType,
              orgUserId: row.orgUserId,
              memberUserId: row.memberUserId,
            },
          },
          create: {
            orgType: row.orgType,
            orgUserId: row.orgUserId,
            memberUserId: row.memberUserId,
            memberKind: row.memberKind,
            roles: row.roles as never,
            scope: row.scope as never,
            department: row.department,
            positions: row.positions as never,
            capabilities: row.capabilities,
            status: 'ACTIVE',
            invitedBy: row.createdBy,
            confirmedAt: new Date(),
          } as never,
          update: {
            status: 'ACTIVE',
            roles: row.roles as never,
            scope: row.scope as never,
            department: row.department,
            positions: row.positions as never,
            capabilities: row.capabilities,
            confirmedAt: new Date(),
          } as never,
        });
      }
    });
    const orgName =
      text(
        (
          await this.prisma.enterpriseProfile.findFirst({
            where: { userId: row.orgUserId },
          })
        )?.name,
      ) || '企业';
    await this.notifications.notify(row.orgUserId, {
      category: 'identity',
      title: `${row.memberUserId} 已${status === 'APPROVED' ? '接受' : '拒绝'}你的邀请`,
      body: `组织：${orgName}`,
      link: '/staff',
      level: status === 'APPROVED' ? 'info' : 'warning',
      entityType: 'org_application',
      entityId: row.id,
    });
    return { id, status };
  }
}
