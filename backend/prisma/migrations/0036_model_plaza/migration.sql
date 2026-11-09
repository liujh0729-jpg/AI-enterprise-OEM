-- 模型广场：平台级上游渠道 + 可售模型目录（输入/输出双价）+ 用量流水。
-- 纯按量计费，不设采购授权表；AIPDD 内置系列用 upstream_id=0 表示，凭据取平台级 AIPDD Key。

CREATE TABLE `model_upstreams` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(24) NOT NULL DEFAULT 'LocalAPI',
    `base_url` VARCHAR(300) NOT NULL,
    `key_cipher` VARCHAR(1024) NOT NULL DEFAULT '',
    `protocol` VARCHAR(16) NOT NULL DEFAULT 'openai',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(200) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `model_upstreams_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `model_catalog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `upstream_id` INTEGER NOT NULL DEFAULT 0,
    `provider` VARCHAR(24) NOT NULL DEFAULT 'AIPDD',
    `model_key` VARCHAR(128) NOT NULL,
    `upstream_model_key` VARCHAR(128) NOT NULL DEFAULT '',
    `display_name` VARCHAR(128) NOT NULL DEFAULT '',
    `vendor` VARCHAR(64) NOT NULL DEFAULT '',
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `quota_type` VARCHAR(16) NOT NULL DEFAULT 'TOKEN',
    `input_rmb_price` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `output_rmb_price` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `call_rmb_price` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `input_points_price` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `output_points_price` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `call_points_price` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `context_window` INTEGER NOT NULL DEFAULT 0,
    `max_output_tokens` INTEGER NOT NULL DEFAULT 0,
    `modalities` JSON NOT NULL,
    `endpoints` JSON NOT NULL,
    `tags` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `remark` VARCHAR(200) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `model_catalog_upstream_id_idx`(`upstream_id`),
    INDEX `model_catalog_enabled_sort_idx`(`enabled`, `sort`),
    UNIQUE INDEX `model_catalog_provider_model_key_key`(`provider`, `model_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `model_usage_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `catalog_id` INTEGER NULL,
    `upstream_id` INTEGER NOT NULL DEFAULT 0,
    `provider` VARCHAR(24) NOT NULL DEFAULT '',
    `model_key` VARCHAR(128) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `api_key_id` INTEGER NULL,
    `request_id` VARCHAR(64) NOT NULL DEFAULT '',
    `ref_id` VARCHAR(64) NOT NULL DEFAULT '',
    `endpoint` VARCHAR(64) NOT NULL DEFAULT '',
    `prompt_tokens` INTEGER NOT NULL DEFAULT 0,
    `completion_tokens` INTEGER NOT NULL DEFAULT 0,
    `total_tokens` INTEGER NOT NULL DEFAULT 0,
    `points_cost` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `rmb_cost` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `elapsed_ms` INTEGER NOT NULL DEFAULT 0,
    `is_stream` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    `message` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `model_usage_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `model_usage_logs_catalog_id_created_at_idx`(`catalog_id`, `created_at`),
    INDEX `model_usage_logs_api_key_id_created_at_idx`(`api_key_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;