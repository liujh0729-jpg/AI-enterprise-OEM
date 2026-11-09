"use client";

import { useEffect, useState } from "react";
import { ConfigProvider } from "antd";
import { AiCopilot } from "@/components/ai-copilot";
import { PageHero } from "@/components/ui/panel";
import { serviceDeskApi } from "@/api/collab";
import { ConversationPanel } from "./_components/conversation-panel";
import {
  KnowledgePanel,
  SettingsPanel,
  SitesPanel,
  StatsPanel,
} from "./_components/settings-panels";
import { ChannelsPanel } from "./_components/channel-panel";
import { GroupsPanel, TeamPanel } from "./_components/team-panel";
import { GapsAfterSalesTab } from "./_components/gaps-after-sales";

type TabKey =
  | "conversations"
  | "after-sales"
  | "team"
  | "settings"
  | "knowledge"
  | "sites"
  | "channels"
  | "stats";

export default function ServiceDeskPage() {
  const [tab, setTab] = useState<TabKey>("conversations");
  const [overview, setOverview] = useState<Awaited<
    ReturnType<typeof serviceDeskApi.overview>
  > | null>(null);

  const loadOverview = async () => {
    try {
      setOverview(await serviceDeskApi.overview());
    } catch {
      // 概览只用于页签门控与会话统计，失败不阻断会话本身
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  const tabs = [
    { key: "conversations", label: "会话" },
    ...(overview?.isManager
      ? [
          { key: "after-sales", label: "售后工单" },
          { key: "team", label: "客服团队" },
          { key: "settings", label: "接待设置" },
          { key: "knowledge", label: "常用语与知识" },
          { key: "sites", label: "站点与接入" },
          { key: "channels", label: "渠道接入" },
          { key: "stats", label: "统计" },
        ]
      : []),
  ];

  const current = (overview?.isManager ? tab : "conversations") as TabKey;

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="AI客服"
        desc="把客服挂到你自己的官网：访客扫码或点开窗口 → 由本组织的职员/代理人真人接待；AI 按你的设置做固定文案、回复建议或自动应答。一个账号可挂多个站点，客户只来自挂了客服窗口的官网。"
        tabs={tabs}
        activeTab={current}
        onTabChange={(key) => setTab(key as TabKey)}
      />

      {current === "conversations" ? (
        <ConversationPanel overview={overview} onOverview={loadOverview} />
      ) : null}
      {current === "after-sales" ? <GapsAfterSalesTab /> : null}
      {current === "team" ? (
        <div className="sd-stack">
          <TeamPanel />
          <GroupsPanel />
        </div>
      ) : null}
      {current === "settings" ? <SettingsPanel /> : null}
      {current === "knowledge" ? <KnowledgePanel /> : null}
      {current === "sites" ? <SitesPanel /> : null}
      {current === "channels" ? <ChannelsPanel /> : null}
      {current === "stats" ? <StatsPanel /> : null}
      <AiCopilot
        module="service_desk"
        moduleLabel="AI客服"
        context={`当前页签：${tabs.find((item) => item.key === current)?.label || current}`}
        suggestions={["今天接待量怎么样", "帮我看下常用语怎么配"]}
      />
    </ConfigProvider>
  );
}