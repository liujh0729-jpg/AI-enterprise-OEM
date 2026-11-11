import type { CurrentUser } from '../auth/current-user';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TaskDraft } from '../task-center/task-source';

type Row = Record<string, unknown>;

const num = (value: unknown) => Number(value || 0);
const moneyStr = (value: number) => value.toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

export const RISK_KINDS = [
  'RECEIVABLE_OVERDUE',
  'PAYABLE_OVERDUE',
  'PROJECT_OVER_BUDGET',
  'STOCK_LOW',
  'TASK_OVERDUE',
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

export const RISK_KIND_LABELS: Record<RiskKind, string> = {
  RECEIVABLE_OVERDUE: '应收逾期',
  PAYABLE_OVERDUE: '应付逾期',
  PROJECT_OVER_BUDGET: '项目超预算',
  STOCK_LOW: '库存低于补货点',
  TASK_OVERDUE: '任务超期',
};

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * 经营异常模型（P4-6）：五类可量化异常统一出一个信号，
 * 每次扫描把异常派成「责任任务」进任务中心（assign_task 同一条派单口），
 * 并对外发 `risk.detected` 事件，规则/Webhook 可以据此加码。
 * 关闭口径不靠人工点「已完成」：结案时重新扫描一次，异常消失才允许关闭。
 */

export type RiskSignal = {
  kind: RiskKind;
  kindLabel: string;
  entityKey: string;
  title: string;
  detail: string;
  amount: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  ownerUserId: string;
  link: string;
  /** 库存信号载荷：派单时据此生成「补货申请」（正式采购单，后续仍走审批）。 */
  stock?: {
    warehouseId: number;
    variantId: number;
    sku: string;
    /** 建议补货量：补货点 − 现存，至少 1 */
    quantity: number;
  };
};

export class OperationRiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly mechanisms: MechanismService,
    private readonly tasks: { assign(draft: TaskDraft): Promise<unknown> },
  ) {}

  /** 扫描当前组织五类异常；只读，不改任何业务单据。 */
  async scan(org: HrmOrg): Promise<RiskSignal[]> {
    const orgKey = { orgType: org.orgType, orgUserId: org.orgUserId };
    const todayStr = today();
    const [receivables, payables, projects, stocks, tasks] = await Promise.all([
      this.prisma.erpReceivable.findMany({
        where: {
          ...orgKey,
          status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] },
          dueDate: { lt: todayStr },
        },
        select: {
          id: true,
          code: true,
          customerName: true,
          amount: true,
          receivedAmount: true,
          dueDate: true,
        },
        take: 200,
      }),
      this.prisma.erpPayable.findMany({
        where: {
          ...orgKey,
          status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] },
          dueDate: { lt: todayStr },
        },
        select: {
          id: true,
          code: true,
          vendorId: true,
          amount: true,
          paidAmount: true,
          dueDate: true,
        },
        take: 200,
      }),
      this.prisma.pjProject.findMany({
        where: {
          ...orgKey,
          status: { in: ['PLANNING', 'ACTIVE', 'ACCEPTING'] },
          budgetAmount: { gt: 0 },
        },
        select: {
          id: true,
          name: true,
          ownerId: true,
          budgetAmount: true,
        },
        take: 200,
      }),
      this.prisma.erpStock.findMany({
        where: { ...orgKey, reorderPoint: { gt: 0 } },
        select: {
          warehouseId: true,
          variantId: true,
          onHand: true,
          reorderPoint: true,
        },
        take: 500,
      }),
      this.prisma.pjTask.findMany({
        where: {
          ...orgKey,
          status: { notIn: ['DONE', 'CANCELED'] },
          dueDate: { lt: todayStr },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          assigneeId: true,
          assigneeType: true,
          projectId: true,
        },
        take: 500,
      }),
    ]);

    const projectIds = projects.map((row) => row.id);
    const costByProject = new Map<number, number>();
    if (projectIds.length) {
      const costs = await this.prisma.pjCostItem.groupBy({
        by: ['projectId'],
        _sum: { amount: true },
        where: { ...orgKey, projectId: { in: projectIds } },
      });
      for (const item of costs)
        costByProject.set(item.projectId, num(item._sum.amount));
    }
    const variantIds = [...new Set(stocks.map((row) => row.variantId))];
    const variants = variantIds.length
      ? await this.prisma.erpVariant.findMany({
          where: {
            id: { in: variantIds },
            orgType: org.orgType,
            orgUserId: org.orgUserId,
          },
          select: { id: true, sku: true, name: true },
        })
      : [];
    const variantLabels = new Map(
      variants.map((row) => [row.id, row.name || row.sku || `#${row.id}`]),
    );
    const variantSkus = new Map(variants.map((row) => [row.id, row.sku || '']));
    const vendorIds = [...new Set(payables.map((row) => row.vendorId))].filter(
      (id) => id > 0,
    );
    const vendors = vendorIds.length
      ? await this.prisma.erpVendor.findMany({
          where: { id: { in: vendorIds } },
          select: { id: true, name: true },
        })
      : [];
    const vendorNames = new Map(vendors.map((row) => [row.id, row.name]));
    const fallbackOwner = org.orgUserId;

    const out: RiskSignal[] = [];
    for (const row of receivables) {
      const outstanding = num(row.amount) - num(row.receivedAmount);
      if (outstanding <= 0) continue;
      out.push({
        kind: 'RECEIVABLE_OVERDUE',
        kindLabel: RISK_KIND_LABELS.RECEIVABLE_OVERDUE,
        entityKey: `receivable:${row.id}`,
        title: `应收逾期：${row.customerName || row.code || `#${row.id}`}`,
        detail: `${row.code || `应收 #${row.id}`} 应于 ${row.dueDate} 前收清，尚欠 ${moneyStr(outstanding)}`,
        amount: moneyStr(outstanding),
        severity: outstanding >= 50000 ? 'HIGH' : 'MEDIUM',
        ownerUserId: fallbackOwner,
        link: '/erp',
      });
    }
    for (const row of payables) {
      const outstanding = num(row.amount) - num(row.paidAmount);
      if (outstanding <= 0) continue;
      out.push({
        kind: 'PAYABLE_OVERDUE',
        kindLabel: RISK_KIND_LABELS.PAYABLE_OVERDUE,
        entityKey: `payable:${row.id}`,
        title: `应付逾期：${vendorNames.get(row.vendorId) || `供应商 #${row.vendorId}`}`,
        detail: `${row.code || `应付 #${row.id}`} 应于 ${row.dueDate} 前付清，尚欠 ${moneyStr(outstanding)}`,
        amount: moneyStr(outstanding),
        severity: outstanding >= 50000 ? 'HIGH' : 'MEDIUM',
        ownerUserId: fallbackOwner,
        link: '/erp',
      });
    }
    for (const row of projects) {
      const cost = costByProject.get(row.id) || 0;
      const budget = num(row.budgetAmount);
      if (cost <= budget) continue;
      out.push({
        kind: 'PROJECT_OVER_BUDGET',
        kindLabel: RISK_KIND_LABELS.PROJECT_OVER_BUDGET,
        entityKey: `project:${row.id}`,
        title: `项目超预算：${row.name}`,
        detail: `预算 ${moneyStr(budget)}，已发生成本 ${moneyStr(cost)}，超出 ${moneyStr(cost - budget)}`,
        amount: moneyStr(cost - budget),
        severity: cost >= budget * 1.2 ? 'HIGH' : 'MEDIUM',
        ownerUserId: row.ownerId || fallbackOwner,
        link: '/project',
      });
    }
    for (const row of stocks) {
      const onHand = num(row.onHand);
      const reorderPoint = num(row.reorderPoint);
      if (onHand >= reorderPoint) continue;
      out.push({
        kind: 'STOCK_LOW',
        kindLabel: RISK_KIND_LABELS.STOCK_LOW,
        entityKey: `stock:${row.warehouseId}:${row.variantId}`,
        title: `库存低于补货点：${variantLabels.get(row.variantId) || `#${row.variantId}`}`,
        detail: `仓库 #${row.warehouseId} 现有 ${onHand}，补货点 ${reorderPoint}`,
        amount: '',
        severity: 'LOW',
        ownerUserId: fallbackOwner,
        link: '/erp',
        stock: {
          warehouseId: row.warehouseId,
          variantId: row.variantId,
          sku: variantSkus.get(row.variantId) || '',
          quantity: Math.max(1, Math.ceil(reorderPoint - onHand)),
        },
      });
    }
    for (const row of tasks) {
      if (row.assigneeType !== 'STAFF' || !row.assigneeId) continue;
      out.push({
        kind: 'TASK_OVERDUE',
        kindLabel: RISK_KIND_LABELS.TASK_OVERDUE,
        entityKey: `task:${row.id}`,
        title: `任务超期：${row.title}`,
        detail: `截止 ${row.dueDate} 仍未完成`,
        amount: '',
        severity: 'LOW',
        ownerUserId: row.assigneeId,
        link: '/project',
      });
    }
    return out;
  }

  /**
   * 扫描并按异常派责任任务（幂等：同一异常只保留一条）；返回本次扫描结果。
   * 库存低于补货点先落一张「补货申请」（正式采购单，状态待审批，后续仍走采购审批），
   * 任务锚在该采购单周期上，采购岗位接手后无需再从零录入。
   */
  async dispatchRisks(org: HrmOrg) {
    const signals = await this.scan(org);
    for (const signal of signals) {
      const replenish = signal.stock
        ? await this.ensureReplenishment(org, signal).catch(() => null)
        : null;
      const sourceId =
        replenish && signal.stock
          ? `stock:${signal.stock.warehouseId}:${signal.stock.variantId}:o${replenish.orderId}`
          : signal.entityKey;
      const title = replenish
        ? `补货申请：${signal.title.replace(/^.*：/, '')}`
        : signal.title;
      const description = replenish
        ? `${signal.detail}；已生成采购申请 ${replenish.orderNo}（待审批）`
        : signal.detail;
      const ownerUserId = replenish
        ? replenish.ownerUserId
        : signal.ownerUserId;
      await this.tasks
        .assign({
          assigneeUserId: ownerUserId,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          assignedBy: 'system',
          source: 'risk',
          sourceId,
          title,
          description,
          link: signal.link,
          category: 'matter',
          priority: signal.severity === 'HIGH' ? 'URGENT' : 'HIGH',
          createdBy: org.orgUserId,
          sourceStatus: 'OPEN',
          sourceStatusLabel: replenish ? '待审批补货' : '待处置',
        })
        .catch(() => null);
      await this.mechanisms
        .dispatch(org, 'risk.detected', {
          kind: signal.kind,
          kindLabel: signal.kindLabel,
          entityKey: signal.entityKey,
          title,
          detail: description,
          amount: signal.amount,
          severity: signal.severity,
          ownerUserId,
          ...(replenish ? { purchaseOrderId: replenish.orderId } : {}),
        })
        .catch(() => null);
    }
    return signals;
  }

  /** 采购岗位：角色码或岗位名称关键词命中即可，找不到回落组织负责人。 */
  private async purchaserOf(org: HrmOrg): Promise<string> {
    const rows = await this.prisma.orgStaff.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        status: 'ACTIVE',
      },
      select: { memberUserId: true, roles: true, positions: true },
    });
    const roles = ['PURCHASE', 'PURCHASING', 'BUYER', '采购'];
    const keywords = ['采购', '供应', 'buyer', 'purchas'];
    const hit = rows.find((row) => {
      const codes = Array.isArray(row.roles)
        ? (row.roles as unknown[]).map((item) => String(item).toUpperCase())
        : [];
      if (codes.some((code) => roles.includes(code))) return true;
      const names = Array.isArray(row.positions)
        ? (row.positions as { name?: unknown }[])
            .map((item) =>
              typeof item?.name === 'string' ? item.name.toLowerCase() : '',
            )
            .filter(Boolean)
        : [];
      return names.some((name) =>
        keywords.some((keyword) => name.includes(keyword)),
      );
    });
    return hit?.memberUserId || org.orgUserId;
  }

  /**
   * 补货申请（幂等）：同一仓库 + 变体已有在途补货单（待审批/已批准/收货中）就复用，
   * 否则按「补货点 − 现存」生成一张待审批采购单；供应商优先沿用唯一在用供应商。
   */
  private async ensureReplenishment(
    org: HrmOrg,
    signal: RiskSignal,
  ): Promise<{ orderId: number; orderNo: string; ownerUserId: string } | null> {
    const stock = signal.stock;
    if (!stock) return null;
    const orgKey = { orgType: org.orgType, orgUserId: org.orgUserId };
    const ownerUserId = await this.purchaserOf(org);
    const baseNo = `stock:${stock.warehouseId}:${stock.variantId}`;
    const open = await this.prisma.erpPurchaseOrder.findFirst({
      where: {
        ...orgKey,
        sourceType: 'STOCK_LOW',
        sourceNo: baseNo,
        status: { in: ['PENDING', 'APPROVED', 'RECEIVING'] },
      },
      orderBy: { id: 'desc' },
      select: { id: true, orderNo: true },
    });
    if (open) {
      return {
        orderId: open.id,
        orderNo: open.orderNo,
        ownerUserId,
      };
    }
    const variant = await this.prisma.erpVariant.findFirst({
      where: { id: stock.variantId, ...orgKey },
      select: {
        id: true,
        sku: true,
        productId: true,
        purchasePrice: true,
      },
    });
    if (!variant) return null;
    const product = await this.prisma.erpProduct.findUnique({
      where: { id: variant.productId },
      select: { taxRate: true },
    });
    const quantity = Math.max(1, Math.round(stock.quantity));
    const price = num(variant.purchasePrice);
    const amount = Number((quantity * price).toFixed(2));
    const taxAmount = Number(
      ((amount * num(product?.taxRate)) / 100).toFixed(2),
    );
    const vendor = await this.prisma.erpVendor.findFirst({
      where: { ...orgKey, status: 'ACTIVE' },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    const stamp = today().replace(/-/g, '');
    const count = await this.prisma.erpPurchaseOrder.count({
      where: {
        ...orgKey,
        createdAt: { gte: new Date(`${today()}T00:00:00Z`) },
      },
    });
    const orderNo = `CG-${stamp}-${String(count + 1).padStart(4, '0')}`;
    const created = await this.prisma.erpPurchaseOrder.create({
      data: {
        ...orgKey,
        orderNo,
        vendorId: vendor?.id || 0,
        projectId: 0,
        sourceType: 'STOCK_LOW',
        sourceNo: baseNo,
        warehouseId: stock.warehouseId,
        items: [
          {
            variantId: variant.id,
            sku: variant.sku || stock.sku,
            quantity,
            price,
          },
        ],
        amount,
        taxAmount,
        expectedAt: '',
        note: `库存低于补货点自动生成：${signal.detail}`.slice(0, 500),
        // 正式采购申请：仍需采购审批后才能收货（docs §8.4 完成依据）
        status: 'PENDING',
        createdBy: org.orgUserId,
      },
      select: { id: true, orderNo: true },
    });
    await this.mechanisms
      .dispatch(org, 'erp.purchase.created', {
        orderId: created.id,
        orderNo: created.orderNo,
        amount: amount.toFixed(2),
        source: 'STOCK_LOW',
      })
      .catch(() => null);
    return { orderId: created.id, orderNo: created.orderNo, ownerUserId };
  }

  async list(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const kind = typeof query.kind === 'string' ? query.kind : '';
    const signals = (await this.scan(org)).filter(
      (item) => !kind || item.kind === kind,
    );
    signals.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
    );
    const byKind = RISK_KINDS.map((key) => ({
      kind: key,
      kindLabel: RISK_KIND_LABELS[key],
      count: signals.filter((item) => item.kind === key).length,
    }));
    const names = await this.scope.names(
      signals.map((item) => item.ownerUserId),
    );
    return {
      scannedAt: new Date().toISOString(),
      total: signals.length,
      high: signals.filter((item) => item.severity === 'HIGH').length,
      byKind,
      list: signals.slice(0, 300).map((item) => ({
        ...item,
        ownerName: names.get(item.ownerUserId) || item.ownerUserId,
      })),
    };
  }

  /** 手动触发一次扫描派单（负责人/管理员）。 */
  async runScan(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    this.scope.requireAdmin(org);
    const signals = await this.dispatchRisks(org);
    return { scannedAt: new Date().toISOString(), total: signals.length };
  }

  /**
   * 结案复核（P4-6 的关闭口径）：任务侧准备关闭经营异常责任任务前调用，
   * 按当前库表现场复扫同一实体——异常仍在就拒绝关闭，不认「点完成」。
   * 组织键从派发时写在任务 description 里的行取，口径与派发完全一致。
   */
  async recheck(
    orgKey: { orgType: string; orgUserId: string },
    sourceId: string,
  ) {
    if (!orgKey.orgUserId || !sourceId) return { cleared: true, reason: '' };
    // 补货任务的完成依据是「补货申请已成立」（docs §8.4）：在途补货单存在即放行，
    // 不必等库存真的回到补货点以上（那由采购审批/入库链路推进）。
    if (sourceId.startsWith('stock:')) {
      const [, warehouseId, variantId] = sourceId.split(':');
      if (warehouseId && variantId) {
        const open = await this.prisma.erpPurchaseOrder.count({
          where: {
            orgType: orgKey.orgType || 'ENTERPRISE',
            orgUserId: orgKey.orgUserId,
            sourceType: 'STOCK_LOW',
            sourceNo: `stock:${warehouseId}:${variantId}`,
            status: { in: ['PENDING', 'APPROVED', 'RECEIVING'] },
          },
        });
        if (open > 0) return { cleared: true, reason: '' };
      }
    }
    const org: HrmOrg = {
      orgType: orgKey.orgType || 'ENTERPRISE',
      orgUserId: orgKey.orgUserId,
      actorId: orgKey.orgUserId,
      isOwner: true,
      isAdmin: true,
      roles: [],
      positions: [],
      department: '',
    };
    const signals = await this.scan(org);
    // 补货任务锚带采购单周期后缀（stock:仓库:变体:o单号），复核按信号本体匹配。
    const entityKey = sourceId.replace(/:o\d+$/, '');
    const hit = signals.find((item) => item.entityKey === entityKey);
    if (!hit) return { cleared: true, reason: '' };
    return {
      cleared: false,
      reason: `异常仍未消除：${hit.detail}`,
    };
  }
}
