import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { HrmScopeService } from '../hrm/hrm.scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AccessContext,
  type LowCodeProjectRow,
  ROLE_LABELS,
  actionsOf,
} from './lowcode.shared';

export type OrgOption = {
  orgType: string;
  orgUserId: string;
  name: string;
  role: string;
};

/**
 * 项目访问解析：每个低代码接口的第一步。
 * 命中规则：创建者＝所有者；成员表 ACTIVE 行＝按角色；其余账号一律按「项目不存在」处理，
 * 不向非成员泄露项目是否存在。
 */
export class LowCodeAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly scope: HrmScopeService,
  ) {}

  static projectId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '项目编号无效');
    }
    return id;
  }

  async loadProject(raw: unknown): Promise<LowCodeProjectRow> {
    const id = LowCodeAccessService.projectId(raw);
    const project = await this.prisma.lowCodeProject.findUnique({
      where: { id },
    });
    if (!project) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '项目不存在');
    }
    return project;
  }

  async resolve(user: CurrentUser, raw: unknown): Promise<AccessContext> {
    const project = await this.loadProject(raw);
    const isOwner = project.ownerUserId === user.userId;
    const member = isOwner
      ? null
      : await this.prisma.lowCodeProjectMember.findUnique({
          where: {
            projectId_memberUserId: {
              projectId: project.id,
              memberUserId: user.userId,
            },
          },
        });
    if (!isOwner && (!member || member.status !== 'ACTIVE')) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '项目不存在');
    }
    // 组织项目：项目成员资格必须叠加「当前仍是该组织在册成员」。
    // 离职/被移出组织后即使成员表还没异步清理，也立刻按「项目不存在」处理。
    if (project.orgUserId) {
      const standing = await this.scope.membershipValid(
        project.orgType,
        project.orgUserId,
        user.userId,
      );
      if (!standing) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '项目不存在');
      }
    }
    const role = member
      ? member.roleId
        ? await this.prisma.lowCodeRole.findFirst({
            where: { id: member.roleId, projectId: project.id },
          })
        : await this.prisma.lowCodeRole.findFirst({
            where: { projectId: project.id, key: 'MEMBER' },
          })
      : await this.prisma.lowCodeRole.findFirst({
          where: { projectId: project.id, key: 'OWNER' },
        });
    const roleKey = isOwner ? 'OWNER' : role?.key || 'MEMBER';
    const roleName = isOwner
      ? ROLE_LABELS.OWNER
      : role?.name || ROLE_LABELS[roleKey] || roleKey;

    let department = member?.department || '';
    if (!department && member && project.orgType) {
      const staff = await this.prisma.orgStaff.findFirst({
        where: {
          orgType: project.orgType,
          orgUserId: project.orgUserId,
          memberUserId: user.userId,
          status: 'ACTIVE',
        },
        select: { department: true },
      });
      department = staff?.department || '';
    }

    const [permissions, dataRules] = role
      ? await Promise.all([
          this.prisma.lowCodeRolePermission.findMany({
            where: { roleId: role.id, projectId: project.id },
          }),
          this.prisma.lowCodeDataRule.findMany({
            where: {
              projectId: project.id,
              OR: [{ roleId: 0 }, { roleId: role.id }],
            },
          }),
        ])
      : [[], []];

    return {
      project,
      member,
      isOwner,
      canManage: isOwner || roleKey === 'ADMIN',
      roleId: role?.id || 0,
      roleKey,
      roleName,
      department,
      permissions: permissions.map((row) => ({
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        actions: actionsOf(row.actions),
      })),
      dataRules: dataRules.map((row) => ({
        id: row.id,
        entityId: row.entityId,
        roleId: row.roleId,
        field: row.field,
        op: row.op,
        value: row.value,
      })),
    };
  }

  async requireManage(user: CurrentUser, raw: unknown): Promise<AccessContext> {
    const access = await this.resolve(user, raw);
    if (!access.canManage) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只有所有者与管理员可以修改项目设置',
      );
    }
    return access;
  }

  async requireOwner(user: CurrentUser, raw: unknown): Promise<AccessContext> {
    const access = await this.resolve(user, raw);
    if (!access.isOwner) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只有项目所有者可以执行该操作',
      );
    }
    return access;
  }

  /** 当前账号可作为「组织归属」的项目主体：已认证企业、已备案服务商。 */
  async organizations(user: CurrentUser): Promise<OrgOption[]> {
    const q = await this.identity.qualifications(user.userId);
    const options: OrgOption[] = [];
    if (q.enterprise) {
      options.push({
        orgType: 'ENTERPRISE',
        orgUserId: user.userId,
        name: q.enterprise.name || '我的企业',
        role: '企业',
      });
    }
    const provider = q.providerApps.find((item) => item.status === 'APPROVED');
    if (provider) {
      options.push({
        orgType: 'PROVIDER',
        orgUserId: user.userId,
        name: provider.orgName || provider.providerType || '我的服务商',
        role: '服务商',
      });
    }
    return options;
  }

  async assertOrganization(
    user: CurrentUser,
    orgType: string,
    orgUserId: string,
  ) {
    if (!orgType && !orgUserId) return;
    if (orgUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只能把自己已认证的组织作为项目归属',
      );
    }
    const options = await this.organizations(user);
    const hit = options.find((item) => item.orgType === orgType);
    if (!hit) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        orgType === 'ENTERPRISE'
          ? '请先完成企业认证，再把项目归属到企业'
          : '请先完成服务商备案，再把项目归属到服务商',
      );
    }
    return hit;
  }
}
