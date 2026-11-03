import { redirect } from "next/navigation";

/** 应用市场已并入「应用中心」的应用市场页签，旧地址保留跳转。 */
export default function LegacyAppsPage() {
  redirect("/app-center?tab=market");
}