import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { recordTimeLogEdit } from '../gaps/time-audit.service';
import { num } from './project.shared';
import type { PageQuery, Row } from './project.shared';
import { ProjectBase } from './project.base';

/** 工时、计时器与周表。 */
export class ProjectTimeService extends ProjectBase {
  async listTimeLogs(
    user: CurrentUser,
    query: PageQuery & {
      projectId?: number;
      taskId?: number;
      principalId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    },
  ) {
    const org = await this.org(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.taskId ? { taskId: query.taskId } : {}),
      ...(query.principalId ? { principalId: query.principalId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.startDate || query.endDate
        ? {
            workDate: {
              ...(query.startDate ? { gte: query.startDate } : {}),
              ...(query.endDate ? { lte: query.endDate } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.pjTimeLog.count({ where }),
      this.prisma.pjTimeLog.findMany({
        where,
        orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: await this.timeLogViews(rows),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async addTimeLog(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const projectId = num(body.projectId);
    await this.requireProject(org, projectId);
    const workDate = clip(body.workDate, 16).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择工时日期');
    }
    const row = await this.prisma.pjTimeLog.create({
      data: {
        ...orgKey(org),
        projectId,
        taskId: num(body.taskId),
        principalType: 'STAFF',
        principalId: org.actorId,
        workDate,
        startAt: clip(body.startAt, 32),
        endAt: clip(body.endAt, 32),
        durationMinutes: Math.min(
          1440,
          Math.max(0, Math.trunc(num(body.durationMinutes))),
        ),
        note: clip(body.note, 500),
        source: ['TIMER', 'MANUAL', 'FEISHU', 'WECOM'].includes(
          String(body.source),
        )
          ? String(body.source)
          : 'MANUAL',
        status: 'DRAFT',
        createdBy: org.actorId,
      },
    });
    const [view] = await this.timeLogViews([row]);
    this.emit(org, 'timesheet.created', {
      timeLogId: row.id,
      projectId,
      minutes: row.durationMinutes,
    });
    return view;
  }

  async startTimer(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const projectId = num(body.projectId);
    await this.requireProject(org, projectId);
    // 同一人只允许一个计时器：先把上一段自动结算，避免时间重复计入。
    const running = await this.prisma.pjTimeLog.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        principalId: org.actorId,
        running: true,
      },
      orderBy: { id: 'desc' },
    });
    if (running)
      await this.stopTimer(user, {
        id: running.id,
        note: '自动停止上一段计时',
      });
    const now = new Date();
    const row = await this.prisma.pjTimeLog.create({
      data: {
        ...orgKey(org),
        projectId,
        taskId: num(body.taskId),
        principalType: 'STAFF',
        principalId: org.actorId,
        workDate: now.toISOString().slice(0, 10),
        startAt: now.toISOString(),
        endAt: '',
        durationMinutes: 0,
        note: clip(body.note, 500),
        source: 'TIMER',
        status: 'DRAFT',
        running: true,
        startedAt: now,
        createdBy: org.actorId,
      },
    });
    const [view] = await this.timeLogViews([row]);
    return view;
  }

  async stopTimer(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.pjTimeLog.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '计时记录不存在');
    const now = new Date();
    const elapsed =
      row.running && row.startedAt
        ? Math.round((now.getTime() - row.startedAt.getTime()) / 60_000)
        : 0;
    const minutes =
      body.durationMinutes === undefined
        ? Math.max(1, Math.min(1440, elapsed))
        : Math.min(1440, Math.max(0, Math.trunc(num(body.durationMinutes))));
    const updated = await this.prisma.pjTimeLog.update({
      where: { id },
      data: {
        endAt: now.toISOString(),
        durationMinutes: minutes,
        running: false,
        note: body.note === undefined ? row.note : clip(body.note, 500),
        status: row.status === 'DRAFT' ? 'SUBMITTED' : row.status,
      },
    });
    const task = updated.taskId
      ? await this.prisma.pjTask.findUnique({ where: { id: updated.taskId } })
      : null;
    if (task) {
      await this.prisma.pjTask.update({
        where: { id: task.id },
        data: { loggedMinutes: { increment: Math.max(0, minutes) } },
      });
    }
    const [view] = await this.timeLogViews([updated]);
    await recordTimeLogEdit(this.prisma, org, {
      timeLogId: updated.id,
      action: 'UPDATE',
      before: {
        durationMinutes: row.durationMinutes,
        note: row.note,
        status: row.status,
        running: row.running,
      },
      after: {
        durationMinutes: updated.durationMinutes,
        note: updated.note,
        status: updated.status,
        running: updated.running,
      },
      reason: '结束计时',
    });
    this.emit(org, 'timesheet.updated', { timeLogId: updated.id, minutes });
    return view;
  }

  async decideTimeLog(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const id = num(body.id);
    const row = await this.prisma.pjTimeLog.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '工时记录不存在');
    if (row.running)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '计时尚未结束，不能审批',
      );
    const approved = body.decision === 'approve';
    const updated = await this.prisma.pjTimeLog.update({
      where: { id },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        approvedBy: org.actorId,
        approvedAt: new Date(),
        note: row.note || clip(body.note, 500),
      },
    });
    // 审批通过才计入任务已登记工时；驳回则回退（若此前已计入）。
    if (updated.taskId) {
      const delta = approved
        ? updated.durationMinutes
        : -updated.durationMinutes;
      if (approved) {
        await this.prisma.pjTask.update({
          where: { id: updated.taskId },
          data: { loggedMinutes: { increment: delta } },
        });
      } else {
        await this.prisma.pjTask.update({
          where: { id: updated.taskId },
          data: { loggedMinutes: { decrement: Math.max(0, delta * -1) } },
        });
      }
    }
    const [view] = await this.timeLogViews([updated]);
    await recordTimeLogEdit(this.prisma, org, {
      timeLogId: updated.id,
      action: approved ? 'APPROVE' : 'REJECT',
      before: { status: row.status, durationMinutes: row.durationMinutes },
      after: {
        status: updated.status,
        durationMinutes: updated.durationMinutes,
      },
      reason: clip(body.note, 500),
    });
    return view;
  }

