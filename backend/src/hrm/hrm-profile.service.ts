import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import { asStringArray, clip, ds, iso } from './hrm.helpers';
import type { HrmOrg, HrmScopeService } from './hrm.scope';
import type { TaskDraft } from '../task-center/task-source';
import { startOffboardingRun } from '../gaps/onboarding.service';

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

export type HandoverCheckItem = {
  key: string;
  label: string;
  /** 待移交数量：0＝已无残留，可结案。 */
  pending: number;
  link: string;
};

/** 离职交接的检查项与移交项一一对应：checked 的项才允许移交。 */
export type HandoverAssetKey =
  | 'customers'
  | 'projects'
  | 'projectMembers'
  | 'tasks'
  | 'approvals';

export type HandoverAsset = {
  key: HandoverAssetKey;
  label: string;
  count: number;
  items: { id: string; name: string; link: string }[];
  /** 该类别是否可由系统自动改派（审批在途件不允许改派，只能等原审批人处理）。 */
  transferable: boolean;
};

export type HandoverPlan = {
  memberUserId: string;
  checklist: HandoverCheckItem[];
  assets: HandoverAsset[];
  /** 全部检查项已清零且档案已置 LEFT 才可结案。 */
  closable: boolean;
  profileStatus: string;
};

export type TransferHandoverInput = {
  memberUserId: string;
  toUserId: string;
  /** 不传＝移交全部可移交类别。 */
  assets?: HandoverAssetKey[];
  note?: string;
};

/** 任务中心的派单口：只依赖这一形状，避免 HR 反向依赖任务中心实现。 */
export type TaskCenterPort = {
  assign(draft: TaskDraft): Promise<{ id: number }>;
};

export type NotificationPort = {
  notify(
    userId: string,
    input: {
      category: string;
      title: string;
      body?: string;
      link?: string;
      level?: 'info' | 'warning' | 'error';
      entityType?: string;
      entityId?: string | number;
    },
  ): Promise<unknown>;
};

const HANDOVER_TRANSFERABLE: HandoverAssetKey[] = [
  'customers',
  'projects',
  'projectMembers',
];

const HANDOVER_LABELS: Record<HandoverAssetKey, string> = {
  customers: '名下客户',
  projects: '负责项目',
  projectMembers: '参与项目',
  tasks: '未办任务',
  approvals: '在途审批',
};

