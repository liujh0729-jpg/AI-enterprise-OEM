-- AlterTable
ALTER TABLE `ai_call_accounts` MODIFY `password_cipher` TEXT NOT NULL,
    MODIFY `api_key_cipher` TEXT NOT NULL,
    MODIFY `cookie_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `aliyun_call_import_rows` MODIFY `error_message` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `aliyun_call_imports` MODIFY `error_message` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `aliyun_call_settings` MODIFY `access_key_secret_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `aliyun_mail_import_rows` MODIFY `error_message` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `aliyun_mail_imports` MODIFY `error_message` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `aliyun_mail_settings` MODIFY `access_key_secret_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `api_keys` MODIFY `key_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `bi_chat_messages` MODIFY `question` TEXT NOT NULL,
    MODIFY `sql_text` TEXT NOT NULL,
    MODIFY `analysis` TEXT NOT NULL,
    MODIFY `error` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `bi_dataset_fields` MODIFY `expression` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `bi_dataset_permissions` MODIFY `row_filter` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `bi_datasets` MODIFY `sql_text` TEXT NOT NULL,
    MODIFY `description` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `bi_datasources` MODIFY `config_cipher` TEXT NOT NULL,
    MODIFY `last_error` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `bi_query_logs` MODIFY `sql_text` TEXT NOT NULL,
    MODIFY `error` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `bi_terms` MODIFY `definition` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `bigdata_query_tasks` MODIFY `raw_intent` TEXT NOT NULL,
    MODIFY `error` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_assistant_channels` MODIFY `config_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_assistant_messages` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_experts` MODIFY `instruction` TEXT NOT NULL,
    MODIFY `prompt` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_library_drafts` MODIFY `before` TEXT NOT NULL,
    MODIFY `after` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_library_items` MODIFY `url` TEXT NOT NULL,
    MODIFY `text` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_mcp_connectors` MODIFY `headers` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_messages` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_schedules` MODIFY `instruction` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_agent_skills` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_generation_jobs` MODIFY `asset_url` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_model_channels` MODIFY `key_cipher` TEXT NOT NULL,
    MODIFY `asr_key_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `content_shared_assets` MODIFY `asset_url` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_approval_records` MODIFY `comment` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_approval_tasks` MODIFY `comment` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_business_titles` MODIFY `remark` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_contracts` MODIFY `remark` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_customers` MODIFY `remark` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_follow_plans` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_follow_records` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_invoices` MODIFY `remark` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_leads` MODIFY `remark` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_orders` MODIFY `remark` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_products` MODIFY `description` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `crm_settings` MODIFY `ai_analysis_guide` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `data_table_feishu_sync_logs` MODIFY `message` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `data_table_feishu_syncs` MODIFY `encrypt_key_cipher` TEXT NOT NULL,
    MODIFY `last_error` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `digital_asset_entries` MODIFY `url` TEXT NOT NULL,
    MODIFY `preview_url` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `im_connectors` MODIFY `app_secret_enc` TEXT NOT NULL,
    MODIFY `contact_secret_enc` TEXT NOT NULL,
    MODIFY `encrypt_key_enc` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `lead_prospecting_settings` MODIFY `serper_key_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `lead_prospecting_tasks` MODIFY `raw_intent` TEXT NOT NULL,
    MODIFY `error` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `mail_accounts` MODIFY `signature` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `marketing_qr_children` MODIFY `text_content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `marketing_qr_codes` MODIFY `note` TEXT NOT NULL,
    MODIFY `disabled_reason` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `marketing_qr_domains` MODIFY `last_error` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `body` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `oa_records` MODIFY `comment` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `oa_tasks` MODIFY `comment` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `org_applications` MODIFY `capabilities` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `org_staff` MODIFY `capabilities` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `rpa_accounts` MODIFY `proxy_password_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `rpa_settings` MODIFY `bitbrowser_api_key_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `rpa_task_executions` MODIFY `log_text` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `service_desk_channels` MODIFY `cursor` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `service_desk_messages` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `service_desk_settings` MODIFY `welcome_text` TEXT NOT NULL,
    MODIFY `queue_text` TEXT NOT NULL,
    MODIFY `offline_text` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `sns_experiences` MODIFY `description` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `sns_groups` MODIFY `description` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `sns_profiles` MODIFY `bio` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `sns_resume_items` MODIFY `description` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `sns_resumes` MODIFY `summary` TEXT NOT NULL,
    MODIFY `additional` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `tp_accounts` MODIFY `secret_key_cipher` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `workbuddy_plans` MODIFY `raw_input` TEXT NOT NULL,
    MODIFY `summary` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `workbuddy_task_events` MODIFY `content` TEXT NOT NULL,
    MODIFY `tool_input` TEXT NOT NULL,
    MODIFY `tool_output` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `workbuddy_tasks` MODIFY `instruction` TEXT NOT NULL;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `email` VARCHAR(160) NULL,
    `phone` VARCHAR(32) NULL,
    `password_hash` VARCHAR(128) NULL,
    `email_verified` TINYINT NOT NULL DEFAULT 0,
    `phone_verified` TINYINT NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `ban_reason` VARCHAR(255) NULL,
    `must_change_password` TINYINT NOT NULL DEFAULT 0,
    `token_version` INTEGER NOT NULL DEFAULT 0,
    `last_login_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `avatar` VARCHAR(512) NULL,
    `intro` VARCHAR(500) NULL,
    `lang` VARCHAR(16) NOT NULL DEFAULT 'zh',
    `role` VARCHAR(24) NOT NULL DEFAULT 'USER',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verify_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scene` VARCHAR(24) NOT NULL,
    `channel` VARCHAR(12) NOT NULL,
    `target` VARCHAR(160) NOT NULL,
    `code_hash` VARCHAR(64) NOT NULL,
    `fail_count` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `verify_codes_channel_target_scene_idx`(`channel`, `target`, `scene`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account` VARCHAR(160) NOT NULL,
    `user_id` VARCHAR(64) NULL,
    `success` TINYINT NOT NULL,
    `reason` VARCHAR(120) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_logs_account_created_at_idx`(`account`, `created_at`),
    INDEX `login_logs_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aipdd_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key_fingerprint` VARCHAR(64) NOT NULL,
    `key_cipher` TEXT NOT NULL,
    `aipdd_user_id` VARCHAR(64) NULL,
    `aipdd_profile` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `last_verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `aipdd_keys_key_fingerprint_key`(`key_fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_aipdd_bindings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `key_id` INTEGER NOT NULL,
    `bound_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_aipdd_bindings_user_id_key`(`user_id`),
    INDEX `user_aipdd_bindings_key_id_idx`(`key_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

