-- 腾讯企点营销云工具：凭据账号、任务、任务日志、列映射四张表。
-- 只新增表，不动既有数据；写法幂等，便于已用 db push 建过的库补齐。

CREATE TABLE IF NOT EXISTS "tp_accounts" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "product" VARCHAR(16) NOT NULL,
    "label" VARCHAR(191) NOT NULL DEFAULT '',
    "gateway" VARCHAR(191) NOT NULL DEFAULT 'https://tmc.qidian.qq.com',
    "corporation_id" VARCHAR(64) NOT NULL,
    "secret_id" VARCHAR(128) NOT NULL DEFAULT '',
    "secret_key_cipher" TEXT NOT NULL DEFAULT '',
    "biz_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "last_verified_at" TIMESTAMP(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tp_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tp_accounts_user_id_product_corporation_id_biz_id_key"
    ON "tp_accounts"("user_id", "product", "corporation_id", "biz_id");
CREATE INDEX IF NOT EXISTS "tp_accounts_user_id_product_idx"
    ON "tp_accounts"("user_id", "product");

CREATE TABLE IF NOT EXISTS "tp_tasks" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "account_id" INTEGER NOT NULL DEFAULT 0,
    "product" VARCHAR(16) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "table_id" INTEGER NOT NULL DEFAULT 0,
    "table_name" VARCHAR(191) NOT NULL DEFAULT '',
    "mapping_json" JSONB NOT NULL DEFAULT '{}',
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "upstream_task_id" VARCHAR(128) NOT NULL DEFAULT '',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "success_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64) NOT NULL DEFAULT '',
    "error_message" VARCHAR(500) NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tp_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tp_tasks_user_id_product_created_at_idx"
    ON "tp_tasks"("user_id", "product", "created_at");
CREATE INDEX IF NOT EXISTS "tp_tasks_user_id_status_idx"
    ON "tp_tasks"("user_id", "status");
CREATE INDEX IF NOT EXISTS "tp_tasks_upstream_task_id_idx"
    ON "tp_tasks"("upstream_task_id");

CREATE TABLE IF NOT EXISTS "tp_task_events" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "level" VARCHAR(16) NOT NULL DEFAULT 'info',
    "message" VARCHAR(500) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tp_task_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tp_task_events_task_id_id_idx"
    ON "tp_task_events"("task_id", "id");

CREATE TABLE IF NOT EXISTS "tp_mappings" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "dataset_key" VARCHAR(64) NOT NULL,
    "table_id" INTEGER NOT NULL,
    "table_name" VARCHAR(191) NOT NULL DEFAULT '',
    "column_map" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tp_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tp_mappings_user_id_dataset_key_table_id_key"
    ON "tp_mappings"("user_id", "dataset_key", "table_id");

ALTER TABLE "tp_task_events"
    DROP CONSTRAINT IF EXISTS "tp_task_events_task_id_fkey";
ALTER TABLE "tp_task_events"
    ADD CONSTRAINT "tp_task_events_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "tp_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
