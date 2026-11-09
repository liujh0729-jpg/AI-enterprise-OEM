"use client";

import {
  BankOutlined,
  CalendarOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, ConfigProvider } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  type HeroTab,
} from "@/components/ui/panel";
import { canWorkOn } from "@/lib/can-work-on";
import { ApiError } from "@enterprise/contracts";
import { useTaxWorkspace, useTaxDeclaration } from "@/query/workspaces";
import { useTaxSets,useTaxSet } from '@/query/tax';
import { filterBoardTabs } from "@/lib/board-tabs";
import { useSession } from "@/lib/session";
import { useSiteBrand } from "@/lib/site-brand";
import { isPersonalSubject } from "@/lib/subject";
import { canPublishService } from "@/lib/provider-categories";
import { MarketDemandTab } from "@/components/market-demand-tab";
import {
  ServicePublishTab,
  serviceMarketTab,
} from "@/components/service-publish-tab";
import { AccountSetDetail } from "./_components/account-set-detail";
import { BoardTab } from "./_components/board-tab";
import {
  type TaxDeclaration,
} from "./_components/common";
import { DeclarationDetail } from "./_components/declaration-detail";
import { EnterpriseSetsPanel } from "./_components/enterprise-sets";
import { ManageTab } from "./_components/manage-tab";
import { MaterialDetail } from "./_components/material-detail";
import {
  MyTaxProviderPanel,
  TaxProvidersTab,
} from "./_components/providers-tab";
import { ToolsTab } from "./_components/tools-tab";

