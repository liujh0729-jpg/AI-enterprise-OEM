-- 自动化工具四模块：多维表格 / RPA / Workbuddy 企业版 / AI 调用账号
--
-- 归属口径：全部按「账号」归属（created_by / user_id），不挂企业档案。
-- 本迁移为幂等写法（IF NOT EXISTS + 约束存在性判断）：
--   * 全新库：从零建出 17 张表；
--   * 已由旧底座 db push 建过表的库（如 ae_test.public）：只补齐缺失对象与列类型，
--     不改写任何既有数据行。

-- CreateTable
CREATE TABLE IF NOT EXISTS "data_tables" (
    "id" SERIAL NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "data_table_grants" (
    "id" SERIAL NOT NULL,
    "table_id" INTEGER NOT NULL,
    "grantee_user_id" VARCHAR(64) NOT NULL,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_update" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "granted_by" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_table_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "data_table_fields" (
    "id" SERIAL NOT NULL,
    "table_id" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "field_key" VARCHAR(64) NOT NULL,
    "field_type" VARCHAR(16) NOT NULL DEFAULT 'text',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_table_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "data_table_rows" (
    "id" SERIAL NOT NULL,
    "table_id" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_table_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rpa_scripts" (
    "id" SERIAL NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "category" VARCHAR(64) NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "device_type" VARCHAR(16) NOT NULL DEFAULT 'pc',
    "file_type" VARCHAR(24) NOT NULL DEFAULT 'automa_json',
    "vendor_flow_id" VARCHAR(64) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "content" TEXT NOT NULL,
    "params_schema" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rpa_accounts" (
    "id" SERIAL NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "platform" VARCHAR(500) NOT NULL,
    "group_id" VARCHAR(128) NOT NULL DEFAULT '',
    "nickname" VARCHAR(128) NOT NULL DEFAULT '',
    "username" VARCHAR(191) NOT NULL,
    "key_cipher" TEXT NOT NULL,
    "login_url" VARCHAR(500) NOT NULL DEFAULT '',
    "env_type" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "proxy_method" INTEGER NOT NULL DEFAULT 2,
    "proxy_type" VARCHAR(16) NOT NULL DEFAULT 'noproxy',
    "proxy_host" VARCHAR(255) NOT NULL DEFAULT '',
    "proxy_port" INTEGER NOT NULL DEFAULT 0,
    "proxy_user_name" VARCHAR(200) NOT NULL DEFAULT '',
    "proxy_password" VARCHAR(200) NOT NULL DEFAULT '',
    "notes" VARCHAR(500) NOT NULL DEFAULT '',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rpa_tasks" (
    "id" SERIAL NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "script_id" INTEGER NOT NULL,
    "device_type" VARCHAR(16) NOT NULL DEFAULT 'pc',
    "account_ids" JSONB NOT NULL DEFAULT '[]',
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "schedule_type" VARCHAR(16) NOT NULL DEFAULT 'once',
    "schedule_config" JSONB NOT NULL DEFAULT '{}',
    "phone_finish_action" VARCHAR(16) NOT NULL DEFAULT 'keep',
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "max_retries" INTEGER NOT NULL DEFAULT 0,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 3600,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rpa_task_executions" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "device_type" VARCHAR(16) NOT NULL DEFAULT 'pc',
    "status" VARCHAR(16) NOT NULL DEFAULT 'running',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "executor" VARCHAR(64) NOT NULL DEFAULT '',
    "browser_profile_id" VARCHAR(64) NOT NULL DEFAULT '',
    "cloud_phone_id" VARCHAR(64) NOT NULL DEFAULT '',
    "output" JSONB NOT NULL DEFAULT '{}',
    "error_message" VARCHAR(500) NOT NULL DEFAULT '',
    "log_text" TEXT NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "rpa_task_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rpa_llm_settings" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "key_cipher" TEXT,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_llm_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rpa_settings" (
    "id" SERIAL NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "bitbrowser_api_endpoint" VARCHAR(500) NOT NULL DEFAULT 'http://127.0.0.1:54345',
    "bitbrowser_api_key_cipher" TEXT NOT NULL DEFAULT '',
    "bitbrowser_group_id" VARCHAR(128) NOT NULL DEFAULT '',
    "bitphone_region_id" VARCHAR(64) NOT NULL DEFAULT '',
    "bitphone_compute_type" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workbuddy_accounts" (
    "id" SERIAL NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "secret_id_cipher" TEXT NOT NULL,
    "secret_key_cipher" TEXT NOT NULL,
    "region" VARCHAR(32) NOT NULL DEFAULT 'ap-guangzhou',
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "last_verified_at" TIMESTAMP(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "notes" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workbuddy_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workbuddy_llm_settings" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "key_cipher" TEXT,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workbuddy_llm_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workbuddy_plans" (
    "id" SERIAL NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "raw_input" TEXT NOT NULL DEFAULT '',
    "spec" JSONB NOT NULL DEFAULT '{}',
    "task_count" INTEGER NOT NULL DEFAULT 0,
    "strategy" VARCHAR(16) NOT NULL DEFAULT 'single',
    "account_ids" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workbuddy_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workbuddy_tasks" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "account_id" INTEGER NOT NULL,
    "agent_id" VARCHAR(64) NOT NULL DEFAULT '',
    "version_id" VARCHAR(64) NOT NULL DEFAULT '',
    "session_id" VARCHAR(128) NOT NULL DEFAULT '',
    "endpoint" VARCHAR(500) NOT NULL DEFAULT '',
    "instruction" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "last_event_seq" INTEGER NOT NULL DEFAULT 0,
    "output" JSONB NOT NULL DEFAULT '{}',
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workbuddy_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workbuddy_task_events" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "event_type" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "tool_name" VARCHAR(128) NOT NULL DEFAULT '',
    "tool_input" TEXT NOT NULL DEFAULT '',
    "tool_output" TEXT NOT NULL DEFAULT '',
    "token_usage" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workbuddy_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_call_accounts" (
    "id" SERIAL NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "platform" VARCHAR(191) NOT NULL,
    "login_url" VARCHAR(500) NOT NULL DEFAULT '',
    "username" VARCHAR(191) NOT NULL DEFAULT '',
    "password_cipher" TEXT NOT NULL DEFAULT '',
    "api_key_cipher" TEXT NOT NULL DEFAULT '',
    "cookie_cipher" TEXT NOT NULL DEFAULT '',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "notes" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_call_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_call_account_bindings" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "workbuddy_account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_account_bindings_pkey" PRIMARY KEY ("id")
);

-- 旧底座用 db push 建过 rpa_settings 的库：时间列精度与 updated_at 默认值对齐 Prisma
ALTER TABLE "rpa_settings" ALTER COLUMN "created_at" TYPE TIMESTAMP(3);
ALTER TABLE "rpa_settings" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "rpa_settings" ALTER COLUMN "updated_at" TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "data_tables_created_by_idx" ON "data_tables"("created_by");
CREATE INDEX IF NOT EXISTS "data_table_grants_grantee_user_id_idx" ON "data_table_grants"("grantee_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "data_table_grants_table_id_grantee_user_id_key" ON "data_table_grants"("table_id", "grantee_user_id");
CREATE INDEX IF NOT EXISTS "data_table_fields_table_id_sort_order_idx" ON "data_table_fields"("table_id", "sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "data_table_fields_table_id_field_key_key" ON "data_table_fields"("table_id", "field_key");
CREATE INDEX IF NOT EXISTS "data_table_rows_table_id_created_at_idx" ON "data_table_rows"("table_id", "created_at");

CREATE INDEX IF NOT EXISTS "rpa_scripts_created_by_file_type_idx" ON "rpa_scripts"("created_by", "file_type");
CREATE INDEX IF NOT EXISTS "rpa_scripts_created_by_status_idx" ON "rpa_scripts"("created_by", "status");
CREATE INDEX IF NOT EXISTS "rpa_scripts_created_by_device_type_status_idx" ON "rpa_scripts"("created_by", "device_type", "status");

CREATE INDEX IF NOT EXISTS "rpa_accounts_created_by_status_idx" ON "rpa_accounts"("created_by", "status");
CREATE INDEX IF NOT EXISTS "rpa_accounts_created_by_platform_idx" ON "rpa_accounts"("created_by", "platform");

CREATE INDEX IF NOT EXISTS "rpa_tasks_created_by_status_idx" ON "rpa_tasks"("created_by", "status");
CREATE INDEX IF NOT EXISTS "rpa_tasks_created_by_device_type_status_idx" ON "rpa_tasks"("created_by", "device_type", "status");
CREATE INDEX IF NOT EXISTS "rpa_tasks_script_id_idx" ON "rpa_tasks"("script_id");

CREATE INDEX IF NOT EXISTS "rpa_task_executions_task_id_started_at_idx" ON "rpa_task_executions"("task_id", "started_at");
CREATE INDEX IF NOT EXISTS "rpa_task_executions_created_by_status_idx" ON "rpa_task_executions"("created_by", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "rpa_llm_settings_user_id_key" ON "rpa_llm_settings"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rpa_settings_created_by_key" ON "rpa_settings"("created_by");

CREATE INDEX IF NOT EXISTS "workbuddy_accounts_created_by_status_idx" ON "workbuddy_accounts"("created_by", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "workbuddy_llm_settings_user_id_key" ON "workbuddy_llm_settings"("user_id");
CREATE INDEX IF NOT EXISTS "workbuddy_plans_created_by_status_idx" ON "workbuddy_plans"("created_by", "status");
CREATE INDEX IF NOT EXISTS "workbuddy_tasks_plan_id_idx" ON "workbuddy_tasks"("plan_id");
CREATE INDEX IF NOT EXISTS "workbuddy_tasks_created_by_status_idx" ON "workbuddy_tasks"("created_by", "status");
CREATE INDEX IF NOT EXISTS "workbuddy_tasks_account_id_idx" ON "workbuddy_tasks"("account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workbuddy_task_events_task_id_seq_key" ON "workbuddy_task_events"("task_id", "seq");

CREATE INDEX IF NOT EXISTS "ai_call_accounts_created_by_status_idx" ON "ai_call_accounts"("created_by", "status");
CREATE INDEX IF NOT EXISTS "ai_call_account_bindings_workbuddy_account_id_idx" ON "ai_call_account_bindings"("workbuddy_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_call_account_bindings_account_id_workbuddy_account_id_key" ON "ai_call_account_bindings"("account_id", "workbuddy_account_id");

-- AddForeignKey（存在则跳过）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'ai_call_account_bindings_account_id_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "ai_call_account_bindings" ADD CONSTRAINT "ai_call_account_bindings_account_id_fkey"
            FOREIGN KEY ("account_id") REFERENCES "ai_call_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'ai_call_account_bindings_workbuddy_account_id_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "ai_call_account_bindings" ADD CONSTRAINT "ai_call_account_bindings_workbuddy_account_id_fkey"
            FOREIGN KEY ("workbuddy_account_id") REFERENCES "workbuddy_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
