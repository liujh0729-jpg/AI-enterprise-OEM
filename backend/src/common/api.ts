import type { ApiResponse, PageResponse } from '@enterprise/contracts';
export type { ApiResponse, PageResponse } from '@enterprise/contracts';
export function pageParam(
  page?: number | string,
  pageSize?: number | string,
  fallback = 20,
) {
  const pageNo = Number(page || 1);
  const size = Number(pageSize ?? fallback);
  // 页码封顶：Prisma 的 skip 走 32 位整数，`page × pageSize` 越界会让数据库直接报错，
  // 用户看到的就成了 500 而不是空列表。
  const normalizedPageNo =
    Number.isFinite(pageNo) && pageNo > 0
      ? Math.min(Math.floor(pageNo), 100_000)
      : 1;
  const normalizedPageSize =
    Number.isFinite(size) && size > 0
      ? Math.min(Math.floor(size), 200)
      : fallback;
  return {
    page: normalizedPageNo,
    pageSize: normalizedPageSize,
    offset: (normalizedPageNo - 1) * normalizedPageSize,
  };
}
/**
 * 不分页清单（账号列表这类一次取全的接口）的读取封顶，与 pageQuery 的 pageSize
 * 上限一致；超出部分需要分页或筛选，接口不会报错也不会全量搬。
 */
export const LIST_ALL_LIMIT = 200;
export function pageOf<T>(
  list: T[],
  total: number,
  page: number,
  pageSize: number,
): PageResponse<T> {
  return { list, total, page, pageSize };
}
export function ok<T>(data: T | null = null, message = 'ok'): ApiResponse<T> {
  return { code: 0, message, data };
}
/**
 * 未知值 → 文本列。请求体 / 上游报文的值是 `unknown`，直接 `String(...)` 会把对象
 * 变成 `[object Object]` 当成有效内容写库、给界面、发上游；这里对象一律取 fallback。
 * 标量数组按逗号拼接（与历史 `String(['a','b'])` = `'a,b'` 保持一致，不丢数据）。
 */
export function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter((item) => item !== '')
      .join(',');
  }
  return fallback;
}
