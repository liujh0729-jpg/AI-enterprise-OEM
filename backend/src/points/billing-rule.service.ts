import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

const METRICS = ['token_in', 'token_out', 'call', 'byte', 'page'] as const;
export type BillingMetric = (typeof METRICS)[number];

/** 规则视图（契约 billingRuleSchema 同形：金额一律字符串，防精度歧义）。 */
export interface BillingRuleView {
  id: number;
  code: string;
  scope: 'PLATFORM' | 'ORG' | 'PLAN';
  orgUserId: string;
  metric: BillingMetric;
  unitPriceAmount: string;
  baseFeeAmount: string;
  multiplier: string;
  minChargeAmount: string;
  maxChargeAmount: string;
  budgetCapMonthly: string;
  freeQuotaMonthly: string;
  enabled: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface BillingRuleInput {
  code: string;
  scope?: 'PLATFORM' | 'ORG' | 'PLAN';
  orgUserId?: string;
  metric: BillingMetric;
  unitPriceAmount?: number;
  baseFeeAmount?: number;
  multiplier?: number;
  minChargeAmount?: number;
  maxChargeAmount?: number;
  budgetCapMonthly?: number;
  freeQuotaMonthly?: number;
  enabled?: boolean;
}

function toView(row: {
  id: number;
  code: string;
  scope: string;
  orgUserId: string;
  metric: string;
  unitPriceAmount: Prisma.Decimal;
  baseFeeAmount: Prisma.Decimal;
  multiplier: Prisma.Decimal;
  minChargeAmount: Prisma.Decimal;
  maxChargeAmount: Prisma.Decimal;
  budgetCapMonthly: Prisma.Decimal;
  freeQuotaMonthly: Prisma.Decimal;
  enabled: number;
  version: number;
  updatedBy: string;
  updatedAt: Date;
}): BillingRuleView {
  return {
    id: row.id,
    code: row.code,
    scope: row.scope as BillingRuleView['scope'],
    orgUserId: row.orgUserId,
    metric: row.metric as BillingMetric,
    unitPriceAmount: row.unitPriceAmount.toString(),
    baseFeeAmount: row.baseFeeAmount.toString(),
    multiplier: row.multiplier.toString(),
    minChargeAmount: row.minChargeAmount.toString(),
    maxChargeAmount: row.maxChargeAmount.toString(),
    budgetCapMonthly: row.budgetCapMonthly.toString(),
    freeQuotaMonthly: row.freeQuotaMonthly.toString(),
    enabled: row.enabled === 1,
    version: row.version,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Agent 按用量计费规则（§5.12）：扣分 = baseFee + Σ(用量 × unitPrice × multiplier)，
 * 受 minCharge/maxCharge/budgetCapMonthly/freeQuotaMonthly 约束；解析优先级 PLAN>ORG>PLATFORM。
 * 行模型与 ModulePricing 并存：ModulePricing 继续做现有「按次包价」，BillingRule 做「按用量维度」复合计价，
 * ai-eval 收口（l0-billing）时同一 UsageEvent 只走一条路径，避免重复扣分。
 */
export class BillingRuleService {
  constructor(private readonly prisma: PrismaService) {}

  private cached: { at: number; rows: BillingRuleView[] } | null = null;

  /**
   * 一体化 AI 科目默认价（积分方案 §8.4，1 元=10 积分）：
   * 单价与月免费额逐项对齐方案默认值；管理员改价走 upsert，种子只补缺行、不覆盖。
   * kb_consolidate 是知识库内部记忆提炼科目，方案未单列，保留现有默认值。
   */
  private static readonly AI_SUBJECT_SEEDS: Array<{
    code: string;
    unitPrice: number;
    freeQuota: number;
  }> = [
    { code: 'insight_report', unitPrice: 2, freeQuota: 100 },
    { code: 'hrm_resume_score', unitPrice: 1, freeQuota: 200 },
    { code: 'jd_generate', unitPrice: 1, freeQuota: 50 },
    { code: 'kb_ingest', unitPrice: 0.5, freeQuota: 500 },
    { code: 'kb_query', unitPrice: 1, freeQuota: 200 },
    { code: 'kb_lint', unitPrice: 2, freeQuota: 50 },
    { code: 'kb_consolidate', unitPrice: 1, freeQuota: 50 },
    { code: 'mkt_skill_run', unitPrice: 3, freeQuota: 100 },
    { code: 'mkt_skill_eval', unitPrice: 1, freeQuota: 50 },
    { code: 'recruit_job_eval', unitPrice: 0.2, freeQuota: 200 },
    { code: 'recruit_resume_tailor', unitPrice: 2, freeQuota: 100 },
    { code: 'skill_review', unitPrice: 1, freeQuota: 20 },
    { code: 'seo_audit_ai', unitPrice: 2, freeQuota: 100 },
    { code: 'seo_keyword_ai', unitPrice: 1, freeQuota: 200 },
    { code: 'seo_competitor_ai', unitPrice: 2, freeQuota: 100 },
    { code: 'seo_schema_ai', unitPrice: 1, freeQuota: 100 },
    { code: 'seo_report_ai', unitPrice: 2, freeQuota: 50 },
    { code: 'seo_outreach_ai', unitPrice: 1, freeQuota: 100 },
    { code: 'seo_programmatic_ai', unitPrice: 0.5, freeQuota: 200 },
  ];

  /** 全量规则（管理端列表）：科目 → 覆盖行排序稳定，前端按 code 分组展示。 */
  async list() {
    await this.ensureSeed();
    const rows = await this.prisma.billingRule.findMany({
      orderBy: [{ code: 'asc' }, { scope: 'asc' }, { metric: 'asc' }],
    });
    return rows.map(toView);
  }

  /** 懒播种：module_pricing 已配置的价目各生成一条 PLATFORM/call 默认行；AI 新科目缺行补建（不覆盖管理员改过的行）。 */
  async ensureSeed() {
    const count = await this.prisma.billingRule.count({
      where: { scope: 'PLATFORM' },
    });
    if (count > 0) {
      await this.seedAiSubjects();
      return;
    }
    const pricings = await this.prisma.modulePricing.findMany({
      where: { mode: 'METERED' },
    });
    await this.prisma.billingRule.createMany({
      skipDuplicates: true,
      data: pricings.map((row) => ({
        code: row.code,
        scope: 'PLATFORM',
        orgUserId: '',
        metric: 'call',
        unitPriceAmount: row.unitPriceAmount,
        baseFeeAmount: 0,
        multiplier: 1,
        minChargeAmount: row.minChargeAmount,
        maxChargeAmount: 0,
        budgetCapMonthly: 0,
        freeQuotaMonthly: row.freeQuotaAmount,
        enabled: row.enabled,
        updatedBy: 'seed',
      })),
    });
    await this.seedAiSubjects();
  }

  /** AI 科目 PLATFORM/call 默认行：存在即跳过（改价走 upsert，version 留痕）。 */
  private async seedAiSubjects() {
    for (const subject of BillingRuleService.AI_SUBJECT_SEEDS) {
      const exists = await this.prisma.billingRule.findUnique({
        where: {
          code_scope_orgUserId_metric: {
            code: subject.code,
            scope: 'PLATFORM',
            orgUserId: '',
            metric: 'call',
          },
        },
      });
      if (exists) continue;
      await this.prisma.billingRule
        .create({
          data: {
            code: subject.code,
            scope: 'PLATFORM',
            orgUserId: '',
            metric: 'call',
            unitPriceAmount: subject.unitPrice,
            baseFeeAmount: 0,
            multiplier: 1,
            minChargeAmount: 0.01,
            maxChargeAmount: 0,
            budgetCapMonthly: 0,
            freeQuotaMonthly: subject.freeQuota,
            enabled: 1,
            updatedBy: 'seed',
          },
        })
        .catch(() => undefined);
    }
  }

  /** upsert（Points_upsertBillingRule）：唯一键 [code,scope,orgUserId,metric]，改动 version 自增留痕。 */
  async upsert(input: BillingRuleInput, adminUserId: string) {
    const code = input.code.trim();
    if (!code)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '科目编码不能为空');
    if (!METRICS.includes(input.metric)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '计量维度不合法');
    }
    const scope = input.scope || 'PLATFORM';
    const orgUserId =
      scope === 'PLATFORM' ? '' : (input.orgUserId || '').trim();
    if (scope !== 'PLATFORM' && !orgUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'ORG/PLAN 覆盖行必须指定归属账号',
      );
    }
    const nonNeg = (v?: number, dflt = 0) =>
      Number(Math.max(0, v ?? dflt).toFixed(4));
    const existing = await this.prisma.billingRule.findUnique({
      where: {
        code_scope_orgUserId_metric: {
          code,
          scope,
          orgUserId,
          metric: input.metric,
        },
      },
    });
    const row = await this.prisma.billingRule.upsert({
      where: {
        code_scope_orgUserId_metric: {
          code,
          scope,
          orgUserId,
          metric: input.metric,
        },
      },
      create: {
        code,
        scope,
        orgUserId,
        metric: input.metric,
        unitPriceAmount: nonNeg(input.unitPriceAmount),
        baseFeeAmount: nonNeg(input.baseFeeAmount),
        multiplier: Math.min(1000, Math.max(0, input.multiplier ?? 1)),
        minChargeAmount: nonNeg(input.minChargeAmount, 0.01),
        maxChargeAmount: nonNeg(input.maxChargeAmount),
        budgetCapMonthly: nonNeg(input.budgetCapMonthly),
        freeQuotaMonthly: nonNeg(input.freeQuotaMonthly),
        enabled: input.enabled === false ? 0 : 1,
        version: 1,
        updatedBy: adminUserId,
      },
      update: {
        unitPriceAmount: nonNeg(input.unitPriceAmount),
        baseFeeAmount: nonNeg(input.baseFeeAmount),
        multiplier: Math.min(1000, Math.max(0, input.multiplier ?? 1)),
        minChargeAmount: nonNeg(input.minChargeAmount, 0.01),
        maxChargeAmount: nonNeg(input.maxChargeAmount),
        budgetCapMonthly: nonNeg(input.budgetCapMonthly),
        freeQuotaMonthly: nonNeg(input.freeQuotaMonthly),
        enabled: input.enabled === false ? 0 : 1,
        version: existing ? existing.version + 1 : 1,
        updatedBy: adminUserId,
      },
    });
    this.cached = null;
    return toView(row);
  }

