-- 0089 AI 画布（docs/AI画布与创作工作台设计方案.md §四）：
-- 主表存完整画布 JSON 快照；版本 / 作者 / 状态 / 模板 / 资源引用摘要拆独立列并建索引，不做节点分表。
-- 任务表补画布维度与调度池所需字段（source/canvas_id/node_id/run_id/media/progress/cancel_reason）。
CREATE TABLE `content_canvas_projects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(80) NOT NULL DEFAULT '未命名画布',
    `doc` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `template_id` INTEGER NOT NULL DEFAULT 0,
    `asset_refs` JSON NOT NULL,
    `node_count` INTEGER NOT NULL DEFAULT 0,
    `cover_url` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_canvas_projects_user_id_updated_at_idx`(`user_id`, `updated_at`),
    INDEX `content_canvas_projects_user_id_status_idx`(`user_id`, `status`),
    INDEX `content_canvas_projects_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `content_generation_jobs`
    ADD COLUMN `source` VARCHAR(12) NOT NULL DEFAULT 'tool',
    ADD COLUMN `canvas_id` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `node_id` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `run_id` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `media` VARCHAR(12) NOT NULL DEFAULT '',
    ADD COLUMN `progress` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `cancel_reason` VARCHAR(200) NOT NULL DEFAULT '';

CREATE INDEX `content_generation_jobs_status_id_idx` ON `content_generation_jobs`(`status`, `id`);
CREATE INDEX `content_generation_jobs_canvas_id_idx` ON `content_generation_jobs`(`canvas_id`);
