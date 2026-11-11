"use client";

import { Button, ConfigProvider } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { identityApi } from "@/api/identity";
import { Notice, PageHero } from "@/components/ui/panel";
import { useMyAffiliations, useStaffWorkspace } from "@/query/identity";
import { useBusinessQuery } from "@/query/business";
import { isPersonalSubject } from "@/lib/subject";
import { useSession } from "@/lib/session";
import { AffiliationPanel } from "./_components/affiliation-panel";
import { EnterpriseAssignPanel } from "./_components/enterprise-assign-panel";
import { InvitationConfirmPanel } from "./_components/invitation-confirm-panel";
import { InvitationPanel } from "./_components/invitation-panel";
import { JoinPanel } from "./_components/join-panel";
import { MyWorkPanels } from "./_components/my-work-panel";
import { StaffPanel } from "./_components/staff-panel";
import { TeamOverview } from "./_components/team-overview";
import { OrgStaffPanel } from "./_components/org-staff-panel";
import { FunctionsPanel } from "./_components/functions-panel";
import {
  StaffImWorkspace,
  type StaffImView,
} from "./_components/im-workspace";

type StaffView = "manage" | "functions" | StaffImView;

const IM_TABS = [
  { key: "mapping", label: "IM 映射总览" },
  { key: "connectors", label: "连接设置" },
  { key: "departments", label: "部门映射" },
  { key: "objects", label: "同步对象" },
  { key: "notify", label: "通知规则" },
  { key: "logs", label: "同步记录" },
];
const TABS = [
  { key: "manage", label: "管理" },
  { key: "functions", label: "职能管理" },
  ...IM_TABS,
];

/**
 * 职员/代理人管理（对齐 demo public/assets/js/pages/staff.js）
 * - 服务商视角：添加 AIworkin 账号为职员/代理人（**双向确认**：服务商发起申请 → 职员确认生效；同一机构同一类目只留一条，账号可同时加入多家机构）
 * - 职员/代理人与个人用户视角：按本人申报的服务板块找已备案服务商「申请加入」，审批通过后成为该机构职员/代理人
 * - 角色与服务类目一致（可多选）
 * - 企业分配在本页「企业分配（服务企业列表）」（POST /enterprise/staff/assignments）
 */
