"use client";

import { ConfigProvider } from "antd";
import { useCallback, useEffect, useState } from "react";
import { projectApi } from "@/api/project";
import { orgStaffApi } from "@/api/collab";
import { Notice, PageHero } from "@/components/ui/panel";
import { PjOverviewTab } from "./_components/project-overview";
import { PjProjectsTab, type StaffOption } from "./_components/project-projects";
import { PjTasksTab } from "./_components/project-tasks";
import { PjTimeTab } from "./_components/project-time";
import { PjCostTab } from "./_components/project-cost";
import { PjCollabTab } from "./_components/project-collaboration";
import { PjSettingsTab } from "./_components/project-settings";
import { GapsTimeAuditTab } from "./_components/gaps-time-audit";
import { GapsTaskSyncTab } from "./_components/gaps-task-sync";
import { pjError, type PjOverview, type PjSettings } from "./_components/project-common";

const TABS = [
  { key: "overview", label: "概览" },
  { key: "projects", label: "项目" },
  { key: "tasks", label: "任务" },
  { key: "time", label: "工时" },
  { key: "cost", label: "成本" },
  { key: "collab", label: "外部协作" },
  { key: "time-audit", label: "工时审计" },
  { key: "task-sync", label: "任务同步" },
  { key: "settings", label: "设置" },
];

/**
 * 项目工作台（方案 §5.2）：项目、任务、工时三段闭环，
 * 成员复用统一组织成员（职员/代理人），AI 只做拆解建议与健康度评估，写入由人确认。
 */
export default function ProjectPage() {
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState<PjOverview | null>(null);
  const [settings, setSettings] = useState<PjSettings | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initial = query.get("tab");
    if (initial && TABS.some((item) => item.key === initial)) setTab(initial);
  }, []);

  const load = useCallback(async () => {
    try {
      const [overviewData, settingsData] = await Promise.all([
        projectApi.overview(),
        projectApi.settings(),
      ]);
      setOverview(overviewData);
      setSettings(settingsData);
      setError("");
    } catch (err) {
      setError(pjError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void orgStaffApi
      .workspace()
      .then((data) => {
        const rows = (data?.staff || [])
          .filter((row) => row.status !== "REMOVED")
          .map((row) => ({
            value: row.memberUserId,
            label: `${row.realName || row.memberUserId} · ${row.memberKindLabel || "职员"}${row.department ? `（${row.department}）` : ""}`,
          }));
        setStaff(rows);
      })
      .catch(() => setStaff([]));
  }, []);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="项目管理"
        desc="项目、任务、工时与成本闭环：项目主档、成员与里程碑、迭代与任务依赖、工时流水与周表审批；人力成本按已审批工时 × 费率自动计算，外部合作（供应商/OPC/个人）统一建档并通过合作单结算；AI 只做任务拆解建议与项目健康度评估。"
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
      />

      {error ? <Notice variant="error">{error}</Notice> : null}

      {tab === "overview" && overview ? (
        <PjOverviewTab overview={overview} reload={() => void load()} />
      ) : null}
      {tab === "overview" && !overview && !error ? (
        <div className="panel">
          <div className="panel-body muted">正在加载项目总览…</div>
        </div>
      ) : null}
      {tab === "projects" ? <PjProjectsTab staff={staff} /> : null}
      {tab === "tasks" ? <PjTasksTab staff={staff} /> : null}
      {tab === "time" ? <PjTimeTab staff={staff} /> : null}
      {tab === "cost" ? <PjCostTab staff={staff} /> : null}
      {tab === "collab" ? <PjCollabTab /> : null}
      {tab === "time-audit" ? <GapsTimeAuditTab /> : null}
      {tab === "task-sync" ? <GapsTaskSyncTab /> : null}
      {tab === "settings" && settings ? (
        <PjSettingsTab settings={settings} reload={() => void load()} />
      ) : null}
    </ConfigProvider>
  );
}
