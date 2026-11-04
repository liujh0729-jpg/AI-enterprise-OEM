-- 创意社区（Comfy Cloud 工作流市场）：
--   1) community_workflows——官方模板与用户发布同表共陈；format=api 才可站内直接运行，
--      format=ui（Comfy Cloud 拒收的 UI/save 格式）只作浏览与下载。
--   2) community_runs / community_run_outputs——一次提交对应一个上游 job；
--      产物必须转存本站 OSS（上游签名 URL 约 6 小时过期且内容端点要带 Key）。
--   3) community_favorites / community_likes——[userId, workflowId] 唯一，重复点击幂等。
--   4) comfy_credentials——纯 BYOK：用户自带 Key 密文入库，keyMask 供展示，原文永不回传。
-- JSON 列不写字面默认值（MySQL 错误 1101），默认值由 Prisma 层 @default 兜住。

-- CreateTable: community_workflows
CREATE TABLE `community_workflows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'USER',
    `owner_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `owner_name` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `summary` VARCHAR(500) NOT NULL DEFAULT '',
    `description` TEXT NOT NULL,
    `category` VARCHAR(16) NOT NULL DEFAULT 'image',
    `group_label` VARCHAR(64) NOT NULL DEFAULT '',
    `tags` JSON NOT NULL,
    `media_type` VARCHAR(16) NOT NULL DEFAULT 'image',
    `format` VARCHAR(8) NOT NULL DEFAULT 'api',
    `workflow_json` JSON NOT NULL,
    `slots` JSON NOT NULL,
    `cover_keys` JSON NOT NULL,
    `comfy_url` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `audit_note` VARCHAR(500) NOT NULL DEFAULT '',
    `audited_at` DATETIME(3) NULL,
    `audit_by` VARCHAR(64) NOT NULL DEFAULT '',
    `rewarded_at` DATETIME(3) NULL,
    `run_count` INTEGER NOT NULL DEFAULT 0,
    `favorite_count` INTEGER NOT NULL DEFAULT 0,
    `like_count` INTEGER NOT NULL DEFAULT 0,
    `view_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `community_workflows_code_key`(`code`),
    INDEX `community_workflows_status_created_at_idx`(`status`, `created_at`),
    INDEX `community_workflows_category_status_idx`(`category`, `status`),
    INDEX `community_workflows_source_status_idx`(`source`, `status`),
    INDEX `community_workflows_owner_user_id_status_idx`(`owner_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: community_runs
CREATE TABLE `community_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workflow_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `job_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `progress_current` INTEGER NOT NULL DEFAULT 0,
    `progress_total` INTEGER NOT NULL DEFAULT 0,
    `queue_position` INTEGER NOT NULL DEFAULT 0,
    `inputs` JSON NOT NULL,
    `error_text` VARCHAR(500) NOT NULL DEFAULT '',
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `community_runs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `community_runs_workflow_id_idx`(`workflow_id`),
    INDEX `community_runs_job_id_idx`(`job_id`),
    INDEX `community_runs_status_updated_at_idx`(`status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: community_run_outputs
CREATE TABLE `community_run_outputs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'image',
    `name` VARCHAR(200) NOT NULL DEFAULT '',
    `oss_key` VARCHAR(500) NOT NULL DEFAULT '',
    `url` TEXT NOT NULL,
    `size_bytes` BIGINT NOT NULL DEFAULT 0,
    `asset_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `community_run_outputs_run_id_idx`(`run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: community_favorites
CREATE TABLE `community_favorites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `workflow_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `community_favorites_user_id_workflow_id_key`(`user_id`, `workflow_id`),
    INDEX `community_favorites_workflow_id_idx`(`workflow_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: community_likes
CREATE TABLE `community_likes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `workflow_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `community_likes_user_id_workflow_id_key`(`user_id`, `workflow_id`),
    INDEX `community_likes_workflow_id_idx`(`workflow_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: comfy_credentials
CREATE TABLE `comfy_credentials` (
    `user_id` VARCHAR(64) NOT NULL,
    `key_cipher` TEXT NOT NULL,
    `key_mask` VARCHAR(64) NOT NULL DEFAULT '',
    `verified_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
