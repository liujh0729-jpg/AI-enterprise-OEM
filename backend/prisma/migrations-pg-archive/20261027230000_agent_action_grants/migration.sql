-- 智能体记忆的账号级授权闸：勾选过的写动作才允许「企业自动化」MCP 无人值守执行
-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_action_grants" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "domain" VARCHAR(32) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_action_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_action_grants_user_id_action_key"
ON "agent_action_grants"("user_id", "action");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_action_grants_user_id_idx"
ON "agent_action_grants"("user_id");
