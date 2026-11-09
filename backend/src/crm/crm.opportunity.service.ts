import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CrmScopeService, CrmContext } from './crm.scope';
import {
  asArray,
  dateOrNull,
  int,
  iso,
  jsonArray,
  jsonObject,
  money,
  moneyStr,
  statusLabel,
} from './crm.helpers';
import { CrmSettingsService } from './crm.settings.service';

export class CrmOpportunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
    private readonly settings: CrmSettingsService,
  ) {}

  private async stageMap(ownerUserId: string) {
    const rows = await this.prisma.crmOpportunityStage.findMany({
      where: { ownerUserId },
      orderBy: { sort: 'asc' },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async viewRows(rows: Record<string, unknown>[], ctx: CrmContext) {
    const stages = await this.stageMap(ctx.ownerUserId);
    const customerIds = [...new Set(rows.map((row) => Number(row.customerId)))];
    const customers = customerIds.length
      ? await this.prisma.crmCustomer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : [];
    const customerNames = new Map(customers.map((row) => [row.id, row.name]));
    const contactIds = [
      ...new Set(rows.map((row) => Number(row.contactId)).filter(Boolean)),
    ];
    const contacts = contactIds.length
      ? await this.prisma.crmContact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true },
        })
      : [];
    const contactNames = new Map(contacts.map((row) => [row.id, row.name]));
    const names = await this.scope.names(rows.map((row) => text(row.ownerId)));
    return rows.map((row) => {
      const stage = stages.get(Number(row.stageId));
      return {
        id: Number(row.id),
        customerId: Number(row.customerId),
        customerName: customerNames.get(Number(row.customerId)) || '',
        name: text(row.name),
        amount: moneyStr(row.amount),
        possible: moneyStr(row.possible),
        stageId: Number(row.stageId),
        stageName: stage?.name || '',
        stageType: stage?.type || '',
        ownerId: text(row.ownerId),
        ownerName: names.get(text(row.ownerId)) || '',
        contactId: Number(row.contactId),
        contactName: contactNames.get(Number(row.contactId)) || '',
        expectedEndAt: iso(row.expectedEndAt as Date | null),
        actualEndAt: iso(row.actualEndAt as Date | null),
        failureReason: text(row.failureReason),
        lastFollowAt: iso(row.lastFollowAt as Date | null),
        approvalStatus: text(row.approvalStatus),
        approvalStatusLabel: statusLabel(text(row.approvalStatus)),
        custom: jsonObject(row.custom),
        createdAt: iso(row.createdAt as Date | null),
      };
    });
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const base = await this.scope.scopeWhereAsync(ctx);
    const where: Prisma.CrmOpportunityWhereInput = {
      ...base,
      deletedAt: null,
    };
    if (text(query.view) === 'mine') where.ownerId = ctx.actorId;
    if (query.stageId) where.stageId = Number(query.stageId);
    if (query.customerId) where.customerId = Number(query.customerId);
    const keyword = text(query.keyword).trim();
    if (keyword) where.name = { contains: keyword };
    const [rows, total] = await Promise.all([
      this.prisma.crmOpportunity.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmOpportunity.count({ where }),
    ]);
    return {
      list: await this.viewRows(rows, ctx),
      total,
      page,
      pageSize,
    };
  }

  private async findOne(ctx: CrmContext, rawId: string) {
    const id = Number(rawId);
    const base = await this.scope.scopeWhereAsync(ctx);
    const row = await this.prisma.crmOpportunity.findFirst({
      where: { ...base, id, deletedAt: null },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '商机不存在或无权查看');
    return row;
  }

  async get(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    const [items, quotations, follows, plans, contracts] = await Promise.all([
      this.prisma.crmOpportunityItem.findMany({
        where: { opportunityId: row.id },
      }),
      this.prisma.crmQuotation.findMany({
        where: { ownerUserId: ctx.ownerUserId, opportunityId: row.id },
        orderBy: { version: 'desc' },
      }),
      this.prisma.crmFollowRecord.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'OPPORTUNITY',
          targetId: row.id,
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.crmFollowPlan.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'OPPORTUNITY',
          targetId: row.id,
        },
        orderBy: { id: 'desc' },
        take: 50,
      }),
      this.prisma.crmContract.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          opportunityId: row.id,
          deletedAt: null,
        },
        orderBy: { id: 'desc' },
      }),
    ]);
    const quotationViews = await this.quotationViews(quotations);
    const [opportunity] = await this.viewRows([row], ctx);
    const names = await this.scope.names(
      follows
        .map((item) => item.createdBy)
        .concat(plans.map((item) => item.ownerId)),
    );
    return {
      opportunity,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        nameSnapshot: item.nameSnapshot,
        qty: moneyStr(item.qty),
        price: moneyStr(item.price),
        amount: moneyStr(item.amount),
      })),
      quotations: quotationViews,
      follows: follows.map((item) => ({
        id: item.id,
        targetType: item.targetType,
        targetId: item.targetId,
        type: item.type,
        content: item.content,
        result: item.result,
        nextAt: iso(item.nextAt),
        createdBy: item.createdBy,
        createdByName: names.get(item.createdBy) || '',
        createdAt: iso(item.createdAt),
      })),
      plans: plans.map((item) => ({
        id: item.id,
        targetType: item.targetType,
        targetId: item.targetId,
        planAt: iso(item.planAt),
        status: item.status,
        statusLabel: '',
        ownerId: item.ownerId,
        ownerName: names.get(item.ownerId) || '',
        content: item.content,
        reminderAt: iso(item.reminderAt),
        createdAt: iso(item.createdAt),
      })),
      contracts: contracts.map((item) => ({
        id: item.id,
        number: item.number,
        name: item.name,
        customerId: item.customerId,
        customerName: '',
        opportunityId: item.opportunityId,
        quotationId: item.quotationId,
        amount: moneyStr(item.amount),
        paidAmount: '0.00',
        stageId: item.stageId,
        stageName: '',
        approvalStatus: item.approvalStatus,
        approvalStatusLabel: statusLabel(item.approvalStatus),
        ownerId: item.ownerId,
        ownerName: '',
        startAt: iso(item.startAt),
        endAt: iso(item.endAt),
        voidReason: item.voidReason,
        remark: item.remark,
        createdAt: iso(item.createdAt),
      })),
    };
  }

  private async quotationViews(
    rows: Array<{
      id: number;
      opportunityId: number;
      name: string;
      untilAt: Date | null;
      amount: unknown;
      approvalStatus: string;
      invalid: boolean;
      version: number;
      createdAt: Date;
    }>,
  ) {
    if (!rows.length) return [];
    const items = await this.prisma.crmQuotationItem.findMany({
      where: { quotationId: { in: rows.map((row) => row.id) } },
    });
    const opportunities = await this.prisma.crmOpportunity.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.opportunityId))] } },
      select: { id: true, name: true, customerId: true },
    });
    const customers = await this.prisma.crmCustomer.findMany({
      where: { id: { in: opportunities.map((row) => row.customerId) } },
      select: { id: true, name: true },
    });
    const customerNames = new Map(customers.map((row) => [row.id, row.name]));
    const oppMap = new Map(opportunities.map((row) => [row.id, row]));
    return rows.map((row) => {
      const opp = oppMap.get(row.opportunityId);
      return {
        id: row.id,
        opportunityId: row.opportunityId,
        opportunityName: opp?.name || '',
        customerId: opp?.customerId || 0,
        customerName: customerNames.get(opp?.customerId || 0) || '',
        name: row.name,
        untilAt: iso(row.untilAt),
        amount: moneyStr(row.amount),
        approvalStatus: row.approvalStatus,
        approvalStatusLabel: statusLabel(row.approvalStatus),
        invalid: row.invalid,
        version: row.version,
        items: items
          .filter((item) => item.quotationId === row.id)
          .map((item) => ({
            id: item.id,
            productId: item.productId,
            nameSnapshot: item.nameSnapshot,
            qty: moneyStr(item.qty),
            price: moneyStr(item.price),
            amount: moneyStr(item.amount),
          })),
        createdAt: iso(row.createdAt),
      };
    });
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const customerId = int(body.customerId);
    const customer = await this.prisma.crmCustomer.findFirst({
      where: { id: customerId, ownerUserId: ctx.ownerUserId, deletedAt: null },
    });
    if (!customer)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择客户');
    const name = text(body.name).trim().slice(0, 120);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写商机名称');
    const stages = await this.stageMap(ctx.ownerUserId);
    let stageId = int(body.stageId);
    if (!stages.has(stageId)) {
      stageId =
        [...stages.values()].find((row) => row.type === 'AFOOT')?.id || 0;
    }
    const stage = stages.get(stageId);
    const amount = money(body.amount);
    const winRate = stage?.winRate || 0;
    const items = jsonArray(body.items);
    const row = await this.prisma.crmOpportunity.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        ...this.scope.orgKey(ctx),
        customerId,
        name,
        amount,
        possible: money(Number(amount) * (winRate / 100)),
        products: asArray(body.products),
        stageId,
        contactId: int(body.contactId),
        ownerId: text(body.ownerId) || ctx.actorId,
        expectedEndAt: dateOrNull(body.expectedEndAt),
        custom: toJsonInput(jsonObject(body.custom)),
      },
    });
    for (const item of items) {
      const qty = money(item.qty, '1');
      const price = money(item.price);
      await this.prisma.crmOpportunityItem.create({
        data: {
          opportunityId: row.id,
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
      'OPPORTUNITY',
      row.id,
      'CREATE',
      {},
      { name },
      ctx.actorId,
    );
    return (await this.viewRows([row], ctx))[0];
  }

  async update(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const row = await this.findOne(ctx, rawId);
    const data: Prisma.CrmOpportunityUncheckedUpdateInput = {};
    for (const key of ['name', 'failureReason'] as const) {
      if (body[key] !== undefined)
        data[key] = text(body[key]).slice(0, key === 'name' ? 120 : 200);
    }
    if (body.amount !== undefined) data.amount = money(body.amount);
    if (body.expectedEndAt !== undefined)
      data.expectedEndAt = dateOrNull(body.expectedEndAt);
    if (body.contactId !== undefined) data.contactId = int(body.contactId);
    if (body.ownerId !== undefined) data.ownerId = text(body.ownerId);
    if (body.products !== undefined) data.products = asArray(body.products);
    if (body.custom !== undefined)
      data.custom = toJsonInput(jsonObject(body.custom));
    const updated = await this.prisma.crmOpportunity.update({
      where: { id: row.id },
      data,
    });
    await this.settings.log(
      ctx.ownerUserId,
      'OPPORTUNITY',
      row.id,
      'UPDATE',
      {},
      data,
      ctx.actorId,
    );
    return (await this.viewRows([updated], ctx))[0];
  }

  async updateStage(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const row = await this.findOne(ctx, rawId);
    const stages = await this.stageMap(ctx.ownerUserId);
    const current = stages.get(row.stageId);
    const next = stages.get(int(body.stageId));
    if (!next)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '商机阶段不正确');
    if (current?.type === 'END') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '商机已结束，不能再推进阶段',
      );
    }
    const amount = Number(row.amount);
    const updated = await this.prisma.crmOpportunity.update({
      where: { id: row.id },
      data: {
        stageId: next.id,
        possible: money(amount * (next.winRate / 100)),
        actualEndAt:
          next.type === 'END'
            ? dateOrNull(body.actualEndAt) || new Date()
            : null,
        failureReason:
          next.type === 'END' ? text(body.failureReason).slice(0, 200) : '',
      },
    });
    await this.settings.log(
      ctx.ownerUserId,
      'OPPORTUNITY',
      row.id,
      'STAGE',
      { stageId: row.stageId },
      { stageId: next.id },
      ctx.actorId,
    );
    return (await this.viewRows([updated], ctx))[0];
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'delete');
    const row = await this.findOne(ctx, rawId);
    await this.prisma.crmOpportunity.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    return { removed: true };
  }

  async stages(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmOpportunityStage.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { sort: 'asc' },
    });
    const groups = await this.prisma.crmOpportunity.groupBy({
      by: ['stageId'],
      where: { ownerUserId: ctx.ownerUserId, deletedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const byId = new Map(groups.map((row) => [row.stageId, row]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      sort: row.sort,
      winRate: row.winRate,
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
    const type = text(body.type, 'AFOOT');
    if (!['AFOOT', 'END'].includes(type)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '阶段类型不正确');
    }
    const data = {
      name,
      type,
      sort: int(body.sort),
      winRate: Math.min(100, Math.max(0, int(body.winRate))),
    };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmOpportunityStage.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '商机阶段不存在');
    }
    const row = id
      ? await this.prisma.crmOpportunityStage.update({ where: { id }, data })
      : await this.prisma.crmOpportunityStage.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '商机阶段不存在');
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      sort: row.sort,
      winRate: row.winRate,
      count: 0,
      amount: '0.00',
    };
  }

  async removeStage(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmOpportunityStage.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '商机阶段不存在');
    const used = await this.prisma.crmOpportunity.count({
      where: { ownerUserId: ctx.ownerUserId, stageId: id, deletedAt: null },
    });
    if (used)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `还有 ${used} 个商机在这个阶段`,
      );
    await this.prisma.crmOpportunityStage.delete({ where: { id } });
    return { removed: true };
  }

  async rules(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmOpportunityRule.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopeIds: asArray(row.scopeIds),
      auto: row.auto,
      conditions: jsonArray(row.conditions),
    }));
  }

  async saveRule(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const data = {
      name: text(body.name).trim().slice(0, 60),
      scopeIds: asArray(body.scopeIds),
      auto: Boolean(body.auto),
      conditions: toJsonInput(jsonArray(body.conditions)),
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写规则名称');
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmOpportunityRule.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '商机规则不存在');
    }
    const row = id
      ? await this.prisma.crmOpportunityRule.update({ where: { id }, data })
      : await this.prisma.crmOpportunityRule.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return {
      id: row.id,
      name: row.name,
      scopeIds: asArray(row.scopeIds),
      auto: row.auto,
      conditions: jsonArray(row.conditions),
    };
  }

  async quotations(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const where = {
      ownerUserId: ctx.ownerUserId,
      ...(query.opportunityId
        ? { opportunityId: Number(query.opportunityId) }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.crmQuotation.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmQuotation.count({ where }),
    ]);
    return {
      list: await this.quotationViews(rows),
      total,
      page,
      pageSize,
    };
  }

  async saveQuotation(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const opportunityId = int(body.opportunityId);
    const opportunity = await this.findOne(ctx, String(opportunityId));
    const items = jsonArray(body.items);
    let amount = 0;
    for (const item of items) {
      amount += Number(money(item.qty, '1')) * Number(money(item.price));
    }
    const id = int(body.id);
    const existing = id
      ? await this.prisma.crmQuotation.findFirst({
          where: { id, ownerUserId: ctx.ownerUserId },
        })
      : null;
    if (id && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '报价单不存在');
    }
    if (existing?.invalid) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '作废的报价不能再修改',
      );
    }
    const row = existing
      ? await this.prisma.crmQuotation.update({
          where: { id: existing.id },
          data: {
            name: text(body.name, existing.name).slice(0, 120),
            untilAt:
              body.untilAt === undefined
                ? existing.untilAt
                : dateOrNull(body.untilAt),
            amount: money(amount),
          },
        })
      : await this.prisma.crmQuotation.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            opportunityId,
            name: text(body.name) || `${opportunity.name}报价`,
            untilAt: dateOrNull(body.untilAt),
            amount: money(amount),
            version:
              ((
                await this.prisma.crmQuotation.findFirst({
                  where: { ownerUserId: ctx.ownerUserId, opportunityId },
                  orderBy: { version: 'desc' },
                })
              )?.version || 0) + 1,
          },
        });
    if (existing) {
      await this.prisma.crmQuotationItem.deleteMany({
        where: { quotationId: existing.id },
      });
    }
    for (const item of items) {
      const qty = money(item.qty, '1');
      const price = money(item.price);
      await this.prisma.crmQuotationItem.create({
        data: {
          quotationId: row.id,
          productId: int(item.productId),
          nameSnapshot: text(item.nameSnapshot).slice(0, 120),
          qty,
          price,
          amount: money(Number(qty) * Number(price)),
        },
      });
    }
    const views = await this.quotationViews([row]);
    return views[0];
  }

  async voidQuotation(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const id = Number(rawId);
    const row = await this.prisma.crmQuotation.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '报价单不存在');
    const updated = await this.prisma.crmQuotation.update({
      where: { id },
      data: { invalid: true },
    });
    return (await this.quotationViews([updated]))[0];
  }

  async removeQuotation(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'delete');
    const id = Number(rawId);
    const row = await this.prisma.crmQuotation.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '报价单不存在');
    await this.prisma.crmQuotationItem.deleteMany({
      where: { quotationId: id },
    });
    await this.prisma.crmQuotation.delete({ where: { id } });
    return { removed: true };
  }
}
