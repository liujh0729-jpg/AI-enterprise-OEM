-- 0079 浏览器代理（侧边栏 Agent）（docs/浏览器代理插件升级方案.md §八）：
-- 插件把「一句话目标 → 多步操作」的编排放在插件侧，云端只存台账与消息流，用于跨设备查看、
-- 审计与额度对账；另加技能库（personal/site）、录制→工具两组本账号私有资产。
CREATE TABLE `rpa_chrome_agents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `client_id` VARCHAR(64) NOT NULL,
    `client_agent_id` VARCHAR(64) NOT NULL DEFAULT '',
    `mode` VARCHAR(16) NOT NULL DEFAULT 'act',
    `goal` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    `step_count` INTEGER NOT NULL DEFAULT 0,
    `max_steps` INTEGER NOT NULL DEFAULT 25,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `credits` INTEGER NOT NULL DEFAULT 0,
    `stop_reason` VARCHAR(32) NOT NULL DEFAULT '',
    `error_message` VARCHAR(500) NOT NULL DEFAULT '',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rpa_chrome_agents_created_by_client_id_client_agent_id_key`(`created_by`, `client_id`, `client_agent_id`),
    INDEX `rpa_chrome_agents_created_by_status_created_at_idx`(`created_by`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rpa_chrome_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `role` VARCHAR(16) NOT NULL DEFAULT 'agent',
    `kind` VARCHAR(16) NOT NULL DEFAULT 'text',
    `content` TEXT NOT NULL,
    `payload` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `screenshot_key` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rpa_chrome_messages_agent_id_seq_key`(`agent_id`, `seq`),
    INDEX `rpa_chrome_messages_agent_id_created_at_idx`(`agent_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rpa_chrome_skills` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'personal',
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `site` VARCHAR(200) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rpa_chrome_skills_created_by_name_key`(`created_by`, `name`),
    INDEX `rpa_chrome_skills_created_by_kind_updated_at_idx`(`created_by`, `kind`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rpa_chrome_recordings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `site` VARCHAR(200) NOT NULL DEFAULT '',
    `actions` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `step_count` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rpa_chrome_recordings_created_by_name_key`(`created_by`, `name`),
    INDEX `rpa_chrome_recordings_created_by_updated_at_idx`(`created_by`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
