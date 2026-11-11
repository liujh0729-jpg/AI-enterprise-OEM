import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { allocateNo } from '../common/document-number';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PointsSettingsService } from './points-settings.service';
import { PointsService } from './points.service';
import { WechatPayClient, type WechatTransaction } from './wechat-pay.client';

function toNum(v: Prisma.Decimal | number | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v);
}

/** 分 → 元 → 积分：按建单时锁定的汇率折算，保留 4 位。 */
function centsToPoints(cents: number, rate: number) {
  return Number(((cents / 100) * rate).toFixed(4));
}

/** Prisma 唯一约束冲突（P2002）：并发/重复回调走「已确认」而非报错。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * 微信充值链路：建单锁汇率与档位赠送 → Native/H5 下单 → 回调验签幂等入账 → 查单兜底。
 * 幂等键＝微信 transaction_id（RechargeOrder.transactionId 唯一索引）；重复回调第二次直接吞掉返回成功。
 */
export class RechargeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PointsSettingsService,
    private readonly points: PointsService,
    private readonly pay: WechatPayClient,
  ) {}

  /** 用户下单：amountCents 或按档位 recharge_tier_index 二选一。 */
  async createOrder(
    userId: string,
    input: {
      amountCents?: number;
      tierIndex?: number;
      channel: 'NATIVE' | 'H5';
      clientIp?: string;
    },
  ) {
    const cfg = await this.settings.view();
    if (!cfg.wechatConfigured) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信支付尚未配置，请联系管理员',
      );
    }
    let cents = input.amountCents;
    if (input.tierIndex !== undefined) {
      const tier = cfg.rechargeTiers[input.tierIndex];
      if (!tier)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '充值档位不存在');
      cents = tier.cents;
    }
    if (!cents || !Number.isInteger(cents) || cents < cfg.rechargeMinCents) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `充值金额不得低于 ${cfg.rechargeMinCents / 100} 元`,
      );
    }
    // 命中档位赠送（金额完全等于某档才赠）
    const tier = cfg.rechargeTiers.find((t) => t.cents === cents);
    const bonusPercent = tier ? tier.bonusPercent : 0;
    const pointsAmount = centsToPoints(cents, cfg.rate);
    const bonusPointsAmount = Number(
      ((pointsAmount * bonusPercent) / 100).toFixed(4),
    );

    const orderNo = await allocateNo(this.prisma, 'RP');
    const order = await this.prisma.rechargeOrder.create({
      data: {
        orderNo,
        userId,
        amountCents: cents,
        rateAmount: cfg.rate,
        pointsAmount,
        bonusPointsAmount,
        channel: 'WECHAT',
        status: 'CREATED',
      },
    });

    const credentials = await this.settings.wechatCredentials();
    const notifyUrl = credentials.notifyUrl || cfg.wechatNotifyUrl;
    if (!notifyUrl) {
      await this.prisma.rechargeOrder.update({
        where: { id: order.id },
        data: { status: 'FAILED' },
      });
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信支付回调地址未配置',
      );
    }
    const description = `积分充值 ${pointsAmount}分`;
    let codeUrl = '';
    let h5Url = '';
    try {
      if (input.channel === 'H5') {
        h5Url = await this.pay.h5(credentials, {
          outTradeNo: orderNo,
          description,
          amountCents: cents,
          notifyUrl,
          clientIp: input.clientIp || '127.0.0.1',
        });
      } else {
        codeUrl = await this.pay.native(credentials, {
          outTradeNo: orderNo,
          description,
          amountCents: cents,
          notifyUrl,
        });
      }
    } catch (error) {
      await this.prisma.rechargeOrder.update({
        where: { id: order.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
    await this.prisma.rechargeOrder.update({
      where: { id: order.id },
      data: { codeUrl: codeUrl || h5Url },
    });
    return {
      orderNo,
      amountCents: cents,
      pointsAmount,
      bonusPointsAmount,
      rate: cfg.rate,
      channel: input.channel,
      codeUrl,
      h5Url,
    };
  }

  /**
   * 回调处理：验签解密得到交易，命中 SUCCESS 才结算。
   * 幂等：先按 orderNo 取单，已 PAID 直接返回；入账时 transactionId 唯一约束兜底并发。
   */
  async handleNotify(rawBody: string, headers: Record<string, string>) {
    const credentials = await this.settings.wechatCredentials();
    if (!credentials.configured) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信支付未配置',
      );
    }
    const txn = await this.pay.parseNotify(credentials, headers, rawBody);
    return this.settle(txn, rawBody);
  }

  /**
   * 结算：把微信成功交易落到本地单并入账，是一个**可恢复、可对账**的过程（§12.6）。
   *
   * 步骤：① 支付确认（订单置 PAID）② 本金入账 ③ 赠送入账 ④ 资格生效。
   * 每一步都幂等——支付确认靠 `updateMany({status:{not:'PAID'}})` 与 transactionId 唯一约束；
   * 本金/赠送靠 point_transactions.idempotency_key 唯一约束。因此回调中断后重入（微信重试、
   * 主动查单、关单兜底）只补齐缺失的步骤：既不重复入账，也不会「见到 PAID 就认定全部完成」。
   * 资格＝本金入账的即时副作用（账户转 ACTIVE、累计充值>0），随本金步骤可重入补齐。
   * 可被回调与主动查单复用。
   */
  async settle(txn: WechatTransaction, rawPayload: string) {
    const outTradeNo = String(txn.out_trade_no || '');
    if (!outTradeNo)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '回调缺少商户订单号');
    const order = await this.prisma.rechargeOrder.findUnique({
      where: { orderNo: outTradeNo },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '充值订单不存在');
    if (txn.trade_state !== 'SUCCESS') {
      // 已 PAID 的单绝不被后到的失败/关单回调降级。
      if (order.status !== 'PAID') {
        await this.prisma.rechargeOrder.update({
          where: { id: order.id },
          data: { status: txn.trade_state === 'CLOSED' ? 'CLOSED' : 'FAILED' },
        });
      }
      return {
        orderNo: outTradeNo,
        status: 'NOT_SUCCESS',
        tradeState: txn.trade_state,
      };
    }
    const transactionId = String(txn.transaction_id || '');
    if (!transactionId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '回调缺少微信交易号');
    }
    // ① 支付确认：仅在未 PAID 时置位；并发重复回调撞 transactionId 唯一约束同样视为已确认。
    let confirmed = false;
    try {
      const paid = await this.prisma.rechargeOrder.updateMany({
        where: { id: order.id, status: { not: 'PAID' } },
        data: {
          status: 'PAID',
          transactionId,
          paidAt: new Date(),
          notifyPayload: (rawPayload
            ? JSON.parse(rawPayload)
            : {}) as Prisma.InputJsonValue,
        },
      });
      confirmed = paid.count > 0;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    // ② 本金 / ③ 赠送：按订单幂等入账（键唯一）；重入时只补齐缺失的那一步。
    const pointsAmount = toNum(order.pointsAmount);
    const bonus = toNum(order.bonusPointsAmount);
    const principal =
      pointsAmount > 0
        ? await this.points.credit(order.userId, 'RECHARGE', pointsAmount, {
            scene: 'recharge',
            refType: 'recharge_order',
            refId: String(order.id),
            remark: `微信充值 ${order.amountCents / 100} 元`,
            idempotencyKey: `recharge:${order.id}:principal`,
          })
        : { applied: false };
    const bonusCredited =
      bonus > 0
        ? await this.points.credit(order.userId, 'RECHARGE_BONUS', bonus, {
            scene: 'recharge_bonus',
            refType: 'recharge_order',
            refId: String(order.id),
            remark: '充值档位赠送',
            idempotencyKey: `recharge:${order.id}:bonus`,
          })
        : { applied: false };
    // ④ 资格生效：本金入账已把账户置 ACTIVE、累计充值>0（§12「完成充值」口径），幂等后不重复。
    // 被邀请人首充返奖给邀请人（自身幂等：按 first_recharge 流水去重）。
    await this.grantInviterFirstRecharge(order);
    const duplicated =
      !confirmed && !principal.applied && !bonusCredited.applied;
    return {
      orderNo: outTradeNo,
      status: 'PAID',
      pointsAmount,
      bonus,
      ...(duplicated ? { duplicated: true } : {}),
    };
  }

  /** 首充判定：该用户此前无 PAID 单，则给其邀请人返奖。 */
  private async grantInviterFirstRecharge(order: {
    id: number;
    userId: string;
    pointsAmount: Prisma.Decimal;
  }) {
    const prior = await this.prisma.rechargeOrder.count({
      where: { userId: order.userId, status: 'PAID', id: { not: order.id } },
    });
    if (prior > 0) return;
    const account = await this.prisma.account.findUnique({
      where: { id: Number(order.userId) },
      select: { invitedBy: true },
    });
    if (!account?.invitedBy) return;
    await this.points
      .grantOnFirstRecharge(
        account.invitedBy,
        order.userId,
        toNum(order.pointsAmount),
        String(order.id),
      )
      .catch(() => undefined);
  }

  /** 前端轮询：本地状态；仍 CREATED 时主动查一次上游兜底（回调丢失场景）。 */
  async query(userId: string, orderNo: string) {
    const order = await this.prisma.rechargeOrder.findFirst({
      where: { orderNo, userId },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '充值订单不存在');
    if (order.status === 'CREATED') {
      const credentials = await this.settings.wechatCredentials();
      if (credentials.configured) {
        try {
          const txn = await this.pay.query(credentials, orderNo);
          if (txn.trade_state === 'SUCCESS') {
            await this.settle(txn, JSON.stringify(txn));
          } else if (
            ['CLOSED', 'REVOKED', 'PAYERROR'].includes(String(txn.trade_state))
          ) {
            await this.prisma.rechargeOrder.update({
              where: { id: order.id },
              data: { status: 'CLOSED' },
            });
          }
        } catch {
          // 查单失败不阻断，保持 CREATED 让前端继续轮询
        }
      }
    }
    const fresh = await this.prisma.rechargeOrder.findUnique({
      where: { id: order.id },
    });
    return {
      orderNo,
      status: fresh?.status || order.status,
      amountCents: order.amountCents,
      pointsAmount: toNum(order.pointsAmount),
      bonusPointsAmount: toNum(order.bonusPointsAmount),
      paidAt: fresh?.paidAt || null,
    };
  }

  /** 我的充值订单列表。 */
  async listOrders(userId: string, page: number, size: number) {
    const [list, total] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.rechargeOrder.count({ where: { userId } }),
    ]);
    return {
      total,
      page,
      size,
      list: list.map((row) => ({
        orderNo: row.orderNo,
        amountCents: row.amountCents,
        pointsAmount: toNum(row.pointsAmount),
        bonusPointsAmount: toNum(row.bonusPointsAmount),
        status: row.status,
        channel: row.channel,
        createdAt: row.createdAt,
        paidAt: row.paidAt,
      })),
    };
  }

  /** 管理端订单列表（可按状态/用户过滤）。 */
  async adminListOrders(opts: {
    status?: string;
    keyword?: string;
    page: number;
    size: number;
  }) {
    const where: Prisma.RechargeOrderWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.keyword) {
      const users = await this.prisma.account.findMany({
        where: {
          OR: [
            { username: { contains: opts.keyword } },
            { inviteCode: { equals: opts.keyword.toUpperCase() } },
          ],
        },
        select: { id: true },
      });
      where.userId = {
        in: users.length ? users.map((u) => String(u.id)) : ['-1'],
      };
    }
    const [list, total] = await this.prisma.$transaction([
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.size,
        take: opts.size,
      }),
      this.prisma.rechargeOrder.count({ where }),
    ]);
    const userIds = [...new Set(list.map((r) => Number(r.userId)))];
    const users = await this.prisma.account.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true },
    });
    const nameMap = new Map(users.map((u) => [String(u.id), u.username]));
    return {
      total,
      page: opts.page,
      size: opts.size,
      list: list.map((row) => ({
        orderNo: row.orderNo,
        userId: row.userId,
        username: nameMap.get(row.userId) || '',
        amountCents: row.amountCents,
        pointsAmount: toNum(row.pointsAmount),
        bonusPointsAmount: toNum(row.bonusPointsAmount),
        status: row.status,
        transactionId: row.transactionId || '',
        createdAt: row.createdAt,
        paidAt: row.paidAt,
      })),
    };
  }

  /** 关闭超时未支付订单（调度器调用）：超过 2 小时仍 CREATED 的单，向微信关单并本地置 CLOSED。 */
  async closeExpired(olderThan: Date) {
    const stale = await this.prisma.rechargeOrder.findMany({
      where: { status: 'CREATED', createdAt: { lt: olderThan } },
      take: 200,
    });
    const credentials = await this.settings.wechatCredentials();
    let closed = 0;
    for (const order of stale) {
      if (credentials.configured) {
        try {
          const txn = await this.pay.query(credentials, order.orderNo);
          if (txn.trade_state === 'SUCCESS') {
            await this.settle(txn, JSON.stringify(txn));
            continue;
          }
          await this.pay.close(credentials, order.orderNo);
        } catch {
          // 关单失败下轮再试
        }
      }
      await this.prisma.rechargeOrder.update({
        where: { id: order.id },
        data: { status: 'CLOSED' },
      });
      closed += 1;
    }
    return closed;
  }

  /** 测试微信配置连通性（拉平台证书）。 */
  async testConnection() {
    const credentials = await this.settings.wechatCredentials();
    if (!credentials.configured) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先完整填写微信支付五项配置',
      );
    }
    return this.pay.testConnection(credentials);
  }
}
