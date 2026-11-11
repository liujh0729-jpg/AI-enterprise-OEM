import { redirect } from "next/navigation";

/** 旧地址保留跳转：MCP Server 已并入「模型服务 → API-MCP-Skill」。 */
export default function McpPage() {
  redirect("/developer/api-mcp-skill?view=mcp");
}
