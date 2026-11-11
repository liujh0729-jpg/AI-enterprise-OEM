-- 商务社交 AIworkin 赋能（方案 §4）：身份映射、同步偏好、outbox、映射表、推荐快照与负反馈。
-- 只改写本地 sns_* 表，不触碰上游；PostgreSQL 侧由 schema.postgres.prisma 生成后 db push。

ALTER TABLE `sns_friend_requests`
    ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'LOCAL',
    ADD COLUMN `upstream_request_id` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `sync_state` VARCHAR(16) NOT NULL DEFAULT 'NONE';

ALTER TABLE `sns_friendships`
    ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'LOCAL',
    ADD COLUMN `sync_state` VARCHAR(16) NOT NULL DEFAULT 'NONE';

ALTER TABLE `sns_messages`
    ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'LOCAL',
    ADD COLUMN `upstream_message_id` VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN `sync_state` VARCHAR(16) NOT NULL DEFAULT 'NONE';

CREATE TABLE `social_upstream_identities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `key_id` INTEGER NOT NULL,
    `upstream_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `upstream_username` VARCHAR(120) NOT NULL DEFAULT '',
    `state` VARCHAR(24) NOT NULL DEFAULT 'UNBOUND',
    `profile_snapshot` JSON NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `social_upstream_identities_user_id_key`(`user_id`),
    INDEX `social_upstream_identities_upstream_user_id_idx`(`upstream_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `social_sync_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `discoverable` BOOLEAN NOT NULL DEFAULT true,
    `recommend_enabled` BOOLEAN NOT NULL DEFAULT true,
    `business_reason_visible` BOOLEAN NOT NULL DEFAULT true,
    `friend_request_outbound` BOOLEAN NOT NULL DEFAULT true,
    `friend_relation_outbound` BOOLEAN NOT NULL DEFAULT true,
    `friend_relation_inbound` BOOLEAN NOT NULL DEFAULT false,
    `mail_outbound_default` BOOLEAN NOT NULL DEFAULT false,
    `mail_inbound` BOOLEAN NOT NULL DEFAULT false,
    `channel` VARCHAR(16) NOT NULL DEFAULT 'AUTO',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `social_sync_preferences_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `social_sync_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `key_id` INTEGER NOT NULL,
    `direction` VARCHAR(16) NOT NULL DEFAULT 'OUTBOUND',
    `action` VARCHAR(32) NOT NULL,
    `local_type` VARCHAR(32) NOT NULL DEFAULT '',
    `local_id` VARCHAR(64) NOT NULL DEFAULT '',
    `payload` JSON NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `locked_at` DATETIME(3) NULL,
    `last_error` VARCHAR(1000) NOT NULL DEFAULT '',
    `remote_id` VARCHAR(120) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `social_sync_jobs_idempotency_key_key`(`idempotency_key`),
    INDEX `social_sync_jobs_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `social_sync_jobs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `social_sync_jobs_key_id_created_at_idx`(`key_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `social_sync_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `local_id` VARCHAR(64) NOT NULL,
    `remote_id` VARCHAR(120) NOT NULL DEFAULT '',
    `remote_parent_id` VARCHAR(120) NOT NULL DEFAULT '',
    `direction` VARCHAR(16) NOT NULL DEFAULT 'OUTBOUND',
    `state` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `content_hash` VARCHAR(64) NOT NULL DEFAULT '',
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `social_sync_links_user_id_kind_local_id_key`(`user_id`, `kind`, `local_id`),
    INDEX `social_sync_links_user_id_kind_remote_id_idx`(`user_id`, `kind`, `remote_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `social_affinity_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `target_user_id` VARCHAR(64) NOT NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `reasons` JSON NOT NULL,
    `signals` JSON NOT NULL,
    `computed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `social_affinity_snapshots_user_id_target_user_id_key`(`user_id`, `target_user_id`),
    INDEX `social_affinity_snapshots_user_id_score_idx`(`user_id`, `score`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `social_recommendation_feedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `target_user_id` VARCHAR(64) NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `social_recommendation_feedback_user_id_target_user_id_key`(`user_id`, `target_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
