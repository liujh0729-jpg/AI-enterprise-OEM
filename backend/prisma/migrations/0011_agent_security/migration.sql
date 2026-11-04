-- Agent 安全加固：
--   1) content_agent_schedules.allow_write——无人值守默认不许执行写动作，
--      要放开只能逐个定时任务显式勾选（旧行一律 false，等于立刻收紧历史任务）。
--   2) content_agent_revisions——技能/插件同名覆盖前把旧内容存一份，可查可回滚，
--      防止第三方包静默替换后无从追溯。

-- AlterTable: content_agent_schedules
ALTER TABLE `content_agent_schedules`
    ADD COLUMN `allow_write` BOOLEAN NOT NULL DEFAULT false AFTER `mailbox_ids`;

-- CreateTable: content_agent_revisions
CREATE TABLE `content_agent_revisions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `item_id` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `files` JSON NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_agent_revisions_user_id_kind_item_id_idx`(`user_id`, `kind`, `item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
