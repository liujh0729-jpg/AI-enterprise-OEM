import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  clamp,
  cycleRange,
  cycleTitle,
  dateAt,
  dateOrNull,
  dateStr,
  int,
  jsonObject,
  num,
  round,
} from './okr.helpers';
import type { CycleRow } from './okr.types';
import { CYCLE_STATUSES, VISIBILITIES } from './okr.types';
import { OkrBase } from './okr.base';

/** OKR 周期与评分设置。 */
export class OkrCycleService extends OkrBase {
  async cycleList(user: CurrentUser) {
    const ctx = await this.scope.context(user);
    return this.cycleViews(ctx.ownerUserId);
  }

  async cycleSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertOwner(ctx);
    const id = int(body['id']);
    const kindRaw = text(body['kind']).toUpperCase();
    const kind = ['YEAR', 'QUARTER', 'MONTH'].includes(kindRaw)
      ? kindRaw
      : 'YEAR';
    const year = int(body['year'], new Date().getFullYear());
    if (year < 2000 || year > 2100) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '年份不合法');
    }
    let period = int(body['period']);
    if (kind === 'YEAR') period = 0;
    else if (kind === 'QUARTER' && (period < 1 || period > 4)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '季度周期的期数需为 1~4',
      );
    } else if (kind === 'MONTH' && (period < 1 || period > 12)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '月度周期的期数需为 1~12',
      );
    }
    const existing =
      id > 0
        ? await this.prisma.okrCycle.findFirst({
            where: { id, ownerUserId: ctx.ownerUserId },
          })
        : null;
    if (id > 0 && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '周期不存在');
    }
    if (existing?.status === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '已关闭的周期不能再修改',
      );
    }
    const defaults = cycleRange(kind, year, period);
    const startDate =
      dateOrNull(text(body['startDate']).trim()) || dateAt(defaults.startDate);
    const endDate =
      dateOrNull(text(body['endDate']).trim()) || dateAt(defaults.endDate);
    if (endDate < startDate) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '结束日期不能早于开始日期',
      );
    }
    const statusRaw = text(body['status']).toUpperCase();
    const status = CYCLE_STATUSES.has(statusRaw)
      ? statusRaw
      : existing?.status || 'ACTIVE';
    const title =
      text(body['title']).trim().slice(0, 120) ||
      cycleTitle(kind, year, period);
    const data = {
      ownerUserId: ctx.ownerUserId,
      kind,
      year,
      period,
      title,
      startDate,
      endDate,
      status,
    };
    let saved: CycleRow;
    try {
      saved = existing
        ? await this.prisma.okrCycle.update({ where: { id }, data })
        : await this.prisma.okrCycle.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '同一账号下该周期已存在',
        );
      }
      throw error;
    }
    if (!existing && status === 'ACTIVE') {
      await this.notifyMembers(ctx, {
        title: `新 OKR 周期：${title}`,
        body: `${dateStr(startDate)} 至 ${dateStr(endDate)}，请到「目标」页签查看与承接。`,
        link: '/okr?tab=objectives',
        entityType: 'okr_cycle_start',
        entityId: String(saved.id),
      });
    }
    if (existing?.status !== 'REVIEW' && status === 'REVIEW') {
      await this.notifyManagersOnce(ctx, {
        title: `周期进入复盘：${title}`,
        body: '现在可以给成员打分了。',
        link: '/okr?tab=stats',
        entityType: 'okr_cycle_review',
        entityId: `review:${saved.id}`,
      });
    }
    return this.cycleView(saved);
  }

  async cycleClose(user: CurrentUser, id: string) {
    const ctx = await this.scope.context(user);
    this.scope.assertOwner(ctx);
    const row = await this.cycleOf(ctx.ownerUserId, this.idOf(id));
    if (row.status === 'CLOSED') return this.cycleView(row);
    const saved = await this.prisma.okrCycle.update({
      where: { id: row.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await this.notifyMembers(ctx, {
      title: `周期已关闭：${this.cycleView(saved).title}`,
      body: '该周期的目标与 KR 已转为只读；如需继续复盘，请新建周期。',
      link: '/okr?tab=stats',
      entityType: 'okr_cycle_closed',
      entityId: `closed:${saved.id}`,
    });
    return this.cycleView(saved);
  }

  async settingsGet(user: CurrentUser) {
    const ctx = await this.scope.context(user);
    const members = await this.scope.members(ctx.ownerUserId);
    return {
      ...ctx.settings,
      members: members.map((row) => this.memberView(row)),
      isOwner: ctx.isOwner,
    };
  }

  async settingsSave(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    this.scope.assertOwner(ctx);
    const current = ctx.settings;
    const data: Prisma.OkrSettingsUncheckedUpdateInput = {};
    if (Array.isArray(body['managers'])) {
      const members = await this.scope.members(ctx.ownerUserId);
      const ids = [
        ...new Set(
          body['managers'].map((item) => text(item).trim()).filter(Boolean),
        ),
      ];
      if (ids.some((id) => !members.some((row) => row.memberUserId === id))) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '管理者必须是本账号的成员',
        );
      }
      data.managers = ids;
    }
    const visibilityRaw = text(body['defaultVisibility']).toUpperCase();
    if (VISIBILITIES.has(visibilityRaw)) data.defaultVisibility = visibilityRaw;
    if (body['weekStart'] !== undefined) {
      data.weekStart = clamp(int(body['weekStart'], 1), 0, 6);
    }
    if (body['autoDraftEnabled'] !== undefined) {
      data.autoDraftEnabled = Boolean(body['autoDraftEnabled']);
    }
    if (body['reportTemplates'] !== undefined) {
      data.reportTemplates = jsonObject(
        body['reportTemplates'],
      ) as Prisma.InputJsonValue;
    }
    if (body['reportSchedules'] !== undefined) {
      data.reportSchedules = jsonObject(
        body['reportSchedules'],
      ) as Prisma.InputJsonValue;
    }
    if (body['metricRefreshHour'] !== undefined) {
      data.metricRefreshHour = clamp(int(body['metricRefreshHour'], 5), 0, 23);
    }
    if (Array.isArray(body['scoreDimensions'])) {
      const dims = body['scoreDimensions'].map((item) => {
        const row = jsonObject(item);
        return {
          key: text(row['key']).trim().slice(0, 32),
          label: text(row['label']).trim().slice(0, 32),
          weight: round(clamp(num(row['weight']), 0, 100), 2),
        };
      });
      if (!dims.length || dims.some((row) => !row.key || !row.label)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '评分维度需要名称与标识',
        );
      }
      const total = round(
        dims.reduce((sum, row) => sum + row.weight, 0),
        2,
      );
      if (Math.abs(total - 100) > 0.01) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `评分维度权重合计需为 100%（当前 ${total}%）`,
        );
      }
      data.scoreDimensions = dims;
    }
    await this.prisma.okrSettings.upsert({
      where: { ownerUserId: ctx.ownerUserId },
      create: {
        ownerUserId: ctx.ownerUserId,
        managers: (data.managers ?? current.managers) as Prisma.InputJsonValue,
        defaultVisibility: text(
          data.defaultVisibility ?? current.defaultVisibility,
        ),
        weekStart: int(data.weekStart ?? current.weekStart, 1),
        autoDraftEnabled: Boolean(
          data.autoDraftEnabled ?? current.autoDraftEnabled,
        ),
        reportTemplates: (data.reportTemplates ??
          current.reportTemplates) as Prisma.InputJsonValue,
        reportSchedules: (data.reportSchedules ??
          current.reportSchedules) as Prisma.InputJsonValue,
        scoreDimensions: (data.scoreDimensions ??
          current.scoreDimensions) as Prisma.InputJsonValue,
        metricRefreshHour: int(
          data.metricRefreshHour ?? current.metricRefreshHour,
          5,
        ),
      },
      update: data,
    });
    const saved = await this.scope.settings(ctx.ownerUserId);
    return { ...saved };
  }
}
