import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CrmScopeService, CrmContext } from './crm.scope';
import {
  INVOICE_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
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
import type { MechanismService } from '../mechanisms/mechanism.service';

/** 回款计划/回款记录/发票列表共用的合同维度过滤，字段与三张表一致。 */
type ContractScopedWhere = {
  ownerUserId: string;
  contractId?: number | Prisma.IntFilter;
  customerId?: number | Prisma.IntFilter;
};

export class CrmContractService {
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
          department: ctx.department,
        },
        event,
        payload,
      )
      .catch(() => undefined);
  }

  private async contractViews(
    rows: Array<Record<string, unknown>>,
    ctx: CrmContext,
  ) {
    if (!rows.length) return [];
    const ids = rows.map((row) => Number(row.id));
    const customerIds = [...new Set(rows.map((row) => Number(row.customerId)))];
    const [customers, names, stages, records] = await Promise.all([
      this.prisma.crmCustomer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true },
      }),
      this.scope.names(rows.map((row) => text(row.ownerId))),
      this.prisma.crmContractStage.findMany({
        where: { ownerUserId: ctx.ownerUserId },
      }),
      this.prisma.crmPaymentRecord.groupBy({
        by: ['contractId'],
        where: { ownerUserId: ctx.ownerUserId, contractId: { in: ids } },
        _sum: { recordAmount: true },
      }),
    ]);
    const customerNames = new Map(customers.map((row) => [row.id, row.name]));
    const stageNames = new Map(stages.map((row) => [row.id, row.name]));
    const paid = new Map(
      records.map((row) => [row.contractId, row._sum.recordAmount || 0]),
    );
    return rows.map((row) => ({
      id: Number(row.id),
      number: text(row.number),
      name: text(row.name),
      customerId: Number(row.customerId),
      customerName: customerNames.get(Number(row.customerId)) || '',
      opportunityId: Number(row.opportunityId),
      quotationId: Number(row.quotationId),
      amount: moneyStr(row.amount),
      paidAmount: moneyStr(paid.get(Number(row.id)) || 0),
      stageId: Number(row.stageId),
      stageName: stageNames.get(Number(row.stageId)) || '',
      approvalStatus: text(row.approvalStatus),
      approvalStatusLabel: statusLabel(text(row.approvalStatus)),
      ownerId: text(row.ownerId),
      ownerName: names.get(text(row.ownerId)) || '',
      startAt: iso(row.startAt as Date | null),
      endAt: iso(row.endAt as Date | null),
      voidReason: text(row.voidReason),
      remark: text(row.remark),
      createdAt: iso(row.createdAt as Date | null),
    }));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const base = await this.scope.scopeWhereAsync(ctx, 'FINANCE');
    const where: Prisma.CrmContractWhereInput = { ...base, deletedAt: null };
    if (text(query.view) === 'mine') where.ownerId = ctx.actorId;
    if (query.stageId) where.stageId = Number(query.stageId);
    if (query.customerId) where.customerId = Number(query.customerId);
    const keyword = text(query.keyword).trim();
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { number: { contains: keyword } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.crmContract.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmContract.count({ where }),
    ]);
    return {
      list: await this.contractViews(rows, ctx),
      total,
      page,
      pageSize,
    };
  }

  private async findOne(ctx: CrmContext, rawId: string) {
    const id = Number(rawId);
    const base = await this.scope.scopeWhereAsync(ctx, 'FINANCE');
    const row = await this.prisma.crmContract.findFirst({
      where: { ...base, id, deletedAt: null },
    });
    if (!row)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '销售合同不存在或无权查看',
      );
    return row;
  }

  async get(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    const [items, plans, records, invoices, titles, orders, approvals] =
      await Promise.all([
        this.prisma.crmContractItem.findMany({ where: { contractId: row.id } }),
        this.prisma.crmPaymentPlan.findMany({
          where: { ownerUserId: ctx.ownerUserId, contractId: row.id },
          orderBy: { id: 'asc' },
        }),
        this.prisma.crmPaymentRecord.findMany({
          where: { ownerUserId: ctx.ownerUserId, contractId: row.id },
          orderBy: { id: 'desc' },
        }),
        this.prisma.crmInvoice.findMany({
          where: { ownerUserId: ctx.ownerUserId, contractId: row.id },
          orderBy: { id: 'desc' },
        }),
        this.prisma.crmBusinessTitle.findMany({
          where: { ownerUserId: ctx.ownerUserId, customerId: row.customerId },
          orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
        }),
        this.prisma.crmOrder.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            contractId: row.id,
            deletedAt: null,
          },
          orderBy: { id: 'desc' },
        }),
        this.prisma.crmApprovalInstance.findMany({
          where: {
            ownerUserId: ctx.ownerUserId,
            formType: 'CONTRACT',
            targetId: row.id,
          },
          orderBy: { id: 'desc' },
        }),
      ]);
    const [contract] = await this.contractViews([row], ctx);
    const paidByPlan = await this.prisma.crmPaymentRecord.groupBy({
      by: ['paymentPlanId'],
      where: { ownerUserId: ctx.ownerUserId, contractId: row.id },
      _sum: { recordAmount: true },
    });
    const planPaid = new Map(
      paidByPlan.map((item) => [
        item.paymentPlanId,
        item._sum.recordAmount || 0,
      ]),
    );
    return {
      contract,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        nameSnapshot: item.nameSnapshot,
        qty: moneyStr(item.qty),
        price: moneyStr(item.price),
        amount: moneyStr(item.amount),
      })),
      plans: plans.map((item) => {
        const paid = Number(planPaid.get(item.id) || 0);
        return {
          id: item.id,
          contractId: item.contractId,
          contractNumber: row.number,
          contractName: row.name,
          customerName: contract.customerName,
          name: item.name,
          planAmount: moneyStr(item.planAmount),
          paidAmount: moneyStr(paid),
          planEndAt: iso(item.planEndAt),
          status: item.status,
          statusLabel: PAYMENT_STATUS_LABELS[item.status] || item.status,
          overdue:
            item.status !== 'DONE' &&
            Boolean(item.planEndAt && item.planEndAt.getTime() < Date.now()),
          createdAt: iso(item.createdAt),
        };
      }),
      records: records.map((item) => ({
        id: item.id,
        contractId: item.contractId,
        contractNumber: row.number,
        customerName: contract.customerName,
        paymentPlanId: item.paymentPlanId,
        planName:
          plans.find((plan) => plan.id === item.paymentPlanId)?.name || '',
        name: item.name,
        no: item.no,
        recordAmount: moneyStr(item.recordAmount),
        recordEndAt: iso(item.recordEndAt),
        attachmentKey: item.attachmentKey,
        createdAt: iso(item.createdAt),
      })),
      invoices: invoices.map((item) => ({
        id: item.id,
        contractId: item.contractId,
        contractNumber: row.number,
        businessTitleId: item.businessTitleId,
        businessTitleName:
          titles.find((title) => title.id === item.businessTitleId)?.name || '',
        name: item.name,
        amount: moneyStr(item.amount),
        invoiceType: item.invoiceType,
        invoiceTypeLabel:
          INVOICE_TYPE_LABELS[item.invoiceType] || item.invoiceType,
        taxRate: moneyStr(item.taxRate),
        approvalStatus: item.approvalStatus,
        approvalStatusLabel: statusLabel(item.approvalStatus),
        attachmentKey: item.attachmentKey,
        remark: item.remark,
        createdAt: iso(item.createdAt),
      })),
      titles: titles.map((item) => ({
        id: item.id,
        customerId: item.customerId,
        customerName: contract.customerName,
        name: item.name,
        taxNo: item.taxNo,
        bank: item.bank,
        account: item.account,
        address: item.address,
        phone: item.phone,
        capital: item.capital,
        scale: item.scale,
        province: item.province,
        city: item.city,
        industry: item.industry,
        isDefault: item.isDefault,
        remark: item.remark,
      })),
      orders: orders.map((item) => ({
        id: item.id,
        number: item.number,
        name: item.name,
        customerId: item.customerId,
        customerName: contract.customerName,
        contractId: item.contractId,
        contractNumber: row.number,
        amount: moneyStr(item.amount),
        stageId: item.stageId,
        stageName: '',
        approvalStatus: item.approvalStatus,
        approvalStatusLabel: statusLabel(item.approvalStatus),
        ownerId: item.ownerId,
        ownerName: '',
        remark: item.remark,
        createdAt: iso(item.createdAt),
      })),
      snapshot: jsonObject(row.snapshot),
      approvals: approvals.map((item) => ({
        id: item.id,
        formType: item.formType,
        formTypeLabel: '销售合同',
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

  private async nextNumber(ownerUserId: string) {
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const count = await this.prisma.crmContract.count({
      where: { ownerUserId },
    });
    return `HT-${stamp}-${String(count + 1).padStart(4, '0')}`;
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
    const name = text(body.name).trim().slice(0, 160);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写合同名称');
    const items = jsonArray(body.items);
    let amount = money(body.amount);
    if (items.length) {
      amount = money(
        items.reduce(
          (sum, item) =>
            sum + Number(money(item.qty, '1')) * Number(money(item.price)),
          0,
        ),
      );
    }
    const stage = await this.prisma.crmContractStage.findFirst({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { sort: 'asc' },
    });
    const row = await this.prisma.crmContract.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        ...this.scope.orgKey(ctx),
        customerId,
        opportunityId: int(body.opportunityId),
        quotationId: int(body.quotationId),
        name,
        number: await this.nextNumber(ctx.ownerUserId),
        amount,
        stageId: int(body.stageId) || stage?.id || 0,
        ownerId: text(body.ownerId) || ctx.actorId,
        startAt: dateOrNull(body.startAt),
        endAt: dateOrNull(body.endAt),
        remark: text(body.remark).slice(0, 2000),
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
      await this.prisma.crmContractItem.create({
        data: {
          contractId: row.id,
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
      'CONTRACT',
      row.id,
      'CREATE',
      {},
      { name },
      ctx.actorId,
    );
    return (await this.contractViews([row], ctx))[0];
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
        '审批中的合同不能修改',
      );
    }
    const paid = await this.paidOf(row.id);
    const data: Prisma.CrmContractUncheckedUpdateInput = {};
    for (const key of ['name', 'remark', 'voidReason'] as const) {
      if (body[key] !== undefined)
        data[key] = text(body[key]).slice(0, key === 'remark' ? 2000 : 160);
    }
    if (body.amount !== undefined) {
      const amount = money(body.amount);
      if (Number(amount) < paid) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '合同金额不能小于已回款金额',
        );
      }
      data.amount = amount;
    }
    if (body.startAt !== undefined) data.startAt = dateOrNull(body.startAt);
    if (body.endAt !== undefined) data.endAt = dateOrNull(body.endAt);
    if (body.ownerId !== undefined) data.ownerId = text(body.ownerId);
    const updated = await this.prisma.crmContract.update({
      where: { id: row.id },
      data,
    });
    await this.settings.log(
      ctx.ownerUserId,
      'CONTRACT',
      row.id,
      'UPDATE',
      {},
      data,
      ctx.actorId,
    );
    return (await this.contractViews([updated], ctx))[0];
  }

  private async paidOf(contractId: number) {
    const sum = await this.prisma.crmPaymentRecord.aggregate({
      where: { contractId },
      _sum: { recordAmount: true },
    });
    return Number(sum._sum.recordAmount || 0);
  }

  async updateStage(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const row = await this.findOne(ctx, rawId);
    const stage = await this.prisma.crmContractStage.findFirst({
      where: { id: int(body.stageId), ownerUserId: ctx.ownerUserId },
    });
    if (!stage)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '合同阶段不正确');
    const updated = await this.prisma.crmContract.update({
      where: { id: row.id },
      data: { stageId: stage.id },
    });
    return (await this.contractViews([updated], ctx))[0];
  }

  async voidContract(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const row = await this.findOne(ctx, rawId);
    const reason = text(body.reason).trim().slice(0, 200);
    if (!reason)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写作废原因');
    const updated = await this.prisma.crmContract.update({
      where: { id: row.id },
      data: { voidReason: reason, stageId: 0 },
    });
    await this.settings.log(
      ctx.ownerUserId,
      'CONTRACT',
      row.id,
      'VOID',
      {},
      { reason },
      ctx.actorId,
    );
    return (await this.contractViews([updated], ctx))[0];
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'delete');
    const row = await this.findOne(ctx, rawId);
    const paid = await this.paidOf(row.id);
    if (paid > 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '已有回款的合同不能删除，请先删除回款记录',
      );
    }
    await this.prisma.crmContract.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    return { removed: true };
  }

  async stages(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmContractStage.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { sort: 'asc' },
    });
    const groups = await this.prisma.crmContract.groupBy({
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
      const existing = await this.prisma.crmContractStage.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '合同阶段不存在');
    }
    const row = id
      ? await this.prisma.crmContractStage.update({ where: { id }, data })
      : await this.prisma.crmContractStage.create({
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
    const used = await this.prisma.crmContract.count({
      where: { ownerUserId: ctx.ownerUserId, stageId: id, deletedAt: null },
    });
    if (used)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `还有 ${used} 份合同在这个阶段`,
      );
    await this.prisma.crmContractStage.delete({ where: { id } });
    return { removed: true };
  }

  // ---------------------------------------------------------------- 回款

  async plans(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const base = await this.scope.scopeWhereAsync(ctx, 'FINANCE');
    const scopedContracts = await this.prisma.crmContract.findMany({
      where: { ...base, deletedAt: null },
      select: { id: true },
    });
    const scopedIds = scopedContracts.map((row) => row.id);
    const where: ContractScopedWhere = { ownerUserId: ctx.ownerUserId };
    if (query.contractId) where.contractId = Number(query.contractId);
    else where.contractId = { in: scopedIds };
    if (query.customerId) {
      const contracts = await this.prisma.crmContract.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          customerId: Number(query.customerId),
        },
        select: { id: true },
      });
      where.contractId = {
        in: contracts
          .map((row) => row.id)
          .filter((id) => scopedIds.includes(id)),
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.crmPaymentPlan.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmPaymentPlan.count({ where }),
    ]);
    const contracts = await this.prisma.crmContract.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.contractId))] } },
      select: { id: true, number: true, name: true, customerId: true },
    });
    const customers = await this.prisma.crmCustomer.findMany({
      where: { id: { in: contracts.map((row) => row.customerId) } },
      select: { id: true, name: true },
    });
    const customerNames = new Map(customers.map((row) => [row.id, row.name]));
    const contractMap = new Map(contracts.map((row) => [row.id, row]));
    const paid = await this.prisma.crmPaymentRecord.groupBy({
      by: ['paymentPlanId'],
      where: {
        ownerUserId: ctx.ownerUserId,
        paymentPlanId: { in: rows.map((row) => row.id) },
      },
      _sum: { recordAmount: true },
    });
    const paidMap = new Map(
      paid.map((row) => [row.paymentPlanId, row._sum.recordAmount || 0]),
    );
    const list = rows.map((row) => {
      const contract = contractMap.get(row.contractId);
      return {
        id: row.id,
        contractId: row.contractId,
        contractNumber: contract?.number || '',
        contractName: contract?.name || '',
        customerName: customerNames.get(contract?.customerId || 0) || '',
        name: row.name,
        planAmount: moneyStr(row.planAmount),
        paidAmount: moneyStr(paidMap.get(row.id) || 0),
        planEndAt: iso(row.planEndAt),
        status: row.status,
        statusLabel: PAYMENT_STATUS_LABELS[row.status] || row.status,
        overdue:
          row.status !== 'DONE' &&
          Boolean(row.planEndAt && row.planEndAt.getTime() < Date.now()),
        createdAt: iso(row.createdAt),
      };
    });
    return { list, total, page, pageSize };
  }

  async savePlan(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'finance');
    const contract = await this.findOne(ctx, text(body.contractId));
    const planAmount = money(body.planAmount);
    if (Number(planAmount) <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写计划金额');
    }
    const others = await this.prisma.crmPaymentPlan.aggregate({
      where: {
        ownerUserId: ctx.ownerUserId,
        contractId: contract.id,
        ...(int(body.id) ? { id: { not: int(body.id) } } : {}),
      },
      _sum: { planAmount: true },
    });
    const total = Number(others._sum.planAmount || 0) + Number(planAmount);
    if (total > Number(contract.amount) + 0.001) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '回款计划合计不能超过合同金额',
      );
    }
    const data = {
      contractId: contract.id,
      name: text(body.name).trim().slice(0, 120) || '回款计划',
      planAmount,
      planEndAt: dateOrNull(body.planEndAt),
    };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmPaymentPlan.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId, contractId: contract.id },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '回款计划不存在');
    }
    const row = id
      ? await this.prisma.crmPaymentPlan.update({ where: { id }, data })
      : await this.prisma.crmPaymentPlan.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return {
      id: row.id,
      contractId: row.contractId,
      contractNumber: contract.number,
      contractName: contract.name,
      customerName: '',
      name: row.name,
      planAmount: moneyStr(row.planAmount),
      paidAmount: '0.00',
      planEndAt: iso(row.planEndAt),
      status: row.status,
      statusLabel: PAYMENT_STATUS_LABELS[row.status] || row.status,
      overdue: false,
      createdAt: iso(row.createdAt),
    };
  }

  async removePlan(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'finance');
    const id = Number(rawId);
    const row = await this.prisma.crmPaymentPlan.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '回款计划不存在');
    const used = await this.prisma.crmPaymentRecord.count({
      where: { paymentPlanId: id },
    });
    if (used)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个计划已有回款记录，不能删除',
      );
    await this.prisma.crmPaymentPlan.delete({ where: { id } });
    return { removed: true };
  }

  async records(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const base = await this.scope.scopeWhereAsync(ctx, 'FINANCE');
    const scopedContracts = await this.prisma.crmContract.findMany({
      where: { ...base, deletedAt: null },
      select: { id: true },
    });
    const scopedIds = scopedContracts.map((row) => row.id);
    const where: ContractScopedWhere = { ownerUserId: ctx.ownerUserId };
    if (query.contractId) where.contractId = Number(query.contractId);
    else where.contractId = { in: scopedIds };
    if (query.customerId) {
      const contracts = await this.prisma.crmContract.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          customerId: Number(query.customerId),
        },
        select: { id: true },
      });
      where.contractId = {
        in: contracts
          .map((row) => row.id)
          .filter((id) => scopedIds.includes(id)),
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.crmPaymentRecord.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmPaymentRecord.count({ where }),
    ]);
    const contracts = await this.prisma.crmContract.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.contractId))] } },
      select: { id: true, number: true, customerId: true },
    });
    const customers = await this.prisma.crmCustomer.findMany({
      where: { id: { in: contracts.map((row) => row.customerId) } },
      select: { id: true, name: true },
    });
    const customerNames = new Map(customers.map((row) => [row.id, row.name]));
    const contractMap = new Map(contracts.map((row) => [row.id, row]));
    const plans = await this.prisma.crmPaymentPlan.findMany({
      where: {
        id: { in: rows.map((row) => row.paymentPlanId).filter(Boolean) },
      },
      select: { id: true, name: true },
    });
    const planNames = new Map(plans.map((row) => [row.id, row.name]));
    return {
      list: rows.map((row) => {
        const contract = contractMap.get(row.contractId);
        return {
          id: row.id,
          contractId: row.contractId,
          contractNumber: contract?.number || '',
          customerName: customerNames.get(contract?.customerId || 0) || '',
          paymentPlanId: row.paymentPlanId,
          planName: planNames.get(row.paymentPlanId) || '',
          name: row.name,
          no: row.no,
          recordAmount: moneyStr(row.recordAmount),
          recordEndAt: iso(row.recordEndAt),
          attachmentKey: row.attachmentKey,
          createdAt: iso(row.createdAt),
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async saveRecord(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'finance');
    const contract = await this.findOne(ctx, text(body.contractId));
    if (
      contract.approvalStatus === 'APPROVING' ||
      contract.approvalStatus === 'UNAPPROVED'
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '合同审批通过后才能登记回款',
      );
    }
    const id = int(body.id);
    const amount = money(body.recordAmount);
    if (Number(amount) <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写回款金额');
    }
    const paid = await this.paidOf(contract.id);
    const existing = id
      ? await this.prisma.crmPaymentRecord.findFirst({
          where: { id, ownerUserId: ctx.ownerUserId },
        })
      : null;
    const nextPaid =
      paid - Number(existing?.recordAmount || 0) + Number(amount);
    if (nextPaid > Number(contract.amount) + 0.001) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '累计回款不能超过合同金额',
      );
    }
    const planId = int(body.paymentPlanId);
    if (planId) {
      const plan = await this.prisma.crmPaymentPlan.findFirst({
        where: {
          id: planId,
          ownerUserId: ctx.ownerUserId,
          contractId: contract.id,
        },
      });
      if (!plan)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '回款计划不正确');
    }
    const data = {
      contractId: contract.id,
      paymentPlanId: planId,
      name: text(body.name).slice(0, 120),
      no: text(body.no).slice(0, 48),
      recordAmount: amount,
      recordEndAt: dateOrNull(body.recordEndAt) || new Date(),
      attachmentKey: text(body.attachmentKey).slice(0, 255),
    };
    const row = id
      ? await this.prisma.crmPaymentRecord.update({ where: { id }, data })
      : await this.prisma.crmPaymentRecord.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    await this.refreshPlanStatus(contract.id, planId);
    await this.settings.log(
      ctx.ownerUserId,
      'PAYMENT',
      row.id,
      id ? 'UPDATE' : 'CREATE',
      {},
      { amount: Number(amount), contractId: contract.id },
      ctx.actorId,
    );
    const totalPaid = await this.paidOf(contract.id);
    this.emitEvent(ctx, 'crm.payment.received', {
      paymentId: row.id,
      contractId: contract.id,
      contractNumber: contract.number,
      customerId: contract.customerId,
      paymentPlanId: planId,
      amount: Number(amount),
      totalPaid,
      fullyPaid: totalPaid + 0.001 >= Number(contract.amount),
      source: 'crm',
      sourceId: String(row.id),
    });
    return {
      id: row.id,
      contractId: row.contractId,
      contractNumber: contract.number,
      customerName: '',
      paymentPlanId: row.paymentPlanId,
      planName: '',
      name: row.name,
      no: row.no,
      recordAmount: moneyStr(row.recordAmount),
      recordEndAt: iso(row.recordEndAt),
      attachmentKey: row.attachmentKey,
      createdAt: iso(row.createdAt),
    };
  }

  private async refreshPlanStatus(contractId: number, planId: number) {
    if (!planId) return;
    const plan = await this.prisma.crmPaymentPlan.findFirst({
      where: { id: planId },
    });
    if (!plan) return;
    const sum = await this.prisma.crmPaymentRecord.aggregate({
      where: { contractId, paymentPlanId: planId },
      _sum: { recordAmount: true },
    });
    const paid = Number(sum._sum.recordAmount || 0);
    const status =
      paid <= 0
        ? 'PENDING'
        : paid + 0.001 >= Number(plan.planAmount)
          ? 'DONE'
          : 'PARTIAL';
    await this.prisma.crmPaymentPlan.update({
      where: { id: planId },
      data: { status },
    });
  }

  async removeRecord(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'finance');
    const id = Number(rawId);
    const row = await this.prisma.crmPaymentRecord.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '回款记录不存在');
    await this.prisma.crmPaymentRecord.delete({ where: { id } });
    await this.refreshPlanStatus(row.contractId, row.paymentPlanId);
    const paid = await this.paidOf(row.contractId);
    await this.settings.log(
      ctx.ownerUserId,
      'PAYMENT',
      id,
      'DELETE',
      { amount: Number(row.recordAmount) },
      {},
      ctx.actorId,
    );
    this.emitEvent(ctx, 'crm.payment.removed', {
      paymentId: id,
      contractId: row.contractId,
      amount: Number(row.recordAmount),
      source: 'crm',
      sourceId: String(id),
    });
    return { removed: true, contractPaid: moneyStr(paid) };
  }

  // ---------------------------------------------------------------- 发票

  async invoices(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const base = await this.scope.scopeWhereAsync(ctx, 'FINANCE');
    const scopedContracts = await this.prisma.crmContract.findMany({
      where: { ...base, deletedAt: null },
      select: { id: true },
    });
    const scopedIds = scopedContracts.map((row) => row.id);
    const where: ContractScopedWhere = { ownerUserId: ctx.ownerUserId };
    if (query.contractId) where.contractId = Number(query.contractId);
    else where.contractId = { in: scopedIds };
    if (query.customerId) {
      const contracts = await this.prisma.crmContract.findMany({
        where: {
          ownerUserId: ctx.ownerUserId,
          customerId: Number(query.customerId),
        },
        select: { id: true },
      });
      where.contractId = {
        in: contracts
          .map((row) => row.id)
          .filter((id) => scopedIds.includes(id)),
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.crmInvoice.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmInvoice.count({ where }),
    ]);
    const contracts = await this.prisma.crmContract.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.contractId))] } },
      select: { id: true, number: true },
    });
    const contractNos = new Map(contracts.map((row) => [row.id, row.number]));
    const titles = await this.prisma.crmBusinessTitle.findMany({
      where: {
        id: { in: rows.map((row) => row.businessTitleId).filter(Boolean) },
      },
      select: { id: true, name: true },
    });
    const titleNames = new Map(titles.map((row) => [row.id, row.name]));
    return {
      list: rows.map((row) => ({
        id: row.id,
        contractId: row.contractId,
        contractNumber: contractNos.get(row.contractId) || '',
        businessTitleId: row.businessTitleId,
        businessTitleName: titleNames.get(row.businessTitleId) || '',
        name: row.name,
        amount: moneyStr(row.amount),
        invoiceType: row.invoiceType,
        invoiceTypeLabel:
          INVOICE_TYPE_LABELS[row.invoiceType] || row.invoiceType,
        taxRate: moneyStr(row.taxRate),
        approvalStatus: row.approvalStatus,
        approvalStatusLabel: statusLabel(row.approvalStatus),
        attachmentKey: row.attachmentKey,
        remark: row.remark,
        createdAt: iso(row.createdAt),
      })),
      total,
      page,
      pageSize,
    };
  }

  async saveInvoice(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'finance');
    const contractId = int(body.contractId);
    if (contractId) await this.findOne(ctx, String(contractId));
    const data = {
      contractId,
      businessTitleId: int(body.businessTitleId),
      name: text(body.name).slice(0, 160),
      amount: money(body.amount),
      invoiceType: text(body.invoiceType, 'SPECIAL'),
      taxRate: money(body.taxRate),
      attachmentKey: text(body.attachmentKey).slice(0, 255),
      remark: text(body.remark).slice(0, 500),
    };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmInvoice.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId, contractId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '发票不存在');
    }
    const row = id
      ? await this.prisma.crmInvoice.update({ where: { id }, data })
      : await this.prisma.crmInvoice.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return {
      id: row.id,
      contractId: row.contractId,
      contractNumber: '',
      businessTitleId: row.businessTitleId,
      businessTitleName: '',
      name: row.name,
      amount: moneyStr(row.amount),
      invoiceType: row.invoiceType,
      invoiceTypeLabel: INVOICE_TYPE_LABELS[row.invoiceType] || row.invoiceType,
      taxRate: moneyStr(row.taxRate),
      approvalStatus: row.approvalStatus,
      approvalStatusLabel: statusLabel(row.approvalStatus),
      attachmentKey: row.attachmentKey,
      remark: row.remark,
      createdAt: iso(row.createdAt),
    };
  }

  async removeInvoice(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'finance');
    const id = Number(rawId);
    const row = await this.prisma.crmInvoice.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '发票不存在');
    await this.prisma.crmInvoice.delete({ where: { id } });
    return { removed: true };
  }

  // ---------------------------------------------------------------- 工商抬头

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
    customerName = '',
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

  async titles(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const keyword = text(query.keyword).trim();
    const rows = await this.prisma.crmBusinessTitle.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        ...(query.customerId ? { customerId: Number(query.customerId) } : {}),
        ...(keyword
          ? {
              OR: [
                { name: { contains: keyword } },
                { taxNo: { contains: keyword } },
              ],
            }
          : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    const customers = await this.prisma.crmCustomer.findMany({
      where: { id: { in: rows.map((row) => row.customerId).filter(Boolean) } },
      select: { id: true, name: true },
    });
    const names = new Map(customers.map((row) => [row.id, row.name]));
    return rows.map((row) =>
      this.titleView(row, names.get(row.customerId) || ''),
    );
  }

  async saveTitle(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'finance');
    const name = text(body.name).trim().slice(0, 160);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写抬头名称');
    const customerId = int(body.customerId);
    if (customerId) {
      const customer = await this.prisma.crmCustomer.findFirst({
        where: { id: customerId, ownerUserId: ctx.ownerUserId },
      });
      if (!customer)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '客户不存在');
    }
    const isDefault = Boolean(body.isDefault);
    if (isDefault) {
      await this.prisma.crmBusinessTitle.updateMany({
        where: { ownerUserId: ctx.ownerUserId, customerId },
        data: { isDefault: false },
      });
    }
    const data = {
      customerId,
      name,
      taxNo: text(body.taxNo).slice(0, 40),
      bank: text(body.bank).slice(0, 120),
      account: text(body.account).slice(0, 60),
      address: text(body.address).slice(0, 200),
      phone: text(body.phone).slice(0, 40),
      capital: text(body.capital).slice(0, 60),
      scale: text(body.scale).slice(0, 60),
      province: text(body.province).slice(0, 40),
      city: text(body.city).slice(0, 40),
      industry: text(body.industry).slice(0, 60),
      isDefault,
      remark: text(body.remark).slice(0, 500),
    };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmBusinessTitle.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '工商抬头不存在');
    }
    const row = id
      ? await this.prisma.crmBusinessTitle.update({ where: { id }, data })
      : await this.prisma.crmBusinessTitle.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    return this.titleView(row);
  }

  async removeTitle(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'finance');
    const id = Number(rawId);
    const row = await this.prisma.crmBusinessTitle.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '工商抬头不存在');
    await this.prisma.crmBusinessTitle.delete({ where: { id } });
    return { removed: true };
  }
}
