"use client";

import { Button, ConfigProvider } from "antd";
import { useEffect, useState } from "react";
import { Notice, PageHero } from "@/components/ui/panel";
import { biApi } from "@/api/bi";
import {
  BiChatTab,
  BiChartsTab,
  BiDashboardsTab,
  BiDatasetsTab,
  BiDatasourcesTab,
  BiSettingsTab,
  BiWorkbenchTab,
} from "./_components/bi-panels";

const TABS = [
  { key: "workbench", label: "工作台" },
  { key: "chat", label: "智能问数" },
  { key: "datasets", label: "数据集" },
  { key: "charts", label: "图表" },
  { key: "dashboards", label: "仪表板" },
  { key: "datasources", label: "数据源" },
  { key: "settings", label: "设置" },
];

export default function BiPage() {
  const [tab, setTab] = useState("workbench");
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [workbench, setWorkbench] = useState<Awaited<ReturnType<typeof biApi.workbench>> | null>(null);
  const [gateError, setGateError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initial = query.get("tab");
    if (initial && TABS.some((item) => item.key === initial)) setTab(initial);
    setGateError("");
    void biApi
      .workbench()
      .then((data) => {
        setIsMember(Boolean(data?.isMember));
        setWorkbench(data);
      })
      .catch((error: unknown) => {
        setIsMember(null);
        setGateError((error as Error)?.message || "BI 状态加载失败");
      });
  }, [reloadKey]);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="BI智能分析"
        desc="内置 CRM 策展数据集 + 外部 PostgreSQL/MySQL 只读数据源：用自然语言问数，把结果保存成图表并拖拽组成仪表板。成员与权限复用本账号「职员与代理人」。"
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
      />

      {gateError ? (
        <Notice variant="error">
          {gateError} 加载失败，请稍后重试。
          <Button onClick={() => setReloadKey((key) => key + 1)}>重试</Button>
        </Notice>
      ) : null}
      {isMember === null && !gateError ? (
        <div className="panel">
          <div className="panel-body muted">正在加载 BI…</div>
        </div>
      ) : null}

      {isMember === false && tab !== "workbench" ? (
        <div className="panel">
          <div className="panel-body muted">你还没有被加入本账号的 BI，请联系管理员添加成员权限。</div>
        </div>
      ) : null}

      {isMember === true && tab === "workbench" ? <BiWorkbenchTab onGo={setTab} initial={workbench} /> : null}
      {isMember === true && tab === "chat" ? <BiChatTab /> : null}
      {isMember === true && tab === "datasets" ? <BiDatasetsTab /> : null}
      {isMember === true && tab === "charts" ? <BiChartsTab /> : null}
      {isMember === true && tab === "dashboards" ? <BiDashboardsTab /> : null}
      {isMember === true && tab === "datasources" ? <BiDatasourcesTab /> : null}
      {isMember === true && tab === "settings" ? <BiSettingsTab /> : null}
    </ConfigProvider>
  );
}