import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  BillingRuleService,
  type BillingMetric,
} from '../points/billing-rule.service';
import { PointsService } from '../points/points.service';

/** 用量维度（§5.12 计量来源：LLM usage / 调用次数 / 字节 / 页数）。 */
export interface UsageQuantities {
  tokenIn?: number;
  tokenOut?: number;
  call?: number;
  byte?: number;
  page?: number;
}

/** 用量事实的归属维度（AI 底座方案 §4.4）：哪个板块、哪个动作、走的哪个模型。 */
export interface UsageMeta {
  module?: string;
  operation?: string;
  model?: string;
}

/** 未配科目时的用量归集 code：只记用量、不扣分，用量页据此统计「AI 调用总次数」。 */
export const AI_USAGE_CODE = 'ai_call';

function metaOf(meta?: UsageMeta): {
  module: string;
  operation: string;
  model: string;
} {
  return {
    module: String(meta?.module || 'ai').slice(0, 32),
    operation: String(meta?.operation || 'chat').slice(0, 64),
    model: String(meta?.model || '').slice(0, 128),
  };
}

function quantitiesOf(usage: UsageQuantities) {
  return {
    tokenInAmount: Math.max(0, usage.tokenIn ?? 0),
    tokenOutAmount: Math.max(0, usage.tokenOut ?? 0),
  };
}

const METRIC_LABELS: Record<BillingMetric, string> = {
  token_in: '输入token',
  token_out: '输出token',
  call: '次数',
  byte: '字节',
  page: '页',
};

function metricUsage(metric: BillingMetric, usage: UsageQuantities): number {
  switch (metric) {
    case 'token_in':
      return Math.max(0, usage.tokenIn ?? 0);
    case 'token_out':
      return Math.max(0, usage.tokenOut ?? 0);
    case 'byte':
      return Math.max(0, usage.byte ?? 0);
    case 'page':
      return Math.max(0, usage.page ?? 0);
    default:
      return Math.max(0, usage.call ?? 1);
  }
}

/**
 * AI 统一计费收口（§5.12 / 积分方案 §8.5）：所有 ai-eval 链路（技能审查、L1 知识库、
 * L2 洞察、L3 技能/代投）出结果后调 chargeByUsage，按 BillingRule 公式扣分：
 *   扣分 = ΣbaseFee + Σ(用量 × unitPrice × multiplier)，夹 minCharge/maxCharge，
 *   受月免费额（按次数）与 budgetCapMonthly 熔断约束。
 * 口径：只计实际 usage、失败不计费（调用方仅在成功出结果后计费）；余额不足转欠费不回滚业务
 * （与 PointsService.chargeSafely 同口径）；无 BillingRule 行时回落 ModulePricing 按次链路，
 * 两条路径互斥、绝不双扣。
 */
