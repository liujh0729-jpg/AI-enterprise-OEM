"use client";

import {
  AimOutlined,
  FolderOpenOutlined,
  GiftOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  ClusterOutlined,
  CheckOutlined,
  DashboardOutlined,
  DownOutlined,
  FileDoneOutlined,
  FileProtectOutlined,
  GlobalOutlined,
  HomeOutlined,
  IdcardOutlined,
  KeyOutlined,
  LinkOutlined,
  LockOutlined,
  QrcodeOutlined,
  MailOutlined,
  LogoutOutlined,
  NotificationOutlined,
  PayCircleOutlined,
  PlayCircleOutlined,
  RocketOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ApiOutlined,
  BarChartOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  TableOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UsergroupAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  ProLayout,
  SettingDrawer,
  type ProLayoutProps,
  type ProSettings,
} from "@ant-design/pro-components";
import { App, Button, Dropdown, Result, Spin } from "antd";
import Link from "next/link";
import { NotificationBell } from "@/components/notification-bell";
import { PointsBalanceChip } from "@/components/points-balance-chip";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  defaultSettings,
  PRO_AVATAR,
  PRO_LAYOUT_BACKGROUNDS,
} from "@/config/default-settings";
import { navigationFor, type EnterpriseRoute } from "@/config/routes";
import { useSiteBrand } from "@/lib/site-brand";
import { useI18n } from "@/lib/i18n/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PRODUCT_NAME } from "@/lib/brand";
import { BUSINESS_IDENTITIES, identityLabel } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { IdentitySelectModal } from "../identity-select-modal";
import { BrandLogo } from "../brand-logo";

const ROUTE_ICONS = {
  dashboard: <DashboardOutlined />,
  idcard: <IdcardOutlined />,
  contract: <FileProtectOutlined />,
  shop: <ShopOutlined />,
  global: <GlobalOutlined />,
  audit: <AuditOutlined />,
  safety: <SafetyCertificateOutlined />,
  team: <TeamOutlined />,
  peoples: <UsergroupAddOutlined />,
  setting: <SettingOutlined />,
  api: <ApiOutlined />,
  rocket: <RocketOutlined />,
  chip: <RobotOutlined />,
  robot: <RobotOutlined />,
  play: <PlayCircleOutlined />,
  folder: <FolderOpenOutlined />,
  horn: <NotificationOutlined />,
  credential: <LockOutlined />,
  table: <TableOutlined />,
  bank: <BankOutlined />,
  asset: <HomeOutlined />,
  key: <KeyOutlined />,
  book: <BookOutlined />,
  bolt: <ThunderboltOutlined />,
  link: <LinkOutlined />,
  network: <ClusterOutlined />,
  "file-done": <FileDoneOutlined />,
  search: <SearchOutlined />,
  apps: <AppstoreOutlined />,
  appstore: <AppstoreOutlined />,
  mail: <MailOutlined />,
  qrcode: <QrcodeOutlined />,
  chart: <BarChartOutlined />,
  target: <AimOutlined />,
  gift: <GiftOutlined />,
  "pay-circle": <PayCircleOutlined />,
} as const;

type MenuRoute = {
  path?: string;
  name?: string;
  key?: string;
  type?: "group";
  syntheticGroup?: boolean;
  icon?: ReactNode;
  hideInMenu?: boolean;
  routes?: MenuRoute[];
};

function withRouteIcons(route: EnterpriseRoute, t: (text: string) => string): MenuRoute {
  const path = route.path || (route.type === "group" && route.name
    ? `/__menu/${encodeURIComponent(route.name)}` : undefined);
  return {
    path,
    // 菜单名按当前语言取译名（字典未命中回落中文原文）；分组 key 仍用中文原名，不受翻译影响。
    name: route.name ? t(route.name) : route.name,
    key: path,
    syntheticGroup: route.type === "group",
    hideInMenu: route.hideInMenu,
    icon: route.icon
      ? ROUTE_ICONS[route.icon as keyof typeof ROUTE_ICONS]
      : undefined,
    routes: route.routes
      ?.map((child) => withRouteIcons(child, t))
      .filter((child) => child.syntheticGroup ? Boolean(child.routes?.length) : Boolean(child.path || child.routes?.length)),
  };
}

const SETTINGS_KEY = "aiworkin-enterprise-pro-settings";
const IDENTITY_GUIDE: Record<string, string> = {
  ENTERPRISE_USER: "请先到「身份与资质」提交用户信息。",
  SERVICE_PROVIDER: "请先到「身份与资质」提交服务商备案并等待审核。",
  PROVIDER_STAFF: "请先到「身份与资质」提交职员备案并完成绑定。",
};

