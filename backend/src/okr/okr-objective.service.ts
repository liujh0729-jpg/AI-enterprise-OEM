import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clamp, dateAt, int, num, progressOf, round } from './okr.helpers';
import { recalcObjective, weighted } from './okr.progress';
import type { ObjectiveRow } from './okr.types';
import {
  AUTO_KR_TEMPLATES,
  LEVELS,
  METRIC_TYPES,
  OBJ_STATUSES,
  VISIBILITIES,
} from './okr.types';
import { OkrBase } from './okr.base';

/** OKR 目标树、KR、进度与指标取数。 */
export class OkrObjectiveService extends OkrBase {
  async objectiveList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const where: Prisma.OkrObjectiveWhereInput = {};
    const cycleId = int(query['cycleId']);
    if (cycleId > 0) where.cycleId = cycleId;
    else {
      const cycle = await this.currentCycle(ctx.ownerUserId);
      where.cycleId = cycle ? cycle.id : -1;
    }
    const memberUserId = text(query['memberUserId']).trim();
    if (memberUserId) where.ownerMemberUserId = memberUserId;
    if (query['parentId'] !== undefined) {
      where.parentId = int(query['parentId']);
    }
    const result = await this.objectiveViews(ctx, where);
    return result.items;
  }

  async objectiveDetail(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.objectiveOf(ctx, this.idOf(id));
    const [visible] = await this.visibleObjectives(ctx, [row]);
    if (!visible) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标不存在');
    }
    return (await this.objectiveViews(ctx, { id: row.id })).items[0];
  }

  async objectiveSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const id = int(body['id']);
    const created = id === 0;
    const existing = created
      ? null
      : await this.prisma.okrObjective.findFirst({
          where: { id, ownerUserId: ctx.ownerUserId },
        });
    if (!created && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '目标不存在');
    }
    const cycleId = created ? int(body['cycleId']) : existing!.cycleId;
    const cycle = await this.cycleOf(ctx.ownerUserId, cycleId);
    this.assertCycleOpen(cycle);
    if (existing && !this.canEditObjective(ctx, existing)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能维护自己的目标；被下发的目标请联系下发人修改',
      );
    }
    const canAssign = ctx.isOwner || ctx.isManager;
    let ownerMemberUserId = text(body['ownerMemberUserId']).trim();
    if (!canAssign) {
      ownerMemberUserId = ctx.actorId;
    } else if (ownerMemberUserId && ownerMemberUserId !== ctx.ownerUserId) {
      await this.scope.requireMember(ctx, ownerMemberUserId);
    }
    if (ownerMemberUserId === ctx.ownerUserId) ownerMemberUserId = '';
    const parentId = int(body['parentId']);
    if (parentId > 0) {
      const parent = await this.prisma.okrObjective.findFirst({
        where: { id: parentId, ownerUserId: ctx.ownerUserId },
      });
      if (!parent) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '上级目标不存在');
      }
      if (parent.cycleId !== cycleId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '上级目标必须与当前目标同一周期',
        );
      }
      if (parent.id === id) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '上级目标不能是自己',
        );
      }
    }
    const title = text(body['title']).trim().slice(0, 200);
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写目标标题');
    }
    const levelRaw = text(body['level']).toUpperCase();
    const level = canAssign
      ? LEVELS.has(levelRaw)
        ? levelRaw
        : 'PERSONAL'
      : 'PERSONAL';
    const visibilityRaw = text(body['visibility']).toUpperCase();
    const visibility = VISIBILITIES.has(visibilityRaw)
      ? visibilityRaw
      : ctx.settings.defaultVisibility;
    const statusRaw = text(body['status']).toUpperCase();
    const status = OBJ_STATUSES.has(statusRaw) ? statusRaw : 'ACTIVE';
    const source =
      text(body['source']).toUpperCase() === 'AGENT' ? 'AGENT' : 'MANUAL';
    const data = {
      parentId,
      level,
      title,
      description: text(body['description']).trim().slice(0, 2000),
      ownerMemberUserId,
      weight: clamp(num(body['weight'], 1), 0, 100),
      visibility,
      status,
      source: existing?.source === 'AGENT' ? 'AGENT' : source,
    };
    let saved: ObjectiveRow;
    if (existing) {
      saved = await this.prisma.okrObjective.update({
        where: { id: existing.id },
        data,
      });
    } else {
      saved = await this.prisma.okrObjective.create({
        data: {
          ...data,
          ownerUserId: ctx.ownerUserId,
          cycleId,
          assignerUserId: '',
        },
      });
    }
    const krRows = Array.isArray(body['krs']) ? (body['krs'] as unknown[]) : [];
    const existingKrs = await this.prisma.okrKeyResult.count({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: saved.id },
    });
    if (krRows.length && (created || existingKrs === 0)) {
      await this.createKrs(
        ctx.ownerUserId,
        saved.id,
        krRows,
        ownerMemberUserId || ctx.actorId,
      );
    }
    if (existing && existing.parentId !== parentId && existing.parentId > 0) {
      await recalcObjective(this.prisma, ctx.ownerUserId, existing.parentId);
    }
    await recalcObjective(this.prisma, ctx.ownerUserId, saved.id);
    const assigneeChanged =
      !existing || existing.ownerMemberUserId !== ownerMemberUserId;
    if (
      ownerMemberUserId &&
      ownerMemberUserId !== ctx.actorId &&
      assigneeChanged
    ) {
      await this.notifications.notify(ownerMemberUserId, {
        category: 'okr',
        title: `你有新的 OKR 目标：${title}`,
        body: '请到「目标」页签查看，并补齐关键结果。',
        link: '/okr?tab=objectives',
        entityType: 'okr_objective_assign',
        entityId: String(saved.id),
      });
    }
    return (await this.objectiveViews(ctx, { id: saved.id })).items[0];
  }

  async objectiveDelete(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const row = await this.objectiveOf(ctx, this.idOf(id));
    if (!this.canEditObjective(ctx, row)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '只能删除自己的目标');
    }
    if (
      row.ownerMemberUserId === ctx.actorId &&
      row.assignerUserId &&
      row.assignerUserId !== ctx.actorId
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '被下发的目标不能自行删除，请联系下发人',
      );
    }
    const children = await this.prisma.okrObjective.count({
      where: { ownerUserId: ctx.ownerUserId, parentId: row.id },
    });
    if (children > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该目标还有下级目标，请先删除下级目标',
      );
    }
    await this.prisma.okrKeyResult.deleteMany({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: row.id },
    });
    await this.prisma.okrProgressLog.deleteMany({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: row.id },
    });
    await this.prisma.okrPlan.updateMany({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: row.id },
      data: { objectiveId: 0, krId: 0 },
    });
    await this.prisma.okrObjective.delete({ where: { id: row.id } });
    if (row.parentId > 0) {
      await recalcObjective(this.prisma, ctx.ownerUserId, row.parentId);
    }
    return { removed: true };
  }

  async objectiveAssign(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const parent = await this.objectiveOf(ctx, this.idOf(id));
    const cycle = await this.cycleOf(ctx.ownerUserId, parent.cycleId);
    this.assertCycleOpen(cycle);
    const rawIds = Array.isArray(body['memberUserIds'])
      ? body['memberUserIds']
      : [];
    const memberIds = [
      ...new Set(rawIds.map((item) => text(item).trim()).filter(Boolean)),
    ];
    if (!memberIds.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要下发的成员');
    }
    const members = await this.scope.members(ctx.ownerUserId);
    for (const memberUserId of memberIds) {
      if (!members.some((row) => row.memberUserId === memberUserId)) {
        await this.scope.requireMember(ctx, memberUserId);
      }
    }
    const krTitles = (Array.isArray(body['krTitles']) ? body['krTitles'] : [])
      .map((item) => text(item).trim().slice(0, 200))
      .filter(Boolean);
    const source =
      text(body['source']).toUpperCase() === 'AGENT' ? 'AGENT' : 'MANUAL';
    const planKindRaw = text(body['generatePlan']).toUpperCase();
    const planKind =
      planKindRaw === 'WEEK' || planKindRaw === 'DAY' ? planKindRaw : '';
    const createdIds: number[] = [];
    const planIds: number[] = [];
    for (const memberUserId of memberIds) {
      const member = members.find((row) => row.memberUserId === memberUserId)!;
      const child = await this.prisma.okrObjective.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          cycleId: parent.cycleId,
          parentId: parent.id,
          level: 'PERSONAL',
          title: `${parent.title} · ${member.name}`.slice(0, 200),
          description: parent.description,
          ownerMemberUserId: memberUserId,
          assignerUserId: ctx.actorId,
          weight: 1,
          visibility: parent.visibility,
          status: 'ACTIVE',
          source,
        },
      });
      createdIds.push(child.id);
      const krs = krTitles.length
        ? await this.createKrs(
            ctx.ownerUserId,
            child.id,
            krTitles.map((title) => ({
              title,
              metricType: 'MANUAL',
              targetValue: 100,
              unit: '%',
              direction: 'UP',
              weight: 1,
            })),
            memberUserId,
          )
        : [];
      if (planKind) {
        const period = this.periodOf(planKind, ctx.settings.weekStart);
        const plan = await this.prisma.okrPlan.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            memberUserId,
            objectiveId: child.id,
            krId: krs[0]?.id || 0,
            title: `承接：${parent.title}`.slice(0, 200),
            detail: parent.description.slice(0, 2000),
            kind: planKind,
            periodKey: period.key,
            startDate: dateAt(period.start),
            dueDate: dateAt(period.end),
            priority: 'HIGH',
            status: 'TODO',
            progress: 0,
            source,
          },
        });
        planIds.push(plan.id);
      }
      await this.notifications.notify(memberUserId, {
        category: 'okr',
        title: `你收到一条新的目标：${parent.title}`,
        body: '请到「目标」页签查看，并补齐关键结果与计划。',
        link: '/okr?tab=objectives',
        entityType: 'okr_objective_assign',
        entityId: String(child.id),
      });
    }
    await recalcObjective(this.prisma, ctx.ownerUserId, parent.id);
    const objectives =
      createdIds.length > 0
        ? (
            await this.objectiveViews(ctx, {
              id: { in: createdIds },
            })
          ).items
        : [];
    const plans = planIds.length
      ? await this.prisma.okrPlan.findMany({
          where: { ownerUserId: ctx.ownerUserId, id: { in: planIds } },
          orderBy: { id: 'asc' },
        })
      : [];
    const names = await this.planNames(plans);
    const ownerName =
      (await this.scope.names([ctx.ownerUserId])).get(ctx.ownerUserId) || '';
    return {
      objectives,
      plans: plans.map((row) => this.planView(row, names, ownerName)),
    };
  }

  async draftObjective(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const direction = text(body['direction']).trim();
    if (!direction) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先说明目标方向，例如「提升华东区新签合同额」',
      );
    }
    const levelRaw = text(body['level']).toUpperCase();
    const level = LEVELS.has(levelRaw) ? levelRaw : 'COMPANY';
    const memberUserId = text(body['memberUserId']).trim();
    const krCount = Math.min(Math.max(int(body['krCount'], 3), 2), 5);
    const cycleId = int(body['cycleId']);
    const cycle =
      cycleId > 0
        ? await this.cycleOf(ctx.ownerUserId, cycleId)
        : await this.currentCycle(ctx.ownerUserId);
    const notes: string[] = [];
    const members = await this.scope.members(ctx.ownerUserId);
    const member = members.find((row) => row.memberUserId === memberUserId);
    const title = direction.slice(0, 200);
    const description = cycle
      ? `围绕「${direction}」的${this.cycleView(cycle).title}目标。`
      : `围绕「${direction}」的 OKR 目标。`;
    const krs = AUTO_KR_TEMPLATES.slice(0, krCount).map((item) => ({
      ...item,
      metricSource: item.metricSource ? { ...item.metricSource } : undefined,
    }));
    notes.push(
      '自动指标按所选周期的起止日期统计；可在 KR 保存后调整数据源与范围。',
    );
    if (!cycle) {
      notes.push(
        '当前账号还没有周期，建议先在「目标」页签创建年度/季度/月度周期。',
      );
    }
    if (member) {
      const positions = member.positions.map((item) => item.name).join('、');
      notes.push(
        positions
          ? `${member.name} 在本组织的岗位：${positions}；拆解时会据此建议承担方向。`
          : `${member.name} 还没有岗位与能力说明，只能按部门和历史完成度建议。`,
      );
    }
    return {
      objective: {
        title,
        description,
        level,
        memberUserId,
        memberName: member?.name || '',
        krs,
      },
      notes,
    };
  }

  async decomposeSuggest(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const objective = await this.objectiveOf(ctx, int(body['objectiveId']));
    const members = await this.scope.members(ctx.ownerUserId);
    const wanted = (
      Array.isArray(body['memberUserIds']) ? body['memberUserIds'] : []
    )
      .map((item) => text(item).trim())
      .filter(Boolean);
    const candidates = wanted.length
      ? members.filter((row) => wanted.includes(row.memberUserId))
      : members;
    if (!candidates.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '本账号还没有可承接的职员或代理人',
      );
    }
    const parentKrs = await this.prisma.okrKeyResult.findMany({
      where: { ownerUserId: ctx.ownerUserId, objectiveId: objective.id },
      orderBy: { id: 'asc' },
    });
    const objectives = await this.prisma.okrObjective.findMany({
      where: { ownerUserId: ctx.ownerUserId, cycleId: objective.cycleId },
      select: {
        id: true,
        ownerMemberUserId: true,
        progress: true,
      },
    });
    const notes: string[] = [];
    let missing = 0;
    const suggestions = candidates.map((member) => {
      const mine = objectives.filter(
        (row) => row.ownerMemberUserId === member.memberUserId,
      );
      const average = weighted(
        mine.map((row) => ({ weight: 1, progress: num(row.progress) })),
      );
      const tags = member.positions.map((item) => item.name).filter(Boolean);
      const parts: string[] = [];
      if (tags.length) parts.push(`岗位：${tags.join('、')}`);
      else {
        parts.push('还没填岗位与能力说明');
        missing += 1;
      }
      if (member.capabilities) {
        parts.push(`能力：${member.capabilities.slice(0, 60)}`);
      }
      parts.push(
        mine.length ? `本周期已有 ${mine.length} 个目标` : '本周期还没有目标',
      );
      if (mine.length) parts.push(`平均完成度 ${average}%`);
      const krs = parentKrs.length
        ? parentKrs.map((kr) => ({
            title: kr.title,
            metricType: 'MANUAL',
            targetValue: round(num(kr.targetValue) / candidates.length, 2),
            unit: kr.unit,
            direction: kr.direction,
            weight: num(kr.weight, 1),
          }))
        : [
            {
              title: `${objective.title} · 个人承担部分`,
              metricType: 'MANUAL',
              targetValue: 100,
              unit: '%',
              direction: 'UP',
              weight: 1,
            },
          ];
      return {
        memberUserId: member.memberUserId,
        memberName: member.name,
        department: member.department,
        positions: member.positions,
        capabilities: member.capabilities,
        reason: parts.join('；'),
        krs,
      };
    });
    if (missing > 0) {
      notes.push(
        `${missing} 人还没有填写岗位与能力说明，建议只按部门和历史完成度拆解，并在下发后逐个调整。`,
      );
    }
    notes.push(
      `目标值按 ${candidates.length} 人平均拆分，可在下发前后按实际情况调整；最终承接人需要你确认。`,
    );
    return { suggestions, notes };
  }

  async krSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const id = int(body['id']);
    const objectiveId = int(body['objectiveId']);
    const objective = await this.objectiveOf(ctx, objectiveId);
    const existing =
      id > 0
        ? await this.prisma.okrKeyResult.findFirst({
            where: { id, ownerUserId: ctx.ownerUserId },
          })
        : null;
    if (id > 0 && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '关键结果不存在');
    }
    if (existing && existing.objectiveId !== objectiveId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '关键结果不属于该目标',
      );
    }
    const editable =
      this.canEditObjective(ctx, objective) ||
      existing?.ownerMemberUserId === ctx.actorId;
    if (!editable) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能维护自己的目标与关键结果',
      );
    }
    const cycle = await this.cycleOf(ctx.ownerUserId, objective.cycleId);
    this.assertCycleOpen(cycle);
    const title = text(body['title']).trim().slice(0, 200);
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写关键结果');
    }
    const metricRaw = text(body['metricType']).toUpperCase();
    const metricType = METRIC_TYPES.has(metricRaw) ? metricRaw : 'MANUAL';
    let ownerMemberUserId = text(body['ownerMemberUserId']).trim();
    if (!(ctx.isOwner || ctx.isManager)) {
      ownerMemberUserId = ctx.actorId;
    } else if (ownerMemberUserId && ownerMemberUserId !== ctx.ownerUserId) {
      await this.scope.requireMember(ctx, ownerMemberUserId);
    }
    if (ownerMemberUserId === ctx.ownerUserId) ownerMemberUserId = '';
    const source = body['metricSource']
      ? this.metricSourceValue(body['metricSource'])
      : {};
    const data = {
      title,
      metricType,
      targetValue: num(body['targetValue'], 100),
      startValue: num(body['startValue']),
      currentValue: num(body['currentValue']),
      unit: text(body['unit']).slice(0, 32),
      direction:
        text(body['direction']).toUpperCase() === 'DOWN' ? 'DOWN' : 'UP',
      weight: clamp(num(body['weight'], 1), 0, 100),
      ownerMemberUserId,
      metricSource: source,
    };
    const saved = existing
      ? await this.prisma.okrKeyResult.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.okrKeyResult.create({
          data: { ...data, ownerUserId: ctx.ownerUserId, objectiveId },
        });
    await recalcObjective(this.prisma, ctx.ownerUserId, objectiveId);
    const names = await this.scope.names([
      ownerMemberUserId || ctx.ownerUserId,
    ]);
    const ownerName = names.get(ownerMemberUserId || ctx.ownerUserId) || '';
    return this.krView(saved, names, ownerName);
  }

  async krDelete(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    const kr = await this.krOf(ctx, this.idOf(id));
    const objective = await this.objectiveOf(ctx, kr.objectiveId);
    if (
      !this.canEditObjective(ctx, objective) &&
      kr.ownerMemberUserId !== ctx.actorId
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能删除自己的关键结果',
      );
    }
    const cycle = await this.cycleOf(ctx.ownerUserId, objective.cycleId);
    this.assertCycleOpen(cycle);
    await this.prisma.okrProgressLog.deleteMany({
      where: { ownerUserId: ctx.ownerUserId, krId: kr.id },
    });
    await this.prisma.okrPlan.updateMany({
      where: { ownerUserId: ctx.ownerUserId, krId: kr.id },
      data: { krId: 0 },
    });
    await this.prisma.okrKeyResult.delete({ where: { id: kr.id } });
    await recalcObjective(this.prisma, ctx.ownerUserId, kr.objectiveId);
    return { removed: true };
  }

  async krProgress(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.context(user);
    const kr = await this.krOf(ctx, this.idOf(id));
    const objective = await this.objectiveOf(ctx, kr.objectiveId);
    if (
      !this.canEditObjective(ctx, objective) &&
      kr.ownerMemberUserId !== ctx.actorId
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能更新自己的关键结果进度',
      );
    }
    const cycle = await this.cycleOf(ctx.ownerUserId, objective.cycleId);
    this.assertCycleOpen(cycle);
    if (kr.metricType === 'AUTO') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '自动统计的 KR 由指标刷新更新数值，不能手工填写',
      );
    }
    const before = num(kr.currentValue);
    const after =
      body['currentValue'] === undefined || body['currentValue'] === null
        ? before
        : num(body['currentValue']);
    const note = text(body['note']).trim().slice(0, 500);
    const saved = await this.prisma.okrKeyResult.update({
      where: { id: kr.id },
      data: { currentValue: after },
    });
    const progress = progressOf(
      kr.direction,
      num(kr.startValue),
      after,
      num(kr.targetValue),
    );
    if (after !== before || note) {
      await this.prisma.okrProgressLog.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          krId: kr.id,
          objectiveId: kr.objectiveId,
          before,
          after,
          progress,
          note,
          source: 'MANUAL',
          authorId: ctx.actorId,
        },
      });
    }
    await recalcObjective(this.prisma, ctx.ownerUserId, kr.objectiveId);
    const names = await this.scope.names([
      kr.ownerMemberUserId || ctx.ownerUserId,
    ]);
    const ownerName = names.get(kr.ownerMemberUserId || ctx.ownerUserId) || '';
    return { kr: this.krView(saved, names, ownerName), progress };
  }

  async progressList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const krId = int(query['krId']);
    const objectiveId = int(query['objectiveId']);
    const visibility = await this.visibleObjectiveIds(ctx);
    const where: Prisma.OkrProgressLogWhereInput = {
      ownerUserId: ctx.ownerUserId,
    };
    if (krId > 0) where.krId = krId;
    if (objectiveId > 0) where.objectiveId = objectiveId;
    if (visibility !== null) {
      const krs = await this.prisma.okrKeyResult.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          OR: [
            { ownerMemberUserId: ctx.actorId },
            { objectiveId: { in: [...visibility] } },
          ],
        },
        select: { id: true },
      });
      where.OR = [
        { krId: { in: krs.map((row) => row.id) } },
        { objectiveId: { in: [...visibility] } },
        { authorId: ctx.actorId },
      ];
    }
    const rows = await this.prisma.okrProgressLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.progressView(row));
  }

  async metricPreview(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertMember(ctx);
    const cycleId = int(body['cycleId']);
    const cycle =
      cycleId > 0
        ? await this.cycleOf(ctx.ownerUserId, cycleId)
        : await this.currentCycle(ctx.ownerUserId);
    const raw = body['metricSource'];
    if (!raw || typeof raw !== 'object') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请配置数据源');
    }
    return this.metrics.evaluate(user, raw, this.cycleRangeOf(cycle));
  }

  async metricRefresh(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const krId = int(body['krId']);
    const cycleId = int(body['cycleId']);
    let ids: number[] = [];
    if (krId > 0) {
      const kr = await this.krOf(ctx, krId);
      const objective = await this.objectiveOf(ctx, kr.objectiveId);
      if (
        !this.canEditObjective(ctx, objective) &&
        kr.ownerMemberUserId !== ctx.actorId
      ) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '只能刷新自己的关键结果',
        );
      }
      if (kr.metricType !== 'AUTO') {
        return {
          refreshed: 0,
          failed: 1,
          message: '该 KR 不是自动统计类型',
          items: [],
        };
      }
      ids = [kr.id];
    } else {
      this.scope.assertManager(ctx);
      const cycle =
        cycleId > 0
          ? await this.cycleOf(ctx.ownerUserId, cycleId)
          : await this.currentCycle(ctx.ownerUserId);
      if (!cycle) {
        return {
          refreshed: 0,
          failed: 0,
          message: '还没有可刷新的周期',
          items: [],
        };
      }
      ids = await this.metrics.autoKrIds(ctx.ownerUserId, cycle.id);
    }
    if (!ids.length) {
      return {
        refreshed: 0,
        failed: 0,
        message: '没有自动统计类型的 KR 需要刷新',
        items: [],
      };
    }
    const items = await this.metrics.refresh(user, ctx.ownerUserId, ids);
    const refreshed = items.filter((item) => item.ok).length;
    const failed = items.length - refreshed;
    return {
      refreshed,
      failed,
      message:
        failed > 0
          ? `成功刷新 ${refreshed} 条，${failed} 条取数失败（已保留上次结果）`
          : `成功刷新 ${refreshed} 条`,
      items,
    };
  }
}
