-- CreateTable
CREATE TABLE `_schema_meta` (
    `key` VARCHAR(64) NOT NULL,
    `value` VARCHAR(200) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_preferences` (
    `user_id` VARCHAR(64) NOT NULL,
    `current_identity` VARCHAR(32) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `uscc` VARCHAR(32) NOT NULL,
    `subject_type` VARCHAR(16) NOT NULL DEFAULT 'COMPANY',
    `id_card` VARCHAR(32) NOT NULL DEFAULT '',
    `taxpayer_type` VARCHAR(16) NOT NULL DEFAULT 'GENERAL',
    `industry` VARCHAR(100) NOT NULL DEFAULT '',
    `legal_person` VARCHAR(64) NOT NULL DEFAULT '',
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `address` VARCHAR(300) NOT NULL DEFAULT '',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
    `audit_note` VARCHAR(500) NOT NULL DEFAULT '',
    `qxy_org_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `audited_at` DATETIME(3) NULL,

    INDEX `enterprise_profiles_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `provider_type` VARCHAR(32) NOT NULL,
    `org_name` VARCHAR(200) NOT NULL,
    `uscc` VARCHAR(32) NOT NULL DEFAULT '',
    `qualification` VARCHAR(300) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `contact_email` VARCHAR(120) NOT NULL DEFAULT '',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `intro` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `audit_note` VARCHAR(500) NOT NULL DEFAULT '',
    `service_items` VARCHAR(300) NOT NULL DEFAULT '',
    `item_audits` JSON NOT NULL,
    `attachments` JSON NOT NULL,
    `business_staff` JSON NOT NULL,
    `subject_type` VARCHAR(16) NOT NULL DEFAULT 'COMPANY',
    `id_card` VARCHAR(32) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `audited_at` DATETIME(3) NULL,

    INDEX `provider_applications_user_id_provider_type_idx`(`user_id`, `provider_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `real_name` VARCHAR(64) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `email` VARCHAR(120) NOT NULL DEFAULT '',
    `region` VARCHAR(64) NOT NULL DEFAULT '',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `categories` JSON NOT NULL,
    `qualification` VARCHAR(200) NOT NULL DEFAULT '',
    `intro` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `staff_profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_staff` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `roles` JSON NOT NULL,
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `positions` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `provider_staff_provider_user_id_staff_user_id_key`(`provider_user_id`, `staff_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `direction` VARCHAR(24) NOT NULL DEFAULT 'STAFF_APPLY',
    `roles` VARCHAR(200) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `audited_at` DATETIME(3) NULL,

    INDEX `staff_applications_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `staff_applications_staff_user_id_status_idx`(`staff_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_assignments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `provider_assignments_provider_user_id_enterprise_id_key`(`provider_user_id`, `enterprise_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contracts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contract_no` VARCHAR(32) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `provider_org` VARCHAR(200) NOT NULL DEFAULT '',
    `enterprise_id` INTEGER NOT NULL,
    `enterprise_name` VARCHAR(200) NOT NULL DEFAULT '',
    `service_type` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `start_date` VARCHAR(16) NOT NULL DEFAULT '',
    `end_date` VARCHAR(16) NOT NULL DEFAULT '',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `designated_staff` JSON NOT NULL,
    `designated_agent_id` INTEGER NOT NULL DEFAULT 0,
    `designated_agent_name` VARCHAR(64) NOT NULL DEFAULT '',
    `designated_agent_org` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `contracts_contract_no_key`(`contract_no`),
    INDEX `contracts_enterprise_id_service_type_status_idx`(`enterprise_id`, `service_type`, `status`),
    INDEX `contracts_provider_user_id_status_idx`(`provider_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(64) NOT NULL,
    `value` TEXT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `detail` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_user_id_action_idx`(`user_id`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `key_prefix` VARCHAR(12) NOT NULL DEFAULT 'ek_',
    `key_hash` VARCHAR(64) NOT NULL,
    `key_cipher` TEXT NOT NULL,
    `masked` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL DEFAULT '',
    `remote_id` VARCHAR(64) NOT NULL DEFAULT '',
    `scopes` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `rate_limit_day` INTEGER NOT NULL DEFAULT 2000,
    `call_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `api_keys_key_hash_key`(`key_hash`),
    INDEX `api_keys_user_id_idx`(`user_id`),
    INDEX `api_keys_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `logistics_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `carrier` VARCHAR(200) NOT NULL DEFAULT '',
    `order_type` VARCHAR(24) NOT NULL DEFAULT 'DOMESTIC',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `cargo_name` VARCHAR(120) NOT NULL DEFAULT '',
    `origin` VARCHAR(200) NOT NULL DEFAULT '',
    `destination` VARCHAR(200) NOT NULL DEFAULT '',
    `expected_date` VARCHAR(32) NOT NULL DEFAULT '',
    `deadline` VARCHAR(32) NOT NULL DEFAULT '',
    `region_mode` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `remark` TEXT NOT NULL,
    `budget_type` VARCHAR(120) NOT NULL DEFAULT '',
    `expected_result` VARCHAR(300) NOT NULL DEFAULT '',
    `must_conditions` VARCHAR(300) NOT NULL DEFAULT '',
    `tags` VARCHAR(200) NOT NULL DEFAULT '',
    `email_sync` INTEGER NOT NULL DEFAULT 0,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `contact_wechat` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_email` VARCHAR(120) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `events` JSON NOT NULL,
    `messages` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `logistics_orders_order_no_key`(`order_no`),
    INDEX `logistics_orders_created_by_idx`(`created_by`),
    INDEX `logistics_orders_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `logistics_orders_province_city_idx`(`province`, `city`),
    INDEX `logistics_orders_enterprise_id_id_idx`(`enterprise_id`, `id`),
    INDEX `logistics_orders_staff_user_id_id_idx`(`staff_user_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_name` VARCHAR(200) NOT NULL DEFAULT '',
    `order_type` VARCHAR(24) NOT NULL DEFAULT 'VISIT',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `tags` VARCHAR(200) NOT NULL DEFAULT '',
    `budget` VARCHAR(120) NOT NULL DEFAULT '',
    `expected_result` VARCHAR(300) NOT NULL DEFAULT '',
    `must_conditions` VARCHAR(300) NOT NULL DEFAULT '',
    `expect_start` VARCHAR(32) NOT NULL DEFAULT '',
    `deadline` VARCHAR(32) NOT NULL DEFAULT '',
    `region_scope` VARCHAR(200) NOT NULL DEFAULT '',
    `region_mode` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `contact_wechat` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_email` VARCHAR(120) NOT NULL DEFAULT '',
    `email_sync` INTEGER NOT NULL DEFAULT 0,
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `events` JSON NOT NULL,
    `messages` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `marketing_orders_order_no_key`(`order_no`),
    INDEX `marketing_orders_created_by_idx`(`created_by`),
    INDEX `marketing_orders_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `marketing_orders_province_city_idx`(`province`, `city`),
    INDEX `marketing_orders_enterprise_id_id_idx`(`enterprise_id`, `id`),
    INDEX `marketing_orders_staff_user_id_id_idx`(`staff_user_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `smart_service_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_name` VARCHAR(200) NOT NULL DEFAULT '',
    `service_item` VARCHAR(32) NOT NULL DEFAULT '',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `tags` VARCHAR(200) NOT NULL DEFAULT '',
    `budget` VARCHAR(120) NOT NULL DEFAULT '',
    `expected_result` VARCHAR(300) NOT NULL DEFAULT '',
    `must_conditions` VARCHAR(300) NOT NULL DEFAULT '',
    `expect_start` VARCHAR(32) NOT NULL DEFAULT '',
    `deadline` VARCHAR(32) NOT NULL DEFAULT '',
    `region_scope` VARCHAR(200) NOT NULL DEFAULT '',
    `region_mode` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `contact_wechat` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_email` VARCHAR(120) NOT NULL DEFAULT '',
    `email_sync` INTEGER NOT NULL DEFAULT 0,
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `events` JSON NOT NULL,
    `messages` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `smart_service_orders_order_no_key`(`order_no`),
    INDEX `smart_service_orders_created_by_idx`(`created_by`),
    INDEX `smart_service_orders_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `smart_service_orders_province_city_idx`(`province`, `city`),
    INDEX `smart_service_orders_enterprise_id_id_idx`(`enterprise_id`, `id`),
    INDEX `smart_service_orders_staff_user_id_id_idx`(`staff_user_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `overseas_claims` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `claim_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `service_type` VARCHAR(32) NOT NULL,
    `title` VARCHAR(200) NOT NULL DEFAULT '',
    `amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `country` VARCHAR(64) NOT NULL DEFAULT '',
    `remark` TEXT NOT NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `overseas_claims_claim_no_key`(`claim_no`),
    INDEX `overseas_claims_enterprise_id_idx`(`enterprise_id`),
    INDEX `overseas_claims_provider_user_id_idx`(`provider_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lawyer_resources` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `organization` VARCHAR(200) NOT NULL DEFAULT '',
    `region` VARCHAR(64) NOT NULL DEFAULT '',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `areas` JSON NOT NULL,
    `qualification` VARCHAR(200) NOT NULL DEFAULT '',
    `score` DECIMAL(3, 1) NOT NULL DEFAULT 4.8,
    `license_no` VARCHAR(64) NOT NULL DEFAULT '',
    `intro` TEXT NULL,
    `cases` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `owner_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `audit_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lawyer_resources_kind_status_idx`(`kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legal_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `lawyer_id` INTEGER NOT NULL DEFAULT 0,
    `category` VARCHAR(32) NOT NULL DEFAULT 'CONSULT',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `fields` JSON NOT NULL,
    `region_mode` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `messages` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `legal_requests_request_no_key`(`request_no`),
    INDEX `legal_requests_created_by_idx`(`created_by`),
    INDEX `legal_requests_enterprise_id_idx`(`enterprise_id`),
    INDEX `legal_requests_staff_user_id_idx`(`staff_user_id`),
    INDEX `legal_requests_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `legal_requests_province_city_idx`(`province`, `city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ip_agencies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `organization` VARCHAR(200) NOT NULL DEFAULT '',
    `region` VARCHAR(64) NOT NULL DEFAULT '',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `fields` JSON NOT NULL,
    `qualification` VARCHAR(200) NOT NULL DEFAULT '',
    `license_no` VARCHAR(64) NOT NULL DEFAULT '',
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `note` VARCHAR(300) NOT NULL DEFAULT '',
    `intro` TEXT NULL,
    `agents` JSON NULL,
    `cases` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `owner_type` VARCHAR(16) NOT NULL DEFAULT 'PROVIDER',
    `owner_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `audit_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ip_agencies_kind_status_idx`(`kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ip_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_no` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'BIZ',
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `agency_id` INTEGER NOT NULL DEFAULT 0,
    `agent_name` VARCHAR(64) NOT NULL DEFAULT '',
    `category` VARCHAR(32) NOT NULL DEFAULT 'TRADEMARK',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `fields` JSON NOT NULL,
    `region_mode` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `messages` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ip_requests_request_no_key`(`request_no`),
    INDEX `ip_requests_created_by_idx`(`created_by`),
    INDEX `ip_requests_enterprise_id_idx`(`enterprise_id`),
    INDEX `ip_requests_staff_user_id_idx`(`staff_user_id`),
    INDEX `ip_requests_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `ip_requests_province_city_idx`(`province`, `city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `think_tank_experts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `organization` VARCHAR(200) NOT NULL DEFAULT '',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `areas` JSON NOT NULL,
    `qualification` VARCHAR(200) NOT NULL DEFAULT '',
    `license_no` VARCHAR(64) NOT NULL DEFAULT '',
    `intro` TEXT NULL,
    `cases` JSON NULL,
    `owner_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `think_tank_experts_kind_status_idx`(`kind`, `status`),
    INDEX `think_tank_experts_provider_user_id_idx`(`provider_user_id`),
    INDEX `think_tank_experts_province_city_idx`(`province`, `city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `think_tank_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `category` VARCHAR(32) NOT NULL DEFAULT 'CONSULT',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `fields` JSON NOT NULL,
    `region_mode` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `messages` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `think_tank_requests_request_no_key`(`request_no`),
    INDEX `think_tank_requests_created_by_idx`(`created_by`),
    INDEX `think_tank_requests_enterprise_id_idx`(`enterprise_id`),
    INDEX `think_tank_requests_staff_user_id_idx`(`staff_user_id`),
    INDEX `think_tank_requests_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `think_tank_requests_province_city_idx`(`province`, `city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flex_providers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `record_type` VARCHAR(16) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `organization` VARCHAR(200) NOT NULL DEFAULT '',
    `region` VARCHAR(64) NOT NULL DEFAULT '',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `intro` TEXT NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'COMPANY',
    `fields` JSON NULL,
    `license_no` VARCHAR(64) NOT NULL DEFAULT '',
    `agents` JSON NULL,
    `cases` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `audit_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `flex_providers_record_type_status_idx`(`record_type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flex_onboardings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `onboarding_no` VARCHAR(32) NOT NULL DEFAULT '',
    `contract_id` INTEGER NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `agent_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `form` JSON NOT NULL,
    `attachments` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
    `reject_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `audited_at` DATETIME(3) NULL,

    INDEX `flex_onboardings_enterprise_id_idx`(`enterprise_id`),
    INDEX `flex_onboardings_staff_user_id_idx`(`staff_user_id`),
    INDEX `flex_onboardings_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `flex_onboardings_onboarding_no_idx`(`onboarding_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flex_work_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `agent_name` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `position` VARCHAR(64) NOT NULL DEFAULT '',
    `headcount` INTEGER NOT NULL DEFAULT 1,
    `cycle` VARCHAR(64) NOT NULL DEFAULT '',
    `skills` VARCHAR(200) NOT NULL DEFAULT '',
    `work_type` VARCHAR(16) NOT NULL DEFAULT 'FULLTIME',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `description` TEXT NOT NULL,
    `tags` VARCHAR(200) NOT NULL DEFAULT '',
    `budget` VARCHAR(120) NOT NULL DEFAULT '',
    `expected_result` VARCHAR(300) NOT NULL DEFAULT '',
    `must_conditions` VARCHAR(300) NOT NULL DEFAULT '',
    `expect_start` VARCHAR(32) NOT NULL DEFAULT '',
    `deadline` VARCHAR(32) NOT NULL DEFAULT '',
    `region_scope` VARCHAR(200) NOT NULL DEFAULT '',
    `region_mode` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `email_sync` INTEGER NOT NULL DEFAULT 0,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `contact_wechat` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_email` VARCHAR(120) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `candidates` JSON NOT NULL,
    `settlements` JSON NOT NULL,
    `flex_id` INTEGER NOT NULL DEFAULT 0,
    `messages` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `flex_work_orders_order_no_key`(`order_no`),
    INDEX `flex_work_orders_created_by_idx`(`created_by`),
    INDEX `flex_work_orders_enterprise_id_idx`(`enterprise_id`),
    INDEX `flex_work_orders_staff_user_id_idx`(`staff_user_id`),
    INDEX `flex_work_orders_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `flex_work_orders_province_city_idx`(`province`, `city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flex_payrolls` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payroll_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `agent_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `period` VARCHAR(16) NOT NULL DEFAULT '',
    `employees` JSON NOT NULL,
    `total_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `reject_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `audited_at` DATETIME(3) NULL,

    UNIQUE INDEX `flex_payrolls_payroll_no_key`(`payroll_no`),
    INDEX `flex_payrolls_enterprise_id_idx`(`enterprise_id`),
    INDEX `flex_payrolls_provider_user_id_status_idx`(`provider_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `broker_name` VARCHAR(200) NOT NULL DEFAULT '',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `tags` VARCHAR(200) NOT NULL DEFAULT '',
    `budget` VARCHAR(120) NOT NULL DEFAULT '',
    `expected_result` VARCHAR(300) NOT NULL DEFAULT '',
    `must_conditions` VARCHAR(300) NOT NULL DEFAULT '',
    `expect_start` VARCHAR(32) NOT NULL DEFAULT '',
    `deadline` VARCHAR(32) NOT NULL DEFAULT '',
    `region_scope` VARCHAR(200) NOT NULL DEFAULT '',
    `region_mode` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `email_sync` INTEGER NOT NULL DEFAULT 0,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `contact_wechat` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_email` VARCHAR(120) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `events` JSON NOT NULL,
    `messages` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `asset_requests_request_no_key`(`request_no`),
    INDEX `asset_requests_created_by_idx`(`created_by`),
    INDEX `asset_requests_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `asset_requests_province_city_idx`(`province`, `city`),
    INDEX `asset_requests_enterprise_id_id_idx`(`enterprise_id`, `id`),
    INDEX `asset_requests_staff_user_id_id_idx`(`staff_user_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_service_listings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `service_no` VARCHAR(32) NOT NULL,
    `domain` VARCHAR(16) NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `sub_category_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `tags` VARCHAR(300) NOT NULL DEFAULT '',
    `money_mode` VARCHAR(16) NOT NULL DEFAULT 'NEGOTIABLE',
    `currency` VARCHAR(16) NOT NULL DEFAULT 'AWCOIN',
    `amount_min` INTEGER NOT NULL DEFAULT 0,
    `amount_max` INTEGER NOT NULL DEFAULT 0,
    `unit_label` VARCHAR(32) NOT NULL DEFAULT '',
    `price_description` VARCHAR(300) NOT NULL DEFAULT '',
    `service_area_mode` VARCHAR(16) NOT NULL DEFAULT 'NATIONWIDE',
    `province` VARCHAR(48) NOT NULL DEFAULT '',
    `city` VARCHAR(48) NOT NULL DEFAULT '',
    `longitude` DOUBLE NULL,
    `latitude` DOUBLE NULL,
    `radius_km` DOUBLE NULL,
    `delivery_mode` VARCHAR(16) NOT NULL DEFAULT '',
    `response_time` VARCHAR(64) NOT NULL DEFAULT '',
    `qualifications` VARCHAR(300) NOT NULL DEFAULT '',
    `highlights` TEXT NOT NULL,
    `cases` TEXT NOT NULL,
    `reference_links` TEXT NOT NULL,
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `contact_wechat` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_email` VARCHAR(120) NOT NULL DEFAULT '',
    `credential_types` VARCHAR(300) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `aiworkin_published` INTEGER NOT NULL DEFAULT 0,
    `platform_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platform_match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `aiworkin_sync_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `provider_service_listings_service_no_key`(`service_no`),
    INDEX `provider_service_listings_provider_user_id_domain_idx`(`provider_user_id`, `domain`),
    INDEX `provider_service_listings_domain_status_idx`(`domain`, `status`),
    INDEX `provider_service_listings_province_city_idx`(`province`, `city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_declarations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `decl_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `material_id` INTEGER NOT NULL DEFAULT 0,
    `tax_type` VARCHAR(32) NOT NULL,
    `period` VARCHAR(16) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL DEFAULT '',
    `form_data` JSON NOT NULL,
    `tax_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `ai_steps` JSON NOT NULL,
    `advisor_confirms` JSON NOT NULL,
    `qc_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `qc_note` VARCHAR(500) NOT NULL DEFAULT '',
    `receipt_no` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tax_declarations_decl_no_key`(`decl_no`),
    INDEX `tax_declarations_enterprise_id_idx`(`enterprise_id`),
    INDEX `tax_declarations_staff_user_id_idx`(`staff_user_id`),
    INDEX `tax_declarations_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `tax_declarations_material_id_idx`(`material_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_material_packs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pack_no` VARCHAR(32) NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL DEFAULT '',
    `period` VARCHAR(16) NOT NULL DEFAULT '',
    `payload` JSON NOT NULL,
    `files` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `submitted_at` DATETIME(3) NULL,
    `analyzed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tax_material_packs_pack_no_key`(`pack_no`),
    UNIQUE INDEX `tax_material_packs_enterprise_id_period_key`(`enterprise_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `account_set_id` INTEGER NOT NULL DEFAULT 0,
    `tax_type` VARCHAR(32) NOT NULL,
    `period` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DUE',
    `declaration_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tax_plans_provider_user_id_period_id_idx`(`provider_user_id`, `period`, `id`),
    INDEX `tax_plans_staff_user_id_period_id_idx`(`staff_user_id`, `period`, `id`),
    INDEX `tax_plans_account_set_id_period_id_idx`(`account_set_id`, `period`, `id`),
    UNIQUE INDEX `tax_plans_enterprise_id_tax_type_period_key`(`enterprise_id`, `tax_type`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `snapshot` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_sets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consultations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contract_id` INTEGER NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `question` TEXT NOT NULL,
    `answer` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_capabilities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enterprise_id` INTEGER NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',
    `note` VARCHAR(300) NOT NULL DEFAULT '',
    `requested_by` VARCHAR(64) NOT NULL DEFAULT '',
    `opened_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `enterprise_capabilities_enterprise_id_code_key`(`enterprise_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_directory` (
    `user_id` VARCHAR(64) NOT NULL,
    `username` VARCHAR(120) NOT NULL DEFAULT '',
    `display_name` VARCHAR(120) NOT NULL DEFAULT '',
    `email` VARCHAR(160) NOT NULL DEFAULT '',
    `avatar_url` VARCHAR(300) NOT NULL DEFAULT '',
    `role` VARCHAR(32) NOT NULL DEFAULT '',
    `enabled` INTEGER NOT NULL DEFAULT 1,
    `synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_channels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `biz_type` VARCHAR(16) NOT NULL,
    `enabled` INTEGER NOT NULL DEFAULT 1,
    `config` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `external_channels_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_credentials` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enterprise_id` INTEGER NOT NULL,
    `channel_code` VARCHAR(32) NOT NULL,
    `cred_type` VARCHAR(24) NOT NULL,
    `label` VARCHAR(120) NOT NULL DEFAULT '',
    `secret_cipher` TEXT NOT NULL,
    `extra` JSON NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `external_credentials_enterprise_id_channel_code_cred_type_la_key`(`enterprise_id`, `channel_code`, `cred_type`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_submissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `biz_type` VARCHAR(16) NOT NULL,
    `ref_type` VARCHAR(32) NOT NULL,
    `ref_id` INTEGER NOT NULL,
    `ref_no` VARCHAR(32) NOT NULL DEFAULT '',
    `enterprise_id` INTEGER NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `channel_code` VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    `period` VARCHAR(16) NOT NULL DEFAULT '',
    `tax_type` VARCHAR(32) NOT NULL DEFAULT '',
    `target_system` VARCHAR(120) NOT NULL DEFAULT '',
    `payload` JSON NOT NULL,
    `payload_hash` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    `accept_no` VARCHAR(64) NOT NULL DEFAULT '',
    `receipt_no` VARCHAR(64) NOT NULL DEFAULT '',
    `error_code` VARCHAR(32) NOT NULL DEFAULT '',
    `error_msg` VARCHAR(500) NOT NULL DEFAULT '',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `guide` JSON NOT NULL,
    `timeline` JSON NOT NULL,
    `submitted_by` VARCHAR(64) NOT NULL DEFAULT '',
    `submitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `external_submissions_enterprise_id_status_idx`(`enterprise_id`, `status`),
    INDEX `external_submissions_staff_user_id_status_idx`(`staff_user_id`, `status`),
    UNIQUE INDEX `external_submissions_ref_type_ref_id_period_key`(`ref_type`, `ref_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_callbacks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `submission_id` INTEGER NOT NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    `rawBody` TEXT NOT NULL,
    `signature_valid` INTEGER NOT NULL DEFAULT 0,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `external_callbacks_submission_id_idx`(`submission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `req_no` VARCHAR(32) NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `enterprise_name` VARCHAR(200) NOT NULL DEFAULT '',
    `requested_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `invoice_type` VARCHAR(8) NOT NULL DEFAULT '04',
    `buyer_type` VARCHAR(8) NOT NULL DEFAULT '1',
    `buyer_name` VARCHAR(200) NOT NULL DEFAULT '',
    `buyer_tax_no` VARCHAR(64) NOT NULL DEFAULT '',
    `order_no` VARCHAR(64) NOT NULL DEFAULT '',
    `remark` VARCHAR(500) NOT NULL DEFAULT '',
    `items` JSON NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `tax` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',
    `reviewed_by` VARCHAR(64) NOT NULL DEFAULT '',
    `reviewed_at` DATETIME(3) NULL,
    `reject_reason` VARCHAR(500) NOT NULL DEFAULT '',
    `issue_code` VARCHAR(64) NOT NULL DEFAULT '',
    `issue_message` VARCHAR(500) NOT NULL DEFAULT '',
    `issue_task_id` VARCHAR(191) NOT NULL DEFAULT '',
    `issued_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoice_requests_req_no_key`(`req_no`),
    INDEX `invoice_requests_enterprise_id_status_idx`(`enterprise_id`, `status`),
    INDEX `invoice_requests_staff_user_id_status_idx`(`staff_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_stations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `region` VARCHAR(64) NOT NULL DEFAULT '',
    `address` VARCHAR(300) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `remark` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `supply_stations_provider_user_id_status_idx`(`provider_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` VARCHAR(64) NOT NULL DEFAULT '',
    `base_price` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `unit` VARCHAR(16) NOT NULL DEFAULT '件',
    `attrs` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    `marketing_title` VARCHAR(200) NOT NULL DEFAULT '',
    `marketing_summary` VARCHAR(500) NOT NULL DEFAULT '',
    `marketing_content` TEXT NOT NULL,
    `cover_url` VARCHAR(500) NOT NULL DEFAULT '',
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `aiworkin_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'SKIPPED',
    `aiworkin_sync_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `supply_products_provider_user_id_status_idx`(`provider_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_product_stations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER NOT NULL,
    `station_id` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `supply_product_stations_station_id_status_idx`(`station_id`, `status`),
    UNIQUE INDEX `supply_product_stations_product_id_station_id_key`(`product_id`, `station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_skus` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER NOT NULL,
    `spec_name` VARCHAR(120) NOT NULL,
    `supply_price` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `unit` VARCHAR(16) NOT NULL DEFAULT '件',
    `scene` VARCHAR(200) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `supply_skus_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_services` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `station_id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `price_unit` VARCHAR(16) NOT NULL DEFAULT '次',
    `base_price` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `intro` TEXT NOT NULL,
    `scene` VARCHAR(200) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    `marketing_title` VARCHAR(200) NOT NULL DEFAULT '',
    `marketing_summary` VARCHAR(500) NOT NULL DEFAULT '',
    `marketing_content` TEXT NOT NULL,
    `cover_url` VARCHAR(500) NOT NULL DEFAULT '',
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `aiworkin_listing_id` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_sync_status` VARCHAR(16) NOT NULL DEFAULT 'SKIPPED',
    `aiworkin_sync_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `supply_services_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `supply_services_station_id_status_idx`(`station_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `enterprise_name` VARCHAR(200) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `station_id` INTEGER NOT NULL,
    `station_name` VARCHAR(120) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `expected_date` VARCHAR(16) NOT NULL,
    `remark` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `quoted_at` DATETIME(3) NULL,
    `promised_ship_date` VARCHAR(16) NOT NULL DEFAULT '',
    `quote_note` VARCHAR(500) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `product_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `other_fees` JSON NOT NULL,
    `fee_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `confirm_note` VARCHAR(500) NOT NULL DEFAULT '',
    `confirmed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `supply_orders_order_no_key`(`order_no`),
    INDEX `supply_orders_enterprise_id_status_idx`(`enterprise_id`, `status`),
    INDEX `supply_orders_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `supply_orders_staff_user_id_status_idx`(`staff_user_id`, `status`),
    INDEX `supply_orders_station_id_status_idx`(`station_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL,
    `sku_id` INTEGER NOT NULL DEFAULT 0,
    `product_name` VARCHAR(200) NOT NULL,
    `spec_name` VARCHAR(120) NOT NULL DEFAULT '',
    `unit` VARCHAR(16) NOT NULL DEFAULT '件',
    `price` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `quantity` DECIMAL(14, 2) NOT NULL DEFAULT 1,
    `amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `stock_state` VARCHAR(16) NOT NULL DEFAULT 'SUFFICIENT',
    `shortage_note` VARCHAR(300) NOT NULL DEFAULT '',
    `restock_cycle` VARCHAR(100) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `supply_order_items_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_bookings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `booking_no` VARCHAR(32) NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `enterprise_name` VARCHAR(200) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL,
    `provider_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `station_id` INTEGER NOT NULL,
    `station_name` VARCHAR(120) NOT NULL DEFAULT '',
    `service_id` INTEGER NOT NULL,
    `service_name` VARCHAR(200) NOT NULL DEFAULT '',
    `price_unit` VARCHAR(16) NOT NULL DEFAULT '',
    `contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `plan_date` VARCHAR(16) NOT NULL,
    `site_address` VARCHAR(300) NOT NULL,
    `scale` VARCHAR(120) NOT NULL DEFAULT '',
    `remark` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `quoted_at` DATETIME(3) NULL,
    `base_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `other_fees` JSON NOT NULL,
    `fee_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `quote_note` VARCHAR(500) NOT NULL DEFAULT '',
    `provider_contact_name` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_contact_phone` VARCHAR(32) NOT NULL DEFAULT '',
    `confirm_note` VARCHAR(500) NOT NULL DEFAULT '',
    `confirmed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `supply_bookings_booking_no_key`(`booking_no`),
    INDEX `supply_bookings_enterprise_id_status_idx`(`enterprise_id`, `status`),
    INDEX `supply_bookings_provider_user_id_status_idx`(`provider_user_id`, `status`),
    INDEX `supply_bookings_staff_user_id_status_idx`(`staff_user_id`, `status`),
    INDEX `supply_bookings_station_id_status_idx`(`station_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supply_order_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `biz_type` VARCHAR(16) NOT NULL,
    `biz_id` INTEGER NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `operator_user_id` VARCHAR(64) NOT NULL,
    `operator_name` VARCHAR(64) NOT NULL DEFAULT '',
    `detail` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `supply_order_logs_biz_type_biz_id_idx`(`biz_type`, `biz_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geo_projects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `enterprise_id` INTEGER NOT NULL DEFAULT 0,
    `enterprise_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `brand` VARCHAR(120) NOT NULL,
    `brand_aliases` VARCHAR(300) NOT NULL DEFAULT '',
    `industry` VARCHAR(120) NOT NULL DEFAULT '',
    `competitors` JSON NOT NULL,
    `platforms` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `auto_collect` INTEGER NOT NULL DEFAULT 0,
    `auto_collect_by` VARCHAR(64) NOT NULL DEFAULT '',
    `auto_collect_at` DATETIME(3) NULL,
    `note` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `geo_projects_owner_user_id_idx`(`owner_user_id`),
    INDEX `geo_projects_enterprise_id_idx`(`enterprise_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geo_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `seq` VARCHAR(16) NOT NULL DEFAULT '',
    `text` TEXT NOT NULL,
    `type` VARCHAR(32) NOT NULL DEFAULT '品类词',
    `scenario` VARCHAR(300) NOT NULL DEFAULT '',
    `expected_answer_form` VARCHAR(200) NOT NULL DEFAULT '',
    `priority` VARCHAR(8) NOT NULL DEFAULT 'P1',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `geo_questions_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geo_batches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `period_label` VARCHAR(64) NOT NULL,
    `channel` VARCHAR(8) NOT NULL DEFAULT 'A',
    `data_nature` VARCHAR(16) NOT NULL DEFAULT 'simulated',
    `platforms` JSON NOT NULL,
    `note` TEXT NOT NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `geo_batches_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geo_observations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `batch_id` INTEGER NOT NULL,
    `question_id` INTEGER NOT NULL,
    `platform` VARCHAR(32) NOT NULL,
    `brand_mentioned` INTEGER NOT NULL DEFAULT 0,
    `rank_position` INTEGER NULL,
    `sentiment` VARCHAR(16) NOT NULL DEFAULT '未提及',
    `citation_genre` VARCHAR(16) NOT NULL DEFAULT '无',
    `citation_domains` VARCHAR(500) NOT NULL DEFAULT '',
    `model_version` VARCHAR(64) NOT NULL DEFAULT '',
    `answer_excerpt` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `geo_observations_batch_id_idx`(`batch_id`),
    INDEX `geo_observations_question_id_idx`(`question_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geo_topics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `gap_type` VARCHAR(32) NOT NULL DEFAULT '引用真空点',
    `question_id` INTEGER NOT NULL DEFAULT 0,
    `platform_count` INTEGER NOT NULL DEFAULT 0,
    `gap_score` INTEGER NOT NULL DEFAULT 0,
    `citable_score` INTEGER NOT NULL DEFAULT 0,
    `business_score` INTEGER NOT NULL DEFAULT 0,
    `supply_score` INTEGER NOT NULL DEFAULT 0,
    `style_bonus` INTEGER NOT NULL DEFAULT 0,
    `total_score` DOUBLE NOT NULL DEFAULT 0,
    `blacklisted` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'CANDIDATE',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `geo_topics_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geo_provider_settings` (
    `user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `base_url` VARCHAR(255) NOT NULL DEFAULT '',
    `key_cipher` TEXT NULL,
    `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `geo_provider_settings_user_id_idx`(`user_id`),
    PRIMARY KEY (`user_id`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geo_collect_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `week_start` DATETIME(3) NOT NULL,
    `period_label` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `planned` INTEGER NOT NULL DEFAULT 0,
    `done` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `batch_id` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `window_start` DATETIME(3) NULL,
    `window_end` DATETIME(3) NULL,
    `claimed_by` VARCHAR(64) NOT NULL DEFAULT '',
    `heartbeat_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `geo_collect_runs_status_idx`(`status`),
    INDEX `geo_collect_runs_week_start_idx`(`week_start`),
    UNIQUE INDEX `geo_collect_runs_project_id_week_start_key`(`project_id`, `week_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geo_collect_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `project_id` INTEGER NOT NULL,
    `question_id` INTEGER NOT NULL,
    `platform` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `observation_id` INTEGER NOT NULL DEFAULT 0,
    `model_version` VARCHAR(64) NOT NULL DEFAULT '',
    `raw_answer` TEXT NULL,
    `answered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `geo_collect_items_run_id_status_idx`(`run_id`, `status`),
    UNIQUE INDEX `geo_collect_items_run_id_question_id_platform_key`(`run_id`, `question_id`, `platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_counters` (
    `key` VARCHAR(32) NOT NULL,
    `value` INTEGER NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_tables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `project_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `data_tables_created_by_idx`(`created_by`),
    INDEX `data_tables_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_table_grants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `table_id` INTEGER NOT NULL,
    `grantee_user_id` VARCHAR(64) NOT NULL,
    `can_read` BOOLEAN NOT NULL DEFAULT false,
    `can_create` BOOLEAN NOT NULL DEFAULT false,
    `can_update` BOOLEAN NOT NULL DEFAULT false,
    `can_delete` BOOLEAN NOT NULL DEFAULT false,
    `granted_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `data_table_grants_grantee_user_id_idx`(`grantee_user_id`),
    UNIQUE INDEX `data_table_grants_table_id_grantee_user_id_key`(`table_id`, `grantee_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_table_fields` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `table_id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `field_key` VARCHAR(64) NOT NULL,
    `field_type` VARCHAR(16) NOT NULL DEFAULT 'text',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `options` JSON NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `data_table_fields_table_id_sort_order_idx`(`table_id`, `sort_order`),
    UNIQUE INDEX `data_table_fields_table_id_field_key_key`(`table_id`, `field_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_table_rows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `table_id` INTEGER NOT NULL,
    `data` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `data_table_rows_table_id_created_at_idx`(`table_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_table_feishu_syncs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `table_id` INTEGER NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `direction` VARCHAR(16) NOT NULL DEFAULT 'both',
    `app_id` VARCHAR(128) NOT NULL,
    `app_secret_cipher` TEXT NOT NULL,
    `app_token` VARCHAR(191) NOT NULL,
    `feishu_table_id` VARCHAR(191) NOT NULL,
    `verification_token` VARCHAR(191) NOT NULL DEFAULT '',
    `encrypt_key_cipher` TEXT NOT NULL,
    `field_mapping` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `webhook_token` VARCHAR(64) NOT NULL,
    `last_sync_at` DATETIME(3) NULL,
    `last_error` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `data_table_feishu_syncs_webhook_token_key`(`webhook_token`),
    INDEX `data_table_feishu_syncs_table_id_idx`(`table_id`),
    INDEX `data_table_feishu_syncs_app_token_feishu_table_id_idx`(`app_token`, `feishu_table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_table_feishu_row_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sync_id` INTEGER NOT NULL,
    `local_row_id` INTEGER NOT NULL,
    `feishu_record_id` VARCHAR(191) NOT NULL,
    `local_updated_at` DATETIME(3) NULL,
    `feishu_updated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `data_table_feishu_row_links_sync_id_idx`(`sync_id`),
    UNIQUE INDEX `data_table_feishu_row_links_sync_id_local_row_id_key`(`sync_id`, `local_row_id`),
    UNIQUE INDEX `data_table_feishu_row_links_sync_id_feishu_record_id_key`(`sync_id`, `feishu_record_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_table_feishu_sync_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sync_id` INTEGER NOT NULL,
    `trigger` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `stats` JSON NOT NULL,
    `message` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `data_table_feishu_sync_logs_sync_id_created_at_idx`(`sync_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rpa_scripts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `category` VARCHAR(64) NOT NULL DEFAULT '',
    `tags` JSON NOT NULL,
    `device_type` VARCHAR(16) NOT NULL DEFAULT 'pc',
    `file_type` VARCHAR(24) NOT NULL DEFAULT 'automa_json',
    `vendor_flow_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `content` TEXT NOT NULL,
    `params_schema` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rpa_scripts_created_by_file_type_idx`(`created_by`, `file_type`),
    INDEX `rpa_scripts_created_by_status_idx`(`created_by`, `status`),
    INDEX `rpa_scripts_created_by_device_type_status_idx`(`created_by`, `device_type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rpa_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `platform` VARCHAR(500) NOT NULL,
    `group_id` VARCHAR(128) NOT NULL DEFAULT '',
    `nickname` VARCHAR(128) NOT NULL DEFAULT '',
    `username` VARCHAR(191) NOT NULL,
    `key_cipher` TEXT NOT NULL,
    `login_url` VARCHAR(500) NOT NULL DEFAULT '',
    `env_type` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `proxy_method` INTEGER NOT NULL DEFAULT 2,
    `proxy_type` VARCHAR(16) NOT NULL DEFAULT 'noproxy',
    `proxy_host` VARCHAR(255) NOT NULL DEFAULT '',
    `proxy_port` INTEGER NOT NULL DEFAULT 0,
    `proxy_user_name` VARCHAR(200) NOT NULL DEFAULT '',
    `proxy_password_cipher` TEXT NOT NULL,
    `notes` VARCHAR(500) NOT NULL DEFAULT '',
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rpa_accounts_created_by_status_idx`(`created_by`, `status`),
    INDEX `rpa_accounts_created_by_platform_idx`(`created_by`, `platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rpa_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `script_id` INTEGER NOT NULL,
    `device_type` VARCHAR(16) NOT NULL DEFAULT 'pc',
    `account_ids` JSON NOT NULL,
    `params` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `schedule_type` VARCHAR(16) NOT NULL DEFAULT 'once',
    `schedule_config` JSON NOT NULL,
    `phone_finish_action` VARCHAR(16) NOT NULL DEFAULT 'keep',
    `scheduled_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `last_run_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `max_retries` INTEGER NOT NULL DEFAULT 0,
    `timeout_seconds` INTEGER NOT NULL DEFAULT 3600,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rpa_tasks_created_by_status_idx`(`created_by`, `status`),
    INDEX `rpa_tasks_created_by_device_type_status_idx`(`created_by`, `device_type`, `status`),
    INDEX `rpa_tasks_script_id_idx`(`script_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rpa_task_executions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `device_type` VARCHAR(16) NOT NULL DEFAULT 'pc',
    `status` VARCHAR(16) NOT NULL DEFAULT 'running',
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `executor` VARCHAR(64) NOT NULL DEFAULT '',
    `browser_profile_id` VARCHAR(64) NOT NULL DEFAULT '',
    `cloud_phone_id` VARCHAR(64) NOT NULL DEFAULT '',
    `output` JSON NOT NULL,
    `error_message` VARCHAR(500) NOT NULL DEFAULT '',
    `log_text` TEXT NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `duration_ms` INTEGER NULL,

    INDEX `rpa_task_executions_task_id_started_at_idx`(`task_id`, `started_at`),
    INDEX `rpa_task_executions_created_by_status_idx`(`created_by`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rpa_llm_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `key_cipher` TEXT NULL,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rpa_llm_settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rpa_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `bitbrowser_api_endpoint` VARCHAR(500) NOT NULL DEFAULT 'http://127.0.0.1:54345',
    `bitbrowser_api_key_cipher` TEXT NOT NULL,
    `bitbrowser_group_id` VARCHAR(128) NOT NULL DEFAULT '',
    `bitphone_region_id` VARCHAR(64) NOT NULL DEFAULT '',
    `bitphone_compute_type` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rpa_settings_created_by_key`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workbuddy_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `secret_id_cipher` TEXT NOT NULL,
    `secret_key_cipher` TEXT NOT NULL,
    `region` VARCHAR(32) NOT NULL DEFAULT 'ap-guangzhou',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `last_verified_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `notes` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workbuddy_accounts_created_by_status_idx`(`created_by`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workbuddy_llm_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `key_cipher` TEXT NULL,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `workbuddy_llm_settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workbuddy_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'ai',
    `title` VARCHAR(200) NOT NULL,
    `raw_input` TEXT NOT NULL,
    `spec` JSON NOT NULL,
    `task_count` INTEGER NOT NULL DEFAULT 0,
    `strategy` VARCHAR(16) NOT NULL DEFAULT 'single',
    `account_ids` JSON NOT NULL,
    `schedule_type` VARCHAR(16) NOT NULL DEFAULT 'once',
    `schedule_config` JSON NOT NULL,
    `scheduled_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `summary` TEXT NOT NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workbuddy_plans_created_by_status_idx`(`created_by`, `status`),
    INDEX `workbuddy_plans_created_by_kind_idx`(`created_by`, `kind`),
    INDEX `workbuddy_plans_kind_schedule_type_scheduled_at_idx`(`kind`, `schedule_type`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workbuddy_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `plan_id` INTEGER NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'ai',
    `seq` INTEGER NOT NULL DEFAULT 1,
    `account_id` INTEGER NOT NULL,
    `agent_id` VARCHAR(64) NOT NULL DEFAULT '',
    `version_id` VARCHAR(64) NOT NULL DEFAULT '',
    `session_id` VARCHAR(128) NOT NULL DEFAULT '',
    `endpoint` VARCHAR(500) NOT NULL DEFAULT '',
    `instruction` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `last_event_seq` INTEGER NOT NULL DEFAULT 0,
    `output` JSON NOT NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workbuddy_tasks_plan_id_idx`(`plan_id`),
    INDEX `workbuddy_tasks_created_by_status_idx`(`created_by`, `status`),
    INDEX `workbuddy_tasks_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workbuddy_task_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `event_type` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `tool_name` VARCHAR(128) NOT NULL DEFAULT '',
    `tool_input` TEXT NOT NULL,
    `tool_output` TEXT NOT NULL,
    `token_usage` JSON NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `workbuddy_task_events_task_id_seq_key`(`task_id`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_call_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `platform` VARCHAR(191) NOT NULL,
    `login_url` VARCHAR(500) NOT NULL DEFAULT '',
    `username` VARCHAR(191) NOT NULL DEFAULT '',
    `password_cipher` TEXT NOT NULL,
    `api_key_cipher` TEXT NOT NULL,
    `cookie_cipher` TEXT NOT NULL,
    `extra` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `notes` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_call_accounts_created_by_status_idx`(`created_by`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_call_account_bindings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `workbuddy_account_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_call_account_bindings_workbuddy_account_id_idx`(`workbuddy_account_id`),
    UNIQUE INDEX `ai_call_account_bindings_account_id_workbuddy_account_id_key`(`account_id`, `workbuddy_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_prospecting_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `serper_key_cipher` TEXT NOT NULL,
    `data_table_id` INTEGER NOT NULL DEFAULT 0,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `lead_prospecting_settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_prospecting_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `spec` JSON NOT NULL,
    `raw_intent` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `total_found` INTEGER NOT NULL DEFAULT 0,
    `total_saved` INTEGER NOT NULL DEFAULT 0,
    `total_skipped` INTEGER NOT NULL DEFAULT 0,
    `data_table_id` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `lead_prospecting_tasks_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `lead_prospecting_tasks_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_prospecting_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `task_id` INTEGER NOT NULL DEFAULT 0,
    `role` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_prospecting_messages_user_id_task_id_created_at_idx`(`user_id`, `task_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bigdata_query_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `dataset` VARCHAR(32) NOT NULL,
    `data_table_id` INTEGER NOT NULL DEFAULT 0,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bigdata_query_settings_user_id_dataset_key`(`user_id`, `dataset`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bigdata_query_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `dataset` VARCHAR(32) NOT NULL,
    `spec` JSON NOT NULL,
    `raw_intent` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `total_found` INTEGER NOT NULL DEFAULT 0,
    `total_saved` INTEGER NOT NULL DEFAULT 0,
    `total_skipped` INTEGER NOT NULL DEFAULT 0,
    `data_table_id` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bigdata_query_tasks_user_id_dataset_created_at_idx`(`user_id`, `dataset`, `created_at`),
    INDEX `bigdata_query_tasks_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bigdata_query_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `dataset` VARCHAR(32) NOT NULL,
    `task_id` INTEGER NOT NULL DEFAULT 0,
    `role` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bigdata_query_messages_user_id_dataset_task_id_created_at_idx`(`user_id`, `dataset`, `task_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aliyun_call_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `access_key_id` VARCHAR(128) NOT NULL DEFAULT '',
    `access_key_secret_cipher` TEXT NOT NULL,
    `region` VARCHAR(32) NOT NULL DEFAULT 'cn-shanghai',
    `instance_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `aliyun_call_settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aliyun_call_imports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `mode` VARCHAR(16) NOT NULL,
    `table_id` INTEGER NOT NULL,
    `table_name` VARCHAR(191) NOT NULL DEFAULT '',
    `mapping_json` JSON NOT NULL,
    `instance_id` VARCHAR(64) NOT NULL,
    `script_id` VARCHAR(64) NOT NULL DEFAULT '',
    `job_group_id` VARCHAR(64) NOT NULL DEFAULT '',
    `job_group_name` VARCHAR(191) NOT NULL DEFAULT '',
    `strategy_json` JSON NULL,
    `calling_numbers` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `sent_rows` INTEGER NOT NULL DEFAULT 0,
    `failed_rows` INTEGER NOT NULL DEFAULT 0,
    `skipped_rows` INTEGER NOT NULL DEFAULT 0,
    `error_code` VARCHAR(64) NOT NULL DEFAULT '',
    `error_message` TEXT NOT NULL,
    `job_group_status` VARCHAR(32) NOT NULL DEFAULT '',
    `synced_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `aliyun_call_imports_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `aliyun_call_imports_user_id_job_group_id_idx`(`user_id`, `job_group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aliyun_call_import_rows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `import_id` INTEGER NOT NULL,
    `source_row_id` INTEGER NOT NULL DEFAULT 0,
    `reference_id` VARCHAR(128) NOT NULL DEFAULT '',
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `phone_masked` VARCHAR(32) NOT NULL DEFAULT '',
    `phone_hash` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `job_id` VARCHAR(64) NOT NULL DEFAULT '',
    `error_code` VARCHAR(64) NOT NULL DEFAULT '',
    `error_message` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `aliyun_call_import_rows_import_id_status_idx`(`import_id`, `status`),
    INDEX `aliyun_call_import_rows_phone_hash_idx`(`phone_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aliyun_mail_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `access_key_id` VARCHAR(128) NOT NULL DEFAULT '',
    `access_key_secret_cipher` TEXT NOT NULL,
    `region` VARCHAR(32) NOT NULL DEFAULT 'cn-hangzhou',
    `default_receiver_id` VARCHAR(64) NOT NULL DEFAULT '',
    `default_receiver_name` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `aliyun_mail_settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aliyun_mail_imports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `mode` VARCHAR(16) NOT NULL,
    `table_id` INTEGER NOT NULL,
    `table_name` VARCHAR(191) NOT NULL DEFAULT '',
    `mapping_json` JSON NOT NULL,
    `receiver_id` VARCHAR(64) NOT NULL DEFAULT '',
    `receiver_name` VARCHAR(191) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `sent_rows` INTEGER NOT NULL DEFAULT 0,
    `failed_rows` INTEGER NOT NULL DEFAULT 0,
    `skipped_rows` INTEGER NOT NULL DEFAULT 0,
    `error_code` VARCHAR(64) NOT NULL DEFAULT '',
    `error_message` TEXT NOT NULL,
    `list_count` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `aliyun_mail_imports_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `aliyun_mail_imports_user_id_receiver_id_idx`(`user_id`, `receiver_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aliyun_mail_import_rows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `import_id` INTEGER NOT NULL,
    `source_row_id` INTEGER NOT NULL DEFAULT 0,
    `email_masked` VARCHAR(191) NOT NULL DEFAULT '',
    `email_hash` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `error_code` VARCHAR(64) NOT NULL DEFAULT '',
    `error_message` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `aliyun_mail_import_rows_import_id_status_idx`(`import_id`, `status`),
    INDEX `aliyun_mail_import_rows_email_hash_idx`(`email_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aliyun_mail_contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `receiver_id` VARCHAR(64) NOT NULL,
    `email_hash` VARCHAR(64) NOT NULL,
    `last_import_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `aliyun_mail_contacts_last_import_id_idx`(`last_import_id`),
    UNIQUE INDEX `aliyun_mail_contacts_user_id_receiver_id_email_hash_key`(`user_id`, `receiver_id`, `email_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tp_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `product` VARCHAR(16) NOT NULL,
    `label` VARCHAR(191) NOT NULL DEFAULT '',
    `gateway` VARCHAR(191) NOT NULL DEFAULT 'https://tmc.qidian.qq.com',
    `corporation_id` VARCHAR(64) NOT NULL,
    `secret_id` VARCHAR(128) NOT NULL DEFAULT '',
    `secret_key_cipher` TEXT NOT NULL,
    `biz_id` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `last_verified_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tp_accounts_user_id_product_idx`(`user_id`, `product`),
    UNIQUE INDEX `tp_accounts_user_id_product_corporation_id_biz_id_key`(`user_id`, `product`, `corporation_id`, `biz_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tp_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `account_id` INTEGER NOT NULL DEFAULT 0,
    `product` VARCHAR(16) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `table_id` INTEGER NOT NULL DEFAULT 0,
    `table_name` VARCHAR(191) NOT NULL DEFAULT '',
    `mapping_json` JSON NOT NULL,
    `params` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `upstream_task_id` VARCHAR(128) NOT NULL DEFAULT '',
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `success_rows` INTEGER NOT NULL DEFAULT 0,
    `failed_rows` INTEGER NOT NULL DEFAULT 0,
    `skipped_rows` INTEGER NOT NULL DEFAULT 0,
    `error_code` VARCHAR(64) NOT NULL DEFAULT '',
    `error_message` VARCHAR(500) NOT NULL DEFAULT '',
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tp_tasks_user_id_product_created_at_idx`(`user_id`, `product`, `created_at`),
    INDEX `tp_tasks_user_id_status_idx`(`user_id`, `status`),
    INDEX `tp_tasks_upstream_task_id_idx`(`upstream_task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tp_task_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `level` VARCHAR(16) NOT NULL DEFAULT 'info',
    `message` VARCHAR(500) NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tp_task_events_task_id_id_idx`(`task_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tp_mappings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `dataset_key` VARCHAR(64) NOT NULL,
    `table_id` INTEGER NOT NULL,
    `table_name` VARCHAR(191) NOT NULL DEFAULT '',
    `column_map` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tp_mappings_user_id_dataset_key_table_id_key`(`user_id`, `dataset_key`, `table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_memory_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `domain` VARCHAR(32) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(32) NOT NULL DEFAULT '',
    `target_id` VARCHAR(64) NOT NULL DEFAULT '',
    `target_label` VARCHAR(200) NOT NULL DEFAULT '',
    `params` JSON NOT NULL,
    `outcome` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `error_code` VARCHAR(64) NOT NULL DEFAULT '',
    `error_message` VARCHAR(500) NOT NULL DEFAULT '',
    `channel` VARCHAR(16) NOT NULL DEFAULT 'web',
    `audit_log_id` INTEGER NOT NULL DEFAULT 0,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_memory_events_user_id_occurred_at_idx`(`user_id`, `occurred_at`),
    INDEX `agent_memory_events_user_id_action_occurred_at_idx`(`user_id`, `action`, `occurred_at`),
    INDEX `agent_memory_events_audit_log_id_idx`(`audit_log_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_memory_candidates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `payload` JSON NOT NULL,
    `source_event_ids` JSON NOT NULL,
    `evidence` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'candidate',
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_memory_candidates_user_id_status_created_at_idx`(`user_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `value` JSON NOT NULL,
    `source_event_ids` JSON NOT NULL,
    `hits` INTEGER NOT NULL DEFAULT 0,
    `adopted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `agent_preferences_user_id_key_key`(`user_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_playbooks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `trigger` JSON NOT NULL,
    `steps` JSON NOT NULL,
    `executor` VARCHAR(16) NOT NULL DEFAULT 'self',
    `status` VARCHAR(16) NOT NULL DEFAULT 'candidate',
    `runs` INTEGER NOT NULL DEFAULT 0,
    `successes` INTEGER NOT NULL DEFAULT 0,
    `last_run_at` DATETIME(3) NULL,
    `source_event_ids` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_playbooks_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_grants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `playbook_id` INTEGER NOT NULL,
    `scope` JSON NOT NULL,
    `dry_run_result` JSON NOT NULL,
    `one_time` BOOLEAN NOT NULL DEFAULT true,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_grants_user_id_status_idx`(`user_id`, `status`),
    INDEX `agent_grants_playbook_id_status_idx`(`playbook_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_action_grants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `domain` VARCHAR(32) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_action_grants_user_id_idx`(`user_id`),
    UNIQUE INDEX `agent_action_grants_user_id_action_key`(`user_id`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_playbook_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `playbook_id` INTEGER NOT NULL,
    `grant_id` INTEGER NOT NULL DEFAULT 0,
    `executor` VARCHAR(16) NOT NULL DEFAULT 'self',
    `outcome` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `steps_result` JSON NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `agent_playbook_runs_user_id_started_at_idx`(`user_id`, `started_at`),
    INDEX `agent_playbook_runs_playbook_id_started_at_idx`(`playbook_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_conversations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(80) NOT NULL DEFAULT '',
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `expert_id` INTEGER NOT NULL DEFAULT 0,
    `expert_name` VARCHAR(40) NOT NULL DEFAULT '',
    `persona_id` INTEGER NOT NULL DEFAULT 0,
    `persona_name` VARCHAR(30) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_conversations_user_id_updated_at_idx`(`user_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `tool_calls` JSON NOT NULL,
    `media` JSON NOT NULL,
    `references` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_agent_messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    INDEX `content_agent_messages_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_memories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'fact',
    `content` TEXT NOT NULL,
    `normalized` VARCHAR(200) NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'agent',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_memories_user_id_created_at_idx`(`user_id`, `created_at`),
    UNIQUE INDEX `content_agent_memories_user_id_normalized_key`(`user_id`, `normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_personas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(30) NOT NULL,
    `style` VARCHAR(32) NOT NULL DEFAULT '',
    `persona` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_personas_user_id_id_idx`(`user_id`, `id`),
    UNIQUE INDEX `content_agent_personas_user_id_name_key`(`user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_model_channels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `base_url` VARCHAR(300) NOT NULL DEFAULT '',
    `key_cipher` TEXT NOT NULL,
    `asr_key_cipher` TEXT NOT NULL,
    `preset` VARCHAR(16) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_model_channels_user_id_idx`(`user_id`),
    UNIQUE INDEX `content_model_channels_user_id_provider_name_key`(`user_id`, `provider`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_model_slots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `media_type` VARCHAR(16) NOT NULL,
    `channel_id` INTEGER NOT NULL DEFAULT 0,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `content_model_slots_user_id_media_type_key`(`user_id`, `media_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_generation_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `tool` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `input` JSON NOT NULL,
    `models` JSON NOT NULL,
    `output` JSON NOT NULL,
    `asset_url` TEXT NOT NULL,
    `aipdd_asset_id` VARCHAR(64) NOT NULL DEFAULT '',
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_generation_jobs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `content_generation_jobs_status_updated_at_idx`(`status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `job_id` INTEGER NOT NULL DEFAULT 0,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'image',
    `url` TEXT NOT NULL,
    `aipdd_asset_id` VARCHAR(64) NOT NULL DEFAULT '',
    `name` VARCHAR(200) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_assets_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `content_assets_job_id_idx`(`job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `digital_asset_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `aipdd_asset_id` INTEGER NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'file',
    `name` VARCHAR(200) NOT NULL DEFAULT '',
    `url` TEXT NOT NULL,
    `preview_url` TEXT NOT NULL,
    `file_size` DOUBLE NOT NULL DEFAULT 0,
    `labels` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `digital_asset_entries_user_id_updated_at_idx`(`user_id`, `updated_at`),
    UNIQUE INDEX `digital_asset_entries_user_id_aipdd_asset_id_key`(`user_id`, `aipdd_asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_shared_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `asset_id` VARCHAR(128) NOT NULL,
    `asset_name` VARCHAR(200) NOT NULL DEFAULT '',
    `asset_type` VARCHAR(16) NOT NULL DEFAULT 'file',
    `asset_size` DOUBLE NOT NULL DEFAULT 0,
    `asset_url` TEXT NOT NULL,
    `target_user_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_shared_assets_target_user_id_created_at_idx`(`target_user_id`, `created_at`),
    INDEX `content_shared_assets_owner_user_id_created_at_idx`(`owner_user_id`, `created_at`),
    UNIQUE INDEX `content_shared_assets_owner_user_id_asset_id_target_user_id_key`(`owner_user_id`, `asset_id`, `target_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_skills` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `files` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_skills_user_id_enabled_idx`(`user_id`, `enabled`),
    UNIQUE INDEX `content_agent_skills_user_id_name_key`(`user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_mcp_connectors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `transport` VARCHAR(8) NOT NULL DEFAULT 'http',
    `url` VARCHAR(500) NOT NULL,
    `headers` TEXT NOT NULL,
    `header_names` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `tool_count` INTEGER NOT NULL DEFAULT 0,
    `tool_names` JSON NOT NULL,
    `last_error` VARCHAR(300) NOT NULL DEFAULT '',
    `last_checked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_mcp_connectors_user_id_enabled_idx`(`user_id`, `enabled`),
    UNIQUE INDEX `content_agent_mcp_connectors_user_id_name_key`(`user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_experts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(40) NOT NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `instruction` TEXT NOT NULL,
    `prompt` TEXT NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `creator_name` VARCHAR(64) NOT NULL DEFAULT '',
    `use_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_experts_use_count_id_idx`(`use_count`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_library_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `aipdd_asset_id` INTEGER NOT NULL DEFAULT 0,
    `source` VARCHAR(16) NOT NULL DEFAULT 'asset',
    `name` VARCHAR(200) NOT NULL DEFAULT '',
    `type` VARCHAR(16) NOT NULL DEFAULT 'md',
    `url` TEXT NOT NULL,
    `file_size` DOUBLE NOT NULL DEFAULT 0,
    `text` TEXT NOT NULL,
    `char_count` INTEGER NOT NULL DEFAULT 0,
    `node_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ready',
    `note` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_library_items_user_id_updated_at_idx`(`user_id`, `updated_at`),
    INDEX `content_agent_library_items_user_id_aipdd_asset_id_idx`(`user_id`, `aipdd_asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_library_nodes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `item_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'section',
    `path` VARCHAR(300) NOT NULL DEFAULT '',
    `ordinal` INTEGER NOT NULL DEFAULT 0,
    `content` TEXT NOT NULL,
    `chars` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_agent_library_nodes_item_id_ordinal_idx`(`item_id`, `ordinal`),
    INDEX `content_agent_library_nodes_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_library_drafts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `item_id` INTEGER NOT NULL,
    `node_id` INTEGER NOT NULL DEFAULT 0,
    `node_path` VARCHAR(300) NOT NULL DEFAULT '',
    `reason` VARCHAR(300) NOT NULL DEFAULT '',
    `before` TEXT NOT NULL,
    `after` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decided_at` DATETIME(3) NULL,

    INDEX `content_agent_library_drafts_user_id_status_created_at_idx`(`user_id`, `status`, `created_at`),
    INDEX `content_agent_library_drafts_item_id_idx`(`item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_schedules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `preset` VARCHAR(32) NOT NULL DEFAULT '',
    `title` VARCHAR(80) NOT NULL,
    `instruction` TEXT NOT NULL,
    `conversation_id` INTEGER NOT NULL DEFAULT 0,
    `expert_id` INTEGER NOT NULL DEFAULT 0,
    `persona_id` INTEGER NOT NULL DEFAULT 0,
    `skill_ids` JSON NOT NULL,
    `library_ids` JSON NOT NULL,
    `connector_ids` JSON NOT NULL,
    `mailbox_ids` JSON NOT NULL,
    `references` JSON NOT NULL,
    `channel_id` INTEGER NOT NULL DEFAULT 0,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `schedule_type` VARCHAR(16) NOT NULL DEFAULT 'recurring',
    `schedule_config` JSON NOT NULL,
    `scheduled_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'enabled',
    `last_run_at` DATETIME(3) NULL,
    `last_status` VARCHAR(16) NOT NULL DEFAULT '',
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `run_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_schedules_user_id_status_idx`(`user_id`, `status`),
    INDEX `content_agent_schedules_status_schedule_type_scheduled_at_idx`(`status`, `schedule_type`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_schedule_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schedule_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `trigger` VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    `status` VARCHAR(16) NOT NULL DEFAULT 'running',
    `conversation_id` INTEGER NOT NULL DEFAULT 0,
    `message_id` INTEGER NOT NULL DEFAULT 0,
    `summary` VARCHAR(500) NOT NULL DEFAULT '',
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `content_agent_schedule_runs_schedule_id_started_at_idx`(`schedule_id`, `started_at`),
    INDEX `content_agent_schedule_runs_user_id_started_at_idx`(`user_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_assistant_channels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `webhook_token` VARCHAR(32) NOT NULL,
    `config_cipher` TEXT NOT NULL,
    `channel_id` INTEGER NOT NULL DEFAULT 0,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `allowed_users` VARCHAR(500) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_event_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `event_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `content_agent_assistant_channels_webhook_token_key`(`webhook_token`),
    INDEX `content_agent_assistant_channels_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_assistant_chats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `external_chat_id` VARCHAR(191) NOT NULL,
    `conversation_id` INTEGER NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `cursor` VARCHAR(191) NOT NULL DEFAULT '',
    `last_user_id` VARCHAR(191) NOT NULL DEFAULT '',
    `last_message_at` DATETIME(3) NULL,
    `message_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_agent_assistant_chats_user_id_last_message_at_idx`(`user_id`, `last_message_at`),
    UNIQUE INDEX `content_agent_assistant_chats_channel_id_external_chat_id_key`(`channel_id`, `external_chat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_agent_assistant_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `external_chat_id` VARCHAR(191) NOT NULL,
    `external_msg_id` VARCHAR(191) NULL,
    `direction` VARCHAR(8) NOT NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'received',
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `conversation_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_agent_assistant_messages_channel_id_created_at_idx`(`channel_id`, `created_at`),
    INDEX `content_agent_assistant_messages_user_id_created_at_idx`(`user_id`, `created_at`),
    UNIQUE INDEX `content_agent_assistant_messages_channel_id_external_msg_id_key`(`channel_id`, `external_msg_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mail_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `address` VARCHAR(160) NOT NULL,
    `display_name` VARCHAR(80) NOT NULL DEFAULT '',
    `protocol` VARCHAR(8) NOT NULL DEFAULT 'imap',
    `incoming_host` VARCHAR(160) NOT NULL,
    `incoming_port` INTEGER NOT NULL,
    `incoming_security` VARCHAR(10) NOT NULL DEFAULT 'ssl',
    `incoming_username` VARCHAR(160) NOT NULL,
    `incoming_secret` VARCHAR(1000) NOT NULL,
    `inbox_folder` VARCHAR(80) NOT NULL DEFAULT 'INBOX',
    `drafts_folder` VARCHAR(80) NOT NULL DEFAULT 'Drafts',
    `sent_folder` VARCHAR(80) NOT NULL DEFAULT 'Sent',
    `outgoing_host` VARCHAR(160) NOT NULL DEFAULT '',
    `outgoing_port` INTEGER NOT NULL DEFAULT 465,
    `outgoing_security` VARCHAR(10) NOT NULL DEFAULT 'ssl',
    `outgoing_username` VARCHAR(160) NOT NULL DEFAULT '',
    `outgoing_secret` VARCHAR(1000) NOT NULL DEFAULT '',
    `signature` TEXT NOT NULL,
    `reply_mode` VARCHAR(16) NOT NULL DEFAULT 'draft_only',
    `max_per_run` INTEGER NOT NULL DEFAULT 10,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `library_ids` JSON NOT NULL,
    `last_run_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mail_accounts_user_id_enabled_idx`(`user_id`, `enabled`),
    UNIQUE INDEX `mail_accounts_user_id_address_key`(`user_id`, `address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mail_scripts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mailbox_id` INTEGER NOT NULL DEFAULT 0,
    `mailbox_ids` JSON NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `keywords` VARCHAR(300) NOT NULL DEFAULT '',
    `sender_pattern` VARCHAR(160) NOT NULL DEFAULT '',
    `priority` INTEGER NOT NULL DEFAULT 100,
    `content` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mail_scripts_mailbox_id_enabled_priority_idx`(`mailbox_id`, `enabled`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mail_handle_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `mailbox_id` INTEGER NOT NULL,
    `message_key` VARCHAR(255) NOT NULL,
    `from_address` VARCHAR(160) NOT NULL DEFAULT '',
    `result` VARCHAR(16) NOT NULL,
    `reason` VARCHAR(300) NOT NULL DEFAULT '',
    `handled_on` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mail_handle_logs_user_id_handled_on_idx`(`user_id`, `handled_on`),
    INDEX `mail_handle_logs_mailbox_id_from_address_handled_on_idx`(`mailbox_id`, `from_address`, `handled_on`),
    UNIQUE INDEX `mail_handle_logs_mailbox_id_message_key_key`(`mailbox_id`, `message_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `org_staff` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `member_kind` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `roles` JSON NOT NULL,
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `positions` JSON NOT NULL,
    `capabilities` TEXT NOT NULL,
    `scope` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `invited_by` VARCHAR(64) NOT NULL DEFAULT '',
    `confirmed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `org_staff_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `org_staff_member_user_id_status_idx`(`member_user_id`, `status`),
    UNIQUE INDEX `org_staff_org_type_org_user_id_member_user_id_key`(`org_type`, `org_user_id`, `member_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `org_departments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `org_departments_org_type_org_user_id_idx`(`org_type`, `org_user_id`),
    UNIQUE INDEX `org_departments_org_type_org_user_id_name_key`(`org_type`, `org_user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `org_positions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `org_positions_org_type_org_user_id_idx`(`org_type`, `org_user_id`),
    UNIQUE INDEX `org_positions_org_type_org_user_id_name_key`(`org_type`, `org_user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `org_applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `member_kind` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `direction` VARCHAR(16) NOT NULL,
    `roles` JSON NOT NULL,
    `scope` JSON NOT NULL,
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `positions` JSON NOT NULL,
    `capabilities` TEXT NOT NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `org_applications_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `org_applications_member_user_id_status_idx`(`member_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `level` VARCHAR(16) NOT NULL DEFAULT 'info',
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `link` VARCHAR(500) NOT NULL DEFAULT '',
    `entity_type` VARCHAR(32) NOT NULL DEFAULT '',
    `entity_id` VARCHAR(64) NOT NULL DEFAULT '',
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_id_idx`(`user_id`, `read_at`, `id`),
    INDEX `notifications_user_id_category_idx`(`user_id`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_channels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `config` TEXT NOT NULL,
    `callback_token` VARCHAR(32) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `cursor` TEXT NOT NULL,
    `last_event_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_desk_channels_callback_token_key`(`callback_token`),
    INDEX `service_desk_channels_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_sites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `site_key` VARCHAR(48) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `allowedOrigins` JSON NOT NULL,
    `appearance` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_desk_sites_site_key_key`(`site_key`),
    INDEX `service_desk_sites_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `business_hours` JSON NOT NULL,
    `welcome_text` TEXT NOT NULL,
    `queue_text` TEXT NOT NULL,
    `offline_text` TEXT NOT NULL,
    `auto_assign` BOOLEAN NOT NULL DEFAULT true,
    `max_concurrent` INTEGER NOT NULL DEFAULT 5,
    `rating_enabled` BOOLEAN NOT NULL DEFAULT true,
    `ai_mode` VARCHAR(16) NOT NULL DEFAULT 'CANNED',
    `ai_channel_id` INTEGER NOT NULL DEFAULT 0,
    `ai_model` VARCHAR(128) NOT NULL DEFAULT '',
    `ai_handoff_keywords` JSON NOT NULL,
    `library_ids` JSON NOT NULL,
    `require_contact` BOOLEAN NOT NULL DEFAULT false,
    `retention_days` INTEGER NOT NULL DEFAULT 180,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_desk_settings_owner_user_id_key`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `categories` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_desk_groups_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_agents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'agent',
    `group_id` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OFFLINE',
    `max_concurrent` INTEGER NOT NULL DEFAULT 5,
    `last_assigned_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `service_desk_agents_owner_user_id_status_idx`(`owner_user_id`, `status`),
    UNIQUE INDEX `service_desk_agents_owner_user_id_member_user_id_key`(`owner_user_id`, `member_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_visitors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `site_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `nickname` VARCHAR(60) NOT NULL DEFAULT '',
    `contact` VARCHAR(120) NOT NULL DEFAULT '',
    `user_agent` VARCHAR(255) NOT NULL DEFAULT '',
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `service_desk_visitors_token_hash_key`(`token_hash`),
    INDEX `service_desk_visitors_owner_user_id_site_id_idx`(`owner_user_id`, `site_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_conversations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `site_id` INTEGER NOT NULL,
    `group_id` INTEGER NOT NULL DEFAULT 0,
    `assignee_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `visitor_id` INTEGER NOT NULL,
    `channel_id` INTEGER NOT NULL DEFAULT 0,
    `external_chat_id` VARCHAR(191) NOT NULL DEFAULT '',
    `external_user_id` VARCHAR(191) NOT NULL DEFAULT '',
    `external_user_name` VARCHAR(120) NOT NULL DEFAULT '',
    `external_message_id` VARCHAR(191) NOT NULL DEFAULT '',
    `external_meta` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'waiting',
    `source_url` VARCHAR(500) NOT NULL DEFAULT '',
    `subject` VARCHAR(120) NOT NULL DEFAULT '',
    `last_message_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `unread_for_agent` INTEGER NOT NULL DEFAULT 0,
    `unread_for_requester` INTEGER NOT NULL DEFAULT 0,
    `ai_mode` VARCHAR(16) NOT NULL DEFAULT 'CANNED',
    `transfer_count` INTEGER NOT NULL DEFAULT 0,
    `first_response_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `rating` INTEGER NOT NULL DEFAULT 0,
    `rating_comment` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_desk_conversations_owner_user_id_status_last_message_idx`(`owner_user_id`, `status`, `last_message_at`),
    INDEX `service_desk_conversations_assignee_user_id_status_idx`(`assignee_user_id`, `status`),
    INDEX `service_desk_conversations_site_id_created_at_idx`(`site_id`, `created_at`),
    INDEX `service_desk_conversations_channel_id_external_chat_id_statu_idx`(`channel_id`, `external_chat_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `sender_type` VARCHAR(16) NOT NULL,
    `sender_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `content_type` VARCHAR(16) NOT NULL DEFAULT 'text',
    `content` TEXT NOT NULL,
    `attachment_url` VARCHAR(500) NOT NULL DEFAULT '',
    `attachment_name` VARCHAR(200) NOT NULL DEFAULT '',
    `attachment_size` INTEGER NOT NULL DEFAULT 0,
    `client_msg_id` VARCHAR(64) NOT NULL DEFAULT '',
    `external_msg_id` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_desk_messages_conversation_id_id_idx`(`conversation_id`, `id`),
    INDEX `service_desk_messages_conversation_id_client_msg_id_idx`(`conversation_id`, `client_msg_id`),
    INDEX `service_desk_messages_conversation_id_external_msg_id_idx`(`conversation_id`, `external_msg_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_canned_replies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `scope` VARCHAR(16) NOT NULL DEFAULT 'shared',
    `user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(80) NOT NULL,
    `content` TEXT NOT NULL,
    `category` VARCHAR(40) NOT NULL DEFAULT '',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_desk_canned_replies_owner_user_id_scope_idx`(`owner_user_id`, `scope`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_desk_faqs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `question` VARCHAR(300) NOT NULL,
    `keywords` VARCHAR(300) NOT NULL DEFAULT '',
    `answer` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `service_desk_faqs_owner_user_id_enabled_idx`(`owner_user_id`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_qr_domains` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `domain` VARCHAR(253) NOT NULL,
    `domain_key` VARCHAR(16) NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'CDN',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `weight` INTEGER NOT NULL DEFAULT 1,
    `acked_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `last_check_at` DATETIME(3) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `last_error` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `marketing_qr_domains_domain_key`(`domain`),
    UNIQUE INDEX `marketing_qr_domains_domain_key_key`(`domain_key`),
    INDEX `marketing_qr_domains_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_qr_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `code` VARCHAR(12) NOT NULL,
    `entry_mode` VARCHAR(16) NOT NULL DEFAULT 'CDN',
    `domain_mode` VARCHAR(16) NOT NULL DEFAULT 'ROTATE',
    `domain_id` INTEGER NOT NULL DEFAULT 0,
    `current_domain_id` INTEGER NOT NULL DEFAULT 0,
    `auto_failover` BOOLEAN NOT NULL DEFAULT true,
    `entry_changed_at` DATETIME(3) NULL,
    `script_url` VARCHAR(500) NOT NULL DEFAULT '',
    `title` VARCHAR(60) NOT NULL DEFAULT '',
    `note` TEXT NOT NULL,
    `select_mode` VARCHAR(16) NOT NULL DEFAULT 'RANDOM',
    `sticky` BOOLEAN NOT NULL DEFAULT true,
    `limit_scope` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `daily_limit` INTEGER NOT NULL DEFAULT 0,
    `total_limit` INTEGER NOT NULL DEFAULT 0,
    `cursor` INTEGER NOT NULL DEFAULT 0,
    `fallback_child_id` INTEGER NOT NULL DEFAULT 0,
    `today_date` VARCHAR(10) NOT NULL DEFAULT '',
    `today_count` INTEGER NOT NULL DEFAULT 0,
    `total_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `disabled_reason` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `marketing_qr_codes_code_key`(`code`),
    INDEX `marketing_qr_codes_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `marketing_qr_codes_current_domain_id_idx`(`current_domain_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_qr_children` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code_id` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `image_key` VARCHAR(255) NOT NULL DEFAULT '',
    `link_url` VARCHAR(1000) NOT NULL DEFAULT '',
    `text_content` TEXT NOT NULL,
    `channel` VARCHAR(32) NOT NULL DEFAULT '',
    `weight` INTEGER NOT NULL DEFAULT 1,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `limit_scope` VARCHAR(16) NOT NULL DEFAULT 'INHERIT',
    `daily_limit` INTEGER NOT NULL DEFAULT 0,
    `total_limit` INTEGER NOT NULL DEFAULT 0,
    `today_date` VARCHAR(10) NOT NULL DEFAULT '',
    `today_count` INTEGER NOT NULL DEFAULT 0,
    `total_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `marketing_qr_children_code_id_status_idx`(`code_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_qr_scans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code_id` INTEGER NOT NULL,
    `child_id` INTEGER NOT NULL DEFAULT 0,
    `domain_id` INTEGER NOT NULL DEFAULT 0,
    `channel` VARCHAR(32) NOT NULL DEFAULT '',
    `visitor_hash` VARCHAR(64) NOT NULL DEFAULT '',
    `ip_hash` VARCHAR(64) NOT NULL DEFAULT '',
    `ua` VARCHAR(255) NOT NULL DEFAULT '',
    `region` VARCHAR(32) NOT NULL DEFAULT '',
    `device` VARCHAR(16) NOT NULL DEFAULT '',
    `result` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `marketing_qr_scans_code_id_created_at_idx`(`code_id`, `created_at`),
    INDEX `marketing_qr_scans_child_id_created_at_idx`(`child_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `mask_phone` BOOLEAN NOT NULL DEFAULT true,
    `mask_email` BOOLEAN NOT NULL DEFAULT true,
    `title_fields` JSON NOT NULL,
    `ai_analysis_guide` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `crm_settings_owner_user_id_key`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'SALES',
    `data_scope` VARCHAR(16) NOT NULL DEFAULT 'SELF',
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_members_owner_user_id_status_idx`(`owner_user_id`, `status`),
    UNIQUE INDEX `crm_members_owner_user_id_member_user_id_key`(`owner_user_id`, `member_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_field_defs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `form_key` VARCHAR(24) NOT NULL,
    `field_key` VARCHAR(48) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `options` JSON NOT NULL,
    `visible` BOOLEAN NOT NULL DEFAULT true,
    `editable` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_field_defs_owner_user_id_form_key_idx`(`owner_user_id`, `form_key`),
    UNIQUE INDEX `crm_field_defs_owner_user_id_form_key_field_key_key`(`owner_user_id`, `form_key`, `field_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_custom_modules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `data_table_id` INTEGER NOT NULL,
    `role_ids` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_custom_modules_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_change_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(24) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `before` JSON NOT NULL,
    `after` JSON NOT NULL,
    `operator` VARCHAR(64) NOT NULL DEFAULT '',
    `channel` VARCHAR(16) NOT NULL DEFAULT 'web',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_change_logs_owner_user_id_target_type_target_id_idx`(`owner_user_id`, `target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_export_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `module` VARCHAR(24) NOT NULL,
    `query` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DONE',
    `file_name` VARCHAR(120) NOT NULL DEFAULT '',
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `rows` JSON NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_export_tasks_owner_user_id_created_at_idx`(`owner_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_lead_pools` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `scope_ids` JSON NOT NULL,
    `admin_id` VARCHAR(64) NOT NULL DEFAULT '',
    `auto` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `pick_rule` JSON NOT NULL,
    `recycle_rule` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_lead_pools_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_customer_pools` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `scope_ids` JSON NOT NULL,
    `admin_id` VARCHAR(64) NOT NULL DEFAULT '',
    `auto` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `pick_rule` JSON NOT NULL,
    `recycle_rule` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_customer_pools_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_capacities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `scope_type` VARCHAR(16) NOT NULL,
    `scope_id` VARCHAR(64) NOT NULL DEFAULT '',
    `capacity` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `crm_capacities_owner_user_id_target_type_scope_type_scope_id_key`(`owner_user_id`, `target_type`, `scope_type`, `scope_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_owner_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `from_owner` VARCHAR(64) NOT NULL DEFAULT '',
    `to_owner` VARCHAR(64) NOT NULL DEFAULT '',
    `reason` VARCHAR(200) NOT NULL DEFAULT '',
    `operator` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_owner_history_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `crm_owner_history_owner_user_id_created_at_idx`(`owner_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_leads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `contact_name` VARCHAR(60) NOT NULL DEFAULT '',
    `phone` VARCHAR(40) NOT NULL DEFAULT '',
    `phone_norm` VARCHAR(40) NOT NULL DEFAULT '',
    `email` VARCHAR(120) NOT NULL DEFAULT '',
    `email_norm` VARCHAR(160) NOT NULL DEFAULT '',
    `source` VARCHAR(60) NOT NULL DEFAULT '',
    `stage` VARCHAR(16) NOT NULL DEFAULT 'NEW',
    `owner_id` VARCHAR(64) NOT NULL DEFAULT '',
    `pool_id` INTEGER NOT NULL DEFAULT 0,
    `in_pool` BOOLEAN NOT NULL DEFAULT false,
    `products` JSON NOT NULL,
    `transition_type` VARCHAR(16) NOT NULL DEFAULT '',
    `transition_id` INTEGER NOT NULL DEFAULT 0,
    `last_follower_id` VARCHAR(64) NOT NULL DEFAULT '',
    `last_follow_at` DATETIME(3) NULL,
    `frozen` BOOLEAN NOT NULL DEFAULT false,
    `freeze_reason` VARCHAR(200) NOT NULL DEFAULT '',
    `unfreeze_at` DATETIME(3) NULL,
    `approval_status` VARCHAR(16) NOT NULL DEFAULT '',
    `remark` TEXT NOT NULL,
    `custom` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `crm_leads_owner_user_id_stage_idx`(`owner_user_id`, `stage`),
    INDEX `crm_leads_owner_user_id_owner_id_idx`(`owner_user_id`, `owner_id`),
    INDEX `crm_leads_owner_user_id_phone_norm_idx`(`owner_user_id`, `phone_norm`),
    INDEX `crm_leads_owner_user_id_email_norm_idx`(`owner_user_id`, `email_norm`),
    INDEX `crm_leads_owner_user_id_pool_id_in_pool_idx`(`owner_user_id`, `pool_id`, `in_pool`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `name_norm` VARCHAR(120) NOT NULL DEFAULT '',
    `owner_id` VARCHAR(64) NOT NULL DEFAULT '',
    `pool_id` INTEGER NOT NULL DEFAULT 0,
    `in_pool` BOOLEAN NOT NULL DEFAULT false,
    `collection_at` DATETIME(3) NULL,
    `last_follower_id` VARCHAR(64) NOT NULL DEFAULT '',
    `last_follow_at` DATETIME(3) NULL,
    `reason_id` INTEGER NOT NULL DEFAULT 0,
    `frozen` BOOLEAN NOT NULL DEFAULT false,
    `freeze_reason` VARCHAR(200) NOT NULL DEFAULT '',
    `unfreeze_at` DATETIME(3) NULL,
    `approval_status` VARCHAR(16) NOT NULL DEFAULT '',
    `industry` VARCHAR(60) NOT NULL DEFAULT '',
    `province` VARCHAR(40) NOT NULL DEFAULT '',
    `city` VARCHAR(40) NOT NULL DEFAULT '',
    `remark` TEXT NOT NULL,
    `custom` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `crm_customers_owner_user_id_owner_id_idx`(`owner_user_id`, `owner_id`),
    INDEX `crm_customers_owner_user_id_name_norm_idx`(`owner_user_id`, `name_norm`),
    INDEX `crm_customers_owner_user_id_pool_id_in_pool_idx`(`owner_user_id`, `pool_id`, `in_pool`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `phone` VARCHAR(40) NOT NULL DEFAULT '',
    `phone_norm` VARCHAR(40) NOT NULL DEFAULT '',
    `email` VARCHAR(120) NOT NULL DEFAULT '',
    `email_norm` VARCHAR(160) NOT NULL DEFAULT '',
    `title` VARCHAR(60) NOT NULL DEFAULT '',
    `owner_id` VARCHAR(64) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `disable_reason` VARCHAR(200) NOT NULL DEFAULT '',
    `custom` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_contacts_owner_user_id_customer_id_idx`(`owner_user_id`, `customer_id`),
    INDEX `crm_contacts_owner_user_id_phone_norm_idx`(`owner_user_id`, `phone_norm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_customer_collaborations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'COLLABORATION',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_customer_collaborations_owner_user_id_idx`(`owner_user_id`),
    UNIQUE INDEX `crm_customer_collaborations_customer_id_user_id_key`(`customer_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_customer_relations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `source_customer_id` INTEGER NOT NULL,
    `target_customer_id` INTEGER NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_customer_relations_owner_user_id_idx`(`owner_user_id`),
    UNIQUE INDEX `crm_customer_relations_source_customer_id_target_customer_id_key`(`source_customer_id`, `target_customer_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_follow_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `type` VARCHAR(32) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `result` VARCHAR(200) NOT NULL DEFAULT '',
    `attachments` JSON NOT NULL,
    `next_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_follow_records_owner_user_id_target_type_target_id_idx`(`owner_user_id`, `target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_follow_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `plan_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED',
    `owner_id` VARCHAR(64) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `reminder_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_follow_plans_owner_user_id_status_plan_at_idx`(`owner_user_id`, `status`, `plan_at`),
    INDEX `crm_follow_plans_target_type_target_id_idx`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_follow_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `mentions` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_follow_comments_owner_user_id_target_type_target_id_idx`(`owner_user_id`, `target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(60) NOT NULL DEFAULT '',
    `price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `description` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_products_owner_user_id_status_idx`(`owner_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_product_prices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `items` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_product_prices_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_opportunity_stages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'AFOOT',
    `scenario` VARCHAR(16) NOT NULL DEFAULT '',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `win_rate` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_opportunity_stages_owner_user_id_sort_idx`(`owner_user_id`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_opportunity_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `scope_ids` JSON NOT NULL,
    `auto` BOOLEAN NOT NULL DEFAULT false,
    `conditions` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_opportunity_rules_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_opportunities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `possible` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `products` JSON NOT NULL,
    `stage_id` INTEGER NOT NULL DEFAULT 0,
    `contact_id` INTEGER NOT NULL DEFAULT 0,
    `owner_id` VARCHAR(64) NOT NULL DEFAULT '',
    `last_follower_id` VARCHAR(64) NOT NULL DEFAULT '',
    `last_follow_at` DATETIME(3) NULL,
    `expected_end_at` DATETIME(3) NULL,
    `actual_end_at` DATETIME(3) NULL,
    `failure_reason` VARCHAR(200) NOT NULL DEFAULT '',
    `approval_status` VARCHAR(16) NOT NULL DEFAULT '',
    `custom` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `crm_opportunities_owner_user_id_stage_id_idx`(`owner_user_id`, `stage_id`),
    INDEX `crm_opportunities_owner_user_id_owner_id_idx`(`owner_user_id`, `owner_id`),
    INDEX `crm_opportunities_owner_user_id_customer_id_idx`(`owner_user_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_opportunity_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `opportunity_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL DEFAULT 0,
    `name_snapshot` VARCHAR(120) NOT NULL DEFAULT '',
    `qty` DECIMAL(18, 2) NOT NULL DEFAULT 1,
    `price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,

    INDEX `crm_opportunity_items_opportunity_id_idx`(`opportunity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_quotations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `opportunity_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `until_at` DATETIME(3) NULL,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `approval_status` VARCHAR(16) NOT NULL DEFAULT '',
    `invalid` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_quotations_owner_user_id_opportunity_id_idx`(`owner_user_id`, `opportunity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_quotation_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotation_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL DEFAULT 0,
    `name_snapshot` VARCHAR(120) NOT NULL DEFAULT '',
    `qty` DECIMAL(18, 2) NOT NULL DEFAULT 1,
    `price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,

    INDEX `crm_quotation_items_quotation_id_idx`(`quotation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_contract_stages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_contract_stages_owner_user_id_sort_idx`(`owner_user_id`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_contracts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `opportunity_id` INTEGER NOT NULL DEFAULT 0,
    `quotation_id` INTEGER NOT NULL DEFAULT 0,
    `name` VARCHAR(160) NOT NULL,
    `number` VARCHAR(48) NOT NULL DEFAULT '',
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `stage_id` INTEGER NOT NULL DEFAULT 0,
    `approval_status` VARCHAR(16) NOT NULL DEFAULT '',
    `start_at` DATETIME(3) NULL,
    `end_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(200) NOT NULL DEFAULT '',
    `owner_id` VARCHAR(64) NOT NULL DEFAULT '',
    `snapshot` JSON NOT NULL,
    `remark` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `crm_contracts_owner_user_id_stage_id_idx`(`owner_user_id`, `stage_id`),
    INDEX `crm_contracts_owner_user_id_customer_id_idx`(`owner_user_id`, `customer_id`),
    INDEX `crm_contracts_owner_user_id_owner_id_idx`(`owner_user_id`, `owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_contract_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contract_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL DEFAULT 0,
    `name_snapshot` VARCHAR(120) NOT NULL DEFAULT '',
    `qty` DECIMAL(18, 2) NOT NULL DEFAULT 1,
    `price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,

    INDEX `crm_contract_items_contract_id_idx`(`contract_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_business_titles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `customer_id` INTEGER NOT NULL DEFAULT 0,
    `name` VARCHAR(160) NOT NULL,
    `tax_no` VARCHAR(40) NOT NULL DEFAULT '',
    `bank` VARCHAR(120) NOT NULL DEFAULT '',
    `account` VARCHAR(60) NOT NULL DEFAULT '',
    `address` VARCHAR(200) NOT NULL DEFAULT '',
    `phone` VARCHAR(40) NOT NULL DEFAULT '',
    `capital` VARCHAR(60) NOT NULL DEFAULT '',
    `scale` VARCHAR(60) NOT NULL DEFAULT '',
    `province` VARCHAR(40) NOT NULL DEFAULT '',
    `city` VARCHAR(40) NOT NULL DEFAULT '',
    `industry` VARCHAR(60) NOT NULL DEFAULT '',
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `remark` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_business_titles_owner_user_id_customer_id_idx`(`owner_user_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `business_title_id` INTEGER NOT NULL DEFAULT 0,
    `name` VARCHAR(160) NOT NULL DEFAULT '',
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `invoice_type` VARCHAR(16) NOT NULL DEFAULT 'SPECIAL',
    `tax_rate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `approval_status` VARCHAR(16) NOT NULL DEFAULT '',
    `attachment_key` VARCHAR(255) NOT NULL DEFAULT '',
    `remark` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_invoices_owner_user_id_contract_id_idx`(`owner_user_id`, `contract_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_payment_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `plan_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `plan_end_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_payment_plans_owner_user_id_contract_id_idx`(`owner_user_id`, `contract_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_payment_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `contract_id` INTEGER NOT NULL,
    `payment_plan_id` INTEGER NOT NULL DEFAULT 0,
    `name` VARCHAR(120) NOT NULL DEFAULT '',
    `no` VARCHAR(48) NOT NULL DEFAULT '',
    `record_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `record_end_at` DATETIME(3) NULL,
    `attachment_key` VARCHAR(255) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_payment_records_owner_user_id_contract_id_idx`(`owner_user_id`, `contract_id`),
    INDEX `crm_payment_records_payment_plan_id_idx`(`payment_plan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_order_stages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_order_stages_owner_user_id_sort_idx`(`owner_user_id`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `number` VARCHAR(48) NOT NULL DEFAULT '',
    `customer_id` INTEGER NOT NULL DEFAULT 0,
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `stage_id` INTEGER NOT NULL DEFAULT 0,
    `approval_status` VARCHAR(16) NOT NULL DEFAULT '',
    `owner_id` VARCHAR(64) NOT NULL DEFAULT '',
    `snapshot` JSON NOT NULL,
    `custom` JSON NOT NULL,
    `remark` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `crm_orders_owner_user_id_stage_id_idx`(`owner_user_id`, `stage_id`),
    INDEX `crm_orders_owner_user_id_customer_id_idx`(`owner_user_id`, `customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL DEFAULT 0,
    `name_snapshot` VARCHAR(120) NOT NULL DEFAULT '',
    `qty` DECIMAL(18, 2) NOT NULL DEFAULT 1,
    `price` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,

    INDEX `crm_order_items_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_approval_flows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `form_type` VARCHAR(24) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `current_version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_approval_flows_owner_user_id_form_type_idx`(`owner_user_id`, `form_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_approval_flow_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `flow_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `nodes` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `crm_approval_flow_versions_flow_id_version_key`(`flow_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_approval_instances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `form_type` VARCHAR(24) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `flow_id` INTEGER NOT NULL DEFAULT 0,
    `flow_version_id` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `submitter` VARCHAR(64) NOT NULL DEFAULT '',
    `current_node` INTEGER NOT NULL DEFAULT 0,
    `submitted_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `snapshot` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `crm_approval_instances_owner_user_id_form_type_target_id_idx`(`owner_user_id`, `form_type`, `target_id`),
    INDEX `crm_approval_instances_owner_user_id_status_idx`(`owner_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_approval_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `instance_id` INTEGER NOT NULL,
    `node_index` INTEGER NOT NULL DEFAULT 0,
    `node_name` VARCHAR(60) NOT NULL DEFAULT '',
    `approver_id` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `action` VARCHAR(24) NOT NULL DEFAULT '',
    `comment` TEXT NOT NULL,
    `acted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_approval_tasks_approver_id_status_idx`(`approver_id`, `status`),
    INDEX `crm_approval_tasks_instance_id_node_index_idx`(`instance_id`, `node_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_approval_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `instance_id` INTEGER NOT NULL,
    `node_index` INTEGER NOT NULL DEFAULT 0,
    `action` VARCHAR(24) NOT NULL,
    `operator` VARCHAR(64) NOT NULL DEFAULT '',
    `comment` TEXT NOT NULL,
    `attachments` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_approval_records_instance_id_idx`(`instance_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_approval_cc` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `instance_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `crm_approval_cc_instance_id_user_id_key`(`instance_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `default_text_channel_id` INTEGER NOT NULL DEFAULT 0,
    `default_text_model` VARCHAR(128) NOT NULL DEFAULT '',
    `max_rows` INTEGER NOT NULL DEFAULT 10000,
    `query_timeout_ms` INTEGER NOT NULL DEFAULT 30000,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bi_settings_owner_user_id_key`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'ANALYST',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bi_members_owner_user_id_status_idx`(`owner_user_id`, `status`),
    UNIQUE INDEX `bi_members_owner_user_id_member_user_id_key`(`owner_user_id`, `member_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_datasources` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `config_cipher` TEXT NOT NULL,
    `read_only` BOOLEAN NOT NULL DEFAULT true,
    `ssl` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `last_test_at` DATETIME(3) NULL,
    `last_error` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bi_datasources_owner_user_id_kind_idx`(`owner_user_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_datasource_tables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `datasource_id` INTEGER NOT NULL,
    `table_name` VARCHAR(120) NOT NULL,
    `table_comment` VARCHAR(200) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bi_datasource_tables_owner_user_id_idx`(`owner_user_id`),
    UNIQUE INDEX `bi_datasource_tables_datasource_id_table_name_key`(`datasource_id`, `table_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_datasource_fields` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `table_id` INTEGER NOT NULL,
    `field_name` VARCHAR(120) NOT NULL,
    `field_type` VARCHAR(40) NOT NULL DEFAULT '',
    `field_comment` VARCHAR(200) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bi_datasource_fields_table_id_field_name_key`(`table_id`, `field_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_dataset_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bi_dataset_groups_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_datasets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `group_id` INTEGER NOT NULL DEFAULT 0,
    `name` VARCHAR(80) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `datasource_id` INTEGER NOT NULL DEFAULT 0,
    `internal_key` VARCHAR(40) NOT NULL DEFAULT '',
    `sql_text` TEXT NOT NULL,
    `config` JSON NOT NULL,
    `description` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bi_datasets_owner_user_id_group_id_idx`(`owner_user_id`, `group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_dataset_tables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dataset_id` INTEGER NOT NULL,
    `datasource_table_id` INTEGER NOT NULL,
    `alias` VARCHAR(60) NOT NULL DEFAULT '',
    `join_type` VARCHAR(12) NOT NULL DEFAULT 'LEFT',
    `join_config` JSON NOT NULL,

    INDEX `bi_dataset_tables_dataset_id_idx`(`dataset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_dataset_fields` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dataset_id` INTEGER NOT NULL,
    `field_key` VARCHAR(120) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `type` VARCHAR(40) NOT NULL DEFAULT '',
    `comment` VARCHAR(200) NOT NULL DEFAULT '',
    `role` VARCHAR(16) NOT NULL DEFAULT 'DIMENSION',
    `aggregate` VARCHAR(16) NOT NULL DEFAULT '',
    `expression` TEXT NOT NULL,
    `format` VARCHAR(40) NOT NULL DEFAULT '',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `visible` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `bi_dataset_fields_dataset_id_field_key_key`(`dataset_id`, `field_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_dataset_permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dataset_id` INTEGER NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `row_filter` TEXT NOT NULL,
    `column_rules` JSON NOT NULL,

    UNIQUE INDEX `bi_dataset_permissions_dataset_id_role_key`(`dataset_id`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_terms` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `dataset_id` INTEGER NOT NULL DEFAULT 0,
    `term` VARCHAR(80) NOT NULL,
    `definition` TEXT NOT NULL,
    `synonyms` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bi_terms_owner_user_id_dataset_id_idx`(`owner_user_id`, `dataset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_trainings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `dataset_id` INTEGER NOT NULL DEFAULT 0,
    `question` VARCHAR(500) NOT NULL,
    `sql_text` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bi_trainings_owner_user_id_dataset_id_idx`(`owner_user_id`, `dataset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_recommended_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `dataset_id` INTEGER NOT NULL DEFAULT 0,
    `question` VARCHAR(500) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bi_recommended_questions_owner_user_id_dataset_id_idx`(`owner_user_id`, `dataset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_charts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `dataset_id` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `chart_type` VARCHAR(16) NOT NULL,
    `config` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bi_charts_owner_user_id_dataset_id_idx`(`owner_user_id`, `dataset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_dashboards` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `layout` JSON NOT NULL,
    `config` JSON NOT NULL,
    `published` BOOLEAN NOT NULL DEFAULT false,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bi_dashboards_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_dashboard_components` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dashboard_id` INTEGER NOT NULL,
    `chart_id` INTEGER NOT NULL DEFAULT 0,
    `type` VARCHAR(16) NOT NULL DEFAULT 'CHART',
    `title` VARCHAR(80) NOT NULL DEFAULT '',
    `position` JSON NOT NULL,
    `config` JSON NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    INDEX `bi_dashboard_components_dashboard_id_idx`(`dashboard_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_chat_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `dataset_id` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bi_chat_sessions_owner_user_id_updated_at_idx`(`owner_user_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_chat_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `session_id` INTEGER NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `question` TEXT NOT NULL,
    `sql_text` TEXT NOT NULL,
    `result_preview` JSON NOT NULL,
    `chart_config` JSON NOT NULL,
    `analysis` TEXT NOT NULL,
    `followups` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `error` TEXT NOT NULL,
    `elapsed_ms` INTEGER NOT NULL DEFAULT 0,
    `tokens` INTEGER NOT NULL DEFAULT 0,
    `feedback` VARCHAR(16) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bi_chat_messages_session_id_created_at_idx`(`session_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bi_query_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `datasource_id` INTEGER NOT NULL DEFAULT 0,
    `dataset_id` INTEGER NOT NULL DEFAULT 0,
    `sql_text` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `rows` INTEGER NOT NULL DEFAULT 0,
    `elapsed_ms` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NOT NULL,
    `channel` VARCHAR(16) NOT NULL DEFAULT 'web',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bi_query_logs_owner_user_id_created_at_idx`(`owner_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_projects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT '',
    `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `icon` VARCHAR(64) NOT NULL DEFAULT 'appstore',
    `type` VARCHAR(16) NOT NULL DEFAULT 'BLANK',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `settings` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `lowcode_projects_owner_user_id_idx`(`owner_user_id`),
    INDEX `lowcode_projects_org_type_org_user_id_idx`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_project_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `role_id` INTEGER NOT NULL DEFAULT 0,
    `department` VARCHAR(100) NOT NULL DEFAULT '',
    `title` VARCHAR(100) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `lowcode_project_members_member_user_id_idx`(`member_user_id`),
    UNIQUE INDEX `lowcode_project_members_project_id_member_user_id_key`(`project_id`, `member_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `key` VARCHAR(32) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `builtin` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `lowcode_roles_project_id_key_key`(`project_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_role_permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `role_id` INTEGER NOT NULL,
    `resource_type` VARCHAR(16) NOT NULL,
    `resource_id` VARCHAR(64) NOT NULL DEFAULT '',
    `actions` JSON NOT NULL,

    UNIQUE INDEX `lowcode_role_permissions_role_id_resource_type_resource_id_key`(`role_id`, `resource_type`, `resource_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_data_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `entity_id` INTEGER NOT NULL DEFAULT 0,
    `role_id` INTEGER NOT NULL DEFAULT 0,
    `field` VARCHAR(64) NOT NULL,
    `op` VARCHAR(16) NOT NULL,
    `value` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lowcode_data_rules_project_id_entity_id_idx`(`project_id`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_entities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `data_table_id` INTEGER NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `icon` VARCHAR(64) NOT NULL DEFAULT 'table',
    `form_layout` JSON NOT NULL,
    `list_layout` JSON NOT NULL,
    `kanban_field` VARCHAR(64) NOT NULL DEFAULT '',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `lowcode_entities_project_id_data_table_id_key`(`project_id`, `data_table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_pages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `parent_id` INTEGER NOT NULL DEFAULT 0,
    `type` VARCHAR(16) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `entity_id` INTEGER NOT NULL DEFAULT 0,
    `config` JSON NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `visible` BOOLEAN NOT NULL DEFAULT true,
    `builtin` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `lowcode_pages_project_id_sort_idx`(`project_id`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_approval_flows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `entity_id` INTEGER NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `lowcode_approval_flows_project_id_entity_id_idx`(`project_id`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_approval_flow_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `flow_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `nodes` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `lowcode_approval_flow_versions_flow_id_version_key`(`flow_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_approval_instances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `flow_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `entity_id` INTEGER NOT NULL,
    `row_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    `applicant_user_id` VARCHAR(64) NOT NULL,
    `node_index` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `lowcode_approval_instances_project_id_status_idx`(`project_id`, `status`),
    INDEX `lowcode_approval_instances_entity_id_row_id_idx`(`entity_id`, `row_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_approval_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `instance_id` INTEGER NOT NULL,
    `project_id` INTEGER NOT NULL,
    `node_index` INTEGER NOT NULL,
    `node_name` VARCHAR(50) NOT NULL DEFAULT '',
    `assignee_user_id` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `comment` VARCHAR(500) NOT NULL DEFAULT '',
    `acted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lowcode_approval_tasks_assignee_user_id_status_idx`(`assignee_user_id`, `status`),
    INDEX `lowcode_approval_tasks_instance_id_idx`(`instance_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lowcode_approval_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `instance_id` INTEGER NOT NULL,
    `task_id` INTEGER NOT NULL DEFAULT 0,
    `action` VARCHAR(16) NOT NULL,
    `actor_user_id` VARCHAR(64) NOT NULL,
    `comment` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lowcode_approval_records_instance_id_idx`(`instance_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_cycles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `year` INTEGER NOT NULL,
    `period` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_cycles_owner_user_id_status_idx`(`owner_user_id`, `status`),
    UNIQUE INDEX `okr_cycles_owner_user_id_kind_year_period_key`(`owner_user_id`, `kind`, `year`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_objectives` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `cycle_id` INTEGER NOT NULL,
    `parent_id` INTEGER NOT NULL DEFAULT 0,
    `level` VARCHAR(16) NOT NULL DEFAULT 'PERSONAL',
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(2000) NOT NULL DEFAULT '',
    `owner_member_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `assigner_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `weight` DECIMAL(6, 2) NOT NULL DEFAULT 1,
    `progress` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `visibility` VARCHAR(16) NOT NULL DEFAULT 'ORG',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_objectives_owner_user_id_cycle_id_idx`(`owner_user_id`, `cycle_id`),
    INDEX `okr_objectives_owner_user_id_owner_member_user_id_idx`(`owner_user_id`, `owner_member_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_key_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `objective_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `metric_type` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `target_value` DECIMAL(16, 4) NOT NULL DEFAULT 100,
    `current_value` DECIMAL(16, 4) NOT NULL DEFAULT 0,
    `start_value` DECIMAL(16, 4) NOT NULL DEFAULT 0,
    `unit` VARCHAR(32) NOT NULL DEFAULT '',
    `direction` VARCHAR(8) NOT NULL DEFAULT 'UP',
    `weight` DECIMAL(6, 2) NOT NULL DEFAULT 1,
    `owner_member_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `metric_source` JSON NOT NULL,
    `last_refreshed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_key_results_owner_user_id_objective_id_idx`(`owner_user_id`, `objective_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_progress_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `kr_id` INTEGER NOT NULL DEFAULT 0,
    `objective_id` INTEGER NOT NULL DEFAULT 0,
    `before` DECIMAL(16, 4) NOT NULL DEFAULT 0,
    `after` DECIMAL(16, 4) NOT NULL DEFAULT 0,
    `progress` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `author_id` VARCHAR(64) NOT NULL DEFAULT '',
    `ref_type` VARCHAR(32) NOT NULL DEFAULT '',
    `ref_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `okr_progress_logs_owner_user_id_kr_id_idx`(`owner_user_id`, `kr_id`),
    INDEX `okr_progress_logs_owner_user_id_created_at_idx`(`owner_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_metric_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `kr_id` INTEGER NOT NULL,
    `value` DECIMAL(16, 4) NOT NULL DEFAULT 0,
    `captured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `okr_metric_snapshots_kr_id_captured_at_idx`(`kr_id`, `captured_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `objective_id` INTEGER NOT NULL DEFAULT 0,
    `kr_id` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(200) NOT NULL,
    `detail` VARCHAR(2000) NOT NULL DEFAULT '',
    `kind` VARCHAR(8) NOT NULL DEFAULT 'ADHOC',
    `period_key` VARCHAR(16) NOT NULL DEFAULT '',
    `start_date` DATE NULL,
    `due_date` DATE NULL,
    `priority` VARCHAR(8) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(16) NOT NULL DEFAULT 'TODO',
    `progress` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `schedule_id` INTEGER NOT NULL DEFAULT 0,
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `done_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_plans_owner_user_id_member_user_id_kind_period_key_idx`(`owner_user_id`, `member_user_id`, `kind`, `period_key`),
    INDEX `okr_plans_owner_user_id_status_idx`(`owner_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `period_key` VARCHAR(16) NOT NULL,
    `content` JSON NOT NULL,
    `auto_draft` JSON NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `schedule_id` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `submitted_at` DATETIME(3) NULL,
    `manager_comment` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_reports_owner_user_id_kind_period_key_idx`(`owner_user_id`, `kind`, `period_key`),
    UNIQUE INDEX `okr_reports_owner_user_id_member_user_id_kind_period_key_key`(`owner_user_id`, `member_user_id`, `kind`, `period_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_scores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `cycle_id` INTEGER NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `reviewer_user_id` VARCHAR(64) NOT NULL,
    `scores` JSON NOT NULL,
    `total` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `comment` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `submitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_scores_owner_user_id_cycle_id_member_user_id_idx`(`owner_user_id`, `cycle_id`, `member_user_id`),
    UNIQUE INDEX `okr_scores_owner_user_id_cycle_id_member_user_id_reviewer_us_key`(`owner_user_id`, `cycle_id`, `member_user_id`, `reviewer_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `managers` JSON NOT NULL,
    `default_visibility` VARCHAR(16) NOT NULL DEFAULT 'ORG',
    `week_start` INTEGER NOT NULL DEFAULT 1,
    `auto_draft_enabled` BOOLEAN NOT NULL DEFAULT true,
    `report_templates` JSON NOT NULL,
    `report_schedules` JSON NOT NULL,
    `score_dimensions` JSON NOT NULL,
    `metric_refresh_hour` INTEGER NOT NULL DEFAULT 5,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `okr_settings_owner_user_id_key`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oa_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `admin_user_ids` JSON NOT NULL,
    `dept_heads` JSON NOT NULL,
    `remind_after_hours` INTEGER NOT NULL DEFAULT 24,
    `allow_withdraw` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `oa_settings_org_type_org_user_id_key`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oa_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `category` VARCHAR(16) NOT NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `icon` VARCHAR(40) NOT NULL DEFAULT '',
    `number_prefix` VARCHAR(8) NOT NULL DEFAULT 'OA',
    `fields_schema` JSON NOT NULL,
    `flow_schema` JSON NOT NULL,
    `linkage_schema` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `builtin` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `oa_templates_org_type_org_user_id_enabled_sort_order_idx`(`org_type`, `org_user_id`, `enabled`, `sort_order`),
    UNIQUE INDEX `oa_templates_org_type_org_user_id_key_key`(`org_type`, `org_user_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oa_applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(32) NOT NULL,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `template_id` INTEGER NOT NULL,
    `template_version` INTEGER NOT NULL DEFAULT 1,
    `title` VARCHAR(200) NOT NULL DEFAULT '',
    `applicant_id` VARCHAR(64) NOT NULL,
    `applicant_name` VARCHAR(64) NOT NULL DEFAULT '',
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `form_data` JSON NOT NULL,
    `fields_snapshot` JSON NOT NULL,
    `flow_snapshot` JSON NOT NULL,
    `linkage_snapshot` JSON NOT NULL,
    `cc_user_ids` JSON NOT NULL,
    `attachments` JSON NOT NULL,
    `amount` DECIMAL(16, 2) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `current_node` INTEGER NOT NULL DEFAULT 0,
    `submitted_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `withdrawn_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `oa_applications_number_key`(`number`),
    INDEX `oa_applications_org_type_org_user_id_status_submitted_at_idx`(`org_type`, `org_user_id`, `status`, `submitted_at`),
    INDEX `oa_applications_org_type_org_user_id_template_id_idx`(`org_type`, `org_user_id`, `template_id`),
    INDEX `oa_applications_applicant_id_status_idx`(`applicant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oa_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `application_id` INTEGER NOT NULL,
    `node_index` INTEGER NOT NULL,
    `node_name` VARCHAR(60) NOT NULL DEFAULT '',
    `approver_id` VARCHAR(64) NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'ANY',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `action` VARCHAR(16) NOT NULL DEFAULT '',
    `comment` TEXT NOT NULL,
    `acted_at` DATETIME(3) NULL,
    `delegated_from` VARCHAR(64) NOT NULL DEFAULT '',
    `pre_review` JSON NOT NULL,
    `reminded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oa_tasks_approver_id_status_idx`(`approver_id`, `status`),
    INDEX `oa_tasks_application_id_node_index_idx`(`application_id`, `node_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oa_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `application_id` INTEGER NOT NULL,
    `node_index` INTEGER NOT NULL DEFAULT 0,
    `action` VARCHAR(16) NOT NULL,
    `operator_id` VARCHAR(64) NOT NULL,
    `operator_name` VARCHAR(64) NOT NULL DEFAULT '',
    `comment` TEXT NOT NULL,
    `attachments` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oa_records_application_id_created_at_idx`(`application_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oa_cc` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `application_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oa_cc_user_id_read_at_idx`(`user_id`, `read_at`),
    UNIQUE INDEX `oa_cc_application_id_user_id_key`(`application_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oa_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `application_id` INTEGER NOT NULL,
    `target_type` VARCHAR(32) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `result` JSON NOT NULL,
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `executed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oa_links_application_id_status_idx`(`application_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_hall_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `scope` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `org_kind` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `author_user_id` VARCHAR(64) NOT NULL,
    `author_name` VARCHAR(60) NOT NULL,
    `reply_count` INTEGER NOT NULL DEFAULT 0,
    `last_reply_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,
    `latest_summary_id` INTEGER NOT NULL DEFAULT 0,
    `closed_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `question_hall_questions_scope_status_last_reply_at_idx`(`scope`, `status`, `last_reply_at`),
    INDEX `question_hall_questions_org_kind_org_user_id_status_idx`(`org_kind`, `org_user_id`, `status`),
    INDEX `question_hall_questions_author_user_id_status_idx`(`author_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_hall_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `parent_id` INTEGER NOT NULL DEFAULT 0,
    `body` TEXT NOT NULL,
    `author_kind` VARCHAR(8) NOT NULL DEFAULT 'PERSON',
    `persona_id` INTEGER NOT NULL DEFAULT 0,
    `author_label` VARCHAR(80) NOT NULL,
    `author_user_id` VARCHAR(64) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `question_hall_messages_question_id_parent_id_created_at_idx`(`question_id`, `parent_id`, `created_at`),
    INDEX `question_hall_messages_author_user_id_created_at_idx`(`author_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_hall_summaries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `message_count` INTEGER NOT NULL,
    `truncated` BOOLEAN NOT NULL DEFAULT false,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `question_hall_summaries_question_id_seq_idx`(`question_id`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_connectors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `corp_id` VARCHAR(120) NOT NULL DEFAULT '',
    `app_id` VARCHAR(120) NOT NULL DEFAULT '',
    `app_secret_enc` TEXT NOT NULL,
    `agent_id` VARCHAR(64) NOT NULL DEFAULT '',
    `contact_secret_enc` TEXT NOT NULL,
    `verification_token` VARCHAR(120) NOT NULL DEFAULT '',
    `encrypt_key_enc` TEXT NOT NULL,
    `webhook_token` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `scopes` JSON NOT NULL,
    `last_verified_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `im_connectors_webhook_token_key`(`webhook_token`),
    INDEX `im_connectors_org_type_org_user_id_idx`(`org_type`, `org_user_id`),
    UNIQUE INDEX `im_connectors_org_type_org_user_id_provider_corp_id_key`(`org_type`, `org_user_id`, `provider`, `corp_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_member_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connector_id` INTEGER NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `external_user_id` VARCHAR(120) NOT NULL,
    `union_id` VARCHAR(120) NOT NULL DEFAULT '',
    `name_snapshot` VARCHAR(120) NOT NULL DEFAULT '',
    `mobile_snapshot` VARCHAR(40) NOT NULL DEFAULT '',
    `department_external_id` VARCHAR(120) NOT NULL DEFAULT '',
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `im_member_links_connector_id_member_user_id_idx`(`connector_id`, `member_user_id`),
    UNIQUE INDEX `im_member_links_connector_id_external_user_id_key`(`connector_id`, `external_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_dept_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connector_id` INTEGER NOT NULL,
    `department` VARCHAR(64) NOT NULL,
    `external_dept_id` VARCHAR(120) NOT NULL,
    `name` VARCHAR(120) NOT NULL DEFAULT '',
    `parent_external_id` VARCHAR(120) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `im_dept_links_connector_id_department_key`(`connector_id`, `department`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_object_bindings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connector_id` INTEGER NOT NULL,
    `module` VARCHAR(16) NOT NULL,
    `object_key` VARCHAR(120) NOT NULL,
    `direction` VARCHAR(8) NOT NULL DEFAULT 'PUSH',
    `config` JSON NOT NULL,
    `field_map` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_sync_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `im_object_bindings_connector_id_module_object_key_key`(`connector_id`, `module`, `object_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_object_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `binding_id` INTEGER NOT NULL,
    `module` VARCHAR(16) NOT NULL,
    `local_id` VARCHAR(120) NOT NULL,
    `external_id` VARCHAR(120) NOT NULL,
    `local_hash` VARCHAR(64) NOT NULL DEFAULT '',
    `external_hash` VARCHAR(64) NOT NULL DEFAULT '',
    `last_direction` VARCHAR(8) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'LINKED',
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `im_object_links_binding_id_external_id_idx`(`binding_id`, `external_id`),
    UNIQUE INDEX `im_object_links_binding_id_local_id_key`(`binding_id`, `local_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connector_id` INTEGER NOT NULL,
    `direction` VARCHAR(8) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `event_id` VARCHAR(160) NOT NULL,
    `object_type` VARCHAR(40) NOT NULL DEFAULT '',
    `object_id` VARCHAR(120) NOT NULL DEFAULT '',
    `payload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `im_events_connector_id_status_idx`(`connector_id`, `status`),
    UNIQUE INDEX `im_events_connector_id_event_id_key`(`connector_id`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_notify_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connector_id` INTEGER NOT NULL,
    `rules` JSON NOT NULL,
    `quiet_hours` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `im_notify_rules_connector_id_key`(`connector_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `city` VARCHAR(64) NOT NULL DEFAULT '',
    `gender` VARCHAR(16) NOT NULL DEFAULT 'UNSPECIFIED',
    `bio` TEXT NOT NULL,
    `lang` VARCHAR(8) NOT NULL DEFAULT 'zh',
    `visibility` JSON NOT NULL,
    `contacts` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sns_profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_friend_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `from_user_id` VARCHAR(64) NOT NULL,
    `to_user_id` VARCHAR(64) NOT NULL,
    `message` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `handled_at` DATETIME(3) NULL,

    INDEX `sns_friend_requests_to_user_id_status_idx`(`to_user_id`, `status`),
    UNIQUE INDEX `sns_friend_requests_from_user_id_to_user_id_key`(`from_user_id`, `to_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_friendships` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_a_id` VARCHAR(64) NOT NULL,
    `user_b_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_friendships_user_b_id_idx`(`user_b_id`),
    UNIQUE INDEX `sns_friendships_user_a_id_user_b_id_key`(`user_a_id`, `user_b_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_follows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `follower_id` VARCHAR(64) NOT NULL,
    `followee_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_follows_followee_id_idx`(`followee_id`),
    UNIQUE INDEX `sns_follows_follower_id_followee_id_key`(`follower_id`, `followee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_blocks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `blocked_user_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_blocks_blocked_user_id_idx`(`blocked_user_id`),
    UNIQUE INDEX `sns_blocks_user_id_blocked_user_id_key`(`user_id`, `blocked_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_mailboxes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `address` VARCHAR(160) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sns_mailboxes_user_id_key`(`user_id`),
    UNIQUE INDEX `sns_mailboxes_address_key`(`address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_mail_threads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_a_id` VARCHAR(64) NOT NULL,
    `user_b_id` VARCHAR(64) NOT NULL,
    `subject` VARCHAR(200) NOT NULL DEFAULT '',
    `last_message_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_mail_threads_user_b_id_last_message_at_idx`(`user_b_id`, `last_message_at`),
    INDEX `sns_mail_threads_user_a_id_last_message_at_idx`(`user_a_id`, `last_message_at`),
    UNIQUE INDEX `sns_mail_threads_user_a_id_user_b_id_key`(`user_a_id`, `user_b_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `thread_id` INTEGER NOT NULL,
    `from_user_id` VARCHAR(64) NOT NULL,
    `to_user_id` VARCHAR(64) NOT NULL,
    `subject` VARCHAR(200) NOT NULL DEFAULT '',
    `body` TEXT NOT NULL,
    `link_cards` JSON NOT NULL,
    `ai_generated` BOOLEAN NOT NULL DEFAULT false,
    `in_reply_to_id` INTEGER NULL,
    `read_user_ids` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_messages_thread_id_created_at_idx`(`thread_id`, `created_at`),
    INDEX `sns_messages_to_user_id_created_at_idx`(`to_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_experiences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(8) NOT NULL DEFAULT 'WORK',
    `organization` VARCHAR(120) NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `start_year` INTEGER NULL,
    `end_year` INTEGER NULL,
    `description` TEXT NOT NULL,
    `hide_from_peers` BOOLEAN NOT NULL DEFAULT false,
    `org_key` VARCHAR(120) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_experiences_user_id_kind_sort_idx`(`user_id`, `kind`, `sort`),
    INDEX `sns_experiences_kind_org_key_idx`(`kind`, `org_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_resumes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `headline` VARCHAR(120) NOT NULL DEFAULT '',
    `location` VARCHAR(64) NOT NULL DEFAULT '',
    `summary` TEXT NOT NULL,
    `objective_role` VARCHAR(120) NOT NULL DEFAULT '',
    `objective_city` VARCHAR(64) NOT NULL DEFAULT '',
    `objective_type` VARCHAR(16) NOT NULL DEFAULT '',
    `additional` TEXT NOT NULL,
    `contacts` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sns_resumes_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_resume_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `subtitle` VARCHAR(120) NOT NULL DEFAULT '',
    `start_year` INTEGER NULL,
    `end_year` INTEGER NULL,
    `description` TEXT NOT NULL,
    `url` VARCHAR(200) NOT NULL DEFAULT '',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_resume_items_user_id_kind_sort_idx`(`user_id`, `kind`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_posts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `body` TEXT NOT NULL,
    `visibility` VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_posts_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `sns_posts_visibility_created_at_idx`(`visibility`, `created_at`),
    INDEX `sns_posts_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(30) NOT NULL,
    `description` TEXT NOT NULL,
    `visibility` VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
    `join_policy` VARCHAR(16) NOT NULL DEFAULT 'FREE',
    `owner_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sns_groups_name_key`(`name`),
    INDEX `sns_groups_visibility_created_at_idx`(`visibility`, `created_at`),
    INDEX `sns_groups_owner_id_idx`(`owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_group_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'MEMBER',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_group_members_user_id_status_idx`(`user_id`, `status`),
    INDEX `sns_group_members_group_id_status_idx`(`group_id`, `status`),
    UNIQUE INDEX `sns_group_members_group_id_user_id_key`(`group_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_group_topics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` TEXT NOT NULL,
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `reply_count` INTEGER NOT NULL DEFAULT 0,
    `last_reply_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_group_topics_group_id_last_reply_at_idx`(`group_id`, `last_reply_at`),
    INDEX `sns_group_topics_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_group_replies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic_id` INTEGER NOT NULL,
    `group_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `floor` INTEGER NOT NULL DEFAULT 0,
    `body` TEXT NOT NULL,
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `reply_to_user_id` VARCHAR(64) NULL,
    `reply_to_floor` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_group_replies_topic_id_floor_idx`(`topic_id`, `floor`),
    INDEX `sns_group_replies_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_hiring_posts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'FULL_TIME',
    `title` VARCHAR(100) NOT NULL,
    `description` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_hiring_posts_type_created_at_idx`(`type`, `created_at`),
    INDEX `sns_hiring_posts_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reporter_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `target_user_id` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `handled_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `handled_at` DATETIME(3) NULL,

    INDEX `sns_reports_status_created_at_idx`(`status`, `created_at`),
    INDEX `sns_reports_target_user_id_idx`(`target_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_user_suspensions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(500) NOT NULL DEFAULT '',
    `suspended_by` VARCHAR(64) NOT NULL DEFAULT '',
    `lifted_at` DATETIME(3) NULL,
    `lifted_by` VARCHAR(64) NOT NULL DEFAULT '',
    `lift_note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_user_suspensions_user_id_lifted_at_idx`(`user_id`, `lifted_at`),
    INDEX `sns_user_suspensions_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_ai_grants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `allowed_actions` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_ai_grants_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_api_call_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `api_key_id` INTEGER NULL,
    `channel` VARCHAR(16) NOT NULL DEFAULT 'rest',
    `endpoint` VARCHAR(200) NOT NULL,
    `method` VARCHAR(10) NOT NULL,
    `status_code` INTEGER NOT NULL,
    `ip` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_api_call_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `sns_api_call_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_invite_accepts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `inviter_id` VARCHAR(64) NOT NULL,
    `invitee_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sns_invite_accepts_invitee_id_key`(`invitee_id`),
    INDEX `sns_invite_accepts_inviter_id_created_at_idx`(`inviter_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_batch_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job` VARCHAR(64) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    `trigger` VARCHAR(16) NOT NULL DEFAULT 'auto',
    `attempts` INTEGER NOT NULL DEFAULT 1,
    `units` INTEGER NOT NULL DEFAULT 0,
    `affected` INTEGER NOT NULL DEFAULT 0,
    `detail` VARCHAR(500) NOT NULL DEFAULT '',
    `last_error` VARCHAR(500) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `sns_batch_runs_day_idx`(`day`),
    UNIQUE INDEX `sns_batch_runs_job_day_key`(`job`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_user_mirror` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `username` VARCHAR(64) NOT NULL DEFAULT '',
    `display_name` VARCHAR(120) NOT NULL DEFAULT '',
    `email` VARCHAR(190) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `personal_intro` VARCHAR(500) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `source_created` DATETIME(3) NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sns_user_mirror_user_id_key`(`user_id`),
    INDEX `sns_user_mirror_enabled_user_id_idx`(`enabled`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_user_affinity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `viewer_id` VARCHAR(64) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `degree` INTEGER NOT NULL,
    `via_user_id` VARCHAR(64) NULL,
    `mutual_count` INTEGER NOT NULL DEFAULT 0,
    `score` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_user_affinity_viewer_id_score_idx`(`viewer_id`, `score`),
    UNIQUE INDEX `sns_user_affinity_viewer_id_target_id_key`(`viewer_id`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sns_notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `payload` JSON NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_notifications_user_id_read_at_idx`(`user_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_call_account_bindings` ADD CONSTRAINT `ai_call_account_bindings_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `ai_call_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_call_account_bindings` ADD CONSTRAINT `ai_call_account_bindings_workbuddy_account_id_fkey` FOREIGN KEY (`workbuddy_account_id`) REFERENCES `workbuddy_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `aliyun_call_import_rows` ADD CONSTRAINT `aliyun_call_import_rows_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `aliyun_call_imports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `aliyun_mail_import_rows` ADD CONSTRAINT `aliyun_mail_import_rows_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `aliyun_mail_imports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tp_task_events` ADD CONSTRAINT `tp_task_events_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tp_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sns_messages` ADD CONSTRAINT `sns_messages_thread_id_fkey` FOREIGN KEY (`thread_id`) REFERENCES `sns_mail_threads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

