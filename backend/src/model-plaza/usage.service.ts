import type { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageOf, pageParam } from '../common/api';
import type { PointsService } from '../points/points.service';
import type { CardDeduct, CardService } from '../points/card.service';
import { multiplierNote } from '../points/card.pricing';
import {
  PLAZA_USAGE_CODE,
  ledgerPoints,
  toAmount,
} from './model-plaza.pricing';

const DAY_MS = 86_400_000;
const SUMMARY_ROW_CAP = 50_000;

export type PlazaSource = 'IN_APP' | 'API';

export type PlazaUsageLogInput = {
  userId: string;
  catalogId: number | null;
  upstreamId: number;
  provider: string;
  modelKey: string;
  source: PlazaSource;
  apiKeyId?: number | null;
  requestId?: string;
  refId?: string;
  endpoint?: string;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** 媒体类计量：图片张数 / 视频秒数 / 音频秒数 / 调用次数 */
  billingQuantity?: number;
  billingUnit?: string;
  pointsCost?: number;
  /** 本次从哪张时长卡扣的额度（null/0＝没用到卡）。 */
  userCardId?: number | null;
  cardDeduct?: number;
  rmbCost?: number;
  elapsedMs?: number;
  isStream?: boolean;
  status?: 'SUCCESS' | 'FAILED';
  message?: string;
};

export type PlazaChargeMeta = {
  modelKey: string;
  provider: string;
  catalogId: number | null;
  refId: string;
  source: PlazaSource;
  promptTokens: number;
  completionTokens: number;
};

/** 卡结算需要的本次用量事实：与广场计价同源，不另起一套采集口径。 */
export type PlazaCardUsage = {
  billingUnit: string;
  quantity?: number;
  tier?: Record<string, string | number | undefined>;
  /** 仅「调用前预估」用：真实扣费时一律以 meta 里的实际用量为准。 */
  promptTokens?: number;
  completionTokens?: number;
};

export type PlazaChargeResult = {
  /** 真实扣掉的积分（卡全覆盖时为 0）。 */
  points: number;
  /** 本次扣的是哪张卡（null＝没用到卡）。 */
  cardId: number | null;
  /** 从卡里实际扣掉的量（单位同 billingUnit，已含规格倍率）。 */
  cardDeduct: number;
  /** 倍率命中说明，写进用量日志供明细回显。 */
  cardNote: string;
};

function dayStart(daysAgo = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(start.getTime() - daysAgo * DAY_MS);
}

