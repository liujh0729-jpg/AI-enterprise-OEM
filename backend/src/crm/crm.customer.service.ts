import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CrmScopeService, CrmContext } from './crm.scope';
import {
  COLLAB_TYPE_LABELS,
  RELATION_TYPE_LABELS,
  asArray,
  dateOrNull,
  int,
  iso,
  jsonObject,
  moneyStr,
  normEmail,
  normName,
  normPhone,
  statusLabel,
} from './crm.helpers';
import { CrmSettingsService } from './crm.settings.service';

type CustomerRow = {
  id: number;
  ownerUserId: string;
  partyId: number;
  name: string;
  nameNorm: string;
  ownerId: string;
  poolId: number;
  inPool: boolean;
  collectionAt: Date | null;
  lastFollowerId: string;
  lastFollowAt: Date | null;
  reasonId: number;
  frozen: boolean;
  freezeReason: string;
  unfreezeAt: Date | null;
  approvalStatus: string;
  industry: string;
  province: string;
  city: string;
  remark: string;
  custom: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export class CrmCustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
    private readonly settings: CrmSettingsService,
  ) {}

  private async viewRows(rows: CustomerRow[], ctx: CrmContext) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [names, pools, contacts, opportunities, contracts] =
      await Promise.all([
        this.scope.names(rows.map((row) => row.ownerId)),
        rows.some((row) => row.poolId)
          ? this.prisma.crmCustomerPool.findMany({
              where: {
                id: { in: [...new Set(rows.map((row) => row.poolId))] },
              },
              select: { id: true, name: true },
            })
          : [],
        this.prisma.crmContact.groupBy({
          by: ['customerId'],
          where: {
            ownerUserId: ctx.ownerUserId,
            customerId: { in: ids },
            enabled: true,
          },
          _count: { _all: true },
        }),
        this.prisma.crmOpportunity.groupBy({
          by: ['customerId'],
          where: {
            ownerUserId: ctx.ownerUserId,
            customerId: { in: ids },
            deletedAt: null,
          },
          _count: { _all: true },
        }),
        this.prisma.crmContract.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            customerId: { in: ids },
            deletedAt: null,
          },
          select: { customerId: true, amount: true },
        }),
      ]);
    const poolNames = new Map(pools.map((row) => [row.id, row.name]));
    const contactMap = new Map(
      contacts.map((row) => [row.customerId, row._count._all]),
    );
    const oppMap = new Map(
      opportunities.map((row) => [row.customerId, row._count._all]),
    );
    const amountMap = new Map<number, number>();
    for (const contract of contracts) {
      amountMap.set(
        contract.customerId,
        (amountMap.get(contract.customerId) || 0) + Number(contract.amount),
      );
    }
    return rows.map((row) => ({
      id: row.id,
      partyId: row.partyId,
      name: row.name,
      ownerId: row.ownerId,
      ownerName: names.get(row.ownerId) || '',
      poolId: row.poolId,
      poolName: poolNames.get(row.poolId) || '',
      inPool: row.inPool,
      collectionAt: iso(row.collectionAt),
      lastFollowAt: iso(row.lastFollowAt),
      frozen: row.frozen,
      freezeReason: row.freezeReason,
      approvalStatus: row.approvalStatus,
      approvalStatusLabel: statusLabel(row.approvalStatus),
      industry: row.industry,
      province: row.province,
      city: row.city,
      contactCount: contactMap.get(row.id) || 0,
      opportunityCount: oppMap.get(row.id) || 0,
      contractAmount: moneyStr(amountMap.get(row.id) || 0),
      custom: jsonObject(row.custom),
      remark: row.remark,
      createdAt: iso(row.createdAt),
    }));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const base = await this.scope.scopeWhereAsync(ctx);
    const where: Prisma.CrmCustomerWhereInput = { ...base, deletedAt: null };
    const view = text(query.view, 'all');
    if (view === 'mine') where.ownerId = ctx.actorId;
    if (view === 'pool') {
      // 公海是组织内共享池（入池时 ownerId 已清空），按 inPool 取；租户键仍在上面，不跨组织。
      where.inPool = true;
      where.ownerId = '';
    }
    if (query.poolId) where.poolId = Number(query.poolId);
    // 负责人筛选只能与授权范围取交集，不能覆盖它（设计方案 §3.3）。
    const ownerFilter = text(query.ownerId);
    if (ownerFilter && !this.scope.ownerInScope(base.ownerId, ownerFilter)) {
      return { list: [], total: 0, page, pageSize };
    }
    if (ownerFilter) where.ownerId = ownerFilter;
    const keyword = text(query.keyword).trim();
    if (keyword) where.OR = [{ name: { contains: keyword } }];
    const [rows, total] = await Promise.all([
      this.prisma.crmCustomer.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmCustomer.count({ where }),
    ]);
    return { list: await this.viewRows(rows, ctx), total, page, pageSize };
  }

  private async findOne(ctx: CrmContext, rawId: string) {
    const id = Number(rawId);
    const { ownerId: ownerFilter, ...base } =
      await this.scope.scopeWhereAsync(ctx);
    const where: Prisma.CrmCustomerWhereInput = {
      ...base,
      id,
      deletedAt: null,
    };
    if (ownerFilter !== undefined) {
      // 协作客户与客户表无关系字段，先取本人被邀请协作的客户 id
      const collab = await this.prisma.crmCustomerCollaboration.findMany({
        where: { ownerUserId: ctx.ownerUserId, userId: ctx.actorId },
        select: { customerId: true },
      });
      where.OR = [
        { ownerId: ownerFilter },
        { id: { in: collab.map((row) => row.customerId) } },
      ];
    }
    const row = await this.prisma.crmCustomer.findFirst({
      where,
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '客户不存在或无权查看');
    return row as CustomerRow;
  }

  async get360(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const customer = await this.findOne(ctx, rawId);
    const contractIds = (
      await this.prisma.crmContract.findMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: customer.id },
        select: { id: true },
      })
    ).map((row) => row.id);
    const [
      contacts,
      collaborations,
      relations,
      opportunities,
      contracts,
      plans,
      records,
      invoices,
      orders,
      follows,
      plansFollow,
      history,
      titles,
    ] = await Promise.all([
      this.prisma.crmContact.findMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: customer.id },
        orderBy: { id: 'asc' },
      }),
      this.prisma.crmCustomerCollaboration.findMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: customer.id },
      }),
      this.prisma.crmCustomerRelation.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          OR: [
            { sourceCustomerId: customer.id },
            { targetCustomerId: customer.id },
          ],
        },
      }),
      this.prisma.crmOpportunity.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          customerId: customer.id,
          deletedAt: null,
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.crmContract.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          customerId: customer.id,
          deletedAt: null,
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.crmPaymentPlan.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          contractId: { in: contractIds },
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.crmPaymentRecord.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          contractId: { in: contractIds },
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.crmInvoice.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          contractId: { in: contractIds },
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.crmOrder.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          customerId: customer.id,
          deletedAt: null,
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.crmFollowRecord.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'CUSTOMER',
          targetId: customer.id,
        },
        orderBy: { id: 'desc' },
        take: 100,
      }),
      this.prisma.crmFollowPlan.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'CUSTOMER',
          targetId: customer.id,
        },
        orderBy: { id: 'desc' },
        take: 50,
      }),
      this.prisma.crmOwnerHistory.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'CUSTOMER',
          targetId: customer.id,
        },
        orderBy: { id: 'desc' },
        take: 50,
      }),
      this.prisma.crmBusinessTitle.findMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: customer.id },
        orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const names = await this.scope.names([
      customer.ownerId,
      ...contacts.map((row) => row.ownerId),
      ...collaborations.map((row) => row.userId),
      ...opportunities.map((row) => row.ownerId),
      ...contracts.map((row) => row.ownerId),
      ...orders.map((row) => row.ownerId),
      ...follows.map((row) => row.createdBy),
      ...plansFollow.map((row) => row.ownerId),
    ]);
    const relationIds = relations.map((row) =>
      row.sourceCustomerId === customer.id
        ? row.targetCustomerId
        : row.sourceCustomerId,
    );
    const relationCustomers = relationIds.length
      ? await this.prisma.crmCustomer.findMany({
          where: { id: { in: relationIds } },
          select: { id: true, name: true },
        })
      : [];
    const relationNames = new Map(
      relationCustomers.map((row) => [row.id, row.name]),
    );
    const pool = customer.poolId
      ? await this.prisma.crmCustomerPool.findUnique({
          where: { id: customer.poolId },
        })
      : null;
    const [view] = await this.viewRows([customer], ctx);
    return {
      customer: {
        ...view,
        poolName: pool?.name || '',
        collaborationCount: collaborations.length,
      },
      contacts: contacts.map((row) => this.contactView(row, names, ctx)),
      collaborations: collaborations.map((row) => ({
        id: row.id,
        userId: row.userId,
        userName: names.get(row.userId) || row.userId,
        type: row.type,
        typeLabel: COLLAB_TYPE_LABELS[row.type] || row.type,
      })),
      relations: relations.map((row) => {
        const otherId =
          row.sourceCustomerId === customer.id
            ? row.targetCustomerId
            : row.sourceCustomerId;
        return {
          id: row.id,
          customerId: otherId,
          customerName: relationNames.get(otherId) || '',
          type: row.type,
          typeLabel: RELATION_TYPE_LABELS[row.type] || row.type,
        };
      }),
      opportunities: opportunities.map((row) => ({
        id: row.id,
        customerId: row.customerId,
        customerName: customer.name,
        name: row.name,
        amount: moneyStr(row.amount),
        possible: moneyStr(row.possible),
        stageId: row.stageId,
        stageName: '',
        stageType: '',
        ownerId: row.ownerId,
        ownerName: names.get(row.ownerId) || '',
        contactId: row.contactId,
        contactName: '',
        expectedEndAt: iso(row.expectedEndAt),
        actualEndAt: iso(row.actualEndAt),
        failureReason: row.failureReason,
        lastFollowAt: iso(row.lastFollowAt),
        approvalStatus: row.approvalStatus,
        approvalStatusLabel: statusLabel(row.approvalStatus),
        custom: jsonObject(row.custom),
        createdAt: iso(row.createdAt),
      })),
      contracts: contracts.map((row) => ({
        id: row.id,
        number: row.number,
        name: row.name,
        customerId: row.customerId,
        customerName: customer.name,
        opportunityId: row.opportunityId,
        quotationId: row.quotationId,
        amount: moneyStr(row.amount),
        paidAmount: '0.00',
        stageId: row.stageId,
        stageName: '',
        approvalStatus: row.approvalStatus,
        approvalStatusLabel: statusLabel(row.approvalStatus),
        ownerId: row.ownerId,
        ownerName: names.get(row.ownerId) || '',
        startAt: iso(row.startAt),
        endAt: iso(row.endAt),
        voidReason: row.voidReason,
        remark: row.remark,
        createdAt: iso(row.createdAt),
      })),
      paymentPlans: plans.map((row) => ({
        id: row.id,
        contractId: row.contractId,
        contractNumber: '',
        contractName: '',
        customerName: customer.name,
        name: row.name,
        planAmount: moneyStr(row.planAmount),
        paidAmount: '0.00',
        planEndAt: iso(row.planEndAt),
        status: row.status,
        statusLabel: '',
        overdue: false,
        createdAt: iso(row.createdAt),
      })),
      paymentRecords: records.map((row) => ({
        id: row.id,
        contractId: row.contractId,
        contractNumber: '',
        customerName: customer.name,
        paymentPlanId: row.paymentPlanId,
        planName: '',
        name: row.name,
        no: row.no,
        recordAmount: moneyStr(row.recordAmount),
        recordEndAt: iso(row.recordEndAt),
        attachmentKey: row.attachmentKey,
        createdAt: iso(row.createdAt),
      })),
      invoices: invoices.map((row) => ({
        id: row.id,
        contractId: row.contractId,
        contractNumber: '',
        businessTitleId: row.businessTitleId,
        businessTitleName: '',
        name: row.name,
        amount: moneyStr(row.amount),
        invoiceType: row.invoiceType,
        invoiceTypeLabel: '',
        taxRate: moneyStr(row.taxRate),
        approvalStatus: row.approvalStatus,
        approvalStatusLabel: statusLabel(row.approvalStatus),
        attachmentKey: row.attachmentKey,
        remark: row.remark,
        createdAt: iso(row.createdAt),
      })),
      orders: orders.map((row) => ({
        id: row.id,
        number: row.number,
        name: row.name,
        customerId: row.customerId,
        customerName: customer.name,
        contractId: row.contractId,
        contractNumber: '',
        amount: moneyStr(row.amount),
        stageId: row.stageId,
        stageName: '',
        approvalStatus: row.approvalStatus,
        approvalStatusLabel: statusLabel(row.approvalStatus),
        ownerId: row.ownerId,
        ownerName: names.get(row.ownerId) || '',
        remark: row.remark,
        createdAt: iso(row.createdAt),
      })),
      follows: follows.map((row) => ({
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
      })),
      plans: plansFollow.map((row) => ({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        planAt: iso(row.planAt),
        status: row.status,
        statusLabel: '',
        ownerId: row.ownerId,
        ownerName: names.get(row.ownerId) || '',
        content: row.content,
        reminderAt: iso(row.reminderAt),
        createdAt: iso(row.createdAt),
      })),
      ownerHistory: history.map((row) => ({
        id: row.id,
        fromOwner: row.fromOwner,
        fromOwnerName: names.get(row.fromOwner) || '',
        toOwner: row.toOwner,
        toOwnerName: names.get(row.toOwner) || '',
        reason: row.reason,
        createdAt: iso(row.createdAt),
      })),
      titles: titles.map((row) => this.titleView(row, customer.name)),
    };
  }

  private contactView(
    row: {
      id: number;
      customerId: number;
      name: string;
      phone: string;
      email: string;
      title: string;
      ownerId: string;
      enabled: boolean;
      disableReason: string;
      custom: unknown;
      createdAt: Date;
    },
    names: Map<string, string>,
    ctx: CrmContext,
  ) {
    const canPlain =
      ctx.isAdmin || ctx.role === 'MANAGER' || ctx.role === 'SALES';
    return {
      id: row.id,
      customerId: row.customerId,
      name: row.name,
      phone: canPlain ? row.phone : '',
      email: canPlain ? row.email : '',
      title: row.title,
      ownerId: row.ownerId,
      ownerName: names.get(row.ownerId) || '',
      enabled: row.enabled,
      disableReason: row.disableReason,
      custom: jsonObject(row.custom),
      createdAt: iso(row.createdAt),
    };
  }

  private titleView(
    row: {
      id: number;
      customerId: number;
      name: string;
      taxNo: string;
      bank: string;
      account: string;
      address: string;
      phone: string;
      capital: string;
      scale: string;
      province: string;
      city: string;
      industry: string;
      isDefault: boolean;
      remark: string;
    },
    customerName: string,
  ) {
    return {
      id: row.id,
      customerId: row.customerId,
      customerName,
      name: row.name,
      taxNo: row.taxNo,
      bank: row.bank,
      account: row.account,
      address: row.address,
      phone: row.phone,
      capital: row.capital,
      scale: row.scale,
      province: row.province,
      city: row.city,
      industry: row.industry,
      isDefault: row.isDefault,
      remark: row.remark,
    };
  }

  /** 客户与统一主体双向绑定：显式 partyId 优先，否则按名称认领/建档。 */
  private async partyIdFor(
    ctx: CrmContext,
    name: string,
    requested = 0,
  ): Promise<number> {
    const orgKey = this.scope.orgKey(ctx);
    if (requested > 0) {
      const party = await this.prisma.bizParty.findFirst({
        where: { id: requested, ...orgKey },
        select: { id: true },
      });
      if (!party)
        throw new BusinessException(ErrorCode.NOT_FOUND, '外部主体不存在');
      return requested;
    }
    const existing = await this.prisma.bizParty.findFirst({
      where: { ...orgKey, name },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.bizParty.create({
      data: {
        ...orgKey,
        kind: 'CUSTOMER',
        name,
        source: 'CRM',
        createdBy: ctx.actorId,
      },
      select: { id: true },
    });
    return created.id;
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const name = text(body.name).trim().slice(0, 120);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写客户名称');
    const ownerId = text(body.ownerId) || ctx.actorId;
    if (ownerId !== ctx.ownerUserId && !(await this.isMember(ctx, ownerId))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '负责人不是本账号 CRM 成员',
      );
    }
    const row = await this.prisma.crmCustomer.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        ...this.scope.orgKey(ctx),
        partyId: await this.partyIdFor(ctx, name, Number(body.partyId) || 0),
        name,
        nameNorm: normName(name),
        ownerId,
        collectionAt: new Date(),
        industry: text(body.industry).slice(0, 60),
        province: text(body.province).slice(0, 40),
        city: text(body.city).slice(0, 40),
        remark: text(body.remark).slice(0, 2000),
        custom: toJsonInput(jsonObject(body.custom)),
      },
    });
    await this.settings.log(
      ctx.ownerUserId,
      'CUSTOMER',
      row.id,
      'CREATE',
      {},
      { name },
      ctx.actorId,
    );
    return (await this.viewRows([row], ctx))[0];
  }

  private async isMember(ctx: CrmContext, userId: string) {
    if (userId === ctx.ownerUserId) return true;
    return Boolean(
      await this.prisma.crmMember.findFirst({
        where: {
          ownerUserId: ctx.ownerUserId,
          memberUserId: userId,
          status: 'ACTIVE',
        },
      }),
    );
  }

  async update(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const row = await this.findOne(ctx, rawId);
    const data: Prisma.CrmCustomerUncheckedUpdateInput = {};
    for (const key of [
      'name',
      'industry',
      'province',
      'city',
      'remark',
    ] as const) {
      if (body[key] !== undefined) {
        data[key] = text(body[key]).slice(0, key === 'remark' ? 2000 : 120);
      }
    }
    if (body.name !== undefined) data.nameNorm = normName(body.name);
    if (body.custom !== undefined)
      data.custom = toJsonInput(jsonObject(body.custom));
    if (body.partyId !== undefined) {
      data.partyId = await this.partyIdFor(
        ctx,
        row.name,
        Number(body.partyId) || 0,
      );
    } else if (!row.partyId) {
      data.partyId = await this.partyIdFor(ctx, row.name);
    }
    if (body.ownerId !== undefined) {
      const ownerId = text(body.ownerId);
      if (!(await this.isMember(ctx, ownerId))) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '负责人不是本账号 CRM 成员',
        );
      }
      data.ownerId = ownerId;
    }
    const updated = await this.prisma.crmCustomer.update({
      where: { id: row.id },
      data,
    });
    await this.settings.log(
      ctx.ownerUserId,
      'CUSTOMER',
      row.id,
      'UPDATE',
      {},
      data,
      ctx.actorId,
    );
    return (await this.viewRows([updated], ctx))[0];
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'delete');
    const row = await this.findOne(ctx, rawId);
    await this.prisma.crmCustomer.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    await this.settings.log(
      ctx.ownerUserId,
      'CUSTOMER',
      row.id,
      'DELETE',
      { name: row.name },
      {},
      ctx.actorId,
    );
    return { removed: true };
  }

  async transfer(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'transfer');
    const row = await this.findOne(ctx, rawId);
    const ownerId = text(body.ownerId);
    if (!(await this.isMember(ctx, ownerId))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '负责人不是本账号 CRM 成员',
      );
    }
    const updated = await this.prisma.crmCustomer.update({
      where: { id: row.id },
      data: { ownerId, inPool: false, poolId: 0 },
    });
    await this.prisma.crmOwnerHistory.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'CUSTOMER',
        targetId: row.id,
        fromOwner: row.ownerId,
        toOwner: ownerId,
        reason: text(body.reason).slice(0, 200),
        operator: ctx.actorId,
      },
    });
    return (await this.viewRows([updated], ctx))[0];
  }

  async mergePreview(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const primary = await this.findOne(ctx, text(query.primaryId));
    const secondary = await this.findOne(ctx, text(query.secondaryId));
    const [contacts, opportunities, contracts, orders] = await Promise.all([
      this.prisma.crmContact.count({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
      }),
      this.prisma.crmOpportunity.count({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
      }),
      this.prisma.crmContract.count({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
      }),
      this.prisma.crmOrder.count({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
      }),
    ]);
    return {
      primary: { id: primary.id, name: primary.name },
      secondary: { id: secondary.id, name: secondary.name },
      willMove: { contacts, opportunities, contracts, orders },
      irreversible: true,
    };
  }

  async merge(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'merge');
    const primary = await this.findOne(ctx, text(body.primaryId));
    const secondary = await this.findOne(ctx, text(body.secondaryId));
    if (primary.id === secondary.id) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能合并同一个客户');
    }
    await this.prisma.$transaction([
      this.prisma.crmContact.updateMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
        data: { customerId: primary.id },
      }),
      this.prisma.crmOpportunity.updateMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
        data: { customerId: primary.id },
      }),
      this.prisma.crmContract.updateMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
        data: { customerId: primary.id },
      }),
      this.prisma.crmOrder.updateMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
        data: { customerId: primary.id },
      }),
      this.prisma.crmBusinessTitle.updateMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
        data: { customerId: primary.id },
      }),
      this.prisma.crmCustomerCollaboration.updateMany({
        where: { ownerUserId: ctx.ownerUserId, customerId: secondary.id },
        data: { customerId: primary.id },
      }),
      this.prisma.crmFollowRecord.updateMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'CUSTOMER',
          targetId: secondary.id,
        },
        data: { targetId: primary.id },
      }),
      this.prisma.crmFollowPlan.updateMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'CUSTOMER',
          targetId: secondary.id,
        },
        data: { targetId: primary.id },
      }),
      this.prisma.crmCustomer.update({
        where: { id: secondary.id },
        data: { deletedAt: new Date() },
      }),
    ]);
    await this.settings.log(
      ctx.ownerUserId,
      'CUSTOMER',
      primary.id,
      'MERGE',
      { secondary: secondary.id, name: secondary.name },
      { primary: primary.id },
      ctx.actorId,
    );
    return (await this.viewRows([primary], ctx))[0];
  }

  async toPool(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'transfer');
    const row = await this.findOne(ctx, rawId);
    const pool = await this.prisma.crmCustomerPool.findFirst({
      where: {
        id: int(body.poolId),
        ownerUserId: ctx.ownerUserId,
        enabled: true,
      },
    });
    if (!pool)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '客户公海不存在或已停用',
      );
    const updated = await this.prisma.crmCustomer.update({
      where: { id: row.id },
      data: { poolId: pool.id, inPool: true, ownerId: '', reasonId: 0 },
    });
    await this.prisma.crmOwnerHistory.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'CUSTOMER',
        targetId: row.id,
        fromOwner: row.ownerId,
        toOwner: '',
        reason: text(body.reason, '移入客户公海').slice(0, 200),
        operator: ctx.actorId,
      },
    });
    return (await this.viewRows([updated], ctx))[0];
  }

  async pick(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'pick');
    const row = await this.findOne(ctx, rawId);
    if (!row.inPool)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这个客户不在公海');
    const capacity = await this.capacityOf(ctx);
    if (capacity > 0) {
      const used = await this.prisma.crmCustomer.count({
        where: {
          ownerUserId: ctx.ownerUserId,
          ownerId: ctx.actorId,
          inPool: false,
          deletedAt: null,
        },
      });
      if (used >= capacity) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `我的客户库容已满（${capacity}）`,
        );
      }
    }
    const claimed = await this.prisma.crmCustomer.updateMany({
      where: { id: row.id, ownerUserId: ctx.ownerUserId, inPool: true },
      data: {
        ownerId: ctx.actorId,
        inPool: false,
        poolId: 0,
        collectionAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个客户已被他人领取',
      );
    }
    const updated = await this.prisma.crmCustomer.findUnique({
      where: { id: row.id },
    });
    if (!updated) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '客户不存在');
    }
    await this.prisma.crmOwnerHistory.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'CUSTOMER',
        targetId: row.id,
        fromOwner: '',
        toOwner: ctx.actorId,
        reason: '领取',
        operator: ctx.actorId,
      },
    });
    return (await this.viewRows([updated], ctx))[0];
  }

  private async capacityOf(ctx: CrmContext) {
    const rows = await this.prisma.crmCapacity.findMany({
      where: { ownerUserId: ctx.ownerUserId, targetType: 'CUSTOMER' },
    });
    const member = rows.find(
      (row) => row.scopeType === 'MEMBER' && row.scopeId === ctx.actorId,
    );
    if (member) return member.capacity;
    const dept = rows.find(
      (row) => row.scopeType === 'DEPT' && row.scopeId === ctx.department,
    );
    if (dept) return dept.capacity;
    return rows.find((row) => row.scopeType === 'ORG')?.capacity || 0;
  }

  async assign(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    return this.transfer(user, rawId, {
      ownerId: body.ownerId,
      reason: '分配',
    });
  }

  async freeze(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'transfer');
    const row = await this.findOne(ctx, rawId);
    const updated = await this.prisma.crmCustomer.update({
      where: { id: row.id },
      data: {
        frozen: true,
        freezeReason: text(body.reason).slice(0, 200),
        unfreezeAt: dateOrNull(body.unfreezeAt),
      },
    });
    return (await this.viewRows([updated], ctx))[0];
  }

  async unfreeze(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'transfer');
    const row = await this.findOne(ctx, rawId);
    const updated = await this.prisma.crmCustomer.update({
      where: { id: row.id },
      data: { frozen: false, freezeReason: '', unfreezeAt: null },
    });
    return (await this.viewRows([updated], ctx))[0];
  }

  async pools(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmCustomerPool.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { id: 'asc' },
    });
    const counts = await this.prisma.crmCustomer.groupBy({
      by: ['poolId'],
      where: { ownerUserId: ctx.ownerUserId, inPool: true, deletedAt: null },
      _count: { _all: true },
    });
    const map = new Map(counts.map((row) => [row.poolId, row._count._all]));
    const names = await this.scope.names(rows.map((row) => row.adminId));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      adminId: row.adminId,
      adminName: names.get(row.adminId) || '',
      auto: row.auto,
      enabled: row.enabled,
      scopeIds: asArray(row.scopeIds),
      pickRule: jsonObject(row.pickRule),
      recycleRule: Array.isArray(row.recycleRule) ? row.recycleRule : [],
      leadCount: map.get(row.id) || 0,
      createdAt: iso(row.createdAt),
    }));
  }

  async savePool(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const data = {
      name: text(body.name).trim().slice(0, 60),
      description: text(body.description).slice(0, 200),
      adminId: text(body.adminId),
      auto: Boolean(body.auto),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      scopeIds: asArray(body.scopeIds),
      pickRule: toJsonInput(jsonObject(body.pickRule)),
      recycleRule: toJsonInput(
        Array.isArray(body.recycleRule) ? body.recycleRule : [],
      ),
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写客户公海名称');
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmCustomerPool.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '客户公海不存在');
    }
    const row = id
      ? await this.prisma.crmCustomerPool.update({ where: { id }, data })
      : await this.prisma.crmCustomerPool.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '客户公海不存在');
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      adminId: row.adminId,
      adminName: '',
      auto: row.auto,
      enabled: row.enabled,
      scopeIds: asArray(row.scopeIds),
      pickRule: jsonObject(row.pickRule),
      recycleRule: Array.isArray(row.recycleRule) ? row.recycleRule : [],
      leadCount: 0,
      createdAt: iso(row.createdAt),
    };
  }

  async removePool(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmCustomerPool.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '客户公海不存在');
    const inUse = await this.prisma.crmCustomer.count({
      where: {
        ownerUserId: ctx.ownerUserId,
        poolId: id,
        inPool: true,
        deletedAt: null,
      },
    });
    if (inUse) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `公海里还有 ${inUse} 个客户，不能删除`,
      );
    }
    await this.prisma.crmCustomerPool.delete({ where: { id } });
    return { removed: true };
  }

  // ---------------------------------------------------------------- 联系人 / 协作 / 关系

  async contacts(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const customer = await this.findOne(ctx, text(query.customerId));
    const rows = await this.prisma.crmContact.findMany({
      where: { ownerUserId: ctx.ownerUserId, customerId: customer.id },
      orderBy: { id: 'asc' },
    });
    const names = await this.scope.names(rows.map((row) => row.ownerId));
    return rows.map((row) => this.contactView(row, names, ctx));
  }

  async saveContact(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const customer = await this.findOne(ctx, text(body.customerId));
    const name = text(body.name).trim().slice(0, 60);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写联系人姓名');
    const data = {
      customerId: customer.id,
      name,
      phone: text(body.phone).slice(0, 40),
      phoneNorm: normPhone(body.phone),
      email: text(body.email).slice(0, 120),
      emailNorm: normEmail(body.email),
      title: text(body.title).slice(0, 60),
      ownerId: text(body.ownerId) || ctx.actorId,
      custom: toJsonInput(jsonObject(body.custom)),
    };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmContact.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId, customerId: customer.id },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '联系人不存在');
    }
    const row = id
      ? await this.prisma.crmContact.update({ where: { id }, data })
      : await this.prisma.crmContact.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId || row.customerId !== customer.id) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '联系人不存在');
    }
    const names = await this.scope.names([row.ownerId]);
    return this.contactView(row, names, ctx);
  }

  async toggleContact(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const id = Number(rawId);
    const row = await this.prisma.crmContact.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '联系人不存在');
    await this.findOne(ctx, String(row.customerId));
    const updated = await this.prisma.crmContact.update({
      where: { id },
      data: {
        enabled: Boolean(body.enabled),
        disableReason: text(body.reason).slice(0, 200),
      },
    });
    const names = await this.scope.names([updated.ownerId]);
    return this.contactView(updated, names, ctx);
  }

  async removeContact(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const id = Number(rawId);
    const row = await this.prisma.crmContact.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '联系人不存在');
    await this.findOne(ctx, String(row.customerId));
    await this.prisma.crmContact.delete({ where: { id } });
    return { removed: true };
  }

  async collaborations(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const customer = await this.findOne(ctx, text(query.customerId));
    const rows = await this.prisma.crmCustomerCollaboration.findMany({
      where: { ownerUserId: ctx.ownerUserId, customerId: customer.id },
    });
    const names = await this.scope.names(rows.map((row) => row.userId));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userName: names.get(row.userId) || row.userId,
      type: row.type,
      typeLabel: COLLAB_TYPE_LABELS[row.type] || row.type,
    }));
  }

  async saveCollaboration(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const customer = await this.findOne(ctx, text(body.customerId));
    const userId = text(body.userId);
    if (!(await this.isMember(ctx, userId))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '协作人不是本账号 CRM 成员',
      );
    }
    const row = await this.prisma.crmCustomerCollaboration.upsert({
      where: { customerId_userId: { customerId: customer.id, userId } },
      create: {
        ownerUserId: ctx.ownerUserId,
        customerId: customer.id,
        userId,
        type: text(body.type, 'COLLABORATION'),
      },
      update: { type: text(body.type, 'COLLABORATION') },
    });
    const names = await this.scope.names([userId]);
    return {
      id: row.id,
      userId: row.userId,
      userName: names.get(row.userId) || row.userId,
      type: row.type,
      typeLabel: COLLAB_TYPE_LABELS[row.type] || row.type,
    };
  }

  async removeCollaboration(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const id = Number(rawId);
    const row = await this.prisma.crmCustomerCollaboration.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '协作人不存在');
    await this.prisma.crmCustomerCollaboration.delete({ where: { id } });
    return { removed: true };
  }

  async relations(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const customer = await this.findOne(ctx, text(query.customerId));
    const rows = await this.prisma.crmCustomerRelation.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        OR: [
          { sourceCustomerId: customer.id },
          { targetCustomerId: customer.id },
        ],
      },
    });
    const ids = rows.map((row) =>
      row.sourceCustomerId === customer.id
        ? row.targetCustomerId
        : row.sourceCustomerId,
    );
    const customers = ids.length
      ? await this.prisma.crmCustomer.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(customers.map((row) => [row.id, row.name]));
    return rows.map((row) => {
      const otherId =
        row.sourceCustomerId === customer.id
          ? row.targetCustomerId
          : row.sourceCustomerId;
      return {
        id: row.id,
        customerId: otherId,
        customerName: names.get(otherId) || '',
        type: row.type,
        typeLabel: RELATION_TYPE_LABELS[row.type] || row.type,
      };
    });
  }

  async saveRelation(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const source = await this.findOne(ctx, text(body.sourceCustomerId));
    const target = await this.findOne(ctx, text(body.targetCustomerId));
    if (source.id === target.id) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能关联自己');
    }
    const type = text(body.type, 'SUBSIDIARY');
    const row = await this.prisma.crmCustomerRelation.upsert({
      where: {
        sourceCustomerId_targetCustomerId_type: {
          sourceCustomerId: source.id,
          targetCustomerId: target.id,
          type,
        },
      },
      create: {
        ownerUserId: ctx.ownerUserId,
        sourceCustomerId: source.id,
        targetCustomerId: target.id,
        type,
      },
      update: {},
    });
    return {
      id: row.id,
      customerId: target.id,
      customerName: target.name,
      type: row.type,
      typeLabel: RELATION_TYPE_LABELS[row.type] || row.type,
    };
  }

  async removeRelation(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const id = Number(rawId);
    const row = await this.prisma.crmCustomerRelation.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '客户关系不存在');
    await this.prisma.crmCustomerRelation.delete({ where: { id } });
    return { removed: true };
  }
}
