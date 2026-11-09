import type { PrismaService } from '../prisma/prisma.service';
import type { BillingRuleService } from '../points/billing-rule.service';
import type { PointsService } from '../points/points.service';
import { AiEvalService, AI_USAGE_CODE } from './ai-eval.service';
import { stub } from '../../test/doubles';

type Created = Record<string, unknown>;

function harness(rules: Array<Record<string, unknown>> = []) {
  const created: Created[] = [];
  const debits: Array<{ amount: number; scene: string }> = [];
  const prisma = stub<PrismaService>({
    usageEvent: {
      create: async ({ data }: { data: Created }) => {
        created.push(data);
        return data;
      },
      aggregate: async () => ({ _sum: { quantityAmount: 0 } }),
    },
    pointTransaction: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    pointAccount: { update: async () => undefined },
  });
  const billingRules = stub<BillingRuleService>({
    resolve: async () => rules,
  });
  const points = stub<PointsService>({
    debit: async (
      _u: string,
      _t: string,
      amount: number,
      opts: { scene: string },
    ) => {
      debits.push({ amount, scene: opts.scene });
      return { txId: 1, balance: 100 };
    },
    chargeSafely: async () => undefined,
  });
  return {
    service: new AiEvalService(prisma, billingRules, points),
    created,
    debits,
  };
}

const rule = (unitPrice: number) => ({
  metric: 'token_out' as const,
  baseFeeAmount: 0,
  unitPriceAmount: unitPrice,
  multiplier: 1,
  minChargeAmount: 0.01,
  maxChargeAmount: 0,
  freeQuotaMonthly: 0,
  budgetCapMonthly: 0,
});

describe('统一用量事实（AI 底座 §4.4）', () => {
  it('recordUsage 只落用量、不动积分，并带上板块/动作/模型/token', async () => {
    const { service, created, debits } = harness();
    await service.recordUsage(
      'u1',
      { tokenIn: 1200, tokenOut: 300, call: 1 },
      { module: 'seo', operation: 'audit_interpret', model: 'gpt-x' },
    );
    expect(debits).toHaveLength(0);
    expect(created[0]).toMatchObject({
      userId: 'u1',
      code: AI_USAGE_CODE,
      billed: 0,
      module: 'seo',
      operation: 'audit_interpret',
      model: 'gpt-x',
      tokenInAmount: 1200,
      tokenOutAmount: 300,
      pointsAmount: 0,
    });
  });

  it('chargeByUsage 扣分的同时把 token 与扣积分数写进同一条用量事实', async () => {
    const { service, created, debits } = harness([rule(0.02)]);
    const charged = await service.chargeByUsage(
      'u1',
      'kb_query',
      { tokenIn: 500, tokenOut: 100, call: 1 },
      'kb:1',
      { module: 'kb', operation: 'search', model: 'claude-y' },
    );
    expect(charged).toBe(2);
    expect(debits).toEqual([{ amount: 2, scene: 'kb_query' }]);
    expect(created[0]).toMatchObject({
      code: 'kb_query',
      billed: 1,
      module: 'kb',
      operation: 'search',
      model: 'claude-y',
      tokenInAmount: 500,
      tokenOutAmount: 100,
      pointsAmount: 2,
    });
  });

  it('科目在免费额内时记行不扣分', async () => {
    const { service, created, debits } = harness([
      { ...rule(1), freeQuotaMonthly: 100 },
    ]);
    const charged = await service.chargeByUsage(
      'u1',
      'seo_audit',
      { tokenIn: 10, tokenOut: 5, call: 1 },
      '',
      { module: 'seo' },
    );
    expect(charged).toBe(0);
    expect(debits).toHaveLength(0);
    expect(created[0]).toMatchObject({
      billed: 0,
      pointsAmount: 0,
      module: 'seo',
    });
  });

  it('缺密文/缺规则时回落按次包价，不重复计一次量', async () => {
    const { service, created, debits } = harness([]);
    expect(
      await service.chargeByUsage('u1', 'insight_report', { call: 1 }),
    ).toBe(0);
    expect(debits).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
});
