import { endpoints } from "@enterprise/contracts";
import { endpoint } from "@/api/endpoint";

/**
 * 帮助中心（章节知识库）界面层：章节目录 / 主题详情 / 全文搜索三个只读接口，都走 /enterprise/help/*（登录态）。
 * 与 MCP（Help_*）读同一份内置知识——页面看到的就是 Agent 能答的。
 */
export const helpApi = {
  chapters: endpoint(endpoints.Help_chapters),
  topic: endpoint(endpoints.Help_topic),
  search: endpoint(endpoints.Help_search),
};
