import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
/**
 * 资源库展示口径（2026-09-24 起取消资源级审核）：**服务商备案通过即展示、类目停用即下线**。
 * 「备案通过」＝ provider_applications 中该类目 status=APPROVED 的服务商账号。
 */
export function approvedProviderIds(
  prisma: PrismaService,
  providerType: string,
): Promise<string[]> {
  return prisma.providerApplication
    .findMany({
      where: { providerType, status: 'APPROVED' },
      select: { userId: true },
    })
    .then((rows) => rows.map((row) => row.userId));
}
/** 资源库列表状态过滤：存量「不再展示 / 已驳回」保持不展示。 */
export const RESOURCE_VISIBLE_STATUS = { notIn: ['HIDDEN', 'REJECTED'] };
/** 资源库关键词匹配的三列（三库同名列：名称 / 机构 / 简介）。 */
export type ResourceKeyword = Partial<
  Record<
    'name' | 'organization' | 'intro',
    {
      contains: string;
    }
  >
>;
/**
 * 资源库筛选（2026-09-25 收口）：**只有省、市、关键词** —— 市未选省时不生效，
 * 未填省市的资源不参与省市匹配（与名录同口径）。
 */
export function resourceRegionScope(query: {
  province?: unknown;
  city?: unknown;
}): {
  province?: string;
  city?: string;
} {
  const province = text(query.province).trim();
  const city = text(query.city).trim();
  return {
    ...(province ? { province } : {}),
    ...(province && city ? { city } : {}),
  };
}
/** 关键词命中的任一列即算匹配；空关键词返回空数组（调用方据长度决定是否加 AND）。 */
export function resourceKeywordOr(keyword: unknown): ResourceKeyword[] {
  const kw = text(keyword).trim();
  if (!kw) return [];
  return [
    { name: { contains: kw } },
    { organization: { contains: kw } },
    { intro: { contains: kw } },
  ];
}
/** 资源改删权限：仅登记人（或归属服务商）与平台管理员。 */
export function assertResourceOwned(owned: boolean, isAdmin: boolean): void {
  if (owned || isAdmin) return;
  throw new BusinessException(
    ErrorCode.ROLE_MISMATCH,
    '仅登记人或平台管理员可操作该资源',
  );
}
/** 资源已被签约 / 业务单据引用时不可删除（三库同口径，计数与措辞由调用方给出）。 */
export function assertResourceNotReferenced(
  counts: number[],
  message: string,
): void {
  if (counts.some(Boolean)) {
    throw new BusinessException(ErrorCode.CONFLICT, message);
  }
}
