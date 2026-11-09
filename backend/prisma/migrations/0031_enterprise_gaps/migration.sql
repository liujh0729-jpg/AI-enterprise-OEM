-- 附录 B 剩余项一次补齐（2026-11-07）：
-- 权益配额 / 预约忙闲 / 邮件模板 / 页面助手 / 语音转写 / 报价单 PDF /
-- 工时审计 / 促销码 / 售后状态机 / 服务评价 / 三方任务同步 / 条款留痕 /
-- 入职引导 / 产品更新日志 / 主体切换器 / 使用埋点。
-- 组织键沿用 (org_type, org_user_id)；表间引用用普通 INT 列，级联在服务层做。

-- CreateTable
CREATE TABLE `entitlement_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `audience` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `price_monthly` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `entitlement_plans_code_key`(`code`),
    INDEX `entitlement_plans_audience_status_idx`(`audience`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entitlement_quotas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `plan_code` VARCHAR(32) NOT NULL,
    `feature_code` VARCHAR(64) NOT NULL,
    `access` VARCHAR(8) NOT NULL DEFAULT 'allowed',
    `limit_count` INTEGER NOT NULL DEFAULT -1,
    `unit` VARCHAR(16) NOT NULL DEFAULT '',
    `note` VARCHAR(200) NOT NULL DEFAULT '',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `entitlement_quotas_plan_feature_key`(`plan_code`, `feature_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `org_entitlements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `plan_code` VARCHAR(32) NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `org_entitlements_org_key`(`org_type`, `org_user_id`),
    INDEX `org_entitlements_plan_code_status_idx`(`plan_code`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entitlement_usage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `feature_code` VARCHAR(64) NOT NULL,
    `period` VARCHAR(8) NOT NULL,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `entitlement_usage_org_feature_period_key`(`org_type`, `org_user_id`, `feature_code`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `slug` VARCHAR(48) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `purpose` VARCHAR(16) NOT NULL DEFAULT 'MEETING',
    `duration_min` INTEGER NOT NULL DEFAULT 30,
    `buffer_min` INTEGER NOT NULL DEFAULT 10,
    `location` VARCHAR(200) NOT NULL DEFAULT '',
    `description` VARCHAR(1000) NOT NULL DEFAULT '',
    `horizon_days` INTEGER NOT NULL DEFAULT 30,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `appointment_events_slug_key`(`slug`),
    INDEX `appointment_events_org_type_org_user_id_active_idx`(`org_type`, `org_user_id`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment_slots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `event_id` INTEGER NOT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `booked` BOOLEAN NOT NULL DEFAULT false,
    `booking_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `appointment_slots_event_start_key`(`event_id`, `start_at`),
    INDEX `appointment_slots_org_type_org_user_id_start_at_idx`(`org_type`, `org_user_id`, `start_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment_bookings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `event_id` INTEGER NOT NULL,
    `slot_id` INTEGER NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `email` VARCHAR(120) NOT NULL DEFAULT '',
    `company` VARCHAR(120) NOT NULL DEFAULT '',
    `note` VARCHAR(1000) NOT NULL DEFAULT '',
    `ref_type` VARCHAR(24) NOT NULL DEFAULT '',
    `ref_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'BOOKED',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `appointment_bookings_org_type_org_user_id_status_created_at_idx`(`org_type`, `org_user_id`, `status`, `created_at`),
    INDEX `appointment_bookings_slot_id_idx`(`slot_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(48) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `locale` VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    `subject` VARCHAR(200) NOT NULL,
    `html` LONGTEXT NOT NULL,
    `text` TEXT NOT NULL,
    `variables` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_templates_org_code_locale_key`(`org_type`, `org_user_id`, `code`, `locale`),
    INDEX `email_templates_org_type_org_user_id_enabled_idx`(`org_type`, `org_user_id`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assistant_page_queries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `route` VARCHAR(200) NOT NULL,
    `entity_type` VARCHAR(32) NOT NULL DEFAULT '',
    `entity_id` VARCHAR(64) NOT NULL DEFAULT '',
    `question` VARCHAR(1000) NOT NULL,
    `answer` TEXT NOT NULL,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assistant_page_queries_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_transcripts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL DEFAULT 'OTHER',
    `target_id` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(120) NOT NULL,
    `audio_name` VARCHAR(200) NOT NULL DEFAULT '',
    `duration_sec` INTEGER NOT NULL DEFAULT 0,
    `language` VARCHAR(16) NOT NULL DEFAULT 'zh',
    `transcript` LONGTEXT NOT NULL,
    `summary` TEXT NOT NULL,
    `insights` JSON NOT NULL,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'DONE',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_transcripts_org_type_org_user_id_target_type_target_id_idx`(`org_type`, `org_user_id`, `target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pj_time_log_edits` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `time_log_id` INTEGER NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `editor_id` VARCHAR(64) NOT NULL,
    `before_json` JSON NOT NULL,
    `after_json` JSON NOT NULL,
    `reason` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pj_time_log_edits_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    INDEX `pj_time_log_edits_time_log_id_idx`(`time_log_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_promo_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'FIXED',
    `value` DECIMAL(18, 4) NOT NULL,
    `min_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `max_redemptions` INTEGER NOT NULL DEFAULT 0,
    `redeemed_count` INTEGER NOT NULL DEFAULT 0,
    `per_user_limit` INTEGER NOT NULL DEFAULT 1,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `point_promo_codes_code_key`(`code`),
    INDEX `point_promo_codes_status_ends_at_idx`(`status`, `ends_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_promo_redemptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `promo_id` INTEGER NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `points` DECIMAL(18, 4) NOT NULL,
    `ref_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `point_promo_redemptions_promo_id_user_id_idx`(`promo_id`, `user_id`),
    INDEX `point_promo_redemptions_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_after_sales_tickets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `conversation_id` INTEGER NOT NULL DEFAULT 0,
    `order_no` VARCHAR(64) NOT NULL DEFAULT '',
    `kind` VARCHAR(16) NOT NULL DEFAULT 'RETURN',
    `reason` VARCHAR(500) NOT NULL DEFAULT '',
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `contact` VARCHAR(80) NOT NULL DEFAULT '',
    `note` VARCHAR(1000) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `assignee_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `service_after_sales_tickets_owner_user_id_status_created_at_idx`(`owner_user_id`, `status`, `created_at`),
    INDEX `service_after_sales_tickets_conversation_id_idx`(`conversation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_after_sales_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticket_id` INTEGER NOT NULL,
    `from_status` VARCHAR(16) NOT NULL DEFAULT '',
    `to_status` VARCHAR(16) NOT NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `operator_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_after_sales_events_ticket_id_created_at_idx`(`ticket_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `market_service_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `listing_id` VARCHAR(64) NOT NULL,
    `listing_type` VARCHAR(16) NOT NULL DEFAULT 'SUPPLY',
    `rating` INTEGER NOT NULL DEFAULT 5,
    `content` VARCHAR(1000) NOT NULL DEFAULT '',
    `reviewer_name` VARCHAR(64) NOT NULL DEFAULT '',
    `reviewer_user_id` VARCHAR(64) NOT NULL,
    `order_ref` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'VISIBLE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `market_service_reviews_org_type_org_user_id_listing_id_idx`(`org_type`, `org_user_id`, `listing_id`),
    INDEX `market_service_reviews_listing_type_status_created_at_idx`(`listing_type`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_sync_bindings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL DEFAULT 0,
    `provider` VARCHAR(16) NOT NULL,
    `base_url` VARCHAR(300) NOT NULL,
    `project_key` VARCHAR(80) NOT NULL DEFAULT '',
    `username` VARCHAR(120) NOT NULL DEFAULT '',
    `token_enc` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_run_at` DATETIME(3) NULL,
    `last_result` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `task_sync_bindings_org_project_provider_key`(`org_type`, `org_user_id`, `project_id`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_sync_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `binding_id` INTEGER NOT NULL,
    `task_id` INTEGER NOT NULL,
    `remote_id` VARCHAR(128) NOT NULL,
    `remote_key` VARCHAR(80) NOT NULL DEFAULT '',
    `remote_status` VARCHAR(32) NOT NULL DEFAULT '',
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `task_sync_links_binding_task_key`(`binding_id`, `task_id`),
    INDEX `task_sync_links_remote_id_idx`(`remote_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_sync_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `binding_id` INTEGER NOT NULL,
    `direction` VARCHAR(8) NOT NULL DEFAULT 'BOTH',
    `pushed` INTEGER NOT NULL DEFAULT 0,
    `pulled` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `message` VARCHAR(1000) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_sync_runs_binding_id_created_at_idx`(`binding_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `terms_documents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `version` VARCHAR(24) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `category` VARCHAR(16) NOT NULL DEFAULT 'SERVICE',
    `content` LONGTEXT NOT NULL,
    `require_reaccept` BOOLEAN NOT NULL DEFAULT true,
    `effective_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `terms_documents_code_version_key`(`code`, `version`),
    INDEX `terms_documents_status_category_idx`(`status`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `terms_acceptances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `document_id` INTEGER NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `version` VARCHAR(24) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `ip` VARCHAR(64) NOT NULL DEFAULT '',
    `user_agent` VARCHAR(300) NOT NULL DEFAULT '',
    `accepted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `terms_acceptances_user_code_version_key`(`user_id`, `code`, `version`),
    INDEX `terms_acceptances_code_version_accepted_at_idx`(`code`, `version`, `accepted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'HIRE',
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `onboarding_templates_org_type_org_user_id_kind_active_idx`(`org_type`, `org_user_id`, `kind`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_template_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `template_id` INTEGER NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `owner_role` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `due_days` INTEGER NOT NULL DEFAULT 3,
    `sort` INTEGER NOT NULL DEFAULT 0,

    INDEX `onboarding_template_items_template_id_sort_idx`(`template_id`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `template_id` INTEGER NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `offer_id` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `onboarding_runs_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `onboarding_runs_staff_user_id_idx`(`staff_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `template_item_id` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `owner_role` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `assignee_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `due_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'TODO',
    `done_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `onboarding_tasks_run_id_sort_idx`(`run_id`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `help_changelog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `version` VARCHAR(32) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `summary` TEXT NOT NULL,
    `body` LONGTEXT NOT NULL,
    `category` VARCHAR(16) NOT NULL DEFAULT 'PRODUCT',
    `released_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `help_changelog_version_category_key`(`version`, `category`),
    INDEX `help_changelog_status_released_at_idx`(`status`, `released_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_org_contexts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_org_contexts_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_usage_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT '',
    `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `event` VARCHAR(64) NOT NULL,
    `route` VARCHAR(200) NOT NULL DEFAULT '',
    `target_type` VARCHAR(32) NOT NULL DEFAULT '',
    `target_id` VARCHAR(64) NOT NULL DEFAULT '',
    `metadata` JSON NOT NULL,
    `ip` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_usage_events_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `product_usage_events_event_created_at_idx`(`event`, `created_at`),
    INDEX `product_usage_events_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usage_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(64) NOT NULL,
    `value` TEXT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `usage_settings_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `crm_quotations`
    ADD COLUMN `template_code` VARCHAR(24) NOT NULL DEFAULT 'CLASSIC',
    ADD COLUMN `customer_name` VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN `note` VARCHAR(1000) NOT NULL DEFAULT '',
    ADD COLUMN `public_token` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `sent_at` DATETIME(3) NULL,
    ADD COLUMN `read_at` DATETIME(3) NULL,
    ADD COLUMN `view_count` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `crm_quotations_public_token_idx` ON `crm_quotations`(`public_token`);
