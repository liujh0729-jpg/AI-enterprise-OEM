-- Agent 专家：一段指令生成的公共角色，全站可用、仅创建人可删；use_count 记被启用的会话数
CREATE TABLE IF NOT EXISTS "content_agent_experts" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(40) NOT NULL,
  "description" VARCHAR(200) NOT NULL DEFAULT '',
  "instruction" TEXT NOT NULL DEFAULT '',
  "prompt" TEXT NOT NULL DEFAULT '',
  "created_by" VARCHAR(64) NOT NULL,
  "creator_name" VARCHAR(64) NOT NULL DEFAULT '',
  "use_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "content_agent_experts_use_count_id_idx"
  ON "content_agent_experts"("use_count", "id");

-- 会话绑定使用的专家；专家被删也不清历史会话上的名字
ALTER TABLE "content_agent_conversations"
  ADD COLUMN IF NOT EXISTS "expert_id" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expert_name" VARCHAR(40) NOT NULL DEFAULT '';
