import { redirect } from "next/navigation";

/** 内建应用已并入「应用中心」，旧地址保留跳转。 */
export default function LegacyLowCodePage() {
  redirect("/app-center");
}