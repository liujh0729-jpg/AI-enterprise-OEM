-- 营销问卷与调研（营销工具）：题目设计 + 公开分享码；回收答案写入多维表格（table_id）。

CREATE TABLE `marketing_surveys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `questions` JSON NOT NULL,
    `settings` JSON NOT NULL,
    `table_id` INTEGER NOT NULL,
    `response_count` INTEGER NOT NULL DEFAULT 0,
    `published_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `marketing_surveys_code_key`(`code`),
    INDEX `marketing_surveys_created_by_updated_at_idx`(`created_by`, `updated_at`),
    INDEX `marketing_surveys_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