  async removeTimeLog(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.pjTimeLog.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '工时记录不存在');
    if (row.principalId !== org.actorId) this.scope.requireAdmin(org);
    if (row.status === 'APPROVED' && row.taskId) {
      await this.prisma.pjTask.update({
        where: { id: row.taskId },
        data: { loggedMinutes: { decrement: row.durationMinutes } },
      });
    }
    await this.prisma.pjTimeLog.delete({ where: { id } });
    await recordTimeLogEdit(this.prisma, org, {
      timeLogId: id,
      action: 'DELETE',
      before: {
        durationMinutes: row.durationMinutes,
        note: row.note,
        status: row.status,
        principalId: row.principalId,
        workDate: row.workDate,
      },
    });
    return { id };
  }

  async listTimesheets(
    user: CurrentUser,
    query: PageQuery & {
      principalId?: string;
      status?: string;
      periodStart?: string;
    },
  ) {
    const org = await this.org(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.principalId ? { principalId: query.principalId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.periodStart ? { periodStart: query.periodStart } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.pjTimesheet.count({ where }),
      this.prisma.pjTimesheet.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: await Promise.all(rows.map((row) => this.timesheetView(row))),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async generateTimesheet(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const principalType =
      body.principalType === 'ASSIGNMENT' ? 'ASSIGNMENT' : 'STAFF';
    const principalId = clip(body.principalId, 64) || org.actorId;
    if (principalType === 'STAFF')
      await this.scope.requireStaff(org, principalId, true);
    const periodStart = clip(body.periodStart, 16).slice(0, 10);
    const periodEnd = clip(body.periodEnd, 16).slice(0, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
      periodEnd < periodStart
    ) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '周表周期无效');
    }
    const agg = await this.prisma.pjTimeLog.aggregate({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        principalType,
        principalId,
        workDate: { gte: periodStart, lte: periodEnd },
        status: { in: ['SUBMITTED', 'APPROVED'] },
      },
      _sum: { durationMinutes: true },
    });
    const row = await this.prisma.pjTimesheet.upsert({
      where: {
        orgType_orgUserId_principalType_principalId_projectId_periodStart_periodEnd:
          {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            principalType,
            principalId,
            projectId: 0,
            periodStart,
            periodEnd,
          },
      },
      create: {
        ...orgKey(org),
        principalType,
        principalId,
        projectId: 0,
        periodStart,
        periodEnd,
        totalMinutes: agg._sum.durationMinutes || 0,
        status: 'SUBMITTED',
        createdBy: org.actorId,
      },
      update: {
        totalMinutes: agg._sum.durationMinutes || 0,
        status: 'SUBMITTED',
      },
    });
    this.emit(org, 'timesheet.generated', {
      timesheetId: row.id,
      principalId,
      minutes: row.totalMinutes,
    });
    return this.timesheetView(row);
  }

  async decideTimesheet(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const id = num(body.id);
    const row = await this.prisma.pjTimesheet.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '周表不存在');
    const approved = body.decision === 'approve';
    const updated = await this.prisma.pjTimesheet.update({
      where: { id },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        approverId: org.actorId,
        decidedAt: new Date(),
        note: clip(body.note, 500),
      },
    });
    return this.timesheetView(updated);
  }
}
