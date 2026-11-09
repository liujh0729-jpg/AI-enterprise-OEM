import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  csvLine,
  dateAt,
  int,
  jsonObject,
  localToday,
  num,
  round,
  scoreTotal,
} from './okr.helpers';
import { OkrBase } from './okr.base';

/** OKR 统计、导出与评分。 */
export class OkrInsightService extends OkrBase {
  async stats(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const requested = int(query['cycleId']);
    const cycle =
      requested > 0
        ? await this.cycleOf(ctx.ownerUserId, requested)
        : await this.currentCycle(ctx.ownerUserId);
    const dimensions = ctx.settings.scoreDimensions;
    if (!cycle) {
      return {
        cycle: null,
        completion: 0,
        objectiveCount: 0,
        krCount: 0,
        memberRanking: [],
        krTrend: [],
        scoreDistribution: [],
        scoreDimensions: dimensions,
        summary: ['还没有周期，先在「目标」页签创建年度/季度/月度周期。'],
      };
    }
    const objectives = await this.collectObjectives(ctx, { cycleId: cycle.id });
    const allKrs = objectives.length
      ? await this.prisma.okrKeyResult.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            objectiveId: { in: objectives.map((row) => row.id) },
          },
          select: { id: true },
        })
      : [];
    const reports = await this.prisma.okrReport.findMany({
      where: { ownerUserId: ctx.ownerUserId },
    });
    const cycleReports = reports.filter((row) =>
      this.periodInRange(
        row.periodKey,
        row.kind,
        cycle,
        ctx.settings.weekStart,
      ),
    );
    const scores = await this.prisma.okrScore.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        cycleId: cycle.id,
        status: 'SUBMITTED',
      },
    });
    const members = await this.scope.members(ctx.ownerUserId);
    const names = await this.scope.names([
      ctx.ownerUserId,
      ...members.map((row) => row.memberUserId),
    ]);
    const keys = new Set<string>();
    for (const row of objectives) keys.add(row.ownerMemberUserId);
    for (const row of cycleReports) keys.add(row.memberUserId);
    const averageByMember = new Map<string, number>();
    const scoreGroup = new Map<string, number[]>();
    for (const row of scores) {
      const list = scoreGroup.get(row.memberUserId) || [];
      list.push(num(row.total));
      scoreGroup.set(row.memberUserId, list);
    }
    for (const [memberUserId, list] of scoreGroup) {
      averageByMember.set(
        memberUserId,
        round(list.reduce((sum, value) => sum + value, 0) / list.length, 1),
      );
    }
    const memberRanking = [...keys]
      .map((key) => {
        const owned = objectives.filter((row) => row.ownerMemberUserId === key);
        const member = members.find((row) => row.memberUserId === key);
        return {
          memberUserId: key,
          memberName: member?.name || names.get(key) || (key ? key : '账号'),
          department: member?.department || '',
          objectives: owned.length,
          progress: this.completionOf(owned),
          reports: cycleReports.filter((row) => row.memberUserId === key)
            .length,
          avgScore: averageByMember.get(key) || 0,
        };
      })
      .filter((row) => row.objectives > 0 || row.reports > 0)
      .sort((a, b) => b.progress - a.progress);
    const topObjectives = objectives.filter((row) => row.parentId === 0);
    const completion = this.completionOf(
      topObjectives.length ? topObjectives : objectives,
    );
    const krTrend = await this.buildKrTrend(ctx.ownerUserId, cycle);
    const scoreDistribution = [...averageByMember.entries()]
      .map(([memberUserId, avg]) => ({
        memberUserId,
        memberName:
          members.find((row) => row.memberUserId === memberUserId)?.name ||
          names.get(memberUserId) ||
          memberUserId,
        avg,
      }))
      .sort((a, b) => b.avg - a.avg);
    const overdue = await this.prisma.okrPlan.count({
      where: {
        ownerUserId: ctx.ownerUserId,
        status: { in: ['TODO', 'DOING'] },
        dueDate: { lt: dateAt(localToday()) },
      },
    });
    const summary: string[] = [
      `本周期共 ${objectives.length} 个目标、${allKrs.length} 条 KR，整体完成度 ${completion}%。`,
    ];
    if (memberRanking.length) {
      summary.push(
        `完成度最高：${memberRanking[0].memberName}（${memberRanking[0].progress}%）。`,
      );
    }
    if (overdue > 0)
      summary.push(`还有 ${overdue} 条计划逾期，建议在「我的计划」里处理。`);
    if (scores.length) {
      summary.push(`已收到 ${scores.length} 条周期评分。`);
    } else if (cycle.status === 'REVIEW') {
      summary.push('周期已进入复盘，可以开始打分。');
    }
    return {
      cycle: this.cycleView(cycle),
      completion,
      objectiveCount: objectives.length,
      krCount: allKrs.length,
      memberRanking,
      krTrend,
      scoreDistribution,
      scoreDimensions: dimensions,
      summary,
    };
  }

  async export(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const requested = int(query['cycleId']);
    const cycle =
      requested > 0
        ? await this.cycleOf(ctx.ownerUserId, requested)
        : await this.currentCycle(ctx.ownerUserId);
    const stat = await this.stats(user, query);
    const lines = [
      csvLine(['成员', '部门', '目标数', '完成度(%)', '汇报数', '平均评分']),
    ];
    for (const row of stat.memberRanking) {
      lines.push(
        csvLine([
          row.memberName,
          row.department,
          row.objectives,
          row.progress,
          row.reports,
          row.avgScore,
        ]),
      );
    }
    const title = cycle ? this.cycleView(cycle).title : '全部周期';
    const filename = `OKR-${title}-${localToday()}.csv`.replace(
      /[\\/:*?"<>|]/g,
      '-',
    );
    return {
      filename,
      content: `\uFEFF${lines.join('\r\n')}`,
      rows: stat.memberRanking.length,
    };
  }

  async scoreList(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    const cycleId = int(query['cycleId']);
    const cycle =
      cycleId > 0
        ? await this.cycleOf(ctx.ownerUserId, cycleId)
        : (await this.prisma.okrCycle.findFirst({
            where: {
              ownerUserId: ctx.ownerUserId,
              status: { in: ['REVIEW', 'CLOSED'] },
            },
            orderBy: [{ year: 'desc' }, { period: 'desc' }, { id: 'desc' }],
          })) || (await this.currentCycle(ctx.ownerUserId));
    const dimensions = ctx.settings.scoreDimensions;
    const members = await this.scope.members(ctx.ownerUserId);
    if (!cycle) {
      return {
        cycleId: 0,
        dimensions,
        candidates: [],
        items: [],
        averages: [],
      };
    }
    const candidates = await this.scoreCandidates(ctx, cycle.id, members);
    const scopeRaw = text(query['scope']).toUpperCase();
    const where: Prisma.OkrScoreWhereInput = {
      ownerUserId: ctx.ownerUserId,
      cycleId: cycle.id,
    };
    const manage = ctx.isOwner || ctx.isManager;
    if (!manage) where.memberUserId = ctx.actorId;
    else if (scopeRaw === 'GIVEN') where.reviewerUserId = ctx.actorId;
    else if (scopeRaw === 'RECEIVED') where.memberUserId = ctx.actorId;
    const rows = await this.prisma.okrScore.findMany({
      where,
      orderBy: { id: 'asc' },
    });
    const names = await this.scope.names([
      ctx.ownerUserId,
      ...members.map((row) => row.memberUserId),
    ]);
    const averages = [...new Set(rows.map((row) => row.memberUserId))]
      .map((memberUserId) => {
        const submitted = rows.filter(
          (row) =>
            row.memberUserId === memberUserId && row.status === 'SUBMITTED',
        );
        return {
          memberUserId,
          memberName:
            members.find((row) => row.memberUserId === memberUserId)?.name ||
            names.get(memberUserId) ||
            memberUserId,
          average: submitted.length
            ? round(
                submitted.reduce((sum, row) => sum + num(row.total), 0) /
                  submitted.length,
                1,
              )
            : 0,
          reviewers: submitted.length,
        };
      })
      .sort((a, b) => b.average - a.average);
    return {
      cycleId: cycle.id,
      dimensions,
      candidates: manage ? candidates.map((row) => this.memberView(row)) : [],
      items: rows.map((row) => this.scoreView(row, names)),
      averages,
    };
  }

  async scoreSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertManager(ctx);
    const cycleId = int(body['cycleId']);
    const cycle = await this.cycleOf(ctx.ownerUserId, cycleId);
    if (cycle.status !== 'REVIEW' && cycle.status !== 'CLOSED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '周期进入复盘或关闭后才能打分',
      );
    }
    const memberUserId = text(body['memberUserId']).trim();
    if (!memberUserId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择被评人');
    }
    if (memberUserId === ctx.actorId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能给自己打分');
    }
    const members = await this.scope.members(ctx.ownerUserId);
    const candidates = await this.scoreCandidates(ctx, cycle.id, members);
    if (!candidates.some((row) => row.memberUserId === memberUserId)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该成员在本周期没有目标或汇报，不能评分',
      );
    }
    const dimensions = ctx.settings.scoreDimensions;
    const rawScores = Array.isArray(body['scores']) ? body['scores'] : [];
    const items = rawScores.map((item) => {
      const row = jsonObject(item);
      const key = text(row['key']).trim();
      const dimension = dimensions.find((dim) => dim.key === key);
      if (!dimension) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '评分维度与设置不一致，请刷新后重试',
        );
      }
      const score = num(row['score']);
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '每项评分需为 1~5 的整数',
        );
      }
      return {
        key: dimension.key,
        label: dimension.label,
        score,
        weight: dimension.weight,
      };
    });
    if (!items.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少填写一项评分');
    }
    const total = scoreTotal(items, dimensions);
    const submit = Boolean(body['submit']);
    const existing = await this.prisma.okrScore.findUnique({
      where: {
        ownerUserId_cycleId_memberUserId_reviewerUserId: {
          ownerUserId: ctx.ownerUserId,
          cycleId,
          memberUserId,
          reviewerUserId: ctx.actorId,
        },
      },
    });
    if (existing?.status === 'SUBMITTED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '已提交的评分不能修改，需所有者撤回后才能重打',
      );
    }
    const data = {
      scores: toJsonInput(items),
      total,
      comment: text(body['comment']).trim().slice(0, 500),
      status: submit ? 'SUBMITTED' : 'DRAFT',
      submittedAt: submit ? new Date() : null,
    };
    const saved = existing
      ? await this.prisma.okrScore.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.okrScore.create({
          data: {
            ...data,
            ownerUserId: ctx.ownerUserId,
            cycleId,
            memberUserId,
            reviewerUserId: ctx.actorId,
          },
        });
    if (submit) {
      await this.notifications.notify(memberUserId, {
        category: 'okr',
        title: '你有一条新的周期评分',
        body: '打开「统计复盘」页签查看评分明细与平均分。',
        link: '/okr?tab=stats',
        entityType: 'okr_score_submitted',
        entityId: String(saved.id),
      });
    }
    const names = await this.scope.names([
      ctx.ownerUserId,
      memberUserId,
      ctx.actorId,
    ]);
    return this.scoreView(saved, names);
  }

  async scoreWithdraw(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertOwner(ctx);
    const row = await this.prisma.okrScore.findFirst({
      where: { id: this.idOf(id), ownerUserId: ctx.ownerUserId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '评分记录不存在');
    }
    const saved = await this.prisma.okrScore.update({
      where: { id: row.id },
      data: { status: 'DRAFT', submittedAt: null },
    });
    const names = await this.scope.names([
      ctx.ownerUserId,
      saved.memberUserId,
      saved.reviewerUserId,
    ]);
    return this.scoreView(saved, names);
  }
}
