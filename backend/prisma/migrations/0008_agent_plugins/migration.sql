-- Agent 插件：上传插件包（plugin.json / PLUGIN.md）或从 SkillHub 插件目录安装
CREATE TABLE `content_agent_plugins` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `files` JSON NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'upload',
    `source_slug` VARCHAR(120) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_agent_plugins_user_id_enabled_idx`(`user_id`, `enabled`),
    UNIQUE INDEX `content_agent_plugins_user_id_name_key`(`user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;