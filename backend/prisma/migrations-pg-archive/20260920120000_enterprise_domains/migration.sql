-- CreateTable
CREATE TABLE "identity_preferences" (
    "user_id" VARCHAR(64) NOT NULL,
    "current_identity" VARCHAR(32) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "enterprise_profiles" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "uscc" VARCHAR(32) NOT NULL,
    "taxpayer_type" VARCHAR(16) NOT NULL DEFAULT 'GENERAL',
    "industry" VARCHAR(100) NOT NULL DEFAULT '',
    "legal_person" VARCHAR(64) NOT NULL DEFAULT '',
    "phone" VARCHAR(32) NOT NULL DEFAULT '',
    "address" VARCHAR(300) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
    "audit_note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audited_at" TIMESTAMP(3),

    CONSTRAINT "enterprise_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_applications" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "provider_type" VARCHAR(32) NOT NULL,
    "org_name" VARCHAR(200) NOT NULL,
    "uscc" VARCHAR(32) NOT NULL DEFAULT '',
    "qualification" VARCHAR(300) NOT NULL DEFAULT '',
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "contact_email" VARCHAR(120) NOT NULL DEFAULT '',
    "intro" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "audit_note" VARCHAR(500) NOT NULL DEFAULT '',
    "service_items" VARCHAR(300) NOT NULL DEFAULT '',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "business_staff" JSONB NOT NULL DEFAULT '[]',
    "subject_type" VARCHAR(16) NOT NULL DEFAULT 'COMPANY',
    "id_card" VARCHAR(32) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audited_at" TIMESTAMP(3),

    CONSTRAINT "provider_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "real_name" VARCHAR(64) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "email" VARCHAR(120) NOT NULL DEFAULT '',
    "region" VARCHAR(64) NOT NULL DEFAULT '',
    "categories" JSONB NOT NULL DEFAULT '[]',
    "qualification" VARCHAR(200) NOT NULL DEFAULT '',
    "intro" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_staff" (
    "id" SERIAL NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL,
    "roles" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_applications" (
    "id" SERIAL NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audited_at" TIMESTAMP(3),

    CONSTRAINT "staff_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_assignments" (
    "id" SERIAL NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" SERIAL NOT NULL,
    "contract_no" VARCHAR(32) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "provider_org" VARCHAR(200) NOT NULL DEFAULT '',
    "enterprise_id" INTEGER NOT NULL,
    "enterprise_name" VARCHAR(200) NOT NULL DEFAULT '',
    "service_type" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "start_date" VARCHAR(16) NOT NULL DEFAULT '',
    "end_date" VARCHAR(16) NOT NULL DEFAULT '',
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "designated_staff" JSONB NOT NULL DEFAULT '{}',
    "designated_agent_id" INTEGER NOT NULL DEFAULT 0,
    "designated_agent_name" VARCHAR(64) NOT NULL DEFAULT '',
    "designated_agent_org" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "detail" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "key_prefix" VARCHAR(8) NOT NULL DEFAULT 'ek_',
    "key_hash" VARCHAR(64) NOT NULL,
    "masked" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_orders" (
    "id" SERIAL NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL DEFAULT 0,
    "enterprise_id" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "carrier" VARCHAR(200) NOT NULL DEFAULT '',
    "order_type" VARCHAR(24) NOT NULL DEFAULT 'DOMESTIC',
    "title" VARCHAR(200) NOT NULL,
    "cargo_name" VARCHAR(120) NOT NULL DEFAULT '',
    "origin" VARCHAR(200) NOT NULL DEFAULT '',
    "destination" VARCHAR(200) NOT NULL DEFAULT '',
    "expected_date" VARCHAR(32) NOT NULL DEFAULT '',
    "deadline" VARCHAR(32) NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "budget_type" VARCHAR(120) NOT NULL DEFAULT '',
    "expected_result" VARCHAR(300) NOT NULL DEFAULT '',
    "must_conditions" VARCHAR(300) NOT NULL DEFAULT '',
    "tags" VARCHAR(200) NOT NULL DEFAULT '',
    "email_sync" INTEGER NOT NULL DEFAULT 0,
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "contact_wechat" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_email" VARCHAR(120) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "aiworkin_published" INTEGER NOT NULL DEFAULT 1,
    "events" JSONB NOT NULL DEFAULT '[]',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_orders" (
    "id" SERIAL NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "enterprise_id" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "provider_name" VARCHAR(200) NOT NULL DEFAULT '',
    "order_type" VARCHAR(24) NOT NULL DEFAULT 'VISIT',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" VARCHAR(200) NOT NULL DEFAULT '',
    "budget" VARCHAR(120) NOT NULL DEFAULT '',
    "expected_result" VARCHAR(300) NOT NULL DEFAULT '',
    "must_conditions" VARCHAR(300) NOT NULL DEFAULT '',
    "expect_start" VARCHAR(32) NOT NULL DEFAULT '',
    "deadline" VARCHAR(32) NOT NULL DEFAULT '',
    "region_scope" VARCHAR(200) NOT NULL DEFAULT '',
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "contact_wechat" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_email" VARCHAR(120) NOT NULL DEFAULT '',
    "email_sync" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "aiworkin_published" INTEGER NOT NULL DEFAULT 1,
    "events" JSONB NOT NULL DEFAULT '[]',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overseas_claims" (
    "id" SERIAL NOT NULL,
    "claim_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "service_type" VARCHAR(32) NOT NULL,
    "title" VARCHAR(200) NOT NULL DEFAULT '',
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "country" VARCHAR(64) NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overseas_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lawyer_resources" (
    "id" SERIAL NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "organization" VARCHAR(200) NOT NULL DEFAULT '',
    "region" VARCHAR(64) NOT NULL DEFAULT '',
    "areas" JSONB NOT NULL DEFAULT '[]',
    "qualification" VARCHAR(200) NOT NULL DEFAULT '',
    "score" DECIMAL(3,1) NOT NULL DEFAULT 4.8,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "owner_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "audit_note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lawyer_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_requests" (
    "id" SERIAL NOT NULL,
    "request_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL DEFAULT 0,
    "enterprise_id" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "lawyer_id" INTEGER NOT NULL DEFAULT 0,
    "category" VARCHAR(32) NOT NULL DEFAULT 'CONSULT',
    "title" VARCHAR(200) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "aiworkin_published" INTEGER NOT NULL DEFAULT 0,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_agencies" (
    "id" SERIAL NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "organization" VARCHAR(200) NOT NULL DEFAULT '',
    "region" VARCHAR(64) NOT NULL DEFAULT '',
    "fields" JSONB NOT NULL DEFAULT '[]',
    "qualification" VARCHAR(200) NOT NULL DEFAULT '',
    "license_no" VARCHAR(64) NOT NULL DEFAULT '',
    "phone" VARCHAR(32) NOT NULL DEFAULT '',
    "note" VARCHAR(300) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "owner_type" VARCHAR(16) NOT NULL DEFAULT 'PROVIDER',
    "owner_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "audit_note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ip_agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_requests" (
    "id" SERIAL NOT NULL,
    "request_no" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'BIZ',
    "contract_id" INTEGER NOT NULL DEFAULT 0,
    "enterprise_id" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "agency_id" INTEGER NOT NULL DEFAULT 0,
    "agent_name" VARCHAR(64) NOT NULL DEFAULT '',
    "category" VARCHAR(32) NOT NULL DEFAULT 'TRADEMARK',
    "title" VARCHAR(200) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "aiworkin_published" INTEGER NOT NULL DEFAULT 0,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ip_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flex_providers" (
    "id" SERIAL NOT NULL,
    "record_type" VARCHAR(16) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "organization" VARCHAR(200) NOT NULL DEFAULT '',
    "region" VARCHAR(64) NOT NULL DEFAULT '',
    "intro" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "audit_note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flex_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flex_onboardings" (
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "agent_name" VARCHAR(64) NOT NULL DEFAULT '',
    "form" JSONB NOT NULL DEFAULT '{}',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
    "reject_note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flex_onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flex_work_orders" (
    "id" SERIAL NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL DEFAULT 0,
    "enterprise_id" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "agent_name" VARCHAR(64) NOT NULL DEFAULT '',
    "title" VARCHAR(200) NOT NULL,
    "position" VARCHAR(64) NOT NULL DEFAULT '',
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "work_type" VARCHAR(16) NOT NULL DEFAULT 'FULLTIME',
    "cycle" VARCHAR(64) NOT NULL DEFAULT '',
    "skills" VARCHAR(200) NOT NULL DEFAULT '',
    "budget" VARCHAR(64) NOT NULL DEFAULT '',
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "settlements" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "aiworkin_published" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flex_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flex_payrolls" (
    "id" SERIAL NOT NULL,
    "payroll_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "agent_name" VARCHAR(64) NOT NULL DEFAULT '',
    "period" VARCHAR(16) NOT NULL DEFAULT '',
    "employees" JSONB NOT NULL DEFAULT '[]',
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "reject_note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flex_payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_declarations" (
    "id" SERIAL NOT NULL,
    "decl_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "material_id" INTEGER NOT NULL DEFAULT 0,
    "tax_type" VARCHAR(32) NOT NULL,
    "period" VARCHAR(16) NOT NULL DEFAULT '',
    "title" VARCHAR(200) NOT NULL DEFAULT '',
    "form_data" JSONB NOT NULL DEFAULT '{}',
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "ai_steps" JSONB NOT NULL DEFAULT '[]',
    "advisor_confirms" JSONB NOT NULL DEFAULT '[]',
    "qc_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "qc_note" VARCHAR(500) NOT NULL DEFAULT '',
    "receipt_no" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_material_packs" (
    "id" SERIAL NOT NULL,
    "pack_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "title" VARCHAR(200) NOT NULL DEFAULT '',
    "files" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_material_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_plans" (
    "id" SERIAL NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "account_set_id" INTEGER NOT NULL DEFAULT 0,
    "tax_type" VARCHAR(32) NOT NULL,
    "period" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DUE',
    "declaration_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_records" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_sets" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations" (
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enterprise_profiles_user_id_idx" ON "enterprise_profiles"("user_id");

-- CreateIndex
CREATE INDEX "provider_applications_user_id_provider_type_idx" ON "provider_applications"("user_id", "provider_type");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_staff_provider_user_id_staff_user_id_key" ON "provider_staff"("provider_user_id", "staff_user_id");

-- CreateIndex
CREATE INDEX "staff_applications_provider_user_id_status_idx" ON "staff_applications"("provider_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_assignments_provider_user_id_enterprise_id_key" ON "provider_assignments"("provider_user_id", "enterprise_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contract_no_key" ON "contracts"("contract_no");

-- CreateIndex
CREATE INDEX "contracts_enterprise_id_service_type_status_idx" ON "contracts"("enterprise_id", "service_type", "status");

-- CreateIndex
CREATE INDEX "contracts_provider_user_id_status_idx" ON "contracts"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_orders_order_no_key" ON "logistics_orders"("order_no");

-- CreateIndex
CREATE INDEX "logistics_orders_created_by_idx" ON "logistics_orders"("created_by");

-- CreateIndex
CREATE INDEX "logistics_orders_provider_user_id_status_idx" ON "logistics_orders"("provider_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_orders_order_no_key" ON "marketing_orders"("order_no");

-- CreateIndex
CREATE INDEX "marketing_orders_created_by_idx" ON "marketing_orders"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "overseas_claims_claim_no_key" ON "overseas_claims"("claim_no");

-- CreateIndex
CREATE INDEX "overseas_claims_enterprise_id_idx" ON "overseas_claims"("enterprise_id");

-- CreateIndex
CREATE INDEX "overseas_claims_provider_user_id_idx" ON "overseas_claims"("provider_user_id");

-- CreateIndex
CREATE INDEX "lawyer_resources_kind_status_idx" ON "lawyer_resources"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_requests_request_no_key" ON "legal_requests"("request_no");

-- CreateIndex
CREATE INDEX "ip_agencies_kind_status_idx" ON "ip_agencies"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ip_requests_request_no_key" ON "ip_requests"("request_no");

-- CreateIndex
CREATE INDEX "flex_providers_record_type_status_idx" ON "flex_providers"("record_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "flex_work_orders_order_no_key" ON "flex_work_orders"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "flex_payrolls_payroll_no_key" ON "flex_payrolls"("payroll_no");

-- CreateIndex
CREATE UNIQUE INDEX "tax_declarations_decl_no_key" ON "tax_declarations"("decl_no");

-- CreateIndex
CREATE UNIQUE INDEX "tax_material_packs_pack_no_key" ON "tax_material_packs"("pack_no");

-- CreateIndex
CREATE UNIQUE INDEX "tax_plans_enterprise_id_tax_type_period_key" ON "tax_plans"("enterprise_id", "tax_type", "period");
