"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PageHero } from "@/components/ui/panel";
import { PAGE_META } from "@/config/routes";
import { ApiTab } from "../_components/api-tab";
import { McpTab } from "../_components/mcp-tab";
import { SkillTab } from "../_components/skill-tab";

const TABS = [
  { key: "skill", label: "Skill" },
  { key: "mcp", label: "MCP Server" },
  { key: "api", label: "API" },
];

const TAB_KEYS = new Set(TABS.map((item) => item.key));

/**
 * 模型服务 → API-MCP-Skill：
 * 平台生成的 Skill 包下载、MCP Server 接入说明与 REST API 文档合并为一个页面的三个页签。
 */
export default function ApiMcpSkillPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("view") || "skill";
  const view = TAB_KEYS.has(raw) ? raw : "skill";

  const changeTab = (key: string) => {
    router.replace(`/developer/api-mcp-skill?view=${key}`, { scroll: false });
  };
  const meta = PAGE_META["/developer/api-mcp-skill"];

  return (
    <>
      <PageHero
        title="API-MCP-Skill"
        desc={meta?.description}
        tabs={TABS}
        activeTab={view}
        onTabChange={changeTab}
      />
      {view === "skill" ? <SkillTab onOpenMcp={() => changeTab("mcp")} /> : null}
      {view === "mcp" ? <McpTab onOpenApi={() => changeTab("api")} /> : null}
      {view === "api" ? <ApiTab onOpenMcp={() => changeTab("mcp")} /> : null}
    </>
  );
}
