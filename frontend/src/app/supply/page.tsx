"use client";

import {
  BankOutlined,
  CalendarOutlined,
  FileTextOutlined,
  InboxOutlined,
  ShopOutlined,
  ToolOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, ConfigProvider } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColumnSwitch, Notice, PageHero, type HeroTab } from "@/components/ui/panel";
import { PAGE_META } from "@/config/routes";
import { MarketDemandTab } from "@/components/market-demand-tab";
import {
  ServicePublishTab,
  serviceMarketTab,
} from "@/components/service-publish-tab";
import { filterBoardTabs } from "@/lib/board-tabs";
import { canPublishService } from "@/lib/provider-categories";
import { useSession } from "@/lib/session";
import { useSiteBrand } from "@/lib/site-brand";
import { BookingTab } from "./_components/booking-tab";
import { useSupplyWorkspace } from "@/query/workspaces";
import { OrderTab } from "./_components/order-tab";
import { ProductTab } from "./_components/product-tab";
import { ProviderTab } from "./_components/provider-tab";
import { ServiceTab } from "./_components/service-tab";
import { StationTab } from "./_components/station-tab";

/**
 * 「🛍️ 供销网络服务市集」在本页的页签键改为 publish：全站通用的 `services` 已被经营性栏目
 * 「服务项目」（本地供销服务项目）占用，两个页签不能同键；文案与其余市集逐字一致
 * （2026-11-09 由「服务发布」改名，读公开池 + 我发布的服务）。
 */
const SUPPLY_SERVICE_MARKET_TAB: HeroTab = {
  ...serviceMarketTab("供销网络服务市集"),
  key: "publish",
};

/**
 * 企业侧（需求方）：看签约服务商与可采购的资源——「商品管理 + 商品订货」并为一个栏目
 * 「服务项目 + 服务预约」并为一个栏目；费用科目不设栏目，其他费用由服务商在报价时自行填写。
 * 企业侧同样展示「供销网络服务市集」（2026-11-09）：市集全站可逛，但企业不能发布服务——
 * 发布入口由 `ServicePublishTab` 按身份不渲染，后端 `assertPublishAllowed` 同口径拦截。
 */
const ENTERPRISE_TABS: HeroTab[] = [
  { key: "goods", label: <><InboxOutlined aria-hidden /> 商品供应</> },
  { key: "purchase", label: <><ToolOutlined aria-hidden /> 服务采购</> },
  { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求信息</> },
  // 企业端：服务商库紧跟需求信息，市集排最后（2026-11-09 用户裁定，与营销服务端同序）
  { key: "providers", label: <><BankOutlined aria-hidden /> 服务商</> },
  SUPPLY_SERVICE_MARKET_TAB,
];

/** 服务商 / 职员 / 平台侧：经营性栏目（站点、资源上架、单据处理）。 */
const PROVIDER_TABS: HeroTab[] = [
  { key: "stations", label: <><ShopOutlined aria-hidden /> 服务站</> },
  { key: "products", label: <><InboxOutlined aria-hidden /> 商品管理</> },
  { key: "services", label: <><ToolOutlined aria-hidden /> 服务项目</> },
  { key: "orders", label: <><FileTextOutlined aria-hidden /> 商品订货</> },
  { key: "bookings", label: <><CalendarOutlined aria-hidden /> 服务预约</> },
  { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求信息</> },
];

/** 企业侧合并栏目后，旧深链按业务含义归位（?tab=orders → 商品供应）。 */
const ENTERPRISE_TAB_ALIAS: Record<string, string> = {
  stations: "providers",
  products: "goods",
  orders: "goods",
  services: "purchase",
  bookings: "purchase",
};

/** 商品供应栏目内的子视图：可订商品（交易资源）+ 我的订货单（我的单据）切换显示。 */
const GOODS_SUB_OPTIONS = [
  { value: "catalog", label: "可订商品" },
  { value: "orders", label: "我的订货单" },
];

/** 服务采购栏目内的子视图：可约服务项目 + 我的服务预约单 切换显示。 */
const PURCHASE_SUB_OPTIONS = [
  { value: "catalog", label: "可约服务项目" },
  { value: "bookings", label: "我的服务预约单" },
];

