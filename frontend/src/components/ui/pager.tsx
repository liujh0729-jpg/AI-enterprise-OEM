"use client";

import { Pagination } from "antd";
import { useEffect, useRef, useState } from "react";

/**
 * 游标列表的分页外壳（2026-11-09 用户口径：列表做分页，不要一直往下加载）。
 *
 * 上游挂单列表只给 `nextCursor` / `hasMore`（没有总数），所以分页在**累积行**上做：
 * 每页 `pageSize` 行，翻到还没加载的页时自动把下一段游标页取回来 —— 用户看到的是有页码、
 * 有边界的列表，而不是无限变长、右侧一直冒纵向滚动条的长列表。
 * `pageSize` 取接口一页的行数（20），一次翻页正好对应一段游标页，不会出现半页。
 */
export function useCursorPages<Row>(options: {
  rows: Row[];
  hasMore: boolean;
  /** 取下一段游标页（页面侧须给稳定引用，避免 effect 反复触发）。 */
  fetchNext: () => Promise<unknown> | void;
  isFetchingNext: boolean;
  /** 筛选条件的稳定序列化：变化时回到第一页。 */
  resetKey?: string;
  pageSize?: number;
}) {
  const {
    rows,
    hasMore,
    fetchNext,
    isFetchingNext,
    resetKey,
    pageSize = 20,
  } = options;
  const [page, setPage] = useState(1);
  /** 已自动取过的目标页行数上界：空页 + hasMore 时不至于死循环。 */
  const attempted = useRef(0);
  useEffect(() => {
    setPage(1);
    attempted.current = 0;
  }, [resetKey]);
  const need = page * pageSize;
  useEffect(() => {
    if (!hasMore || isFetchingNext || rows.length >= need) return;
    if (attempted.current >= need) return;
    attempted.current = need;
    void fetchNext();
  }, [fetchNext, hasMore, isFetchingNext, need, rows.length]);
  const total = hasMore ? rows.length + 1 : rows.length;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > maxPage) setPage(maxPage);
  }, [maxPage, page]);
  return {
    page,
    pageSize,
    /** 当前页要渲染的行 */
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    /** 已加载的行数（提示文案用，平台不给真总数） */
    loaded: rows.length,
    total,
    setPage,
  };
}

/** 列表底部的分页条：行末右对齐（与全站 `<Pagination>` 口径一致）。空列表不出分页条。 */
export function TablePager({
  page,
  pageSize,
  total,
  loaded,
  hasMore,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  loaded: number;
  hasMore: boolean;
  onChange: (page: number) => void;
}) {
  if (loaded === 0 && !hasMore) return null;
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
      <Pagination
        current={page}
        pageSize={pageSize}
        total={total}
        showSizeChanger={false}
        showTotal={() => (hasMore ? `已加载 ${loaded} 条` : `共 ${loaded} 条`)}
        onChange={onChange}
      />
    </div>
  );
}