function dateKey(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 卡扣完后还差多少积分（D4=A：卡能扣多少扣多少，差额转积分）。
 * 按「剩余量 / 需求量」比例摊，卡至少承担自己那份对应积分，不会把整笔推给积分。
 */
function pointsOwedByCard(
  total: number,
  units: number,
  deduct: number,
): number {
  const amount = Number(total.toFixed(4));
  if (!(amount > 0)) return 0;
  if (!(units > 0) || !(deduct > 0)) return amount;
  if (deduct >= units) return 0;
  return ledgerPoints((amount * (units - deduct)) / units);
}

/**
 * 广场用量事实源：每次调用（站内试用 / 对外 API）都写一行 `model_usage_logs`，
 * 成功且应扣费时同步写一条 `usage_events`（code=model_plaza, billed=1, billTxId），
 * 让既有「AI 用量」页与积分账本口径一致。
 */
export class ModelUsageService {
  /**
   * 时长卡结算（扣费顺序卡 → 积分的唯一收口点）。
   * 由 services.ts 构造完成后回填：卡服务依赖积分设置与支付客户端，构造顺序在本服务之后。
   */
  cards: CardService | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
  ) {}

  /**
   * 调用前闸门：欠费或零余额先拒，避免烧掉上游额度却收不回积分。
   * 卡感知（4.6）：持有该模型可用卡时直接放行——卡是用户已经兑换/付费到的额度，
   * 欠费状态只约束积分侧。传不进模型上下文时退化成「有任何可用卡即放行」。
   */
  async assertCanCall(
    userId: string,
    model?: { provider: string; modelKey: string },
  ) {
    if (this.cards) {
      const usable = model
        ? await this.cards.hasUsableFor(userId, model.provider, model.modelKey)
        : (await this.cards.usableCards(userId)).length > 0;
      if (usable) return;
    }
    const summary = await this.points.summary(userId);
    if (summary.status === 'ARREARS') {
      throw new BusinessException(ErrorCode.POINTS_ARREARS);
    }
    if (summary.balance <= 0) {
      throw new BusinessException(ErrorCode.POINTS_INSUFFICIENT);
    }
  }

  /**
   * 本次调用「卡能承担多少」的只读预估：外部网关的积分闸门据此只对差额判余额，
   * 报错文案也能分别说清「卡额度不足」与「积分不足」。
   */
  async quoteCard(
    userId: string,
    meta: { provider: string; modelKey: string },
    usage: PlazaCardUsage | undefined,
    points: number,
  ): Promise<{ points: number; hasCard: boolean }> {
    if (!this.cards || !usage || !(points > 0)) {
      return { points, hasCard: false };
    }
    const quote = await this.cards
      .quote({
        userId,
        provider: meta.provider,
        modelKey: meta.modelKey,
        billingUnit: usage.billingUnit,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        quantity: usage.quantity,
        tier: usage.tier,
      })
      .catch(() => null);
    if (!quote) return { points, hasCard: false };
    return {
      points: pointsOwedByCard(points, quote.units, quote.remaining),
      hasCard: true,
    };
  }

  /**
   * 按实际用量扣分并记用量。先扣卡（能扣多少扣多少），差额才走积分；
   * 余额不足转欠费（与 AiEvalService.chargeByUsage 同口径），不抛错——
   * 调用已经发生，欠费记录比丢账更可追溯。
   */
  async charge(
    userId: string,
    points: number,
    meta: PlazaChargeMeta,
    usage?: PlazaCardUsage,
  ): Promise<PlazaChargeResult> {
    const amount = Number(points.toFixed(4));
    // 免费调用不消耗卡额度：卡是「量」的凭证，白送的调用白扣额度等于偷用户的额度。
    if (!(amount > 0)) {
      await this.writeUsageEvent(userId, 0, 0, meta, 0);
      return { points: 0, cardId: null, cardDeduct: 0, cardNote: '' };
    }
    const deduction = await this.deductCard(userId, meta, usage);
    const owed = deduction
      ? pointsOwedByCard(amount, deduction.units, deduction.deduct)
      : amount;
    if (deduction && !(owed > 0)) {
      // 卡全覆盖：走既有的「amount<=0 只写 billed=0 用量事件」分支，天然不留假积分流水。
      await this.writeUsageEvent(userId, 0, 0, meta, 0);
      return {
        points: 0,
        cardId: deduction.cardId,
        cardDeduct: deduction.deduct,
        cardNote: multiplierNote(deduction.units, deduction.deduct, deduction),
      };
    }
    try {
      const debit = await this.points.debit(userId, 'SPEND', owed, {
        scene: PLAZA_USAGE_CODE,
        refType: 'model',
        refId: meta.refId,
        remark: `模型广场 ${meta.modelKey}（${meta.source}）用量计费`,
      });
      await this.writeUsageEvent(userId, owed, debit.txId, meta, 1);
      return {
        points: owed,
        cardId: deduction?.cardId ?? null,
        cardDeduct: deduction?.deduct ?? 0,
        cardNote: deduction
          ? multiplierNote(deduction.units, deduction.deduct, deduction)
          : '',
      };
    } catch (error) {
      if (
        error instanceof BusinessException &&
        error.errorCode.code === ErrorCode.POINTS_INSUFFICIENT.code
      ) {
        await this.prisma.pointAccount
          .update({
            where: { userId },
            data: { status: 'ARREARS', arrearsSince: new Date() },
          })
          .catch(() => undefined);
        await this.writeUsageEvent(userId, 0, 0, meta, 0, '余额不足，转欠费');
        return {
          points: 0,
          cardId: deduction?.cardId ?? null,
          cardDeduct: deduction?.deduct ?? 0,
          cardNote: deduction
            ? multiplierNote(deduction.units, deduction.deduct, deduction)
            : '',
        };
      }
      throw error;
    }
  }

  /** 扣卡：只认卡上快照的量纲，绑不上模型或折算不出量就返回 null（整笔走积分）。 */
  private async deductCard(
    userId: string,
    meta: PlazaChargeMeta,
    usage?: PlazaCardUsage,
  ): Promise<CardDeduct | null> {
    if (!this.cards || !usage) return null;
    return this.cards.deduct({
      userId,
      provider: meta.provider,
      modelKey: meta.modelKey,
      billingUnit: usage.billingUnit,
      promptTokens: meta.promptTokens,
      completionTokens: meta.completionTokens,
      quantity: usage.quantity,
      tier: usage.tier,
    });
  }

  /** 用量事件（「AI 用量」页与账本的同源口径）：billed=0 表示本次没产生积分流水。 */
  private async writeUsageEvent(
    userId: string,
    amount: number,
    billTxId: number,
    meta: PlazaChargeMeta,
    billed: number,
    remark?: string,
  ) {
    await this.prisma.usageEvent
      .create({
        data: {
          userId,
          code: PLAZA_USAGE_CODE,
          quantityAmount: 1,
          occurredAt: new Date(),
          billed,
          billTxId,
          remark: (
            remark || `模型广场 ${meta.modelKey}（${meta.source}）`
          ).slice(0, 190),
          module: 'model_plaza',
          operation: meta.source === 'API' ? 'openai-api' : 'trial',
          model: meta.modelKey.slice(0, 128),
          tokenInAmount: meta.promptTokens,
          tokenOutAmount: meta.completionTokens,
          pointsAmount: amount,
        },
      })
      .catch(() => undefined);
  }

  async log(input: PlazaUsageLogInput) {
    const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0));
    const completionTokens = Math.max(
      0,
      Math.floor(input.completionTokens ?? 0),
    );
    const cacheReadTokens = Math.max(0, Math.floor(input.cacheReadTokens ?? 0));
    const cacheWriteTokens = Math.max(
      0,
      Math.floor(input.cacheWriteTokens ?? 0),
    );
    const row = await this.prisma.modelUsageLog.create({
      data: {
        userId: input.userId,
        catalogId: input.catalogId ?? null,
        upstreamId: input.upstreamId,
        provider: input.provider,
        modelKey: input.modelKey,
        source: input.source,
        apiKeyId: input.apiKeyId ?? null,
        requestId: (input.requestId || '').slice(0, 64),
        refId: (input.refId || '').slice(0, 64),
        endpoint: (input.endpoint || '').slice(0, 64),
        promptTokens,
        completionTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens:
          promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens,
        billingQuantity: Number((input.billingQuantity ?? 0).toFixed(6)),
        billingUnit: (input.billingUnit || '').slice(0, 16),
        pointsCost: Number((input.pointsCost ?? 0).toFixed(4)),
        userCardId: input.userCardId ?? null,
        cardDeduct: Number((input.cardDeduct ?? 0).toFixed(4)),
        rmbCost: Number((input.rmbCost ?? 0).toFixed(6)),
        elapsedMs: Math.max(0, Math.floor(input.elapsedMs ?? 0)),
        isStream: Boolean(input.isStream),
        status: input.status ?? 'SUCCESS',
        message: (input.message || '').slice(0, 200),
      },
    });
    return row;
  }

  /** 对外调用日限额：按 Key 统计当日已发生的调用行数（含失败，防刷）。 */
  async todayCallsByKey(apiKeyId: number) {
    return this.prisma.modelUsageLog.count({
      where: { apiKeyId, source: 'API', createdAt: { gte: dayStart() } },
    });
  }

  /** 对外调用累计消耗积分：按 Key 汇总 `model_usage_logs.points_cost`，用于「积分额度」闸门。 */
  async pointsUsedByKey(apiKeyId: number) {
    const row = await this.prisma.modelUsageLog.aggregate({
      where: { apiKeyId, source: 'API' },
      _sum: { pointsCost: true },
    });
    return Number(Number(row._sum.pointsCost ?? 0).toFixed(4));
  }

  async touchKey(apiKeyId: number) {
    await this.prisma.apiKey
      .updateMany({
        where: { id: apiKeyId },
        data: { callCount: { increment: 1 }, lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }

  /** 异步任务（视频/图像编辑/语音合成）回查上游：按任务号找到发起它的渠道。 */
  async upstreamOfTask(userId: string, taskId: string) {
    if (!taskId) return null;
    const row = await this.prisma.modelUsageLog.findFirst({
      where: { userId, refId: taskId },
      orderBy: { id: 'desc' },
      select: { upstreamId: true, provider: true, modelKey: true },
    });
    return row;
  }

  private logView(
    row: {
      id: number;
      modelKey: string;
      provider: string;
      source: string;
      endpoint: string;
      promptTokens: number;
      completionTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalTokens: number;
      billingQuantity: unknown;
      billingUnit: string;
      pointsCost: unknown;
      rmbCost: unknown;
      elapsedMs: number;
      isStream: boolean;
      status: string;
      message: string;
      requestId: string;
      createdAt: Date;
      catalogId: number | null;
    },
    names: Map<number, string>,
  ) {
    return {
      id: row.id,
      modelKey: row.modelKey,
      displayName: (row.catalogId && names.get(row.catalogId)) || row.modelKey,
      provider: row.provider,
      source: row.source === 'API' ? 'API' : 'IN_APP',
      endpoint: row.endpoint,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      totalTokens: row.totalTokens,
      billingQuantity: toAmount(row.billingQuantity),
      billingUnit: row.billingUnit || '',
      pointsCost: toAmount(row.pointsCost),
      rmbCost: toAmount(row.rmbCost),
      elapsedMs: row.elapsedMs,
      isStream: row.isStream,
      status: row.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      message: row.message,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async nameMap(ids: number[]) {
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

  private async aggregate(where: Record<string, unknown>) {
    const rows = await this.prisma.modelUsageLog.findMany({
      where,
      select: {
        source: true,
        modelKey: true,
        provider: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        pointsCost: true,
        rmbCost: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: SUMMARY_ROW_CAP,
    });
    const byModel = new Map<
      string,
      {
        modelKey: string;
        provider: string;
        calls: number;
        totalTokens: number;
        pointsCost: number;
      }
    >();
    const bySource = new Map<
      string,
      { source: string; calls: number; totalTokens: number; pointsCost: number }
    >();
    const daily = new Map<
      string,
      { date: string; calls: number; totalTokens: number; pointsCost: number }
    >();
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let pointsCost = 0;
    let rmbCost = 0;
    let successCalls = 0;
    for (const row of rows) {
      promptTokens += row.promptTokens;
      completionTokens += row.completionTokens;
      totalTokens += row.totalTokens;
      pointsCost += toAmount(row.pointsCost);
      rmbCost += toAmount(row.rmbCost);
      if (row.status === 'SUCCESS') successCalls += 1;
      const modelKey = `${row.provider}\u0000${row.modelKey}`;
      const model = byModel.get(modelKey) ?? {
        modelKey: row.modelKey,
        provider: row.provider,
        calls: 0,
        totalTokens: 0,
        pointsCost: 0,
      };
      model.calls += 1;
      model.totalTokens += row.totalTokens;
      model.pointsCost += toAmount(row.pointsCost);
      byModel.set(modelKey, model);
      const source = bySource.get(row.source) ?? {
        source: row.source,
        calls: 0,
        totalTokens: 0,
        pointsCost: 0,
      };
      source.calls += 1;
      source.totalTokens += row.totalTokens;
      source.pointsCost += toAmount(row.pointsCost);
      bySource.set(row.source, source);
      const key = dateKey(row.createdAt);
      const day = daily.get(key) ?? {
        date: key,
        calls: 0,
        totalTokens: 0,
        pointsCost: 0,
      };
      day.calls += 1;
      day.totalTokens += row.totalTokens;
      day.pointsCost += toAmount(row.pointsCost);
      daily.set(key, day);
    }
    return {
      calls: rows.length,
      successCalls,
      promptTokens,
      completionTokens,
      totalTokens,
      pointsCost: Number(pointsCost.toFixed(4)),
      rmbCost: Number(rmbCost.toFixed(6)),
      byModel: Array.from(byModel.values())
        .sort((a, b) => b.calls - a.calls)
        .map((row) => ({
          ...row,
          pointsCost: Number(row.pointsCost.toFixed(4)),
        })),
      bySource: Array.from(bySource.values()).map((row) => ({
        ...row,
        pointsCost: Number(row.pointsCost.toFixed(4)),
      })),
      daily: Array.from(daily.values()).sort((a, b) =>
        a.date < b.date ? -1 : 1,
      ),
    };
  }

  private rangeWhere(query: { from: string; to: string }) {
    const gte = query.from ? new Date(query.from) : null;
    const lte = query.to ? new Date(query.to) : null;
    const where: Record<string, unknown> = {};
    if (gte && !Number.isNaN(gte.getTime())) where.gte = gte;
    if (lte && !Number.isNaN(lte.getTime())) {
      // 只给日期时把当天算完整
      const end = new Date(lte);
      end.setHours(23, 59, 59, 999);
      where.lte = end;
    }
    return Object.keys(where).length ? where : undefined;
  }

  async userList(
    userId: string,
    query: {
      page: number;
      pageSize: number;
      source: 'ALL' | PlazaSource;
      modelKey: string;
      from: string;
      to: string;
    },
  ) {
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize);
    const range = this.rangeWhere(query);
    const where = {
      userId,
      ...(query.source === 'ALL' ? {} : { source: query.source }),
      ...(query.modelKey ? { modelKey: query.modelKey } : {}),
      ...(range ? { createdAt: range } : {}),
    };
    const [rows, total, summary] = await Promise.all([
      this.prisma.modelUsageLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.modelUsageLog.count({ where }),
      this.aggregate(where),
    ]);
    const names = await this.nameMap(rows.map((row) => row.catalogId ?? 0));
    return {
      ...pageOf(
        rows.map((row) => this.logView(row, names)),
        total,
        page,
        pageSize,
      ),
      summary,
    };
  }

  async userSummary(userId: string, days: number) {
    const since = dayStart(Math.max(0, days - 1));
    return this.aggregate({ userId, createdAt: { gte: since } });
  }

  async adminList(query: {
    page: number;
    pageSize: number;
    source: 'ALL' | PlazaSource;
    modelKey: string;
    from: string;
    to: string;
    userId: string;
  }) {
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize);
    const range = this.rangeWhere(query);
    const where = {
      ...(query.source === 'ALL' ? {} : { source: query.source }),
      ...(query.modelKey ? { modelKey: query.modelKey } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(range ? { createdAt: range } : {}),
    };
    const [rows, total, summary] = await Promise.all([
      this.prisma.modelUsageLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.modelUsageLog.count({ where }),
      this.aggregate(where),
    ]);
    const names = await this.nameMap(rows.map((row) => row.catalogId ?? 0));
    const userIds = Array.from(new Set(rows.map((row) => row.userId)));
    const numericIds = userIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const accounts = numericIds.length
      ? await this.prisma.account.findMany({
          where: { id: { in: numericIds } },
          select: { id: true, username: true },
        })
      : [];
    const userNames = new Map(
      accounts.map((account) => [String(account.id), account.username]),
    );
    return {
      ...pageOf(
        rows.map((row) => ({
          ...this.logView(row, names),
          userId: row.userId,
          userName: userNames.get(row.userId) || row.userId,
        })),
        total,
        page,
        pageSize,
      ),
      summary,
    };
  }
}
