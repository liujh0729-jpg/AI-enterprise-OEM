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
    if (!key) throw new BusinessException(ErrorCode.BAD_REQUEST, '模块编码不能为空');
    if (input.mode && !['FREE', 'METERED'].includes(input.mode)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '计费模式仅支持 FREE / METERED');
    }
    const nonNeg = (v?: number) =>
      v === undefined ? undefined : Number(Math.max(0, v).toFixed(4));
    const data: Prisma.ModulePricingUpdateInput & Prisma.ModulePricingCreateInput = {
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
        ...(input.enabled !== undefined ? { enabled: input.enabled ? 1 : 0 } : {}),
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
  async usage(opts: { code?: string; userId?: string; from?: Date; to?: Date; page: number; size: number }) {
    const where: Prisma.UsageEventWhereInput = {};
    if (opts.code) where.code = opts.code;
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
      })),
    };
  }
}
