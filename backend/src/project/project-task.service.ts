import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { kbChatMulti, parseJsonObject, resolveKbLlm } from '../kb/kb-llm';
import { json, num } from './project.shared';
import type { PageQuery, Row } from './project.shared';
import { ProjectBase } from './project.base';

/** 任务、依赖与 WBS / AI 排期建议。 */
export class ProjectTaskService extends ProjectBase {
  async listTasks(
    user: CurrentUser,
    query: PageQuery & {
      projectId?: number;
      sprintId?: number;
      status?: string;
      assigneeId?: string;
      q?: string;
    },
  ) {
    const org = await this.org(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.sprintId ? { sprintId: query.sprintId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q } },
              { description: { contains: query.q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.pjTask.count({ where }),
      this.prisma.pjTask.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: await this.taskViews(rows),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async saveTask(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const projectId = num(body.projectId);
    await this.requireProject(org, projectId);
    const assigneeType = ['STAFF', 'ASSIGNMENT', 'PARTY'].includes(
      String(body.assigneeType),
    )
      ? String(body.assigneeType)
      : 'NONE';
    const assigneeId = assigneeType === 'NONE' ? '' : clip(body.assigneeId, 64);
    if (assigneeType === 'STAFF' && assigneeId) {
      await this.scope.requireStaff(org, assigneeId, false);
    }
    if (assigneeType === 'PARTY' && assigneeId) {
      const party = await this.prisma.bizParty.findFirst({
        where: {
          id: Number(assigneeId),
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        },
        select: { id: true },
      });
      if (!party)
        throw new BusinessException(ErrorCode.NOT_FOUND, '外部主体不存在');
    }
    const status = clip(body.status, 16) || 'TODO';
    const acceptance = Array.isArray(body.acceptanceCriteria)
      ? body.acceptanceCriteria
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === 'object',
          )
          .slice(0, 20)
          .map((item, index) => ({
            key: clip(item.key, 64) || `c${index + 1}`,
            label: clip(item.label, 200),
            required: Boolean(item.required),
            evidence: clip(item.evidence, 200),
          }))
          .filter((item) => item.label)
      : [];
    const data = {
      projectId,
      sprintId: num(body.sprintId),
      milestoneId: num(body.milestoneId),
      parentId: num(body.parentId),
      title: clip(body.title, 200),
      description: clip(body.description, 20000),
      sourceType: ['OKR', 'CRM_ORDER', 'DEMAND', 'OA'].includes(
        String(body.sourceType),
      )
        ? String(body.sourceType)
        : 'MANUAL',
      sourceId: clip(body.sourceId, 64),
      acceptanceCriteria: json(acceptance),
      qualityRubric: json(
        body.qualityRubric && typeof body.qualityRubric === 'object'
          ? body.qualityRubric
          : {},
      ),
      assessmentWeight: Math.min(
        100,
        Math.max(0, num(body.assessmentWeight, 1)),
      ),
      type: clip(body.type, 16) || 'TASK',
      priority: clip(body.priority, 16) || 'MEDIUM',
      status,
      assigneeType,
      assigneeId,
      estimateHours: num(body.estimateHours),
      estimatePoints: Math.trunc(num(body.estimatePoints)),
      startDate: clip(body.startDate, 16),
      dueDate: clip(body.dueDate, 16),
      sortOrder: Math.trunc(num(body.sortOrder)),
      completedAt: status === 'DONE' ? new Date() : null,
    };
    if (!data.title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写任务标题');
    const id = num(body.id);
    let row;
    let previousStatus = '';
    if (id) {
      const existing = await this.prisma.pjTask.findFirst({
        where: { id, orgUserId: org.orgUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
      previousStatus = existing.status;
      row = await this.prisma.pjTask.update({
        where: { id },
        data: {
          ...data,
          completedAt:
            status === 'DONE' ? existing.completedAt || new Date() : null,
        },
      });
    } else {
      row = await this.prisma.pjTask.create({
        data: { ...orgKey(org), ...data, createdBy: org.actorId },
      });
    }
    const [view] = await this.taskViews([row]);
    this.emit(org, id ? 'task.updated' : 'task.created', {
      taskId: row.id,
      projectId: row.projectId,
      title: row.title,
      status: row.status,
      assigneeId: row.assigneeId,
    });
    this.emitTaskTransition(org, row, previousStatus);
    return view;
  }

  async moveTask(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const existing = await this.prisma.pjTask.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    const status = clip(body.status, 16);
    const row = await this.prisma.pjTask.update({
      where: { id },
      data: {
        status,
        ...(body.sortOrder === undefined
          ? {}
          : { sortOrder: Math.trunc(num(body.sortOrder)) }),
        completedAt:
          status === 'DONE' ? existing.completedAt || new Date() : null,
      },
    });
    const [view] = await this.taskViews([row]);
    this.emit(org, 'task.moved', {
      taskId: row.id,
      projectId: row.projectId,
      status,
    });
    this.emitTaskTransition(org, row, existing.status);
    return view;
  }

  async removeTask(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.pjTask.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    await this.prisma.pjTaskRelation.deleteMany({
      where: { OR: [{ taskId: id }, { relatedTaskId: id }] },
    });
    await this.prisma.pjTask.updateMany({
      where: { parentId: id },
      data: { parentId: 0 },
    });
    await this.prisma.pjTask.delete({ where: { id } });
    return { id };
  }

  async addRelation(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const taskId = num(body.taskId);
    const relatedTaskId = num(body.relatedTaskId);
    if (!taskId || !relatedTaskId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择关联任务');
    const exists = await this.prisma.pjTaskRelation.findFirst({
      where: { taskId, relatedTaskId, kind: clip(body.kind, 8) || 'FS' },
    });
    if (exists) return { id: exists.id };
    const row = await this.prisma.pjTaskRelation.create({
      data: {
        ...orgKey(org),
        taskId,
        relatedTaskId,
        kind: clip(body.kind, 8) || 'FS',
      },
    });
    return { id: row.id };
  }

  async removeRelation(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.pjTaskRelation.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '关联不存在');
    await this.prisma.pjTaskRelation.delete({ where: { id } });
    return { id };
  }

  async wbsSuggest(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const project = await this.requireProject(org, num(body.projectId));
    const requirement = clip(body.requirement, 2000);
    const maxTasks = Math.min(
      30,
      Math.max(1, Math.trunc(num(body.maxTasks, 8))),
    );
    const channel = await resolveKbLlm(this.prisma, user.userId);
    const llm = await kbChatMulti(
      channel,
      [
        {
          role: 'system',
          content:
            '你是项目拆解助手。把需求拆成可执行任务，只输出 JSON：{"tasks":[{"title":"","type":"STORY|TASK|BUG","priority":"LOW|MEDIUM|HIGH|URGENT","estimateHours":8,"reason":""}]}。',
        },
        {
          role: 'user',
          content: `项目：${project.name}\n需求：${requirement}\n最多 ${maxTasks} 个任务。`,
        },
      ],
      user.userId,
      1200,
    );
    if (llm) {
      const parsed = parseJsonObject(llm.reply);
      const tasks = Array.isArray(parsed?.tasks) ? (parsed.tasks as Row[]) : [];
      if (tasks.length) {
        await this.aiEval
          .chargeByUsage(
            user.userId,
            'insight_report',
            {
              tokenIn: llm.promptTokens,
              tokenOut: llm.completionTokens,
              call: 1,
            },
            `wbs:${project.id}`,
          )
          .catch(() => undefined);
        return {
          mode: 'llm' as const,
          tasks: tasks.slice(0, maxTasks).map((item) => ({
            title: clip(item.title, 200),
            type: ['STORY', 'TASK', 'BUG'].includes(String(item.type))
              ? String(item.type)
              : 'TASK',
            priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(
              String(item.priority),
            )
              ? String(item.priority)
              : 'MEDIUM',
            estimateHours: Math.min(
              200,
              Math.max(0, num(item.estimateHours, 8)),
            ),
            assigneeId: '',
            assigneeName: '',
            reason: clip(item.reason, 300),
          })),
        };
      }
    }
    // 规则式回落：按需求里的分句/条目切任务，首条作为需求，其余作为任务。
    const parts = requirement
      .split(/[\n；;。]/)
      .map((item) => item.replace(/^[\s\d.、)）]+/, '').trim())
      .filter(Boolean)
      .slice(0, maxTasks);
    const tasks = (parts.length ? parts : [requirement]).map(
      (title, index) => ({
        title,
        type: index === 0 ? 'STORY' : 'TASK',
        priority: 'MEDIUM',
        estimateHours: 8,
        assigneeId: '',
        assigneeName: '',
        reason: index === 0 ? '需求主条目' : '按需求分句拆出的执行项',
      }),
    );
    return { mode: 'rule' as const, tasks };
  }
}
