"use client";

import {
  ApiOutlined,
  AuditOutlined,
  BankOutlined,
  FileTextOutlined,
  FormOutlined,
  GlobalOutlined,
  IdcardOutlined,
  InboxOutlined,
  KeyOutlined,
  MessageOutlined,
  NotificationOutlined,
  PayCircleOutlined,
  RobotOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  SmileOutlined,
  SolutionOutlined,
  TagOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { notificationsApi, serviceDeskApi } from "@/api/collab";
import { aipddKeyApi } from "@/api/aipdd-key";
import { crmApi } from "@/api/crm";
import { growthApi } from "@/api/growth";
import { oaApi } from "@/api/oa";
import { okrApi } from "@/api/okr";
import { projectApi } from "@/api/project";
import { dashboardApi, type DashboardStatistic } from "@/api/dashboard";
import { dashboardScope } from "@/lib/dashboard-scope";
import { ADMIN_PATH_PREFIX } from "@/config/routes";
import { useBusinessQueries, useBusinessQuery } from "@/query/business";
import { identityLabel } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { subjectLabel } from "@/lib/subject";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import {
  ExecutiveApplications,
  type ApplicationStatusItem,
} from "../_components/executive-applications";
import {
  ExecutiveAttention,
  type AttentionItem,
} from "../_components/executive-attention";
import { ExecutiveNotifications } from "../_components/executive-notifications";
import { GrowthCockpitPanel } from "../_components/growth-cockpit";
import { OverviewTab } from "../admin/_components/overview-tab";

type Any = Record<string, unknown>;

const IDENTITY_VARIANT: Record<string, string> = {
  ENTERPRISE_USER: "sky",
  SERVICE_PROVIDER: "blue",
  PROVIDER_STAFF: "green",
  PLATFORM_ADMIN: "red",
};

/** 平台审核待办与管理统计使用同一口径。 */
const ADMIN_PENDING_KEYS = ["pendingProvider"];

const PROVIDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "备案待审核",
  APPROVED: "备案已通过",
  REJECTED: "备案已驳回",
  DELISTED: "备案已停用",
};

/**
 * 各板块「待办」口径：非终态单据即待办。
 * 终态：申报已扣款、出海已退税/已退回、物流已签收、IT服务已交付、法律/知产/用工已办结、进件已审核、
 * 营销已完成、资产已成交、供销订单生效/否决/取消。
 */
const PENDING_STATUS: Record<string, string[]> = {
  tax: ["DRAFT", "SUBMITTED", "CHECKING"],
  overseas: ["SUBMITTED", "IN_REVIEW", "APPROVED"],
  logistics: ["OPEN", "PENDING", "IN_TRANSIT", "EXCEPTION"],
  smart: ["OPEN", "PENDING", "IN_PROGRESS", "EXCEPTION"],
  marketing: ["OPEN", "MATCHED", "CONNECTED"],
  supply: ["DRAFT", "SUBMITTED", "QUOTED", "RETURNED"],
  asset: ["OPEN", "PENDING", "VIEWING", "EXCEPTION"],
  legal: ["OPEN", "MATCHING", "IN_PROGRESS"],
  ip: ["OPEN", "MATCHING", "IN_PROGRESS"],
  flexWorkOrder: ["OPEN", "MATCHING", "IN_PROGRESS"],
};

/** 待办件数：该板块列表里处于非终态的行数。 */
function countPending(
  rows: { byStatus: Record<string, number> } | undefined,
  domain: string,
) {
  const allowed = PENDING_STATUS[domain] || [];
  if (!rows) return "—";
  return allowed.reduce((sum, status) => sum + (rows.byStatus[status] ?? 0), 0);
}

