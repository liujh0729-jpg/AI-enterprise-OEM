import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { CrmScopeService, CrmContext } from './crm.scope';
import { CrmSettingsService } from './crm.settings.service';
import { DataTableService } from '../data-table/data-table.service';
import {
  LEAD_STAGE_LABELS,
  ROLE_LABELS,
  asArray,
  int,
  iso,
  jsonObject,
  moneyStr,
  normEmail,
  normName,
  normPhone,
  statusLabel,
} from './crm.helpers';

const RANGE_DAYS: Record<string, number> = {
  today: 1,
  week: 7,
  month: 30,
  year: 365,
};

export class CrmReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
    private readonly settings: CrmSettingsService,
    private readonly dataTables: DataTableService,
  ) {}

  async workbench(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.context(user);
    if (!ctx.isMember) {
      return {
        isMember: false,
        role: '',
        roleLabel: '',
        stats: [],
        todo: { follow: 0, approval: 0, receivable: 0, overdue: 0 },
        quickAccess: [],
      };
    }
    const range = text(query.range, 'month');
    const days = RANGE_DAYS[range] || 30;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const base = await this.scope.scopeWhereAsync(ctx);
    const finance = await this.scope.scopeWhereAsync(ctx, 'FINANCE');
    const [leads, customers, opportunities, contracts, won, paid] =
      await Promise.all([
        this.prisma.crmLead.count({
          where: {
            ...base,
            deletedAt: null,
            createdAt: { gte: since },
          },
        }),
        this.prisma.crmCustomer.count({
          where: {
            ...base,
            deletedAt: null,
            createdAt: { gte: since },
          },
        }),
        this.prisma.crmOpportunity.count({
          where: {
            ...base,
            deletedAt: null,
            createdAt: { gte: since },
          },
        }),
        this.prisma.crmContract.count({
          where: {
            ...finance,
            deletedAt: null,
            createdAt: { gte: since },
          },
        }),
        this.prisma.crmOpportunity.findMany({
          where: {
            ...base,
            deletedAt: null,
            actualEndAt: { gte: since, not: null },
            failureReason: '',
          },
          select: { amount: true },
        }),
        this.prisma.crmPaymentRecord.aggregate({
          where: {
            ownerUserId: ctx.ownerUserId,
            contractId: {
              in: (
                await this.prisma.crmContract.findMany({
                  where: { ...finance, deletedAt: null },
                  select: { id: true },
                })
              ).map((row) => row.id),
            },
            createdAt: { gte: since },
          },
          _sum: { recordAmount: true },
        }),
      ]);
    const wonAmount = won.reduce((sum, row) => sum + Number(row.amount), 0);
    const now = new Date();
    const inDay = new Date(Date.now() + 24 * 3600 * 1000);
    const [follow, approval, receivable, overdue] = await Promise.all([
      this.prisma.crmFollowPlan.count({
        where: {
          ownerUserId: ctx.ownerUserId,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
          planAt: { lte: inDay },
        },
      }),
      this.prisma.crmApprovalTask.count({
        where: {
          ownerUserId: ctx.ownerUserId,
          approverId: ctx.actorId,
          status: 'PENDING',
        },
      }),
      this.prisma.crmPaymentPlan.count({
        where: {
          ownerUserId: ctx.ownerUserId,
          status: { not: 'DONE' },
          contractId: {
            in: (
              await this.prisma.crmContract.findMany({
                where: { ...finance, deletedAt: null },
                select: { id: true },
              })
            ).map((row) => row.id),
          },
        },
      }),
      this.prisma.crmPaymentPlan.count({
        where: {
          ownerUserId: ctx.ownerUserId,
          status: { not: 'DONE' },
          planEndAt: { lt: now },
          contractId: {
            in: (
              await this.prisma.crmContract.findMany({
                where: { ...finance, deletedAt: null },
                select: { id: true },
              })
            ).map((row) => row.id),
          },
        },
      }),
    ]);
    const label =
      { today: '今日', week: '本周', month: '本月', year: '本年' }[range] ||
      '本月';
    return {
      isMember: true,
      role: ctx.role,
      roleLabel: ROLE_LABELS[ctx.role] || ctx.role,
      stats: [
        {
          key: 'leads',
          label: `${label}新增线索`,
          value: String(leads),
          hint: '',
        },
        {
          key: 'customers',
          label: `${label}新增客户`,
          value: String(customers),
          hint: '',
        },
        {
          key: 'opportunities',
          label: `${label}新增商机`,
          value: String(opportunities),
          hint: '',
        },
        {
          key: 'contracts',
          label: `${label}新增合同`,
          value: String(contracts),
          hint: '',
        },
        {
          key: 'won',
          label: `${label}赢单`,
          value: String(won.length),
          hint: `金额 ${moneyStr(wonAmount)}`,
        },
        {
          key: 'paid',
          label: `${label}回款`,
          value: moneyStr(paid._sum.recordAmount || 0),
          hint: '',
        },
      ],
      todo: { follow, approval, receivable, overdue },
      quickAccess: [
        { key: 'lead', label: '新建线索', path: '/crm?tab=leads&action=new' },
        {
          key: 'customer',
          label: '新建客户',
          path: '/crm?tab=customers&action=new',
        },
        {
          key: 'opportunity',
          label: '新建商机',
          path: '/crm?tab=opportunities&action=new',
        },
        {
          key: 'contract',
          label: '新建合同',
          path: '/crm?tab=contracts&action=new',
        },
        { key: 'approval', label: '待我审批', path: '/crm?tab=approvals' },
      ],
    };
  }

  async saveQuickAccess(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const row = await this.prisma.crmSetting.findUnique({
      where: { ownerUserId: ctx.ownerUserId },
    });
    const titleFields = jsonObject(row?.titleFields);
    await this.prisma.crmSetting.upsert({
      where: { ownerUserId: ctx.ownerUserId },
      create: {
        ownerUserId: ctx.ownerUserId,
        titleFields: toJsonInput({
          ...titleFields,
          quickAccess: asArray(body.items),
        }),
      },
      update: {
        titleFields: toJsonInput({
          ...titleFields,
          quickAccess: asArray(body.items),
        }),
      },
    });
    return { saved: true };
  }

  async search(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const keyword = text(query.keyword).trim();
    if (!keyword) return { groups: [] };
    const base = await this.scope.scopeWhereAsync(ctx);
    const [leads, customers, opportunities] = await Promise.all([
      this.prisma.crmLead.findMany({
        where: {
          ...base,
          deletedAt: null,
          OR: [
            { name: { contains: keyword } },
            { contactName: { contains: keyword } },
            { phone: { contains: keyword } },
          ],
        },
        take: 10,
      }),
      this.prisma.crmCustomer.findMany({
        where: {
          ...base,
          deletedAt: null,
          name: { contains: keyword },
        },
        take: 10,
      }),
      this.prisma.crmOpportunity.findMany({
        where: {
          ...base,
          deletedAt: null,
          name: { contains: keyword },
        },
        take: 10,
      }),
    ]);
    return {
      groups: [
        {
          module: 'leads',
          label: '线索',
          rows: leads.map((row) => ({
            id: row.id,
            title: row.name,
            detail: `${row.contactName || ''} ${row.phone || ''}`.trim(),
            status: LEAD_STAGE_LABELS[row.stage] || row.stage,
          })),
        },
        {
          module: 'customers',
          label: '客户',
          rows: customers.map((row) => ({
            id: row.id,
            title: row.name,
            detail: [row.industry, row.province, row.city]
              .filter(Boolean)
              .join(' · '),
            status: '',
          })),
        },
        {
          module: 'opportunities',
          label: '商机',
          rows: opportunities.map((row) => ({
            id: row.id,
            title: row.name,
            detail: `金额 ${moneyStr(row.amount)}`,
            status: statusLabel(row.approvalStatus),
          })),
        },
      ].filter((group) => group.rows.length),
    };
  }

  async duplicates(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const name = text(query.name).trim();
    const phone = normPhone(query.phone);
    const email = normEmail(query.email);
    if (!name && !phone && !email) return { candidates: [] };
    const customers = await this.prisma.crmCustomer.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        deletedAt: null,
        ...(name ? { nameNorm: { contains: normName(name) } } : {}),
      },
      take: 10,
    });
    const contacts =
      phone || email
        ? await this.prisma.crmContact.findMany({
            where: {
              ownerUserId: ctx.ownerUserId,
              ...(phone ? { phoneNorm: phone } : {}),
              ...(email ? { emailNorm: email } : {}),
            },
            take: 10,
          })
        : [];
    const customerIds = [...new Set(contacts.map((row) => row.customerId))];
    const contactCustomers = customerIds.length
      ? await this.prisma.crmCustomer.findMany({
          where: { id: { in: customerIds }, ownerUserId: ctx.ownerUserId },
        })
      : [];
    const leads = await this.prisma.crmLead.findMany({
      where: {
        ownerUserId: ctx.ownerUserId,
        deletedAt: null,
        OR: [
          ...(name ? [{ name: { contains: name } }] : []),
          ...(phone ? [{ phoneNorm: phone }] : []),
          ...(email ? [{ emailNorm: email }] : []),
        ],
      },
      take: 10,
    });
    const candidates: Array<Record<string, unknown>> = [];
    for (const row of [...customers, ...contactCustomers]) {
      const exact = Boolean(
        (phone &&
          contacts.some(
            (item) => item.customerId === row.id && item.phoneNorm === phone,
          )) ||
        (email &&
          contacts.some(
            (item) => item.customerId === row.id && item.emailNorm === email,
          )),
      );
      candidates.push({
        module: 'customers',
        label: '客户',
        id: row.id,
        title: row.name,
        detail: exact ? '手机号/邮箱完全一致' : '名称相似',
        exact,
      });
    }
    for (const row of leads) {
      candidates.push({
        module: 'leads',
        label: '线索',
        id: row.id,
        title: row.name,
        detail:
          (phone && row.phoneNorm === phone) ||
          (email && row.emailNorm === email)
            ? '手机号/邮箱完全一致'
            : '名称相似',
        exact: Boolean(
          (phone && row.phoneNorm === phone) ||
          (email && row.emailNorm === email),
        ),
      });
    }
    return { candidates: candidates.slice(0, 20) };
  }

  async statsOverview(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const days = RANGE_DAYS[text(query.range, 'month')] || 30;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const base = await this.scope.scopeWhereAsync(ctx);
    const finance = await this.scope.scopeWhereAsync(ctx, 'FINANCE');
    const [leadStages, won, lost, contractSum, paymentSum] = await Promise.all([
      this.prisma.crmLead.groupBy({
        by: ['stage'],
        where: { ...base, deletedAt: null, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.crmOpportunity.count({
        where: {
          ...base,
          deletedAt: null,
          actualEndAt: { gte: since, not: null },
          failureReason: '',
        },
      }),
      this.prisma.crmOpportunity.count({
        where: {
          ...base,
          deletedAt: null,
          actualEndAt: { gte: since, not: null },
          failureReason: { not: '' },
        },
      }),
      this.prisma.crmContract.aggregate({
        where: {
          ...finance,
          deletedAt: null,
          createdAt: { gte: since },
        },
        _sum: { amount: true },
      }),
      this.prisma.crmPaymentRecord.aggregate({
        where: { ownerUserId: ctx.ownerUserId, createdAt: { gte: since } },
        _sum: { recordAmount: true },
      }),
    ]);
    return {
      range: text(query.range, 'month'),
      leads: leadStages.map((row) => ({
        stage: row.stage,
        label: LEAD_STAGE_LABELS[row.stage] || row.stage,
        count: row._count._all,
      })),
      won,
      lost,
      contractAmount: moneyStr(contractSum._sum.amount || 0),
      paymentAmount: moneyStr(paymentSum._sum.recordAmount || 0),
    };
  }

  async statsFunnel(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const stages = await this.prisma.crmOpportunityStage.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: { sort: 'asc' },
    });
    const base = await this.scope.scopeWhereAsync(ctx);
    const groups = await this.prisma.crmOpportunity.groupBy({
      by: ['stageId'],
      where: { ...base, deletedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const byId = new Map(groups.map((row) => [row.stageId, row]));
    return {
      stages: stages.map((row) => ({
        name: row.name,
        count: byId.get(row.id)?._count._all || 0,
        amount: moneyStr(byId.get(row.id)?._sum.amount || 0),
      })),
    };
  }

  async statsReceivables(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const finance = await this.scope.scopeWhereAsync(ctx, 'FINANCE');
    const contracts = await this.prisma.crmContract.findMany({
      where: { ...finance, deletedAt: null },
      select: {
        id: true,
        number: true,
        name: true,
        amount: true,
        customerId: true,
      },
    });
    const ids = contracts.map((row) => row.id);
    const [plans, records] = await Promise.all([
      this.prisma.crmPaymentPlan.findMany({
        where: { ownerUserId: ctx.ownerUserId, contractId: { in: ids } },
      }),
      this.prisma.crmPaymentRecord.findMany({
        where: { ownerUserId: ctx.ownerUserId, contractId: { in: ids } },
      }),
    ]);
    const paidByContract = new Map<number, number>();
    for (const row of records) {
      paidByContract.set(
        row.contractId,
        (paidByContract.get(row.contractId) || 0) + Number(row.recordAmount),
      );
    }
    const total = contracts.reduce((sum, row) => sum + Number(row.amount), 0);
    const paid = records.reduce(
      (sum, row) => sum + Number(row.recordAmount),
      0,
    );
    const overdue = plans
      .filter(
        (row) =>
          row.status !== 'DONE' &&
          row.planEndAt &&
          row.planEndAt.getTime() < Date.now(),
      )
      .reduce((sum, row) => sum + Number(row.planAmount), 0);
    return {
      total: moneyStr(total),
      paid: moneyStr(paid),
      overdue: moneyStr(overdue),
      rows: contracts.slice(0, 100).map((row) => ({
        id: row.id,
        number: row.number,
        name: row.name,
        amount: moneyStr(row.amount),
        paid: moneyStr(paidByContract.get(row.id) || 0),
        remaining: moneyStr(
          Number(row.amount) - (paidByContract.get(row.id) || 0),
        ),
      })),
    };
  }

  // ---------------------------------------------------------------- 导出

  private async exportRows(
    ctx: CrmContext,
    module: string,
    filters: Record<string, unknown>,
  ) {
    const base = await this.scope.scopeWhereAsync(ctx);
    if (module === 'leads') {
      const rows = await this.prisma.crmLead.findMany({
        where: {
          ...base,
          deletedAt: null,
          ...(filters.stage ? { stage: text(filters.stage) } : {}),
        },
        take: 10000,
      });
      return {
        columns: [
          { key: 'name', label: '线索名称' },
          { key: 'contactName', label: '联系人' },
          { key: 'phone', label: '电话' },
          { key: 'email', label: '邮箱' },
          { key: 'source', label: '来源' },
          { key: 'stageLabel', label: '阶段' },
          { key: 'ownerId', label: '负责人' },
          { key: 'createdAt', label: '创建时间' },
        ],
        rows: rows.map((row) => ({
          name: row.name,
          contactName: row.contactName,
          phone: row.phone,
          email: row.email,
          source: row.source,
          stageLabel: LEAD_STAGE_LABELS[row.stage] || row.stage,
          ownerId: row.ownerId,
          createdAt: iso(row.createdAt),
        })),
      };
    }
    if (module === 'customers') {
      const rows = await this.prisma.crmCustomer.findMany({
        where: { ...base, deletedAt: null },
        take: 10000,
      });
      return {
        columns: [
          { key: 'name', label: '客户名称' },
          { key: 'industry', label: '行业' },
          { key: 'province', label: '省' },
          { key: 'city', label: '市' },
          { key: 'ownerId', label: '负责人' },
          { key: 'createdAt', label: '创建时间' },
        ],
        rows: rows.map((row) => ({
          name: row.name,
          industry: row.industry,
          province: row.province,
          city: row.city,
          ownerId: row.ownerId,
          createdAt: iso(row.createdAt),
        })),
      };
    }
    if (module === 'opportunities') {
      const rows = await this.prisma.crmOpportunity.findMany({
        where: { ...base, deletedAt: null },
        take: 10000,
      });
      return {
        columns: [
          { key: 'name', label: '商机名称' },
          { key: 'amount', label: '金额' },
          { key: 'possible', label: '可能金额' },
          { key: 'stageId', label: '阶段' },
          { key: 'ownerId', label: '负责人' },
          { key: 'expectedEndAt', label: '预计成交' },
        ],
        rows: rows.map((row) => ({
          name: row.name,
          amount: moneyStr(row.amount),
          possible: moneyStr(row.possible),
          stageId: row.stageId,
          ownerId: row.ownerId,
          expectedEndAt: iso(row.expectedEndAt),
        })),
      };
    }
    if (module === 'contracts') {
      const rows = await this.prisma.crmContract.findMany({
        where: { ...base, deletedAt: null },
        take: 10000,
      });
      return {
        columns: [
          { key: 'number', label: '合同编号' },
          { key: 'name', label: '合同名称' },
          { key: 'amount', label: '金额' },
          { key: 'approvalStatus', label: '审批状态' },
          { key: 'ownerId', label: '负责人' },
          { key: 'createdAt', label: '创建时间' },
        ],
        rows: rows.map((row) => ({
          number: row.number,
          name: row.name,
          amount: moneyStr(row.amount),
          approvalStatus: statusLabel(row.approvalStatus),
          ownerId: row.ownerId,
          createdAt: iso(row.createdAt),
        })),
      };
    }
    if (module === 'payment-plans') {
      const rows = await this.prisma.crmPaymentPlan.findMany({
        where: { ownerUserId: ctx.ownerUserId },
        take: 10000,
      });
      return {
        columns: [
          { key: 'contractId', label: '合同' },
          { key: 'name', label: '计划名称' },
          { key: 'planAmount', label: '计划金额' },
          { key: 'status', label: '状态' },
          { key: 'planEndAt', label: '计划日期' },
        ],
        rows: rows.map((row) => ({
          contractId: row.contractId,
          name: row.name,
          planAmount: moneyStr(row.planAmount),
          status: row.status,
          planEndAt: iso(row.planEndAt),
        })),
      };
    }
    const rows = await this.prisma.crmOrder.findMany({
      where: { ...base, deletedAt: null },
      take: 10000,
    });
    return {
      columns: [
        { key: 'number', label: '订单编号' },
        { key: 'name', label: '订单名称' },
        { key: 'amount', label: '金额' },
        { key: 'approvalStatus', label: '审批状态' },
        { key: 'ownerId', label: '负责人' },
      ],
      rows: rows.map((row) => ({
        number: row.number,
        name: row.name,
        amount: moneyStr(row.amount),
        approvalStatus: statusLabel(row.approvalStatus),
        ownerId: row.ownerId,
      })),
    };
  }

  async createExport(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'export');
    const module = text(body.module, 'leads');
    const { columns, rows } = await this.exportRows(
      ctx,
      module,
      (body.filters || {}) as Record<string, unknown>,
    );
    const task = await this.prisma.crmExportTask.create({
      data: {
        ownerUserId: ctx.ownerUserId,
        createdBy: ctx.actorId,
        module,
        query: toJsonInput({ columns }),
        status: 'DONE',
        fileName: `crm-${module}-${Date.now()}.csv`,
        rowCount: rows.length,
        rows: toJsonInput(rows),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    return {
      id: task.id,
      module: task.module,
      status: task.status,
      fileName: task.fileName,
      rowCount: task.rowCount,
      createdAt: iso(task.createdAt),
      expiresAt: iso(task.expiresAt),
    };
  }

  async exportTasks(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    // 导出文件同样受数据范围约束：非组织级范围只看得到自己创建的导出。
    const scope = await this.scope.scopeWhereAsync(ctx, 'CORE', 'createdBy');
    const where: Prisma.CrmExportTaskWhereInput = {
      ownerUserId: scope.ownerUserId,
      expiresAt: { gt: new Date() },
    };
    if (scope.createdBy !== undefined) where.createdBy = scope.createdBy;
    const rows = await this.prisma.crmExportTask.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      module: row.module,
      status: row.status,
      fileName: row.fileName,
      rowCount: row.rowCount,
      createdAt: iso(row.createdAt),
      expiresAt: iso(row.expiresAt),
    }));
  }

  async download(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    const id = Number(rawId);
    // 下载要按调用者数据范围复核：授权范围不含创建人时按「不存在」处理，不泄露存在性。
    const scope = await this.scope.scopeWhereAsync(ctx, 'CORE', 'createdBy');
    const where: Prisma.CrmExportTaskWhereInput = {
      id,
      ownerUserId: scope.ownerUserId,
    };
    if (scope.createdBy !== undefined) where.createdBy = scope.createdBy;
    const task = await this.prisma.crmExportTask.findFirst({ where });
    if (!task)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '导出文件不存在或已过期',
      );
    const query = (task.query || {}) as Record<string, unknown>;
    const columns = Array.isArray(query.columns)
      ? (query.columns as Array<{ key: string; label: string }>)
      : [];
    const rows = Array.isArray(task.rows)
      ? (task.rows as Array<Record<string, unknown>>)
      : [];
    return { fileName: task.fileName, columns, rows };
  }

  async precheck(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const module = text(body.module, 'leads');
    const rows = Array.isArray(body.rows)
      ? (body.rows as Array<Record<string, unknown>>)
      : [];
    if (!rows.length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请粘贴或上传数据');
    if (rows.length > 500) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '单批最多 500 行');
    }
    const errors: Array<{ index: number; message: string }> = [];
    let duplicates = 0;
    const validRows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const name = text(row.name).trim();
      if (!name) {
        errors.push({ index, message: '缺少名称' });
        continue;
      }
      if (module === 'leads') {
        const phone = normPhone(row.phone);
        if (phone) {
          const exists = await this.prisma.crmLead.findFirst({
            where: {
              ownerUserId: ctx.ownerUserId,
              phoneNorm: phone,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (exists) duplicates += 1;
        }
      } else {
        const norm = normName(name);
        const exists = await this.prisma.crmCustomer.findFirst({
          where: {
            ownerUserId: ctx.ownerUserId,
            nameNorm: norm,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (exists) duplicates += 1;
      }
      validRows.push(row);
    }
    return {
      total: rows.length,
      valid: validRows.length,
      duplicates,
      errors,
      rows: validRows,
    };
  }

  async importCommit(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'import');
    const module = text(body.module, 'leads');
    const rows = Array.isArray(body.rows)
      ? (body.rows as Array<Record<string, unknown>>)
      : [];
    if (!rows.length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请粘贴或上传数据');
    if (rows.length > 500)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '单批最多 500 行');
    const skipDuplicates = body.skipDuplicates !== false;
    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      const name = text(row.name).trim().slice(0, 120);
      if (!name) continue;
      if (module === 'leads') {
        const phone = normPhone(row.phone);
        if (skipDuplicates && phone) {
          const exists = await this.prisma.crmLead.findFirst({
            where: {
              ownerUserId: ctx.ownerUserId,
              phoneNorm: phone,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (exists) {
            skipped += 1;
            continue;
          }
        }
        await this.prisma.crmLead.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            ...this.scope.orgKey(ctx),
            name,
            contactName: text(row.contactName).slice(0, 60),
            phone: text(row.phone).slice(0, 40),
            phoneNorm: phone,
            email: text(row.email).slice(0, 120),
            emailNorm: normEmail(row.email),
            source: text(row.source).slice(0, 60),
            stage: 'NEW',
            ownerId: ctx.actorId,
            remark: text(row.remark).slice(0, 2000),
          },
        });
        created += 1;
      } else {
        const norm = normName(name);
        if (skipDuplicates) {
          const exists = await this.prisma.crmCustomer.findFirst({
            where: {
              ownerUserId: ctx.ownerUserId,
              nameNorm: norm,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (exists) {
            skipped += 1;
            continue;
          }
        }
        await this.prisma.crmCustomer.create({
          data: {
            ownerUserId: ctx.ownerUserId,
            ...this.scope.orgKey(ctx),
            name,
            nameNorm: norm,
            ownerId: ctx.actorId,
            industry: text(row.industry).slice(0, 60),
            province: text(row.province).slice(0, 40),
            city: text(row.city).slice(0, 40),
            remark: text(row.remark).slice(0, 2000),
          },
        });
        created += 1;
      }
    }
    return { created, skipped };
  }

  async exportToDataTable(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertCan(ctx, 'export');
    const module = text(body.module, 'leads');
    const { columns, rows } = await this.exportRows(
      ctx,
      module,
      (body.filters || {}) as Record<string, unknown>,
    );
    let dataTableId = int(body.dataTableId);
    let created = false;
    if (!dataTableId) {
      const table = await this.dataTables.create(user, {
        name: text(body.tableName) || `CRM ${module} 导出`,
        description: '从 CRM 导出',
      });
      dataTableId = int((table as Record<string, unknown>).id);
      created = true;
      await this.dataTables.addFields(
        user,
        dataTableId,
        columns.map((column) => ({
          name: column.label,
          fieldKey: column.key,
          fieldType: 'text',
        })),
      );
    }
    for (let index = 0; index < rows.length; index += 200) {
      await this.dataTables.createRows(
        user,
        dataTableId,
        rows.slice(index, index + 200),
      );
    }
    return { dataTableId, rows: rows.length, created };
  }
}
