import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import { asStringArray, clip, ds, iso } from './hrm.helpers';
import type { HrmOrg, HrmScopeService } from './hrm.scope';

/**
 * 员工档案（§5.1 入转调离的 HR 主体面）：一账号一档案，挂 (orgType, orgUserId) 组织键。
 * 建档即入册（OrgStaff ACTIVE），离职只改档案状态与 OrgStaff 状态，不删数据（留痕）。
 */

type ProfileRow = {
  id: number;
  memberUserId: string;
  employeeNo: string;
  employmentType: string;
  hourlyRate: unknown;
  supervisorUserId: string;
  department: string;
  skills: unknown;
  status: string;
  joinedAt: string;
  leftAt: string;
  note: string;
  updatedAt: Date;
};

export type UpsertProfileInput = {
  memberUserId: string;
  employeeNo?: string;
  employmentType?: string;
  hourlyRate?: number;
  supervisorUserId?: string;
  department?: string;
  skills?: string[];
  joinedAt?: string;
  note?: string;
};

export type UpdateProfileStatusInput = {
  memberUserId: string;
  status: string;
  leftAt?: string;
};

export class HrmProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
  ) {}

  view(row: ProfileRow) {
    return {
      id: row.id,
      memberUserId: row.memberUserId,
      employeeNo: row.employeeNo,
      employmentType: row.employmentType,
      hourlyRate: ds(row.hourlyRate),
      supervisorUserId: row.supervisorUserId,
      department: row.department,
      skills: asStringArray(row.skills),
      status: row.status,
      joinedAt: row.joinedAt,
      leftAt: row.leftAt,
      note: row.note,
      updatedAt: iso(row.updatedAt),
    };
  }

  async list(
    query: {
      department?: string;
      status?: string;
      q?: string;
      page: number;
      pageSize: number;
    },
    user: CurrentUser,
  ) {
    const org = await this.scope.resolve(user);
    const q = String(query.q || '').trim();
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.department ? { department: query.department } : {}),
      ...(query.status ? { status: query.status } : {}),
      // 关键字命中工号/部门/账号 id（姓名由账号档案承担，本期不跨模块联表）。
      ...(q
        ? {
            OR: [
              { employeeNo: { contains: q } },
              { department: { contains: q } },
              { memberUserId: { contains: q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.hrmEmployeeProfile.count({ where }),
      this.prisma.hrmEmployeeProfile.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.view(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 建档/改档：非管理员只能建/改本人档案（代录他人需 HR 权限）。 */
  async upsert(body: UpsertProfileInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const memberUserId = await this.ensureMember(
      body.memberUserId,
      org,
      body.department,
    );
    const skills = (body.skills || []).map((s) => clip(s, 32)).slice(0, 50);
    const supervisorUserId = (body.supervisorUserId || '').trim();
    if (supervisorUserId && supervisorUserId !== memberUserId) {
      await this.scope.requireStaff(org, supervisorUserId, false);
    }
    const data = {
      employeeNo: clip(body.employeeNo, 32),
      employmentType: body.employmentType || 'FULL_TIME',
      hourlyRate: body.hourlyRate ?? 0,
      supervisorUserId,
      department: clip(body.department, 64),
      skills,
      joinedAt: clip(body.joinedAt, 16),
      note: clip(body.note, 500),
    };
    const row = await this.prisma.hrmEmployeeProfile.upsert({
      where: {
        orgType_orgUserId_memberUserId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId,
        },
      },
      create: {
        ...data,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        memberUserId,
        status: 'PROBATION',
      },
      update: data,
    });
    return this.view(row);
  }

  /** 在职状态流转：LEFT 同步把 OrgStaff 置 REMOVED（不入转调离的其它模块口径）。 */
  async updateStatus(body: UpdateProfileStatusInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    if (
      body.status !== 'LEFT' &&
      body.status !== 'ACTIVE' &&
      body.status !== 'PROBATION'
    ) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '未知的档案状态');
    }
    const memberUserId = await this.scope.requireStaff(
      org,
      body.memberUserId,
      false,
    );
    if (memberUserId !== org.actorId) this.scope.requireAdmin(org);
    if (body.status === 'LEFT' && !clip(body.leftAt, 16)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '离职需要填写离职日期',
      );
    }
    const existing = await this.profileOf(org, memberUserId);
    if (!existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该成员尚未建档');
    }
    const row = await this.prisma.hrmEmployeeProfile.update({
      where: {
        orgType_orgUserId_memberUserId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId,
        },
      },
      data: {
        status: body.status,
        leftAt: body.status === 'LEFT' ? clip(body.leftAt, 16) : '',
      },
    });
    if (body.status === 'LEFT') {
      await this.prisma.orgStaff.updateMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId,
        },
        data: { status: 'REMOVED' },
      });
    }
    return this.view(row);
  }

  async profileOf(org: HrmOrg, memberUserId: string) {
    return this.prisma.hrmEmployeeProfile.findUnique({
      where: {
        orgType_orgUserId_memberUserId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId,
        },
      },
    });
  }

  /** 建档即入册：目标账号必须已注册，组织内无成员关系时自动补 ACTIVE 职员行。 */
  private async ensureMember(
    memberUserId: string,
    org: HrmOrg,
    department?: string,
  ) {
    const target = String(memberUserId || '').trim();
    if (!target)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请指定成员账号');
    if (target !== org.actorId) this.scope.requireAdmin(org);
    if (target === org.orgUserId) return target;
    const account = await this.prisma.account.findFirst({
      where: { id: Number(target) || -1 },
      select: { id: true, status: true },
    });
    if (!account) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '成员账号不存在');
    }
    if (account.status !== 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '成员账号已停用，不能建档',
      );
    }
    await this.prisma.orgStaff.upsert({
      where: {
        orgType_orgUserId_memberUserId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId: target,
        },
      },
      create: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        memberUserId: target,
        memberKind: 'STAFF',
        department: clip(department, 64),
        status: 'ACTIVE',
        invitedBy: org.actorId,
        confirmedAt: new Date(),
      },
      update: { status: 'ACTIVE' },
    });
    return target;
  }
}
