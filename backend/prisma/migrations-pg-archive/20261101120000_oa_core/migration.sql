-- 简易 OA：组织级审批（表单模板 / 申请单 / 待办 / 流水 / 抄送 / 联动）7 张表

-- CreateTable
CREATE TABLE "oa_settings" (
    "id" SERIAL NOT NULL,
    "org_type" VARCHAR(16) NOT NULL,
    "org_user_id" VARCHAR(64) NOT NULL,
    "admin_user_ids" JSONB NOT NULL DEFAULT '[]',
    "dept_heads" JSONB NOT NULL DEFAULT '{}',
    "remind_after_hours" INTEGER NOT NULL DEFAULT 24,
    "allow_withdraw" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oa_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_templates" (
    "id" SERIAL NOT NULL,
    "org_type" VARCHAR(16) NOT NULL,
    "org_user_id" VARCHAR(64) NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "description" VARCHAR(200) NOT NULL DEFAULT '',
    "icon" VARCHAR(40) NOT NULL DEFAULT '',
    "number_prefix" VARCHAR(8) NOT NULL DEFAULT 'OA',
    "fields_schema" JSONB NOT NULL DEFAULT '[]',
    "flow_schema" JSONB NOT NULL DEFAULT '[]',
    "linkage_schema" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oa_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_applications" (
    "id" SERIAL NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "org_type" VARCHAR(16) NOT NULL,
    "org_user_id" VARCHAR(64) NOT NULL,
    "template_id" INTEGER NOT NULL,
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR(200) NOT NULL DEFAULT '',
    "applicant_id" VARCHAR(64) NOT NULL,
    "applicant_name" VARCHAR(64) NOT NULL DEFAULT '',
    "department" VARCHAR(64) NOT NULL DEFAULT '',
    "form_data" JSONB NOT NULL DEFAULT '{}',
    "fields_snapshot" JSONB NOT NULL DEFAULT '[]',
    "flow_snapshot" JSONB NOT NULL DEFAULT '[]',
    "linkage_snapshot" JSONB NOT NULL DEFAULT '[]',
    "cc_user_ids" JSONB NOT NULL DEFAULT '[]',
    "amount" DECIMAL(16,2),
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "current_node" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oa_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_tasks" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "node_index" INTEGER NOT NULL,
    "node_name" VARCHAR(60) NOT NULL DEFAULT '',
    "approver_id" VARCHAR(64) NOT NULL,
    "mode" VARCHAR(16) NOT NULL DEFAULT 'ANY',
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "action" VARCHAR(16) NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "acted_at" TIMESTAMP(3),
    "delegated_from" VARCHAR(64) NOT NULL DEFAULT '',
    "reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oa_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_records" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "node_index" INTEGER NOT NULL DEFAULT 0,
    "action" VARCHAR(16) NOT NULL,
    "operator_id" VARCHAR(64) NOT NULL,
    "operator_name" VARCHAR(64) NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oa_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_cc" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oa_cc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_links" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" VARCHAR(64) NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" VARCHAR(500) NOT NULL DEFAULT '',
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oa_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oa_settings_org_type_org_user_id_key" ON "oa_settings"("org_type", "org_user_id");

-- CreateIndex
CREATE INDEX "oa_templates_org_type_org_user_id_enabled_sort_order_idx" ON "oa_templates"("org_type", "org_user_id", "enabled", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "oa_templates_org_type_org_user_id_key_key" ON "oa_templates"("org_type", "org_user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "oa_applications_number_key" ON "oa_applications"("number");

-- CreateIndex
CREATE INDEX "oa_applications_org_type_org_user_id_status_submitted_at_idx" ON "oa_applications"("org_type", "org_user_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "oa_applications_org_type_org_user_id_template_id_idx" ON "oa_applications"("org_type", "org_user_id", "template_id");

-- CreateIndex
CREATE INDEX "oa_applications_applicant_id_status_idx" ON "oa_applications"("applicant_id", "status");

-- CreateIndex
CREATE INDEX "oa_tasks_approver_id_status_idx" ON "oa_tasks"("approver_id", "status");

-- CreateIndex
CREATE INDEX "oa_tasks_application_id_node_index_idx" ON "oa_tasks"("application_id", "node_index");

-- CreateIndex
CREATE INDEX "oa_records_application_id_created_at_idx" ON "oa_records"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "oa_cc_user_id_read_at_idx" ON "oa_cc"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "oa_cc_application_id_user_id_key" ON "oa_cc"("application_id", "user_id");

-- CreateIndex
CREATE INDEX "oa_links_application_id_status_idx" ON "oa_links"("application_id", "status");

