import { OKR_REPORT_KIND_LABELS } from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  clamp,
  dateAt,
  dateOrNull,
  int,
  jsonObject,
  num,
  progressOf,
} from './okr.helpers';
import {
  PLAN_KINDS,
  PLAN_STATUSES,
  PRIORITIES,
  REPORT_KINDS,
  REPORT_SOURCES,
} from './okr.types';
import { OkrBase } from './okr.base';

/** OKR 计划与日报周报。 */
export class OkrExecutionService extends OkrBase {
  async planGenerate(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = kindRaw === 'DAY' ? 'DAY' : 'WEEK';
    const raw = text(body['memberUserId']).trim();
    const memberUserId =
      raw || (ctx.actorId === ctx.ownerUserId ? '' : ctx.actorId);
    this.scope.assertCanWriteMember(ctx, raw || ctx.actorId);
    const cycleId = int(body['cycleId']);
    const cycle =
      cycleId > 0
        ? await this.cycleOf(ctx.ownerUserId, cycleId)
        : await this.currentCycle(ctx.ownerUserId);
    const period = this.periodOf(kind, ctx.settings.weekStart);
    const notes: string[] = [];
    const plans: Record<string, unknown>[] = [];
    if (cycle) {
      const objectives = await this.prisma.okrObjective.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          cycleId: cycle.id,
          ownerMemberUserId: memberUserId,
          status: 'ACTIVE',
        },
        orderBy: { id: 'asc' },
      });
      const krRows = objectives.length
        ? await this.prisma.okrKeyResult.findMany({
            where: {
              ownerUserId: ctx.ownerUserId,
              objectiveId: { in: objectives.map((row) => row.id) },
            },
            orderBy: [{ objectiveId: 'asc' }, { id: 'asc' }],
          })
        : [];
      for (const kr of krRows) {
        const objective = objectives.find((row) => row.id === kr.objectiveId);
        if (!objective) continue;
        const progress = progressOf(
          kr.direction,
          num(kr.startValue),
          num(kr.currentValue),
          num(kr.targetValue),
        );
        if (progress >= 100 || plans.length >= 6) continue;
        plans.push({
          title: `推进：${kr.title}`.slice(0, 200),
          detail:
            `目标：${objective.title}｜当前 ${num(kr.currentValue)}/${num(kr.targetValue)}${kr.unit}`.slice(
              0,
              2000,
            ),
          kind,
          periodKey: period.key,
          startDate: period.start,
          dueDate: period.end,
          priority: progress < 30 ? 'HIGH' : 'MEDIUM',
          krId: kr.id,
          objectiveId: objective.id,
        });
      }
    }
    const previous = this.previousPeriod(kind, ctx.settings.weekStart);
    const carried = await this.prisma.okrPlan.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        memberUserId,
        kind,
        periodKey: previous,
        status: { in: ['TODO', 'DOING'] },
      },
      orderBy: { id: 'asc' },
      take: 10,
    });
    for (const plan of carried) {
      if (plans.length >= 10) break;
      plans.push({
        title: `继续：${plan.title}`.slice(0, 200),
        detail: plan.detail,
        kind,
        periodKey: period.key,
        startDate: period.start,
        dueDate: period.end,
        priority: plan.priority,
        krId: plan.krId,
        objectiveId: plan.objectiveId,
      });
    }
    if (!plans.length) {
      notes.push(
        '当前没有未完成的 KR 或计划，请先在「目标」页签建立目标与 KR。',
      );
    } else {
      notes.push(
        `已按 KR 进度与上一${kind === 'WEEK' ? '周' : '日'}未完成计划生成 ${plans.length} 条草稿，可增删后再保存。`,
      );
    }
    return { periodKey: period.key, plans, notes };
  }

  async planList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const self = this.selfKey(ctx);
    const requested = text(query['memberUserId']).trim();
    const memberUserId =
      ctx.isOwner || ctx.isManager ? requested || self : self;
    const where: Prisma.OkrPlanWhereInput = {
      ownerUserId: ctx.ownerUserId,
      memberUserId:
        memberUserId === '' ? { in: ['', ctx.actorId] } : memberUserId,
    };
    const kind = text(query['kind']).toUpperCase();
    if (PLAN_KINDS.has(kind)) where.kind = kind;
    const periodKey = text(query['periodKey']).trim();
    if (periodKey) where.periodKey = periodKey;
    const status = text(query['status']).toUpperCase();
    if (PLAN_STATUSES.has(status)) where.status = status;
    const cycleId = int(query['cycleId']);
    let cycleObjectiveIds: number[] | null = null;
    if (cycleId > 0) {
      const rows = await this.prisma.okrObjective.findMany({
        where: { ownerUserId: ctx.ownerUserId, cycleId },
        select: { id: true },
      });
      cycleObjectiveIds = rows.map((row) => row.id);
    }
    const rows = await this.prisma.okrPlan.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 300,
    });
    const filtered = cycleObjectiveIds
      ? rows.filter(
          (row) =>
            row.objectiveId === 0 ||
            cycleObjectiveIds.includes(row.objectiveId),
        )
      : rows;
    const names = await this.planNames(filtered);
    const ownerName =
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) || '';
    return filtered.map((row) => this.planView(row, names, ownerName));
  }

  async planSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const id = int(body['id']);
    const existing =
      id > 0
        ? await this.prisma.okrPlan.findFirst({
            where: { id, ownerUserId: ctx.ownerUserId },
          })
        : null;
    if (id > 0 && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '计划不存在');
    }
    const raw = text(body['memberUserId']).trim();
    let memberUserId = existing ? existing.memberUserId : raw;
    if (!memberUserId) memberUserId = this.selfKey(ctx);
    this.scope.assertCanWriteMember(ctx, raw || ctx.actorId);
    if (memberUserId && memberUserId !== ctx.ownerUserId) {
      await this.scope.requireMember(ctx, memberUserId);
    }
    const objectiveId = int(body['objectiveId']);
    const krId = int(body['krId']);
    if (objectiveId > 0) {
      const objective = await this.objectiveOf(ctx, objectiveId);
      const cycle = await this.cycleOf(ctx.ownerUserId, objective.cycleId);
      this.assertCycleOpen(cycle);
    }
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = PLAN_KINDS.has(kindRaw) ? kindRaw : 'ADHOC';
    const period =
      kind === 'ADHOC'
        ? { key: '', start: '', end: '' }
        : this.periodOf(kind as 'WEEK' | 'DAY', ctx.settings.weekStart);
    const periodKey = text(body['periodKey']).trim() || period.key;
    const startRaw = dateOrNull(text(body['startDate']).trim());
    const dueRaw = dateOrNull(text(body['dueDate']).trim());
    const startDate = startRaw || (period.start ? dateAt(period.start) : null);
    const dueDate = dueRaw || (period.end ? dateAt(period.end) : null);
    const priorityRaw = text(body['priority']).toUpperCase();
    const data = {
      memberUserId,
      objectiveId,
      krId,
      title: text(body['title']).trim().slice(0, 200) || '未命名计划',
      detail: text(body['detail']).trim().slice(0, 2000),
      kind,
      periodKey: periodKey.slice(0, 16),
      startDate,
      dueDate,
      priority: PRIORITIES.has(priorityRaw) ? priorityRaw : 'MEDIUM',
      source:
        existing?.source === 'AGENT' ||
        text(body['source']).toUpperCase() === 'AGENT'
          ? 'AGENT'
          : 'MANUAL',
    };
    const saved = existing
      ? await this.prisma.okrPlan.update({ where: { id: existing.id }, data })
      : await this.prisma.okrPlan.create({
          data: {
            ...data,
            ownerUserId: ctx.ownerUserId,
            status: 'TODO',
            progress: 0,
          },
        });
    return this.planViewSaved(ctx, saved);
  }

  async planUpdate(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    const row = await this.planOf(ctx, this.idOf(id));
    this.assertPlanWritable(ctx, row);
    const data: Prisma.OkrPlanUpdateInput = {};
    if (body['title'] !== undefined) {
      data.title = text(body['title']).trim().slice(0, 200) || row.title;
    }
    if (body['detail'] !== undefined) {
      data.detail = text(body['detail']).trim().slice(0, 2000);
    }
    if (body['dueDate'] !== undefined) {
      data.dueDate = dateOrNull(text(body['dueDate']).trim());
    }
    const priorityRaw = text(body['priority']).toUpperCase();
    if (PRIORITIES.has(priorityRaw)) data.priority = priorityRaw;
    const statusRaw = text(body['status']).toUpperCase();
    let becameDone = false;
    if (PLAN_STATUSES.has(statusRaw)) {
      data.status = statusRaw;
      if (statusRaw === 'DONE' && row.status !== 'DONE') {
        data.doneAt = new Date();
        data.progress = 100;
        becameDone = true;
      } else if (statusRaw !== 'DONE' && row.status === 'DONE') {
        data.doneAt = null;
        data.progress =
          body['progress'] !== undefined
            ? clamp(num(body['progress']), 0, 100)
            : 0;
      }
    }
    if (body['progress'] !== undefined && !becameDone) {
      data.progress = clamp(num(body['progress']), 0, 100);
    }
    const saved = await this.prisma.okrPlan.update({
      where: { id: row.id },
      data,
    });
    if (becameDone && saved.krId > 0) {
      const kr = await this.prisma.okrKeyResult.findFirst({
        where: { id: saved.krId, ownerUserId: ctx.ownerUserId },
      });
      if (kr) {
        await this.prisma.okrProgressLog.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            krId: kr.id,
            objectiveId: kr.objectiveId,
            before: num(kr.currentValue),
            after: num(kr.currentValue),
            progress: progressOf(
              kr.direction,
              num(kr.startValue),
              num(kr.currentValue),
              num(kr.targetValue),
            ),
            note: `计划完成：${saved.title}`.slice(0, 500),
            source: 'PLAN',
            authorId: ctx.actorId,
            refType: 'PLAN',
            refId: String(saved.id),
          },
        });
      }
    }
    return this.planViewSaved(ctx, saved);
  }

  async planDelete(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.planOf(ctx, this.idOf(id));
    this.assertPlanWritable(ctx, row);
    await this.prisma.okrPlan.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async planLinkSchedule(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    const row = await this.planOf(ctx, this.idOf(id));
    this.assertPlanWritable(ctx, row);
    const scheduleId = int(body['scheduleId']);
    if (scheduleId > 0) {
      const schedule = await this.prisma.contentAgentSchedule.findFirst({
        where: {
          id: scheduleId,
          userId: { in: [ctx.actorId, ctx.ownerUserId] },
        },
        select: { id: true },
      });
      if (!schedule) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '定时任务不存在');
      }
    }
    const saved = await this.prisma.okrPlan.update({
      where: { id: row.id },
      data: { scheduleId },
    });
    return this.planViewSaved(ctx, saved);
  }

  async reportList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const kindRaw = text(query['kind']).toUpperCase();
    const kind = REPORT_KINDS.has(kindRaw) ? kindRaw : 'DAILY';
    const where: Prisma.OkrReportWhereInput = {
      ownerUserId: ctx.ownerUserId,
      kind,
    };
    const periodKey = text(query['periodKey']).trim();
    if (periodKey) where.periodKey = periodKey;
    const scopeRaw = text(query['scope']).toUpperCase();
    if (!(ctx.isOwner || ctx.isManager) || scopeRaw === 'MINE') {
      where.memberUserId = ctx.actorId === ctx.ownerUserId ? '' : ctx.actorId;
    }
    const memberUserId = text(query['memberUserId']).trim();
    if (memberUserId) where.memberUserId = memberUserId;
    const rows = await this.prisma.okrReport.findMany({
      where,
      orderBy: [{ periodKey: 'desc' }, { id: 'desc' }],
      take: 300,
    });
    return this.reportViews(ctx, rows);
  }

  async reportGet(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.reportOf(ctx, this.idOf(id));
    this.assertReportVisible(ctx, row);
    return (await this.reportViews(ctx, [row]))[0];
  }

  async reportSaveDraft(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = REPORT_KINDS.has(kindRaw) ? kindRaw : 'DAILY';
    const raw = text(body['memberUserId']).trim();
    this.scope.assertCanWriteMember(ctx, raw || ctx.actorId);
    const memberUserId = raw
      ? raw === ctx.ownerUserId
        ? ''
        : raw
      : this.selfKey(ctx);
    if (memberUserId) await this.scope.requireMember(ctx, memberUserId);
    const period = this.reportPeriod(
      kind,
      text(body['periodKey']).trim(),
      ctx.settings.weekStart,
    );
    const sourceRaw = text(body['source']).toUpperCase();
    const source = REPORT_SOURCES.has(sourceRaw) ? sourceRaw : 'MANUAL';
    const incoming = jsonObject(body['content']);
    const existing = await this.prisma.okrReport.findUnique({
      where: {
        ownerUserId_memberUserId_kind_periodKey: {
          ownerUserId: ctx.ownerUserId,
          memberUserId,
          kind,
          periodKey: period.key,
        },
      },
    });
    if (existing) {
      if (existing.status === 'SUBMITTED') {
        if (source !== 'AGENT_AUTO') {
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '已提交的汇报不能修改，请先撤回',
          );
        }
        return (await this.reportViews(ctx, [existing]))[0];
      }
      const kept = jsonObject(existing.content);
      const hasContent = Object.keys(kept).length > 0;
      const content =
        source === 'AGENT_AUTO' && hasContent ? existing.content : incoming;
      const saved = await this.prisma.okrReport.update({
        where: { id: existing.id },
        data: {
          content: content as Prisma.InputJsonValue,
          autoDraft:
            source === 'AGENT_AUTO'
              ? (incoming as Prisma.InputJsonValue)
              : (existing.autoDraft as Prisma.InputJsonValue),
          source,
          scheduleId: int(body['scheduleId']) || existing.scheduleId,
        },
      });
      return (await this.reportViews(ctx, [saved]))[0];
    }
    const saved = await this.prisma.okrReport.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        memberUserId,
        kind,
        periodKey: period.key,
        content: incoming as Prisma.InputJsonValue,
        autoDraft:
          source === 'AGENT_AUTO' ? (incoming as Prisma.InputJsonValue) : {},
        source,
        scheduleId: int(body['scheduleId']),
        status: 'DRAFT',
      },
    });
    if (source === 'AGENT_AUTO') {
      await this.notifications.notify(memberUserId || ctx.ownerUserId, {
        category: 'okr',
        title: kind === 'DAILY' ? '今日日报草稿已生成' : '本周周报草稿已生成',
        body: '打开「汇报」页签检查并提交即可。',
        link: '/okr?tab=reports',
        entityType: 'okr_report_draft',
        entityId: String(saved.id),
      });
    }
    return (await this.reportViews(ctx, [saved]))[0];
  }

  async reportSubmit(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.reportOf(ctx, this.idOf(id));
    if (
      row.memberUserId !== this.selfKey(ctx) &&
      row.memberUserId !== ctx.actorId
    ) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能提交自己的汇报');
    }
    const saved = await this.prisma.okrReport.update({
      where: { id: row.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    const view = (await this.reportViews(ctx, [saved]))[0];
    const members = await this.scope.members(ctx.ownerUserId);
    const name =
      members.find((item) => item.memberUserId === row.memberUserId)?.name ||
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) ||
      '';
    await this.notifyManagersOnce(ctx, {
      title: `${name}提交了${OKR_REPORT_KIND_LABELS[saved.kind] || '汇报'}`,
      body: `${saved.periodKey} 的汇报已提交，可到「汇报」页签查看并点评。`,
      link: '/okr?tab=reports',
      entityType: 'okr_report_submitted',
      entityId: `submit:${saved.id}:${saved.updatedAt.toISOString()}`,
    });
    return view;
  }

  async reportWithdraw(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.reportOf(ctx, this.idOf(id));
    if (
      row.memberUserId !== this.selfKey(ctx) &&
      row.memberUserId !== ctx.actorId
    ) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能撤回自己的汇报');
    }
    const saved = await this.prisma.okrReport.update({
      where: { id: row.id },
      data: { status: 'DRAFT', submittedAt: null },
    });
    return (await this.reportViews(ctx, [saved]))[0];
  }

  async reportComment(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const row = await this.reportOf(ctx, this.idOf(id));
    const saved = await this.prisma.okrReport.update({
      where: { id: row.id },
      data: {
        managerComment: text(body['comment']).trim().slice(0, 500),
      },
    });
    const target = row.memberUserId || ctx.ownerUserId;
    if (target !== ctx.actorId) {
      await this.notifications.notify(target, {
        category: 'okr',
        title: '你的汇报收到一条点评',
        body: '打开「汇报」页签查看点评内容。',
        link: '/okr?tab=reports',
        entityType: 'okr_report_comment',
        entityId: String(row.id),
      });
    }
    return (await this.reportViews(ctx, [saved]))[0];
  }

  async reportGenerate(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    if (!ctx.settings.autoDraftEnabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '自动草稿已在设置里关闭，开启后才能一键生成',
      );
    }
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = REPORT_KINDS.has(kindRaw) ? kindRaw : 'DAILY';
    const raw = text(body['memberUserId']).trim();
    this.scope.assertCanWriteMember(ctx, raw || ctx.actorId);
    const memberUserId = raw
      ? raw === ctx.ownerUserId
        ? ''
        : raw
      : this.selfKey(ctx);
    if (memberUserId) await this.scope.requireMember(ctx, memberUserId);
    const actorId = memberUserId || ctx.actorId;
    const period = this.reportPeriod(
      kind,
      text(body['periodKey']).trim(),
      ctx.settings.weekStart,
    );
    const overwrite = Boolean(body['overwrite']);
    const existing = await this.prisma.okrReport.findUnique({
      where: {
        ownerUserId_memberUserId_kind_periodKey: {
          ownerUserId: ctx.ownerUserId,
          memberUserId,
          kind,
          periodKey: period.key,
        },
      },
    });
    if (existing?.status === 'SUBMITTED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '本期汇报已提交，如需重新生成请先撤回',
      );
    }
    const content = await this.buildReportContent(
      ctx,
      actorId,
      memberUserId,
      kind,
      period,
    );
    const hasContent =
      existing && Object.keys(jsonObject(existing.content)).length > 0;
    const keepExisting = Boolean(existing) && hasContent && !overwrite;
    const saved = existing
      ? await this.prisma.okrReport.update({
          where: { id: existing.id },
          data: {
            autoDraft: content,
            content: keepExisting
              ? (existing.content as Prisma.InputJsonValue)
              : (content as Prisma.InputJsonValue),
            source: 'SYSTEM',
          },
        })
      : await this.prisma.okrReport.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            memberUserId,
            kind,
            periodKey: period.key,
            content: content,
            autoDraft: content,
            source: 'SYSTEM',
            status: 'DRAFT',
          },
        });
    return (await this.reportViews(ctx, [saved]))[0];
  }
}
