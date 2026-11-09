-- §5.8 横切机制 / §5.2 项目任务工时 / §5.4 ERP / 营销技能库 / AI 简历代投

-- CreateTable
CREATE TABLE `mech_webhooks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `secret_cipher` VARCHAR(500) NOT NULL DEFAULT '',
    `events` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `last_delivered_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mech_webhooks_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    INDEX `mech_webhooks_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mech_webhook_outbox` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `subscription_id` INTEGER NOT NULL,
    `event` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mech_webhook_outbox_org_type_org_user_id_status_created_at_idx`(`org_type`, `org_user_id`, `status`, `created_at`),
    INDEX `mech_webhook_outbox_subscription_id_created_at_idx`(`subscription_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mech_import_maps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `mapping` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mech_import_maps_org_type_org_user_id_updated_at_idx`(`org_type`, `org_user_id`, `updated_at`),
    UNIQUE INDEX `mech_import_maps_org_type_org_user_id_module_name_key`(`org_type`, `org_user_id`, `module`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mech_import_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `file_name` VARCHAR(200) NOT NULL DEFAULT '',
    `total` INTEGER NOT NULL DEFAULT 0,
    `success` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `errors` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `mech_import_jobs_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mech_export_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `format` VARCHAR(8) NOT NULL DEFAULT 'csv',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `file_key` VARCHAR(300) NOT NULL DEFAULT '',
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `filters` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `mech_export_jobs_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_report_catalog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `description` VARCHAR(300) NOT NULL DEFAULT '',
    `path` VARCHAR(200) NOT NULL DEFAULT '',
    `icon` VARCHAR(32) NOT NULL DEFAULT 'chart',
    `show_in_menu` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `plan_code` VARCHAR(32) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bi_report_catalog_module_sort_order_idx`(`module`, `sort_order`),
    UNIQUE INDEX `bi_report_catalog_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mech_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(300) NOT NULL DEFAULT '',
    `event` VARCHAR(64) NOT NULL,
    `conditions` JSON NOT NULL,
    `actions` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_triggered_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mech_rules_org_type_org_user_id_event_enabled_idx`(`org_type`, `org_user_id`, `event`, `enabled`),
    UNIQUE INDEX `mech_rules_org_type_org_user_id_code_key`(`org_type`, `org_user_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mech_public_shares` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `slug` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `projection` JSON NOT NULL,
    `password_hash` VARCHAR(200) NOT NULL DEFAULT '',
    `expires_at` DATETIME(3) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `view_count` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mech_public_shares_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    INDEX `mech_public_shares_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `mech_public_shares_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oidc_providers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `issuer` VARCHAR(300) NOT NULL,
    `client_id` VARCHAR(200) NOT NULL,
    `client_secret_cipher` VARCHAR(500) NOT NULL DEFAULT '',
    `scopes` VARCHAR(200) NOT NULL DEFAULT 'openid profile email',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `auto_provision` BOOLEAN NOT NULL DEFAULT false,
    `default_role` VARCHAR(16) NOT NULL DEFAULT 'user',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `oidc_providers_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mech_asset_share_policies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL DEFAULT '默认策略',
    `default_expires_days` INTEGER NOT NULL DEFAULT 7,
    `max_expires_days` INTEGER NOT NULL DEFAULT 30,
    `require_password` BOOLEAN NOT NULL DEFAULT false,
    `allow_public` BOOLEAN NOT NULL DEFAULT true,
    `allowed_kinds` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mech_asset_share_policies_org_type_org_user_id_key`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_sync_bindings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `domain` VARCHAR(16) NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `principal_type` VARCHAR(24) NOT NULL DEFAULT 'STAFF',
    `local_id` VARCHAR(64) NOT NULL,
    `label` VARCHAR(120) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_sync_bindings_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    UNIQUE INDEX `hrm_sync_bindings_org_channel_external_uniq`(`org_type`, `org_user_id`, `channel`, `domain`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_insight_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `scope` VARCHAR(24) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `mode` VARCHAR(8) NOT NULL,
    `summary` VARCHAR(1000) NOT NULL DEFAULT '',
    `findings` JSON NOT NULL,
    `suggestions` JSON NOT NULL,
    `metrics` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_insight_records_org_type_org_user_id_scope_created_at_idx`(`org_type`, `org_user_id`, `scope`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_projects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(32) NOT NULL DEFAULT '',
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `source_ref` VARCHAR(64) NOT NULL DEFAULT '',
    `customer_name` VARCHAR(120) NOT NULL DEFAULT '',
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `owner_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PLANNING',
    `start_date` VARCHAR(16) NOT NULL DEFAULT '',
    `end_date` VARCHAR(16) NOT NULL DEFAULT '',
    `budget_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `budget_hours` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_projects_org_type_org_user_id_status_updated_at_idx`(`org_type`, `org_user_id`, `status`, `updated_at`),
    INDEX `pj_projects_org_type_org_user_id_code_idx`(`org_type`, `org_user_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_project_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `principal_type` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `principal_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'MEMBER',
    `allocation_pct` INTEGER NOT NULL DEFAULT 100,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_project_members_org_type_org_user_id_principal_id_idx`(`org_type`, `org_user_id`, `principal_id`),
    UNIQUE INDEX `pj_project_members_project_id_principal_type_principal_id_key`(`project_id`, `principal_type`, `principal_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_sprints` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `goal` VARCHAR(500) NOT NULL DEFAULT '',
    `start_date` VARCHAR(16) NOT NULL DEFAULT '',
    `end_date` VARCHAR(16) NOT NULL DEFAULT '',
    `capacity_hours` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_sprints_project_id_created_at_idx`(`project_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_milestones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `due_date` VARCHAR(16) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'TODO',
    `deliverable` VARCHAR(500) NOT NULL DEFAULT '',
    `acceptance_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_milestones_project_id_due_date_idx`(`project_id`, `due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `sprint_id` INTEGER NOT NULL DEFAULT 0,
    `milestone_id` INTEGER NOT NULL DEFAULT 0,
    `parent_id` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'TASK',
    `priority` VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(16) NOT NULL DEFAULT 'TODO',
    `assignee_type` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `assignee_id` VARCHAR(64) NOT NULL DEFAULT '',
    `estimate_hours` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `estimate_points` INTEGER NOT NULL DEFAULT 0,
    `start_date` VARCHAR(16) NOT NULL DEFAULT '',
    `due_date` VARCHAR(16) NOT NULL DEFAULT '',
    `completed_at` DATETIME(3) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `logged_minutes` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_tasks_project_id_status_sort_order_idx`(`project_id`, `status`, `sort_order`),
    INDEX `pj_tasks_org_assignee_status_idx`(`org_type`, `org_user_id`, `assignee_type`, `assignee_id`, `status`),
    INDEX `pj_tasks_org_type_org_user_id_due_date_idx`(`org_type`, `org_user_id`, `due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_task_relations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `task_id` INTEGER NOT NULL,
    `related_task_id` INTEGER NOT NULL,
    `kind` VARCHAR(8) NOT NULL DEFAULT 'FS',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pj_task_relations_related_task_id_idx`(`related_task_id`),
    UNIQUE INDEX `pj_task_relations_task_id_related_task_id_kind_key`(`task_id`, `related_task_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_time_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `task_id` INTEGER NOT NULL DEFAULT 0,
    `principal_type` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `principal_id` VARCHAR(64) NOT NULL,
    `work_date` VARCHAR(16) NOT NULL,
    `start_at` VARCHAR(32) NOT NULL DEFAULT '',
    `end_at` VARCHAR(32) NOT NULL DEFAULT '',
    `duration_minutes` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `running` BOOLEAN NOT NULL DEFAULT false,
    `started_at` DATETIME(3) NULL,
    `approved_by` VARCHAR(64) NOT NULL DEFAULT '',
    `approved_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_time_logs_org_principal_work_date_idx`(`org_type`, `org_user_id`, `principal_type`, `principal_id`, `work_date`),
    INDEX `pj_time_logs_project_id_work_date_idx`(`project_id`, `work_date`),
    INDEX `pj_time_logs_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_timesheets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `principal_type` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `principal_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL DEFAULT 0,
    `period_start` VARCHAR(16) NOT NULL,
    `period_end` VARCHAR(16) NOT NULL,
    `total_minutes` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `approver_id` VARCHAR(64) NOT NULL DEFAULT '',
    `decided_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_timesheets_org_type_org_user_id_status_period_start_idx`(`org_type`, `org_user_id`, `status`, `period_start`),
    UNIQUE INDEX `pj_timesheets_org_principal_period_uniq`(`org_type`, `org_user_id`, `principal_type`, `principal_id`, `project_id`, `period_start`, `period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `statuses` JSON NOT NULL,
    `task_types` JSON NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `standard_hours_per_day` INTEGER NOT NULL DEFAULT 8,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pj_settings_org_type_org_user_id_key`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `parent_id` INTEGER NOT NULL DEFAULT 0,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `erp_categories_org_type_org_user_id_code_key`(`org_type`, `org_user_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(32) NOT NULL DEFAULT '',
    `name` VARCHAR(120) NOT NULL,
    `category_id` INTEGER NOT NULL DEFAULT 0,
    `unit` VARCHAR(16) NOT NULL DEFAULT '件',
    `spec` VARCHAR(120) NOT NULL DEFAULT '',
    `barcode` VARCHAR(64) NOT NULL DEFAULT '',
    `purchase_price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `sale_price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `tax_rate` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_products_org_type_org_user_id_name_idx`(`org_type`, `org_user_id`, `name`),
    INDEX `erp_products_org_type_org_user_id_category_id_idx`(`org_type`, `org_user_id`, `category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_variants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `product_id` INTEGER NOT NULL,
    `sku` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL DEFAULT '',
    `attributes` JSON NOT NULL,
    `purchase_price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `sale_price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_variants_product_id_idx`(`product_id`),
    UNIQUE INDEX `erp_variants_org_type_org_user_id_sku_key`(`org_type`, `org_user_id`, `sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_warehouses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `address` VARCHAR(200) NOT NULL DEFAULT '',
    `manager_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `erp_warehouses_org_type_org_user_id_code_key`(`org_type`, `org_user_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `warehouse_id` INTEGER NOT NULL,
    `variant_id` INTEGER NOT NULL,
    `on_hand` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `in_transit` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `locked` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `reorder_point` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_stock_org_type_org_user_id_variant_id_idx`(`org_type`, `org_user_id`, `variant_id`),
    UNIQUE INDEX `erp_stock_warehouse_id_variant_id_key`(`warehouse_id`, `variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_moves` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `move_no` VARCHAR(40) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `warehouse_id` INTEGER NOT NULL,
    `to_warehouse_id` INTEGER NOT NULL DEFAULT 0,
    `variant_id` INTEGER NOT NULL,
    `quantity` DECIMAL(18, 2) NOT NULL,
    `unit_cost` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `source_type` VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    `source_id` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_stock_moves_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    INDEX `erp_stock_moves_warehouse_id_variant_id_idx`(`warehouse_id`, `variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `request_no` VARCHAR(40) NOT NULL,
    `requester_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL DEFAULT 0,
    `warehouse_id` INTEGER NOT NULL,
    `items` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `approver_id` VARCHAR(64) NOT NULL DEFAULT '',
    `decided_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_stock_requests_org_type_org_user_id_status_created_at_idx`(`org_type`, `org_user_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_vendors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `email` VARCHAR(120) NOT NULL DEFAULT '',
    `tax_no` VARCHAR(32) NOT NULL DEFAULT '',
    `address` VARCHAR(200) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `erp_vendors_org_type_org_user_id_code_key`(`org_type`, `org_user_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_purchase_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `order_no` VARCHAR(40) NOT NULL,
    `vendor_id` INTEGER NOT NULL,
    `warehouse_id` INTEGER NOT NULL,
    `items` JSON NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `tax_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `expected_at` VARCHAR(16) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `approver_id` VARCHAR(64) NOT NULL DEFAULT '',
    `decided_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_purchase_orders_org_type_org_user_id_status_created_at_idx`(`org_type`, `org_user_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `receipt_no` VARCHAR(40) NOT NULL,
    `purchase_order_id` INTEGER NOT NULL,
    `warehouse_id` INTEGER NOT NULL,
    `items` JSON NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `received_by` VARCHAR(64) NOT NULL DEFAULT '',
    `received_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_receipts_org_type_org_user_id_status_created_at_idx`(`org_type`, `org_user_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_receivables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(32) NOT NULL DEFAULT '',
    `customer_name` VARCHAR(120) NOT NULL,
    `customer_id` INTEGER NOT NULL DEFAULT 0,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `source_type` VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    `source_id` INTEGER NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL,
    `received_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `due_date` VARCHAR(16) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_receivables_org_type_org_user_id_status_due_date_idx`(`org_type`, `org_user_id`, `status`, `due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_payables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(32) NOT NULL DEFAULT '',
    `vendor_id` INTEGER NOT NULL DEFAULT 0,
    `source_type` VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    `source_id` INTEGER NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL,
    `paid_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `due_date` VARCHAR(16) NOT NULL DEFAULT '',
    `recurrence` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `next_at` VARCHAR(16) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_payables_org_type_org_user_id_status_due_date_idx`(`org_type`, `org_user_id`, `status`, `due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_expense_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `report_no` VARCHAR(40) NOT NULL,
    `applicant_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL DEFAULT 0,
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `items` JSON NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `approver_id` VARCHAR(64) NOT NULL DEFAULT '',
    `decided_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_expense_reports_org_type_org_user_id_status_created_at_idx`(`org_type`, `org_user_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_tax_rates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `rate` DECIMAL(8, 2) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'BOTH',
    `note` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_tax_rates_org_type_org_user_id_idx`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_price_policies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `scope` VARCHAR(16) NOT NULL DEFAULT 'ALL',
    `scope_id` INTEGER NOT NULL DEFAULT 0,
    `discount_pct` DECIMAL(8, 2) NOT NULL,
    `min_qty` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `erp_price_policies_org_type_org_user_id_idx`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mkt_skills` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `skill_key` VARCHAR(40) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `category` VARCHAR(24) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `channel` VARCHAR(40) NOT NULL DEFAULT '',
    `prompt_template` TEXT NOT NULL,
    `inputs` JSON NOT NULL,
    `output_format` VARCHAR(16) NOT NULL DEFAULT 'MARKDOWN',
    `builtin` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `run_count` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mkt_skills_org_type_org_user_id_category_idx`(`org_type`, `org_user_id`, `category`),
    UNIQUE INDEX `mkt_skills_org_type_org_user_id_skill_key_key`(`org_type`, `org_user_id`, `skill_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mkt_skill_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `skill_id` INTEGER NOT NULL,
    `skill_key` VARCHAR(40) NOT NULL,
    `skill_name` VARCHAR(60) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    `mode` VARCHAR(8) NOT NULL DEFAULT 'rule',
    `input` JSON NOT NULL,
    `output` TEXT NOT NULL,
    `artifact_id` INTEGER NULL,
    `tokens` INTEGER NOT NULL DEFAULT 0,
    `points` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `mkt_skill_runs_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    INDEX `mkt_skill_runs_skill_key_created_at_idx`(`skill_key`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mkt_artifacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `kind` VARCHAR(24) NOT NULL DEFAULT 'COPY',
    `body` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `source_run_id` INTEGER NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mkt_artifacts_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mkt_contexts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `brand_name` VARCHAR(80) NOT NULL DEFAULT '',
    `industry` VARCHAR(60) NOT NULL DEFAULT '',
    `positioning` VARCHAR(500) NOT NULL DEFAULT '',
    `tone` VARCHAR(200) NOT NULL DEFAULT '',
    `audiences` JSON NOT NULL,
    `keywords` JSON NOT NULL,
    `competitors` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mkt_contexts_org_type_org_user_id_key`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mkt_capability_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `capability_key` VARCHAR(40) NOT NULL,
    `account_name` VARCHAR(80) NOT NULL DEFAULT '',
    `credential_cipher` VARCHAR(2000) NOT NULL DEFAULT '',
    `connected` BOOLEAN NOT NULL DEFAULT false,
    `connected_at` DATETIME(3) NULL,
    `last_sync_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mkt_capability_accounts_org_type_org_user_id_capability_key_key`(`org_type`, `org_user_id`, `capability_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mkt_loops` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `skill_key` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `cron` VARCHAR(60) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_run_at` DATETIME(3) NULL,
    `next_run_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mkt_loops_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recruit_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `full_name` VARCHAR(60) NOT NULL DEFAULT '',
    `headline` VARCHAR(120) NOT NULL DEFAULT '',
    `years` INTEGER NOT NULL DEFAULT 0,
    `city` VARCHAR(60) NOT NULL DEFAULT '',
    `expected_salary` VARCHAR(60) NOT NULL DEFAULT '',
    `objective_role` VARCHAR(120) NOT NULL DEFAULT '',
    `skills` JSON NOT NULL,
    `experiences` JSON NOT NULL,
    `educations` JSON NOT NULL,
    `summary` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recruit_profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recruit_applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `job_id` INTEGER NOT NULL,
    `job_title` VARCHAR(120) NOT NULL,
    `company` VARCHAR(120) NOT NULL DEFAULT '',
    `resume_id` INTEGER NULL,
    `resume_title` VARCHAR(120) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `channel` VARCHAR(24) NOT NULL DEFAULT 'AI',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `recruit_applications_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `recruit_applications_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recruit_application_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `application_id` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recruit_application_events_application_id_at_idx`(`application_id`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recruit_job_evals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `job_id` INTEGER NOT NULL,
    `mode` VARCHAR(8) NOT NULL DEFAULT 'rule',
    `score` INTEGER NOT NULL DEFAULT 0,
    `strengths` JSON NOT NULL,
    `risks` JSON NOT NULL,
    `suggestions` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recruit_job_evals_user_id_job_id_created_at_idx`(`user_id`, `job_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recruit_resume_variants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `job_id` INTEGER NOT NULL,
    `resume_id` INTEGER NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` TEXT NOT NULL,
    `suggestions` JSON NOT NULL,
    `mode` VARCHAR(8) NOT NULL DEFAULT 'rule',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recruit_resume_variants_user_id_job_id_created_at_idx`(`user_id`, `job_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
