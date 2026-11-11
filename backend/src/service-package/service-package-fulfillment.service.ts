import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { CATEGORY_LABELS } from '../common/constants';
import { ErrorCode } from '../common/error-code';
import { ContractsService } from '../contracts/contracts.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { IdentityService } from '../identity/identity.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';

/** 系统自动发起签约的操作者：购买后自动发起无在线管理员，以平台系统身份主持（审计留痕）。 */
const SYSTEM_OPERATOR = new CurrentUser('system', '平台系统', 'super');

/** 交付明细的实时状态：未发起按是否已匹配服务商区分，已发起实时读关联签约状态。 */
type ItemState =
  'PENDING_MATCH' | 'PENDING_INITIATE' | 'SIGNING' | 'ACTIVE' | 'TERMINATED';

function toNum(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

/**
 * 官方服务套餐交付：平台主持企业与多家优质服务商签约兑现套餐。
 * 明细状态实时读关联 Contract.status（避免双写不一致）；订单交付状态由明细汇总。
 * 复用 ContractsService.initiateByPlatform（备案/独占/个人主体校验）与 terminate（Offer 撤销）。
 */
export class ServicePackageFulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly points: PointsService,
    private readonly contracts: ContractsService,
    private readonly users: UserLookupService,
  ) {}

  /** 候选服务商：复用名录口径（已备案 + 承接该细项），仅保留仍有真实账号的服务商供匹配。 */
  async candidates(serviceType: string) {
    const rows = await this.contracts.providerDirectory(serviceType);
    const ids = rows.map((row) => text(row.providerUserId));
    // 服务商账号以本地 users 表为准：历史备案里可能残留已不存在的账号，不能匹配。
    const numericIds = [
      ...new Set(
        ids
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const alive = new Set(
      (numericIds.length
        ? await this.prisma.account.findMany({
            where: { id: { in: numericIds }, status: 'ACTIVE' },
            select: { id: true },
          })
        : []
      ).map((row) => String(row.id)),
    );
    return rows
      .filter((row) => alive.has(text(row.providerUserId)))
      .map((row) => ({
        providerUserId: text(row.providerUserId),
        orgName: text(row.orgName),
        displayName: text(row.displayName),
        province: text(row.province),
        city: text(row.city),
      }));
  }

  /** 一条明细的实时状态（读关联签约）。 */
  private itemState(
    item: { providerUserId: string; contractId: number },
    contractStatus: string | undefined,
  ): ItemState {
    if (!item.contractId) {
      return item.providerUserId ? 'PENDING_INITIATE' : 'PENDING_MATCH';
    }
    if (contractStatus === 'ACTIVE') return 'ACTIVE';
    if (contractStatus === 'PENDING') return 'SIGNING';
    return 'TERMINATED';
  }

  /** 由明细实时状态汇总订单交付状态：全部生效=DELIVERED；有在途签约=SIGNING；否则待匹配。 */
  private rollup(states: ItemState[]): string {
    if (states.length && states.every((s) => s === 'ACTIVE'))
      return 'DELIVERED';
    if (states.some((s) => s === 'SIGNING' || s === 'ACTIVE')) return 'SIGNING';
    return 'PENDING_MATCH';
  }

  /**
   * 重算并回写订单交付状态（已关闭订单不动）。返回最新状态。
   * 服务商沿用现有 confirm 生效、terminate 否决，订单侧只在读/写时对账，不双写明细。
   */
  async syncFulfillment(orderId: number): Promise<string> {
    const order = await this.prisma.servicePackageOrder.findUnique({
      where: { id: orderId },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '套餐订单不存在');
    if (order.fulfillmentStatus === 'CLOSED') return 'CLOSED';
    const items = await this.prisma.servicePackageOrderItem.findMany({
      where: { orderId },
      orderBy: { sortOrder: 'asc' },
    });
    const contractIds = items.map((i) => i.contractId).filter((id) => id > 0);
    const contracts = contractIds.length
      ? await this.prisma.contract.findMany({
          where: { id: { in: contractIds } },
          select: { id: true, status: true },
        })
      : [];
    const statusMap = new Map(contracts.map((c) => [c.id, c.status]));
    const states = items.map((i) =>
      this.itemState(i, statusMap.get(i.contractId)),
    );
    const next = this.rollup(states);
    if (next !== order.fulfillmentStatus) {
      await this.prisma.servicePackageOrder.update({
        where: { id: orderId },
        data: { fulfillmentStatus: next },
      });
    }
    return next;
  }

  /** 订单 + 明细装饰（明细带实时签约状态、服务商名、PENDING 时长用于队列标红）。 */
  private async decorateOrder(order: {
    id: number;
    orderNo: string;
    userId: string;
    enterpriseId: number;
    packageId: number;
    packageName: string;
    serviceType: string;
    priceCents: number;
    rateAmount: unknown;
    pointsAmount: unknown;
    refundedPointsAmount: unknown;
    status: string;
    fulfillmentStatus: string;
    createdAt: Date;
  }) {
    const items = await this.prisma.servicePackageOrderItem.findMany({
      where: { orderId: order.id },
      orderBy: { sortOrder: 'asc' },
    });
    const contractIds = items.map((i) => i.contractId).filter((id) => id > 0);
    const contracts = contractIds.length
      ? await this.prisma.contract.findMany({
          where: { id: { in: contractIds } },
          select: {
            id: true,
            status: true,
            contractNo: true,
            updatedAt: true,
            createdAt: true,
          },
        })
      : [];
    const contractMap = new Map(contracts.map((c) => [c.id, c]));
    const providerIds = [
      ...new Set(items.map((i) => i.providerUserId).filter(Boolean)),
    ];
    const names = providerIds.length
      ? await this.users.displayNames(providerIds)
      : new Map<string, string>();
    const ep = await this.prisma.enterpriseProfile.findUnique({
      where: { id: order.enterpriseId },
      select: { name: true },
    });
    const now = Date.now();
    const decoratedItems = items.map((item) => {
      const contract = contractMap.get(item.contractId);
      const state = this.itemState(item, contract?.status);
      const pendingSince = contract?.createdAt ?? contract?.updatedAt;
      return {
        id: item.id,
        code: item.code,
        label: item.label || CATEGORY_LABELS[item.code] || item.code,
        providerUserId: item.providerUserId,
        providerOrg: item.providerOrg,
        providerName: names.get(item.providerUserId) || item.providerOrg || '',
        contractId: item.contractId,
        contractNo: contract?.contractNo || '',
        contractStatus: contract?.status || '',
        state,
        // 签约待确认时长（小时）：队列按此标红提醒「迟迟不确认」，平台人工换主体。
        pendingHours:
          state === 'SIGNING' && pendingSince
            ? Math.floor((now - pendingSince.getTime()) / 3_600_000)
            : 0,
      };
    });
    return {
      id: order.id,
      orderNo: order.orderNo,
      userId: order.userId,
      enterpriseId: order.enterpriseId,
      enterpriseName: ep?.name || '',
      packageId: order.packageId,
      packageName: order.packageName,
      serviceType: order.serviceType,
      priceCents: order.priceCents,
      rate: toNum(order.rateAmount),
      pointsAmount: toNum(order.pointsAmount),
      refundedPointsAmount: toNum(order.refundedPointsAmount),
      refundableAmount: Number(
        Math.max(
          0,
          toNum(order.pointsAmount) - toNum(order.refundedPointsAmount),
        ).toFixed(4),
      ),
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      createdAt: order.createdAt,
      items: decoratedItems,
    };
  }

  /** 交付管理队列：按板块/交付状态/企业关键词筛选，先对账再分页返回。 */
  async adminOrders(opts: {
    serviceType?: string;
    fulfillmentStatus?: string;
    keyword?: string;
    page: number;
    size: number;
  }) {
    const where: {
      serviceType?: string;
      fulfillmentStatus?: string;
      enterpriseId?: { in: number[] };
    } = {};
    if (opts.serviceType) where.serviceType = opts.serviceType;
    if (opts.fulfillmentStatus)
      where.fulfillmentStatus = opts.fulfillmentStatus;
    if (opts.keyword) {
      const eps = await this.prisma.enterpriseProfile.findMany({
        where: { name: { contains: opts.keyword } },
        select: { id: true },
      });
      where.enterpriseId = { in: eps.length ? eps.map((e) => e.id) : [-1] };
    }
    const rows = await this.prisma.servicePackageOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.size,
      take: opts.size,
    });
    // 读时对账（服务商可能已在签约台账确认/否决），保证队列状态与签约一致。
    await Promise.all(
      rows
        .filter((r) => r.fulfillmentStatus !== 'CLOSED')
        .map((r) => this.syncFulfillment(r.id).catch(() => undefined)),
    );
    const fresh = await this.prisma.servicePackageOrder.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.servicePackageOrder.count({ where });
    return {
      total,
      page: opts.page,
      size: opts.size,
      list: await Promise.all(fresh.map((r) => this.decorateOrder(r))),
    };
  }

  /** 单订单交付详情（用户「我的套餐」与后台展开共用）。 */
  async orderDetail(orderId: number) {
    await this.syncFulfillment(orderId).catch(() => undefined);
    const order = await this.prisma.servicePackageOrder.findUnique({
      where: { id: orderId },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '套餐订单不存在');
    return this.decorateOrder(order);
  }

  /** 我的套餐：本人采购订单 + 每项交付进度。 */
  async myOrders(userId: string) {
    const rows = await this.prisma.servicePackageOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    await Promise.all(
      rows
        .filter((r) => r.fulfillmentStatus !== 'CLOSED')
        .map((r) => this.syncFulfillment(r.id).catch(() => undefined)),
    );
    const fresh = await this.prisma.servicePackageOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(fresh.map((r) => this.decorateOrder(r)));
  }

  /** 校验该服务商可承接此交付项（复用名录口径：已备案 + 承接该细项）。 */
  private async assertCandidate(code: string, providerUserId: string) {
    const list = await this.candidates(code);
    if (!list.some((c) => c.providerUserId === providerUserId)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `该服务商未通过「${CATEGORY_LABELS[code] || code}」备案或不承接该项，不可匹配`,
      );
    }
  }

  /** 逐项匹配服务商（只绑定，不发起）；发起走 initiateSigning。 */
  async assignProvider(
    operator: CurrentUser,
    orderItemId: number,
    providerUserId: string,
  ) {
    this.identity.requireAdmin(operator);
    const item = await this.prisma.servicePackageOrderItem.findUnique({
      where: { id: orderItemId },
    });
    if (!item)
      throw new BusinessException(ErrorCode.NOT_FOUND, '交付明细不存在');
    if (item.contractId) {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        '该交付项已发起签约，如需更换请用「更换服务商」',
      );
    }
    await this.assertCandidate(item.code, providerUserId);
    const providerOrg = await this.users.displayName(providerUserId);
    await this.prisma.servicePackageOrderItem.update({
      where: { id: orderItemId },
      data: { providerUserId, providerOrg },
    });
    await this.syncFulfillment(item.orderId);
    return { id: orderItemId, providerUserId, providerOrg };
  }

  /** 对一条已匹配明细主持发起签约并回填 contractId（best-effort，调用方收集失败）。 */
  private async initiateItem(
    operator: CurrentUser,
    order: { id: number; enterpriseId: number },
    item: { id: number; code: string; providerUserId: string },
  ) {
    const res = await this.contracts.initiateByPlatform(operator, {
      enterpriseId: order.enterpriseId,
      providerUserId: item.providerUserId,
      serviceType: item.code,
      packageOrderId: order.id,
      note: '官方服务套餐交付 · 平台整合优质服务商',
    });
    await this.prisma.servicePackageOrderItem.update({
      where: { id: item.id },
      data: { contractId: res.id },
    });
    return res.id;
  }

  /** 批量主持发起：对已匹配且未发起的明细逐项建 PENDING 签约，失败项留待人工兜底。 */
  async initiateSigning(operator: CurrentUser, orderId: number) {
    this.identity.requireAdmin(operator);
    const order = await this.prisma.servicePackageOrder.findUnique({
      where: { id: orderId },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '套餐订单不存在');
    if (order.fulfillmentStatus === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.ORDER_STATE,
        '订单已关闭，不可发起',
      );
    }
    const items = await this.prisma.servicePackageOrderItem.findMany({
      where: { orderId, providerUserId: { not: '' }, contractId: 0 },
      orderBy: { sortOrder: 'asc' },
    });
    const failed: Array<{ code: string; message: string }> = [];
    let initiated = 0;
    for (const item of items) {
      try {
        await this.initiateItem(operator, order, item);
        initiated += 1;
      } catch (error) {
        failed.push({
          code: item.code,
          message: error instanceof Error ? error.message : '发起失败',
        });
      }
    }
    const fulfillmentStatus = await this.syncFulfillment(orderId);
    return { initiated, failed, fulfillmentStatus };
  }

  /**
   * 购买后自动发起（autoInitiate=true 且明细已预绑）：系统身份主持，best-effort。
   * 只创建 PENDING 签约，绝不代服务商确认；ACTIVE 只能由服务商 confirm 产生。
   * 失败明细回落「待匹配」进交付队列，不阻断购买（购买已扣分，交付转人工兜底）。
   */
  async autoInitiate(orderId: number): Promise<void> {
    const order = await this.prisma.servicePackageOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) return;
    const items = await this.prisma.servicePackageOrderItem.findMany({
      where: { orderId, providerUserId: { not: '' }, contractId: 0 },
      orderBy: { sortOrder: 'asc' },
    });
    for (const item of items) {
      try {
        await this.initiateItem(SYSTEM_OPERATOR, order, item);
      } catch {
        // 预绑服务商可能已停用/不承接/独占被占：留待人工匹配，不阻断购买。
      }
    }
    await this.syncFulfillment(orderId).catch(() => undefined);
  }

  /**
   * 更换发起签约主体（服务商否决/迟迟不确认）：原 Offer 撤销 → 新服务商重新发起 → 回填。
   * 仅限未生效（PENDING）或已生效但无业务单据的签约；已生效且有单据的走解约 + 线下处理。
   */
  async replaceProvider(
    operator: CurrentUser,
    orderItemId: number,
    newProviderUserId: string,
  ) {
    this.identity.requireAdmin(operator);
    const item = await this.prisma.servicePackageOrderItem.findUnique({
      where: { id: orderItemId },
    });
    if (!item)
      throw new BusinessException(ErrorCode.NOT_FOUND, '交付明细不存在');
    const order = await this.prisma.servicePackageOrder.findUnique({
      where: { id: item.orderId },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '套餐订单不存在');
    if (order.fulfillmentStatus === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.ORDER_STATE,
        '订单已关闭，不可更换',
      );
    }
    await this.assertCandidate(item.code, newProviderUserId);
    if (item.contractId) {
      const old = await this.prisma.contract.findUnique({
        where: { id: item.contractId },
      });
      if (old && old.status === 'ACTIVE') {
        const refs = await this.contracts.businessRefs(old.id);
        if (refs > 0) {
          throw new BusinessException(
            ErrorCode.CONTRACT_STATE,
            `原签约已生效且产生 ${refs} 条业务单据，不可直接更换，请解约后线下处理`,
          );
        }
      }
      // 原 Offer 撤销（PENDING/ACTIVE→TERMINATED；已 TERMINATED 则跳过）。
      if (old && ['PENDING', 'ACTIVE'].includes(old.status)) {
        await this.contracts.terminate(operator, old.id);
        await this.identity.audit(
          operator.userId,
          '套餐交付更换服务商',
          `订单${order.orderNo} 交付项「${CATEGORY_LABELS[item.code] || item.code}」原签约${old.contractNo}撤销`,
        );
      }
    }
    const providerOrg = await this.users.displayName(newProviderUserId);
    const contractId = await this.initiateItem(operator, order, {
      id: item.id,
      code: item.code,
      providerUserId: newProviderUserId,
    });
    await this.prisma.servicePackageOrderItem.update({
      where: { id: item.id },
      data: { providerUserId: newProviderUserId, providerOrg },
    });
    const fulfillmentStatus = await this.syncFulfillment(item.orderId);
    return {
      id: item.id,
      contractId,
      providerUserId: newProviderUserId,
      fulfillmentStatus,
    };
  }

  /**
   * 退款：按金额支持部分退与整单退（不传金额＝退回剩余全部）。
   * - 部分退：只回补积分，订单保持开放，交付与签约不受影响；
   * - 整单退：需无已生效签约，撤销全部待确认签约并把订单置 CLOSED；
   * - 幂等/并发：订单累计已退金额做乐观锁，重复或并发退款只会成功一次；
   *   退款入账与订单/退款记录同事务提交，不会出现「退了分但订单未记」或反向情况。
   */
  async refund(
    operator: CurrentUser,
    orderId: number,
    input: { amount?: number; remark?: string } = {},
  ) {
    this.identity.requireAdmin(operator);
    const round4 = (value: number) => Number(value.toFixed(4));
    const order = await this.prisma.servicePackageOrder.findUnique({
      where: { id: orderId },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '套餐订单不存在');
    if (order.status === 'REFUNDED' || order.fulfillmentStatus === 'CLOSED') {
      throw new BusinessException(
        ErrorCode.ORDER_STATE,
        '订单已关闭/已全额退款',
      );
    }
    const remaining = round4(
      toNum(order.pointsAmount) - toNum(order.refundedPointsAmount),
    );
    if (!(remaining > 0)) {
      throw new BusinessException(ErrorCode.ORDER_STATE, '该订单已全额退款');
    }
    const amount =
      input.amount === undefined ? remaining : round4(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '退款积分必须为正数');
    }
    if (amount > remaining) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `退款积分不得超过剩余可退 ${remaining} 积分`,
      );
    }
    await this.points.ensureAccount(order.userId);
    const remark = text(input.remark).trim().slice(0, 200);
    const result = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.servicePackageOrder.findUnique({
        where: { id: orderId },
      });
      if (!fresh)
        throw new BusinessException(ErrorCode.NOT_FOUND, '套餐订单不存在');
      if (fresh.status === 'REFUNDED' || fresh.fulfillmentStatus === 'CLOSED') {
        throw new BusinessException(
          ErrorCode.ORDER_STATE,
          '订单已关闭/已全额退款',
        );
      }
      const freshRemaining = round4(
        toNum(fresh.pointsAmount) - toNum(fresh.refundedPointsAmount),
      );
      if (!(freshRemaining > 0)) {
        throw new BusinessException(ErrorCode.ORDER_STATE, '该订单已全额退款');
      }
      if (amount > freshRemaining) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `订单剩余可退金额已变化（当前 ${freshRemaining} 积分），请刷新后重试`,
        );
      }
      const isFull = amount === freshRemaining;
      if (isFull) {
        const items = await tx.servicePackageOrderItem.findMany({
          where: { orderId },
          select: { contractId: true },
        });
        const contractIds = items
          .map((item) => item.contractId)
          .filter((id) => id > 0);
        const contracts = contractIds.length
          ? await tx.contract.findMany({
              where: { id: { in: contractIds } },
              select: { id: true, status: true },
            })
          : [];
        if (contracts.some((contract) => contract.status === 'ACTIVE')) {
          throw new BusinessException(
            ErrorCode.CONTRACT_STATE,
            '已有生效交付，不支持整单退款，请解约后线下处理',
          );
        }
        const pendingIds = contracts
          .filter((contract) => contract.status === 'PENDING')
          .map((contract) => contract.id);
        if (pendingIds.length) {
          // 整单退与订单关闭同事务撤销在途 Offer，避免关闭后仍残留待确认签约。
          await tx.contract.updateMany({
            where: { id: { in: pendingIds }, status: 'PENDING' },
            data: { status: 'TERMINATED' },
          });
        }
      }
      // 乐观锁：以读取到的累计已退金额为条件，双击/并发只有一次能改成功。
      const guard = await tx.servicePackageOrder.updateMany({
        where: {
          id: orderId,
          refundedPointsAmount: fresh.refundedPointsAmount,
        },
        data: {
          refundedPointsAmount: { increment: amount },
          status: isFull ? 'REFUNDED' : 'PARTIAL_REFUNDED',
          ...(isFull ? { fulfillmentStatus: 'CLOSED' } : {}),
        },
      });
      if (guard.count === 0) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '退款已被其他操作处理，请刷新后重试',
        );
      }
      const credit = await this.points.refundTx(tx, order.userId, amount, {
        scene: 'service_package_refund',
        refType: 'service_package',
        refId: order.orderNo,
        operator: operator.userId,
        remark:
          remark || `套餐${isFull ? '整单' : '部分'}退款 ${order.packageName}`,
      });
      await tx.servicePackageRefund.create({
        data: {
          orderId,
          amount,
          fullRefund: isFull,
          txId: credit.txId,
          operatorUserId: operator.userId,
          remark,
        },
      });
      // 审计与退款同事务：避免退款已提交但审计失败导致调用方重试再退一次。
      await this.identity.audit(
        operator.userId,
        isFull ? '套餐订单整单退款' : '套餐订单部分退款',
        `${fresh.orderNo}（${fresh.packageName}）退回 ${amount} 积分，累计已退 ${round4(
          toNum(fresh.refundedPointsAmount) + amount,
        )}`,
        tx,
      );
      return {
        isFull,
        totalRefunded: round4(toNum(fresh.refundedPointsAmount) + amount),
        remaining: round4(freshRemaining - amount),
        balance: credit.balance,
        status: isFull ? 'REFUNDED' : 'PARTIAL_REFUNDED',
        fulfillmentStatus: isFull ? 'CLOSED' : fresh.fulfillmentStatus,
      };
    });
    return { id: orderId, refunded: amount, ...result };
  }
}
