-- 0088 AI 编程（docs/AI编程（后台自助改码）设计方案.md §八）：
-- 模型只在暂存区改码 → 人工审阅差异 → 复用平台升级执行器做「备份 → 构建 → 迁移 → 重启 → 健康检查」。
-- 会话 / 消息 / 变更三张表；升级任务表补来源字段，用于按 AI 编程会话过滤任务。
CREATE TABLE `ai_code_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `model` VARCHAR(200) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `staging_dir` VARCHAR(500) NOT NULL DEFAULT '',
    `job_id` INTEGER NULL,
    `last_message` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_code_sessions_owner_id_updated_at_idx`(`owner_id`, `updated_at`),
    INDEX `ai_code_sessions_status_updated_at_idx`(`status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_code_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `session_id` INTEGER NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `model` VARCHAR(200) NOT NULL DEFAULT '',
    `references_json` TEXT NULL,
    `tool_calls_json` LONGTEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DONE',
    `error` VARCHAR(1000) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_code_messages_session_id_id_idx`(`session_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_code_edits` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `session_id` INTEGER NOT NULL,
    `path` VARCHAR(400) NOT NULL,
    `change_type` VARCHAR(16) NOT NULL,
    `old_sha` VARCHAR(64) NOT NULL DEFAULT '',
    `new_sha` VARCHAR(64) NOT NULL DEFAULT '',
    `bytes` INTEGER NOT NULL DEFAULT 0,
    `diff` LONGTEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `applied_job_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_code_edits_session_id_path_key`(`session_id`, `path`),
    INDEX `ai_code_edits_session_id_status_idx`(`session_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `platform_upgrade_jobs`
    ADD COLUMN `source_kind` VARCHAR(16) NOT NULL DEFAULT 'UPGRADE',
    ADD COLUMN `source_ref_id` INTEGER NULL;
