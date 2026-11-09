-- 企微 SCRM（《企微SCRM一体化方案》§6）：客户以企微为源、本库为镜像；原生 SCRM 为唯一同步源。
-- 组织键沿用 (org_type, org_user_id)；凭据一律加密落库（服务层 AES-256-GCM）。
-- 表间引用用普通 INT 列，级联在服务层做（与 collab / acquisition 口径一致）。

-- CreateTable
CREATE TABLE `scrm_corps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `corp_id` VARCHAR(64) NOT NULL,
    `corp_name` VARCHAR(120) NOT NULL DEFAULT '',
    `agent_id` VARCHAR(32) NOT NULL DEFAULT '',
    `contact_secret_enc` TEXT NOT NULL,
    `app_secret_enc` TEXT NOT NULL,
    `callback_token_enc` TEXT NOT NULL,
    `aes_key_enc` TEXT NOT NULL,
    `callback_key` VARCHAR(32) NOT NULL,
    `archive_secret_enc` TEXT NOT NULL,
    `archive_private_key_enc` LONGTEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `sync_source` VARCHAR(16) NOT NULL DEFAULT 'SCRM',
    `qidian_paused` BOOLEAN NOT NULL DEFAULT false,
    `last_sync_at` DATETIME(3) NULL,
    `last_sync_result` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_corps_org_key`(`org_type`, `org_user_id`),
    UNIQUE INDEX `scrm_corps_callback_key_key`(`callback_key`),
    INDEX `scrm_corps_org_status_idx`(`org_type`, `org_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `external_user_id` VARCHAR(64) NOT NULL,
    `union_id` VARCHAR(64) NOT NULL DEFAULT '',
    `name` VARCHAR(120) NOT NULL DEFAULT '',
    `avatar` VARCHAR(500) NOT NULL DEFAULT '',
    `gender` VARCHAR(8) NOT NULL DEFAULT '',
    `region` VARCHAR(80) NOT NULL DEFAULT '',
    `remark` VARCHAR(200) NOT NULL DEFAULT '',
    `description` VARCHAR(1000) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `source_code_id` INTEGER NOT NULL DEFAULT 0,
    `source_code_name` VARCHAR(60) NOT NULL DEFAULT '',
    `added_at` DATETIME(3) NULL,
    `lost_at` DATETIME(3) NULL,
    `lost_reason` VARCHAR(200) NOT NULL DEFAULT '',
    `last_interaction_at` DATETIME(3) NULL,
    `crm_lead_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_contacts_org_ext_key`(`org_type`, `org_user_id`, `external_user_id`),
    INDEX `scrm_contacts_org_status_added_idx`(`org_type`, `org_user_id`, `status`, `added_at`),
    INDEX `scrm_contacts_org_last_idx`(`org_type`, `org_user_id`, `last_interaction_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_contact_staff` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `contact_id` INTEGER NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `external_staff_id` VARCHAR(64) NOT NULL DEFAULT '',
    `relation` VARCHAR(16) NOT NULL DEFAULT 'OWNER',
    `added_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `scrm_contact_staff_key`(`contact_id`, `staff_user_id`),
    INDEX `scrm_contact_staff_org_staff_idx`(`org_type`, `org_user_id`, `staff_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_contact_fields` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `label` VARCHAR(40) NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'TEXT',
    `options` JSON NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `builtin` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_fields_org_key`(`org_type`, `org_user_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_contact_field_values` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `contact_id` INTEGER NOT NULL,
    `field_key` VARCHAR(40) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_field_values_contact_key`(`contact_id`, `field_key`),
    INDEX `scrm_field_values_org_field_idx`(`org_type`, `org_user_id`, `field_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_tag_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `external_id` VARCHAR(64) NOT NULL DEFAULT '',
    `name` VARCHAR(60) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `deleted` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_tag_groups_org_ext_key`(`org_type`, `org_user_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `group_id` INTEGER NOT NULL DEFAULT 0,
    `external_id` VARCHAR(64) NOT NULL DEFAULT '',
    `name` VARCHAR(60) NOT NULL,
    `color` VARCHAR(16) NOT NULL DEFAULT '',
    `source` VARCHAR(16) NOT NULL DEFAULT 'WECOM',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `usage_count` INTEGER NOT NULL DEFAULT 0,
    `deleted` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_tags_org_ext_key`(`org_type`, `org_user_id`, `external_id`),
    INDEX `scrm_tags_org_group_idx`(`org_type`, `org_user_id`, `group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_contact_tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `contact_id` INTEGER NOT NULL,
    `tag_id` INTEGER NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `scrm_contact_tags_key`(`contact_id`, `tag_id`),
    INDEX `scrm_contact_tags_org_tag_idx`(`org_type`, `org_user_id`, `tag_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_auto_tag_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `event` VARCHAR(16) NOT NULL,
    `conditions` JSON NOT NULL,
    `tag_ids` JSON NOT NULL,
    `code_ids` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_auto_tag_org_event_idx`(`org_type`, `org_user_id`, `event`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `group_name` VARCHAR(40) NOT NULL DEFAULT '',
    `config_id` VARCHAR(64) NOT NULL DEFAULT '',
    `qr_url` VARCHAR(1000) NOT NULL DEFAULT '',
    `scene` VARCHAR(40) NOT NULL DEFAULT '',
    `tag_ids` JSON NOT NULL,
    `welcome_id` INTEGER NOT NULL DEFAULT 0,
    `staff_strategy` VARCHAR(16) NOT NULL DEFAULT 'ROUND_ROBIN',
    `daily_limit` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `scanned` INTEGER NOT NULL DEFAULT 0,
    `added` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_codes_org_status_idx`(`org_type`, `org_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_code_staff` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `code_id` INTEGER NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `weight` INTEGER NOT NULL DEFAULT 1,
    `daily_limit` INTEGER NOT NULL DEFAULT 0,
    `used_today` INTEGER NOT NULL DEFAULT 0,
    `used_date` VARCHAR(10) NOT NULL DEFAULT '',

    UNIQUE INDEX `scrm_code_staff_key`(`code_id`, `staff_user_id`),
    INDEX `scrm_code_staff_org_staff_idx`(`org_type`, `org_user_id`, `staff_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_welcomes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `scope` VARCHAR(16) NOT NULL DEFAULT 'ALL',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `material_ids` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_welcomes_org_enabled_idx`(`org_type`, `org_user_id`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_chats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `chat_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL DEFAULT '',
    `owner_staff_id` VARCHAR(64) NOT NULL DEFAULT '',
    `group_id` INTEGER NOT NULL DEFAULT 0,
    `member_count` INTEGER NOT NULL DEFAULT 0,
    `max_members` INTEGER NOT NULL DEFAULT 200,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `notice` TEXT NOT NULL,
    `synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_chats_org_chat_key`(`org_type`, `org_user_id`, `chat_id`),
    INDEX `scrm_chats_org_group_idx`(`org_type`, `org_user_id`, `group_id`),
    INDEX `scrm_chats_org_owner_idx`(`org_type`, `org_user_id`, `owner_staff_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_chat_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `chat_id` INTEGER NOT NULL,
    `contact_id` INTEGER NOT NULL DEFAULT 0,
    `external_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `name` VARCHAR(120) NOT NULL DEFAULT '',
    `role` VARCHAR(16) NOT NULL DEFAULT 'MEMBER',
    `join_at` DATETIME(3) NULL,
    `leave_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `scrm_chat_members_key`(`chat_id`, `external_user_id`),
    INDEX `scrm_chat_members_org_contact_idx`(`org_type`, `org_user_id`, `contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_chat_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_chat_groups_org_name_key`(`org_type`, `org_user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_room_pulls` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `chat_ids` JSON NOT NULL,
    `welcome_id` INTEGER NOT NULL DEFAULT 0,
    `tag_ids` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `invited` INTEGER NOT NULL DEFAULT 0,
    `joined` INTEGER NOT NULL DEFAULT 0,
    `last_run_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_room_pulls_org_created_idx`(`org_type`, `org_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_mass_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `target_filter` JSON NOT NULL,
    `content` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `scheduled_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `reviewer_id` VARCHAR(64) NOT NULL DEFAULT '',
    `reviewed_at` DATETIME(3) NULL,
    `review_note` VARCHAR(300) NOT NULL DEFAULT '',
    `external_job_id` VARCHAR(64) NOT NULL DEFAULT '',
    `total` INTEGER NOT NULL DEFAULT 0,
    `sent` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `unknown` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_mass_org_status_idx`(`org_type`, `org_user_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_mass_targets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `task_id` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'CONTACT',
    `target_id` INTEGER NOT NULL DEFAULT 0,
    `target_name` VARCHAR(120) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `staff_name` VARCHAR(120) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `error` VARCHAR(300) NOT NULL DEFAULT '',
    `msg_id` VARCHAR(64) NOT NULL DEFAULT '',
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `scrm_mass_targets_task_status_idx`(`task_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_transfers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `target_id` INTEGER NOT NULL DEFAULT 0,
    `target_name` VARCHAR(120) NOT NULL DEFAULT '',
    `from_staff_id` VARCHAR(64) NOT NULL DEFAULT '',
    `from_staff_name` VARCHAR(120) NOT NULL DEFAULT '',
    `to_staff_id` VARCHAR(64) NOT NULL,
    `to_staff_name` VARCHAR(120) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `fail_reason` VARCHAR(300) NOT NULL DEFAULT '',
    `external_job_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_transfers_org_type_idx`(`org_type`, `org_user_id`, `type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_sops` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `trigger` VARCHAR(16) NOT NULL,
    `trigger_config` JSON NOT NULL,
    `actions` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_sops_org_enabled_idx`(`org_type`, `org_user_id`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_sop_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `sop_id` INTEGER NOT NULL,
    `contact_id` INTEGER NOT NULL DEFAULT 0,
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `due_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `result` VARCHAR(1000) NOT NULL DEFAULT '',
    `reminded_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_sop_tasks_org_status_idx`(`org_type`, `org_user_id`, `status`, `due_at`),
    INDEX `scrm_sop_tasks_org_contact_idx`(`org_type`, `org_user_id`, `contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_sensitive_words` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `group_name` VARCHAR(40) NOT NULL DEFAULT '',
    `word` VARCHAR(100) NOT NULL,
    `action` VARCHAR(16) NOT NULL DEFAULT 'BLOCK',
    `direction` VARCHAR(16) NOT NULL DEFAULT 'OUTBOUND',
    `replacement` VARCHAR(100) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_words_org_word_dir_key`(`org_type`, `org_user_id`, `word`, `direction`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_sensitive_hits` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `word` VARCHAR(100) NOT NULL,
    `group_name` VARCHAR(40) NOT NULL DEFAULT '',
    `direction` VARCHAR(16) NOT NULL,
    `contact_id` INTEGER NOT NULL DEFAULT 0,
    `contact_name` VARCHAR(120) NOT NULL DEFAULT '',
    `staff_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `text` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `scrm_hits_org_created_idx`(`org_type`, `org_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_stat_daily` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `added` INTEGER NOT NULL DEFAULT 0,
    `lost` INTEGER NOT NULL DEFAULT 0,
    `net` INTEGER NOT NULL DEFAULT 0,
    `mass_sent` INTEGER NOT NULL DEFAULT 0,
    `mass_delivered` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scrm_stat_daily_org_day_key`(`org_type`, `org_user_id`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_materials` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'TEXT',
    `title` VARCHAR(80) NOT NULL,
    `content` TEXT NOT NULL,
    `asset_id` INTEGER NOT NULL DEFAULT 0,
    `link` VARCHAR(500) NOT NULL DEFAULT '',
    `mini_program` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `scrm_materials_org_type_idx`(`org_type`, `org_user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scrm_timeline_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `contact_id` INTEGER NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `detail` TEXT NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `scrm_timeline_org_contact_idx`(`org_type`, `org_user_id`, `contact_id`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
