-- Google 潜客线索挖掘：设置 / 任务 / 意图澄清消息
--
-- 归属口径：全部按「账号」归属（user_id），不挂企业档案。
-- 幂等写法（IF NOT EXISTS）：既支持全新库从零建表，也支持已用 db push 建过的库补齐缺失对象。

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_prospecting_settings" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "serper_key_cipher" TEXT NOT NULL DEFAULT '',
    "data_table_id" INTEGER NOT NULL DEFAULT 0,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_prospecting_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_prospecting_settings_user_id_key" ON "lead_prospecting_settings"("user_id");

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_prospecting_tasks" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "spec" JSONB NOT NULL DEFAULT '{}',
    "raw_intent" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "total_found" INTEGER NOT NULL DEFAULT 0,
    "total_saved" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "data_table_id" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_prospecting_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_prospecting_tasks_user_id_created_at_idx" ON "lead_prospecting_tasks"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "lead_prospecting_tasks_status_idx" ON "lead_prospecting_tasks"("status");

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_prospecting_messages" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "task_id" INTEGER NOT NULL DEFAULT 0,
    "role" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_prospecting_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_prospecting_messages_user_id_task_id_created_at_idx" ON "lead_prospecting_messages"("user_id", "task_id", "created_at");
