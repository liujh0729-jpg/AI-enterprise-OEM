-- AlterTable
ALTER TABLE `service_desk_conversations` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `crm_leads` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `crm_customers` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `party_id` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `crm_opportunities` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `crm_contracts` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `crm_orders` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `okr_cycles` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `okr_objectives` ADD COLUMN `brief_id` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `okr_key_results` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `okr_plans` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `okr_reports` ADD COLUMN `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    ADD COLUMN `org_user_id` VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `hrm_reviews` ADD COLUMN `okr_evidence` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    ADD COLUMN `okr_score` DECIMAL(5, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `pj_projects` ADD COLUMN `brief_id` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `budget_breakdown` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    ADD COLUMN `deliverables` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    ADD COLUMN `target_outcome` TEXT NOT NULL DEFAULT ('');

-- AlterTable
ALTER TABLE `pj_tasks` ADD COLUMN `acceptance_criteria` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    ADD COLUMN `assessment_weight` DECIMAL(6, 2) NOT NULL DEFAULT 1,
    ADD COLUMN `quality_rubric` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    ADD COLUMN `source_id` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `source_type` VARCHAR(16) NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `erp_vendors` ADD COLUMN `party_id` INTEGER NOT NULL DEFAULT 0;

-- 回填统一租户键：历史数据归属企业账号自身
UPDATE `crm_leads` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `crm_customers` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `crm_opportunities` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `crm_contracts` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `crm_orders` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `okr_cycles` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `okr_objectives` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `okr_key_results` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `okr_plans` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `okr_reports` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';
UPDATE `service_desk_conversations` SET `org_user_id` = `owner_user_id` WHERE `org_user_id` = '';

-- CreateTable
CREATE TABLE `biz_parties` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'VENDOR',
    `name` VARCHAR(120) NOT NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `email` VARCHAR(120) NOT NULL DEFAULT '',
    `tax_no` VARCHAR(32) NOT NULL DEFAULT '',
    `address` VARCHAR(200) NOT NULL DEFAULT '',
    `roles` JSON NOT NULL,
    `capabilities` JSON NOT NULL,
    `rate_card` JSON NOT NULL,
    `availability` JSON NOT NULL,
    `compliance` JSON NOT NULL,
    `rating` DECIMAL(4, 2) NOT NULL DEFAULT 0,
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `biz_parties_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `biz_parties_org_type_org_user_id_kind_idx`(`org_type`, `org_user_id`, `kind`),
    UNIQUE INDEX `biz_parties_org_type_org_user_id_name_key`(`org_type`, `org_user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_engagements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `party_id` INTEGER NOT NULL,
    `scope` VARCHAR(500) NOT NULL DEFAULT '',
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `payment_terms` VARCHAR(200) NOT NULL DEFAULT '',
    `acceptance` JSON NOT NULL,
    `start_date` VARCHAR(16) NOT NULL DEFAULT '',
    `end_date` VARCHAR(16) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_engagements_org_type_org_user_id_project_id_idx`(`org_type`, `org_user_id`, `project_id`),
    INDEX `pj_engagements_party_id_status_idx`(`party_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_cost_rates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `principal_type` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `principal_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(64) NOT NULL DEFAULT '',
    `hourly_rate` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `daily_rate` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `effective_from` VARCHAR(16) NOT NULL DEFAULT '',
    `effective_to` VARCHAR(16) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_cost_rates_org_type_org_user_id_idx`(`org_type`, `org_user_id`),
    UNIQUE INDEX `pj_cost_rates_org_type_org_user_id_principal_type_principal__key`(`org_type`, `org_user_id`, `principal_type`, `principal_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_cost_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'OTHER',
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `qty` DECIMAL(18, 4) NOT NULL DEFAULT 1,
    `unit` VARCHAR(16) NOT NULL DEFAULT '',
    `unit_cost` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `source_type` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `source_id` VARCHAR(64) NOT NULL DEFAULT '',
    `occurred_at` VARCHAR(16) NOT NULL DEFAULT '',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pj_cost_items_org_type_org_user_id_project_id_kind_idx`(`org_type`, `org_user_id`, `project_id`, `kind`),
    INDEX `pj_cost_items_source_type_source_id_idx`(`source_type`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `event` VARCHAR(80) NOT NULL,
    `payload` JSON NOT NULL,
    `actor_id` VARCHAR(64) NOT NULL DEFAULT '',
    `source` VARCHAR(32) NOT NULL DEFAULT '',
    `source_id` VARCHAR(64) NOT NULL DEFAULT '',
    `idempotency_key` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_logs_idempotency_key_key`(`idempotency_key`),
    INDEX `event_logs_org_type_org_user_id_event_occurred_at_idx`(`org_type`, `org_user_id`, `event`, `occurred_at`),
    INDEX `event_logs_occurred_at_idx`(`occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rule_executions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `event_log_id` INTEGER NOT NULL DEFAULT 0,
    `rule_id` INTEGER NOT NULL,
    `action_type` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `detail` JSON NOT NULL,
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `duration_ms` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rule_executions_org_type_org_user_id_rule_id_created_at_idx`(`org_type`, `org_user_id`, `rule_id`, `created_at`),
    INDEX `rule_executions_event_log_id_idx`(`event_log_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_goal_briefs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `cycle_id` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(200) NOT NULL,
    `business_goal` TEXT NOT NULL DEFAULT (''),
    `scope_what` TEXT NOT NULL DEFAULT (''),
    `scope_target` TEXT NOT NULL DEFAULT (''),
    `deliverables` JSON NOT NULL,
    `start_date` VARCHAR(16) NOT NULL DEFAULT '',
    `end_date` VARCHAR(16) NOT NULL DEFAULT '',
    `budget_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `budget_hours` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `labor` JSON NOT NULL,
    `materials` JSON NOT NULL,
    `equipment` JSON NOT NULL,
    `external_services` JSON NOT NULL,
    `constraints` TEXT NOT NULL DEFAULT (''),
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_goal_briefs_org_type_org_user_id_status_updated_at_idx`(`org_type`, `org_user_id`, `status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_dialog_turns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brief_id` INTEGER NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL DEFAULT (''),
    `structured` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `okr_dialog_turns_brief_id_id_idx`(`brief_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_decompositions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `brief_id` INTEGER NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'RULE',
    `option_key` VARCHAR(16) NOT NULL DEFAULT 'BALANCED',
    `payload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `committed_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_decompositions_brief_id_version_idx`(`brief_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_task_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `objective_id` INTEGER NOT NULL,
    `kr_id` INTEGER NOT NULL DEFAULT 0,
    `task_id` INTEGER NOT NULL,
    `weight` DECIMAL(6, 2) NOT NULL DEFAULT 1,
    `target_value` DECIMAL(16, 4) NOT NULL DEFAULT 0,
    `acceptance` JSON NOT NULL,
    `owner_member_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_task_links_org_type_org_user_id_objective_id_idx`(`org_type`, `org_user_id`, `objective_id`),
    INDEX `okr_task_links_task_id_idx`(`task_id`),
    UNIQUE INDEX `okr_task_links_kr_id_task_id_key`(`kr_id`, `task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `service_desk_conversations_org_type_org_user_id_idx` ON `service_desk_conversations`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `crm_leads_org_type_org_user_id_idx` ON `crm_leads`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `crm_customers_org_type_org_user_id_idx` ON `crm_customers`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `crm_opportunities_org_type_org_user_id_idx` ON `crm_opportunities`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `crm_contracts_org_type_org_user_id_idx` ON `crm_contracts`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `crm_orders_org_type_org_user_id_idx` ON `crm_orders`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `okr_cycles_org_type_org_user_id_idx` ON `okr_cycles`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `okr_objectives_org_type_org_user_id_idx` ON `okr_objectives`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `okr_key_results_org_type_org_user_id_idx` ON `okr_key_results`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `okr_plans_org_type_org_user_id_idx` ON `okr_plans`(`org_type`, `org_user_id`);

-- CreateIndex
CREATE INDEX `okr_reports_org_type_org_user_id_idx` ON `okr_reports`(`org_type`, `org_user_id`);
