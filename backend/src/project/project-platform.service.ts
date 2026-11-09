import type { CurrentUser } from '../auth/current-user';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { OPEN_TASK_STATUSES, json, num, strArr, today } from './project.shared';
import type { Row } from './project.shared';
import { ProjectBase } from './project.base';

/** 项目概览与设置。 */
export class ProjectPlatformService extends ProjectBase {
  async overview(user: CurrentUser) {
    const org = await this.org(user);
    const weekStart = (() => {
      const now = new Date();
      const day = now.getUTCDay();
      const offset = day === 0 ? 6 : day - 1;
      return new Date(now.getTime() - offset * 86_400_000)
        .toISOString()
        .slice(0, 10);
    })();
    const [
      activeProjects,
      openTasks,
      overdueTasks,
      weekAgg,
      logPending,
      timesheetPending,
      members,
      projects,
    ] = await Promise.all([
      this.prisma.pjProject.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          status: 'ACTIVE',
        },
      }),
      this.prisma.pjTask.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          status: { in: OPEN_TASK_STATUSES },
        },
      }),
      this.prisma.pjTask.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          status: { in: OPEN_TASK_STATUSES },
          dueDate: { not: '', lt: today() },
        },
      }),
      this.prisma.pjTimeLog.aggregate({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          workDate: { gte: weekStart },
          status: { in: ['SUBMITTED', 'APPROVED'] },
        },
        _sum: { durationMinutes: true },
      }),
      this.prisma.pjTimeLog.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          status: 'SUBMITTED',
        },
      }),
      this.prisma.pjTimesheet.count({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          status: 'SUBMITTED',
        },
      }),
      this.prisma.pjProjectMember.count({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
      this.prisma.pjProject.findMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          status: { in: ['ACTIVE', 'ACCEPTING'] },
        },
      }),
    ]);
    const weekLoggedMinutes = weekAgg._sum.durationMinutes || 0;
    const capacity = Math.max(1, members || 1) * 40 * 60;
    const utilization = Math.min(
      200,
      Math.round((weekLoggedMinutes / capacity) * 1000) / 10,
    );
    let riskProjects = 0;
    for (const project of projects) {
      const risk = await this.riskOf(org, project);
      if (risk.riskLevel !== 'LOW') riskProjects += 1;
    }
    return {
      activeProjects,
      openTasks,
      overdueTasks,
      weekLoggedMinutes,
      approvalPending: logPending + timesheetPending,
      utilization,
      riskProjects,
    };
  }

  async settingsGet(user: CurrentUser) {
    const org = await this.org(user);
    const row = await this.settingsRow(org);
    return {
      statuses: strArr(row.statuses).length
        ? strArr(row.statuses)
        : ['TODO', 'DOING', 'REVIEW', 'DONE', 'CANCELED'],
      taskTypes: strArr(row.taskTypes).length
        ? strArr(row.taskTypes)
        : ['STORY', 'TASK', 'BUG', 'TIMESHEET'],
      currency: row.currency,
      standardHoursPerDay: row.standardHoursPerDay,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async settingsSave(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const row = await this.prisma.pjSettings.upsert({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
      create: {
        ...orgKey(org),
        statuses: json(strArr(body.statuses)),
        taskTypes: json(strArr(body.taskTypes)),
        currency: clip(body.currency, 8) || 'CNY',
        standardHoursPerDay: Math.min(
          24,
          Math.max(1, Math.trunc(num(body.standardHoursPerDay, 8))),
        ),
      },
      update: {
        statuses: json(strArr(body.statuses)),
        taskTypes: json(strArr(body.taskTypes)),
        currency: clip(body.currency, 8) || 'CNY',
        standardHoursPerDay: Math.min(
          24,
          Math.max(1, Math.trunc(num(body.standardHoursPerDay, 8))),
        ),
      },
    });
    return {
      statuses: strArr(row.statuses),
      taskTypes: strArr(row.taskTypes),
      currency: row.currency,
      standardHoursPerDay: row.standardHoursPerDay,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
