import { redirect } from "next/navigation";

/** 旧地址保留跳转：API 文档已并入「开放集成 → API-MCP-Skill」。 */
export default function ApiDocsPage() {
  redirect("/developer/api-mcp-skill?view=api");
}
