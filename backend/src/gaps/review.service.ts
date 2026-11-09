import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { GapScopeService } from './gaps.scope';
import {
  asInt,
  asText,
  clip,
  iso,
  pageParams,
  Row,
  safeStatus,
} from './gaps.helpers';

const TYPES = ['DEMAND', 'SUPPLY'] as const;

/**
 * B3#22③ 服务评价：挂市场挂单（listingId）的星级+文字评价。
 * 组织管理员可隐藏/删除本组织名下任一条；普通成员只能改删自己写的。
 */
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private view(row: {
    id: number;
    listingId: string;
    listingType: string;
    rating: number;
    content: string;
    reviewerName: string;
    reviewerUserId: string;
    orderRef: string;
    status: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      listingId: row.listingId,
      listingType: row.listingType,
      rating: row.rating,
      content: row.content,
      reviewerName: row.reviewerName,
      reviewerUserId: row.reviewerUserId,
      orderRef: row.orderRef,
      status: row.status,
      createdAt: iso(row.createdAt),
    };
  }

  async reviews(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = pageParams(query);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      status: 'VISIBLE',
      ...(asText(query.listingId).trim()
        ? { listingId: asText(query.listingId).trim() }
        : {}),
      ...(asText(query.listingType).trim()
        ? { listingType: safeStatus(query.listingType, TYPES, 'SUPPLY') }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.marketServiceReview.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.marketServiceReview.count({ where }),
    ]);
    return { list: rows.map((row) => this.view(row)), total, page, pageSize };
  }

  private async owned(user: CurrentUser, idRaw: number) {
    const org = await this.scope.resolve(user);
    const row = await this.prisma.marketServiceReview.findFirst({
      where: {
        id: asInt(idRaw),
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '评价不存在');
    if (row.reviewerUserId !== org.actorId) this.scope.requireAdminFor(org);
    return { org, row };
  }

  async saveReview(user: CurrentUser, body: Row) {
    const org = await this.scope.resolve(user);
    const listingId = clip(body.listingId, 64).trim();
    if (!listingId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要评价的对象');
    const id = asInt(body.id);
    const rating = Math.min(5, Math.max(1, asInt(body.rating, 5) || 5));
    const data = {
      listingId,
      listingType: safeStatus(body.listingType, TYPES, 'SUPPLY'),
      rating,
      content: clip(body.content, 1000),
      reviewerName: clip(body.reviewerName, 64) || org.actorId,
      orderRef: clip(body.orderRef, 64),
    };
    const existing = id
      ? await this.prisma.marketServiceReview.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '评价不存在');
    if (existing && existing.reviewerUserId !== org.actorId)
      this.scope.requireAdminFor(org);
    const row = existing
      ? await this.prisma.marketServiceReview.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.marketServiceReview.create({
          data: {
            ...data,
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            reviewerUserId: org.actorId,
          },
        });
    return this.view(row);
  }

  async removeReview(user: CurrentUser, idRaw: number) {
    const { row } = await this.owned(user, idRaw);
    await this.prisma.marketServiceReview.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async summary(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const listingId = asText(query.listingId).trim();
    if (!listingId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请指定挂单');
    const listingType = safeStatus(query.listingType, TYPES, 'SUPPLY');
    const rows = await this.prisma.marketServiceReview.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        listingId,
        listingType,
        status: 'VISIBLE',
      },
      select: { rating: true },
    });
    const distribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: rows.filter((row) => row.rating === rating).length,
    }));
    const total = rows.length;
    const average = total
      ? Number(
          (rows.reduce((sum, row) => sum + row.rating, 0) / total).toFixed(2),
        )
      : 0;
    return { listingId, listingType, average, count: total, distribution };
  }
}
