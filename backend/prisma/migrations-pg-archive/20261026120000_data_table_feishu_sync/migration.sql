-- 多维表格 ↔ 飞书多维表格同步：绑定、行对应、执行记录三张表。
-- 幂等写法：既支持全新库从零建表，也支持已用 db push 建过的库补齐缺失对象。
-- 三张表都不挂外键：本库既有惯例是应用层维护归属（data_tables 三表同款），
-- 删表时由 DataTableService.remove 在同一事务里连带清理。

CREATE TABLE IF NOT EXISTS "data_table_feishu_syncs" (
    "id" SERIAL NOT NULL,
    "table_id" INTEGER NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "direction" VARCHAR(16) NOT NULL DEFAULT 'both',
    "app_id" VARCHAR(128) NOT NULL,
    "app_secret_cipher" TEXT NOT NULL,
    "app_token" VARCHAR(191) NOT NULL,
    "feishu_table_id" VARCHAR(191) NOT NULL,
    "verification_token" VARCHAR(191) NOT NULL DEFAULT '',
    "encrypt_key_cipher" TEXT NOT NULL DEFAULT '',
    "field_mapping" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "webhook_token" VARCHAR(64) NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_table_feishu_syncs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "data_table_feishu_syncs_webhook_token_key"
    ON "data_table_feishu_syncs"("webhook_token");
CREATE INDEX IF NOT EXISTS "data_table_feishu_syncs_table_id_idx"
    ON "data_table_feishu_syncs"("table_id");
CREATE INDEX IF NOT EXISTS "data_table_feishu_syncs_app_token_feishu_table_id_idx"
    ON "data_table_feishu_syncs"("app_token", "feishu_table_id");

CREATE TABLE IF NOT EXISTS "data_table_feishu_row_links" (
    "id" SERIAL NOT NULL,
    "sync_id" INTEGER NOT NULL,
    "local_row_id" INTEGER NOT NULL,
    "feishu_record_id" VARCHAR(191) NOT NULL,
    "local_updated_at" TIMESTAMP(3),
    "feishu_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_table_feishu_row_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "data_table_feishu_row_links_sync_id_local_row_id_key"
    ON "data_table_feishu_row_links"("sync_id", "local_row_id");
CREATE UNIQUE INDEX IF NOT EXISTS "data_table_feishu_row_links_sync_id_feishu_record_id_key"
    ON "data_table_feishu_row_links"("sync_id", "feishu_record_id");
CREATE INDEX IF NOT EXISTS "data_table_feishu_row_links_sync_id_idx"
    ON "data_table_feishu_row_links"("sync_id");

CREATE TABLE IF NOT EXISTS "data_table_feishu_sync_logs" (
    "id" SERIAL NOT NULL,
    "sync_id" INTEGER NOT NULL,
    "trigger" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "message" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_table_feishu_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "data_table_feishu_sync_logs_sync_id_created_at_idx"
    ON "data_table_feishu_sync_logs"("sync_id", "created_at");
