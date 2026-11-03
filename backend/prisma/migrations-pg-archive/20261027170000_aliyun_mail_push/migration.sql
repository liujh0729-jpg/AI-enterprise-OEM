-- 阿里云邮件推送工具：账号设置、同步批次、行级结果、本地台账四张表。
-- 只新增表，不动既有数据；写法幂等，便于已用 db push 建过的库补齐。

CREATE TABLE IF NOT EXISTS "aliyun_mail_settings" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "access_key_id" VARCHAR(128) NOT NULL DEFAULT '',
    "access_key_secret_cipher" TEXT NOT NULL DEFAULT '',
    "region" VARCHAR(32) NOT NULL DEFAULT 'cn-hangzhou',
    "default_receiver_id" VARCHAR(64) NOT NULL DEFAULT '',
    "default_receiver_name" VARCHAR(191) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aliyun_mail_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "aliyun_mail_settings_user_id_key"
    ON "aliyun_mail_settings"("user_id");

CREATE TABLE IF NOT EXISTS "aliyun_mail_imports" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "table_id" INTEGER NOT NULL,
    "table_name" VARCHAR(191) NOT NULL DEFAULT '',
    "mapping_json" JSONB NOT NULL DEFAULT '{}',
    "receiver_id" VARCHAR(64) NOT NULL DEFAULT '',
    "receiver_name" VARCHAR(191) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "sent_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64) NOT NULL DEFAULT '',
    "error_message" TEXT NOT NULL DEFAULT '',
    "list_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aliyun_mail_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "aliyun_mail_imports_user_id_created_at_idx"
    ON "aliyun_mail_imports"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "aliyun_mail_imports_user_id_receiver_id_idx"
    ON "aliyun_mail_imports"("user_id", "receiver_id");

CREATE TABLE IF NOT EXISTS "aliyun_mail_import_rows" (
    "id" SERIAL NOT NULL,
    "import_id" INTEGER NOT NULL,
    "source_row_id" INTEGER NOT NULL DEFAULT 0,
    "email_masked" VARCHAR(191) NOT NULL DEFAULT '',
    "email_hash" VARCHAR(64) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "error_code" VARCHAR(64) NOT NULL DEFAULT '',
    "error_message" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aliyun_mail_import_rows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "aliyun_mail_import_rows_import_id_status_idx"
    ON "aliyun_mail_import_rows"("import_id", "status");
CREATE INDEX IF NOT EXISTS "aliyun_mail_import_rows_email_hash_idx"
    ON "aliyun_mail_import_rows"("email_hash");

ALTER TABLE "aliyun_mail_import_rows"
    DROP CONSTRAINT IF EXISTS "aliyun_mail_import_rows_import_id_fkey";
ALTER TABLE "aliyun_mail_import_rows"
    ADD CONSTRAINT "aliyun_mail_import_rows_import_id_fkey"
    FOREIGN KEY ("import_id") REFERENCES "aliyun_mail_imports"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "aliyun_mail_contacts" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "receiver_id" VARCHAR(64) NOT NULL,
    "email_hash" VARCHAR(64) NOT NULL,
    "last_import_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aliyun_mail_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "aliyun_mail_contacts_user_id_receiver_id_email_hash_key"
    ON "aliyun_mail_contacts"("user_id", "receiver_id", "email_hash");
CREATE INDEX IF NOT EXISTS "aliyun_mail_contacts_last_import_id_idx"
    ON "aliyun_mail_contacts"("last_import_id");
