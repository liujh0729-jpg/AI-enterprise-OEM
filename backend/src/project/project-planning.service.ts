import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { num } from './project.shared';
import type { Row } from './project.shared';
import { ProjectBase } from './project.base';

/** 迭代与里程碑。 */
export class ProjectPlanningService extends ProjectBase {
  async listSprints(user: CurrentUser, query: { projectId?: number }) {
    const org = await this.org(user);
    const rows = await this.prisma.pjSprint.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        ...(query.projectId ? { projectId: query.projectId } : {}),
      },
      orderBy: { id: 'desc' },
    });
    const ids = rows.map((row) => row.id);
    const tasks = ids.length
      ? await this.prisma.pjTask.groupBy({
          by: ['sprintId', 'status'],
          where: { sprintId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const map = new Map<number, { total: number; done: number }>();
    for (const row of tasks) {
      const entry = map.get(row.sprintId) || { total: 0, done: 0 };
      entry.total += row._count._all;
      if (row.status === 'DONE') entry.done += row._count._all;
      map.set(row.sprintId, entry);
    }
    return rows.map((row) =>
      this.sprintView(row, map.get(row.id)?.total, map.get(row.id)?.done),
    );
  }

  async saveSprint(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const projectId = num(body.projectId);
    await this.requireProject(org, projectId);
    const data = {
      projectId,
      name: clip(body.name, 80),
      goal: clip(body.goal, 500),
      startDate: clip(body.startDate, 16),
      endDate: clip(body.endDate, 16),
      capacityHours: num(body.capacityHours),
      status: ['PLANNED', 'ACTIVE', 'CLOSED'].includes(String(body.status))
        ? String(body.status)
        : 'PLANNED',
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写迭代名称');
    const id = num(body.id);
    if (id) {
      const existing = await this.prisma.pjSprint.findFirst({
        where: { id, projectId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '迭代不存在');
      return this.sprintView(
        await this.prisma.pjSprint.update({ where: { id }, data }),
      );
    }
    return this.sprintView(
      await this.prisma.pjSprint.create({ data: { ...orgKey(org), ...data } }),
    );
  }

  async removeSprint(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.pjSprint.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '迭代不存在');
    await this.prisma.pjTask.updateMany({
      where: { sprintId: id },
      data: { sprintId: 0 },
    });
    await this.prisma.pjSprint.delete({ where: { id } });
    return { id };
  }

  async listMilestones(user: CurrentUser, query: { projectId?: number }) {
    const org = await this.org(user);
    const rows = await this.prisma.pjMilestone.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        ...(query.projectId ? { projectId: query.projectId } : {}),
      },
      orderBy: { dueDate: 'asc' },
    });
    return rows.map((row) => this.milestoneView(row));
  }

  async saveMilestone(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const projectId = num(body.projectId);
    await this.requireProject(org, projectId);
    const data = {
      projectId,
      name: clip(body.name, 120),
      dueDate: clip(body.dueDate, 16),
      status: body.status === 'DONE' ? 'DONE' : 'TODO',
      deliverable: clip(body.deliverable, 500),
      acceptanceNote: clip(body.acceptanceNote, 500),
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写里程碑名称');
    const id = num(body.id);
    if (id) {
      const existing = await this.prisma.pjMilestone.findFirst({
        where: { id, projectId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '里程碑不存在');
      return this.milestoneView(
        await this.prisma.pjMilestone.update({ where: { id }, data }),
      );
    }
    return this.milestoneView(
      await this.prisma.pjMilestone.create({
        data: { ...orgKey(org), ...data },
      }),
    );
  }

  async removeMilestone(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.pjMilestone.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '里程碑不存在');
    await this.prisma.pjTask.updateMany({
      where: { milestoneId: id },
      data: { milestoneId: 0 },
    });
    await this.prisma.pjMilestone.delete({ where: { id } });
    return { id };
  }
}
