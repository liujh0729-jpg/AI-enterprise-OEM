import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { PointsService } from '../points/points.service';
import type { GapScopeService } from './gaps.scope';
import {
  asDate,
  asInt,
  asNum,
  asText,
  clip,
  isoOr,
  Row,
  safeStatus,
} from './gaps.helpers';

const KIND_LABELS: Record<string, string> = {
  FIXED: '固定积分',
  PERCENT: '按比例返积分',
};
const KINDS = ['FIXED', 'PERCENT'] as const;
const STATUSES = ['ACTIVE', 'DISABLED'] as const;
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '启用',
  DISABLED: '停用',
};

type PromoRow = {
  id: number;
  code: string;
  name: string;
  kind: string;
  value: unknown;
  minAmount: unknown;
  maxRedemptions: number;
  redeemedCount: number;
  perUserLimit: number;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  createdAt: Date;
};

/**
 * B3#22① 兑换码：平台目录 + 用户核销入账。
 * 核销先原子占用名额（并发下不会超发），再调用积分入账；入账失败回滚名额。
 */
export class PromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
    private readonly points: PointsService,
  ) {}

  private view(row: PromoRow) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      kindLabel: KIND_LABELS[row.kind] || row.kind,
      value: Number(row.value),
      minAmount: Number(row.minAmount),
      maxRedemptions: row.maxRedemptions,
      redeemedCount: row.redeemedCount,
      perUserLimit: row.perUserLimit,
      startsAt: isoOr(row.startsAt),
      endsAt: isoOr(row.endsAt),
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] || row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async promoCodes(user: CurrentUser) {
    // 兑换码目录只对平台管理员开放：企业用户 / 个人 / 服务商只能凭码兑换，不能枚举或新建
    if (!this.scope.platformAdmin(user)) return [];
    const rows = await this.prisma.pointPromoCode.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.view(row));
  }

  async savePromoCode(user: CurrentUser, body: Row) {
    this.scope.requirePlatformAdmin(user);
    const id = asInt(body.id);
    const code = asText(body.code).trim().toUpperCase().slice(0, 32);
    const name = clip(body.name, 80).trim();
    if (code.length < 3)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写至少 3 位的兑换码',
      );
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写兑换码名称');
    const kind = safeStatus(body.kind, KINDS, 'FIXED');
    const value = asNum(body.value);
    if (value <= 0)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写大于 0 的返积分值',
      );
    if (kind === 'PERCENT' && value > 100) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '按比例返积分不能超过 100%',
      );
    }
    const data = {
      code,
      name,
      kind,
      value,
      minAmount: Math.max(0, asNum(body.minAmount)),
      maxRedemptions: Math.max(0, asInt(body.maxRedemptions)),
      perUserLimit: Math.min(
        100,
        Math.max(1, asInt(body.perUserLimit, 1) || 1),
      ),
      startsAt: asDate(body.startsAt),
      endsAt: asDate(body.endsAt),
      status: safeStatus(body.status, STATUSES, 'ACTIVE'),
      createdBy: user.userId,
    };
    if (data.endsAt && data.startsAt && data.endsAt <= data.startsAt) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '结束时间必须晚于开始时间',
      );
    }
    const existing = id
      ? await this.prisma.pointPromoCode.findUnique({ where: { id } })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '兑换码不存在');
    const conflict = await this.prisma.pointPromoCode.findUnique({
      where: { code },
    });
    if (conflict && conflict.id !== existing?.id) {
      throw new BusinessException(ErrorCode.CONFLICT, '该兑换码已存在');
    }
    const row = existing
      ? await this.prisma.pointPromoCode.update({
          where: { id: existing.id },
          data: { ...data, createdBy: existing.createdBy },
        })
      : await this.prisma.pointPromoCode.create({ data });
    return this.view(row);
  }

  async removePromoCode(user: CurrentUser, idRaw: number) {
    this.scope.requirePlatformAdmin(user);
    const row = await this.prisma.pointPromoCode.findUnique({
      where: { id: asInt(idRaw) },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '兑换码不存在');
    await this.prisma.pointPromoCode.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async redeem(user: CurrentUser, body: Row) {
    const code = asText(body.code).trim().toUpperCase();
    if (!code)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请输入兑换码');
    const promo = await this.prisma.pointPromoCode.findUnique({
      where: { code },
    });
    if (!promo)
      throw new BusinessException(ErrorCode.NOT_FOUND, '兑换码不存在');
    if (promo.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '兑换码已停用');
    }
    const now = new Date();
    if (promo.startsAt && promo.startsAt > now) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '兑换码尚未开始');
    }
    if (promo.endsAt && promo.endsAt < now) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '兑换码已过期');
    }
    const refAmount = Math.max(0, asNum(body.amount));
    if (refAmount < Number(promo.minAmount)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `未满足最低金额：需满 ¥${Number(promo.minAmount).toFixed(2)}`,
      );
    }
    if (
      promo.maxRedemptions > 0 &&
      promo.redeemedCount >= promo.maxRedemptions
    ) {
      throw new BusinessException(ErrorCode.CONFLICT, '兑换码已被领完');
    }
    const mine = await this.prisma.pointPromoRedemption.count({
      where: { promoId: promo.id, userId: user.userId },
    });
    if (mine >= promo.perUserLimit) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该兑换码每人限领 ${promo.perUserLimit} 次`,
      );
    }
    const points =
      promo.kind === 'PERCENT'
        ? Math.floor(refAmount * (Number(promo.value) / 100) * 100) / 100
        : Number(promo.value);
    if (!(points > 0)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        promo.kind === 'PERCENT'
          ? '按当前金额计算返积分为 0，请补充金额'
          : '兑换码返积分值无效',
      );
    }
    // 原子占用名额：maxRedemptions=0 表示不限量，不做上限条件。
    const claimed = await this.prisma.pointPromoCode.updateMany({
      where: {
        id: promo.id,
        status: 'ACTIVE',
        ...(promo.maxRedemptions > 0
          ? { redeemedCount: { lt: promo.maxRedemptions } }
          : {}),
      },
      data: { redeemedCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new BusinessException(ErrorCode.CONFLICT, '兑换码已被领完');
    }
    const redemption = await this.prisma.pointPromoRedemption.create({
      data: {
        promoId: promo.id,
        code: promo.code,
        userId: user.userId,
        points,
        refAmount,
      },
    });
    try {
      const credited = await this.points.credit(user.userId, 'EARN', points, {
        remark: `兑换码 ${promo.code} 返积分`,
      });
      return {
        points,
        balance: credited.balance,
        promoCode: promo.code,
        promoName: promo.name,
      };
    } catch (error) {
      await this.prisma.pointPromoRedemption.delete({
        where: { id: redemption.id },
      });
      await this.prisma.pointPromoCode.update({
        where: { id: promo.id },
        data: { redeemedCount: { decrement: 1 } },
      });
      throw error;
    }
  }
}
