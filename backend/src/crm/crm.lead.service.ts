import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CrmScopeService, CrmContext } from './crm.scope';
import {
  LEAD_STAGE_LABELS,
  asArray,
  dateOrNull,
  int,
  iso,
  jsonArray,
  jsonObject,
  money,
  moneyStr,
  normEmail,
  normName,
  normPhone,
  statusLabel,
} from './crm.helpers';
import { CrmSettingsService } from './crm.settings.service';

type LeadRow = {
  id: number;
  ownerUserId: string;
  name: string;
  contactName: string;
  phone: string;
  phoneNorm: string;
  email: string;
  emailNorm: string;
  source: string;
  stage: string;
  ownerId: string;
  poolId: number;
  inPool: boolean;
  products: unknown;
  transitionType: string;
  transitionId: number;
  lastFollowerId: string;
  lastFollowAt: Date | null;
  frozen: boolean;
  freezeReason: string;
  unfreezeAt: Date | null;
  approvalStatus: string;
  remark: string;
  custom: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export class CrmLeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
    private readonly settings: CrmSettingsService,
  ) {}

  private async viewRows(rows: LeadRow[], ctx: CrmContext) {
    const [names, pools] = await Promise.all([
      this.scope.names([
        ...rows.map((row) => row.ownerId),
        ...rows.map((row) => row.lastFollowerId),
      ]),
      rows.length
        ? this.prisma.crmLeadPool.findMany({
            where: {
              id: {
                in: [...new Set(rows.map((row) => row.poolId))].filter(
                  (id) => Number.isFinite(id) && id > 0,
                ),
              },
            },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const poolNames = new Map(pools.map((row) => [row.id, row.name]));
    const canPlain =
      ctx.isAdmin || ctx.role === 'MANAGER' || ctx.role === 'SALES';
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      contactName: row.contactName,
      phone: canPlain ? row.phone : '',
      maskedPhone: row.phone
        ? `${row.phone.slice(0, 3)}****${row.phone.slice(-4)}`
        : '',
      email: canPlain ? row.email : '',
      maskedEmail: row.email
        ? `${row.email.slice(0, 1)}***${row.email.slice(row.email.indexOf('@'))}`
        : '',
      source: row.source,
      stage: row.stage,
      stageLabel: LEAD_STAGE_LABELS[row.stage] || row.stage,
      ownerId: row.ownerId,
      ownerName: names.get(row.ownerId) || '',
      poolId: row.poolId,
      poolName: poolNames.get(row.poolId) || '',
      inPool: row.inPool,
      products: asArray(row.products),
      transitionType: row.transitionType,
      transitionId: row.transitionId,
      lastFollowerId: row.lastFollowerId,
      lastFollowerName: names.get(row.lastFollowerId) || '',
      lastFollowAt: iso(row.lastFollowAt),
      frozen: row.frozen,
      freezeReason: row.freezeReason,
      approvalStatus: row.approvalStatus,
      approvalStatusLabel: statusLabel(row.approvalStatus),
      custom: jsonObject(row.custom),
      remark: row.remark,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }));
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const base = await this.scope.scopeWhereAsync(ctx);
    const where: Record<string, unknown> = { ...base, deletedAt: null };
    const view = text(query.view, 'all');
    if (view === 'mine') where.ownerId = ctx.actorId;
    if (view === 'pool') {
      where.inPool = true;
      delete where.ownerId;
    }
    if (query.stage) where.stage = text(query.stage);
    if (query.poolId) where.poolId = Number(query.poolId);
    if (query.ownerId) where.ownerId = text(query.ownerId);
    const keyword = text(query.keyword).trim();
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { contactName: { contains: keyword } },
        { phone: { contains: keyword } },
        { email: { contains: keyword } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.crmLead.findMany({
        where: where as never,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmLead.count({ where: where as never }),
    ]);
    return { list: await this.viewRows(rows, ctx), total, page, pageSize };
  }

  async get(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    return (await this.viewRows([row], ctx))[0];
  }

  private async findOne(ctx: CrmContext, rawId: string) {
    const id = Number(rawId);
    const base = await this.scope.scopeWhereAsync(ctx);
    const row = await this.prisma.crmLead.findFirst({
      where: { ...base, id, deletedAt: null } as never,
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '线索不存在或无权查看');
    return row as LeadRow;
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const name = text(body.name).trim().slice(0, 120);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写线索名称');
    const poolId = int(body.poolId);
    const ownerId = text(body.ownerId) || (poolId ? '' : ctx.actorId);
    if (ownerId && !(await this.isMember(ctx, ownerId))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '负责人不是本账号 CRM 成员',
      );
    }
    const stage = text(body.stage, 'NEW');
    if (!LEAD_STAGE_LABELS[stage]) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '线索阶段不正确');
    }
    const row = await this.prisma.crmLead.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        name,
        contactName: text(body.contactName).slice(0, 60),
        phone: text(body.phone).slice(0, 40),
        phoneNorm: normPhone(body.phone),
        email: text(body.email).slice(0, 120),
        emailNorm: normEmail(body.email),
        source: text(body.source).slice(0, 60),
        stage,
        ownerId: poolId ? '' : ownerId,
        poolId,
        inPool: Boolean(poolId),
        products: asArray(body.products) as never,
        remark: text(body.remark).slice(0, 2000),
        custom: jsonObject(body.custom) as never,
      },
    });
    if (poolId) await this.requirePool(ctx, poolId);
    await this.settings.log(
      ctx.ownerUserId,
      'LEAD',
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
    const row = await this.prisma.crmMember.findFirst({
      where: {
        ownerUserId: ctx.ownerUserId,
        memberUserId: userId,
        status: 'ACTIVE',
      },
    });
    return Boolean(row);
  }

  async update(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const row = await this.findOne(ctx, rawId);
    const data: Record<string, unknown> = {};
    for (const key of ['name', 'contactName', 'source', 'remark'] as const) {
      if (body[key] !== undefined)
        data[key] = text(body[key]).slice(0, key === 'remark' ? 2000 : 120);
    }
    if (body.phone !== undefined) {
      data.phone = text(body.phone).slice(0, 40);
      data.phoneNorm = normPhone(body.phone);
    }
    if (body.email !== undefined) {
      data.email = text(body.email).slice(0, 120);
      data.emailNorm = normEmail(body.email);
    }
    if (body.stage !== undefined) {
      if (!LEAD_STAGE_LABELS[text(body.stage)]) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '线索阶段不正确');
      }
      data.stage = text(body.stage);
    }
    if (body.ownerId !== undefined) {
      const ownerId = text(body.ownerId);
      if (ownerId && !(await this.isMember(ctx, ownerId))) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '负责人不是本账号 CRM 成员',
        );
      }
      data.ownerId = ownerId;
    }
    if (body.products !== undefined) data.products = asArray(body.products);
    if (body.custom !== undefined) data.custom = jsonObject(body.custom);
    const updated = await this.prisma.crmLead.update({
      where: { id: row.id },
      data: data as never,
    });
    await this.settings.log(
      ctx.ownerUserId,
      'LEAD',
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
    return this.update(user, rawId, { stage: body.stage });
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'delete');
    const row = await this.findOne(ctx, rawId);
    await this.prisma.crmLead.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    await this.settings.log(
      ctx.ownerUserId,
      'LEAD',
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
    const reason = text(body.reason).slice(0, 200);
    const updated = await this.prisma.crmLead.update({
      where: { id: row.id },
      data: { ownerId, inPool: false, poolId: 0 },
    });
    await this.prisma.crmOwnerHistory.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'LEAD',
        targetId: row.id,
        fromOwner: row.ownerId,
        toOwner: ownerId,
        reason,
        operator: ctx.actorId,
      },
    });
    await this.settings.log(
      ctx.ownerUserId,
      'LEAD',
      row.id,
      'TRANSFER',
      { from: row.ownerId },
      { to: ownerId, reason },
      ctx.actorId,
    );
    return (await this.viewRows([updated], ctx))[0];
  }

  async batchTransfer(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'transfer');
    const ids = (Array.isArray(body.ids) ? body.ids : [])
      .map((item) => int(item))
      .filter(Boolean);
    const ownerId = text(body.ownerId);
    if (!ids.length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择线索');
    if (!(await this.isMember(ctx, ownerId))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '负责人不是本账号 CRM 成员',
      );
    }
    const base = await this.scope.scopeWhereAsync(ctx);
    const rows = await this.prisma.crmLead.findMany({
      where: { ...base, id: { in: ids }, deletedAt: null } as never,
    });
    for (const row of rows) {
      await this.prisma.crmLead.update({
        where: { id: row.id },
        data: { ownerId, inPool: false, poolId: 0 },
      });
      await this.prisma.crmOwnerHistory.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'LEAD',
          targetId: row.id,
          fromOwner: row.ownerId,
          toOwner: ownerId,
          reason: '批量转移',
          operator: ctx.actorId,
        },
      });
    }
    return { updated: rows.length };
  }

  async toPool(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'transfer');
    const row = await this.findOne(ctx, rawId);
    const pool = await this.requirePool(ctx, int(body.poolId));
    const updated = await this.prisma.crmLead.update({
      where: { id: row.id },
      data: { poolId: pool.id, inPool: true, ownerId: '' },
    });
    await this.prisma.crmOwnerHistory.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'LEAD',
        targetId: row.id,
        fromOwner: row.ownerId,
        toOwner: '',
        reason: text(body.reason, '移入线索池').slice(0, 200),
        operator: ctx.actorId,
      },
    });
    await this.settings.log(
      ctx.ownerUserId,
      'LEAD',
      row.id,
      'TO_POOL',
      { from: row.ownerId },
      { poolId: pool.id },
      ctx.actorId,
    );
    return (await this.viewRows([updated], ctx))[0];
  }

  async pick(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'pick');
    const row = await this.findOne(ctx, rawId);
    if (!row.inPool)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这条线索不在线索池');
    const pool = await this.requirePool(ctx, row.poolId);
    await this.assertPickable(ctx, pool, row);
    const claimed = await this.prisma.crmLead.updateMany({
      where: { id: row.id, ownerUserId: ctx.ownerUserId, inPool: true },
      data: { ownerId: ctx.actorId, inPool: false, poolId: 0 },
    });
    if (claimed.count !== 1) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这条线索已被他人领取',
      );
    }
    const updated = await this.prisma.crmLead.findUnique({
      where: { id: row.id },
    });
    if (!updated) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '线索不存在');
    }
    await this.prisma.crmOwnerHistory.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'LEAD',
        targetId: row.id,
        fromOwner: '',
        toOwner: ctx.actorId,
        reason: '领取',
        operator: ctx.actorId,
      },
    });
    return (await this.viewRows([updated], ctx))[0];
  }

  private async assertPickable(
    ctx: CrmContext,
    pool: { pickRule: unknown; id: number },
    row: LeadRow,
  ) {
    const rule = jsonObject(pool.pickRule);
    const pickNumber = int(rule.pickNumber);
    if (pickNumber > 0) {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const count = await this.prisma.crmOwnerHistory.count({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'LEAD',
          toOwner: ctx.actorId,
          reason: '领取',
          createdAt: { gte: since },
        },
      });
      if (count >= pickNumber) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `今天最多领取 ${pickNumber} 条线索`,
        );
      }
    }
    const interval = int(rule.newPickInterval);
    if (interval > 0) {
      const deadline = new Date(Date.now() - interval * 24 * 3600 * 1000);
      if (row.createdAt > deadline) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `新线索入库 ${interval} 天内不能领取`,
        );
      }
    }
    const preOwnerDays = int(rule.limitPreOwner);
    if (preOwnerDays > 0) {
      const last = await this.prisma.crmOwnerHistory.findFirst({
        where: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'LEAD',
          targetId: row.id,
          fromOwner: ctx.actorId,
        },
        orderBy: { id: 'desc' },
      });
      if (
        last &&
        Date.now() - last.createdAt.getTime() < preOwnerDays * 24 * 3600 * 1000
      ) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `原负责人 ${preOwnerDays} 天内不能再领取同一条线索`,
        );
      }
    }
    const capacity = await this.capacityOf(ctx, 'LEAD');
    if (capacity > 0) {
      const used = await this.prisma.crmLead.count({
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
          `我的线索库容已满（${capacity}）`,
        );
      }
    }
  }

  private async capacityOf(ctx: CrmContext, targetType: 'LEAD' | 'CUSTOMER') {
    const rows = await this.prisma.crmCapacity.findMany({
      where: { ownerUserId: ctx.ownerUserId, targetType },
    });
    const member = rows.find(
      (row) => row.scopeType === 'MEMBER' && row.scopeId === ctx.actorId,
    );
    if (member) return member.capacity;
    const dept = rows.find(
      (row) => row.scopeType === 'DEPT' && row.scopeId === ctx.department,
    );
    if (dept) return dept.capacity;
    const org = rows.find((row) => row.scopeType === 'ORG');
    return org?.capacity || 0;
  }

  async assign(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'transfer');
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
    const updated = await this.prisma.crmLead.update({
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
    const updated = await this.prisma.crmLead.update({
      where: { id: row.id },
      data: { frozen: false, freezeReason: '', unfreezeAt: null },
    });
    return (await this.viewRows([updated], ctx))[0];
  }

  async ownerHistory(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const row = await this.findOne(ctx, rawId);
    const rows = await this.prisma.crmOwnerHistory.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'LEAD',
        targetId: row.id,
      },
      orderBy: { id: 'desc' },
    });
    const names = await this.scope.names([
      ...rows.map((item) => item.fromOwner),
      ...rows.map((item) => item.toOwner),
    ]);
    return rows.map((item) => ({
      id: item.id,
      fromOwner: item.fromOwner,
      fromOwnerName: names.get(item.fromOwner) || '',
      toOwner: item.toOwner,
      toOwnerName: names.get(item.toOwner) || '',
      reason: item.reason,
      createdAt: iso(item.createdAt),
    }));
  }

  async convert(
    user: CurrentUser,
    rawId: string,
    body: Record<string, unknown>,
  ) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'write');
    const lead = await this.findOne(ctx, rawId);
    if (lead.transitionType) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这条线索已经转化过');
    }
    const requestedCustomerId = int(body.customerId);
    let customer = requestedCustomerId
      ? await this.prisma.crmCustomer.findFirst({
          where: {
            id: requestedCustomerId,
            ownerUserId: ctx.ownerUserId,
            deletedAt: null,
          },
        })
      : null;
    let linkedExisting = Boolean(customer);
    if (!customer && lead.phoneNorm) {
      const contact = await this.prisma.crmContact.findFirst({
        where: {
          ownerUserId: ctx.ownerUserId,
          phoneNorm: lead.phoneNorm,
          enabled: true,
        },
      });
      if (contact) {
        customer = await this.prisma.crmCustomer.findFirst({
          where: {
            id: contact.customerId,
            ownerUserId: ctx.ownerUserId,
            deletedAt: null,
          },
        });
        linkedExisting = Boolean(customer);
      }
    }
    if (!customer && lead.name) {
      customer = await this.prisma.crmCustomer.findFirst({
        where: {
          ownerUserId: ctx.ownerUserId,
          nameNorm: normName(lead.name),
          deletedAt: null,
        },
      });
      linkedExisting = Boolean(customer);
    }
    const ownerId = lead.ownerId || ctx.actorId;
    if (!customer) {
      customer = await this.prisma.crmCustomer.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          name: lead.name,
          nameNorm: normName(lead.name),
          ownerId,
          collectionAt: new Date(),
          lastFollowerId: lead.lastFollowerId,
          lastFollowAt: lead.lastFollowAt,
          remark: lead.remark,
          custom: lead.custom as never,
        },
      });
      await this.prisma.crmContact.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          customerId: customer.id,
          name: lead.contactName || lead.name,
          phone: lead.phone,
          phoneNorm: lead.phoneNorm,
          email: lead.email,
          emailNorm: lead.emailNorm,
          ownerId,
        },
      });
    } else if (ownerId && ownerId !== customer.ownerId) {
      await this.prisma.crmCustomerCollaboration.upsert({
        where: {
          customerId_userId: { customerId: customer.id, userId: ownerId },
        },
        create: {
          ownerUserId: ctx.ownerUserId,
          customerId: customer.id,
          userId: ownerId,
          type: 'COLLABORATION',
        },
        update: {},
      });
    }
    let opportunity: {
      id: number;
      customerId: number;
      name: string;
      amount: unknown;
      possible: unknown;
      stageId: number;
      ownerId: string;
      approvalStatus: string;
      createdAt: Date;
    } | null = null;
    if (body.createOpportunity !== false) {
      const stage = await this.prisma.crmOpportunityStage.findFirst({
        where: { ownerUserId: ctx.ownerUserId },
        orderBy: { sort: 'asc' },
      });
      opportunity = await this.prisma.crmOpportunity.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          customerId: customer.id,
          name: text(body.opportunityName) || `${lead.name}商机`,
          amount: money(body.amount),
          possible: money(body.amount),
          stageId: stage?.id || 0,
          ownerId,
          lastFollowerId: lead.lastFollowerId,
          lastFollowAt: lead.lastFollowAt,
          custom: lead.custom as never,
        },
      });
    }
    const follows = await this.prisma.crmFollowRecord.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'LEAD',
        targetId: lead.id,
      },
    });
    for (const record of follows) {
      await this.prisma.crmFollowRecord.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'CUSTOMER',
          targetId: customer.id,
          type: record.type,
          content: record.content,
          result: record.result,
          attachments: record.attachments as never,
          nextAt: record.nextAt,
          createdBy: record.createdBy,
        },
      });
    }
    const plans = await this.prisma.crmFollowPlan.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        targetType: 'LEAD',
        targetId: lead.id,
      },
    });
    for (const plan of plans) {
      await this.prisma.crmFollowPlan.create({
        data: {
          ownerUserId: ctx.ownerUserId,
          targetType: 'CUSTOMER',
          targetId: customer.id,
          planAt: plan.planAt,
          status: plan.status,
          ownerId: plan.ownerId,
          content: plan.content,
          reminderAt: plan.reminderAt,
        },
      });
    }
    const updated = await this.prisma.crmLead.update({
      where: { id: lead.id },
      data: {
        stage: 'SUCCESS',
        transitionType: 'CUSTOMER',
        transitionId: customer.id,
        inPool: false,
        poolId: 0,
      },
    });
    await this.settings.log(
      ctx.ownerUserId,
      'LEAD',
      lead.id,
      'CONVERT',
      { name: lead.name },
      {
        customerId: customer.id,
        opportunityId: opportunity?.id || 0,
        linkedExisting,
      },
      ctx.actorId,
    );
    return {
      lead: (await this.viewRows([updated], ctx))[0],
      customer: await this.customerView(customer, ctx),
      opportunity: opportunity
        ? {
            id: opportunity.id,
            customerId: opportunity.customerId,
            customerName: customer.name,
            name: opportunity.name,
            amount: moneyStr(opportunity.amount),
            possible: moneyStr(opportunity.possible),
            stageId: opportunity.stageId,
            stageName: '',
            stageType: '',
            ownerId: opportunity.ownerId,
            ownerName: '',
            contactId: 0,
            contactName: '',
            expectedEndAt: '',
            actualEndAt: '',
            failureReason: '',
            lastFollowAt: '',
            approvalStatus: opportunity.approvalStatus,
            approvalStatusLabel: statusLabel(opportunity.approvalStatus),
            custom: {},
            createdAt: iso(opportunity.createdAt),
          }
        : null,
      linkedExisting,
    };
  }

  private async customerView(
    row: {
      id: number;
      name: string;
      ownerId: string;
      poolId: number;
      inPool: boolean;
      collectionAt: Date | null;
      lastFollowAt: Date | null;
      frozen: boolean;
      freezeReason: string;
      approvalStatus: string;
      industry: string;
      province: string;
      city: string;
      remark: string;
      createdAt: Date;
    },
    ctx: CrmContext,
  ) {
    const names = await this.scope.names([row.ownerId]);
    return {
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      ownerName: names.get(row.ownerId) || '',
      poolId: row.poolId,
      poolName: '',
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
      contactCount: 0,
      opportunityCount: 0,
      contractAmount: '0.00',
      custom: {},
      remark: row.remark,
      createdAt: iso(row.createdAt),
      canEdit: ctx.isMember,
    };
  }

  // ---------------------------------------------------------------- 线索池

  private async requirePool(ctx: CrmContext, poolId: number) {
    const pool = await this.prisma.crmLeadPool.findFirst({
      where: { id: poolId, ownerUserId: ctx.ownerUserId, enabled: true },
    });
    if (!pool)
      throw new BusinessException(ErrorCode.NOT_FOUND, '线索池不存在或已停用');
    return pool;
  }

  async pools(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmLeadPool.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { id: 'asc' },
    });
    const counts = await this.prisma.crmLead.groupBy({
      by: ['poolId'],
      where: { ownerUserId: ctx.ownerUserId, inPool: true, deletedAt: null },
      _count: { _all: true },
    });
    const countMap = new Map(
      counts.map((row) => [row.poolId, row._count._all]),
    );
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
      recycleRule: jsonArray(row.recycleRule),
      leadCount: countMap.get(row.id) || 0,
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
      scopeIds: asArray(body.scopeIds) as never,
      pickRule: jsonObject(body.pickRule) as never,
      recycleRule: jsonArray(body.recycleRule) as never,
    };
    if (!data.name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写线索池名称');
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmLeadPool.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '线索池不存在');
    }
    const row = id
      ? await this.prisma.crmLeadPool.update({ where: { id }, data })
      : await this.prisma.crmLeadPool.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '线索池不存在');
    }
    const names = await this.scope.names([row.adminId]);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      adminId: row.adminId,
      adminName: names.get(row.adminId) || '',
      auto: row.auto,
      enabled: row.enabled,
      scopeIds: asArray(row.scopeIds),
      pickRule: jsonObject(row.pickRule),
      recycleRule: jsonArray(row.recycleRule),
      leadCount: 0,
      createdAt: iso(row.createdAt),
    };
  }

  async removePool(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmLeadPool.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '线索池不存在');
    const inUse = await this.prisma.crmLead.count({
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
        `线索池里还有 ${inUse} 条线索，不能删除`,
      );
    }
    await this.prisma.crmLeadPool.delete({ where: { id } });
    return { removed: true };
  }

  async capacities(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const targetType = text(query.targetType, 'LEAD');
    const rows = await this.prisma.crmCapacity.findMany({
      where: { ownerUserId: ctx.ownerUserId, targetType },
    });
    const memberIds = rows
      .filter((row) => row.scopeType === 'MEMBER')
      .map((row) => row.scopeId);
    const names = await this.scope.names(memberIds);
    const usedMap = new Map<string, number>();
    if (targetType === 'LEAD') {
      const groups = await this.prisma.crmLead.groupBy({
        by: ['ownerId'],
        where: {
          ownerUserId: ctx.ownerUserId,
          ownerId: { in: memberIds },
          inPool: false,
          deletedAt: null,
        },
        _count: { _all: true },
      });
      for (const group of groups) usedMap.set(group.ownerId, group._count._all);
    }
    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      scopeName:
        row.scopeType === 'ORG'
          ? '全账号'
          : row.scopeType === 'DEPT'
            ? row.scopeId
            : names.get(row.scopeId) || row.scopeId,
      capacity: row.capacity,
      used: usedMap.get(row.scopeId) || 0,
    }));
  }

  async saveCapacity(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const targetType = text(body.targetType, 'LEAD');
    const scopeType = text(body.scopeType, 'ORG');
    const scopeId = scopeType === 'ORG' ? '' : text(body.scopeId);
    const capacity = int(body.capacity);
    await this.prisma.crmCapacity.upsert({
      where: {
        ownerUserId_targetType_scopeType_scopeId: {
          ownerUserId: ctx.ownerUserId,
          targetType,
          scopeType,
          scopeId,
        },
      },
      create: {
        ownerUserId: ctx.ownerUserId,
        targetType,
        scopeType,
        scopeId,
        capacity,
      },
      update: { capacity },
    });
    return { saved: true };
  }

  /** 回收：把满足条件的池内线索清空负责人并回到池里（供调度器与手动回收复用）。 */
  async recycle(
    ownerUserId: string,
    poolId: number,
    ids: number[],
    actor = 'scheduler',
  ) {
    for (const id of ids) {
      const row = await this.prisma.crmLead.findFirst({
        where: { id, ownerUserId, deletedAt: null },
      });
      if (!row) continue;
      await this.prisma.crmLead.update({
        where: { id },
        data: { poolId, inPool: true, ownerId: '' },
      });
      await this.prisma.crmOwnerHistory.create({
        data: {
          ownerUserId,
          targetType: 'LEAD',
          targetId: id,
          fromOwner: row.ownerId,
          toOwner: '',
          reason: '自动回收',
          operator: actor,
        },
      });
    }
    return ids.length;
  }
}