export function EnterpriseProLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { message, modal } = App.useApp();
  const { me, loading, switchingIdentity, switchIdentity, logout } = useSession();
  const { t } = useI18n();
  const [settings, setSettings] = useState<ProLayoutProps>(defaultSettings);
  const [pathnameReady, setPathnameReady] = useState(false);
  const isAdmin = Boolean(me?.identities?.includes("PLATFORM_ADMIN"));
  const isPlatformArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const identity = me?.currentIdentity;
  // 管理员在「站点设置」隐藏的业务服务 / 开放集成菜单项与 AI增值服务整组：站配置经 SiteBrandProvider 全局透出，保存后即时生效。
  const siteBrand = useSiteBrand();
  const menuRoute = withRouteIcons(
    navigationFor(
      me,
      siteBrand.businessMenuHidden || [],
      siteBrand.integrationMenuHidden || [],
      Boolean(siteBrand.aiServicesHidden),
    ),
    t,
  );
  const identityOptions = [
    ...BUSINESS_IDENTITIES,
    ...(isAdmin ? ["PLATFORM_ADMIN"] : []),
  ].map((value) => ({
    value,
    label: identityLabel(value, me?.enterprise?.subjectType),
  }));

  const changeIdentity = async (next: string, destination = "/") => {
    if (switchingIdentity) return;
    if (!me?.identities.includes(next)) {
      modal.confirm({
        title: `「${identityLabel(next, me?.enterprise?.subjectType)}」身份尚未开通`,
        content: IDENTITY_GUIDE[next] || "该身份尚未开通",
        okText: "去提交材料",
        cancelText: "稍后再说",
        onOk: () => router.push(`/identity?identity=${next}`),
      });
      return;
    }
    try {
      if (next !== identity) await switchIdentity(next);
      window.localStorage.setItem("identity_selected", "1");
      // 回到新身份的高管驾驶舱，避免停留在原身份的页签或已隐藏模块中。
      router.replace(destination);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "身份切换失败，请重试");
    }
  };

  useEffect(() => {
    setPathnameReady(true);
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    try {
      setSettings({
        ...defaultSettings,
        ...(JSON.parse(raw) as ProLayoutProps),
      });
    } catch {
      window.localStorage.removeItem(SETTINGS_KEY);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("colorWeak", Boolean(settings.colorWeak));
  }, [settings.colorWeak]);

  // 新注册账号（一个身份都没开通）：默认用户身份，直接带到「身份与资质」提交材料
  useEffect(() => {
    if (!me || isPlatformArea || pathname?.startsWith("/identity")) return;
    if (me.identities?.length) return;
    const asked = `aiworkin-identity-onboarded:${me.userId}`;
    if (window.sessionStorage.getItem(asked)) return;
    window.sessionStorage.setItem(asked, "1");
    router.replace("/identity?identity=ENTERPRISE_USER");
  }, [isPlatformArea, me, pathname, router]);

  return (
    <div id="enterprise-pro-layout" className="enterprise-pro-layout">
      <IdentitySelectModal />
      <ProLayout
        {...settings}
        key={identity || "loading"}
        title={siteBrand.siteName || PRODUCT_NAME}
        logo={<BrandLogo src={siteBrand.siteLogo || undefined} />}
        location={{ pathname: pathnameReady ? pathname : "/" }}
        route={menuRoute}
        menu={{ ...settings.menu, defaultOpenAll: false, autoClose: false }}
        bgLayoutImgList={PRO_LAYOUT_BACKGROUNDS}
        menuItemRender={(item, dom) => {
          if (!item.path || item.children?.length) {
            return dom;
          }
          if (/^https?:\/\//.test(item.path)) {
            return <a href={item.path} target="_blank" rel="noreferrer">{dom}</a>;
          }
          return (
            <a
              href={item.path}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                router.push(item.path || "/");
              }}
            >
              {dom}
            </a>
          );
        }}
        menuProps={{
          onClick: ({ key, domEvent }) => {
            // 菜单容器也响应点击；分组和外链交给各自的默认行为。
            if (typeof key !== "string" || !key.startsWith("/") || key.startsWith("/__menu/")) return;
            if (domEvent.metaKey || domEvent.ctrlKey || domEvent.shiftKey || domEvent.altKey) return;
            domEvent.preventDefault();
            router.push(key);
          },
        }}
        breadcrumbRender={(routers = []) => [
          { path: "/", title: siteBrand.siteName || PRODUCT_NAME },
          ...routers,
        ]}
        itemRender={(route) => {
          const href =
            "path" in route && typeof route.path === "string"
              ? route.path
              : "/";
          const title =
            ("title" in route && route.title) ||
            ("breadcrumbName" in route && route.breadcrumbName) ||
            href;
          return <Link href={href || "/"}>{title}</Link>;
        }}
        actionsRender={() => [
          <PointsBalanceChip key="points" />,
          <LanguageSwitcher key="lang" compact />,
          <NotificationBell key="notifications" />,
          <Button
            key="settings"
            type="text"
            size="small"
            icon={<SettingOutlined />}
            style={{ opacity: 0.65 }}
            onClick={() => {
              const handle = document.querySelector('.ant-pro-setting-drawer-handle') as HTMLElement;
              if (handle) handle.click();
            }}
            aria-label="布局设置"
          />,
          <div key="identity" className="workspace-identity">
            <Dropdown
              trigger={["click"]}
              disabled={loading || switchingIdentity || !me}
              menu={{
                className: "workspace-identity-menu",
                selectedKeys: identity ? [identity] : [],
                items: identityOptions.map((option) => ({
                  key: option.value,
                  icon: <span className="workspace-identity-check">{option.value === identity && <CheckOutlined />}</span>,
                  label: (
                    <span className="workspace-identity-option">
                      {option.label}
                      {!me?.identities.includes(option.value) && <span className="text-12 muted">{t("去开通")}</span>}
                    </span>
                  ),
                })),
                onClick: ({ key }) => void changeIdentity(key),
              }}
            >
              <Button
                type="text"
                className="workspace-identity-trigger"
                aria-label={`当前身份：${identityLabel(identity, me?.enterprise?.subjectType)}，切换身份`}
                aria-haspopup="menu"
                loading={loading || switchingIdentity}
                disabled={loading || switchingIdentity || !me}
                icon={<UserOutlined />}
              >
                <span className="workspace-identity-text">{identityLabel(identity, me?.enterprise?.subjectType)}</span>
                <DownOutlined className="workspace-identity-arrow" />
              </Button>
            </Dropdown>
          </div>,
        ]}
        avatarProps={{
          src: me?.avatarUrl || PRO_AVATAR,
          size: "small",
          title: me?.displayName || me?.username || t("未登录"),
          render: (_, avatarChildren) => (
            <Dropdown
              menu={{
                items: [
                  ...(isAdmin && identity !== "PLATFORM_ADMIN" ? [{
                    key: "platform",
                    icon: <AppstoreOutlined />,
                    label: t("切换到平台管理"),
                    disabled: switchingIdentity,
                    onClick: () => void changeIdentity("PLATFORM_ADMIN", "/admin/overview"),
                  }, { type: "divider" as const }] : []),
                  ...(isPlatformArea ? [{
                    key: "back",
                    icon: <AppstoreOutlined />,
                    label: t("返回高管驾驶舱"),
                    onClick: () => router.push("/"),
                  }, { type: "divider" as const }] : []),
                  {
                    key: "identity",
                    icon: <UserOutlined />,
                    label: t("身份与资质"),
                    onClick: () => router.push("/identity"),
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: t("退出登录"),
                    onClick: logout,
                  },
                ],
              }}
            >
              {avatarChildren}
            </Dropdown>
          ),
        }}
        footerRender={false}
      >
        {loading || switchingIdentity ? (
          <div className="workspace-loading"><Spin description={t("正在确认身份…")}><div /></Spin></div>
        ) : !me ? (
          <Result status="warning" title={t("无法确认当前身份")} extra={<Button onClick={() => window.location.reload()}>{t("刷新页面")}</Button>} />
        ) : isPlatformArea && identity !== "PLATFORM_ADMIN" ? (
          <Result
            status="403"
            title={isAdmin ? t("请切换到平台管理员身份") : t("当前身份无法访问平台管理")}
            subTitle={t("平台管理使用独立的身份和导航。")}
            extra={isAdmin
              ? <Button type="primary" onClick={() => void changeIdentity("PLATFORM_ADMIN", pathname)}>{t("以平台管理员身份进入")}</Button>
              : <Button onClick={() => router.replace("/")}>{t("返回高管驾驶舱")}</Button>}
          />
        ) : <Fragment key={`${me.userId}:${identity}`}>{children}</Fragment>}
      </ProLayout>
      <style>{`
        .ant-pro-setting-drawer-handle {
          display: none !important;
        }
      `}</style>
      <SettingDrawer
        settings={settings as ProSettings}
        onSettingChange={(changedSettings) => {
          const next = { ...settings, ...changedSettings };
          setSettings(next);
          window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        }}
        disableUrlParams
      />
    </div>
  );
}
