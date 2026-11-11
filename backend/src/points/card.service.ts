import type { Prisma } from '../../generated/prisma';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { allocateNo } from '../common/document-number';
import { Logger } from '../common/logger';
import { assertSensitivePassword } from '../common/confirm-password';
import type { GapScopeService } from '../gaps/gaps.scope';
import { asInt, asText, isoOr, Row } from '../gaps/gaps.helpers';
import type { PrismaService } from '../prisma/prisma.service';
import type { PointsSettingsService } from './points-settings.service';
import type { PointsService } from './points.service';
import type { WechatPayClient, WechatTransaction } from './wechat-pay.client';
import {
  cardUnitLabel,
  cardUnitsNeeded,
  formatQuota,
  type CardMultiplierHit,
} from './card.pricing';

const DAY_MS = 86_400_000;
/** 单次调用只从一张卡扣（临期优先），扣量 CAS 最多重读两轮。 */
const CAS_ATTEMPTS = 2;

const CARD_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '生效中',
  EXHAUSTED: '已用尽',
  EXPIRED: '已过期',
  REVOKED: '已撤销',
};
const CARD_SOURCE_LABELS: Record<string, string> = {
  REDEEM: '兑换码',
  POINTS: '积分兑换',
  CASH: '现金购买',
  ADMIN: '平台发放',
};
const ORDER_KIND_LABELS: Record<string, string> = {
  CARD_CASH: '日卡购买',
  CARD_CODE: '日卡兑换',
  CARD_POINTS: '积分兑换',
};
const ORDER_STATUS_LABELS: Record<string, string> = {
  CREATED: '待支付',
  PAID: '已支付',
  ISSUED: '已发卡',
  CLOSED: '已关闭',
  FAILED: '失败',
  REFUNDED: '已退款',
};

type CardRow = {
  id: number;
  templateId: number;
  templateCode: string;
  name: string;
  provider: string;
  modelKey: string;
  billingUnit: string;
  quotaTotal: Prisma.Decimal | number;
  quotaUsed: Prisma.Decimal | number;
  status: string;
  activatedAt: Date;
  expiresAt: Date;
  source: string;
  createdAt: Date;
};

type OrderRow = {
  orderNo: string;
  kind: string;
  templateCode: string;
  name: string;
  billingUnit: string;
  quotaTotal: Prisma.Decimal | number;
  amountCents: number;
  pointsAmount: Prisma.Decimal | number;
  status: string;
  userCardId: number | null;
  promoCode: string;
  paidAt: Date | null;
  issuedAt: Date | null;
  failReason: string;
  createdAt: Date;
};

export type TemplateForIssue = {
  id: number;
  code: string;
  name: string;
  provider: string;
  modelKey: string;
  billingUnit: string;
  quotaTotal: Prisma.Decimal | number;
  validDays: number;
  /** 每人持有限额（0=不限）；三入口共用，见 assertHoldLimit */
  perUserLimit?: number;
};

/** 本次调用折算出的卡消耗（units 已含规格倍率）。 */
export type CardQuote = {
  cardId: number;
  units: number;
  /** 扣减前卡内剩余。 */
  remaining: number;
  multiplier: number;
  hit: CardMultiplierHit;
  expiresAt: Date;
};

/** 实际扣掉的额度：deduct 不超过 units，差额由调用方转积分（D4=A）。 */
export type CardDeduct = CardQuote & { deduct: number };

export type CardCallContext = {
  userId: string;
  provider: string;
  modelKey: string;
  billingUnit: string;
  promptTokens?: number;
  completionTokens?: number;
  quantity?: number;
  tier?: Record<string, string | number | undefined>;
};

