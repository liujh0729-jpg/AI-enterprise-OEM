import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

export interface PricingInput {
  mode?: 'FREE' | 'METERED';
  unit?: string;
  unitPriceAmount?: number;
  freeQuotaAmount?: number;
  minChargeAmount?: number;
  enabled?: boolean;
}

function toNum(v: Prisma.Decimal | number | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v);
}

/**
 * 模块价目管理：花分的具体数量（单价/免费额/最低起扣/开关）都由平台管理员在后台设置。
 * 记录不存在时按 code 建行（允许管理员为尚未预置的模块自定义价格）。
 */
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** 全量价目（管理端列表）。 */
  async list() {
    const rows = await this.prisma.modulePricing.findMany({
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({
      code: row.code,
      mode: row.mode,
      unit: row.unit,
      unitPriceAmount: toNum(row.unitPriceAmount),
      freeQuotaAmount: toNum(row.freeQuotaAmount),
      minChargeAmount: toNum(row.minChargeAmount),
      enabled: row.enabled === 1,
    }));
  }

  /** 编辑单个模块价格（upsert：数值统一夹紧到非负、4 位小数）。 */
  async update(code: string, input: PricingInput) {
    const key = code.trim();
    if (!key)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '模块编码不能为空');
    if (input.mode && !['FREE', 'METERED'].includes(input.mode)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '计费模式仅支持 FREE / METERED',
      );
    }
    const nonNeg = (v?: number) =>
      v === undefined ? undefined : Number(Math.max(0, v).toFixed(4));
    const data: Prisma.ModulePricingUpdateInput &
      Prisma.ModulePricingCreateInput = {
      code: key,
      mode: input.mode ?? 'FREE',
      unit: input.unit ?? '',
      unitPriceAmount: nonNeg(input.unitPriceAmount) ?? 0,
      freeQuotaAmount: nonNeg(input.freeQuotaAmount) ?? 0,
      minChargeAmount: nonNeg(input.minChargeAmount) ?? 0.01,
      enabled: input.enabled === false ? 0 : 1,
    };
    const row = await this.prisma.modulePricing.upsert({
      where: { code: key },
      create: data,
      update: {
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(nonNeg(input.unitPriceAmount) !== undefined
          ? { unitPriceAmount: nonNeg(input.unitPriceAmount) }
          : {}),
        ...(nonNeg(input.freeQuotaAmount) !== undefined
          ? { freeQuotaAmount: nonNeg(input.freeQuotaAmount) }
          : {}),
        ...(nonNeg(input.minChargeAmount) !== undefined
          ? { minChargeAmount: nonNeg(input.minChargeAmount) }
          : {}),
        ...(input.enabled !== undefined
          ? { enabled: input.enabled ? 1 : 0 }
          : {}),
      },
    });
    return {
      code: row.code,
      mode: row.mode,
      unit: row.unit,
      unitPriceAmount: toNum(row.unitPriceAmount),
      freeQuotaAmount: toNum(row.freeQuotaAmount),
      minChargeAmount: toNum(row.minChargeAmount),
      enabled: row.enabled === 1,
    };
  }

  /** 用量事件查询（管理端：某模块某段时间的计量明细，供对账）。 */
  async usage(opts: {
    code?: string;
    module?: string;
    userId?: string;
    from?: Date;
    to?: Date;
    page: number;
    size: number;
  }) {
    const where: Prisma.UsageEventWhereInput = {};
    if (opts.code) where.code = opts.code;
    if (opts.module) where.module = opts.module;
    if (opts.userId) where.userId = opts.userId;
    if (opts.from || opts.to) {
      where.occurredAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      };
    }
    const [list, total] = await this.prisma.$transaction([
      this.prisma.usageEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (opts.page - 1) * opts.size,
        take: opts.size,
      }),
      this.prisma.usageEvent.count({ where }),
    ]);
    return {
      total,
      page: opts.page,
      size: opts.size,
      list: list.map((row) => ({
        id: row.id,
        userId: row.userId,
        code: row.code,
        quantityAmount: toNum(row.quantityAmount),
        billed: row.billed === 1,
        occurredAt: row.occurredAt,
        remark: row.remark,
        module: row.module,
        operation: row.operation,
        model: row.model,
        tokenInAmount: toNum(row.tokenInAmount),
        tokenOutAmount: toNum(row.tokenOutAmount),
        pointsAmount: toNum(row.pointsAmount),
      })),
    };
  }

  /**
   * 统一 AI 用量事实汇总（AI 底座方案 §4.4）：按板块 + 科目聚合，
   * 让「每个模块花了多少 token / 积分」在一处可见；ai_insight_records 的洞察产出并入同一视图，
   * 不再出现「扣费看一张表、产出看另一张表」的两套口径。
   */
  async usageSummary(opts: { userId?: string; from?: Date; to?: Date }) {
    const from = opts.from ?? defaultFrom();
    const range = { gte: from, ...(opts.to ? { lte: opts.to } : {}) };
    const where: Prisma.UsageEventWhereInput = { occurredAt: range };
    if (opts.userId) where.userId = opts.userId;
    const [grouped, insightRows, insightCount] = await Promise.all([
      this.prisma.usageEvent.groupBy({
        by: ['module', 'code'],
        where,
        _count: { _all: true },
        _sum: {
          quantityAmount: true,
          tokenInAmount: true,
          tokenOutAmount: true,
          pointsAmount: true,
        },
      }),
      this.prisma.aiInsightRecord.groupBy({
        by: ['scope'],
        where: {
          createdAt: range,
          ...(opts.userId ? { orgUserId: opts.userId } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.aiInsightRecord.count({
        where: {
          createdAt: range,
          ...(opts.userId ? { orgUserId: opts.userId } : {}),
        },
      }),
    ]);
    const modules = grouped
      .map((row) => ({
        module: row.module,
        code: row.code,
        calls: row._count._all,
        quantityAmount: toNum(row._sum.quantityAmount),
        tokenInAmount: toNum(row._sum.tokenInAmount),
        tokenOutAmount: toNum(row._sum.tokenOutAmount),
        pointsAmount: Number(toNum(row._sum.pointsAmount).toFixed(4)),
      }))
      .sort(
        (a, b) =>
          b.pointsAmount - a.pointsAmount ||
          b.tokenInAmount +
            b.tokenOutAmount -
            (a.tokenInAmount + a.tokenOutAmount) ||
          b.calls - a.calls,
      );
    return {
      from,
      to: opts.to ?? new Date(),
      modules,
      insights: insightRows
        .map((row) => ({ scope: row.scope, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      totals: {
        calls: modules.reduce((sum, row) => sum + row.calls, 0),
        tokenInAmount: modules.reduce((sum, row) => sum + row.tokenInAmount, 0),
        tokenOutAmount: modules.reduce(
          (sum, row) => sum + row.tokenOutAmount,
          0,
        ),
        pointsAmount: Number(
          modules.reduce((sum, row) => sum + row.pointsAmount, 0).toFixed(4),
        ),
        insightCount,
      },
    };
  }
}

/** 默认统计窗口：近 30 天（用量页首屏不必先选时间）。 */
function defaultFrom(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
}