/** 身份口径：机构级动作由服务商账号本人操作，具体单据由承办职员作业。 */
export type SupplyIdentity = {
  isEnterprise: boolean;
  isProvider: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  meUserId: string;
  selfName: string;
};

export default function SupplyPage() {
  const { me } = useSession();
  const { hiddenBoardTabs } = useSiteBrand();
  const [tab, setTab] = useState("goods");
  /** 企业侧合并栏目内的子视图：栏目只显示一张面板，由切换器在「交易资源 / 我的单据」间切换。 */
  const [goodsSub, setGoodsSub] = useState("catalog");
  const [purchaseSub, setPurchaseSub] = useState("catalog");


  const roles = me?.roles || [];
  const identity: SupplyIdentity = {
    isEnterprise: roles.includes("ENTERPRISE_USER"),
    isProvider: roles.includes("SERVICE_PROVIDER"),
    isStaff: (me?.staffOf || []).length > 0,
    isAdmin: roles.includes("PLATFORM_ADMIN"),
    meUserId: me?.userId || "",
    selfName: me?.displayName || "",
  };

  /** 「服务发布」＝服务商资质门控：该板块类目备案通过才出现本栏目（供销走平台直连，零落库）。 */
  const canPublish = canPublishService(me, "SUPPLY");

  /** 栏目按当前身份切换器口径取（与签约管理页 isProviderIdentity 同源）。 */
  const identityKey =
    me?.currentIdentity ||
    (identity.isProvider ? "SERVICE_PROVIDER" : "ENTERPRISE_USER");
  const enterpriseSide = identityKey === "ENTERPRISE_USER";
  const tabs = useMemo(
    () =>
      enterpriseSide
        ? ENTERPRISE_TABS
        : canPublish
          ? [...PROVIDER_TABS, SUPPLY_SERVICE_MARKET_TAB]
          : PROVIDER_TABS,
    [enterpriseSide, canPublish],
  );
  // 站点级「业务服务板块页签显隐」：供销网络的市集页签键为 publish，被隐藏后不渲染。
  const visibleTabs = useMemo(
    () => filterBoardTabs("supply", tabs, hiddenBoardTabs),
    [tabs, hiddenBoardTabs],
  );

  const visibleTab = visibleTabs.some(item => item.key === tab) ? tab : visibleTabs[0]?.key || "";
  const workspaceView = enterpriseSide && visibleTab === "goods" ? (goodsSub === "orders" ? "orders" : "products")
    : enterpriseSide && visibleTab === "purchase" ? (purchaseSub === "bookings" ? "bookings" : "services") : visibleTab;
  const workspace = useSupplyWorkspace(workspaceView);
  const stations = workspace.data?.stations ?? [];
  const products = workspace.data?.products ?? [];
  const services = workspace.data?.services ?? [];
  const contracts = workspace.data?.contracts ?? [];
  const loading = workspace.isPending;
  const {refetch: refetchWorkspace} = workspace;
  const load = useCallback(async () => { await refetchWorkspace(); }, [refetchWorkspace]);

  // 驾驶舱等入口用 /supply?tab=goods|purchase 直达对应页签（与 /tax?view= 同口径）
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || !me) return;
    deepLinkDone.current = true;
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (!wanted) return;
    // 合并栏目的别名只对企业侧生效，服务商侧沿用原页签名
    const key =
      (tabs === ENTERPRISE_TABS ? ENTERPRISE_TAB_ALIAS[wanted] : "") || wanted;
    if (visibleTabs.some((item) => item.key === key)) setTab(key);
    // 旧深链进合并栏目后，同时定位到它原本指向的子视图（?tab=orders → 我的订货单）
    if (tabs === ENTERPRISE_TABS && wanted === "orders") setGoodsSub("orders");
    if (tabs === ENTERPRISE_TABS && wanted === "bookings") {
      setPurchaseSub("bookings");
    }
  }, [me, tabs, visibleTabs]);

  // 身份切换或站点隐藏该页签后，当前页签不属于可见栏目时回到第一个栏目
  useEffect(() => {
    setTab((prev) =>
      visibleTabs.some((item) => item.key === prev) ? prev : visibleTabs[0]?.key || "",
    );
  }, [visibleTabs]);

  /** 需求信息（平台直连）：企业与服务商两侧同一份界面。 */
  const demandTab = (
    <MarketDemandTab
      domain="SUPPLY"
      label="供销网络"
      icon={<UnorderedListOutlined aria-hidden />}
      titlePlaceholder="例如：华东区连锁门店月度干货集采"
      descPlaceholder="品类与规格、数量、交付地点与验收要求等"
    />
  );

  return (
    // 按钮文案与 demo 逐字一致：关闭 antd 对 2 个汉字按钮自动插入空格的行为
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="供销网络"
        desc={
          enterpriseSide
            ? `${PAGE_META["/supply"]?.description || ""}需求信息：把供销需求发布到平台供需匹配池并查看服务商回复（发布同步落本地台账并记平台内容 ID，列表读该台账）；供销网络服务市集：浏览全平台服务商已发布的服务（企业不能发布服务）`
            : `${PAGE_META["/supply"]?.description || ""}需求信息${canPublish ? "与供销网络服务市集" : ""}：需求列表读本系统台账，发布同步到平台挂单并记回内容 ID`
        }
        tabs={visibleTabs}
        activeTab={tab}
        onTabChange={setTab}
      />
      {workspace.isError ? <Notice variant="warn">{workspace.error.message} <Button onClick={() => {void workspace.refetch();}}>重试</Button></Notice> : null}

      {enterpriseSide ? (
        tab === "goods" ? (
          goodsSub === "orders" ? (
            <OrderTab
              stations={stations}
              products={products}
              contracts={contracts}
              reload={load}
              identity={identity}
              panelTitle="我的订货单"
              switcher={
                <ColumnSwitch
                  value={goodsSub}
                  onChange={setGoodsSub}
                  options={GOODS_SUB_OPTIONS}
                />
              }
            />
          ) : (
            <ProductTab
              rows={products}
              stations={stations}
              contracts={contracts}
              loading={loading}
              reload={load}
              identity={identity}
              panelTitle="可订商品（签约服务商在售）"
              switcher={
                <ColumnSwitch
                  value={goodsSub}
                  onChange={setGoodsSub}
                  options={GOODS_SUB_OPTIONS}
                />
              }
            />
          )
        ) : tab === "purchase" ? (
          purchaseSub === "bookings" ? (
            <BookingTab
              services={services}
              contracts={contracts}
              reload={load}
              identity={identity}
              panelTitle="我的服务预约单"
              switcher={
                <ColumnSwitch
                  value={purchaseSub}
                  onChange={setPurchaseSub}
                  options={PURCHASE_SUB_OPTIONS}
                />
              }
            />
          ) : (
            <ServiceTab
              rows={services}
              stations={stations}
              contracts={contracts}
              loading={loading}
              reload={load}
              identity={identity}
              panelTitle="可约服务项目（签约服务商在售）"
              switcher={
                <ColumnSwitch
                  value={purchaseSub}
                  onChange={setPurchaseSub}
                  options={PURCHASE_SUB_OPTIONS}
                />
              }
            />
          )
        ) : tab === "requests" ? (
          demandTab
        ) : tab === "publish" ? (
          <ServicePublishTab domain="SUPPLY" pool />
        ) : (
          <ProviderTab
            rows={stations}
            products={products}
            services={services}
            contracts={contracts}
            loading={loading}
          />
        )
      ) : tab === "products" ? (
        <ProductTab
          rows={products}
          stations={stations}
          contracts={contracts}
          loading={loading}
          reload={load}
          identity={identity}
        />
      ) : tab === "services" ? (
        <ServiceTab
          rows={services}
          stations={stations}
          contracts={contracts}
          loading={loading}
          reload={load}
          identity={identity}
        />
      ) : tab === "orders" ? (
        <OrderTab
          stations={stations}
          products={products}
          contracts={contracts}
          reload={load}
          identity={identity}
        />
      ) : tab === "bookings" ? (
        <BookingTab
          services={services}
          contracts={contracts}
          reload={load}
          identity={identity}
        />
      ) : tab === "requests" ? (
        demandTab
      ) : tab === "publish" ? (
        <ServicePublishTab domain="SUPPLY" pool />
      ) : (
        <StationTab
          rows={stations}
          products={products}
          services={services}
          contracts={contracts}
          loading={loading}
          reload={load}
          identity={identity}
        />
      )}
    </ConfigProvider>
  );
}
