-- 内容创作与 Agent（P0）：七张新表，全部按账号归属；纯新增，不改既有表
-- CreateTable
CREATE TABLE IF NOT EXISTS "content_agent_conversations" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "title" VARCHAR(80) NOT NULL DEFAULT '',
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "content_agent_messages" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "media" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ok',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "content_agent_memories" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "normalized" VARCHAR(200) NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'agent',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "content_model_channels" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "base_url" VARCHAR(300) NOT NULL DEFAULT '',
    "key_cipher" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_model_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "content_model_slots" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "media_type" VARCHAR(16) NOT NULL,
    "channel_id" INTEGER NOT NULL DEFAULT 0,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_model_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "content_generation_jobs" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "tool" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "asset_url" TEXT NOT NULL DEFAULT '',
    "aipdd_asset_id" VARCHAR(64) NOT NULL DEFAULT '',
    "error" VARCHAR(500) NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "content_assets" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "job_id" INTEGER NOT NULL DEFAULT 0,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'image',
    "url" TEXT NOT NULL,
    "aipdd_asset_id" VARCHAR(64) NOT NULL DEFAULT '',
    "name" VARCHAR(200) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ok',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_agent_conversations_user_id_updated_at_idx"
ON "content_agent_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_agent_messages_conversation_id_created_at_idx"
ON "content_agent_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_agent_messages_user_id_created_at_idx"
ON "content_agent_messages"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "content_agent_memories_user_id_normalized_key"
ON "content_agent_memories"("user_id", "normalized");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_agent_memories_user_id_created_at_idx"
ON "content_agent_memories"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "content_model_channels_user_id_provider_name_key"
ON "content_model_channels"("user_id", "provider", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_model_channels_user_id_idx"
ON "content_model_channels"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "content_model_slots_user_id_media_type_key"
ON "content_model_slots"("user_id", "media_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_generation_jobs_user_id_created_at_idx"
ON "content_generation_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_generation_jobs_status_updated_at_idx"
ON "content_generation_jobs"("status", "updated_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_assets_user_id_created_at_idx"
ON "content_assets"("user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "content_assets_job_id_idx"
ON "content_assets"("job_id");
