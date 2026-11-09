import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { ds } from '../hrm/hrm.helpers';
import { OPEN_TASK_STATUSES, num, today } from './project.shared';
import type { Row } from './project.shared';

/** §5.2 项目公共依赖与视图工具。 */
export abstract class ProjectBase {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly scope: HrmScopeService,
    protected readonly mechanisms: MechanismService,
    protected readonly aiEval: AiEvalService,
  ) {}

  protected async org(user: CurrentUser): Promise<HrmOrg> {
    return this.scope.resolve(user);
  }

  protected emit(org: HrmOrg, event: string, payload: Row) {
    void this.mechanisms.dispatch(org, event, payload).catch(() => undefined);
  }

  protected async names(ids: string[]): Promise<Map<string, string>> {
    return this.scope.names(ids.filter((id) => /^\d+$/.test(id)));
  }

  protected projectView(
    row: {
      id: number;
      code: string;
      name: string;
      description: string;
      source: string;
      sourceRef: string;
      customerName: string;
      contractId: number;
      ownerId: string;
      status: string;
      startDate: string;
      endDate: string;
      budgetAmount: unknown;
      budgetHours: unknown;
      currency: string;
      createdAt: Date;
      updatedAt: Date;
    },
    counts: {
      memberCount?: number;
      taskTotal?: number;
      taskDone?: number;
    } = {},
    ownerName = '',
  ) {
    const taskTotal = counts.taskTotal || 0;
    const taskDone = counts.taskDone || 0;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      source: row.source,
      sourceRef: row.sourceRef,
      customerName: row.customerName,
      contractId: row.contractId,
      ownerId: row.ownerId,
      ownerName,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      budgetAmount: ds(row.budgetAmount),
      budgetHours: ds(row.budgetHours),
      currency: row.currency,
      memberCount: counts.memberCount || 0,
      taskTotal,
      taskDone,
      progress: taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  protected async countMaps(org: HrmOrg, projectIds: number[]) {
    if (!projectIds.length) {
      return {
        members: new Map<number, number>(),
        tasks: new Map<number, { total: number; done: number }>(),
      };
    }
    const [members, tasks] = await Promise.all([
      this.prisma.pjProjectMember.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      this.prisma.pjTask.groupBy({
        by: ['projectId', 'status'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
    ]);
    const membersMap = new Map(
      members.map((row) => [row.projectId, row._count._all]),
    );
    const taskMap = new Map<number, { total: number; done: number }>();
    for (const row of tasks) {
      const entry = taskMap.get(row.projectId) || { total: 0, done: 0 };
      entry.total += row._count._all;
      if (row.status === 'DONE') entry.done += row._count._all;
      taskMap.set(row.projectId, entry);
    }
    return { members: membersMap, tasks: taskMap };
  }

  protected async requireProject(org: HrmOrg, id: number) {
    const row = await this.prisma.pjProject.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '项目不存在');
    return row;
  }

  protected sprintView(
    row: {
      id: number;
      projectId: number;
      name: string;
      goal: string;
      startDate: string;
      endDate: string;
      capacityHours: unknown;
      status: string;
      createdAt: Date;
    },
    taskTotal = 0,
    taskDone = 0,
  ) {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      goal: row.goal,
      startDate: row.startDate,
      endDate: row.endDate,
      capacityHours: ds(row.capacityHours),
      status: row.status,
      taskTotal,
      taskDone,
      createdAt: row.createdAt.toISOString(),
    };
  }

  protected milestoneView(row: {
    id: number;
    projectId: number;
    name: string;
    dueDate: string;
    status: string;
    deliverable: string;
    acceptanceNote: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      dueDate: row.dueDate,
      status: row.status,
      deliverable: row.deliverable,
      acceptanceNote: row.acceptanceNote,
      createdAt: row.createdAt.toISOString(),
    };
  }

  protected async taskViews(
    rows: Array<{
      id: number;
      projectId: number;
      sprintId: number;
      milestoneId: number;
      parentId: number;
      title: string;
      description: string;
      sourceType: string;
      sourceId: string;
      acceptanceCriteria: unknown;
      qualityRubric: unknown;
      assessmentWeight: unknown;
      type: string;
      priority: string;
      status: string;
      assigneeType: string;
      assigneeId: string;
      estimateHours: unknown;
      estimatePoints: number;
      startDate: string;
      dueDate: string;
      completedAt: Date | null;
      sortOrder: number;
      loggedMinutes: number;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ) {
    if (!rows.length) return [];
    const partyIds = rows
      .filter((row) => row.assigneeType === 'PARTY')
      .map((row) => Number(row.assigneeId))
      .filter((id) => Number.isInteger(id) && id > 0);
    const [projects, relations, names, parties] = await Promise.all([
      this.prisma.pjProject.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.projectId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.pjTaskRelation.findMany({
        where: { taskId: { in: rows.map((r) => r.id) } },
      }),
      this.names(
        rows
          .filter((row) => row.assigneeType !== 'PARTY')
          .map((row) => row.assigneeId),
      ),
      partyIds.length
        ? this.prisma.bizParty.findMany({
            where: { id: { in: partyIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const partyNames = new Map(
      parties.map((party) => [String(party.id), party.name]),
    );
    const relationsByTask = new Map<
      number,
      { id: number; relatedTaskId: number; kind: string }[]
    >();
    for (const rel of relations) {
      const list = relationsByTask.get(rel.taskId) || [];
      list.push({
        id: rel.id,
        relatedTaskId: rel.relatedTaskId,
        kind: rel.kind,
      });
      relationsByTask.set(rel.taskId, list);
    }
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectName: projectNames.get(row.projectId) || '',
      sprintId: row.sprintId,
      milestoneId: row.milestoneId,
      parentId: row.parentId,
      title: row.title,
      description: row.description,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      acceptanceCriteria: Array.isArray(row.acceptanceCriteria)
        ? row.acceptanceCriteria
        : [],
      qualityRubric:
        row.qualityRubric && typeof row.qualityRubric === 'object'
          ? row.qualityRubric
          : {},
      assessmentWeight: ds(row.assessmentWeight),
      type: row.type,
      priority: row.priority,
      status: row.status,
      assigneeType: row.assigneeType,
      assigneeId: row.assigneeId,
      assigneeName:
        row.assigneeType === 'PARTY'
          ? partyNames.get(row.assigneeId) || ''
          : names.get(row.assigneeId) || '',
      estimateHours: ds(row.estimateHours),
      estimatePoints: row.estimatePoints,
      startDate: row.startDate,
      dueDate: row.dueDate,
      completedAt: row.completedAt ? row.completedAt.toISOString() : '',
      sortOrder: row.sortOrder,
      loggedMinutes: row.loggedMinutes,
      relations: relationsByTask.get(row.id) || [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  protected emitTaskTransition(
    org: HrmOrg,
    row: { id: number; projectId: number; title: string; status: string },
    previousStatus: string,
  ) {
    if (row.status === 'DONE' && previousStatus !== 'DONE') {
      this.emit(org, 'task.completed', {
        taskId: row.id,
        projectId: row.projectId,
        title: row.title,
        status: row.status,
        source: 'project',
        sourceId: String(row.id),
      });
    } else if (previousStatus === 'DONE' && row.status !== 'DONE') {
      this.emit(org, 'task.reopened', {
        taskId: row.id,
        projectId: row.projectId,
        title: row.title,
        status: row.status,
        source: 'project',
        sourceId: String(row.id),
      });
    }
  }

  protected async riskOf(
    org: HrmOrg,
    project: {
      id: number;
      name: string;
      status: string;
      endDate: string;
      budgetHours: unknown;
    },
  ) {
    const [totalTasks, overdueTasks, doneTasks, logAgg] = await Promise.all([
      this.prisma.pjTask.count({
        where: { projectId: project.id, status: { not: 'CANCELED' } },
      }),
      this.prisma.pjTask.count({
        where: {
          projectId: project.id,
          status: { in: OPEN_TASK_STATUSES },
          dueDate: { not: '', lt: today() },
        },
      }),
      this.prisma.pjTask.count({
        where: { projectId: project.id, status: 'DONE' },
      }),
      this.prisma.pjTimeLog.aggregate({
        where: {
          projectId: project.id,
          status: { in: ['SUBMITTED', 'APPROVED'] },
        },
        _sum: { durationMinutes: true },
      }),
    ]);
    const loggedMinutes = logAgg._sum.durationMinutes || 0;
    const budgetMinutes = Math.round(num(project.budgetHours) * 60);
    const reasons: string[] = [];
    const suggestions: string[] = [];
    let level: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (overdueTasks > 0) {
      level = overdueTasks > 3 ? 'HIGH' : 'MEDIUM';
      reasons.push(`${overdueTasks} 个任务已逾期`);
      suggestions.push('先处理逾期任务：重新排期或调整负责人');
    }
    if (
      project.endDate &&
      project.endDate < today() &&
      project.status !== 'CLOSED'
    ) {
      level = 'HIGH';
      reasons.push('项目已过计划结束日期仍未关闭');
      suggestions.push('确认是否延期或进入验收流程');
    }
    if (budgetMinutes && loggedMinutes > budgetMinutes) {
      if (level === 'LOW') level = 'MEDIUM';
      reasons.push(
        `已登记工时 ${Math.round(loggedMinutes / 60)}h 超过预算 ${Math.round(budgetMinutes / 60)}h`,
      );
      suggestions.push('复核工时投入与范围变更');
    }
    if (
      totalTasks &&
      doneTasks / totalTasks < 0.3 &&
      project.status === 'ACTIVE'
    ) {
      if (level === 'LOW') level = 'MEDIUM';
      reasons.push(`完成率仅 ${Math.round((doneTasks / totalTasks) * 100)}%`);
      suggestions.push('检查阻塞项，拆小任务并明确负责人');
    }
    if (!reasons.length) {
      reasons.push('进度、工时与交付日期均在计划内');
      suggestions.push('保持当前节奏，按里程碑验收');
    }
    return {
      projectId: project.id,
      projectName: project.name,
      riskLevel: level,
      reasons,
      suggestions,
      overdueTasks,
      totalTasks,
      loggedMinutes,
      budgetMinutes,
    };
  }

  protected async timeLogViews(
    rows: Array<{
      id: number;
      projectId: number;
      taskId: number;
      principalType: string;
      principalId: string;
      workDate: string;
      startAt: string;
      endAt: string;
      durationMinutes: number;
      note: string;
      source: string;
      status: string;
      approvedBy: string;
      approvedAt: Date | null;
      createdAt: Date;
    }>,
  ) {
    if (!rows.length) return [];
    const [projects, tasks, names] = await Promise.all([
      this.prisma.pjProject.findMany({
        where: {
          id: {
            in: [...new Set(rows.map((r) => r.projectId).filter(Boolean))],
          },
        },
        select: { id: true, name: true },
      }),
      this.prisma.pjTask.findMany({
        where: {
          id: { in: [...new Set(rows.map((r) => r.taskId).filter(Boolean))] },
        },
        select: { id: true, title: true },
      }),
      this.names(rows.map((row) => row.principalId)),
    ]);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const taskTitles = new Map(tasks.map((t) => [t.id, t.title]));
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectName: projectNames.get(row.projectId) || '',
      taskId: row.taskId,
      taskTitle: taskTitles.get(row.taskId) || '',
      principalType: row.principalType,
      principalId: row.principalId,
      principalName: names.get(row.principalId) || '',
      workDate: row.workDate,
      startAt: row.startAt,
      endAt: row.endAt,
      durationMinutes: row.durationMinutes,
      note: row.note,
      source: row.source,
      status: row.status,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : '',
      createdAt: row.createdAt.toISOString(),
    }));
  }

  protected async timesheetView(row: {
    id: number;
    principalType: string;
    principalId: string;
    projectId: number;
    periodStart: string;
    periodEnd: string;
    totalMinutes: number;
    status: string;
    approverId: string;
    decidedAt: Date | null;
    note: string;
    createdAt: Date;
  }) {
    const [names, project] = await Promise.all([
      this.names([row.principalId]),
      row.projectId
        ? this.prisma.pjProject.findUnique({
            where: { id: row.projectId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      id: row.id,
      principalType: row.principalType,
      principalId: row.principalId,
      principalName: names.get(row.principalId) || '',
      projectId: row.projectId,
      projectName: project?.name || '全部项目',
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      totalMinutes: row.totalMinutes,
      status: row.status,
      approverId: row.approverId,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : '',
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  protected async settingsRow(org: HrmOrg) {
    const existing = await this.prisma.pjSettings.findUnique({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
    });
    if (existing) return existing;
    return this.prisma.pjSettings.create({
      data: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
  }
}
