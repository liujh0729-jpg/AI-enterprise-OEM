-- 大数据查询（营销工具）：设置 / 任务 / 需求澄清消息
--
-- 归属口径：全部按「账号」归属（user_id），并按数据集（dataset）分列——
-- 企业数据 / 全球贸易大数据 / 全球商务人士大数据 / 全球达人大数据 / 全球POI大数据
-- 五个工具彼此独立，各有各的设置、对话、任务列表与多维表格结果表。
-- 幂等写法（IF NOT EXISTS）：既支持全新库从零建表，也支持已用 db push 建过的库补齐缺失对象。

-- CreateTable
CREATE TABLE IF NOT EXISTS "bigdata_query_settings" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "dataset" VARCHAR(32) NOT NULL,
    "data_table_id" INTEGER NOT NULL DEFAULT 0,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bigdata_query_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bigdata_query_settings_user_id_dataset_key" ON "bigdata_query_settings"("user_id", "dataset");

-- CreateTable
CREATE TABLE IF NOT EXISTS "bigdata_query_tasks" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "dataset" VARCHAR(32) NOT NULL,
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

    CONSTRAINT "bigdata_query_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bigdata_query_tasks_user_id_dataset_created_at_idx" ON "bigdata_query_tasks"("user_id", "dataset", "created_at");
CREATE INDEX IF NOT EXISTS "bigdata_query_tasks_status_idx" ON "bigdata_query_tasks"("status");

-- CreateTable
CREATE TABLE IF NOT EXISTS "bigdata_query_messages" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "dataset" VARCHAR(32) NOT NULL,
    "task_id" INTEGER NOT NULL DEFAULT 0,
    "role" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bigdata_query_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bigdata_query_messages_user_id_dataset_idx" ON "bigdata_query_messages"("user_id", "dataset", "task_id", "created_at");
