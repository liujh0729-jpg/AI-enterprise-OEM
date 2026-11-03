import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PointsSettingsService } from './points-settings.service';

/** 入账类型：与 point_transactions.type 注释一致。 */
export type CreditType =
  | 'RECHARGE'
  | 'RECHARGE_BONUS'
  | 'EARN'
  | 'TRANSFER_IN'
  | 'ADMIN_ADJUST';

export interface LedgerInput {
  scene?: string;
  counterparty?: string;
  refType?: string;
  refId?: string;
  operator?: string;
  remark?: string;
}

function dayStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/** 展示用：Decimal → number（保留 4 位足够积分）。 */
function toNum(v: Prisma.Decimal | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

/**
 * 积分总账：余额的任何增减都必须经过这里落一条 point_transactions 流水，
 * Σ流水 = 余额，全量可对账。扣费用 `updateMany({balance:{gte}})+decrement` 原子完成，
 * count=0 即余额不足（并发安全，无需行锁）。赚分/花分的具体数量都取自 PointsSettingsService。
 */
export class PointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PointsSettingsService,
  ) {}

  /** 取账户，不存在则建（余额 0）。 */
  async ensureAccount(userId: string) {
    const existing = await this.prisma.pointAccount.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    try {
      return await this.prisma.pointAccount.create({
        data: { userId },
      });
    } catch {
      // 并发创建撞 unique：回读即可
      return (await this.prisma.pointAccount.findUnique({ where: { userId } }))!;
    }
  }

  /** 入账（余额增加）。type 决定累加哪个统计列。 */
  async credit(
    userId: string,
    type: CreditType,
    amount: number,
    input: LedgerInput = {},
  ) {
    const value = Number(amount.toFixed(4));
    if (!(value > 0)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '入账积分必须为正数');
    }
    await this.ensureAccount(userId);
    const totalField =
      type === 'RECHARGE' || type === 'RECHARGE_BONUS'
        ? 'totalRechargeAmount'
        : 'totalEarnAmount';
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.pointAccount.update({
        where: { userId },
        data: {
          balanceAmount: { increment: value },
          [totalField]: { increment: value },
          // 有余额了：欠费状态回归正常（充值/入账即时解冻新增能力）
          ...(type === 'RECHARGE' || type === 'RECHARGE_BONUS'
            ? { status: 'ACTIVE', arrearsSince: null }
            : {}),
        },
      });
      const txRow = await tx.pointTransaction.create({
        data: {
          userId,
          type,
          scene: input.scene || '',
          amount: value,
          balanceAmount: account.balanceAmount,
          counterparty: input.counterparty || '',
          refType: input.refType || '',
          refId: input.refId || '',
          operator: input.operator || '',
          remark: (input.remark || '').slice(0, 500),
        },
      });
      return { balance: toNum(account.balanceAmount), txId: txRow.id };
    });
  }

  /**
   * 扣减（余额减少）：原子比较-扣减，余额不足抛 POINTS_INSUFFICIENT。
   * spendDailyCap>0 时先校验当日消费熔断上限。
   */
  async debit(
    userId: string,
    type: 'SPEND' | 'TRANSFER_OUT' | 'ADMIN_ADJUST',
    amount: number,
    input: LedgerInput = {},
  ) {
    const value = Number(amount.toFixed(4));
    if (!(value > 0)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '扣减积分必须为正数');
    }
    const cfg = await this.settings.view();
    if (cfg.spendDailyCap > 0) {
      const spentToday = await this.spendToday(userId);
      if (spentToday + value > cfg.spendDailyCap) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          `已触发单日消费上限（${cfg.spendDailyCap} 积分），请明天再试或联系管理员`,
        );
      }
    }
    await this.ensureAccount(userId);
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.pointAccount.updateMany({
        where: { userId, balanceAmount: { gte: value } },
        data: {
          balanceAmount: { decrement: value },
          totalSpendAmount: { increment: value },
        },
      });
      if (res.count === 0) {
        throw new BusinessException(ErrorCode.POINTS_INSUFFICIENT);
      }
      const account = await tx.pointAccount.findUnique({ where: { userId } });
      const txRow = await tx.pointTransaction.create({
        data: {
          userId,
          type,
          scene: input.scene || '',
          amount: -value,
          balanceAmount: account!.balanceAmount,
          counterparty: input.counterparty || '',
          refType: input.refType || '',
          refId: input.refId || '',
          operator: input.operator || '',
          remark: (input.remark || '').slice(0, 500),
        },
      });
      return { balance: toNum(account!.balanceAmount), txId: txRow.id };
    });
  }

  /** 当日已消费（含转出）绝对值合计，供熔断判断。 */
  private async spendToday(userId: string) {
    const agg = await this.prisma.pointTransaction.aggregate({
      where: { userId, type: { in: ['SPEND', 'TRANSFER_OUT'] }, createdAt: { gte: dayStart() } },
      _sum: { amount: true },
    });
    return Math.abs(toNum(agg._sum.amount));
  }

  /**
   * 赠送：邀请码或用户名解析对手方，双向原子流水。
   * 校验：转账开关、金额下限、当日笔数/额度上限、手续费率。
   */
  async transfer(
    fromUserId: string,
    identifier: string,
    amount: number,
  ) {
    const cfg = await this.settings.view();
    if (!cfg.transferEnabled) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '积分赠送功能已关闭');
    }
    const value = Number(amount.toFixed(4));
    if (!(value >= cfg.transferMin)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `单次赠送不得低于 ${cfg.transferMin} 积分`,
      );
    }
    const target = await this.resolveUser(identifier);
    if (!target) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '接收方不存在：请检查邀请码或用户名');
    }
    const toUserId = String(target.id);
    if (toUserId === fromUserId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能赠送给自己');
    }
    if (target.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.FORBIDDEN, '接收方账户状态异常，无法接收赠送');
    }
    // 当日赠送限额（笔数 + 总额）
    const since = dayStart();
    const todayOut = await this.prisma.pointTransaction.aggregate({
      where: { userId: fromUserId, type: 'TRANSFER_OUT', createdAt: { gte: since } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    if (cfg.transferDailyCount > 0 && todayOut._count._all >= cfg.transferDailyCount) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `今日赠送笔数已达上限（${cfg.transferDailyCount} 笔）`,
      );
    }
    if (
      cfg.transferDailyPoints > 0 &&
      Math.abs(toNum(todayOut._sum.amount)) + value > cfg.transferDailyPoints
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `今日赠送额度已达上限（${cfg.transferDailyPoints} 积分）`,
      );
    }
    const fee = Number(((value * cfg.transferFeePercent) / 100).toFixed(4));
    const received = Number((value - fee).toFixed(4));
    await this.ensureAccount(toUserId);
    // 先扣（原子、并发安全），成功后再入账，扣不成功不入账
    const out = await this.debit(fromUserId, 'TRANSFER_OUT', value, {
      scene: 'gift',
      counterparty: toUserId,
      remark: fee > 0 ? `赠送给 ${target.username}（含手续费 ${fee}）` : `赠送给 ${target.username}`,
    });
    const inRes = await this.credit(toUserId, 'TRANSFER_IN', received, {
      scene: 'gift',
      counterparty: fromUserId,
      remark: `收到积分赠送${fee > 0 ? `（手续费 ${fee}）` : ''}`,
    });
    return {
      sent: value,
      received,
      fee,
      fromBalance: out.balance,
      toBalance: inRes.balance,
      toUsername: target.username,
    };
  }

  /** 赠送对手方脱敏预览（输入邀请码/用户名 → 展示可接收的用户名）。 */
  async previewTransfer(identifier: string) {
    const cfg = await this.settings.view();
    if (!cfg.transferEnabled) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '积分赠送功能已关闭');
    }
    const target = await this.resolveUser(identifier);
    if (!target) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '接收方不存在：请检查邀请码或用户名');
    }
    return {
      exists: true,
      displayName: maskUsername(target.username),
      userId: String(target.id),
      transferMin: cfg.transferMin,
      feePercent: cfg.transferFeePercent,
    };
  }

  /** 按邀请码或用户名解析账户。 */
  private async resolveUser(identifier: string) {
    const key = identifier.trim();
    if (!key) return null;
    const byCode = await this.prisma.account.findFirst({
      where: { inviteCode: key.toUpperCase() },
    });
    if (byCode) return byCode;
    return this.prisma.account.findFirst({ where: { username: key } });
  }

  /**
   * 计费扣减入口：按 code 查 ModulePricing。
   * FREE 且未超月免费额→不扣；METERED→按 unitPrice×quantity 扣，低于 minCharge 起扣。
   * 落 usage_events（供日账单/趋势）；实时扣费记 billTxId。
   */
  async charge(
    userId: string,
    code: string,
    quantity: number,
    refId = '',
  ): Promise<{ charged: number; balance: number; skipped: boolean }> {
    const calc = await this.computeChargeable(userId, code, quantity);
    const pricing = calc.pricing;
    // 未配置或未启用：视为免费，不拦截业务
    if (!pricing || !pricing.enabled || calc.amount <= 0) {
      await this.prisma.usageEvent.create({
        data: { userId, code, quantityAmount: calc.qty, occurredAt: new Date(), billed: 0, remark: '免费额内/未计费' },
      });
      return { charged: 0, balance: toNum((await this.ensureAccount(userId)).balanceAmount), skipped: true };
    }
    const debit = await this.debit(userId, 'SPEND', calc.amount, {
      scene: code,
      refType: 'module',
      refId,
      remark: `${code} 消耗 ${calc.qty}${pricing.unit}×${toNum(pricing.unitPriceAmount)}`,
    });
    await this.prisma.usageEvent.create({
      data: {
        userId,
        code,
        quantityAmount: calc.qty,
        occurredAt: new Date(),
        billed: 1,
        billTxId: debit.txId,
        remark: `实时扣费 ${calc.amount}`,
      },
    });
    return { charged: calc.amount, balance: debit.balance, skipped: false };
  }

  /**
   * 计费计算共用口径：METERED 才扣；月免费额（freeQuotaAmount）按自然月已用量抵扣，
   * 只扣超出部分；低于 minCharge 起扣额按起扣。FREE / 未启用 / 额内都返回 amount=0。
   */
  private async computeChargeable(userId: string, code: string, quantity: number) {
    const pricing = await this.prisma.modulePricing.findUnique({ where: { code } });
    if (!pricing || !pricing.enabled) {
      return { pricing, amount: 0, qty: Number(quantity.toFixed(4)) };
    }
    const qty = Number(quantity.toFixed(4));
    const unitPrice = toNum(pricing.unitPriceAmount);
    if (pricing.mode !== 'METERED' || unitPrice <= 0) {
      return { pricing, amount: 0, qty };
    }
    let chargeQty = qty;
    const free = toNum(pricing.freeQuotaAmount);
    if (free > 0) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const used = await this.prisma.usageEvent.aggregate({
        where: { userId, code, occurredAt: { gte: monthStart } },
        _sum: { quantityAmount: true },
      });
      const remainingFree = Math.max(0, free - toNum(used._sum.quantityAmount));
      chargeQty = Math.max(0, Number((qty - remainingFree).toFixed(4)));
    }
    let amount = Number((unitPrice * chargeQty).toFixed(4));
    const minCharge = toNum(pricing.minChargeAmount);
    if (amount > 0 && amount < minCharge) amount = minCharge;
    return { pricing, amount, qty };
  }

  /** 预检（quote）：只读判断这笔消耗需要多少积分、余额够不够，不落库。 */
  async quote(userId: string, code: string, quantity: number) {
    const calc = await this.computeChargeable(userId, code, quantity);
    const account = await this.ensureAccount(userId);
    return {
      chargeable: calc.amount > 0,
      amount: calc.amount,
      balance: toNum(account.balanceAmount),
      sufficient: toNum(account.balanceAmount) >= calc.amount,
    };
  }

  /**
   * 模块实时扣费的统一入口（业务侧钩子用）：成功就扣，余额不足绝不把已完成
   * 的业务接口改成报错，只把账户转入欠费冻结态（宽限策略见日批）；其它异常静默。
   */
  async chargeSafely(userId: string, code: string, quantity: number, refId = ''): Promise<void> {
    try {
      await this.charge(userId, code, quantity, refId);
    } catch (error) {
      if (
        error instanceof BusinessException &&
        error.errorCode.code === ErrorCode.POINTS_INSUFFICIENT.code
      ) {
        await this.ensureAccount(userId);
        await this.prisma.pointAccount
          .update({
            where: { userId },
            data: { status: 'ARREARS', arrearsSince: new Date() },
          })
          .catch(() => undefined);
      }
      // 其它异常不阻断业务主流程
    }
  }

  /** 账户总览：余额 + 三项累计 + 状态。 */
  async summary(userId: string) {
    const account = await this.ensureAccount(userId);
    return {
      balance: toNum(account.balanceAmount),
      totalRecharge: toNum(account.totalRechargeAmount),
      totalEarn: toNum(account.totalEarnAmount),
      totalSpend: toNum(account.totalSpendAmount),
      status: account.status,
      arrearsSince: account.arrearsSince,
    };
  }

  /** 流水分页（用户/管理端共用），type/scene 可选过滤。 */
  async transactions(
    userId: string,
    opts: { page: number; size: number; type?: string; scene?: string },
  ) {
    const where: Prisma.PointTransactionWhereInput = { userId };
    if (opts.type) where.type = opts.type;
    if (opts.scene) where.scene = opts.scene;
    const [list, total] = await this.prisma.$transaction([
      this.prisma.pointTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.size,
        take: opts.size,
      }),
      this.prisma.pointTransaction.count({ where }),
    ]);
    return {
      total,
      page: opts.page,
      size: opts.size,
      list: list.map((row) => ({
        id: row.id,
        type: row.type,
        scene: row.scene,
        amount: toNum(row.amount),
        balanceAmount: toNum(row.balanceAmount),
        counterparty: row.counterparty,
        refType: row.refType,
        refId: row.refId,
        remark: row.remark,
        createdAt: row.createdAt,
      })),
    };
  }

  /** 注册赠分 + 邀请奖励：邀请人当日预算帽内发放，被邀请人拿 signupBonus。best-effort，调用方 try/catch。 */
  async grantOnRegister(newUserId: string, inviterId: number | null) {
    const cfg = await this.settings.view();
    const result: { signup: number; invite: number } = { signup: 0, invite: 0 };
    if (cfg.signupBonus > 0) {
      await this.credit(newUserId, 'EARN', cfg.signupBonus, {
        scene: 'register',
        remark: '新用户注册奖励',
      });
      result.signup = cfg.signupBonus;
    }
    if (inviterId && cfg.inviteRewardSignup > 0) {
      const grantedToday = await this.prisma.pointTransaction.count({
        where: {
          userId: String(inviterId),
          type: 'EARN',
          scene: 'invite',
          createdAt: { gte: dayStart() },
        },
      });
      const withinDailyInvite =
        cfg.inviteDailyCount <= 0 || grantedToday < cfg.inviteDailyCount;
      const withinBudget = await this.withinRewardBudget(cfg.inviteRewardSignup);
      if (withinDailyInvite && withinBudget) {
        await this.credit(String(inviterId), 'EARN', cfg.inviteRewardSignup, {
          scene: 'invite',
          counterparty: newUserId,
          refType: 'register',
          refId: newUserId,
          remark: '邀请好友注册奖励',
        });
        result.invite = cfg.inviteRewardSignup;
      }
    }
    return result;
  }

  /** 被邀请人首充返奖：按充值实付金额的百分比给邀请人（单人上限 + 全站日预算帽）。 */
  async grantOnFirstRecharge(
    inviterId: number,
    inviteeUserId: string,
    paidAmountPoints: number,
    orderId: string,
  ) {
    const cfg = await this.settings.view();
    if (cfg.inviteRechargePercent <= 0) return 0;
    // 该被邀请人是否已因首充给过邀请人奖励（防重复）
    const already = await this.prisma.pointTransaction.findFirst({
      where: {
        userId: String(inviterId),
        type: 'EARN',
        scene: 'invite',
        refType: 'first_recharge',
        refId: inviteeUserId,
      },
    });
    if (already) return 0;
    let reward = Number(((paidAmountPoints * cfg.inviteRechargePercent) / 100).toFixed(4));
    if (cfg.inviteRechargeCap > 0) reward = Math.min(reward, cfg.inviteRechargeCap);
    if (reward <= 0) return 0;
    if (!(await this.withinRewardBudget(reward))) return 0;
    await this.credit(String(inviterId), 'EARN', reward, {
      scene: 'invite',
      counterparty: inviteeUserId,
      refType: 'first_recharge',
      refId: inviteeUserId,
      remark: `好友首充奖励（订单 ${orderId}）`,
    });
    return reward;
  }

  /** 全站奖励日预算帽：当日 EARN 总额 + 本次 ≤ cap（cap=0 不限）。 */
  private async withinRewardBudget(amount: number) {
    const cfg = await this.settings.view();
    if (cfg.rewardDailyCap <= 0) return true;
    const agg = await this.prisma.pointTransaction.aggregate({
      where: { type: 'EARN', createdAt: { gte: dayStart() } },
      _sum: { amount: true },
    });
    return toNum(agg._sum.amount) + amount <= cfg.rewardDailyCap;
  }

  /** 管理员手动调整：正数入账、负数扣减，记 operator。 */
  async adminAdjust(
    operatorId: string,
    userId: string,
    delta: number,
    remark: string,
  ) {
    const value = Number(delta.toFixed(4));
    if (value === 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '调整数量不能为 0');
    }
    if (value > 0) {
      return this.credit(userId, 'ADMIN_ADJUST', value, {
        scene: 'admin',
        operator: operatorId,
        remark: remark || '管理员调整',
      });
    }
    return this.debit(userId, 'ADMIN_ADJUST', Math.abs(value), {
      scene: 'admin',
      operator: operatorId,
      remark: remark || '管理员调整',
    });
  }

  /** 管理端账户查询（可按用户名/邀请码过滤后取账户与余额）。 */
  async adminFindAccounts(keyword: string, page: number, size: number) {
    const key = keyword.trim();
    const userWhere = key
      ? {
          OR: [
            { username: { contains: key } },
            { inviteCode: { equals: key.toUpperCase() } },
          ],
        }
      : {};
    const matchedUsers = key
      ? await this.prisma.account.findMany({
          where: userWhere,
          select: { id: true },
        })
      : [];
    if (key && !matchedUsers.length) {
      return { list: [], total: 0 };
    }
    const [accounts, total] = await this.prisma.$transaction([
      this.prisma.pointAccount.findMany({
        where: key ? { userId: { in: matchedUsers.map((u) => String(u.id)) } } : {},
        orderBy: { balanceAmount: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.pointAccount.count({
        where: key ? { userId: { in: matchedUsers.map((u) => String(u.id)) } } : {},
      }),
    ]);
    const ids = accounts.map((a) => a.userId);
    const users = await this.prisma.account.findMany({
      where: { id: { in: ids.map((id) => Number(id)) } },
      select: { id: true, username: true, inviteCode: true },
    });
    const nameMap = new Map(users.map((u) => [String(u.id), u]));
    return {
      list: accounts.map((a) => ({
        userId: a.userId,
        username: nameMap.get(a.userId)?.username || '',
        inviteCode: nameMap.get(a.userId)?.inviteCode || '',
        balance: toNum(a.balanceAmount),
        totalRecharge: toNum(a.totalRechargeAmount),
        totalEarn: toNum(a.totalEarnAmount),
        totalSpend: toNum(a.totalSpendAmount),
        status: a.status,
      })),
      total,
    };
  }
}

function maskUsername(username: string): string {
  if (username.length <= 2) return `${username[0] || ''}*`;
  return `${username[0]}${'*'.repeat(Math.min(username.length - 2, 6))}${username[username.length - 1]}`;
}
