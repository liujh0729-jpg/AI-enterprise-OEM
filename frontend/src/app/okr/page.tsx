"use client";

import { Button, ConfigProvider } from "antd";
import { useCallback, useEffect, useState } from "react";
import { okrApi } from "@/api/okr";
import { Notice, PageHero } from "@/components/ui/panel";
import { OkrObjectivesTab } from "./_components/okr-objectives";
import { OkrPlansTab } from "./_components/okr-plans";
import { OkrReportsTab } from "./_components/okr-reports";
import { OkrSettingsTab } from "./_components/okr-settings";
import { OkrStatsTab } from "./_components/okr-stats";

const TABS = [
  { key: "objectives", label: "目标" },
  { key: "plans", label: "我的计划" },
  { key: "reports", label: "汇报" },
  { key: "stats", label: "统计复盘" },
  { key: "settings", label: "设置" },
];

type OkrContextData = Awaited<ReturnType<typeof okrApi.context>>;

export default function OkrPage() {
  const [tab, setTab] = useState("objectives");
  const [cycleId, setCycleId] = useState(0);
  const [ctx, setCtx] = useState<OkrContextData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initial = query.get("tab");
    if (initial && TABS.some((item) => item.key === initial)) setTab(initial);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await okrApi.context({
        query: { cycleId: cycleId || undefined },
      });
      setCtx(data);
      setError("");
      if (data && !cycleId && data.cycle) setCycleId(data.cycle.id);
    } catch (err) {
      setError((err as Error)?.message || "OKR 上下文加载失败");
    }
  }, [cycleId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="OKR 计划"
        desc="账号级目标管理：年度/季度/月度周期、公司到个人的目标树、周/日计划、日报周报与周期复盘评分。成员与管理者的岗位能力复用「职员与代理人」。"
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
      />

      {error ? (
        <Notice variant="error">
          {error}
          <Button onClick={() => void load()}>重试</Button>
        </Notice>
      ) : null}

      {!ctx && !error ? (
        <div className="panel">
          <div className="panel-body muted">正在加载 OKR…</div>
        </div>
      ) : null}

      {ctx && tab === "objectives" ? (
        <OkrObjectivesTab
          ctx={ctx}
          reload={load}
          onCycleChange={(next) => setCycleId(next)}
        />
      ) : null}
      {ctx && tab === "plans" ? <OkrPlansTab ctx={ctx} reload={load} /> : null}
      {ctx && tab === "reports" ? <OkrReportsTab ctx={ctx} /> : null}
      {ctx && tab === "stats" ? <OkrStatsTab ctx={ctx} /> : null}
      {ctx && tab === "settings" ? <OkrSettingsTab reload={load} /> : null}
    </ConfigProvider>
  );
}
