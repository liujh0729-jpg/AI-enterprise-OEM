import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CrmScopeService, CrmContext } from './crm.scope';
import {
  int,
  iso,
  jsonArray,
  jsonObject,
  money,
  moneyStr,
  statusLabel,
} from './crm.helpers';
import { CrmSettingsService } from './crm.settings.service';
import type { MechanismService } from '../mechanisms/mechanism.service';

export class CrmOrderService {
  private mechanisms?: MechanismService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
    private readonly settings: CrmSettingsService,
  ) {}

  attachMechanisms(mechanisms: MechanismService) {
    this.mechanisms = mechanisms;
  }

  private emitEvent(
    ctx: CrmContext,
    event: string,
    payload: Record<string, unknown>,
  ) {
    if (!this.mechanisms) return;
    void this.mechanisms
      .dispatch(
        {
          orgType: ctx.orgType,
          orgUserId: ctx.ownerUserId,
          actorId: ctx.actorId,
          isOwner: ctx.isOwner,
          isAdmin: ctx.isAdmin,
          roles: [],
          positions: [],
          department: ctx.department,
        },
        event,
        payload,
      )
      .catch(() => undefined);
  }

  private async views(rows: Array<Record<string, unknown>>, ctx: CrmContext) {
    if (!rows.length) return [];
    const customerIds = [
      ...new Set(rows.map((row) => Number(row.customerId)).filter(Boolean)),
    ];
    const contractIds = [
      ...new Set(rows.map((row) => Number(row.contractId)).filter(Boolean)),
    ];
    const [customers, contracts, stages, names] = await Promise.all([
      customerIds.length
        ? this.prisma.crmCustomer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, name: true },
          })
        : [],
      contractIds.length
        ? this.prisma.crmContract.findMany({
            where: { id: { in: contractIds } },
            select: { id: true, number: true },
          })
        : [],
      this.prisma.crmOrderStage.findMany({
        where: { ownerUserId: ctx.ownerUserId },
      }),
      this.scope.names(rows.map((row) => text(row.ownerId))),
    ]);
    const customerNames = new Map(customers.map((row) => [row.id, row.name]));
    const contractNos = new Map(contracts.map((row) => [row.id, row.number]));
    const stageNames = new Map(stages.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      id: Number(row.id),
      number: text(row.number),
      name: text(row.name),
      customerId: Number(row.customerId),
      customerName: customerNames.get(Number(row.customerId)) || '',
      contractId: Number(row.contractId),
      contractNumber: contractNos.get(Number(row.contractId)) || '',
      amount: moneyStr(row.amount),
      stageId: Number(row.stageId),
      stageName: stageNames.get(Number(row.stageId)) || '',
      projectId: Number(row.projectId),
      approvalStatus: text(row.approvalStatus),
      approvalStatusLabel: statusLabel(text(row.approvalStatus)),
      ownerId: text(row.ownerId),
      ownerName: names.get(text(row.ownerId)) || '',
      remark: text(row.remark),
      createdAt: iso(row.createdAt as Date | null),
    }));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const base = await this.scope.scopeWhereAsync(ctx);
    const where: Prisma.CrmOrderWhereInput = { ...base, deletedAt: null };
    if (query.stageId) where.stageId = Number(query.stageId);
    const keyword = text(query.keyword).trim();
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { number: { contains: keyword } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.crmOrder.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmOrder.count({ where }),
    ]);
    return {
      list: await this.views(rows, ctx),
      total,
      page,
      pageSize,
    };
  }

  private async findOne(ctx: CrmContext, rawId: string) {
    const id = Number(rawId);
    const base = await this.scope.scopeWhereAsync(ctx);
    const row = await this.prisma.crmOrder.findFirst({
      where: { ...base, id, deletedAt: null },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '订单不存在或无权查看');
    return row;
  }

  async get(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    const [items, approvals] = await Promise.all([
      this.prisma.crmOrderItem.findMany({ where: { orderId: row.id } }),
      this.prisma.crmApprovalInstance.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          formType: 'ORDER',
          targetId: row.id,
        },
        orderBy: { id: 'desc' },
      }),
    ]);
    const [order] = await this.views([row], ctx);
    return {
      order,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        nameSnapshot: item.nameSnapshot,
        qty: moneyStr(item.qty),
        price: moneyStr(item.price),
        amount: moneyStr(item.amount),
      })),
      snapshot: jsonObject(row.snapshot),
      approvals: approvals.map((item) => ({
        id: item.id,
        formType: item.formType,
        formTypeLabel: '订单',
        targetId: item.targetId,
        title: row.name,
        status: item.status,
        statusLabel: statusLabel(item.status),
        submitter: item.submitter,
        submitterName: '',
        currentNode: item.currentNode,
        submittedAt: iso(item.submittedAt),
        finishedAt: iso(item.finishedAt),
        createdAt: iso(item.createdAt),
      })),
    };
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const name = text(body.name).trim().slice(0, 160);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写订单名称');
    const customerId = int(body.customerId);
    const contractId = int(body.contractId);
    let amount = money(body.amount);
    if (contractId) {
      const contract = await this.prisma.crmContract.findFirst({
        where: {
          id: contractId,
          ownerUserId: ctx.ownerUserId,
          deletedAt: null,
        },
      });
      if (!contract)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '合同不存在');
    }
    if (customerId) {
      const customer = await this.prisma.crmCustomer.findFirst({
        where: {
          id: customerId,
          ownerUserId: ctx.ownerUserId,
          deletedAt: null,
        },
      });
      if (!customer)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '客户不存在');
    }
    const items = jsonArray(body.items);
    if (items.length) {
      amount = money(
        items.reduce(
          (sum, item) =>
            sum + Number(money(item.qty, '1')) * Number(money(item.price)),
          0,
        ),
      );
    }
    const stage = await this.prisma.crmOrderStage.findFirst({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { sort: 'asc' },
    });
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const count = await this.prisma.crmOrder.count({
      where: { ownerUserId: ctx.ownerUserId },
    });
    const row = await this.prisma.crmOrder.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        ...this.scope.orgKey(ctx),
        name,
        number: `DD-${stamp}-${String(count + 1).padStart(4, '0')}`,
        customerId,
        contractId,
        amount,
        stageId: int(body.stageId) || stage?.id || 0,
        ownerId: text(body.ownerId) || ctx.actorId,
        remark: text(body.remark).slice(0, 2000),
        custom: toJsonInput(jsonObject(body.custom)),
        snapshot: toJsonInput({
          items,
          fields: body,
          savedAt: new Date().toISOString(),
        }),
      },
    });
    for (const item of items) {
      const qty = money(item.qty, '1');
      const price = money(item.price);
      await this.prisma.crmOrderItem.create({
        data: {
          orderId: row.id,
          productId: int(item.productId),
          nameSnapshot: text(item.nameSnapshot).slice(0, 120),
          qty,
          price,
          amount: money(Number(qty) * Number(price)),
        },
      });
    }
    await this.settings.log(
      ctx.ownerUserId,
      'ORDER',
      row.id,
      'CREATE',
      {},
      { name },
      ctx.actorId,
    );
    this.emitEvent(ctx, 'crm.order.created', {
      orderId: row.id,
      number: row.number,
      name: row.name,
      customerId: row.customerId,
      contractId: row.contractId,
      amount: Number(row.amount),
      ownerId: row.ownerId,
      source: 'crm',
      sourceId: String(row.id),
    });
    return (await this.views([row], ctx))[0];
  }

  async update(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const row = await this.findOne(ctx, rawId);
    if (row.approvalStatus === 'APPROVING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '审批中的订单不能修改',
      );
    }
    const data: Prisma.CrmOrderUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = text(body.name).slice(0, 160);
    if (body.amount !== undefined) data.amount = money(body.amount);
    if (body.remark !== undefined)
      data.remark = text(body.remark).slice(0, 2000);
    if (body.ownerId !== undefined) data.ownerId = text(body.ownerId);
    if (body.custom !== undefined)
      data.custom = toJsonInput(jsonObject(body.custom));
    if (body.contractId !== undefined) data.contractId = int(body.contractId);
    if (body.customerId !== undefined) data.customerId = int(body.customerId);
    const updated = await this.prisma.crmOrder.update({
      where: { id: row.id },
      data,
    });
    await this.settings.log(
      ctx.ownerUserId,
      'ORDER',
      row.id,
      'UPDATE',
      {},
      data,
      ctx.actorId,
    );
    return (await this.views([updated], ctx))[0];
  }

  async updateStage(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const row = await this.findOne(ctx, rawId);
    const stage = await this.prisma.crmOrderStage.findFirst({
      where: { id: int(body.stageId), ownerUserId: ctx.ownerUserId },
    });
    if (!stage)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '订单阶段不正确');
    const updated = await this.prisma.crmOrder.update({
      where: { id: row.id },
      data: { stageId: stage.id },
    });
    return (await this.views([updated], ctx))[0];
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'delete');
    const row = await this.findOne(ctx, rawId);
    await this.prisma.crmOrder.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    return { removed: true };
  }

  async stages(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmOrderStage.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { sort: 'asc' },
    });
    const groups = await this.prisma.crmOrder.groupBy({
      by: ['stageId'],
      where: { ownerUserId: ctx.ownerUserId, deletedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const byId = new Map(groups.map((row) => [row.stageId, row]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: '',
      sort: row.sort,
      winRate: 0,
      count: byId.get(row.id)?._count._all || 0,
      amount: moneyStr(byId.get(row.id)?._sum.amount || 0),
    }));
  }

  async saveStage(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const name = text(body.name).trim().slice(0, 60);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写阶段名称');
    const data = { name, sort: int(body.sort) };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmOrderStage.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '订单阶段不存在');
    }
    const row = id
      ? await this.prisma.crmOrderStage.update({ where: { id }, data })
      : await this.prisma.crmOrderStage.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return {
      id: row.id,
      name: row.name,
      type: '',
      sort: row.sort,
      winRate: 0,
      count: 0,
      amount: '0.00',
    };
  }

  async removeStage(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const used = await this.prisma.crmOrder.count({
      where: { ownerUserId: ctx.ownerUserId, stageId: id, deletedAt: null },
    });
    if (used)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `还有 ${used} 个订单在这个阶段`,
      );
    await this.prisma.crmOrderStage.delete({ where: { id } });
    return { removed: true };
  }
}
