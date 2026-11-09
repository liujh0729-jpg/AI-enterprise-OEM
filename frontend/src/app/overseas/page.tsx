"use client";

import { GlobalOutlined, ToolOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Button, ConfigProvider } from "antd";
import { useCallback, useMemo, useState } from "react";
import {
  Notice,
  PageHero,
  type HeroTab,
} from "@/components/ui/panel";
import { MarketDemandTab } from "@/components/market-demand-tab";
import { ServicePublishTab, serviceMarketTab } from "@/components/service-publish-tab";
import { filterBoardTabs } from "@/lib/board-tabs";
import { useSession } from "@/lib/session";
import { useSiteBrand } from "@/lib/site-brand";
import { isPersonalSubject } from "@/lib/subject";
import { OverseasCatalog } from "./_components/catalog";
import { useOverseasWorkspace } from "@/query/workspaces";
import { OverseasTools } from "./_components/tools";

const TABS: HeroTab[] = [
  { key: "tools", label: <><ToolOutlined aria-hidden /> 出海服务工具</> },
  { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求信息</> },
  // 资源库页签恒排末尾（全站口径）：没有代理人库时，服务商库放最后
  { key: "catalog", label: <><GlobalOutlined aria-hidden /> 跨境出海服务商</> },
  serviceMarketTab("跨境出海服务市集"),
];

export default function OverseasPage() {
  const { me } = useSession();
  const [tab, setTab] = useState("tools");
  const { hiddenBoardTabs } = useSiteBrand();
  // 站点级「业务服务板块页签显隐」：被隐藏的页签不渲染，命中当前页签则回退到第一个可见页签。
  const visibleTabs = filterBoardTabs("overseas", TABS, hiddenBoardTabs);
  const activeTab = visibleTabs.some((item) => item.key === tab) ? tab : visibleTabs[0]?.key || "";

  const isEnterprise = (me?.currentIdentity || "ENTERPRISE_USER") === "ENTERPRISE_USER";
  /** 个人主体：整页照常浏览（服务商名录、需求信息、申请加入），只有「签约 / 发起出海申请 / 发布需求」锁住。 */
  const personalUser =
    isEnterprise &&
    !me?.identities.includes("PLATFORM_ADMIN") &&
    isPersonalSubject((me?.enterprise as Record<string, unknown> | null)?.subjectType);

  const providerIds = useMemo(() => {
    const ids = new Set<string>();
    const myRoles = me?.roles || [];
    if (myRoles.includes("SERVICE_PROVIDER") && me?.userId) ids.add(me.userId);
    (me?.staffOf || []).forEach((item) => {
      const providerUserId = (item as { providerUserId?: string }).providerUserId;
      if (providerUserId) ids.add(providerUserId);
    });
    return [...ids];
  }, [me]);

  const workspace = useOverseasWorkspace(activeTab !== "requests", activeTab === "catalog");
  const providers = workspace.data?.providers ?? [];
  const contracts = workspace.data?.contracts ?? [];
  const {refetch: refetchWorkspace} = workspace;
  const load = useCallback(async () => { await refetchWorkspace(); }, [refetchWorkspace]);

  /** 需求信息（平台直连）：企业与服务商两侧同一份界面。 */
  const demandTab = (
    <MarketDemandTab
      domain="OVERSEAS"
      label="跨境出海"
      icon={<GlobalOutlined aria-hidden />}
      titlePlaceholder="例如：报关代理（一般贸易出口）"
      descPlaceholder="贸易方式、出口口岸、报关单据、期望时效与费用口径等"
      canSubmit={!personalUser}
    />
  );

  return (
    // 按钮文案与 demo 逐字一致：关闭 antd 对 2 个汉字按钮自动插入空格的行为
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="跨境出海"
        desc={
          personalUser
            ? "跨境出海服务商：6 类服务按分类展示已备案服务商，可查看资质并申请加入服务商；出海服务工具：查看服务分类与办理流程；需求信息：查看出海需求与服务商回复（签约、发起出海申请、发布需求需以企业或个体工商户主体办理）"
            : "跨境出海服务商：6 类服务按分类展示已备案服务商（分类独立签约）；出海服务工具：选择服务发起申请（未签约时先提醒签约）；需求信息：把出海需求发布到平台供需匹配池并查看服务商回复（发布同步落本地台账并记平台内容 ID，列表读该台账）"
        }
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={setTab}
      />

      {personalUser ? (
        <Notice variant="warn">
          以「个人」主体认证的用户可在这里浏览出海服务商名录、申请加入服务商、查看出海需求与回复；
          <b>签约、发起出海服务申请、发布出海需求</b>需以「企业」或「个体工商户」主体办理，可在「身份与资质」变更主体类型后重新提交认证。
        </Notice>
      ) : null}

      {workspace.isError ? <Notice variant="warn">{workspace.error.message} <Button onClick={() => {void workspace.refetch();}}>重试</Button></Notice> : null}
      {activeTab === "tools" ? (
        <OverseasTools
          contracts={contracts}
          isEnterprise={isEnterprise}
          canApply={!personalUser}
          providerIds={providerIds}
          enterpriseReady={Boolean(me?.enterprise)}
          currentUserId={me?.userId || ""}
          reload={load}
          onGoCatalog={() => setTab("catalog")}
        />
      ) : activeTab === "requests" ? (
        demandTab
      ) : activeTab === "services" ? (
        <ServicePublishTab domain="OVERSEAS" pool />
      ) : (
        <OverseasCatalog
          providers={providers}
          contracts={contracts}
          isEnterprise={isEnterprise}
          canSign={!personalUser}
          reload={load}
        />
      )}
    </ConfigProvider>
  );
}
