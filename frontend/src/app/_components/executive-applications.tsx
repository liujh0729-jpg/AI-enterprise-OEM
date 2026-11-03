"use client";

import { FileDoneOutlined, RightOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { EmptyState, Panel } from "@/components/ui/panel";

export type ApplicationStatusItem = {
  key: string;
  label: string;
  hint: string;
  status: string;
  tone?: "green" | "orange" | "red" | "blue" | "gray";
  to: string;
};

/** 高管驾驶舱「与我相关的申请」：只给状态与入口，材料与操作去对应模块。 */
export function ExecutiveApplications({ items }: { items: ApplicationStatusItem[] }) {
  const router = useRouter();
  return (
    <Panel
      title="与我相关的申请"
      titleBadge={<span className="text-12 muted">身份、签约与挂靠状态</span>}
    >
      {items.length ? (
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
              <span className={`exec-status exec-status-${item.tone || "gray"}`}>
                {item.status}
              </span>
              <RightOutlined className="exec-arrow" aria-hidden />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileDoneOutlined aria-hidden />}
          text="当前没有与你相关的申请"
        />
      )}
    </Panel>
  );
}