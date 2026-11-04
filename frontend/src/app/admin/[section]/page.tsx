"use client";

import { CompassOutlined, LockOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { EmptyState, PageHero, Panel } from "@/components/ui/panel";
import { ADMIN_PATH_PREFIX, ADMIN_SECTIONS } from "@/config/routes";
import { useSession } from "@/lib/session";
import { CapabilityTab } from "../_components/capability-tab";
import { CommunityAdminTab } from "../_components/community-admin-tab";
import { ContractsTab } from "../_components/contracts-tab";
import { FlexPayrollSwitch } from "../_components/flex-payroll-switch";
import { GeoSettingsTab } from "../_components/geo-settings-tab";
import { OverviewTab } from "../_components/overview-tab";
import { ProviderApplicationsTab } from "../_components/provider-applications-tab";
import { ProvidersManageTab } from "../_components/providers-manage-tab";
import { SettingsTab } from "../_components/settings-tab";
import { ProvidersDisplayTab } from "../_components/providers-display-tab";
import { TaxAdminTab } from "../_components/tax-admin-tab";
import { SupplyTab } from "../_components/supply-tab";
import { EnterprisesTab } from "../_components/enterprises-tab";
import { UsersTab } from "../_components/users-tab";
import { LivecodeAdminTab } from "../_components/livecode-admin-tab";
import { PointsTab } from "../_components/points-tab";

/**
 * 平台管理后台板块页（`/admin/<板块>`）：板块由侧栏菜单切换，菜单/顶栏/hero 文案同源于
 * `ADMIN_SECTIONS`；总览的「前往审核」按板块 key 跳转。
 */
export default function AdminSectionPage() {
  const params = useParams<{ section: string }>();
  const router = useRouter();
  const { me, loading } = useSession();
  const isAdmin = Boolean(me?.identities?.includes("PLATFORM_ADMIN"));
  const section = String(params?.section || "");
  const meta = ADMIN_SECTIONS.find((item) => item.key === section);
  const go = (key: string) => router.push(`${ADMIN_PATH_PREFIX}/${key}`);

  /**
   * 深链直达也要按身份收口：非平台管理员不渲染任何管理板块（接口另有 403，
   * 但界面本身就不该出现）。会话未就绪时先不出内容，避免闪现后替换。
   */
  if (loading) return <Panel title="平台管理后台">正在确认身份…</Panel>;
  if (!isAdmin) {
    return (
      <Panel title="无访问权限">
        <EmptyState icon={<LockOutlined aria-hidden />} text="平台管理后台仅平台管理员可访问，请从高管驾驶舱返回首页。" />
      </Panel>
    );
  }

  if (!meta) {
    return (
      <Panel title="板块不存在">
        <EmptyState
          icon={<CompassOutlined aria-hidden />}
          text={`平台管理后台没有「${section}」这个板块，请从左侧菜单进入。`}
        />
      </Panel>
    );
  }

  return (
    <>
      <PageHero title={meta.name} desc={meta.desc} />

      {section === "overview" ? <OverviewTab onGoSection={go} /> : null}
      {section === "users" ? <UsersTab /> : null}
      {section === "enterprises" ? <EnterprisesTab /> : null}
      {section === "provider-applications" ? <ProviderApplicationsTab /> : null}
      {section === "providers" ? <ProvidersManageTab /> : null}
      {section === "flex" ? <FlexPayrollSwitch /> : null}
      {section === "contracts" ? <ContractsTab /> : null}
      {section === "supply" ? <SupplyTab /> : null}
      {section === "capabilities" ? <CapabilityTab /> : null}
      {section === "tax-admin" ? <TaxAdminTab /> : null}
      {section === "geo" ? <GeoSettingsTab /> : null}
      {section === "marketing-livecode" ? <LivecodeAdminTab /> : null}
      {section === "community" ? <CommunityAdminTab /> : null}
      {section === "points" ? <PointsTab /> : null}
      {section === "settings" ? <SettingsTab /> : null}
      {section === "provider-display" ? <ProvidersDisplayTab /> : null}
    </>
  );
}
