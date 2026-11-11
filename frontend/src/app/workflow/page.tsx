import { redirect } from "next/navigation";

/** 「工作流」菜单已收进 Agent 的「工作流」页签，旧地址保留跳转。 */
export default function LegacyWorkflowPage() {
  redirect("/agent?tab=workflow");
}
