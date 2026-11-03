-- 阿里云智能外呼工具：账号设置、导入批次、行级结果三张表。
-- 只新增表，不动既有数据；写法幂等，便于已用 db push 建过的库补齐。

CREATE TABLE IF NOT EXISTS "aliyun_call_settings" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "access_key_id" VARCHAR(128) NOT NULL DEFAULT '',
    "access_key_secret_cipher" TEXT NOT NULL DEFAULT '',
    "region" VARCHAR(32) NOT NULL DEFAULT 'cn-hangzhou',
    "instance_id" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aliyun_call_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "aliyun_call_settings_user_id_key"
    ON "aliyun_call_settings"("user_id");

CREATE TABLE IF NOT EXISTS "aliyun_call_imports" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "table_id" INTEGER NOT NULL,
    "table_name" VARCHAR(191) NOT NULL DEFAULT '',
    "mapping_json" JSONB NOT NULL DEFAULT '{}',
    "instance_id" VARCHAR(64) NOT NULL,
    "script_id" VARCHAR(64) NOT NULL DEFAULT '',
    "job_group_id" VARCHAR(64) NOT NULL DEFAULT '',
    "job_group_name" VARCHAR(191) NOT NULL DEFAULT '',
    "strategy_json" JSONB,
    "calling_numbers" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "sent_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64) NOT NULL DEFAULT '',
    "error_message" TEXT NOT NULL DEFAULT '',
    "job_group_status" VARCHAR(32) NOT NULL DEFAULT '',
    "synced_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aliyun_call_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "aliyun_call_imports_user_id_created_at_idx"
    ON "aliyun_call_imports"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "aliyun_call_imports_user_id_job_group_id_idx"
    ON "aliyun_call_imports"("user_id", "job_group_id");

CREATE TABLE IF NOT EXISTS "aliyun_call_import_rows" (
    "id" SERIAL NOT NULL,
    "import_id" INTEGER NOT NULL,
    "source_row_id" INTEGER NOT NULL DEFAULT 0,
    "reference_id" VARCHAR(128) NOT NULL DEFAULT '',
    "name" VARCHAR(191) NOT NULL DEFAULT '',
    "phone_masked" VARCHAR(32) NOT NULL DEFAULT '',
    "phone_hash" VARCHAR(64) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "job_id" VARCHAR(64) NOT NULL DEFAULT '',
    "error_code" VARCHAR(64) NOT NULL DEFAULT '',
    "error_message" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aliyun_call_import_rows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "aliyun_call_import_rows_import_id_status_idx"
    ON "aliyun_call_import_rows"("import_id", "status");
CREATE INDEX IF NOT EXISTS "aliyun_call_import_rows_phone_hash_idx"
    ON "aliyun_call_import_rows"("phone_hash");

ALTER TABLE "aliyun_call_import_rows"
    DROP CONSTRAINT IF EXISTS "aliyun_call_import_rows_import_id_fkey";
ALTER TABLE "aliyun_call_import_rows"
    ADD CONSTRAINT "aliyun_call_import_rows_import_id_fkey"
    FOREIGN KEY ("import_id") REFERENCES "aliyun_call_imports"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
