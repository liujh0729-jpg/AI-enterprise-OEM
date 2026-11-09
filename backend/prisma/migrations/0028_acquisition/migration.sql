-- AI 获客（营销工具）：监控源/采集批次/线索/证据/触达/档案/时间线/剧本/版本/跟进/回执/质检/组织设置。
-- 组织键沿用全仓口径 org_type VARCHAR(16) DEFAULT ENTERPRISE + org_user_id VARCHAR(64)。
-- 表间引用用普通 INT 列（与本仓既有模块一致），删除级联在服务层做。

-- CreateTable
CREATE TABLE `acq_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `collect_enabled` BOOLEAN NOT NULL DEFAULT true,
    `qc_enabled` BOOLEAN NOT NULL DEFAULT true,
    `outreach_auto_send` BOOLEAN NOT NULL DEFAULT false,
    `human_confirm` BOOLEAN NOT NULL DEFAULT true,
    `daily_comments` INTEGER NOT NULL DEFAULT 20,
    `daily_dm` INTEGER NOT NULL DEFAULT 30,
    `cooldown_days` INTEGER NOT NULL DEFAULT 7,
    `interval_min_seconds` INTEGER NOT NULL DEFAULT 20,
    `interval_max_seconds` INTEGER NOT NULL DEFAULT 60,
    `active_hours_start` VARCHAR(5) NOT NULL DEFAULT '09:00',
    `active_hours_end` VARCHAR(5) NOT NULL DEFAULT '21:00',
    `evidence_retention_days` INTEGER NOT NULL DEFAULT 180,
    `follow_up_max_rounds` INTEGER NOT NULL DEFAULT 2,
    `default_playbook_id` INTEGER NOT NULL DEFAULT 0,
    `ai_model` VARCHAR(128) NOT NULL DEFAULT '',
    `ai_channel_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `acq_settings_org_type_org_user_id_key`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_sources` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `platform` VARCHAR(20) NOT NULL,
    `mode` VARCHAR(20) NOT NULL,
    `query` JSON NOT NULL,
    `filters` JSON NOT NULL,
    `cron` VARCHAR(60) NOT NULL DEFAULT '',
    `daily_limit` INTEGER NOT NULL DEFAULT 200,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `last_run_at` DATETIME(3) NULL,
    `next_run_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `acq_sources_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `acq_sources_status_next_run_at_idx`(`status`, `next_run_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `source_id` INTEGER NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    `job_id` VARCHAR(120) NOT NULL DEFAULT '',
    `claimed_at` DATETIME(3) NULL,
    `heartbeat_at` DATETIME(3) NULL,
    `stats` JSON NOT NULL,
    `error` TEXT NOT NULL DEFAULT (''),
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `acq_runs_source_id_started_at_idx`(`source_id`, `started_at`),
    INDEX `acq_runs_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    UNIQUE INDEX `acq_runs_job_id_key`(`job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_leads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `platform` VARCHAR(20) NOT NULL,
    `platform_user_id` VARCHAR(120) NOT NULL,
    `nickname` VARCHAR(120) NOT NULL DEFAULT '',
    `profile_url` VARCHAR(500) NOT NULL DEFAULT '',
    `intent_score` INTEGER NOT NULL DEFAULT 0,
    `intent_level` VARCHAR(8) NOT NULL DEFAULT 'COLD',
    `intent_tags` JSON NOT NULL,
    `score_mode` VARCHAR(8) NOT NULL DEFAULT 'rule',
    `score_reason` TEXT NOT NULL DEFAULT (''),
    `opening` TEXT NOT NULL DEFAULT (''),
    `risk` VARCHAR(300) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'NEW',
    `block_reason` VARCHAR(300) NOT NULL DEFAULT '',
    `owner_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `crm_lead_id` INTEGER NOT NULL DEFAULT 0,
    `dedupe_key` VARCHAR(200) NOT NULL,
    `evidence_count` INTEGER NOT NULL DEFAULT 0,
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `acq_leads_org_type_org_user_id_status_intent_score_idx`(`org_type`, `org_user_id`, `status`, `intent_score`),
    INDEX `acq_leads_org_type_org_user_id_platform_idx`(`org_type`, `org_user_id`, `platform`),
    UNIQUE INDEX `acq_leads_org_type_org_user_id_dedupe_key_key`(`org_type`, `org_user_id`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_lead_evidence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lead_id` INTEGER NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `run_id` INTEGER NOT NULL DEFAULT 0,
    `source_type` VARCHAR(20) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `excerpt` TEXT NOT NULL,
    `summary` VARCHAR(500) NOT NULL DEFAULT '',
    `metrics` JSON NOT NULL,
    `captured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `acq_lead_evidence_org_type_org_user_id_captured_at_idx`(`org_type`, `org_user_id`, `captured_at`),
    UNIQUE INDEX `acq_lead_evidence_lead_id_url_key`(`lead_id`, `url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_outreach_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `lead_id` INTEGER NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `target_url` VARCHAR(500) NOT NULL DEFAULT '',
    `external_user_id` VARCHAR(160) NOT NULL DEFAULT '',
    `draft` TEXT NOT NULL,
    `final_text` TEXT NOT NULL DEFAULT (''),
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `moderation` VARCHAR(16) NOT NULL DEFAULT '',
    `moderation_note` TEXT NOT NULL DEFAULT (''),
    `blocked_reason` VARCHAR(300) NOT NULL DEFAULT '',
    `job_id` VARCHAR(120) NOT NULL DEFAULT '',
    `payload` JSON NOT NULL,
    `cost_confirmed` BOOLEAN NOT NULL DEFAULT false,
    `playbook_id` INTEGER NOT NULL DEFAULT 0,
    `scheduled_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `receipt_status` VARCHAR(20) NOT NULL DEFAULT '',
    `receipt_ref` VARCHAR(160) NOT NULL DEFAULT '',
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `logs` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `acq_outreach_tasks_org_type_org_user_id_status_scheduled_at_idx`(`org_type`, `org_user_id`, `status`, `scheduled_at`),
    INDEX `acq_outreach_tasks_lead_id_channel_sent_at_idx`(`lead_id`, `channel`, `sent_at`),
    INDEX `acq_outreach_tasks_job_id_idx`(`job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `crm_lead_id` INTEGER NOT NULL DEFAULT 0,
    `channel_peer_key` VARCHAR(200) NOT NULL DEFAULT '',
    `display_name` VARCHAR(120) NOT NULL DEFAULT '',
    `business_status` VARCHAR(20) NOT NULL DEFAULT 'free',
    `purpose` VARCHAR(200) NOT NULL DEFAULT '',
    `source` VARCHAR(60) NOT NULL DEFAULT '',
    `budget` VARCHAR(80) NOT NULL DEFAULT '',
    `timeline` VARCHAR(80) NOT NULL DEFAULT '',
    `decision_role` VARCHAR(40) NOT NULL DEFAULT '',
    `objections` JSON NOT NULL,
    `tags` JSON NOT NULL,
    `health_score` INTEGER NOT NULL DEFAULT 60,
    `owner_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `next_action_at` DATETIME(3) NULL,
    `last_contact_at` DATETIME(3) NULL,
    `pinned_version` INTEGER NOT NULL DEFAULT 0,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `acq_profiles_org_type_org_user_id_business_status_idx`(`org_type`, `org_user_id`, `business_status`),
    INDEX `acq_profiles_crm_lead_id_idx`(`crm_lead_id`),
    UNIQUE INDEX `acq_profiles_org_type_org_user_id_channel_peer_key_key`(`org_type`, `org_user_id`, `channel_peer_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_profile_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `profile_id` INTEGER NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `ref_id` INTEGER NOT NULL DEFAULT 0,
    `summary` VARCHAR(500) NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `acq_profile_events_profile_id_created_at_idx`(`profile_id`, `created_at`),
    INDEX `acq_profile_events_org_type_org_user_id_kind_idx`(`org_type`, `org_user_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_playbooks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `goal` VARCHAR(120) NOT NULL DEFAULT '',
    `persona` JSON NOT NULL,
    `boundaries` JSON NOT NULL,
    `escalation` JSON NOT NULL,
    `openers` JSON NOT NULL,
    `objections` JSON NOT NULL,
    `kb_ids` JSON NOT NULL,
    `faq_ids` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `current_version` INTEGER NOT NULL DEFAULT 1,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `acq_playbooks_org_type_org_user_id_name_key`(`org_type`, `org_user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_playbook_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `playbook_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `published_at` DATETIME(3) NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `acq_playbook_versions_playbook_id_version_key`(`playbook_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_follow_ups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `profile_id` INTEGER NOT NULL,
    `channel_peer_key` VARCHAR(200) NOT NULL,
    `external_user_id` VARCHAR(160) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `account_id` VARCHAR(80) NOT NULL DEFAULT '',
    `follow_up_at` DATETIME(3) NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `context_summary` TEXT NOT NULL DEFAULT (''),
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `sent_text` TEXT NOT NULL DEFAULT (''),
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `playbook_id` INTEGER NOT NULL DEFAULT 0,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `acq_follow_ups_org_type_org_user_id_status_follow_up_at_idx`(`org_type`, `org_user_id`, `status`, `follow_up_at`),
    INDEX `acq_follow_ups_profile_id_status_idx`(`profile_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_follow_up_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `follow_up_id` INTEGER NOT NULL,
    `attempt` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `account_id` VARCHAR(80) NOT NULL DEFAULT '',
    `operation_id` VARCHAR(160) NOT NULL DEFAULT '',
    `status` VARCHAR(20) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `acq_follow_up_receipts_follow_up_id_attempt_key`(`follow_up_id`, `attempt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acq_qc_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `conversation_id` INTEGER NOT NULL,
    `agent_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `playbook_id` INTEGER NOT NULL DEFAULT 0,
    `score` INTEGER NOT NULL DEFAULT 0,
    `dimensions` JSON NOT NULL,
    `issues` JSON NOT NULL,
    `suggestions` JSON NOT NULL,
    `mode` VARCHAR(8) NOT NULL DEFAULT 'rule',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `acq_qc_reviews_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    INDEX `acq_qc_reviews_conversation_id_idx`(`conversation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
