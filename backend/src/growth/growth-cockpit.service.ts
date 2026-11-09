import type { CurrentUser } from '../auth/current-user';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { PrismaService } from '../prisma/prisma.service';

type Row = Record<string, unknown>;

const money = (value: unknown) => Number(value || 0);
const moneyStr = (value: unknown) => money(value).toFixed(2);
const ratio = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
const dayStart = (value: string) => value.slice(0, 10);

/**
 * 增长驾驶舱快照：
 * - 目标：在跑周期内的目标/KR + 进度与风险数；
 * - 销售：线索/客户/商机/合同/回款，回款率按合同额算；
 * - 交付：项目、任务、超期、预算与已发生成本；
 * - 获客：雷达线索状态分布；客服：会话量与转 CRM 数。
 * 所有统计都按统一组织键 (orgType, orgUserId) 收口，时间窗口默认 90 天。
 */
export class GrowthCockpitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
  ) {}

  async cockpit(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const days = Math.min(365, Math.max(7, Number(query.days) || 90));
    const since = new Date(Date.now() - days * 86400000);
    const orgKey = { orgType: org.orgType, orgUserId: org.orgUserId };
    const today = dayStart(new Date().toISOString());

    const cycles = await this.prisma.okrCycle.findMany({
      where: { ...orgKey, status: 'ACTIVE' },
      select: { id: true },
    });
    const objectives = await this.prisma.okrObjective.findMany({
      where: {
        ...orgKey,
        status: 'ACTIVE',
        ...(cycles.length
          ? { cycleId: { in: cycles.map((row) => row.id) } }
          : {}),
      },
      select: { id: true, progress: true },
    });
    const objectiveIds = objectives.map((row) => row.id);
    const keyResults = objectiveIds.length
      ? await this.prisma.okrKeyResult.count({
          where: { ...orgKey, objectiveId: { in: objectiveIds } },
        })
      : 0;
    const avgProgress = objectives.length
      ? Math.round(
          (objectives.reduce((sum, row) => sum + Number(row.progress), 0) /
            objectives.length) *
            10,
        ) / 10
      : 0;
    const atRisk = objectives.filter((row) => Number(row.progress) < 40).length;

    const [
      leads,
      customers,
      opportunities,
      contractSum,
      paidSum,
      activeProjects,
      taskRows,
      costSum,
    ] = await Promise.all([
      this.prisma.crmLead.count({
        where: {
          ...orgKey,
          deletedAt: null,
          createdAt: { gte: since },
        },
      }),
      this.prisma.crmCustomer.count({
        where: { ...orgKey, deletedAt: null, createdAt: { gte: since } },
      }),
      this.prisma.crmOpportunity.count({
        where: { ...orgKey, deletedAt: null, createdAt: { gte: since } },
      }),
      this.prisma.crmContract.aggregate({
        _sum: { amount: true },
        where: {
          ...orgKey,
          deletedAt: null,
          approvalStatus: 'APPROVED',
          createdAt: { gte: since },
        },
      }),
      this.prisma.crmPaymentRecord.aggregate({
        _sum: { recordAmount: true },
        where: {
          ownerUserId: org.orgUserId,
          createdAt: { gte: since },
        },
      }),
      this.prisma.pjProject.findMany({
        where: {
          ...orgKey,
          status: { in: ['PLANNING', 'ACTIVE', 'ACCEPTING'] },
        },
        select: { id: true, budgetAmount: true },
      }),
      this.prisma.pjTask.findMany({
        where: { ...orgKey },
        select: { status: true, dueDate: true },
      }),
      this.prisma.pjCostItem.aggregate({
        _sum: { amount: true },
        where: { ...orgKey },
      }),
    ]);
    const budgetAmount = activeProjects.reduce(
      (sum, row) => sum + Number(row.budgetAmount),
      0,
    );
    const actualCost = money(costSum._sum.amount);
    const openTasks = taskRows.filter(
      (row) => !['DONE', 'CANCELED'].includes(row.status),
    ).length;
    const doneTasks = taskRows.filter((row) => row.status === 'DONE').length;
    const overdueTasks = taskRows.filter(
      (row) =>
        !['DONE', 'CANCELED'].includes(row.status) &&
        Boolean(row.dueDate) &&
        dayStart(row.dueDate) < today,
    ).length;

    const [acqRows, conversationRows, closedConversations, crmConverted] =
      await Promise.all([
        this.prisma.acqLead.groupBy({
          by: ['status'],
          _count: { id: true },
          where: { ...orgKey, firstSeenAt: { gte: since } },
        }),
        this.prisma.serviceDeskConversation.count({
          where: { ownerUserId: org.orgUserId, createdAt: { gte: since } },
        }),
        this.prisma.serviceDeskConversation.count({
          where: {
            ownerUserId: org.orgUserId,
            createdAt: { gte: since },
            status: 'closed',
          },
        }),
        this.prisma.serviceDeskConversation.count({
          where: {
            ownerUserId: org.orgUserId,
            createdAt: { gte: since },
            crmLeadId: { gt: 0 },
          },
        }),
      ]);
    const acqCount = (statuses: string[]) =>
      acqRows
        .filter((row) => statuses.includes(row.status))
        .reduce((sum, row) => sum + row._count.id, 0);
    const acquisition = {
      leads: acqRows.reduce((sum, row) => sum + row._count.id, 0),
      contacted: acqCount(['CONTACTED', 'REPLIED', 'QUALIFIED', 'PROMOTED']),
      replied: acqCount(['REPLIED', 'QUALIFIED', 'PROMOTED']),
      converted: acqCount(['PROMOTED']),
    };
    const service = {
      conversations: conversationRows,
      closed: closedConversations,
      crmConverted,
    };

    const contractAmount = money(contractSum._sum.amount);
    const paidAmount = money(paidSum._sum.recordAmount);
    const sales = {
      leads,
      customers,
      opportunities,
      pipelineAmount: moneyStr(
        (
          await this.prisma.crmOpportunity.aggregate({
            _sum: { amount: true },
            where: { ...orgKey, deletedAt: null },
          })
        )._sum.amount,
      ),
      contractAmount: moneyStr(contractAmount),
      paidAmount: moneyStr(paidAmount),
      collectionRate: ratio(paidAmount, contractAmount),
    };
    const delivery = {
      activeProjects: activeProjects.length,
      openTasks,
      doneTasks,
      overdueTasks,
      budgetAmount: moneyStr(budgetAmount),
      actualCost: moneyStr(actualCost),
      costRate: ratio(actualCost, budgetAmount),
    };

    const funnel = [
      { key: 'acquisition', label: '获客线索', value: acquisition.leads },
      { key: 'crmLead', label: 'CRM 线索', value: leads },
      { key: 'customer', label: '新增客户', value: customers },
      { key: 'opportunity', label: '新增商机', value: opportunities },
      {
        key: 'contract',
        label: '审批合同',
        value: await this.prisma.crmContract.count({
          where: {
            ...orgKey,
            deletedAt: null,
            approvalStatus: 'APPROVED',
            createdAt: { gte: since },
          },
        }),
      },
      {
        key: 'payment',
        label: '回款笔数',
        value: await this.paymentCount(org.orgUserId, since),
      },
    ];

    const alerts: Array<{
      level: 'WARNING' | 'INFO';
      title: string;
      detail: string;
    }> = [];
    if (overdueTasks > 0) {
      alerts.push({
        level: 'WARNING',
        title: `${overdueTasks} 个任务已超期`,
        detail: '按截止日期统计，建议在项目工作台按超期筛选并重排优先级。',
      });
    }
    if (atRisk > 0) {
      alerts.push({
        level: 'WARNING',
        title: `${atRisk} 个目标进度低于 40%`,
        detail: '当前周期目标进度落后，可在 OKR 工作台查看 KR 缺口。',
      });
    }
    if (delivery.costRate > 100) {
      alerts.push({
        level: 'WARNING',
        title: `项目成本已超预算 ${delivery.costRate - 100}%`,
        detail: '已发生成本高于预算金额，请核对人力费率与外部结算。',
      });
    }
    if (contractAmount > 0 && sales.collectionRate < 60) {
      alerts.push({
        level: 'INFO',
        title: `回款率 ${sales.collectionRate}%`,
        detail: '当期合同额已确认，但回款进度偏慢，可跟进逾期回款计划。',
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      days,
      goals: {
        objectives: objectives.length,
        keyResults,
        avgProgress,
        atRisk,
      },
      sales,
      delivery,
      acquisition,
      service,
      funnel,
      alerts,
      trend: await this.paymentTrend(org.orgUserId),
    };
  }

  private paymentCount(ownerUserId: string, since: Date) {
    return this.prisma.crmPaymentRecord.count({
      where: { ownerUserId, createdAt: { gte: since } },
    });
  }

  /** 近 6 个自然月的回款趋势（含本月）。 */
  private async paymentTrend(ownerUserId: string) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const rows = await this.prisma.crmPaymentRecord.findMany({
      where: { ownerUserId, createdAt: { gte: start } },
      select: { recordAmount: true, createdAt: true },
    });
    const buckets = new Map<string, number>();
    for (let index = 0; index < 6; index += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, 0);
    }
    for (const row of rows) {
      const key = `${row.createdAt.getFullYear()}-${String(row.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) || 0) + Number(row.recordAmount));
      }
    }
    return [...buckets.entries()].map(([month, amount]) => ({
      month,
      paidAmount: amount.toFixed(2),
    }));
  }
}
