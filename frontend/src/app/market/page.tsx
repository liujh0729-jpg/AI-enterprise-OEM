"use client";

import { FileTextOutlined, ShopOutlined } from "@ant-design/icons";
import { ConfigProvider } from "antd";
import { useState } from "react";
import { MarketDemandTab } from "@/components/market-demand-tab";
import { ServicePublishTab } from "@/components/service-publish-tab";
import { PageHero, type HeroTab } from "@/components/ui/panel";
import { PAGE_META } from "@/config/routes";
import { filterBoardTabs } from "@/lib/board-tabs";
import { useSiteBrand } from "@/lib/site-brand";

/** 供需市场两个页签：需求与服务都直接读 AIworkin 平台公开池（跨板块，不按账号身份收窄）；读取走平台通道，未绑定 Key 也能浏览，发布才用本人 Key。 */
const TABS: HeroTab[] = [
  { key: "demands", label: <><FileTextOutlined aria-hidden /> 需求</> },
  { key: "services", label: <><ShopOutlined aria-hidden /> 服务</> },
];

export default function MarketPage() {
  const [tab, setTab] = useState("demands");
  const { hiddenBoardTabs } = useSiteBrand();
  // 站点级「业务服务板块页签显隐」：被隐藏的页签不渲染，命中当前页签则回退到第一个可见页签。
  const visibleTabs = filterBoardTabs("market", TABS, hiddenBoardTabs);
  const activeTab = visibleTabs.some((item) => item.key === tab) ? tab : visibleTabs[0]?.key || "";
  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="供需市场"
        desc={PAGE_META["/market"]?.description}
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={setTab}
      />
      {activeTab === "demands" ? (
        <MarketDemandTab
          domain="HUB"
          label="供需市场"
          demandNoun="需求"
          allowAnyIdentity
          icon={<FileTextOutlined aria-hidden />}
          titlePlaceholder="如：需要一名熟悉跨境电商的财务顾问"
          descPlaceholder="说明要解决的问题、期望结果与时间要求"
        />
      ) : activeTab === "services" ? (
        <ServicePublishTab domain="HUB" platform />
      ) : null}
    </ConfigProvider>
  );
}
