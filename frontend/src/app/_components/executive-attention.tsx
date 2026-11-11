"use client";

import { RightOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { EmptyState, Panel } from "@/components/ui/panel";

export type AttentionItem = {
  key: string;
  label: string;
  hint: string;
  count: number;
  to: string;
};

/**
 * 驾驶舱「待我处理」：只给待回复 / 待确认 / 待审批的件数和入口，
 * 具体内容在对应模块处理（客服会话、CRM 审批、职员绑定、平台审核）。
 */
export function ExecutiveAttention({
  items,
  loading,
}: {
  items: AttentionItem[];
  loading: boolean;
}) {
  const router = useRouter();
  return (
    <Panel
      title="待我处理"
      titleBadge={<span className="text-12 muted">等我回复或确认的事项</span>}
    >
      {loading && !items.length ? (
        <EmptyState icon={<ThunderboltOutlined aria-hidden />} text="正在加载待办…" />
      ) : items.length ? (
        <div className="exec-list">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="exec-row"
              onClick={() => router.push(item.to)}
            >
              <span className="exec-row-main">
                <span className="exec-row-label">{item.label}</span>
                <span className="exec-row-hint">{item.hint}</span>
              </span>
              <span className="exec-count">{item.count}</span>
              <RightOutlined className="exec-arrow" aria-hidden />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ThunderboltOutlined aria-hidden />}
          text="当前没有待你处理的事项"
        />
      )}
    </Panel>
  );
}