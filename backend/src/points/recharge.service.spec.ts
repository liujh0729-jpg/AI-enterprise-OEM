import type { PrismaService } from '../prisma/prisma.service';
import type { PointsService } from './points.service';
import type { PointsSettingsService } from './points-settings.service';
import { PointsService as RealPointsService } from './points.service';
import { RechargeService } from './recharge.service';
import type { WechatPayClient, WechatTransaction } from './wechat-pay.client';
import { stub } from '../../test/doubles';

/**
 * P1-9 充值可恢复结算：支付确认 / 本金 / 赠送 / 资格 四步各自幂等，
 * 回调中断后重入只补齐缺失步骤，绝不重复入账，也不「见到 PAID 就认定全部完成」（§12.6）。
 */

const SUCCESS: WechatTransaction = {
  out_trade_no: 'RP1',
  transaction_id: 'WX1',
  trade_state: 'SUCCESS',
};

function seedOrder(over: Record<string, unknown> = {}) {
  return {
    id: 9,
    orderNo: 'RP1',
    userId: 'u9',
    amountCents: 10000,
    rateAmount: 10,
    pointsAmount: 1000,
    bonusPointsAmount: 100,
    channel: 'WECHAT',
    status: 'CREATED',
    transactionId: null as string | null,
    notifyPayload: null,
    ...over,
  };
}

/** 用「已入账键集合」模拟 point_transactions 唯一约束下的幂等入账。 */
function creditDouble(applied: Set<string>) {
  return jest.fn(
    (
      _userId: string,
      type: string,
      amount: number,
      input: { idempotencyKey?: string } = {},
    ) => {
      const key = input.idempotencyKey ?? `${type}:${amount}`;
      if (applied.has(key)) {
        return Promise.resolve({ applied: false, balance: 0, txId: 0 });
      }
      applied.add(key);
      return Promise.resolve({ applied: true, balance: amount, txId: 1 });
    },
  );
}

function build(
  order: ReturnType<typeof seedOrder>,
  credit: ReturnType<typeof creditDouble>,
) {
  const prisma = {
    rechargeOrder: {
      findUnique: jest.fn(() => Promise.resolve({ ...order })),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { status?: { not?: string } };
          data: Record<string, unknown>;
        }) => {
          const hit = where.status?.not
            ? order.status !== where.status.not
            : true;
          if (hit) Object.assign(order, data);
          return Promise.resolve({ count: hit ? 1 : 0 });
        },
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(order, data);
        return Promise.resolve({ ...order });
      }),
      // 首充返奖的「此前已有 PAID 单」判定：返回 >0 直接跳过，聚焦结算四步本身。
      count: jest.fn(() => Promise.resolve(1)),
    },
  };
  const service = new RechargeService(
    stub<PrismaService>(prisma),
    stub<PointsSettingsService>({}),
    stub<PointsService>({ credit }),
    stub<WechatPayClient>({}),
  );
  return { service, prisma, order };
}

describe('RechargeService 可恢复结算（P1-9）', () => {
  it('首次成功：支付确认 + 本金 + 赠送 一次落齐', async () => {
    const order = seedOrder();
    const credit = creditDouble(new Set());
    const ctx = build(order, credit);

    const result = await ctx.service.settle(SUCCESS, '');

    expect(result).toMatchObject({
      status: 'PAID',
      pointsAmount: 1000,
      bonus: 100,
    });
    expect(result).not.toHaveProperty('duplicated');
    expect(ctx.order.status).toBe('PAID');
    expect(ctx.order.transactionId).toBe('WX1');
    const keys = credit.mock.calls.map(
      (call) => (call[3] as { idempotencyKey?: string }).idempotencyKey,
    );
    expect(keys).toEqual(['recharge:9:principal', 'recharge:9:bonus']);
  });

  it('支付已确认但入账中断：重入补齐缺失的赠送，不重复已入账的本金', async () => {
    const applied = new Set(['recharge:9:principal']);
    const order = seedOrder({ status: 'PAID', transactionId: 'WX1' });
    const credit = creditDouble(applied);
    const ctx = build(order, credit);

    const result = await ctx.service.settle(SUCCESS, '');

    // 支付确认不再命中（已 PAID），但缺的赠送被补齐，因此不算「完全重复」。
    expect(ctx.prisma.rechargeOrder.updateMany).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('duplicated');
    await expect(credit.mock.results[0].value).resolves.toMatchObject({
      applied: false,
    });
    await expect(credit.mock.results[1].value).resolves.toMatchObject({
      applied: true,
    });
    expect(applied.has('recharge:9:bonus')).toBe(true);
  });

  it('完全重复回调：四步皆已落账，标 duplicated 且不再入账', async () => {
    const applied = new Set(['recharge:9:principal', 'recharge:9:bonus']);
    const order = seedOrder({ status: 'PAID', transactionId: 'WX1' });
    const credit = creditDouble(applied);
    const ctx = build(order, credit);

    const result = await ctx.service.settle(SUCCESS, '');

    expect(result).toMatchObject({ status: 'PAID', duplicated: true });
  });

  it('已 PAID 的订单不被后到的非成功回调降级', async () => {
    const order = seedOrder({ status: 'PAID', transactionId: 'WX1' });
    const credit = creditDouble(new Set());
    const ctx = build(order, credit);

    const result = await ctx.service.settle(
      { out_trade_no: 'RP1', trade_state: 'CLOSED' },
      '',
    );

    expect(result).toMatchObject({
      status: 'NOT_SUCCESS',
      tradeState: 'CLOSED',
    });
    expect(ctx.order.status).toBe('PAID');
    expect(ctx.prisma.rechargeOrder.update).not.toHaveBeenCalled();
    expect(credit).not.toHaveBeenCalled();
  });
});

describe('PointsService 幂等入账（P1-9）', () => {
  function buildPoints(tx: object | Error) {
    const prisma = {
      pointAccount: {
        findUnique: jest.fn(() =>
          Promise.resolve({ userId: 'u1', balanceAmount: 50 }),
        ),
      },
      pointTransaction: {
        findFirst: jest.fn(() => Promise.resolve({ id: 3 })),
      },
      $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) =>
        tx instanceof Error ? Promise.reject(tx) : fn(tx),
      ),
    };
    return new RealPointsService(
      stub<PrismaService>(prisma),
      stub<PointsSettingsService>({}),
    );
  }

  it('带幂等键正常入账：返回 applied:true 并落一条流水', async () => {
    const tx = {
      pointAccount: {
        update: jest.fn(() => Promise.resolve({ balanceAmount: 150 })),
      },
      pointTransaction: {
        create: jest.fn(() => Promise.resolve({ id: 10 })),
      },
    };
    const service = buildPoints(tx);

    const res = await service.credit('u1', 'RECHARGE', 100, {
      idempotencyKey: 'recharge:9:principal',
    });

    expect(res).toMatchObject({ applied: true, balance: 150, txId: 10 });
  });

  it('带幂等键重复入账：唯一冲突按已入账返回，余额不变、不落第二条流水', async () => {
    const duplicate = Object.assign(new Error('unique'), { code: 'P2002' });
    const service = buildPoints(duplicate);

    const res = await service.credit('u1', 'RECHARGE', 100, {
      idempotencyKey: 'recharge:9:principal',
    });

    expect(res).toMatchObject({ applied: false, txId: 3 });
  });
});
