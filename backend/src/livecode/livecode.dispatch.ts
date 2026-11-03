import type { MarketingQrChild, MarketingQrCode } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { visitorHash } from './livecode-cookie';

export type DispatchResult = {
  child: MarketingQrChild | null;
  /** SHOWN | FALLBACK | EMPTY | LIMITED | DISABLED */
  result: string;
  /** 命中的访客 id（用于写 Cookie） */
  visitorId: string;
};

const shanghaiDate = () => {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
};

const deviceOf = (ua: string) => {
  const value = ua.toLowerCase();
  if (/iphone|ipad|ipod|ios/.test(value)) return 'iOS';
  if (/android/.test(value)) return 'Android';
  if (/micromessenger/.test(value)) return 'WeChat';
  return 'PC';
};

const weightedPick = <T extends { weight: number }>(rows: T[]): T =>
  rows[
    (() => {
      const total = rows.reduce(
        (sum, item) => sum + Math.max(0, item.weight),
        0,
      );
      if (total <= 0) return Math.floor(Math.random() * rows.length);
      let point = Math.random() * total;
      for (let index = 0; index < rows.length; index += 1) {
        point -= Math.max(0, rows[index].weight);
        if (point <= 0) return index;
      }
      return rows.length - 1;
    })()
  ];

