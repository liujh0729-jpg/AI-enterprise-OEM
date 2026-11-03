import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CrmScopeService, CrmContext } from './crm.scope';
import {
  FOLLOW_STATUS_LABELS,
  asArray,
  dateOrNull,
  int,
  iso,
  jsonArray,
} from './crm.helpers';
import { CrmSettingsService } from './crm.settings.service';

export class CrmFollowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
    private readonly settings: CrmSettingsService,
  ) {}

  private async assertTarget(
    ctx: CrmContext,
    targetType: string,
    targetId: number,
  ) {
    const base = await this.scope.scopeWhereAsync(ctx);
    if (targetType === 'LEAD') {
      const row = await this.prisma.crmLead.findFirst({
        where: { ...base, id: targetId, deletedAt: null } as never,
      });
      if (!row)
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '线索不存在或无权查看',
        );
      return row;
    }
    if (targetType === 'CUSTOMER') {
      const row = await this.prisma.crmCustomer.findFirst({
        where: { ...base, id: targetId, deletedAt: null } as never,
      });
      if (!row)
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '客户不存在或无权查看',
        );
      return row;
    }
    const row = await this.prisma.crmOpportunity.findFirst({
      where: { ...base, id: targetId, deletedAt: null } as never,
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '商机不存在或无权查看');
    return row;
  }

  private async touchTarget(
    ctx: CrmContext,
    targetType: string,
    targetId: number,
  ) {
    const data = { lastFollowerId: ctx.actorId, lastFollowAt: new Date() };
    if (targetType === 'LEAD') {
      await this.prisma.crmLead.update({ where: { id: targetId }, data });
    } else if (targetType === 'CUSTOMER') {
      await this.prisma.crmCustomer.update({ where: { id: targetId }, data });
    } else {
      await this.prisma.crmOpportunity.update({
        where: { id: targetId },
        data,
      });
    }
  }

  async records(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const targetType = text(query.targetType, 'CUSTOMER');
    const targetId = int(query.targetId);
    await this.assertTarget(ctx, targetType, targetId);
    const rows = await this.prisma.crmFollowRecord.findMany({
      where: { ownerUserId: ctx.ownerUserId, targetType, targetId },
      orderBy: { id: 'desc' },
    });
    const names = await this.scope.names(rows.map((row) => row.createdBy));
    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      type: row.type,
      content: row.content,
      result: row.result,
      nextAt: iso(row.nextAt),
      createdBy: row.createdBy,
      createdByName: names.get(row.createdBy) || '',
      createdAt: iso(row.createdAt),
    }));
  }

  async saveRecord(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const targetType = text(body.targetType, 'CUSTOMER');
    const targetId = int(body.targetId);
    await this.assertTarget(ctx, targetType, targetId);
    const content = text(body.content).trim().slice(0, 4000);
    if (!content)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写跟进内容');
    const row = await this.prisma.crmFollowRecord.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        targetType,
        targetId,
        type: text(body.type).slice(0, 32),
        content,
        result: text(body.result).slice(0, 200),
        attachments: jsonArray(body.attachments) as never,
        nextAt: dateOrNull(body.nextAt),
        createdBy: ctx.actorId,
      },
    });
    await this.touchTarget(ctx, targetType, targetId);
    await this.settings.log(
      ctx.ownerUserId,
      targetType,
      targetId,
      'FOLLOW',
      {},
      { id: row.id },
      ctx.actorId,
    );
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      type: row.type,
      content: row.content,
      result: row.result,
      nextAt: iso(row.nextAt),
      createdBy: row.createdBy,
      createdByName: '',
      createdAt: iso(row.createdAt),
    };
  }

  async plans(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const where: Record<string, unknown> = { ownerUserId: ctx.ownerUserId };
    if (query.targetType) where.targetType = text(query.targetType);
    if (query.targetId) where.targetId = Number(query.targetId);
    if (query.status) where.status = text(query.status);
    const rows = await this.prisma.crmFollowPlan.findMany({
      where: where as never,
      orderBy: [{ planAt: 'asc' }, { id: 'desc' }],
      take: 500,
    });
    const names = await this.scope.names(rows.map((row) => row.ownerId));
    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      planAt: iso(row.planAt),
      status: row.status,
      statusLabel: FOLLOW_STATUS_LABELS[row.status] || row.status,
      ownerId: row.ownerId,
      ownerName: names.get(row.ownerId) || '',
      content: row.content,
      reminderAt: iso(row.reminderAt),
      createdAt: iso(row.createdAt),
    }));
  }

  async savePlan(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const targetType = text(body.targetType, 'CUSTOMER');
    const targetId = int(body.targetId);
    await this.assertTarget(ctx, targetType, targetId);
    const planAt = dateOrNull(body.planAt);
    if (!planAt)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择计划时间');
    const data = {
      targetType,
      targetId,
      planAt,
      ownerId: text(body.ownerId) || ctx.actorId,
      content: text(body.content).slice(0, 2000),
      reminderAt: dateOrNull(body.reminderAt),
    };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmFollowPlan.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '跟进计划不存在');
    }
    const row = id
      ? await this.prisma.crmFollowPlan.update({ where: { id }, data })
      : await this.prisma.crmFollowPlan.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '跟进计划不存在');
    }
    const names = await this.scope.names([row.ownerId]);
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      planAt: iso(row.planAt),
      status: row.status,
      statusLabel: FOLLOW_STATUS_LABELS[row.status] || row.status,
      ownerId: row.ownerId,
      ownerName: names.get(row.ownerId) || '',
      content: row.content,
      reminderAt: iso(row.reminderAt),
      createdAt: iso(row.createdAt),
    };
  }

  async updatePlan(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const id = Number(rawId);
    const row = await this.prisma.crmFollowPlan.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '跟进计划不存在');
    const status = text(body.status, 'DONE');
    if (!FOLLOW_STATUS_LABELS[status]) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '跟进状态不正确');
    }
    const updated = await this.prisma.crmFollowPlan.update({
      where: { id },
      data: { status },
    });
    return {
      id: updated.id,
      targetType: updated.targetType,
      targetId: updated.targetId,
      planAt: iso(updated.planAt),
      status: updated.status,
      statusLabel: FOLLOW_STATUS_LABELS[updated.status] || updated.status,
      ownerId: updated.ownerId,
      ownerName: '',
      content: updated.content,
      reminderAt: iso(updated.reminderAt),
      createdAt: iso(updated.createdAt),
    };
  }

  async comments(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const targetType = text(query.targetType, 'CUSTOMER');
    const targetId = int(query.targetId);
    await this.assertTarget(ctx, targetType, targetId);
    const rows = await this.prisma.crmFollowComment.findMany({
      where: { ownerUserId: ctx.ownerUserId, targetType, targetId },
      orderBy: { id: 'asc' },
      take: 500,
    });
    const names = await this.scope.names(rows.map((row) => row.createdBy));
    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      content: row.content,
      mentions: asArray(row.mentions),
      createdBy: row.createdBy,
      createdByName: names.get(row.createdBy) || '',
      createdAt: iso(row.createdAt),
    }));
  }

  async saveComment(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const targetType = text(body.targetType, 'CUSTOMER');
    const targetId = int(body.targetId);
    await this.assertTarget(ctx, targetType, targetId);
    const content = text(body.content).trim().slice(0, 2000);
    if (!content)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写评论内容');
    const row = await this.prisma.crmFollowComment.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        targetType,
        targetId,
        content,
        mentions: asArray(body.mentions) as never,
        createdBy: ctx.actorId,
      },
    });
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      content: row.content,
      mentions: asArray(row.mentions),
      createdBy: row.createdBy,
      createdByName: '',
      createdAt: iso(row.createdAt),
    };
  }
}
