import type { CurrentUser } from '../auth/current-user';
import type { GapScopeService } from '../gaps/gaps.scope';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';
import { CardService } from './card.service';
import type { PointsService } from './points.service';
import type { PointsSettingsService } from './points-settings.service';
import type { WechatPayClient } from './wechat-pay.client';

/**
 * 每人持有限额：同一卡规格下兑换码 / 积分直兑 / 现金购买三入口合计计数，
 * 防止低价日卡兑换码被同一账号靠多张码囤积。0＝不限；只拦新兑换。
 */

const user = stub<CurrentUser>({ userId: 'u-1' });

const template = {
  id: 5,
  code: 'DAY-LOW',
  name: '低价日卡',
  provider: 'openai',
  modelKey: 'gpt-x',
  billingUnit: 'token',
  quotaTotal: 100_000,
  validDays: 1,
  pointsPrice: 100,
  cashCents: 990,
  perUserLimit: 2,
  status: 'ACTIVE',
};

function build(held: number, override: Record<string, unknown> = {}) {
  const templateRow = { ...template, ...override };
  const count = jest.fn(async () => held);
  const prisma = stub<PrismaService>({
    pointCardTemplate: {
      findUnique: jest.fn(async () => templateRow),
    },
    pointUserCard: { count },
  });
  const cards = new CardService(
    prisma,
    stub<PointsService>({}),
    stub<PointsSettingsService>({}),
    stub<WechatPayClient>({}),
    stub<GapScopeService>({}),
  );
  return { cards, prisma, count };
}

describe('CardService：每人持有限额', () => {
  it('按卡规格统计持有数，被撤销的卡不占名额', async () => {
    const { cards, count } = build(0);
    await cards.assertHoldLimit('u-1', template);
    expect(count).toHaveBeenCalledWith({
      where: {
        userId: 'u-1',
        templateCode: 'DAY-LOW',
        status: { not: 'REVOKED' },
      },
    });
  });

  it('持有数达到上限时拒绝，提示带上限与已持有数', async () => {
    const { cards } = build(2);
    await expect(cards.assertHoldLimit('u-1', template)).rejects.toThrow(
      '每位用户最多兑换 2 张',
    );
  });

  it('上限为 0 表示不限，不查库也不拦', async () => {
    const { cards, count } = build(99, { perUserLimit: 0 });
    await cards.assertHoldLimit('u-1', { ...template, perUserLimit: 0 });
    expect(count).not.toHaveBeenCalled();
  });

  it('兑换码发卡走同一额度校验：超限时连卡片都不创建', async () => {
    const { cards, prisma } = build(2);
    const create = jest.fn();
    Object.assign(prisma, { pointCardOrder: { create } });
    await expect(
      cards.issueForPromoCode('u-1', 'DAY-LOW', 'CODE-1'),
    ).rejects.toThrow('最多兑换 2 张');
    expect(create).not.toHaveBeenCalled();
  });

  it('积分直兑在扣积分之前就拒，避免扣了积分发不出卡', async () => {
    const { cards } = build(3);
    await expect(
      cards.exchangeByPoints(user, { templateCode: 'DAY-LOW' }),
    ).rejects.toThrow('最多兑换 2 张');
  });

  it('现金购买在下单前就拒，不会产生待支付订单', async () => {
    const { cards, prisma } = build(2);
    const create = jest.fn();
    Object.assign(prisma, { pointCardOrder: { create } });
    await expect(
      cards.createCashOrder(user, { templateCode: 'DAY-LOW' }),
    ).rejects.toThrow('最多兑换 2 张');
    expect(create).not.toHaveBeenCalled();
  });
});
