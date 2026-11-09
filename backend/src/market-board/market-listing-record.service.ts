import type { Prisma } from '../../generated/prisma';
import { text } from '../common/api';
import { PrismaService } from '../prisma/prisma.service';
import type { MarketListing } from '../aiworkin/aiworkin.types';

/** 一个板块方向（域 + 需求/服务）的本地发布台账写入载荷。 */
export type MarketRecordInput = {
  /** 发布人（本系统账号 id） */
  userId: string;
  /** 发布板块：TAX / SUPPLY / OVERSEAS / HUB */
  domain: string;
  direction: 'DEMAND' | 'SUPPLY';
  /** AIworkin 平台挂单 UUID（发布返回的内容 ID） */
  listingId: string;
  matchRunId?: string;
  status?: string;
  title?: string;
  subCategoryId?: string;
  /** 提交报文快照：平台读不回（草稿 / 已下架）时用它回显 */
  snapshot?: object;
};

/**
 * 平台直连板块（财税 / 供销 / 出海 / 供需市场）的本地发布台账。
 *
 * 为什么必须有它：平台把写出收口到 MCP（REST 写 PATCH/DELETE 对 API Key 一律 401），
 * 且没有「按属主读回挂单」的接口（`/market/listings/mine` 对 API Key 也一律 401）。
 * 因此发布后把平台挂单号（listingId）落一行到本表，「我发布的」列表以本表为准，
 * 再按挂单号逐个读回平台挂单（读单条可用 API Key）。
 */
export class MarketListingRecordService {
  constructor(private readonly prisma: PrismaService) {}

  /** 幂等写入：同一账号同一挂单号只留一行（重复提交按平台挂单号覆盖）。 */
  async record(input: MarketRecordInput) {
    const data = {
      domain: input.domain,
      direction: input.direction,
      matchRunId: input.matchRunId || '',
      status: input.status || 'ONLINE',
      title: text(input.title).slice(0, 200),
      subCategoryId: input.subCategoryId || '',
      snapshot: (input.snapshot || {}) as Prisma.InputJsonValue,
    };
    return this.prisma.marketListingRecord.upsert({
      where: {
        userId_listingId: { userId: input.userId, listingId: input.listingId },
      },
      create: { userId: input.userId, listingId: input.listingId, ...data },
      update: data,
    });
  }

  /** 某账号在某板块某方向的全部发布记录（新发布的在前）。 */
  async list(userId: string, domain: string, direction: 'DEMAND' | 'SUPPLY') {
    return this.prisma.marketListingRecord.findMany({
      where: { userId, domain, direction },
      orderBy: { id: 'desc' },
    });
  }

  /** 单条发布记录（同时用作「是不是本人发的」判据）。 */
  async find(userId: string, listingId: string) {
    return this.prisma.marketListingRecord.findUnique({
      where: { userId_listingId: { userId, listingId } },
    });
  }
}

/** 台账行 → 挂单行：快照即发布报文，读不回平台时直接拿它渲染列表与明细。 */
export function recordToListing(
  row: {
    listingId: string;
    status: string;
    subCategoryId: string;
    snapshot: Prisma.JsonValue;
    createdAt: Date;
    direction: string;
  },
  domain: string,
): MarketListing {
  const snapshot =
    row.snapshot &&
    typeof row.snapshot === 'object' &&
    !Array.isArray(row.snapshot)
      ? (row.snapshot as Record<string, unknown>)
      : {};
  return {
    ...snapshot,
    id: row.listingId,
    direction: row.direction,
    status: row.status,
    subcategoryId: row.subCategoryId,
    // 平台直连板块的挂单归属由本系统台账判定，这里带上板块，便于跨板块复用同一映射
    attributes: {
      ...(snapshot.attributes as Record<string, unknown> | undefined),
      board: domain,
    },
    createdAt: row.createdAt.toISOString(),
  };
}
