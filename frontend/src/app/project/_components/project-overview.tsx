"use client";

import { Alert, Button, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { z, pjRiskSchema } from "@enterprise/contracts";
import { projectApi } from "@/api/project";
import { Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { hours, pjError, ProgressInline } from "./project-common";
import type { PjOverview } from "./project-common";

type Risk = z.infer<typeof pjRiskSchema>;

const LEVEL: Record<string, { color: string; label: string }> = {
  LOW: { color: "green", label: "低风险" },
  MEDIUM: { color: "gold", label: "中风险" },
  HIGH: { color: "red", label: "高风险" },
};

const RISK_COLUMNS: ColumnsType<Risk> = [
  {
    title: "项目",
    dataIndex: "projectName",
    render: (value: string, row) => (
      <span>
        {value}
        <span className="muted text-12">{` · #${row.projectId}`}</span>
      </span>
    ),
  },
  {
    title: "风险等级",
    dataIndex: "riskLevel",
    width: 100,
    render: (value: string) => (
      <Tag color={LEVEL[value]?.color}>{LEVEL[value]?.label || value}</Tag>
    ),
  },
  {
    title: "进度",
    dataIndex: "totalTasks",
    width: 160,
    render: (_: number, row) => (
      <ProgressInline done={row.totalTasks - row.overdueTasks} total={row.totalTasks} />
    ),
  },
  {
    title: "逾期任务",
    dataIndex: "overdueTasks",
    width: 90,
  },
  {
    title: "工时投入",
    dataIndex: "loggedMinutes",
    width: 120,
    render: (value: number, row) =>
      `${hours(value)} / ${hours(row.budgetMinutes)}`,
  },
  {
    title: "风险原因",
    dataIndex: "reasons",
    render: (value: string[]) => (value.length ? value.join("；") : "—"),
  },
  {
    title: "建议",
    dataIndex: "suggestions",
    render: (value: string[]) => (value.length ? value.join("；") : "—"),
  },
];

export function PjOverviewTab({
  overview,
  reload,
}: {
  overview: PjOverview;
  reload: () => void;
}) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRisks((await projectApi.risks()) || []);
      setError("");
    } catch (err) {
      setError(pjError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, overview]);

  return (
    <>
      <StatGrid>
        <StatCard label="进行中项目" value={overview.activeProjects} />
        <StatCard label="未完成任务" value={overview.openTasks} />
        <StatCard label="逾期任务" value={overview.overdueTasks} />
        <StatCard label="本周工时" value={hours(overview.weekLoggedMinutes)} />
        <StatCard label="待审批工时" value={overview.approvalPending} />
        <StatCard
          label="人效利用率"
          value={`${Math.round(overview.utilization)}%`}
        />
        <StatCard label="风险项目" value={overview.riskProjects} />
      </StatGrid>

      {error ? <Notice variant="error">{error}</Notice> : null}

      <Panel
        title="项目风险"
        extra={
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        {!error ? (
          <Table<Risk>
            rowKey="projectId"
            size="middle"
            columns={RISK_COLUMNS}
            dataSource={risks}
            pagination={false}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "暂无风险项目" }}
          />
        ) : (
          <Alert type="error" title={error} showIcon />
        )}
      </Panel>

      <div style={{ marginTop: 12 }}>
        <Button onClick={reload}>刷新总览</Button>
      </div>
    </>
  );
}