export default function DashboardPage() {
  const router = useRouter();
  const { me } = useSession();
  const scope = dashboardScope(me);
  const query = useBusinessQuery(
    "dashboard", "overview", {},
    (signal) => dashboardApi.overview(scope.identity, signal),
    "all", scope.identity !== "PROVIDER_STAFF",
  );
  const statisticQueries = useBusinessQueries("dashboard", scope.statistics.map((key) => ({
    resource: `statistics.${key}`,
    params: {},
    load: (signal: AbortSignal) => dashboardApi.statistic(key, signal),
  })));
  const statistics: Partial<Record<DashboardStatistic, { byStatus: Record<string, number> }>> = Object.fromEntries(
    scope.statistics.map((key, index) => [key, statisticQueries[index].data]),
  );
  const teamQuery = useBusinessQuery(
    "dashboard", "team", {},
    (signal) => dashboardApi.team(scope.identity, signal),
    "all", scope.identity === "SERVICE_PROVIDER" || scope.identity === "PROVIDER_STAFF",
  );
  const pjQuery = useBusinessQuery(
    "dashboard", "project-overview", {},
    (signal) => projectApi.overview({}, { signal }),
  );
  const aipddKeyQuery = useBusinessQuery(
    "dashboard", "aipdd-key", {},
    (signal) => aipddKeyApi.status({ signal }),
  );
  const notificationsQuery = useBusinessQuery(
    "dashboard", "notifications", {},
    (signal) => notificationsApi.unread({}, { signal }),
    "all", Boolean(me),
  );
  const crmQuery = useBusinessQuery(
    "dashboard", "crm-workbench", {},
    (signal) => crmApi.workbench({ query: { range: "month" } }, { signal }),
    "all", Boolean(me),
  );
  const deskQuery = useBusinessQuery(
    "dashboard", "service-desk", {},
    (signal) => serviceDeskApi.overview({}, { signal }),
    "all", Boolean(me),
  );
  const okrQuery = useBusinessQuery(
    "dashboard", "okr", {},
    (signal) => okrApi.overview({ query: {} }, { signal }),
    "all", Boolean(me),
  );
  const oaQuery = useBusinessQuery(
    "dashboard", "oa", {},
    (signal) => oaApi.overview({ query: {} }, { signal }),
    "all", Boolean(me),
  );
  const growthQuery = useBusinessQuery(
    "dashboard", "growth-cockpit", {},
    (signal) => growthApi.cockpit({ query: { days: 90 } }, { signal }),
    "all",
    Boolean(me) && (me?.currentIdentity || "ENTERPRISE_USER") === "ENTERPRISE_USER",
  );
  const statisticsReady = statisticQueries.every((item) => item.data !== undefined);
  const failedQueries = [query, ...statisticQueries].filter((item) => item.error);
  const rows = query.data;

  /** 高管驾驶舱完全跟随「当前身份」变化。 */
  const identity = me?.currentIdentity || "ENTERPRISE_USER";
  const isEnterprise = identity === "ENTERPRISE_USER";
  const isProvider = identity === "SERVICE_PROVIDER";
  const isStaff = identity === "PROVIDER_STAFF";
  const isAdmin = identity === "PLATFORM_ADMIN";
  const userSubject = String(
    (me?.enterprise as Any)?.subjectType || "COMPANY",
  ).toUpperCase();

  const activeContracts = rows?.contractStats?.active ?? "—";
  const pendingContracts = rows?.contractStats?.pending ?? "—";
  const team = teamQuery.data;
  const binds = team?.myWork?.binds || [];
  const assignments = team?.myWork?.assignments || [];
  /** 待我确认的添加申请（服务商发起 → 我确认生效）。 */
  const invitations = team?.invitations || [];
  /** 我发起的挂靠申请（我发起 → 机构审批）。 */
  const myAffiliations = team?.affiliations || [];
  const pendingDecls = countPending(statistics.declarations, "tax");
  const pendingOverseas = countPending(statistics.overseas, "overseas");
  const pendingLogistics = countPending(statistics.logistics, "logistics");
  const pendingSmart = countPending(statistics.smart, "smart");
  const pendingMarketing = countPending(statistics.marketing, "marketing");
  const pendingLegal = countPending(statistics.legal, "legal");
  const pendingIp = countPending(statistics.ip, "ip");
  const pendingFlexWo = countPending(statistics.flexWo, "flexWorkOrder");
  const pendingAsset = countPending(statistics.asset, "asset");
  /** 供销网络＝订货单 + 预约单（两条线同一状态机，合并为一张卡）。 */
  const pendingSupplyOrders = countPending(statistics.supplyOrders, "supply");
  const pendingSupplyBookings = countPending(statistics.supplyBookings, "supply");
  const pendingSupply = typeof pendingSupplyOrders === "number" && typeof pendingSupplyBookings === "number"
    ? pendingSupplyOrders + pendingSupplyBookings : "—";
  const pendingOnboardings = statistics.onboardings ? statistics.onboardings.byStatus.SUBMITTED ?? 0 : "—";
  const adminPending = (key: string) =>
    rows?.stats ? Number(rows?.stats[key] ?? 0) : "—";
  const adminTodoTotal = rows?.stats
    ? ADMIN_PENDING_KEYS.reduce(
        (sum, key) => sum + Number(rows?.stats?.[key] ?? 0),
        0,
      )
    : "—";

  /** 「我的待办」：每个板块只列未完结件数，明细在对应模块处理。 */
  const cards: {
    label: string;
    hint: string;
    count: number | string;
    to: string;
    icon: ReactNode;
    domain?: string;
  }[] = isEnterprise
    ? [
        { label: "待办申报", hint: "处理中申报", count: pendingDecls, to: "/tax", icon: <FileTextOutlined aria-hidden />, domain: "tax" },
        { label: "跨境出海", hint: "进行中的出海服务单", count: pendingOverseas, to: "/overseas", icon: <GlobalOutlined aria-hidden />, domain: "overseas" },
        { label: "物流需求", hint: "进行中的物流工单", count: pendingLogistics, to: "/logistics", icon: <InboxOutlined aria-hidden />, domain: "logistics" },
        { label: "IT服务", hint: "进行中的IT服务需求", count: pendingSmart, to: "/smart", icon: <RobotOutlined aria-hidden />, domain: "smart" },
        { label: "法律需求", hint: "进行中的法律需求", count: pendingLegal, to: "/legal", icon: <AuditOutlined aria-hidden />, domain: "legal" },
        { label: "知识产权", hint: "进行中的知产需求", count: pendingIp, to: "/ip", icon: <TagOutlined aria-hidden />, domain: "ip" },
        { label: "灵活用工", hint: "进行中的用工需求", count: pendingFlexWo, to: "/flex", icon: <TeamOutlined aria-hidden />, domain: "flex" },
        { label: "营销需求", hint: "进行中的营销需求", count: pendingMarketing, to: "/marketing", icon: <NotificationOutlined aria-hidden />, domain: "marketing" },
        { label: "供销订单", hint: "进行中的订货单与预约单", count: pendingSupply, to: "/supply", icon: <ShoppingCartOutlined aria-hidden />, domain: "supply" },
        { label: "资产交易", hint: "进行中的资产需求", count: pendingAsset, to: "/asset", icon: <BankOutlined aria-hidden />, domain: "asset" },
      ]
    : isProvider
      ? [
          { label: "待处理申报", hint: "服务企业处理中申报", count: pendingDecls, to: "/tax", icon: <FileTextOutlined aria-hidden />, domain: "tax" },
          { label: "用工进件待审", hint: "待我审核", count: pendingOnboardings, to: "/flex", icon: <FileTextOutlined aria-hidden />, domain: "flex" },
          { label: "出海服务单", hint: "我办理中", count: pendingOverseas, to: "/overseas", icon: <GlobalOutlined aria-hidden />, domain: "overseas" },
          { label: "物流工单", hint: "我承运中", count: pendingLogistics, to: "/logistics", icon: <InboxOutlined aria-hidden />, domain: "logistics" },
          { label: "IT服务单", hint: "我承接中", count: pendingSmart, to: "/smart", icon: <RobotOutlined aria-hidden />, domain: "smart" },
          { label: "法律需求待办", hint: "我办理中", count: pendingLegal, to: "/legal", icon: <AuditOutlined aria-hidden />, domain: "legal" },
          { label: "知产需求待办", hint: "我办理中", count: pendingIp, to: "/ip", icon: <TagOutlined aria-hidden />, domain: "ip" },
          { label: "用工需求", hint: "我承接中", count: pendingFlexWo, to: "/flex", icon: <TeamOutlined aria-hidden />, domain: "flex" },
          { label: "营销需求待办", hint: "我对接中", count: pendingMarketing, to: "/marketing", icon: <NotificationOutlined aria-hidden />, domain: "marketing" },
          { label: "供销订单待办", hint: "我承接中", count: pendingSupply, to: "/supply", icon: <ShoppingCartOutlined aria-hidden />, domain: "supply" },
          { label: "资产交易待办", hint: "我承接中", count: pendingAsset, to: "/asset", icon: <BankOutlined aria-hidden />, domain: "asset" },
        ]
      : isStaff
        ? [
            { label: "我承办的申报", hint: "未办结", count: pendingDecls, to: "/tax", icon: <FileTextOutlined aria-hidden />, domain: "tax" },
            { label: "我承办的出海", hint: "未办结", count: pendingOverseas, to: "/overseas", icon: <GlobalOutlined aria-hidden />, domain: "overseas" },
            { label: "我承办的物流", hint: "未签收", count: pendingLogistics, to: "/logistics", icon: <InboxOutlined aria-hidden />, domain: "logistics" },
            { label: "我承办的IT服务", hint: "未交付", count: pendingSmart, to: "/smart", icon: <RobotOutlined aria-hidden />, domain: "smart" },
            { label: "我承办的法律", hint: "未办结", count: pendingLegal, to: "/legal", icon: <AuditOutlined aria-hidden />, domain: "legal" },
            { label: "我承办的知产", hint: "未办结", count: pendingIp, to: "/ip", icon: <TagOutlined aria-hidden />, domain: "ip" },
            { label: "我承办的用工需求", hint: "未办结", count: pendingFlexWo, to: "/flex", icon: <TeamOutlined aria-hidden />, domain: "flex" },
            { label: "我承办的进件", hint: "待审核", count: pendingOnboardings, to: "/flex", icon: <FileTextOutlined aria-hidden />, domain: "flex" },
            { label: "我承办的营销", hint: "未办结", count: pendingMarketing, to: "/marketing", icon: <NotificationOutlined aria-hidden />, domain: "marketing" },
            { label: "我承办的供销", hint: "未办结", count: pendingSupply, to: "/supply", icon: <ShoppingCartOutlined aria-hidden />, domain: "supply" },
            { label: "我承办的资产", hint: "未办结", count: pendingAsset, to: "/asset", icon: <BankOutlined aria-hidden />, domain: "asset" },
          ]
        : [
            { label: "待审服务商备案", hint: "待平台审核", count: adminPending("pendingProvider"), to: "/admin/provider-applications", icon: <SolutionOutlined aria-hidden /> },
          ];

  const desk = deskQuery.data;
  if (desk && (desk.waiting > 0 || desk.siteCount > 0 || desk.isAgent)) {
    cards.unshift({
      label: "客服待回复",
      hint: desk.isAgent ? "分配给你的官网咨询" : "待接入的官网咨询",
      count: desk.waiting,
      to: "/service-desk",
      icon: <MessageOutlined aria-hidden />,
    });
  }
  /** OA 按组织归属：取到统计说明当前身份在某个组织里有 OA 身份，才计入待办。 */
  if (oaQuery.data) {
    cards.push({
      label: "待我审批",
      hint: "停在流程里等我在 OA 里处理",
      count: oaQuery.data.todoCount,
      to: "/oa?tab=todo",
      icon: <FormOutlined aria-hidden />,
    });
  }
  const visibleCards = cards.filter((card) => !card.domain || scope.domains.includes(card.domain));
  /** 待办事项：本身份下可见卡片的未完结件数合计。 */
  const todoTotal = isAdmin
    ? adminTodoTotal
    : statisticsReady ? visibleCards.reduce((sum, card) => sum + Number(card.count), 0) : "—";
  /** 我的任务：当前主体名下项目中未办结的任务件数（项目管理口径）。 */
  const myTaskCount = pjQuery.error
    ? "—"
    : pjQuery.data
      ? pjQuery.data.openTasks
      : "…";
  const oaTodoCount = oaQuery.error ? "—" : oaQuery.data ? oaQuery.data.todoCount : "…";
  /** 未绑定 AIPDD Key 时才露出红色绑定入口；已绑定即消失（未取到状态时先露出，避免按钮闪烁）。 */
  const showAipddBind = !aipddKeyQuery.data?.bound;
  const unreadCount = notificationsQuery.data?.count ?? 0;
  const unreadValue = notificationsQuery.error
    ? "—"
    : notificationsQuery.isPending
      ? "…"
      : unreadCount;

  const enterpriseStatus = !me?.enterprise
    ? { text: "待填写用户信息", tone: "orange" as const }
    : (me.enterprise as Any).status === "APPROVED"
      ? { text: "资质已生效", tone: "green" as const }
      : { text: "档案处理中", tone: "orange" as const };

  const latestProviderApp = (me?.providerApps || [])
    .filter((item) => item && typeof item === "object")
    .sort((a, b) => String((b as Any).createdAt || "").localeCompare(String((a as Any).createdAt || "")))[0] as
      | Any
      | undefined;
  const providerStatus = latestProviderApp
    ? PROVIDER_STATUS_LABEL[String(latestProviderApp.status)] || String(latestProviderApp.status || "待审核")
    : "";
  const providerTone = latestProviderApp?.status === "APPROVED"
    ? "green" as const
    : latestProviderApp?.status === "REJECTED"
      ? "red" as const
      : "orange" as const;

  const heroStats: { label: string; value: string | number; hint?: string }[] = isEnterprise
    ? [
        { label: "生效签约", value: activeContracts, hint: "可接收服务的服务商" },
        { label: "待办事项", value: todoTotal, hint: "各板块未完结合计" },
        { label: "我的任务", value: myTaskCount, hint: "项目管理中未完结的任务" },
        { label: "OA待审批", value: oaTodoCount, hint: "OA 流程里等我处理的单据" },
        { label: "新消息", value: unreadValue, hint: "未读系统消息" },
      ]
    : isProvider
      ? [
          { label: "服务企业", value: team ? team.serves.length : "—", hint: "已签约企业" },
          { label: "生效签约", value: activeContracts, hint: `待确认 ${pendingContracts}` },
          { label: "待办事项", value: todoTotal, hint: "名下未完结合计" },
          { label: "我的任务", value: myTaskCount, hint: "项目管理中未完结的任务" },
          { label: "OA待审批", value: oaTodoCount, hint: "OA 流程里等我处理的单据" },
        ]
      : isStaff
        ? [
            { label: "绑定机构", value: team ? binds.length : "—", hint: "我的服务商" },
            { label: "承办企业", value: team ? assignments.length : "—", hint: "主办职员分配" },
            { label: "待办事项", value: todoTotal, hint: "我承办的未完结合计" },
            { label: "我的任务", value: myTaskCount, hint: "项目管理中未完结的任务" },
            { label: "OA待审批", value: oaTodoCount, hint: "OA 流程里等我处理的单据" },
          ]
        : [
            { label: "待办事项", value: adminTodoTotal, hint: "平台待审合计" },
            { label: "新消息", value: unreadValue, hint: "未读系统消息" },
          ];

  /** 待我处理：只列需要本人动作、且当前有件数的事项。 */
  const attention: AttentionItem[] = [];
  if (desk && desk.waiting > 0) {
    attention.push({
      key: "desk",
      label: "官网咨询待回复",
      hint: desk.isAgent ? "分配给你的访客会话" : "等待接入的访客会话",
      count: desk.waiting,
      to: "/service-desk",
    });
  }
  if (crmQuery.data?.isMember) {
    if (crmQuery.data.todo.approval > 0) {
      attention.push({
        key: "crm-approval",
        label: "CRM 待我审批",
        hint: "合同、报价、发票等审批",
        count: crmQuery.data.todo.approval,
        to: "/crm",
      });
    }
    if (crmQuery.data.todo.overdue > 0) {
      attention.push({
        key: "crm-overdue",
        label: "CRM 逾期回款",
        hint: "已过期未回款的收款计划",
        count: crmQuery.data.todo.overdue,
        to: "/crm",
      });
    }
  }
  const okr = okrQuery.data;
  if (okr?.pendingObjectives) {
    attention.push({
      key: "okr-objectives",
      label: "待承接目标",
      hint: "指派给我、还没接手的 OKR 目标",
      count: okr.pendingObjectives,
      to: "/okr?tab=objectives",
    });
  }
  if (okr?.pendingReports) {
    attention.push({
      key: "okr-reports",
      label: "待填汇报",
      hint: "本周报 / 日报还没提交",
      count: okr.pendingReports,
      to: "/okr?tab=reports",
    });
  }
  if (okr?.overduePlans) {
    attention.push({
      key: "okr-plans",
      label: "逾期计划",
      hint: "已过截止日仍未完成的计划",
      count: okr.overduePlans,
      to: "/okr?tab=plans",
    });
  }
  if (okr?.todoScores) {
    attention.push({
      key: "okr-scores",
      label: "待打分",
      hint: "周期复盘里待我评分的成员",
      count: okr.todoScores,
      to: "/okr?tab=stats",
    });
  }
  if (isStaff && invitations.length) {
    attention.push({
      key: "invitations",
      label: "待我确认的绑定邀请",
      hint: "服务商发起的添加申请",
      count: invitations.length,
      to: "/staff",
    });
  }
  if (isAdmin && typeof adminPending("pendingProvider") === "number" && Number(adminPending("pendingProvider")) > 0) {
    attention.push({
      key: "admin-provider",
      label: "待审服务商备案",
      hint: "待平台审核",
      count: Number(adminPending("pendingProvider")),
      to: "/admin/provider-applications",
    });
  }

  /** 与我相关的申请：只给状态与入口，材料与操作在对应模块。 */
  const applications: ApplicationStatusItem[] = [];
  if (isEnterprise) {
    applications.push({
      key: "enterprise",
      label: "身份与资质",
      hint: `用户身份 · ${subjectLabel(userSubject)}`,
      status: enterpriseStatus.text,
      tone: enterpriseStatus.tone,
      to: "/identity",
    });
  }
  if (isProvider) {
    applications.push({
      key: "provider",
      label: "服务商备案",
      hint: String(latestProviderApp?.orgName || "服务商资质"),
      status: providerStatus || "暂无备案记录",
      tone: providerStatus ? providerTone : "gray",
      to: "/identity",
    });
  }
  if ((isEnterprise || isProvider) && rows?.contractStats) {
    const active = Number(rows.contractStats.active || 0);
    const pending = Number(rows.contractStats.pending || 0);
    applications.push({
      key: "contracts",
      label: "服务签约",
      hint: "生效与待确认的签约",
      status: `生效 ${active} · 待确认 ${pending}`,
      tone: pending > 0 ? "orange" : active > 0 ? "green" : "gray",
      to: "/contracts",
    });
  }
  if (isStaff && myAffiliations.length) {
    const countOf = (status: string) =>
      myAffiliations.filter((row) => row.status === status).length;
    const pending = countOf("PENDING");
    const approved = countOf("APPROVED");
    const rejected = countOf("REJECTED");
    applications.push({
      key: "affiliations",
      label: "挂靠申请",
      hint: "我发起的加入服务商申请",
      status: `待审批 ${pending} · 已通过 ${approved} · 已驳回 ${rejected}`,
      tone: pending > 0 ? "orange" : approved > 0 ? "green" : "gray",
      to: "/staff",
    });
  }

  const openNotification = async (row: { id: number; link: string }) => {
    try {
      await notificationsApi.read({ params: { id: String(row.id) } });
    } catch {
      // 标记已读失败不影响跳转
    }
    if (row.link) router.push(row.link);
    void notificationsQuery.refetch();
  };

  return (
    <>
      {failedQueries.length > 0 && (
        <Notice variant="error">
          部分统计加载失败：{failedQueries[0].error?.message}
          <Button onClick={() => void Promise.all(failedQueries.map((item) => item.refetch()))}>重试</Button>
        </Notice>
      )}
      {teamQuery.error && (isProvider || isStaff) && (
        <Notice variant="error">
          团队数据加载失败：{teamQuery.error.message}
          <Button onClick={() => void teamQuery.refetch()}>重试</Button>
        </Notice>
      )}
      <PageHero
        title={
          <>
            {`你好，${me?.displayName || me?.username || "访客"} `}
            <SmileOutlined aria-hidden />
          </>
        }
        desc={
          <>
            当前身份：
            <span className={`badge badge-${IDENTITY_VARIANT[identity] || "gray"}`}>
              {identityLabel(identity, userSubject)}
            </span>
            <span className="text-12" style={{ marginLeft: 8 }}>
              本页只做动态概览，明细与操作请进入对应模块
            </span>
          </>
        }
        extra={
          <>
            {showAipddBind ? (
              <Button
                danger
                icon={<ApiOutlined />}
                onClick={() => router.push("/developer/keys#aipdd-key")}
              >
                AIPDD API Key 绑定
              </Button>
            ) : null}
            <Button
              icon={<KeyOutlined />}
              onClick={() => router.push("/developer/keys")}
            >
              管理API Key
            </Button>
            <Button
              icon={<PayCircleOutlined />}
              onClick={() => router.push("/points")}
            >
              积分充值
            </Button>
            {isAdmin ? (
              <Button
                type="primary"
                icon={<SettingOutlined />}
                onClick={() => router.push("/admin")}
              >
                管理后台
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<IdcardOutlined />}
                onClick={() => router.push("/identity")}
              >
                身份与资质
              </Button>
            )}
          </>
        }
      />

      <StatGrid>
        {heroStats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} hint={s.hint} />
        ))}
      </StatGrid>

      {/* 平台管理员：原「总览」板块并入驾驶舱，数据总览 / 待办审核 / 服务类型分布直接在这里看 */}
      {isAdmin ? (
        <OverviewTab onGoSection={(key) => router.push(`${ADMIN_PATH_PREFIX}/${key}`)} />
      ) : null}

      {isEnterprise && growthQuery.data ? (
        <GrowthCockpitPanel data={growthQuery.data} />
      ) : isEnterprise && growthQuery.error ? (
        <Notice variant="warn">
          增长驾驶舱暂不可用：{growthQuery.error.message}
          <Button onClick={() => void growthQuery.refetch()}>重试</Button>
        </Notice>
      ) : null}

      {isAdmin ? null : (
        <Panel
          title="我的待办"
          titleBadge={
            <span className="text-12 muted">
              {`只显示待办 / 进行中的件数（已办结不计入）${
                isProvider || isStaff ? "；未开通的服务类目不显示" : ""
              }；点击卡片进入对应模块办理`}
            </span>
          }
        >
          {visibleCards.length === 0 ? (
            <EmptyState
              icon={<KeyOutlined aria-hidden />}
              text={
                isStaff
                  ? "当前身份还没有开通任何服务类目：个人资料勾选服务类目、或服务商绑定并分配类目后，这里会出现对应板块待办"
                  : "当前身份还没有备案通过的服务类目：备案审核通过后，这里会出现对应板块待办"
              }
            />
          ) : (
            <div className="biz-grid">
              {visibleCards.map((card) => (
                <button
                  key={card.label}
                  type="button"
                  className="biz-card"
                  onClick={() => router.push(card.to)}
                >
                  <span className="biz-ico">{card.icon}</span>
                  <span className="biz-main">
                    <span className="biz-label">{card.label}</span>
                    <span className="biz-hint">{card.hint}</span>
                  </span>
                  <span className="biz-count">{card.count}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}

      <div className="exec-grid">
        <ExecutiveNotifications
          rows={notificationsQuery.data?.items || []}
          count={unreadCount}
          loading={notificationsQuery.isPending}
          failed={Boolean(notificationsQuery.error)}
          onOpen={openNotification}
        />
        <ExecutiveAttention
          items={attention}
          loading={
            deskQuery.isFetching ||
            crmQuery.isFetching ||
            okrQuery.isFetching ||
            (isStaff && teamQuery.isFetching)
          }
        />
      </div>

      {applications.length ? <ExecutiveApplications items={applications} /> : null}
    </>
  );
}