/** 条件自增：先按天归零，再在限额内自增；返回 false 表示已用尽。 */
async function bump(
  tx: PrismaService,
  table: 'marketingQrChild' | 'marketingQrCode',
  id: number,
  dailyLimit: number,
  totalLimit: number,
) {
  const today = shanghaiDate();
  const model = tx[table] as unknown as {
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  await model.updateMany({
    where: { id, todayDate: { not: today } },
    data: { todayDate: today, todayCount: 0 },
  });
  const where: Record<string, unknown> = { id };
  if (dailyLimit > 0) where.todayCount = { lt: dailyLimit };
  if (totalLimit > 0) where.totalCount = { lt: totalLimit };
  const updated = await model.updateMany({
    where,
    data: { todayCount: { increment: 1 }, totalCount: { increment: 1 } },
  });
  return updated.count === 1;
}

/** 子码的生效限额：INHERIT/NONE＝不单独限制（父码计数已兜住）。 */
const childLimits = (child: MarketingQrChild) => ({
  daily: child.limitScope === 'DAILY' ? child.dailyLimit : 0,
  total: child.limitScope === 'TOTAL' ? child.totalLimit : 0,
});

export type DispatchInput = {
  channel: string;
  stickyChildId: number;
  visitorId: string;
  ipHash: string;
  ua: string;
  region: string;
  domainId: number;
};

/**
 * 分发：父码限额 → 渠道优先 → 子码限额 → 粘性 → 随机/顺序/权重。
 * 限额与计数在同一条条件更新里完成，避免并发超发。
 */
export async function dispatch(
  prisma: PrismaService,
  code: MarketingQrCode,
  input: DispatchInput,
): Promise<DispatchResult> {
  if (code.status === 'DISABLED') {
    return { child: null, result: 'DISABLED', visitorId: input.visitorId };
  }
  if (code.status === 'PAUSED') {
    return { child: null, result: 'LIMITED', visitorId: input.visitorId };
  }
  const children = await prisma.marketingQrChild.findMany({
    where: { codeId: code.id, status: 'ACTIVE' },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const scoped = input.channel
    ? children.filter((item) => item.channel === input.channel)
    : [];
  const pool = scoped.length
    ? scoped
    : children.filter((item) => !item.channel);
  if (!pool.length) {
    await prisma.marketingQrScan.create({
      data: {
        codeId: code.id,
        domainId: input.domainId,
        channel: input.channel.slice(0, 32),
        visitorHash: visitorHash(input.visitorId),
        ipHash: input.ipHash,
        ua: input.ua.slice(0, 255),
        region: input.region.slice(0, 32),
        device: deviceOf(input.ua),
        result: 'EMPTY',
      },
    });
    return { child: null, result: 'EMPTY', visitorId: input.visitorId };
  }
  const ordered = [...pool];
  if (code.selectMode === 'ORDER') {
    const start = code.cursor % ordered.length;
    ordered.splice(0, 0, ...ordered.splice(start));
  } else if (code.selectMode === 'WEIGHT') {
    const first = weightedPick(ordered);
    ordered.splice(0, 0, ...ordered.splice(ordered.indexOf(first), 1));
  } else {
    ordered.sort(() => Math.random() - 0.5);
  }
  // 粘性优先：同一访客固定拿同一个子码（子码仍可用时）
  const sticky =
    input.stickyChildId > 0
      ? ordered.find((item) => item.id === input.stickyChildId)
      : undefined;
  const candidates = sticky
    ? [sticky, ...ordered.filter((item) => item.id !== sticky.id)]
    : ordered;

  for (
    let attempt = 0;
    attempt < Math.min(3, candidates.length);
    attempt += 1
  ) {
    const child = candidates[attempt];
    const done = await prisma.$transaction(async (tx) => {
      const parentOk = await bump(
        tx as unknown as PrismaService,
        'marketingQrCode',
        code.id,
        code.limitScope === 'DAILY' ? code.dailyLimit : 0,
        code.limitScope === 'TOTAL' ? code.totalLimit : 0,
      );
      if (!parentOk) return false;
      const limits = childLimits(child);
      const childOk = await bump(
        tx as unknown as PrismaService,
        'marketingQrChild',
        child.id,
        limits.daily,
        limits.total,
      );
      if (!childOk) {
        throw new Error('CHILD_LIMITED');
      }
      if (code.selectMode === 'ORDER') {
        await tx.marketingQrCode.update({
          where: { id: code.id },
          data: { cursor: { increment: 1 } },
        });
      }
      await tx.marketingQrScan.create({
        data: {
          codeId: code.id,
          childId: child.id,
          domainId: input.domainId,
          channel: input.channel.slice(0, 32),
          visitorHash: visitorHash(input.visitorId),
          ipHash: input.ipHash,
          ua: input.ua.slice(0, 255),
          region: input.region.slice(0, 32),
          device: deviceOf(input.ua),
          result: 'SHOWN',
        },
      });
      return true;
    });
    if (done) {
      return { child, result: 'SHOWN', visitorId: input.visitorId };
    }
    // 父码限额已用尽：走兜底
    break;
  }

  // 兜底子码：不占限额额度，只用于「已结束」场景
  if (code.fallbackChildId > 0) {
    const fallback = await prisma.marketingQrChild.findFirst({
      where: { id: code.fallbackChildId, codeId: code.id, status: 'ACTIVE' },
    });
    if (fallback) {
      await prisma.marketingQrScan.create({
        data: {
          codeId: code.id,
          childId: fallback.id,
          domainId: input.domainId,
          channel: input.channel.slice(0, 32),
          visitorHash: visitorHash(input.visitorId),
          ipHash: input.ipHash,
          ua: input.ua.slice(0, 255),
          region: input.region.slice(0, 32),
          device: deviceOf(input.ua),
          result: 'FALLBACK',
        },
      });
      return {
        child: fallback,
        result: 'FALLBACK',
        visitorId: input.visitorId,
      };
    }
  }
  await prisma.marketingQrScan.create({
    data: {
      codeId: code.id,
      domainId: input.domainId,
      channel: input.channel.slice(0, 32),
      visitorHash: visitorHash(input.visitorId),
      ipHash: input.ipHash,
      ua: input.ua.slice(0, 255),
      region: input.region.slice(0, 32),
      device: deviceOf(input.ua),
      result: 'LIMITED',
    },
  });
  return { child: null, result: 'LIMITED', visitorId: input.visitorId };
}