export class HrmProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly tasks?: TaskCenterPort,
    private readonly notifications?: NotificationPort,
  ) {}

  /**
   * 按角色分离字段（设计方案 §四）：通讯录（工号/部门/用工类型/主管/在职）对组织内可见；
   * 薪酬成本（时薪）与 HR 管理备注只对 HR 管理员与本人可见，其余人置空不返回。
   */
  view(row: ProfileRow, org: HrmOrg) {
    const sensitive = org.isAdmin || row.memberUserId === org.actorId;
    return {
      id: row.id,
      memberUserId: row.memberUserId,
      employeeNo: row.employeeNo,
      employmentType: row.employmentType,
      hourlyRate: sensitive ? ds(row.hourlyRate) : '',
      supervisorUserId: row.supervisorUserId,
      department: row.department,
      skills: asStringArray(row.skills),
      status: row.status,
      joinedAt: row.joinedAt,
      leftAt: row.leftAt,
      note: sensitive ? row.note : '',
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
      list: rows.map((row) => this.view(row, org)),
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
    const where = {
      orgType_orgUserId_memberUserId: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        memberUserId,
      },
    };
    if (org.isAdmin) {
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
        where,
        create: {
          ...data,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId,
          status: 'PROBATION',
        },
        update: data,
      });
      return this.view(row, org);
    }
    // 本人自助入口（非 HR 管理员）：只允许维护自助资料（技能）；工号/用工类型/时薪/
    // 主管/部门/入职日期/备注等组织管理字段沿用既有值，不借本人入口改写（设计方案 §四）。
    const row = await this.prisma.hrmEmployeeProfile.upsert({
      where,
      create: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        memberUserId,
        status: 'PROBATION',
        employeeNo: '',
        employmentType: 'FULL_TIME',
        hourlyRate: 0,
        supervisorUserId: '',
        department: '',
        skills,
        joinedAt: '',
        note: '',
      },
      update: { skills },
    });
    return this.view(row, org);
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
      // 离职即撤权：角色与岗位一并清空，OrgStaff 置 REMOVED 后取用前会被 isStanding 复核；
      // 再按离职交接模板开工一次（无启用模板时跳过，不阻断离职）。
      await this.prisma.orgStaff.updateMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          memberUserId,
        },
        data: { status: 'REMOVED', roles: [], positions: [] },
      });
      await startOffboardingRun(this.prisma, org, memberUserId);
    }
    return this.view(row, org);
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

  // ---------------------------------------------------------------- 离职交接

  /** 交接清单：离职人当前仍挂在身上的客户/项目/任务/审批，逐项给数字与跳转。 */
  async handover(memberUserId: string, user: CurrentUser): Promise<HandoverPlan> {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const target = await this.scope.requireStaff(org, memberUserId, false);
    const assets = await this.handoverAssets(org, target);
    const byKey = new Map(assets.map((item) => [item.key, item.count]));
    // 负责项目与参与项目是同一批项目的两种身份：检查口径按项目去重后计数。
    const liveProjectCount = new Set(
      assets
        .filter(
          (item) =>
            item.key === 'projects' || item.key === 'projectMembers',
        )
        .flatMap((item) => item.items.map((entry) => entry.id)),
    ).size;
    const profile = await this.profileOf(org, target);
    // 项目成员与「负责项目」是同一批项目的两种身份，检查项合并展示、数量取合计。
    const checklist: HandoverCheckItem[] = [
      {
        key: 'customers',
        label: HANDOVER_LABELS.customers,
        pending: byKey.get('customers') || 0,
        link: '/crm',
      },
      {
        key: 'projects',
        label: '负责/参与项目',
        pending: liveProjectCount,
        link: '/project',
      },
      {
        key: 'tasks',
        label: HANDOVER_LABELS.tasks,
        pending: byKey.get('tasks') || 0,
        link: '/tasks',
      },
      {
        key: 'approvals',
        label: HANDOVER_LABELS.approvals,
        pending: byKey.get('approvals') || 0,
        link: '/oa',
      },
    ];
    return {
      memberUserId: target,
      checklist,
      assets,
      closable: profile?.status === 'LEFT' && checklist.every((item) => !item.pending),
      profileStatus: profile?.status || '',
    };
  }

  /**
   * 移交：客户负责人 / 项目负责人 / 项目成员批量改派给接手人，并给接手人派一条交接任务。
   * 在途审批与未办任务不改派（审批要原审批人本人处置、任务要本人交接确认），由接手人按清单跟进。
   */
  async transferHandover(body: TransferHandoverInput, user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const target = await this.scope.requireStaff(org, body.memberUserId, false);
    const toUserId = String(body.toUserId || '').trim();
    if (!toUserId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择接手人');
    }
    if (toUserId === target) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '接手人不能是离职人本人');
    }
    await this.scope.requireStaff(org, toUserId, false);
    const picked = new Set<HandoverAssetKey>(
      body.assets?.length ? body.assets : HANDOVER_TRANSFERABLE,
    );
    for (const key of picked) {
      if (!HANDOVER_TRANSFERABLE.includes(key)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `${HANDOVER_LABELS[key] || key}不支持自动改派，请在对应模块逐条处理`,
        );
      }
    }
    const assets = await this.handoverAssets(org, target);
    const summarize = (key: HandoverAssetKey) =>
      assets.find((item) => item.key === key)?.items || [];
    const moved: Record<string, number> = {};
    const key = { orgType: org.orgType, orgUserId: org.orgUserId };
    if (picked.has('customers')) {
      const rows = summarize('customers');
      if (rows.length) {
        const res = await this.prisma.crmCustomer.updateMany({
          where: { ...key, id: { in: rows.map((row) => Number(row.id)) } },
          data: { ownerId: toUserId },
        });
        moved.customers = res.count;
      }
    }
    if (picked.has('projects')) {
      const rows = summarize('projects');
      if (rows.length) {
        const res = await this.prisma.pjProject.updateMany({
          where: { ...key, id: { in: rows.map((row) => Number(row.id)) } },
          data: { ownerId: toUserId },
        });
        moved.projects = res.count;
      }
    }
    if (picked.has('projectMembers')) {
      const rows = summarize('projectMembers');
      const ids = rows.map((row) => Number(row.id));
      const members = ids.length
        ? await this.prisma.pjProjectMember.findMany({
            where: {
              ...key,
              projectId: { in: ids },
              principalType: 'STAFF',
              principalId: target,
            },
            select: { id: true, projectId: true },
          })
        : [];
      if (members.length) {
        // 接手人已在同一项目里时直接去掉离职人的成员行，避免同项目重复成员。
        const occupied = await this.prisma.pjProjectMember.findMany({
          where: {
            ...key,
            projectId: { in: members.map((row) => row.projectId) },
            principalType: 'STAFF',
            principalId: toUserId,
          },
          select: { id: true, projectId: true },
        });
        const busyProjectIds = new Set(occupied.map((row) => row.projectId));
        const drops = members
          .filter((row) => busyProjectIds.has(row.projectId))
          .map((row) => row.id);
        const moves = members
          .filter((row) => !busyProjectIds.has(row.projectId))
          .map((row) => row.id);
        await this.prisma.$transaction([
          ...(drops.length
            ? [
                this.prisma.pjProjectMember.deleteMany({
                  where: { id: { in: drops } },
                }),
              ]
            : []),
          ...(moves.length
            ? [
                this.prisma.pjProjectMember.updateMany({
                  where: { id: { in: moves } },
                  data: { principalId: toUserId },
                }),
              ]
            : []),
        ]);
        moved.projectMembers = members.length;
      }
    }
    const total = Object.values(moved).reduce((sum, n) => sum + n, 0);
    const name =
      (await this.scope.names([target])).get(target) || target;
    if (this.tasks) {
      await this.tasks.assign({
        assigneeUserId: toUserId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        source: 'hrm',
        // 同一离职人的交接任务只保留一行，反复移交落在同一条任务上。
        sourceId: `handover:${target}`,
        title: `接手 ${name} 的离职交接`,
        description: [
          `已接收：${Object.entries(moved)
            .map(([k, n]) => `${HANDOVER_LABELS[k as HandoverAssetKey] || k} ${n} 项`)
            .join('、') || '无'}`,
          clip(body.note, 300),
        ]
          .filter(Boolean)
          .join('\n'),
        link: '/hrm',
        category: 'task',
        priority: 'NORMAL',
        createdBy: org.actorId,
        sourceStatus: 'HANDOVER',
        sourceStatusLabel: '离职交接',
      });
    }
    if (this.notifications) {
      await this.notifications
        .notify(toUserId, {
          category: 'platform',
          title: `你接手了 ${name} 的离职交接（${total} 项）`,
          body: Object.entries(moved)
            .map(([k, n]) => `${HANDOVER_LABELS[k as HandoverAssetKey] || k}：${n}`)
            .join('；'),
          link: '/hrm',
          level: 'warning',
          entityType: 'hrm_handover',
          entityId: target,
        })
        .catch(() => null);
    }
    return {
      memberUserId: target,
      toUserId,
      moved,
      total,
      name,
    };
  }

  /** 一次取齐待移交资产：客户 / 负责项目 / 参与项目由平台改派，任务与审批只在清单里计数。 */
  private async handoverAssets(
    org: HrmOrg,
    memberUserId: string,
  ): Promise<HandoverAsset[]> {
    const key = { orgType: org.orgType, orgUserId: org.orgUserId };
    const [customers, projects, memberRows] = await Promise.all([
      this.prisma.crmCustomer.findMany({
        where: { ...key, ownerId: memberUserId, deletedAt: null, inPool: false },
        select: { id: true, name: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      this.prisma.pjProject.findMany({
        where: {
          ...key,
          ownerId: memberUserId,
          status: { notIn: ['CLOSED', 'CANCELED'] },
        },
        select: { id: true, name: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      this.prisma.pjProjectMember.findMany({
        where: { ...key, principalType: 'STAFF', principalId: memberUserId },
        select: { id: true, projectId: true },
        take: 200,
      }),
    ]);
    const memberProjectIds = memberRows.map((row) => row.projectId);
    const linkedProjects = memberProjectIds.length
      ? await this.prisma.pjProject.findMany({
          where: {
            ...key,
            id: { in: memberProjectIds },
            status: { notIn: ['CLOSED', 'CANCELED'] },
          },
          select: { id: true, name: true },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        })
      : [];
    const liveProjectIds = [...new Set(memberRows.map((row) => row.projectId))].filter(
      (id) => linkedProjects.some((project) => project.id === id),
    );
    const [taskCount, approvalCount] = await Promise.all([
      this.prisma.myTask.count({
        where: { assigneeUserId: memberUserId, status: { in: ['OPEN', 'DOING'] } },
      }),
      this.prisma.oaTask.count({
        where: { approverId: memberUserId, status: 'PENDING' },
      }),
    ]);
    return [
      {
        key: 'customers',
        label: HANDOVER_LABELS.customers,
        count: customers.length,
        items: customers.map((row) => ({
          id: String(row.id),
          name: row.name,
          link: '/crm',
        })),
        transferable: true,
      },
      {
        key: 'projects',
        label: HANDOVER_LABELS.projects,
        count: projects.length,
        items: projects.map((row) => ({
          id: String(row.id),
          name: row.name,
          link: '/project',
        })),
        transferable: true,
      },
      {
        key: 'projectMembers',
        label: HANDOVER_LABELS.projectMembers,
        count: liveProjectIds.length,
        items: liveProjectIds.map((id) => ({
          id: String(id),
          name: linkedProjects.find((project) => project.id === id)?.name || '',
          link: '/project',
        })),
        transferable: true,
      },
      {
        key: 'tasks',
        label: HANDOVER_LABELS.tasks,
        count: taskCount,
        items: [],
        transferable: false,
      },
      {
        key: 'approvals',
        label: HANDOVER_LABELS.approvals,
        count: approvalCount,
        items: [],
        transferable: false,
      },
    ];
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
