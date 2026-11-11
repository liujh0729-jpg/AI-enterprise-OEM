import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { PointsService } from '../points/points.service';
import type { CardService } from '../points/card.service';
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
/** 一张码在创建时就定死兑积分还是兑卡（D1=A）：核销时查目录行分流，不靠码前缀猜。 */
const ASSET_TYPES = ['POINTS', 'CARD'] as const;

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
  assetType: string;
  cardCode: string;
  createdAt: Date;
};

/**
 * B3#22① 兑换码：平台目录 + 用户核销入账。
 * 核销先原子占用名额（并发下不会超发），再兑付；兑付失败回滚名额。
 * 两种兑付：`POINTS` 走积分入账，`CARD` 走时长卡发卡（订单 + 卡 + 核销记录同事务）。
 */
export class PromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
    private readonly points: PointsService,
    private readonly cards: CardService,
  ) {}

  private view(row: PromoRow, cardName = '') {
    const assetType = row.assetType === 'CARD' ? 'CARD' : 'POINTS';
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
      assetType,
      cardCode: assetType === 'CARD' ? row.cardCode : '',
      cardName: assetType === 'CARD' ? cardName : '',
      createdAt: row.createdAt.toISOString(),
    };
  }

  async promoCodes(user: CurrentUser) {
    // 兑换码目录只对平台管理员开放：企业用户 / 个人 / 服务商只能凭码兑换，不能枚举或新建
    if (!this.scope.platformAdmin(user)) return [];
    const rows = await this.prisma.pointPromoCode.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const names = await this.cardNames(rows);
    return rows.map((row) => this.view(row, names.get(row.cardCode) || ''));
  }

  /** 卡码表格要直接显示「兑的是哪张卡」：按 code 批量回查规格名，规格改名后跟着变。 */
  private async cardNames(rows: { cardCode: string }[]) {
    const codes = Array.from(
      new Set(rows.map((row) => row.cardCode).filter(Boolean)),
    );
    if (!codes.length) return new Map<string, string>();
    const found = await this.prisma.pointCardTemplate.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true },
    });
    return new Map(found.map((row) => [row.code, row.name]));
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
    const assetType = safeStatus(body.assetType, ASSET_TYPES, 'POINTS');
    const inputCardCode = asText(body.cardCode)
      .trim()
      .toUpperCase()
      .slice(0, 32);
    // 卡码的「价值」由规格本身决定，码上不再带积分数值：value 一律置 0，避免两套口径打架。
    const template =
      assetType === 'CARD'
        ? await this.cards.activeTemplate(inputCardCode)
        : null;
    const kind = template ? 'FIXED' : safeStatus(body.kind, KINDS, 'FIXED');
    const value = template ? 0 : asNum(body.value);
    if (!template && value <= 0)
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
      minAmount: template ? 0 : Math.max(0, asNum(body.minAmount)),
      maxRedemptions: Math.max(0, asInt(body.maxRedemptions)),
      perUserLimit: Math.min(
        100,
        Math.max(1, asInt(body.perUserLimit, 1) || 1),
      ),
      startsAt: asDate(body.startsAt),
      endsAt: asDate(body.endsAt),
      status: safeStatus(body.status, STATUSES, 'ACTIVE'),
      assetType,
      cardCode: template ? template.code : '',
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
    if (
      existing &&
      existing.redeemedCount > 0 &&
      (existing.assetType !== data.assetType ||
        existing.cardCode !== data.cardCode)
    ) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该码已有人兑换，不能改兑付内容；请停用本码，再按新兑付目标建一张新码',
      );
    }
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
    return this.view(row, template?.name || data.cardCode);
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
    const isCard = promo.assetType === 'CARD';
    const points =
      promo.kind === 'PERCENT'
        ? Math.floor(refAmount * (Number(promo.value) / 100) * 100) / 100
        : Number(promo.value);
    if (!isCard && !(points > 0)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        promo.kind === 'PERCENT'
          ? '按当前金额计算返积分为 0，请补充金额'
          : '兑换码返积分值无效',
      );
    }
    if (isCard && !promo.cardCode) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该兑换码未绑定时长卡规格，请管理员在「平台管理 → 积分与计费 → 兑换码」里补齐规格',
      );
    }
    // 规格停用/被删时先报错，别白占一次兑换名额
    if (isCard) await this.cards.activeTemplate(promo.cardCode);
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
    if (isCard) return this.redeemCard(user, promo, refAmount);
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
        assetType: 'POINTS',
        card: null,
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

  /**
   * 卡码兑付：核销记录 + 兑换订单（`CARD_CODE`）+ 卡实例在同一事务里落，
   * 任一步失败整体回滚并释放名额。不产生积分流水——卡本身就是这张码的价值。
   */
  private async redeemCard(
    user: CurrentUser,
    promo: PromoRow,
    refAmount: number,
  ) {
    try {
      const issued = await this.prisma.$transaction(async (tx) => {
        const redemption = await tx.pointPromoRedemption.create({
          data: {
            promoId: promo.id,
            code: promo.code,
            userId: user.userId,
            // 卡码不产生积分；额度快照在卡与兑换订单上，核销记录只留「兑了哪个规格、发了哪张卡」
            points: 0,
            refAmount,
            cardCode: promo.cardCode,
          },
        });
        const result = await this.cards.issueForPromoCode(
          user.userId,
          promo.cardCode,
          promo.code,
          tx,
        );
        await tx.pointPromoRedemption.update({
          where: { id: redemption.id },
          data: { userCardId: result.card.id },
        });
        return result;
      });
      const summary = await this.points.summary(user.userId);
      const card = issued.view;
      return {
        points: 0,
        balance: summary.balance,
        promoCode: promo.code,
        promoName: promo.name,
        assetType: 'CARD',
        card: {
          cardId: card.id,
          name: card.name,
          modelKey: card.modelKey,
          modelName: card.modelName,
          unit: card.billingUnitLabel,
          quota: card.quotaTotal,
          quotaLabel: card.quotaLabel,
          validDays: issued.template.validDays,
          expiresAt: card.expiresAt,
        },
      };
    } catch (error) {
      await this.prisma.pointPromoCode
        .update({
          where: { id: promo.id },
          data: { redeemedCount: { decrement: 1 } },
        })
        .catch(() => undefined);
      throw error;
    }
  }
}