export class AiEvalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingRules: BillingRuleService,
    private readonly points: PointsService,
  ) {}

  async chargeByUsage(
    userId: string,
    code: string,
    usage: UsageQuantities,
    refId = '',
    meta?: UsageMeta,
  ): Promise<number> {
    const rules = await this.billingRules.resolve(code, userId);
    if (!rules.length) {
      // 无规则行：回落 ModulePricing 按次包价（老科目不受影响；两条路径互斥）
      await this.points
        .chargeSafely(userId, code, usage.call ?? 1, refId)
        .catch(() => undefined);
      return 0;
    }
    const callQty = Math.max(0, usage.call ?? 1);
    let amount = 0;
    const detail: string[] = [];
    for (const rule of rules) {
      amount += Number(rule.baseFeeAmount);
      const qty = metricUsage(rule.metric, usage);
      const part = qty * Number(rule.unitPriceAmount) * Number(rule.multiplier);
      if (qty > 0 && Number.isFinite(part) && part > 0) {
        amount += part;
        detail.push(
          `${METRIC_LABELS[rule.metric]} ${qty}×${rule.unitPriceAmount}×${rule.multiplier}`,
        );
      }
    }
    amount = Number(amount.toFixed(4));
    if (amount > 0) {
      const minCharge = Math.max(
        ...rules.map((r) => Number(r.minChargeAmount)),
        0,
      );
      const maxCharge = Math.max(
        ...rules.map((r) => Number(r.maxChargeAmount)),
        0,
      );
      if (amount < minCharge) amount = minCharge;
      if (maxCharge > 0 && amount > maxCharge) amount = maxCharge;
    }

    // 月免费额按「次」计：本批次数完全在剩余免费额内则全免，跨界部分足额计费（L0 从简口径）
    const free = Math.max(...rules.map((r) => Number(r.freeQuotaMonthly)), 0);
    let freeUsed = 0;
    if (free > 0) {
      const monthStart = this.monthStart();
      const used = await this.prisma.usageEvent.aggregate({
        where: { userId, code, occurredAt: { gte: monthStart } },
        _sum: { quantityAmount: true },
      });
      freeUsed = Number(used._sum.quantityAmount ?? 0);
      if (freeUsed + callQty <= free) amount = 0;
    }

    // 预算帽熔断：本月该科目已扣 + 本笔 > cap → 本笔不计费（防刷分，业务照常）
    const cap = Math.max(...rules.map((r) => Number(r.budgetCapMonthly)), 0);
    if (cap > 0 && amount > 0) {
      const spent = await this.monthSpent(userId, code);
      if (spent + amount > cap) amount = 0;
    }

    if (amount <= 0) {
      await this.prisma.usageEvent
        .create({
          data: {
            userId,
            code,
            quantityAmount: Number(callQty.toFixed(4)),
            occurredAt: new Date(),
            billed: 0,
            remark: detail.length
              ? `免费额内/预算帽熔断：${detail.join(' + ')}`.slice(0, 190)
              : '用量计 0，不扣分',
            ...metaOf(meta),
            ...quantitiesOf(usage),
            pointsAmount: 0,
          },
        })
        .catch(() => undefined);
      return 0;
    }

    try {
      const debit = await this.points.debit(userId, 'SPEND', amount, {
        scene: code,
        refType: 'module',
        refId,
        remark: `${code} 用量计费 ${detail.join(' + ') || '基础费'}`.slice(
          0,
          190,
        ),
      });
      await this.prisma.usageEvent.create({
        data: {
          userId,
          code,
          quantityAmount: Number(callQty.toFixed(4)),
          occurredAt: new Date(),
          billed: 1,
          billTxId: debit.txId,
          remark: `实时扣费 ${amount}（${detail.join(' + ') || 'baseFee'}）`,
          ...metaOf(meta),
          ...quantitiesOf(usage),
          pointsAmount: amount,
        },
      });
      return amount;
    } catch (error) {
      if (
        error instanceof BusinessException &&
        error.errorCode.code === ErrorCode.POINTS_INSUFFICIENT.code
      ) {
        // 与 chargeSafely 同口径：余额不足转欠费，不影响已完成的 AI 调用
        await this.prisma.pointAccount
          .update({
            where: { userId },
            data: { status: 'ARREARS', arrearsSince: new Date() },
          })
          .catch(() => undefined);
        return 0;
      }
      return 0;
    }
  }

  /**
   * 只落用量事实、不扣分（网关无科目调用走这条，§4.4「一笔模型调用在用量页可见」）。
   * 与 chargeByUsage 的区别只在是否动积分；同一张表、同一套维度，用量页不用拼两处数据。
   */
  async recordUsage(
    userId: string,
    usage: UsageQuantities,
    meta?: UsageMeta,
  ): Promise<void> {
    const dims = metaOf(meta);
    await this.prisma.usageEvent
      .create({
        data: {
          userId,
          code: AI_USAGE_CODE,
          quantityAmount: Number(Math.max(0, usage.call ?? 1).toFixed(4)),
          occurredAt: new Date(),
          billed: 0,
          remark: `${dims.module}/${dims.operation}`.slice(0, 200),
          ...dims,
          ...quantitiesOf(usage),
          pointsAmount: 0,
        },
      })
      .catch(() => undefined);
  }

  /** 预估（调用前展示「约 X 分」）：与 chargeByUsage 同公式，只读不落库。 */
  async quoteByUsage(
    userId: string,
    code: string,
    usage: UsageQuantities,
  ): Promise<number> {
    const rules = await this.billingRules.resolve(code, userId);
    if (!rules.length) return 0;
    let amount = 0;
    for (const rule of rules) {
      amount +=
        Number(rule.baseFeeAmount) +
        metricUsage(rule.metric, usage) *
          Number(rule.unitPriceAmount) *
          Number(rule.multiplier);
    }
    return Number(amount.toFixed(4));
  }

  private monthStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /** 本月该科目已扣积分（流水 SPEND 金额为负数，取绝对值累计）。 */
  private async monthSpent(userId: string, code: string): Promise<number> {
    const agg = await this.prisma.pointTransaction.aggregate({
      where: {
        userId,
        type: 'SPEND',
        scene: code,
        createdAt: { gte: this.monthStart() },
      },
      _sum: { amount: true },
    });
    return Math.abs(Number(agg._sum.amount ?? 0));
  }
}
