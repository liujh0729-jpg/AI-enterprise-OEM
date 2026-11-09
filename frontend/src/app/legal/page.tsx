"use client";

import { AuditOutlined, BankOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { ConfigProvider } from "antd";
import { useState } from "react";
import { ServicePublishTab, serviceMarketTab } from "@/components/service-publish-tab";
import { PageHero, type HeroTab } from "@/components/ui/panel";
import { filterBoardTabs } from "@/lib/board-tabs";
import { useSiteBrand } from "@/lib/site-brand";
import { RequestsTab } from "./_components/requests-tab";
import { ResourceTab } from "./_components/resource-tab";

export default function LegalPage() {
  const [tab, setTab] = useState("requests");
  const { hiddenBoardTabs } = useSiteBrand();
  const tabs: HeroTab[] = [
    { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求消息</> },
    // 资源库页签恒排末尾（全站口径）：市集紧接服务商（律所）资源库之后，个人库最后
    { key: "firm", label: <><BankOutlined aria-hidden /> 律所资源库</> },
    serviceMarketTab("法律服务市集"),
    { key: "lawyer", label: <><AuditOutlined aria-hidden /> 律师资源库</> },
  ];
  // 站点级「业务服务板块页签显隐」：被隐藏的页签不渲染，命中当前页签则回退到第一个可见页签。
  const visibleTabs = filterBoardTabs("legal", tabs, hiddenBoardTabs);
  const activeTab = visibleTabs.some((item) => item.key === tab) ? tab : visibleTabs[0]?.key || "";

  return (
    // 按钮文案与 demo 逐字一致：关闭 antd 对 2 个汉字按钮自动插入空格的行为
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="法律服务"
        desc="律师资源库 / 律所资源库 · 需求消息 · 法律服务市集"
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={setTab}
      />

      {activeTab === "services" ? (
        <ServicePublishTab domain="LEGAL" pool />
      ) : activeTab === "firm" ? (
        <ResourceTab kind="LAW_FIRM" />
      ) : activeTab === "requests" ? (
        <RequestsTab />
      ) : (
        <ResourceTab kind="LAWYER" />
      )}
    </ConfigProvider>
  );
}