function toNum(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 额度保留 4 位，与积分账本同精度，避免浮点尾差把卡判成「没用完」。 */
function amount(value: number): number {
  return Number(Math.max(0, value).toFixed(4));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** 卡与目录的匹配键：provider 与 modelKey 的组合，与目录唯一键同键。 */
function modelPair(provider: string, modelKey: string) {
  return [provider, modelKey].join('#');
}

function secondsLeft(expiresAt: Date) {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}

export type UserCardView = {
  id: number;
  templateCode: string;
  name: string;
  provider: string;
  modelKey: string;
  modelName: string;
  billingUnit: string;
  billingUnitLabel: string;
  quotaTotal: number;
  quotaUsed: number;
  quotaRemaining: number;
  usedPercent: number;
  quotaLabel: string;
  usedLabel: string;
  status: string;
  statusLabel: string;
  source: string;
  sourceLabel: string;
  activatedAt: string;
  expiresAt: string;
  secondsLeft: number;
  createdAt: string;
};

/** 卡的对外视图：进度、剩余量、剩余时长都在这里算，不落冗余列。 */
export function buildCardView(row: CardRow, modelName: string): UserCardView {
  const total = toNum(row.quotaTotal);
  const used = toNum(row.quotaUsed);
  const remaining = amount(Math.max(0, total - used));
  return {
    id: row.id,
    templateCode: row.templateCode,
    name: row.name,
    provider: row.provider,
    modelKey: row.modelKey,
    modelName,
    billingUnit: row.billingUnit,
    billingUnitLabel: cardUnitLabel(row.billingUnit),
    quotaTotal: amount(total),
    quotaUsed: amount(used),
    quotaRemaining: remaining,
    usedPercent:
      total > 0 ? Number(Math.min(100, (used / total) * 100).toFixed(1)) : 0,
    quotaLabel: formatQuota(row.billingUnit, total),
    usedLabel: `${formatQuota(row.billingUnit, used)} / ${formatQuota(
      row.billingUnit,
      total,
    )}`,
    status: row.status,
    statusLabel: CARD_STATUS_LABELS[row.status] ?? row.status,
    source: row.source,
    sourceLabel: CARD_SOURCE_LABELS[row.source] ?? row.source,
    activatedAt: row.activatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    secondsLeft: secondsLeft(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 时长卡（日卡 / 30 天卡）核心服务：发卡、可用卡匹配、额度原子扣减、
 * 兑换订单与消耗进度、积分直兑与现金购买、后台撤销与过期刷状态。
 *
 * 口径要点：
 * - 一张卡只绑一个模型，匹配键是 provider + modelKey（不是 catalogId：后台改价/换上游不影响已发卡的权利）；
 * - 有效期从发卡那一刻起算 validDays × 24h，精确到秒，不看自然日；
 * - 同一模型多张卡按 expiresAt 升序（先到期先花），单次调用只从一张卡扣，保证扣量明细可追溯；
 * - 卡不够时能扣多少扣多少，差额转积分（D4=A）。
 */
export class CardService {
  private readonly logger = new Logger(CardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly settings: PointsSettingsService,
    private readonly pay: WechatPayClient,
    private readonly scope: GapScopeService,
  ) {}

  // ------------------------------------------------------------ 持有限额

  /**
   * 每人持有限额：同一卡规格下，兑换码 / 积分直兑 / 现金购买三入口合计计数，
   * 防止低价日卡被同一账号靠多张码囤积。只拦新兑换，已发出的卡照常用到过期；
   * 被平台撤销的卡不占名额（那是发放失败或回收，不是用户持有）。
   */
  async assertHoldLimit(
    userId: string,
    template: { code: string; name: string; perUserLimit?: number },
  ) {
    const limit = Math.max(0, Number(template.perUserLimit) || 0);
    if (!limit) return;
    const held = await this.prisma.pointUserCard.count({
      where: {
        userId,
        templateCode: template.code,
        status: { not: 'REVOKED' },
      },
    });
    if (held >= limit) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `「${template.name}」每位用户最多兑换 ${limit} 张，你已持有 ${held} 张；已持有的卡到期后或额度用尽即可再次兑换`,
      );
    }
  }

  // ------------------------------------------------------------------ 发卡

  /**
   * 发卡：额度 / 有效期 / 模型快照写进卡实例，之后规格怎么改都不影响已发出去的卡。
   * 规格倍率是唯一例外——它留在规格行上，扣量时按 templateId 现取（规格行只软停用、永不删除）。
   */
  async issue(
    userId: string,
    template: TemplateForIssue,
    source: 'REDEEM' | 'POINTS' | 'CASH' | 'ADMIN',
    sourceRef = '',
    tx?: Prisma.TransactionClient,
  ) {
    const activatedAt = new Date();
    const client = tx ?? this.prisma;
    return client.pointUserCard.create({
      data: {
        userId,
        templateId: template.id,
        templateCode: template.code,
        name: template.name,
        provider: template.provider,
        modelKey: template.modelKey,
        billingUnit: template.billingUnit,
        quotaTotal: amount(toNum(template.quotaTotal)),
        quotaUsed: 0,
        status: 'ACTIVE',
        activatedAt,
        expiresAt: new Date(
          activatedAt.getTime() + Math.max(1, template.validDays) * DAY_MS,
        ),
        source,
        sourceRef: sourceRef.slice(0, 64),
      },
    });
  }

  // -------------------------------------------------- 可用卡匹配与额度扣减

  /** 可用卡唯一谓词：状态 + 未过期；「还有剩余额度」在内存里判（Prisma 不支持字段比字段）。 */
  async findUsable(userId: string, provider: string, modelKey: string) {
    const rows = await this.prisma.pointUserCard.findMany({
      where: {
        userId,
        provider,
        modelKey,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 10,
    });
    return (
      rows.find((row) => toNum(row.quotaTotal) - toNum(row.quotaUsed) > 0) ??
      null
    );
  }

  /** 本次调用卡能承担多少（只读预估：闸门放行与差额判断都用它）。 */
  async quote(ctx: CardCallContext): Promise<CardQuote | null> {
    if (!ctx.provider || !ctx.modelKey) return null;
    const card = await this.findUsable(ctx.userId, ctx.provider, ctx.modelKey);
    if (!card) return null;
    const need = await this.needOf(card, ctx);
    if (!(need.units > 0)) return null;
    return {
      cardId: card.id,
      units: need.units,
      remaining: amount(toNum(card.quotaTotal) - toNum(card.quotaUsed)),
      multiplier: need.multiplier,
      hit: need.hit,
      expiresAt: card.expiresAt,
    };
  }

  /**
   * 扣卡：复刻积分账本的条件更新范式，用「读取值 CAS」防并发超扣。
   * 够扣整份扣掉，不够则扣光剩余并置 EXHAUSTED；CAS 失败重读重试，仍失败则整笔转积分。
   */
  async deduct(ctx: CardCallContext): Promise<CardDeduct | null> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const card = await this.findUsable(
        ctx.userId,
        ctx.provider,
        ctx.modelKey,
      );
      if (!card) return null;
      const need = await this.needOf(card, ctx);
      if (!(need.units > 0)) return null;
      const remaining = amount(toNum(card.quotaTotal) - toNum(card.quotaUsed));
      if (!(remaining > 0)) continue;
      const deduct = amount(Math.min(remaining, need.units));
      const taken = await this.prisma.pointUserCard.updateMany({
        where: {
          id: card.id,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          // CAS：额度仍等于读取时的值才扣，避免并发把同一份额度扣两次。
          quotaUsed: card.quotaUsed,
        },
        data: {
          quotaUsed: { increment: deduct },
          ...(deduct >= remaining ? { status: 'EXHAUSTED' } : {}),
        },
      });
      if (taken.count === 0) continue;
      return {
        cardId: card.id,
        units: need.units,
        remaining,
        multiplier: need.multiplier,
        hit: need.hit,
        expiresAt: card.expiresAt,
        deduct,
      };
    }
    return null;
  }

  /** 本次折算的卡消耗量：token 用 prompt+completion，图片取张数，视频按规格倍率折算秒数。 */
  private async needOf(
    card: { billingUnit: string; templateId: number },
    ctx: CardCallContext,
  ) {
    const template = await this.prisma.pointCardTemplate.findUnique({
      where: { id: card.templateId },
      select: { specMultipliers: true },
    });
    return cardUnitsNeeded({
      billingUnit: card.billingUnit,
      promptTokens: ctx.promptTokens,
      completionTokens: ctx.completionTokens,
      quantity: ctx.quantity,
      tier: ctx.tier,
      specMultipliers: template?.specMultipliers,
    });
  }

  /** 零余额但持有该模型可用卡时闸门放行（欠费只影响积分侧）。 */
  async hasUsableFor(userId: string, provider: string, modelKey: string) {
    return (await this.findUsable(userId, provider, modelKey)) !== null;
  }

  /** 模型广场会话视图：可扣的卡（临期优先），前端据此决定试用按钮是否灰掉。 */
  async usableCards(userId: string) {
    const rows = await this.prisma.pointUserCard.findMany({
      where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    const usable = rows.filter(
      (row) => toNum(row.quotaTotal) - toNum(row.quotaUsed) > 0,
    );
    const names = await this.modelNames(usable);
    return usable.map((row) => {
      const remaining = amount(toNum(row.quotaTotal) - toNum(row.quotaUsed));
      return {
        cardId: row.id,
        provider: row.provider,
        modelKey: row.modelKey,
        modelName:
          names.get(modelPair(row.provider, row.modelKey)) || row.modelKey,
        name: row.name,
        billingUnit: row.billingUnit,
        billingUnitLabel: cardUnitLabel(row.billingUnit),
        quotaRemaining: remaining,
        quotaLabel: formatQuota(row.billingUnit, remaining),
        expiresAt: row.expiresAt.toISOString(),
        secondsLeft: secondsLeft(row.expiresAt),
      };
    });
  }

  async myCards(userId: string) {
    const rows = await this.prisma.pointUserCard.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }, { id: 'desc' }],
      take: 200,
    });
    const names = await this.modelNames(rows);
    return rows.map((row) =>
      buildCardView(
        row,
        names.get(modelPair(row.provider, row.modelKey)) || row.modelKey,
      ),
    );
  }

  // -------------------------------------------------------------- 兑换订单

  async orders(userId: string, query: Row) {
    const page = Math.max(1, asInt(query.page, 1) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, asInt(query.pageSize, 20) || 20),
    );
    const kind = asText(query.kind).trim().toUpperCase();
    const where = {
      userId,
      ...(Object.prototype.hasOwnProperty.call(ORDER_KIND_LABELS, kind)
        ? { kind }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.pointCardOrder.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.pointCardOrder.count({ where }),
    ]);
    const cards = await this.cardsOf(rows);
    const names = await this.modelNames(Array.from(cards.values()));
    return {
      list: rows.map((row) => {
        const card = row.userCardId ? cards.get(row.userCardId) : null;
        return {
          orderNo: row.orderNo,
          kind: row.kind,
          kindLabel: ORDER_KIND_LABELS[row.kind] ?? row.kind,
          templateCode: row.templateCode,
          name: row.name,
          billingUnit: row.billingUnit,
          billingUnitLabel: cardUnitLabel(row.billingUnit),
          quotaTotal: amount(toNum(row.quotaTotal)),
          quotaLabel: formatQuota(row.billingUnit, toNum(row.quotaTotal)),
          amountCents: row.amountCents,
          pointsAmount: amount(toNum(row.pointsAmount)),
          status: row.status,
          statusLabel: ORDER_STATUS_LABELS[row.status] ?? row.status,
          promoCode: row.promoCode,
          paidAt: isoOr(row.paidAt),
          issuedAt: isoOr(row.issuedAt),
          failReason: row.failReason,
          createdAt: row.createdAt.toISOString(),
          card: card
            ? buildCardView(
                card,
                names.get(modelPair(card.provider, card.modelKey)) ||
                  card.modelKey,
              )
            : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 卡的逐次扣量明细：与 AI 用量同源（model_usage_logs.user_card_id）。 */
  async orderUsage(userId: string, orderNoRaw: string, query: Row) {
    const page = Math.max(1, asInt(query.page, 1) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, asInt(query.pageSize, 20) || 20),
    );
    const order = await this.prisma.pointCardOrder.findFirst({
      where: { orderNo: asText(orderNoRaw).trim(), userId },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '兑换订单不存在');
    if (!order.userCardId) return { list: [], total: 0, page, pageSize };
    const where = { userCardId: order.userCardId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.modelUsageLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.modelUsageLog.count({ where }),
    ]);
    const names = await this.catalogNames(
      rows.map((row) => row.catalogId ?? 0),
    );
    return {
      list: rows.map((row) => ({
        id: row.id,
        modelKey: row.modelKey,
        displayName: names.get(row.catalogId ?? 0) || row.modelKey,
        source: row.source === 'API' ? 'API' : 'IN_APP',
        billingUnit: row.billingUnit,
        cardDeduct: amount(toNum(row.cardDeduct)),
        deductLabel: formatQuota(row.billingUnit, toNum(row.cardDeduct)),
        pointsCost: amount(toNum(row.pointsCost)),
        elapsedMs: row.elapsedMs,
        message: row.message,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  // ------------------------------------------------------------ 积分直兑卡

  /**
   * 积分直兑：建单 → 同事务扣积分 + 发卡 → 订单置 ISSUED。
   * 积分不足直接拒（不做「部分用积分」）；扣费与发卡同事务，天然不会只扣不发。
   */
  async exchangeByPoints(user: CurrentUser, body: Row) {
    const template = await this.activeTemplate(asText(body.templateCode));
    await this.assertHoldLimit(user.userId, template);
    const price = amount(toNum(template.pointsPrice));
    if (!(price > 0)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${template.name}」未开放积分兑换（积分价为 0），可在后台的时长卡规格里设置`,
      );
    }
    const summary = await this.points.summary(user.userId);
    if (summary.balance < price) {
      throw new BusinessException(
        ErrorCode.POINTS_INSUFFICIENT,
        `兑换「${template.name}」需要 ${price} 积分，当前余额 ${summary.balance}，请先充值`,
      );
    }
    const orderNo = await allocateNo(this.prisma, 'CD');
    const order = await this.prisma.pointCardOrder.create({
      data: {
        orderNo,
        userId: user.userId,
        kind: 'CARD_POINTS',
        templateId: template.id,
        templateCode: template.code,
        name: template.name,
        billingUnit: template.billingUnit,
        quotaTotal: amount(toNum(template.quotaTotal)),
        pointsAmount: price,
        status: 'CREATED',
      },
    });
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const debit = await this.points.debitTx(
          tx,
          user.userId,
          'SPEND',
          price,
          {
            scene: 'card_exchange',
            refType: 'card_order',
            refId: orderNo,
            remark: `积分兑换「${template.name}」`,
          },
        );
        const card = await this.issue(
          user.userId,
          template,
          'POINTS',
          orderNo,
          tx,
        );
        await tx.pointCardOrder.update({
          where: { id: order.id },
          data: {
            status: 'ISSUED',
            userCardId: card.id,
            paidAt: new Date(),
            issuedAt: new Date(),
          },
        });
        return { card, balance: debit.balance };
      });
      const names = await this.modelNames([result.card]);
      return {
        orderNo,
        pointsAmount: price,
        balance: result.balance,
        card: buildCardView(
          result.card,
          names.get(modelPair(result.card.provider, result.card.modelKey)) ||
            result.card.modelKey,
        ),
      };
    } catch (error) {
      await this.prisma.pointCardOrder.update({
        where: { id: order.id },
        data: {
          status: 'FAILED',
          failReason: (error instanceof Error ? error.message : '兑换失败')
            .slice(0, 200)
            .trim(),
        },
      });
      throw error;
    }
  }

  /**
   * 兑换码发卡：一条 `CARD_CODE` 订单 + 一张卡。
   * 名额占用与 `point_promo_redemptions` 由兑换码服务负责（它才知道码的状态），
   * 传入 `tx` 时与核销记录同事务，失败一起回滚；兑换订单页据此展示进度，不依赖积分流水。
   */
  async issueForPromoCode(
    userId: string,
    templateCode: string,
    promoCode: string,
    tx?: Prisma.TransactionClient,
  ) {
    const template = await this.activeTemplate(templateCode);
    await this.assertHoldLimit(userId, template);
    const client = tx ?? this.prisma;
    const orderNo = await allocateNo(client, 'CD');
    const order = await client.pointCardOrder.create({
      data: {
        orderNo,
        userId,
        kind: 'CARD_CODE',
        templateId: template.id,
        templateCode: template.code,
        name: template.name,
        billingUnit: template.billingUnit,
        quotaTotal: amount(toNum(template.quotaTotal)),
        pointsAmount: 0,
        status: 'CREATED',
        promoCode: asText(promoCode).trim().toUpperCase().slice(0, 32),
      },
    });
    const issued = async (run: Prisma.TransactionClient) => {
      const card = await this.issue(userId, template, 'REDEEM', orderNo, run);
      await run.pointCardOrder.update({
        where: { id: order.id },
        data: {
          status: 'ISSUED',
          userCardId: card.id,
          paidAt: new Date(),
          issuedAt: new Date(),
        },
      });
      return card;
    };
    let card;
    try {
      card = tx ? await issued(tx) : await this.prisma.$transaction(issued);
    } catch (error) {
      await client.pointCardOrder.update({
        where: { id: order.id },
        data: {
          status: 'FAILED',
          failReason: (error instanceof Error ? error.message : '发卡失败')
            .slice(0, 200)
            .trim(),
        },
      });
      throw error;
    }
    const names = await this.modelNames([card]);
    return {
      orderNo,
      template,
      card,
      view: buildCardView(
        card,
        names.get(modelPair(card.provider, card.modelKey)) || card.modelKey,
      ),
    };
  }

  // ------------------------------------------------------------ 现金购买卡
  /** 现金下单：规格必须启用且配了现金价；支付通道未配置时给出可操作提示。 */
  async createCashOrder(user: CurrentUser, body: Row, clientIp = '') {
    const template = await this.activeTemplate(asText(body.templateCode));
    // 下单前先拦：本入口同样受每人持有上限约束（三入口合计），避免付了钱发不出卡
    await this.assertHoldLimit(user.userId, template);
    if (!(template.cashCents > 0)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${template.name}」未上架现金购买（现金价为 0），可改用积分兑换`,
      );
    }
    const cfg = await this.settings.view();
    if (!cfg.wechatConfigured) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信支付尚未配置，请联系管理员在「系统设置 → 积分与计费」补齐商户参数',
      );
    }
    const channel =
      asText(body.channel).trim().toUpperCase() === 'H5' ? 'H5' : 'NATIVE';
    const orderNo = await allocateNo(this.prisma, 'CD');
    const order = await this.prisma.pointCardOrder.create({
      data: {
        orderNo,
        userId: user.userId,
        kind: 'CARD_CASH',
        templateId: template.id,
        templateCode: template.code,
        name: template.name,
        billingUnit: template.billingUnit,
        quotaTotal: amount(toNum(template.quotaTotal)),
        amountCents: template.cashCents,
        status: 'CREATED',
      },
    });
    const credentials = await this.settings.wechatCredentials();
    const notifyUrl = cardNotifyUrl(
      credentials.notifyUrl || cfg.wechatNotifyUrl,
    );
    if (!notifyUrl) {
      await this.prisma.pointCardOrder.update({
        where: { id: order.id },
        data: { status: 'FAILED', failReason: '微信支付回调地址未配置' },
      });
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信支付回调地址未配置，请在后台补齐',
      );
    }
    const description = `购买「${template.name}」`.slice(0, 120);
    let codeUrl = '';
    let h5Url = '';
    try {
      if (channel === 'H5') {
        h5Url = await this.pay.h5(credentials, {
          outTradeNo: orderNo,
          description,
          amountCents: template.cashCents,
          notifyUrl,
          clientIp: clientIp || '127.0.0.1',
        });
      } else {
        codeUrl = await this.pay.native(credentials, {
          outTradeNo: orderNo,
          description,
          amountCents: template.cashCents,
          notifyUrl,
        });
      }
    } catch (error) {
      await this.prisma.pointCardOrder.update({
        where: { id: order.id },
        data: {
          status: 'FAILED',
          failReason: (error instanceof Error ? error.message : '下单失败')
            .slice(0, 200)
            .trim(),
        },
      });
      throw error;
    }
    await this.prisma.pointCardOrder.update({
      where: { id: order.id },
      data: { codeUrl: codeUrl || h5Url },
    });
    return {
      orderNo,
      amountCents: template.cashCents,
      channel,
      codeUrl,
      h5Url,
    };
  }

  async handleNotify(rawBody: string, headers: Record<string, string>) {
    const credentials = await this.settings.wechatCredentials();
    if (!credentials.configured) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '微信支付未配置',
      );
    }
    const txn = await this.pay.parseNotify(credentials, headers, rawBody);
    return this.settlePay(txn);
  }

  /**
   * 支付结算（可重入）：置 PAID → 发卡 → 置 ISSUED。
   * 幂等三层：transactionId 唯一索引兜并发重复回调；发卡前重读 userCardId 判空；
   * 回写用 userCardId 为 null 的条件更新，抢不到就把多发的卡作废——一次支付只留一张卡。
   */
  async settlePay(txn: WechatTransaction) {
    const orderNo = asText(txn.out_trade_no).trim();
    if (!orderNo)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '回调缺少商户订单号');
    const order = await this.prisma.pointCardOrder.findUnique({
      where: { orderNo },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '兑换订单不存在');
    if (txn.trade_state !== 'SUCCESS') {
      if (order.status === 'CREATED') {
        await this.prisma.pointCardOrder.update({
          where: { id: order.id },
          data: {
            status: txn.trade_state === 'CLOSED' ? 'CLOSED' : 'FAILED',
          },
        });
      }
      return { orderNo, status: 'NOT_SUCCESS', tradeState: txn.trade_state };
    }
    if (order.status === 'ISSUED')
      return { orderNo, status: 'ISSUED', duplicated: true };
    const transactionId = asText(txn.transaction_id).trim();
    if (!transactionId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '回调缺少微信交易号');
    if (order.status !== 'PAID') {
      try {
        await this.prisma.pointCardOrder.update({
          where: { id: order.id },
          data: { status: 'PAID', transactionId, paidAt: new Date() },
        });
      } catch (error) {
        // 并发重复回调撞唯一键：另一路已在处理，本路改判「已确认」后继续补齐发卡。
        if (!isUniqueViolation(error)) throw error;
      }
    }
    const fresh = await this.prisma.pointCardOrder.findUnique({
      where: { id: order.id },
    });
    if (fresh?.userCardId)
      return { orderNo, status: 'ISSUED', duplicated: true };
    const template = await this.prisma.pointCardTemplate.findUnique({
      where: { id: order.templateId },
    });
    if (!template) {
      await this.prisma.pointCardOrder.update({
        where: { id: order.id },
        data: { status: 'FAILED', failReason: '卡规格行缺失，无法发卡' },
      });
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '卡规格不存在，请联系管理员按订单补发卡',
      );
    }
    // 付款已成功，这里只留痕不拒付：支付期间别的入口把名额用满时照常发卡并告警，不留一条付了钱没卡的订单。
    try {
      await this.assertHoldLimit(order.userId, template);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'card_hold_limit_exceeded_after_payment',
          orderNo,
          userId: order.userId,
          templateCode: template.code,
          reason: error instanceof Error ? error.message : '超出每人持有限额',
        }),
      );
    }
    const card = await this.issue(order.userId, template, 'CASH', orderNo);
    const claimed = await this.prisma.pointCardOrder.updateMany({
      where: { id: order.id, userCardId: null },
      data: { status: 'ISSUED', userCardId: card.id, issuedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.prisma.pointUserCard.update({
        where: { id: card.id },
        data: { status: 'REVOKED' },
      });
    }
    return { orderNo, status: 'ISSUED' };
  }

  /** 前端轮询：本地仍 CREATED 时主动查一次上游兜底（回调丢失场景）。 */
  async queryOrder(user: CurrentUser, orderNoRaw: string) {
    const orderNo = asText(orderNoRaw).trim();
    const order = await this.prisma.pointCardOrder.findFirst({
      where: { orderNo, userId: user.userId },
    });
    if (!order)
      throw new BusinessException(ErrorCode.NOT_FOUND, '兑换订单不存在');
    if (order.status === 'CREATED') {
      const credentials = await this.settings.wechatCredentials();
      if (credentials.configured) {
        try {
          const txn = await this.pay.query(credentials, orderNo);
          if (txn.trade_state === 'SUCCESS') await this.settlePay(txn);
          else if (
            ['CLOSED', 'REVOKED', 'PAYERROR'].includes(String(txn.trade_state))
          ) {
            await this.prisma.pointCardOrder.update({
              where: { id: order.id },
              data: { status: 'CLOSED' },
            });
          }
        } catch {
          // 查单失败不阻断，保持 CREATED 让前端继续轮询
        }
      }
    }
    const fresh = await this.prisma.pointCardOrder.findUnique({
      where: { id: order.id },
    });
    const status = fresh?.status || order.status;
    const card = fresh?.userCardId
      ? await this.prisma.pointUserCard.findUnique({
          where: { id: fresh.userCardId },
        })
      : null;
    const names = card
      ? await this.modelNames([card])
      : new Map<string, string>();
    return {
      orderNo,
      status,
      statusLabel: ORDER_STATUS_LABELS[status] ?? status,
      amountCents: order.amountCents,
      issuedAt: isoOr(fresh?.issuedAt),
      card: card
        ? buildCardView(
            card,
            names.get(modelPair(card.provider, card.modelKey)) || card.modelKey,
          )
        : null,
    };
  }

  /** 关单（并入既有日批）：超时仍 CREATED 的现金单先查单兜底，再向微信关单。 */
  async closeCashOrders(olderThan: Date) {
    const stale = await this.prisma.pointCardOrder.findMany({
      where: {
        kind: 'CARD_CASH',
        status: 'CREATED',
        createdAt: { lt: olderThan },
      },
      take: 200,
    });
    const credentials = await this.settings.wechatCredentials();
    let closed = 0;
    for (const order of stale) {
      if (credentials.configured) {
        try {
          const txn = await this.pay.query(credentials, order.orderNo);
          if (txn.trade_state === 'SUCCESS') {
            await this.settlePay(txn);
            continue;
          }
          await this.pay.close(credentials, order.orderNo);
        } catch {
          // 关单失败下轮再试
        }
      }
      await this.prisma.pointCardOrder.update({
        where: { id: order.id },
        data: { status: 'CLOSED' },
      });
      closed += 1;
    }
    return closed;
  }

  // ---------------------------------------------------------- 撤销与过期

  /**
   * 后台撤销：已消耗不退，未用额度默认不退现金；勾选补偿时按剩余比例折积分入账（需密码确认）。
   * 补偿金额 = 规格积分价 × 剩余 / 总额度，与「买这张卡花多少积分」同口径。
   */
  async revoke(user: CurrentUser, cardIdRaw: string, body: Row) {
    this.scope.requirePlatformAdmin(user);
    await assertSensitivePassword(
      this.prisma,
      user.userId,
      body.password,
      '撤销时长卡',
    );
    const id = asInt(cardIdRaw);
    const found = await this.prisma.pointUserCard.findUnique({ where: { id } });
    if (!found) throw new BusinessException(ErrorCode.NOT_FOUND, '卡不存在');
    const card =
      found.status === 'REVOKED'
        ? found
        : await this.prisma.pointUserCard.update({
            where: { id },
            data: { status: 'REVOKED' },
          });
    let compensatedPoints = 0;
    if (body.compensate === true) {
      const template = await this.prisma.pointCardTemplate.findUnique({
        where: { id: card.templateId },
        select: { pointsPrice: true },
      });
      const price = toNum(template?.pointsPrice);
      const total = toNum(card.quotaTotal);
      const remaining = amount(Math.max(0, total - toNum(card.quotaUsed)));
      compensatedPoints =
        price > 0 && total > 0 && remaining > 0
          ? amount((price * remaining) / total)
          : 0;
      if (compensatedPoints > 0) {
        await this.points.credit(card.userId, 'EARN', compensatedPoints, {
          scene: 'card_compensate',
          refType: 'user_card',
          refId: String(card.id),
          operator: user.userId,
          remark: `撤销「${card.name}」按剩余 ${formatQuota(
            card.billingUnit,
            remaining,
          )} 补偿积分`,
        });
        await this.prisma.pointCardOrder.updateMany({
          where: { userCardId: card.id, status: 'ISSUED' },
          data: { status: 'REFUNDED' },
        });
      }
    }
    const summary = await this.points.summary(card.userId);
    const names = await this.modelNames([card]);
    return {
      card: buildCardView(
        card,
        names.get(modelPair(card.provider, card.modelKey)) || card.modelKey,
      ),
      compensatedPoints,
      balance: summary.balance,
    };
  }

  /** 过期刷状态：只为列表显示准确，谓词本身已排除过期卡。 */
  async expireCards() {
    const updated = await this.prisma.pointUserCard.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return updated.count;
  }

  // ------------------------------------------------------------ 内部工具

  /** 兑换码 / 积分 / 现金三个入口共用：按 code 取启用中的规格，并说明为什么不能用。 */
  async activeTemplate(codeRaw: string) {
    const code = asText(codeRaw).trim().toUpperCase();
    if (!code)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择卡规格');
    const row = await this.prisma.pointCardTemplate.findUnique({
      where: { code },
    });
    if (!row)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `卡规格「${code}」不存在，请先在后台「时长卡规格」里创建`,
      );
    if (row.status !== 'ACTIVE')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `卡规格「${row.name}」已停用，请选择其它规格`,
      );
    return row;
  }

  private async cardsOf(rows: OrderRow[]) {
    const ids = Array.from(
      new Set(
        rows
          .map((row) => row.userCardId)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    );
    if (!ids.length) return new Map<number, CardRow>();
    const found = await this.prisma.pointUserCard.findMany({
      where: { id: { in: ids } },
    });
    return new Map(found.map((row) => [row.id, row]));
  }

  /** 卡绑定模型的展示名：按 provider + modelKey 回查目录，目录改名后即时跟上。 */
  private async modelNames(
    rows: { provider: string; modelKey: string }[],
  ): Promise<Map<string, string>> {
    if (!rows.length) return new Map();
    const found = await this.prisma.modelCatalog.findMany({
      where: {
        OR: rows.map((row) => ({
          provider: row.provider,
          modelKey: row.modelKey,
        })),
      },
      select: { provider: true, modelKey: true, displayName: true },
    });
    return new Map(
      found.map((row) => [
        modelPair(row.provider, row.modelKey),
        row.displayName || row.modelKey,
      ]),
    );
  }

  private async catalogNames(ids: number[]) {
    const unique = Array.from(
      new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (!unique.length) return new Map<number, string>();
    const rows = await this.prisma.modelCatalog.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true, modelKey: true },
    });
    return new Map(
      rows.map((row) => [row.id, row.displayName || row.modelKey]),
    );
  }
}

/**
 * 卡订单与充值回调分开：同域名下换独立的 notify 路径，两侧各自排障、互不吞单。
 * 配置里给的是别的路径时原样返回，由路由注册决定归属。
 */
export function cardNotifyUrl(notifyUrl: string) {
  const raw = asText(notifyUrl).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.pathname = '/api/pay/card/notify';
    return url.toString();
  } catch {
    return raw;
  }
}
