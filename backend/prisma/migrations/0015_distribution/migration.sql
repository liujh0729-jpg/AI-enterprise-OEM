-- 多平台内容分发（营销工具 → AIPDD Enterprise 插件）：
--   1) distribution_contents——内容台账（标题/正文/图片清单/勾选平台/是否自动发布），按登录账号归属；
--   2) distribution_publish_logs——逐平台发布结果，由页面收到插件回调后上报（EXTENSION）或人工补记（MANUAL）。
-- JSON 列不写字面默认值（MySQL 错误 1101），默认值由服务层保证；删除台账时由服务层事务清理 logs（与既有迁移一致，不建外键）。

-- CreateTable: distribution_contents
CREATE TABLE `distribution_contents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NOT NULL,
    `media_type` VARCHAR(16) NOT NULL DEFAULT 'MOMENT',
    `images` JSON NOT NULL,
    `platform_codes` JSON NOT NULL,
    `auto_publish` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `tags` VARCHAR(200) NOT NULL DEFAULT '',
    `last_distributed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `distribution_contents_user_id_updated_at_idx`(`user_id`, `updated_at`),
    INDEX `distribution_contents_user_id_media_type_status_idx`(`user_id`, `media_type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: distribution_publish_logs
CREATE TABLE `distribution_publish_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `content_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `platform_code` VARCHAR(32) NOT NULL,
    `platform_name` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL,
    `published_url` VARCHAR(500) NOT NULL DEFAULT '',
    `error_msg` VARCHAR(500) NOT NULL DEFAULT '',
    `source` VARCHAR(16) NOT NULL DEFAULT 'EXTENSION',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `distribution_publish_logs_content_id_created_at_idx`(`content_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