export default function TaxPage() {
  const { me } = useSession();
  const [tab, setTab] = useState("tools");
  const [manageView, setManageView] = useState("materials");
  const [declId, setDeclId] = useState<number | null>(null);
  /** 报税材料详情（企业工作台/服务商材料列表共用同一详情视图） */
  const [materialId, setMaterialId] = useState<number | null>(null);
  /** 账套详情（企业侧「我的账套」打开，只读） */
  const [setId, setSetId] = useState<number | null>(null);

  const roles = me?.roles || [];
  const isEnterprise = (me?.currentIdentity || "ENTERPRISE_USER") === "ENTERPRISE_USER";
  /** 对齐 demo App.isProviderSide()：服务商账号或已挂靠服务商的职员。 */
  const isProviderSide =
    roles.includes("SERVICE_PROVIDER") || (me?.staffOf || []).length > 0;
  const enterprise = (me?.enterprise || null) as Record<string, unknown> | null;
  const enterpriseId = Number(enterprise?.id || 0);
  const taxpayerType = String(enterprise?.taxpayerType || "");
  /** 个人主体：整页照常浏览（财税工具、服务商名录、需求信息），但「签约 / 申报 / 账套 / 发布需求」四类办理动作锁住。 */
  const personalUser = isEnterprise && !me?.identities.includes("PLATFORM_ADMIN") && isPersonalSubject(enterprise?.subjectType);
  /** 「财税服务市集」＝服务商资质门控：该板块类目备案通过才出现本栏目（读公开池 + 我发布的服务）。 */
  const canPublish = canPublishService(me, "TAX");
  const { hiddenBoardTabs } = useSiteBrand();

  const toolsVisible = isEnterprise && tab === "tools" && declId === null && materialId === null && setId === null;
  const needsWorkspace = declId !== null || setId !== null ||
    (isEnterprise ? ["tools", "providers"].includes(tab) : ["sets", "decls"].includes(manageView));
  const needsSets = isEnterprise ? tab === "sets" : manageView === "sets";
  const workspace = useTaxWorkspace(needsWorkspace, isEnterprise && ["tools", "providers"].includes(tab));
  const [setsPage,setSetsPage]=useState(1);
  const setsQuery=useTaxSets(setsPage,needsSets);
  const setQuery=useTaxSet(setId);
  const meta = workspace.data?.meta ?? {forms:[],advisor_checks:[]};
  const sets = setsQuery.data?.list ?? [];
  const setTotal=setsQuery.data?.total??0;
  const contracts = workspace.data?.contracts ?? [];
  const providers = workspace.data?.providers ?? [];
  const {refetch:refetchWorkspace} = workspace;
  const needsDetail = declId !== null;
  const detailQuery = useTaxDeclaration(declId, needsDetail);
  const {refetch:refetchDetail} = detailQuery;
  const {refetch:refetchSets}=setsQuery;
  const {refetch:refetchSet}=setQuery;
  const load = useCallback(async () => {await Promise.all([refetchWorkspace(),refetchSets(),...(setId!==null?[refetchSet()]:[]), ...(needsDetail ? [refetchDetail()] : [])]);}, [refetchWorkspace,refetchSets,refetchSet,setId,refetchDetail,needsDetail]);
  const fetchedDecl = detailQuery.data;
  const declMissing = detailQuery.error instanceof ApiError && detailQuery.error.status === 404;

  // 工具卡片用 /tax?view=sets 等直达对应页签
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (!view) return;
    if (isEnterprise) {
      if (["tools", "providers", "board", "sets", "requests"].includes(view)) {
        setTab(view);
      }
    } else if (
      [
        "materials",
        "decls",
        "sets",
        "auto",
        "requests",
        ...(canPublish ? ["services"] : []),
      ].includes(view)
    ) {
      setManageView(view);
    }
  }, [isEnterprise, canPublish]);

  const enterpriseTabs: HeroTab[] = [
    { key: "tools", label: <><ToolOutlined aria-hidden /> 财税工具</> },
    { key: "board", label: <><FileTextOutlined aria-hidden /> 报税工作台</> },
    { key: "sets", label: <><FolderOpenOutlined aria-hidden /> 账套管理</> },
    { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求信息</> },
    // 资源库页签恒排末尾（全站口径）：没有代理人库时，服务商库放最后
    { key: "providers", label: <><BankOutlined aria-hidden /> 财税服务商</> },
  ];

  const manageTabs: HeroTab[] = [
    { key: "materials", label: <><DownloadOutlined aria-hidden /> 企业报税材料</> },
    { key: "decls", label: <><CalendarOutlined aria-hidden /> 申报计划</> },
    { key: "sets", label: <><FolderOpenOutlined aria-hidden /> 账套管理</>, count: setsQuery.data ? setTotal : undefined },
    { key: "auto", label: <><ThunderboltOutlined aria-hidden /> 自动化能力</> },
    { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求信息</> },
    ...(canPublish ? [serviceMarketTab("财税服务市集")] : []),
  ];

  // 站点级「业务服务板块页签显隐」：被隐藏的页签不渲染；当前页签被隐藏时兜回第一个可见页签
  // （本页页签集随身份切换，故用 effect 把 state 收敛到可见页签，保证页头与正文始终一致）。
  const visibleTabs = filterBoardTabs("tax", isEnterprise ? enterpriseTabs : manageTabs, hiddenBoardTabs);
  const currentTab = isEnterprise ? tab : manageView;
  useEffect(() => {
    if (visibleTabs.some((item) => item.key === currentTab)) return;
    const fallback = visibleTabs[0]?.key || "";
    if (isEnterprise) setTab(fallback);
    else setManageView(fallback);
  }, [visibleTabs, currentTab, isEnterprise]);

  const desc = isEnterprise
    ? personalUser
      ? "财税工具：服务包参考价格与自助工具；财税服务商：资源库浏览、查看资质并申请加入服务商；报税工作台：查看报税流程；需求信息：查看财税需求与服务商回复（签约、申报、账套、发布需求需以企业或个体工商户主体办理）"
      : "财税工具：服务包参考价格与自助工具；财税服务商：资源库浏览、查看资质并发起签约（一个企业只能与一家财税服务商签约）；报税工作台：提交材料，AI 分类分析后由服务商分税种提报；需求信息：把财税需求发布到平台供需匹配池并查看服务商回复（发布同步落本地台账并记平台内容 ID，列表读该台账）"
    : isProviderSide
      ? "报税材料 · 申报计划 · 账套管理（AI 分类分析 · 分税种提报）· 需求信息与财税服务市集（需求读本地台账；服务市集读公开池 + 我发布的服务）"
      : "全平台财税监管：报税材料、申报计划与账套";

  const activeDecl = declId
    ? fetchedDecl
    : null;
  const activeSet = setQuery.data;

  const canWork = (row: TaxDeclaration) =>
    canWorkOn(me, row, roles.includes("PLATFORM_ADMIN"));
  /** 可写（改草稿 / 改联系方式）：承办人与平台管理员、以及本企业当事人；服务商账号仅只读。 */
  const canWrite = (row: TaxDeclaration) =>
    canWork(row) ||
    (isEnterprise && enterpriseId > 0 && row.enterpriseId === enterpriseId);

  /** 需求信息（平台直连）：企业与服务商两侧同一份界面。 */
  const demandTab = (
    <MarketDemandTab
      domain="TAX"
      label="财税服务"
      icon={<FileTextOutlined aria-hidden />}
      titlePlaceholder="例如：一般纳税人月度记账与申报"
      descPlaceholder="纳税人类型、账套现状、期望服务范围与交付要求等"
      canSubmit={!personalUser}
    />
  );

  const dependencyError = (needsWorkspace && !toolsVisible ? workspace.error : null) ?? (needsSets ? setsQuery.error : null);
  const dependencyPending = (needsWorkspace && !toolsVisible && workspace.isPending) || (needsSets && setsQuery.isPending);

  return (
    // 按钮文案与 demo 逐字一致：关闭 antd 对 2 个汉字按钮自动插入空格的行为
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="财税服务"
        desc={desc}
        tabs={visibleTabs}
        activeTab={isEnterprise ? tab : manageView}
        onTabChange={(key) => {
          setDeclId(null);
          setMaterialId(null);
          setSetId(null);
          if (isEnterprise) setTab(key);
          else setManageView(key);
        }}
      />

      {personalUser ? (
        <Notice variant="warn">
          以「个人」主体认证的用户可在这里浏览财税服务商名录、申请加入服务商、查看财税需求与回复；
          <b>签约、报税申报、账套、发布财税需求</b>需以「企业」或「个体工商户」主体办理，可在「身份与资质」变更主体类型后重新提交认证。
        </Notice>
      ) : null}

      {dependencyError ? (
        <Notice variant="warn">财税数据加载失败：{dependencyError.message} <Button onClick={() => {void load();}}>重试</Button></Notice>
      ) : dependencyPending ? (
        <Notice variant="info">财税数据加载中…</Notice>
      ) : declId && !activeDecl ? (
        // demo tax-form.js：单号缺失/命中不到申报单时给出明确提示，而不是静默回落
        <Panel
          title="申报单"
          extra={
            <Button onClick={() => setDeclId(null)}>
              ← 返回列表
            </Button>
          }
        >
          {detailQuery.isError ? (
            <Notice variant="warn">{declMissing ? '申报单不存在或不在可见范围' : detailQuery.error.message} <Button onClick={() => {void detailQuery.refetch();}}>重试</Button></Notice>
          ) : (
            <EmptyState icon={<LoadingOutlined aria-hidden />} text="正在读取申报单…" />
          )}
        </Panel>
      ) : activeDecl ? (
        <DeclarationDetail
          decl={activeDecl}
          meta={meta}
          canWork={canWork(activeDecl)}
          canWrite={canWrite(activeDecl)}
          onBack={() => setDeclId(null)}
          reload={load}
        />
      ) : materialId ? (
        <MaterialDetail
          packId={materialId}
          currentUserId={me?.userId || ""}
          isAdmin={roles.includes("PLATFORM_ADMIN")}
          canTouchContacts={
            isEnterprise || isProviderSide || roles.includes("PLATFORM_ADMIN")
          }
          onBack={() => setMaterialId(null)}
          onOpenDecl={setDeclId}
          reload={load}
        />
      ) : setId ? (
        activeSet ? (
          <AccountSetDetail
            set={activeSet}
            contracts={contracts}
            meta={meta}
            onBack={() => setSetId(null)}
            onOpenDecl={setDeclId}
          />
        ) : (
          <Panel
            title="账套详情"
            extra={
              <Button onClick={() => setSetId(null)}>
                ← 返回列表
              </Button>
            }
          >
            {setQuery.isError ? <Notice variant="error">{setQuery.error.message} <Button onClick={() => void setQuery.refetch()}>重试</Button></Notice> : <EmptyState icon={<LoadingOutlined aria-hidden />} text="账套加载中…" />}
          </Panel>
        )
      ) : isEnterprise ? (
        tab === "board" ? (
          <BoardTab
            onOpenDecl={setDeclId}
            onOpenMaterial={setMaterialId}
            canFile={!personalUser}
          />
        ) : tab === "sets" ? (
          <EnterpriseSetsPanel
            sets={sets}
            total={setTotal}
            page={setsPage}
            onPageChange={setSetsPage}
            loading={false}
            onOpenSet={setSetId}
          />
        ) : tab === "requests" ? (
          demandTab
        ) : tab === "providers" ? (
          <TaxProvidersTab
            providers={providers}
            contracts={contracts}
            enterpriseId={enterpriseId}
            taxpayerType={taxpayerType}
            canSign={!personalUser}
            reload={load}
          />
        ) : (
          <>
            {/* 首页只显示已签约的财税服务商；服务商资源库在「🏦 财税服务商」页签 */}
            {workspace.isError ? <Notice variant="warn">签约服务商加载失败：{workspace.error.message} <Button onClick={() => void workspace.refetch()}>重试</Button></Notice>
            : workspace.isPending ? <Notice variant="info">正在加载签约服务商…</Notice> : <MyTaxProviderPanel
              providers={providers}
              contracts={contracts}
              enterpriseId={enterpriseId}
              taxpayerType={taxpayerType}
              canSign={!personalUser}
              onGoProviders={() => setTab("providers")}
              reload={load}
            />}
            <ToolsTab enterprise={enterprise} taxpayerType={taxpayerType} />
          </>
        )
      ) : manageView === "requests" ? (
        demandTab
      ) : manageView === "services" ? (
        <ServicePublishTab domain="TAX" platform />
      ) : (
        <ManageTab
          view={manageView}
          sets={sets}
          setTotal={setTotal}
          setPage={setsPage}
          onSetPage={setSetsPage}
          contracts={contracts}
          meta={meta}
          currentUserId={me?.userId || ""}
          enterpriseId={enterpriseId}
          staffOf={me?.staffOf}
          isAdmin={roles.includes("PLATFORM_ADMIN")}
          canCreateSet={isProviderSide}
          reload={load}
          onOpenDecl={setDeclId}
        />
      )}
    </ConfigProvider>
  );
}
