-- 连接器最近一次探测到的工具名：只给界面展示，调用仍按连接器实时拉取
ALTER TABLE "content_agent_mcp_connectors"
ADD COLUMN "tool_names" JSONB NOT NULL DEFAULT '[]';
