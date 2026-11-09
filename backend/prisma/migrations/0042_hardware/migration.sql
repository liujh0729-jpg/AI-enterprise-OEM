-- 智能硬件（一级栏目）：型号目录 / 开发包 / 设备 / 事件 / 工具 / 工具授权 六张表。
-- 表间引用用普通 INT 列（与本仓既有模块一致，不建外键），删除级联在服务层做。
-- 与平台 MCP 完全隔离：工具、授权都在这里自成一套，平台侧不读写本批表。

-- CreateTable
CREATE TABLE `hw_models` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(48) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `vendor` VARCHAR(60) NOT NULL DEFAULT '',
    `chip` VARCHAR(60) NOT NULL DEFAULT '',
    `category` VARCHAR(40) NOT NULL DEFAULT '',
    `summary` VARCHAR(500) NOT NULL DEFAULT '',
    `cover_url` VARCHAR(500) NOT NULL DEFAULT '',
    `spec` JSON NOT NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hw_models_code_key`(`code`),
    INDEX `hw_models_enabled_sort_order_idx`(`enabled`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hw_dev_kits` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `model_id` INTEGER NOT NULL,
    `version` VARCHAR(40) NOT NULL,
    `channel` VARCHAR(8) NOT NULL DEFAULT 'STABLE',
    `file_name` VARCHAR(160) NOT NULL,
    `file_size` INTEGER NOT NULL DEFAULT 0,
    `oss_key` VARCHAR(400) NOT NULL,
    `sha256` VARCHAR(64) NOT NULL DEFAULT '',
    `changelog` VARCHAR(1000) NOT NULL DEFAULT '',
    `doc_url` VARCHAR(500) NOT NULL DEFAULT '',
    `min_firmware` VARCHAR(40) NOT NULL DEFAULT '',
    `download_count` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hw_dev_kits_model_id_version_key`(`model_id`, `version`),
    INDEX `hw_dev_kits_model_id_enabled_idx`(`model_id`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hw_devices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `model_id` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `serial_no` VARCHAR(80) NOT NULL DEFAULT '',
    `token_hash` VARCHAR(64) NOT NULL,
    `token_prefix` VARCHAR(16) NOT NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'NEVER',
    `last_seen_at` DATETIME(3) NULL,
    `last_ip` VARCHAR(64) NOT NULL DEFAULT '',
    `firmware_version` VARCHAR(40) NOT NULL DEFAULT '',
    `meta` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hw_devices_token_hash_key`(`token_hash`),
    INDEX `hw_devices_user_id_model_id_idx`(`user_id`, `model_id`),
    INDEX `hw_devices_status_last_seen_at_idx`(`status`, `last_seen_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hw_device_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `device_id` INTEGER NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `direction` VARCHAR(4) NOT NULL,
    `command_code` VARCHAR(64) NOT NULL DEFAULT '',
    `payload_json` JSON NOT NULL,
    `ok` BOOLEAN NOT NULL DEFAULT true,
    `latency_ms` INTEGER NOT NULL DEFAULT 0,
    `message` VARCHAR(300) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hw_device_events_device_id_created_at_idx`(`device_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hw_tools` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `model_id` INTEGER NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `scope` VARCHAR(8) NOT NULL DEFAULT 'DEFAULT',
    `owner_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `transport` VARCHAR(8) NOT NULL DEFAULT 'DEVICE',
    `method` VARCHAR(8) NOT NULL DEFAULT 'POST',
    `path` VARCHAR(300) NOT NULL DEFAULT '',
    `command_code` VARCHAR(64) NOT NULL DEFAULT '',
    `params_json` JSON NOT NULL,
    `response_json` JSON NOT NULL,
    `examples_json` JSON NOT NULL,
    `write` BOOLEAN NOT NULL DEFAULT false,
    `requires_grant` BOOLEAN NOT NULL DEFAULT true,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hw_tools_model_id_kind_scope_owner_user_id_code_key`(`model_id`, `kind`, `scope`, `owner_user_id`, `code`),
    INDEX `hw_tools_model_id_kind_enabled_idx`(`model_id`, `kind`, `enabled`),
    INDEX `hw_tools_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hw_tool_grants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `tool_id` INTEGER NOT NULL,
    `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hw_tool_grants_user_id_tool_id_key`(`user_id`, `tool_id`),
    INDEX `hw_tool_grants_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
