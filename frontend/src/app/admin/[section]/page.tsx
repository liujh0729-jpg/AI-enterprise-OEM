"use client";

import { CompassOutlined, LockOutlined } from "@ant-design/icons";
import { useParams } from "next/navigation";
import { EmptyState, PageHero, Panel } from "@/components/ui/panel";
import { ADMIN_SECTIONS } from "@/config/routes";
import { useSession } from "@/lib/session";
import { CapabilityTab } from "../_components/capability-tab";
import { CommunityAdminTab } from "../_components/community-admin-tab";
import { ContractsTab } from "../_components/contracts-tab";
import { FlexPayrollSwitch } from "../_components/flex-payroll-switch";
import { GeoSettingsTab } from "../_components/geo-settings-tab";
import { ProviderApplicationsTab } from "../_components/provider-applications-tab";
import { ProvidersManageTab } from "../_components/providers-manage-tab";
import { SettingsTab } from "../_components/settings-tab";
import { UpgradeTab } from "../_components/upgrade-tab";
import { AiCodeTab } from "../_components/ai-code-tab";
import { TaxAdminTab } from "../_components/tax-admin-tab";
import { SupplyTab } from "../_components/supply-tab";
import { EnterprisesTab } from "../_components/enterprises-tab";
import { FeaturesTab } from "../_components/features-tab";
import { SkillGeneratorTab } from "../_components/skill-generator-tab";
import { PublishReviewTab } from "../_components/publish-review-tab";
import { UsersTab } from "../_components/users-tab";
import { LivecodeAdminTab } from "../_components/livecode-admin-tab";
import { VideoTemplateAdminTab } from "../_components/video-template-admin-tab";
import { PointsTab } from "../_components/points-tab";
import { ServicePackagesTab } from "../_components/service-packages-tab";
import { ModelPlazaAdminTab } from "../_components/model-plaza-admin-tab";
import { HardwareAdminTab } from "../_components/hardware-admin-tab";
import { WechatMpTab } from "../_components/wechat-mp-tab";
import {
  GapsChangelogTab,
  GapsEntitlementsTab,
  GapsTermsTab,
  GapsUsageTab,
} from "../_components/gaps-admin";

/**
 * 平台管理后台板块页（`/admin/<板块>`）：板块由侧栏菜单切换，菜单/顶栏/hero 文案同源于
 * `ADMIN_SECTIONS`；平台数据总览已并入驾驶舱，这里只渲染分组下的管理板块。
 */
export default function AdminSectionPage() {
  const params = useParams<{ section: string }>();
  const { me, loading } = useSession();
  const isAdmin = Boolean(me?.identities?.includes("PLATFORM_ADMIN"));
  const section = String(params?.section || "");
  const meta = ADMIN_SECTIONS.find((item) => item.key === section);

  /**
   * 深链直达也要按身份收口：非平台管理员不渲染任何管理板块（接口另有 403，
   * 但界面本身就不该出现）。会话未就绪时先不出内容，避免闪现后替换。
   */
  if (loading) return <Panel title="平台管理后台">正在确认身份…</Panel>;
  if (!isAdmin) {
    return (
      <Panel title="无访问权限">
        <EmptyState icon={<LockOutlined aria-hidden />} text="平台管理后台仅平台管理员可访问，请从驾驶舱返回首页。" />
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
      {section === "video-templates" ? <VideoTemplateAdminTab /> : null}
      {section === "points" ? <PointsTab /> : null}
      {section === "service-packages" ? <ServicePackagesTab /> : null}
      {section === "model-plaza" ? <ModelPlazaAdminTab /> : null}
      {section === "hardware" ? <HardwareAdminTab /> : null}
      {section === "features" ? <FeaturesTab /> : null}
      {section === "skill-generator" ? <SkillGeneratorTab /> : null}
      {section === "publish-review" ? <PublishReviewTab /> : null}
      {section === "entitlements" ? <GapsEntitlementsTab /> : null}
      {section === "usage" ? <GapsUsageTab /> : null}
      {section === "terms" ? <GapsTermsTab /> : null}
      {section === "changelog" ? <GapsChangelogTab /> : null}
      {section === "upgrade" ? <UpgradeTab /> : null}
      {section === "ai-code" ? <AiCodeTab /> : null}
      {section === "wechat-mp" ? <WechatMpTab /> : null}
      {section === "settings" ? <SettingsTab /> : null}
    </>
  );
}
