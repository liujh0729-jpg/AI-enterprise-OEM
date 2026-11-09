"use client";

import { Alert, Spin } from "antd";
import { useSession } from "@/lib/session";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const EnterpriseProLayout = dynamic(
  () =>
    import("./pro/pro-layout").then((module) => module.EnterpriseProLayout),
  {
    ssr: false,
    loading: () => (
      <div style={{ minHeight: "100vh", background: "#f5f5f5" }} />
    ),
  },
);

/** 官网首页与登录页独立于应用外壳渲染（不显示侧栏与顶栏，且首页无需登录态）。 */
const SHELL_FREE_PATHS = ["/", "/login"];

/** 独立版面（移动端 H5、微信服务号入口、简历打印页）：整屏一列，不套桌面侧栏与顶栏。 */
const SHELL_FREE_PREFIXES = ["/m/", "/embed/", "/resume/", "/survey/", "/book/", "/terms/"];

/** 访客公开页（官网客服窗口、注册协议等法务页）：连登录态都不需要，不能等 me 或报「无法确认身份」。 */
const LOGIN_FREE_PREFIXES = ["/embed/", "/agreement/", "/survey/", "/book/", "/terms/"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {me,loading,switchingIdentity}=useSession();
  const shellFree = SHELL_FREE_PATHS.includes(pathname ?? "");
  const loginFree = LOGIN_FREE_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
  if(!shellFree && !loginFree){
    if(loading||switchingIdentity)return <Spin fullscreen description="正在确认身份…" />;
    if(!me)return <Alert type="error" title="无法确认当前身份，请刷新页面重试" />;
  }
  if (
    shellFree ||
    loginFree ||
    SHELL_FREE_PREFIXES.some((prefix) => pathname?.startsWith(prefix))
  ) {
    return <>{children}</>;
  }
  return <EnterpriseProLayout>{children}</EnterpriseProLayout>;
}
