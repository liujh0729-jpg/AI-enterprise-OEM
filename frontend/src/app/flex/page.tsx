"use client";

import { AimOutlined, BankOutlined, DollarOutlined, UserOutlined } from "@ant-design/icons";
import { Button, ConfigProvider } from "antd";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ServicePublishTab,
  serviceMarketTab,
} from "@/components/service-publish-tab";
import { ColumnSwitch, Notice, PageHero, type HeroTab } from "@/components/ui/panel";
import { filterBoardTabs } from "@/lib/board-tabs";
import { useSession } from "@/lib/session";
import { useSiteBrand } from "@/lib/site-brand";
import { useFlexWorkspace } from "@/query/workspaces";
import { OnboardingTab } from "./_components/onboarding-tab";
import { PayrollTab } from "./_components/payroll-tab";
import { ResourceTab } from "./_components/resource-tab";
import { WorkOrderTab } from "./_components/work-order-tab";

/** 资源库页签恒排末尾（全站口径）：机构库（服务商）→ 服务市集 → 代理人库。 */
const DIRECTORY_TABS: HeroTab[] = [
  { key: "providers", label: <><BankOutlined aria-hidden /> 灵活用工资源库</> },
  serviceMarketTab("灵活用工服务市集"),
  { key: "agents", label: <><UserOutlined aria-hidden /> 代理人资源库</> },
];

const BASE_TABS: HeroTab[] = [
  { key: "work-orders", label: <><AimOutlined aria-hidden /> 用工需求</> },
];

/** 灵工发薪由平台管理员启停（管理后台 · 灵活用工审核），**默认启用**，停用时整个页签不出现。 */
const PAYROLL_TAB: HeroTab = { key: "payrolls", label: <><DollarOutlined aria-hidden /> 灵工发薪</> };

/** 「用工需求」栏目内的子视图：用工需求（常态）＋ 用工进件（企业风控表，低频）切换显示。 */
const DEMAND_SUB_OPTIONS = [
  { value: "work-orders", label: "用工需求" },
  { value: "onboardings", label: "用工进件" },
];

export default function FlexPage() {
  const { me } = useSession();
  const [tab, setTab] = useState("work-orders");
  /** 「用工需求」栏目内的子视图：栏目同一时刻只显示一张面板，由切换器在「用工需求 / 用工进件」间切换。 */
  const [demandSub, setDemandSub] = useState("work-orders");

  const roles = me?.roles || [];
  const isEnterprise = roles.includes("ENTERPRISE_USER");
  const isAdmin = roles.includes("PLATFORM_ADMIN");
  /** 服务商账号或已挂靠服务商的职员（对齐 demo App.isProviderSide）。 */
  const isProvider =
    roles.includes("SERVICE_PROVIDER") || (me?.staffOf || []).length > 0;
  const payrollEnabled = me?.platformFlags?.flexPayrollEnabled === true;
  const { hiddenBoardTabs } = useSiteBrand();
  const tabs: HeroTab[] = [
    ...BASE_TABS,
    ...(payrollEnabled ? [PAYROLL_TAB] : []),
    ...DIRECTORY_TABS,
  ];
  // 站点级「业务服务板块页签显隐」：被隐藏的页签不渲染，命中当前页签则回退到第一个可见页签。
  const visibleTabs = filterBoardTabs("flex", tabs, hiddenBoardTabs);
  // 深链 + 阻断提示直达：/flex?tab=agents 定位到代理人资源库
  const wantedTab = useSearchParams().get("tab") || "";
  const visibleKeys = visibleTabs.map((item) => item.key).join(",");
  useEffect(() => {
    if (wantedTab && visibleKeys.split(",").includes(wantedTab)) setTab(wantedTab);
  }, [wantedTab, visibleKeys]);

  /** 用工需求列表（含省市筛选）由 WorkOrderTab 的共享看板自行加载，本页只管其余三份数据。 */
  const workspace = useFlexWorkspace();
  const contracts = workspace.data?.contracts ?? [];
  const {refetch: refetchWorkspace} = workspace;
  const load = useCallback(async () => { await refetchWorkspace(); }, [refetchWorkspace]);

  // 板块被停用（或身份不可见 / 站点隐藏该页签）时，state 里残留的 tab 兜回默认页签（即第一个页签）
  const activeTab = visibleTabs.some((item) => item.key === tab)
    ? tab
    : visibleTabs[0]?.key || "";



  return (
    // 按钮文案与 demo 逐字一致：关闭 antd 对 2 个汉字按钮自动插入空格的行为
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="灵活用工服务"
        desc={`灵活用工资源库（服务商机构：企业发起签约 · 职员/代理人申请挂靠）· 代理人资源库（代理人即小微服务商，可直接合作签约）· 用工需求（企业风控表进件 → 企业发布至 AIworkin 平台通道 → 服务商匹配 → 候选人到岗 → 结算办结）${
          payrollEnabled
            ? "· 灵工发薪（新建发薪 → 代理人审核 → 进入台账）"
            : ""
        }`}
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={setTab}
      />

      {workspace.isError ? <Notice variant="warn">{workspace.error.message} <Button onClick={() => {void workspace.refetch();}}>重试</Button></Notice> : null}
      {activeTab === "services" ? (
        <ServicePublishTab domain="FLEX" pool />
      ) : activeTab === "agents" ? (
        <ResourceTab recordType="AGENT" contracts={contracts} reload={load} />
      ) : activeTab === "work-orders" ? (
        demandSub === "onboardings" ? (
          <OnboardingTab
            contracts={contracts}
            isEnterprise={isEnterprise}
            isProvider={isProvider}
            meUserId={me?.userId || ""}
            staffOf={
              (me?.staffOf || []) as {
                providerUserId?: string;
                status?: string;
              }[]
            }
            reload={load}
            switcher={
              <ColumnSwitch
                value={demandSub}
                onChange={setDemandSub}
                options={DEMAND_SUB_OPTIONS}
              />
            }
          />
        ) : (
          <WorkOrderTab
            contracts={contracts}
            isEnterprise={isEnterprise}
            isAdmin={isAdmin}
            isProvider={isProvider}
            meUserId={me?.userId || ""}
            staffOf={
              (me?.staffOf || []) as {
                providerUserId?: string;
                status?: string;
              }[]
            }
            switcher={
              <ColumnSwitch
                value={demandSub}
                onChange={setDemandSub}
                options={DEMAND_SUB_OPTIONS}
              />
            }
          />
        )
      ) : activeTab === "payrolls" ? (
        <PayrollTab
          contracts={contracts}
          isEnterprise={isEnterprise}
          isProvider={isProvider}
          meUserId={me?.userId || ""}
          staffOf={
            (me?.staffOf || []) as {
              providerUserId?: string;
              status?: string;
            }[]
          }
          reload={load}
        />
      ) : (
        <ResourceTab recordType="ORG" contracts={contracts} reload={load} />
      )}
    </ConfigProvider>
  );
}