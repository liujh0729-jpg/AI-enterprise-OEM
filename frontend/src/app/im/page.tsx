import { redirect } from "next/navigation";

/** IM 连接已并入「职员/代理人管理」页签，旧地址保留跳转。 */
export default function LegacyImPage() {
  redirect("/staff");
}