export default function StaffPage() {
  const router = useRouter();
  const { me } = useSession();
  const [view, setView] = useState<StaffView>("manage");
  // 深链直达：/staff?tab=functions 定位到职能管理
  const wantedTab = useSearchParams().get("tab") || "";
  useEffect(() => {
    if (TABS.some((item) => item.key === wantedTab)) setView(wantedTab as StaffView);
  }, [wantedTab]);
  /** 服务商视角＝本机构管理职员；仅「服务商身份」可进入。 */
  const isProviderIdentity =
    (me?.currentIdentity || "") === "SERVICE_PROVIDER";
  /**
   * 职员/代理人身份与个人用户进本页走「申请加入服务商」视角
   * （没有服务商列表就无从申请加入，故这里直接给出可申请的名录）。
   */
  const isJoinIdentity =
    (me?.currentIdentity || "") === "PROVIDER_STAFF" ||
    isPersonalSubject(
      (me?.enterprise as { subjectType?: string } | null)?.subjectType,
    );
  /** 企业（非个人主体）进入同一页面：职员与代理人，与服务商同结构。 */
  const isEnterpriseIdentity =
    (me?.currentIdentity || "") === "ENTERPRISE_USER" &&
    Boolean(me?.enterprise) &&
    !isPersonalSubject(
      (me?.enterprise as { subjectType?: string } | null)?.subjectType,
    );
  const workspace = useStaffWorkspace(isProviderIdentity);
  const mine = useMyAffiliations(Boolean(me) && isJoinIdentity);
  const isStaffIdentity = (me?.currentIdentity || "") === "PROVIDER_STAFF";
  const myWork = useBusinessQuery(
    "identity",
    "my-work",
    {},
    (signal) => identityApi.myWork({}, { signal }),
    "all",
    Boolean(me) && isStaffIdentity,
  );
  const staffRows = workspace.data?.staff ?? [];
  const affiliations = workspace.data?.affiliations ?? [];
  const enterprises = workspace.data?.enterprises ?? [];
  const loading = isJoinIdentity ? mine.isPending : workspace.isPending;
  const denied = workspace.error?.message ?? "";
  const { refetch } = workspace;

  useEffect(() => {
    if (isJoinIdentity || isProviderIdentity || isEnterpriseIdentity || !me) return;
    // 企业/个体工商户身份没有本视角，也不该看到服务商的管理功能（不发起请求、直接回驾驶舱）
    router.replace("/dashboard");
  }, [me, isJoinIdentity, isProviderIdentity, isEnterpriseIdentity, router]);

  // 职员/代理人与个人用户：找服务商申请加入 + 我的加入申请
  if (me && isJoinIdentity) {
    const loadMine = async () => {
      await Promise.all([
        mine.refetch(),
        isStaffIdentity ? myWork.refetch() : Promise.resolve(),
      ]);
    };
    // 本清单只看本人发起的申请；服务商发起的添加邀请在下方单独确认
    const myApplies = (mine.data || []).filter(
      (row) => row.direction !== "PROVIDER_INVITE",
    );
    return (
      <ConfigProvider button={{ autoInsertSpace: false }}>
        <PageHero
          title="申请加入服务商"
          desc="按你在「身份与资质」申报的服务板块列出已备案服务商 → 查看详情 →「申请加入」→ 机构审核通过后你即成为其职员/代理人。一个账号可同时加入多家服务商；服务商发起的添加邀请在本页确认。"
        />
        {isStaffIdentity ? (
          <InvitationConfirmPanel
            rows={mine.data || []}
            loading={mine.isPending}
            onDone={loadMine}
          />
        ) : null}
        <JoinPanel
          myApplications={myApplies}
          loading={loading}
          onDone={loadMine}
        />
        {isStaffIdentity && myWork.data ? (
          <MyWorkPanels
            binds={myWork.data.binds || []}
            assignments={myWork.data.assignments || []}
            loading={myWork.isPending}
            onDone={loadMine}
          />
        ) : null}
      </ConfigProvider>
    );
  }

  // 企业：同一套「职员与代理人」（企业职员拥有本企业全量业务，代理人按指派）
  if (me && isEnterpriseIdentity) {
    return (
      <ConfigProvider button={{ autoInsertSpace: false }}>
        <PageHero
          title="职员与代理人"
          desc="和服务商同一套模式：邀请 → 本人确认后生效。企业职员可处理本企业全部业务；代理人只处理被指派的范围。下方「IM」页签把飞书 / 企业微信成员与本系统成员做非对称映射，并可直接给成员发 AIworkin 社交私信。"
          tabs={TABS}
          activeTab={view}
          onTabChange={(key) => setView(key as StaffView)}
        />
        {view === "manage" ? (
          <OrgStaffPanel />
        ) : view === "functions" ? (
          <FunctionsPanel orgType="ENTERPRISE" />
        ) : (
          <StaffImWorkspace view={view as StaffImView} />
        )}
      </ConfigProvider>
    );
  }

  // 其他身份回到驾驶舱
  if (me && !isProviderIdentity) {
    return null;
  }

  /** 对齐 demo：仅统计在职（ACTIVE）职员；后端 /enterprise/staff 未按状态过滤。 */
  const activeStaff = staffRows.filter((row) => row.status === "ACTIVE");
  const assigned = enterprises.filter((item) => item.staffUserId).length;
  const unassigned = enterprises.length - assigned;
  /** 同一张表两个方向：PROVIDER_INVITE＝本机构发起的添加申请（待对方确认）；其余＝职工发起的加入申请（待本机构审批）。 */
  const invitations = affiliations.filter(
    (row) => row.direction === "PROVIDER_INVITE",
  );
  const staffApplications = affiliations.filter(
    (row) => row.direction !== "PROVIDER_INVITE",
  );

  return (
    // 按钮文案与 demo 逐字一致：关闭 antd 对 2 个汉字按钮自动插入空格的行为
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="职员/代理人管理"
        desc="添加 AIworkin 账号为职员/代理人（发起添加申请 → 对方确认后生效）→ 审批职员发起的加入申请 → 在下方「企业分配」把服务企业分配给职员承办 → 企业资料与未完结业务自动流转给承办职员。IM 页签把飞书 / 企业微信成员与这里的职员做非对称映射，并可直接发 AIworkin 社交私信。"
        tabs={TABS}
        activeTab={view}
        onTabChange={(key) => setView(key as StaffView)}
      />

      {view === "functions" ? (
        <FunctionsPanel orgType="PROVIDER" />
      ) : view !== "manage" ? (
        <StaffImWorkspace view={view as StaffImView} />
      ) : (
        <>
          {denied ? (
            <Notice variant="error">
              {denied} <Button onClick={() => void refetch()}>重试</Button>
            </Notice>
          ) : null}

          <TeamOverview
            staffCount={activeStaff.length}
            assigned={assigned}
            unassigned={unassigned}
          />

          <InvitationPanel
            rows={invitations}
            loading={loading}
            denied={Boolean(denied)}
          />

          <AffiliationPanel rows={staffApplications} loading={loading} />

          <EnterpriseAssignPanel
            rows={enterprises}
            loading={loading}
            denied={Boolean(denied)}
          />

          <StaffPanel
            rows={activeStaff}
            enterprises={enterprises}
            loading={loading}
          />
        </>
      )}
    </ConfigProvider>
  );
}
