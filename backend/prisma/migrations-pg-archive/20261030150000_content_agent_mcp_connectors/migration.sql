-- Agent MCP 连接器：把外部 MCP Server 的工具并入 Agent；按账号归属，额外请求头只存密文
CREATE TABLE IF NOT EXISTS "content_agent_mcp_connectors" (
  "id" SERIAL PRIMARY KEY,
  "user_id" VARCHAR(64) NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "transport" VARCHAR(8) NOT NULL DEFAULT 'http',
  "url" VARCHAR(500) NOT NULL,
  "headers" TEXT NOT NULL DEFAULT '',
  "header_names" JSONB NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "tool_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(300) NOT NULL DEFAULT '',
  "last_checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "content_agent_mcp_connectors_user_id_name_key"
  ON "content_agent_mcp_connectors"("user_id", "name");
CREATE INDEX IF NOT EXISTS "content_agent_mcp_connectors_user_id_enabled_idx"
  ON "content_agent_mcp_connectors"("user_id", "enabled");