  /** 删除覆盖行（Points_deleteBillingRule）：PLATFORM 默认行由价目播种维护，只能停用不能删。 */
  async remove(id: number) {
    const row = await this.prisma.billingRule.findUnique({ where: { id } });
    if (!row) return { deleted: 0 };
    if (row.scope === 'PLATFORM') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '平台默认行不可删除，请改用停用或添加覆盖行',
      );
    }
    await this.prisma.billingRule.delete({ where: { id } });
    this.cached = null;
    return { deleted: 1 };
  }

  /**
   * 计费解析（l0-billing 的 ai-eval 收口用）：同一科目多 metric 行复合，PLAN>ORG>PLATFORM 逐维度取覆盖。
   * 15 秒缓存；结算 fail-closed——规则缺失按 PLATFORM/call 兜底，兜底也没有则返回空数组（调用方不扣分只记流水）。
   */
  async resolve(
    code: string,
    orgUserId = '',
    planCode = '',
  ): Promise<BillingRuleView[]> {
    if (this.cached && Date.now() - this.cached.at < 15_000) {
      return this.pickMetrics(this.cached.rows, code, orgUserId, planCode);
    }
    await this.ensureSeed();
    const rows = (
      await this.prisma.billingRule.findMany({
        where: { enabled: 1 },
      })
    ).map(toView);
    this.cached = { at: Date.now(), rows };
    return this.pickMetrics(rows, code, orgUserId, planCode);
  }

  private pickMetrics(
    rows: BillingRuleView[],
    code: string,
    orgUserId: string,
    planCode: string,
  ): BillingRuleView[] {
    const winner = new Map<BillingMetric, BillingRuleView>();
    const rank = { PLATFORM: 0, ORG: 1, PLAN: 2 };
    for (const row of rows) {
      if (row.code !== code) continue;
      if (row.scope === 'ORG' && row.orgUserId !== orgUserId) continue;
      if (row.scope === 'PLAN' && (!planCode || row.orgUserId !== planCode))
        continue;
      const current = winner.get(row.metric);
      if (!current || rank[row.scope] >= rank[current.scope])
        winner.set(row.metric, row);
    }
    return [...winner.values()];
  }
}
