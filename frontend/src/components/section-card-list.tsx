"use client";

import { TagOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/panel";

/** 名录分区卡片：进页面默认只摆最新入驻的 3 家，「查看更多」在本分区内补齐到最多 5 家，全量走分区头「更多」。 */
export const SECTION_INLINE = 3;
export const SECTION_MAX = 5;

/** 名录细项完整清单页地址（2026-09-25 用户指令：点「更多」进新页面，不弹层）。 */
export function directoryListHref(type: string) {
  return `/providers/${type}`;
}

/** 分区标题右上角的「更多」＝跳转到该分类的服务商列表页（每个有二级分类的板块都有，不论几家）。 */
export function SectionMoreButton({ type }: { type: string }) {
  const router = useRouter();
  return (
    <Button onClick={() => router.push(directoryListHref(type))}>更多</Button>
  );
}

/** 名录统一排序口径：按「最新入驻」＝备案通过时间倒序，无时间的排在最后。 */
export function newestFirst<T>(
  items: T[],
  newestAtOf: (item: T) => string | undefined,
) {
  return [...items].sort((a, b) =>
    (newestAtOf(b) || "").localeCompare(newestAtOf(a) || ""),
  );
}

/**
 * 服务商名录「一个分类一个分区」的卡片区（全站统一口径）：
 * ①按「最新入驻」＝备案通过时间倒序；②默认展示最新 3 家；③「查看更多」补齐到最多 5 家（可「收起」）；
 * ④**该分类的完整清单在独立页面**（2026-09-25 用户指令「点击更多应该是进入新页面而不要弹出层」），
 *   由分区标题右上角的「更多」跳转 `directoryListHref(type)`，本页组件不再持有弹窗状态；
 * ⑤不足 4 家不出「查看更多」控件，但「更多」始终在（每一个分类都能进列表页看全量）。
 * `renderCard` 返回的元素需自带 key。
 */
export function SectionCardList<T>({
  items,
  newestAtOf,
  renderCard,
  emptyText,
  emptyIcon = <TagOutlined aria-hidden />,
}: {
  items: T[];
  /** 该行「入驻」时间（ISO 字符串）；缺省视为最早，排在最后。 */
  newestAtOf: (item: T) => string | undefined;
  renderCard: (item: T) => ReactNode;
  emptyText?: string;
  emptyIcon?: ReactNode;
}) {
  const sorted = useMemo(
    () => newestFirst(items, newestAtOf),
    [items, newestAtOf],
  );
  const [expanded, setExpanded] = useState(false);
  const total = sorted.length;

  if (!total) {
    return emptyText ? (
      <EmptyState icon={emptyIcon} text={emptyText} />
    ) : null;
  }

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
        }}
      >
        {sorted.slice(0, expanded ? SECTION_MAX : SECTION_INLINE).map(renderCard)}
      </div>
      {total > SECTION_INLINE ? (
        <div
          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}
        >
          {!expanded ? (
            <Button onClick={() => setExpanded(true)}>
              查看更多（本类共 {total} 家）
            </Button>
          ) : null}
          {expanded ? (
            <Button onClick={() => setExpanded(false)}>收起</Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
