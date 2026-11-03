-- Agent 技能：一句说明进系统提示，模型用 load_skill 取全文；纯新增表
-- CreateTable
CREATE TABLE IF NOT EXISTS "content_agent_skills" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(200) NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "content_agent_skills_user_id_name_key"
ON "content_agent_skills"("user_id", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_agent_skills_user_id_enabled_idx"
ON "content_agent_skills"("user_id", "enabled");
