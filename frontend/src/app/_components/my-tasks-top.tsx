"use client";

import { CarryOutOutlined, RightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useRouter } from "next/navigation";
import type { MyTaskRow } from "@enterprise/contracts";
import { EmptyState, Panel } from "@/components/ui/panel";
import { taskCenterApi } from "@/api/task-center";
import { resolveStatus } from "@/lib/status";
import { useBusinessQuery } from "@/query/business";

/**
 * 驾驶舱「我的任务」：取统一任务中心未办里最紧要的前 5 条，
 * 点一条跳到源模块办理，整块另有「查看全部」进任务中心。
 */
export function MyTasksTop() {
  const router = useRouter();
  const query = useBusinessQuery("my-tasks", "top5", { pageSize: 5 }, (signal) =>
    taskCenterApi.list({ query: { page: 1, pageSize: 5 } }, { signal }),
  );
  const rows: MyTaskRow[] = query.data?.list || [];
  const pending = query.data?.summary?.pending ?? 0;

  return (
    <Panel
      title="我的任务"
      titleBadge={<span className="text-12 muted">各模块汇聚的待办，逐条去处理</span>}
      extra={
        <Button size="small" onClick={() => router.push("/tasks")}>
          {`查看全部（${pending}）`}
        </Button>
      }
    >
      {query.error ? (
        <EmptyState icon={<CarryOutOutlined aria-hidden />} text={`任务加载失败：${query.error.message}`} />
      ) : query.isPending && !rows.length ? (
        <EmptyState icon={<CarryOutOutlined aria-hidden />} text="正在加载待办…" />
      ) : rows.length ? (
        <div className="exec-list">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="exec-row"
              onClick={() => router.push(row.link || "/tasks")}
            >
              <span className="exec-row-main">
                <span className="exec-row-label">{row.title}</span>
                <span className="exec-row-hint">
                  {`${row.sourceLabel} · ${row.categoryLabel}${
                    row.dueAt ? ` · 截止 ${row.dueAt.slice(0, 10)}` : ""
                  }`}
                </span>
              </span>
              <span className={`badge badge-${resolveStatus("task", row.status).variant}`}>
                {row.statusLabel}
              </span>
              <RightOutlined className="exec-arrow" aria-hidden />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CarryOutOutlined aria-hidden />}
          text="当前没有待办任务：各模块需要你处理的事都会汇聚到这里"
        />
      )}
    </Panel>
  );
}
