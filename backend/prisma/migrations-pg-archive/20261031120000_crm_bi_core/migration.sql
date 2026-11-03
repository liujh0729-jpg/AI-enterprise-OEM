-- CreateTable
CREATE TABLE "crm_settings" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'CNY',
    "mask_phone" BOOLEAN NOT NULL DEFAULT true,
    "mask_email" BOOLEAN NOT NULL DEFAULT true,
    "title_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_members" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'SALES',
    "data_scope" VARCHAR(16) NOT NULL DEFAULT 'SELF',
    "department" VARCHAR(64) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_field_defs" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "form_key" VARCHAR(24) NOT NULL,
    "field_key" VARCHAR(48) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "editable" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_field_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_modules" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "data_table_id" INTEGER NOT NULL,
    "role_ids" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_custom_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_change_logs" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(24) NOT NULL,
    "target_id" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "before" JSONB NOT NULL DEFAULT '{}',
    "after" JSONB NOT NULL DEFAULT '{}',
    "operator" VARCHAR(64) NOT NULL DEFAULT '',
    "channel" VARCHAR(16) NOT NULL DEFAULT 'web',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_export_tasks" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "module" VARCHAR(24) NOT NULL,
    "query" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'DONE',
    "file_name" VARCHAR(120) NOT NULL DEFAULT '',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_export_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_pools" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "scope_ids" JSONB NOT NULL DEFAULT '[]',
    "admin_id" VARCHAR(64) NOT NULL DEFAULT '',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(200) NOT NULL DEFAULT '',
    "pick_rule" JSONB NOT NULL DEFAULT '{}',
    "recycle_rule" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lead_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customer_pools" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "scope_ids" JSONB NOT NULL DEFAULT '[]',
    "admin_id" VARCHAR(64) NOT NULL DEFAULT '',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(200) NOT NULL DEFAULT '',
    "pick_rule" JSONB NOT NULL DEFAULT '{}',
    "recycle_rule" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_customer_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_capacities" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "scope_type" VARCHAR(16) NOT NULL,
    "scope_id" VARCHAR(64) NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_capacities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_owner_history" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "target_id" INTEGER NOT NULL,
    "from_owner" VARCHAR(64) NOT NULL DEFAULT '',
    "to_owner" VARCHAR(64) NOT NULL DEFAULT '',
    "reason" VARCHAR(200) NOT NULL DEFAULT '',
    "operator" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_owner_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "contact_name" VARCHAR(60) NOT NULL DEFAULT '',
    "phone" VARCHAR(40) NOT NULL DEFAULT '',
    "phone_norm" VARCHAR(40) NOT NULL DEFAULT '',
    "email" VARCHAR(120) NOT NULL DEFAULT '',
    "email_norm" VARCHAR(160) NOT NULL DEFAULT '',
    "source" VARCHAR(60) NOT NULL DEFAULT '',
    "stage" VARCHAR(16) NOT NULL DEFAULT 'NEW',
    "owner_id" VARCHAR(64) NOT NULL DEFAULT '',
    "pool_id" INTEGER NOT NULL DEFAULT 0,
    "in_pool" BOOLEAN NOT NULL DEFAULT false,
    "products" JSONB NOT NULL DEFAULT '[]',
    "transition_type" VARCHAR(16) NOT NULL DEFAULT '',
    "transition_id" INTEGER NOT NULL DEFAULT 0,
    "last_follower_id" VARCHAR(64) NOT NULL DEFAULT '',
    "last_follow_at" TIMESTAMP(3),
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "freeze_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "unfreeze_at" TIMESTAMP(3),
    "approval_status" VARCHAR(16) NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "name_norm" VARCHAR(120) NOT NULL DEFAULT '',
    "owner_id" VARCHAR(64) NOT NULL DEFAULT '',
    "pool_id" INTEGER NOT NULL DEFAULT 0,
    "in_pool" BOOLEAN NOT NULL DEFAULT false,
    "collection_at" TIMESTAMP(3),
    "last_follower_id" VARCHAR(64) NOT NULL DEFAULT '',
    "last_follow_at" TIMESTAMP(3),
    "reason_id" INTEGER NOT NULL DEFAULT 0,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "freeze_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "unfreeze_at" TIMESTAMP(3),
    "approval_status" VARCHAR(16) NOT NULL DEFAULT '',
    "industry" VARCHAR(60) NOT NULL DEFAULT '',
    "province" VARCHAR(40) NOT NULL DEFAULT '',
    "city" VARCHAR(40) NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "phone" VARCHAR(40) NOT NULL DEFAULT '',
    "phone_norm" VARCHAR(40) NOT NULL DEFAULT '',
    "email" VARCHAR(120) NOT NULL DEFAULT '',
    "email_norm" VARCHAR(160) NOT NULL DEFAULT '',
    "title" VARCHAR(60) NOT NULL DEFAULT '',
    "owner_id" VARCHAR(64) NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disable_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customer_collaborations" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'COLLABORATION',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_customer_collaborations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customer_relations" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "source_customer_id" INTEGER NOT NULL,
    "target_customer_id" INTEGER NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_customer_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_follow_records" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "target_id" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "result" VARCHAR(200) NOT NULL DEFAULT '',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "next_at" TIMESTAMP(3),
    "created_by" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_follow_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_follow_plans" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "target_id" INTEGER NOT NULL,
    "plan_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED',
    "owner_id" VARCHAR(64) NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "reminder_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_follow_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_follow_comments" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "target_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "created_by" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_follow_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_products" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(60) NOT NULL DEFAULT '',
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_product_prices" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_opportunity_stages" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "type" VARCHAR(16) NOT NULL DEFAULT 'AFOOT',
    "scenario" VARCHAR(16) NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "win_rate" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_opportunity_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_opportunity_rules" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "scope_ids" JSONB NOT NULL DEFAULT '[]',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_opportunity_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_opportunities" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "possible" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "products" JSONB NOT NULL DEFAULT '[]',
    "stage_id" INTEGER NOT NULL DEFAULT 0,
    "contact_id" INTEGER NOT NULL DEFAULT 0,
    "owner_id" VARCHAR(64) NOT NULL DEFAULT '',
    "last_follower_id" VARCHAR(64) NOT NULL DEFAULT '',
    "last_follow_at" TIMESTAMP(3),
    "expected_end_at" TIMESTAMP(3),
    "actual_end_at" TIMESTAMP(3),
    "failure_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "approval_status" VARCHAR(16) NOT NULL DEFAULT '',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_opportunity_items" (
    "id" SERIAL NOT NULL,
    "opportunity_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL DEFAULT 0,
    "name_snapshot" VARCHAR(120) NOT NULL DEFAULT '',
    "qty" DECIMAL(18,2) NOT NULL DEFAULT 1,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "crm_opportunity_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_quotations" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "opportunity_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "until_at" TIMESTAMP(3),
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "approval_status" VARCHAR(16) NOT NULL DEFAULT '',
    "invalid" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_quotation_items" (
    "id" SERIAL NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL DEFAULT 0,
    "name_snapshot" VARCHAR(120) NOT NULL DEFAULT '',
    "qty" DECIMAL(18,2) NOT NULL DEFAULT 1,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "crm_quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contract_stages" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contract_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contracts" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "opportunity_id" INTEGER NOT NULL DEFAULT 0,
    "quotation_id" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(160) NOT NULL,
    "number" VARCHAR(48) NOT NULL DEFAULT '',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "stage_id" INTEGER NOT NULL DEFAULT 0,
    "approval_status" VARCHAR(16) NOT NULL DEFAULT '',
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "void_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "owner_id" VARCHAR(64) NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contract_items" (
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL DEFAULT 0,
    "name_snapshot" VARCHAR(120) NOT NULL DEFAULT '',
    "qty" DECIMAL(18,2) NOT NULL DEFAULT 1,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "crm_contract_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_business_titles" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "customer_id" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(160) NOT NULL,
    "tax_no" VARCHAR(40) NOT NULL DEFAULT '',
    "bank" VARCHAR(120) NOT NULL DEFAULT '',
    "account" VARCHAR(60) NOT NULL DEFAULT '',
    "address" VARCHAR(200) NOT NULL DEFAULT '',
    "phone" VARCHAR(40) NOT NULL DEFAULT '',
    "capital" VARCHAR(60) NOT NULL DEFAULT '',
    "scale" VARCHAR(60) NOT NULL DEFAULT '',
    "province" VARCHAR(40) NOT NULL DEFAULT '',
    "city" VARCHAR(40) NOT NULL DEFAULT '',
    "industry" VARCHAR(60) NOT NULL DEFAULT '',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_business_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_invoices" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "contract_id" INTEGER NOT NULL DEFAULT 0,
    "business_title_id" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(160) NOT NULL DEFAULT '',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoice_type" VARCHAR(16) NOT NULL DEFAULT 'SPECIAL',
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "approval_status" VARCHAR(16) NOT NULL DEFAULT '',
    "attachment_key" VARCHAR(255) NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_payment_plans" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "plan_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "plan_end_at" TIMESTAMP(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_payment_records" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "payment_plan_id" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(120) NOT NULL DEFAULT '',
    "no" VARCHAR(48) NOT NULL DEFAULT '',
    "record_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "record_end_at" TIMESTAMP(3),
    "attachment_key" VARCHAR(255) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_order_stages" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_order_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_orders" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "number" VARCHAR(48) NOT NULL DEFAULT '',
    "customer_id" INTEGER NOT NULL DEFAULT 0,
    "contract_id" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "stage_id" INTEGER NOT NULL DEFAULT 0,
    "approval_status" VARCHAR(16) NOT NULL DEFAULT '',
    "owner_id" VARCHAR(64) NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL DEFAULT 0,
    "name_snapshot" VARCHAR(120) NOT NULL DEFAULT '',
    "qty" DECIMAL(18,2) NOT NULL DEFAULT 1,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "crm_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_approval_flows" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "form_type" VARCHAR(24) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_approval_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_approval_flow_versions" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_approval_flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_approval_instances" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "form_type" VARCHAR(24) NOT NULL,
    "target_id" INTEGER NOT NULL,
    "flow_id" INTEGER NOT NULL DEFAULT 0,
    "flow_version_id" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "submitter" VARCHAR(64) NOT NULL DEFAULT '',
    "current_node" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_approval_tasks" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "node_index" INTEGER NOT NULL DEFAULT 0,
    "node_name" VARCHAR(60) NOT NULL DEFAULT '',
    "approver_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "action" VARCHAR(24) NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "acted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_approval_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_approval_records" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "node_index" INTEGER NOT NULL DEFAULT 0,
    "action" VARCHAR(24) NOT NULL,
    "operator" VARCHAR(64) NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_approval_cc" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_approval_cc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_settings" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "default_text_channel_id" INTEGER NOT NULL DEFAULT 0,
    "default_text_model" VARCHAR(128) NOT NULL DEFAULT '',
    "max_rows" INTEGER NOT NULL DEFAULT 10000,
    "query_timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_members" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'ANALYST',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_datasources" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "config_cipher" TEXT NOT NULL DEFAULT '',
    "read_only" BOOLEAN NOT NULL DEFAULT true,
    "ssl" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "last_test_at" TIMESTAMP(3),
    "last_error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_datasources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_datasource_tables" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "datasource_id" INTEGER NOT NULL,
    "table_name" VARCHAR(120) NOT NULL,
    "table_comment" VARCHAR(200) NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_datasource_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_datasource_fields" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "table_id" INTEGER NOT NULL,
    "field_name" VARCHAR(120) NOT NULL,
    "field_type" VARCHAR(40) NOT NULL DEFAULT '',
    "field_comment" VARCHAR(200) NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_datasource_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dataset_groups" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_dataset_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_datasets" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "group_id" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(80) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "datasource_id" INTEGER NOT NULL DEFAULT 0,
    "internal_key" VARCHAR(40) NOT NULL DEFAULT '',
    "sql_text" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "description" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dataset_tables" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "datasource_table_id" INTEGER NOT NULL,
    "alias" VARCHAR(60) NOT NULL DEFAULT '',
    "join_type" VARCHAR(12) NOT NULL DEFAULT 'LEFT',
    "join_config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "bi_dataset_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dataset_fields" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "field_key" VARCHAR(120) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" VARCHAR(40) NOT NULL DEFAULT '',
    "comment" VARCHAR(200) NOT NULL DEFAULT '',
    "role" VARCHAR(16) NOT NULL DEFAULT 'DIMENSION',
    "aggregate" VARCHAR(16) NOT NULL DEFAULT '',
    "expression" TEXT NOT NULL DEFAULT '',
    "format" VARCHAR(40) NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bi_dataset_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dataset_relations" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "left_field" VARCHAR(120) NOT NULL,
    "right_field" VARCHAR(120) NOT NULL,
    "join_type" VARCHAR(12) NOT NULL DEFAULT 'LEFT',

    CONSTRAINT "bi_dataset_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dataset_permissions" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "row_filter" TEXT NOT NULL DEFAULT '',
    "column_rules" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "bi_dataset_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_terms" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "dataset_id" INTEGER NOT NULL DEFAULT 0,
    "term" VARCHAR(80) NOT NULL,
    "definition" TEXT NOT NULL DEFAULT '',
    "synonyms" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_trainings" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "dataset_id" INTEGER NOT NULL DEFAULT 0,
    "question" VARCHAR(500) NOT NULL,
    "sql_text" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_recommended_questions" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "dataset_id" INTEGER NOT NULL DEFAULT 0,
    "question" VARCHAR(500) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_recommended_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_charts" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "chart_type" VARCHAR(16) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dashboards" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "layout" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dashboard_components" (
    "id" SERIAL NOT NULL,
    "dashboard_id" INTEGER NOT NULL,
    "chart_id" INTEGER NOT NULL DEFAULT 0,
    "type" VARCHAR(16) NOT NULL DEFAULT 'CHART',
    "title" VARCHAR(80) NOT NULL DEFAULT '',
    "position" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bi_dashboard_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_chat_sessions" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "dataset_id" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(120) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_chat_messages" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "session_id" INTEGER NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "question" TEXT NOT NULL DEFAULT '',
    "sql_text" TEXT NOT NULL DEFAULT '',
    "result_preview" JSONB NOT NULL DEFAULT '[]',
    "chart_config" JSONB NOT NULL DEFAULT '{}',
    "analysis" TEXT NOT NULL DEFAULT '',
    "followups" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ok',
    "error" TEXT NOT NULL DEFAULT '',
    "elapsed_ms" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "feedback" VARCHAR(16) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_query_logs" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "datasource_id" INTEGER NOT NULL DEFAULT 0,
    "dataset_id" INTEGER NOT NULL DEFAULT 0,
    "sql_text" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ok',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "elapsed_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "channel" VARCHAR(16) NOT NULL DEFAULT 'web',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_settings_owner_user_id_key" ON "crm_settings"("owner_user_id");

-- CreateIndex
CREATE INDEX "crm_members_owner_user_id_status_idx" ON "crm_members"("owner_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_members_owner_user_id_member_user_id_key" ON "crm_members"("owner_user_id", "member_user_id");

-- CreateIndex
CREATE INDEX "crm_field_defs_owner_user_id_form_key_idx" ON "crm_field_defs"("owner_user_id", "form_key");

-- CreateIndex
CREATE UNIQUE INDEX "crm_field_defs_owner_user_id_form_key_field_key_key" ON "crm_field_defs"("owner_user_id", "form_key", "field_key");

-- CreateIndex
CREATE INDEX "crm_custom_modules_owner_user_id_idx" ON "crm_custom_modules"("owner_user_id");

-- CreateIndex
CREATE INDEX "crm_change_logs_owner_user_id_target_type_target_id_idx" ON "crm_change_logs"("owner_user_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "crm_export_tasks_owner_user_id_created_at_idx" ON "crm_export_tasks"("owner_user_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_lead_pools_owner_user_id_idx" ON "crm_lead_pools"("owner_user_id");

-- CreateIndex
CREATE INDEX "crm_customer_pools_owner_user_id_idx" ON "crm_customer_pools"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_capacities_owner_user_id_target_type_scope_type_scope_i_key" ON "crm_capacities"("owner_user_id", "target_type", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "crm_owner_history_target_type_target_id_idx" ON "crm_owner_history"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "crm_owner_history_owner_user_id_created_at_idx" ON "crm_owner_history"("owner_user_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_leads_owner_user_id_stage_idx" ON "crm_leads"("owner_user_id", "stage");

-- CreateIndex
CREATE INDEX "crm_leads_owner_user_id_owner_id_idx" ON "crm_leads"("owner_user_id", "owner_id");

-- CreateIndex
CREATE INDEX "crm_leads_owner_user_id_phone_norm_idx" ON "crm_leads"("owner_user_id", "phone_norm");

-- CreateIndex
CREATE INDEX "crm_leads_owner_user_id_email_norm_idx" ON "crm_leads"("owner_user_id", "email_norm");

-- CreateIndex
CREATE INDEX "crm_leads_owner_user_id_pool_id_in_pool_idx" ON "crm_leads"("owner_user_id", "pool_id", "in_pool");

-- CreateIndex
CREATE INDEX "crm_customers_owner_user_id_owner_id_idx" ON "crm_customers"("owner_user_id", "owner_id");

-- CreateIndex
CREATE INDEX "crm_customers_owner_user_id_name_norm_idx" ON "crm_customers"("owner_user_id", "name_norm");

-- CreateIndex
CREATE INDEX "crm_customers_owner_user_id_pool_id_in_pool_idx" ON "crm_customers"("owner_user_id", "pool_id", "in_pool");

-- CreateIndex
CREATE INDEX "crm_contacts_owner_user_id_customer_id_idx" ON "crm_contacts"("owner_user_id", "customer_id");

-- CreateIndex
CREATE INDEX "crm_contacts_owner_user_id_phone_norm_idx" ON "crm_contacts"("owner_user_id", "phone_norm");

-- CreateIndex
CREATE INDEX "crm_customer_collaborations_owner_user_id_idx" ON "crm_customer_collaborations"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_customer_collaborations_customer_id_user_id_key" ON "crm_customer_collaborations"("customer_id", "user_id");

-- CreateIndex
CREATE INDEX "crm_customer_relations_owner_user_id_idx" ON "crm_customer_relations"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_customer_relations_source_customer_id_target_customer_i_key" ON "crm_customer_relations"("source_customer_id", "target_customer_id", "type");

-- CreateIndex
CREATE INDEX "crm_follow_records_owner_user_id_target_type_target_id_idx" ON "crm_follow_records"("owner_user_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "crm_follow_plans_owner_user_id_status_plan_at_idx" ON "crm_follow_plans"("owner_user_id", "status", "plan_at");

-- CreateIndex
CREATE INDEX "crm_follow_plans_target_type_target_id_idx" ON "crm_follow_plans"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "crm_follow_comments_owner_user_id_target_type_target_id_idx" ON "crm_follow_comments"("owner_user_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "crm_products_owner_user_id_status_idx" ON "crm_products"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "crm_product_prices_owner_user_id_idx" ON "crm_product_prices"("owner_user_id");

-- CreateIndex
CREATE INDEX "crm_opportunity_stages_owner_user_id_sort_idx" ON "crm_opportunity_stages"("owner_user_id", "sort");

-- CreateIndex
CREATE INDEX "crm_opportunity_rules_owner_user_id_idx" ON "crm_opportunity_rules"("owner_user_id");

-- CreateIndex
CREATE INDEX "crm_opportunities_owner_user_id_stage_id_idx" ON "crm_opportunities"("owner_user_id", "stage_id");

-- CreateIndex
CREATE INDEX "crm_opportunities_owner_user_id_owner_id_idx" ON "crm_opportunities"("owner_user_id", "owner_id");

-- CreateIndex
CREATE INDEX "crm_opportunities_owner_user_id_customer_id_idx" ON "crm_opportunities"("owner_user_id", "customer_id");

-- CreateIndex
CREATE INDEX "crm_opportunity_items_opportunity_id_idx" ON "crm_opportunity_items"("opportunity_id");

-- CreateIndex
CREATE INDEX "crm_quotations_owner_user_id_opportunity_id_idx" ON "crm_quotations"("owner_user_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "crm_quotation_items_quotation_id_idx" ON "crm_quotation_items"("quotation_id");

-- CreateIndex
CREATE INDEX "crm_contract_stages_owner_user_id_sort_idx" ON "crm_contract_stages"("owner_user_id", "sort");

-- CreateIndex
CREATE INDEX "crm_contracts_owner_user_id_stage_id_idx" ON "crm_contracts"("owner_user_id", "stage_id");

-- CreateIndex
CREATE INDEX "crm_contracts_owner_user_id_customer_id_idx" ON "crm_contracts"("owner_user_id", "customer_id");

-- CreateIndex
CREATE INDEX "crm_contracts_owner_user_id_owner_id_idx" ON "crm_contracts"("owner_user_id", "owner_id");

-- CreateIndex
CREATE INDEX "crm_contract_items_contract_id_idx" ON "crm_contract_items"("contract_id");

-- CreateIndex
CREATE INDEX "crm_business_titles_owner_user_id_customer_id_idx" ON "crm_business_titles"("owner_user_id", "customer_id");

-- CreateIndex
CREATE INDEX "crm_invoices_owner_user_id_contract_id_idx" ON "crm_invoices"("owner_user_id", "contract_id");

-- CreateIndex
CREATE INDEX "crm_payment_plans_owner_user_id_contract_id_idx" ON "crm_payment_plans"("owner_user_id", "contract_id");

-- CreateIndex
CREATE INDEX "crm_payment_records_owner_user_id_contract_id_idx" ON "crm_payment_records"("owner_user_id", "contract_id");

-- CreateIndex
CREATE INDEX "crm_payment_records_payment_plan_id_idx" ON "crm_payment_records"("payment_plan_id");

-- CreateIndex
CREATE INDEX "crm_order_stages_owner_user_id_sort_idx" ON "crm_order_stages"("owner_user_id", "sort");

-- CreateIndex
CREATE INDEX "crm_orders_owner_user_id_stage_id_idx" ON "crm_orders"("owner_user_id", "stage_id");

-- CreateIndex
CREATE INDEX "crm_orders_owner_user_id_customer_id_idx" ON "crm_orders"("owner_user_id", "customer_id");

-- CreateIndex
CREATE INDEX "crm_order_items_order_id_idx" ON "crm_order_items"("order_id");

-- CreateIndex
CREATE INDEX "crm_approval_flows_owner_user_id_form_type_idx" ON "crm_approval_flows"("owner_user_id", "form_type");

-- CreateIndex
CREATE UNIQUE INDEX "crm_approval_flow_versions_flow_id_version_key" ON "crm_approval_flow_versions"("flow_id", "version");

-- CreateIndex
CREATE INDEX "crm_approval_instances_owner_user_id_form_type_target_id_idx" ON "crm_approval_instances"("owner_user_id", "form_type", "target_id");

-- CreateIndex
CREATE INDEX "crm_approval_instances_owner_user_id_status_idx" ON "crm_approval_instances"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "crm_approval_tasks_approver_id_status_idx" ON "crm_approval_tasks"("approver_id", "status");

-- CreateIndex
CREATE INDEX "crm_approval_tasks_instance_id_node_index_idx" ON "crm_approval_tasks"("instance_id", "node_index");

-- CreateIndex
CREATE INDEX "crm_approval_records_instance_id_idx" ON "crm_approval_records"("instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_approval_cc_instance_id_user_id_key" ON "crm_approval_cc"("instance_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bi_settings_owner_user_id_key" ON "bi_settings"("owner_user_id");

-- CreateIndex
CREATE INDEX "bi_members_owner_user_id_status_idx" ON "bi_members"("owner_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bi_members_owner_user_id_member_user_id_key" ON "bi_members"("owner_user_id", "member_user_id");

-- CreateIndex
CREATE INDEX "bi_datasources_owner_user_id_kind_idx" ON "bi_datasources"("owner_user_id", "kind");

-- CreateIndex
CREATE INDEX "bi_datasource_tables_owner_user_id_idx" ON "bi_datasource_tables"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bi_datasource_tables_datasource_id_table_name_key" ON "bi_datasource_tables"("datasource_id", "table_name");

-- CreateIndex
CREATE UNIQUE INDEX "bi_datasource_fields_table_id_field_name_key" ON "bi_datasource_fields"("table_id", "field_name");

-- CreateIndex
CREATE INDEX "bi_dataset_groups_owner_user_id_idx" ON "bi_dataset_groups"("owner_user_id");

-- CreateIndex
CREATE INDEX "bi_datasets_owner_user_id_group_id_idx" ON "bi_datasets"("owner_user_id", "group_id");

-- CreateIndex
CREATE INDEX "bi_dataset_tables_dataset_id_idx" ON "bi_dataset_tables"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "bi_dataset_fields_dataset_id_field_key_key" ON "bi_dataset_fields"("dataset_id", "field_key");

-- CreateIndex
CREATE INDEX "bi_dataset_relations_dataset_id_idx" ON "bi_dataset_relations"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "bi_dataset_permissions_dataset_id_role_key" ON "bi_dataset_permissions"("dataset_id", "role");

-- CreateIndex
CREATE INDEX "bi_terms_owner_user_id_dataset_id_idx" ON "bi_terms"("owner_user_id", "dataset_id");

-- CreateIndex
CREATE INDEX "bi_trainings_owner_user_id_dataset_id_idx" ON "bi_trainings"("owner_user_id", "dataset_id");

-- CreateIndex
CREATE INDEX "bi_recommended_questions_owner_user_id_dataset_id_idx" ON "bi_recommended_questions"("owner_user_id", "dataset_id");

-- CreateIndex
CREATE INDEX "bi_charts_owner_user_id_dataset_id_idx" ON "bi_charts"("owner_user_id", "dataset_id");

-- CreateIndex
CREATE INDEX "bi_dashboards_owner_user_id_idx" ON "bi_dashboards"("owner_user_id");

-- CreateIndex
CREATE INDEX "bi_dashboard_components_dashboard_id_idx" ON "bi_dashboard_components"("dashboard_id");

-- CreateIndex
CREATE INDEX "bi_chat_sessions_owner_user_id_updated_at_idx" ON "bi_chat_sessions"("owner_user_id", "updated_at");

-- CreateIndex
CREATE INDEX "bi_chat_messages_session_id_created_at_idx" ON "bi_chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "bi_query_logs_owner_user_id_created_at_idx" ON "bi_query_logs"("owner_user_id", "created_at");

-- RenameIndex
ALTER INDEX "bigdata_query_messages_user_id_dataset_idx" RENAME TO "bigdata_query_messages_user_id_dataset_task_id_created_at_idx";

