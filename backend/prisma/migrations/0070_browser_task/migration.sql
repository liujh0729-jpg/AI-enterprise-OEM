-- 0070 平台统一浏览器任务（设计 §10.3 / §10.7）：服务器创建、插件认领的持久队列 + 认领租约 + 结果回执。
-- 页面关闭 / 插件或服务重启后任务不丢：未终结任务留在队列，租约到期可被重新认领；
-- 同来源同时只允许一个未终结任务，防止多标签页重复执行；回执口径与契约 BROWSER_RECEIPT_STATUSES 对齐。
CREATE TABLE `browser_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `capability` VARCHAR(32) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `job_id` VARCHAR(80) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `platforms` JSON NOT NULL,
    `source` VARCHAR(120) NOT NULL DEFAULT '',
    `payload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    `lease_owner` VARCHAR(64) NOT NULL DEFAULT '',
    `lease_expires_at` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `receipt_status` VARCHAR(16) NOT NULL DEFAULT '',
    `receipt_code` VARCHAR(40) NOT NULL DEFAULT '',
    `receipt_message` VARCHAR(500) NOT NULL DEFAULT '',
    `results` JSON NOT NULL,
    `evidence` JSON NOT NULL,
    `plugin_version` VARCHAR(20) NOT NULL DEFAULT '',
    `expires_at` DATETIME(3) NULL,
    `enqueued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimed_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `browser_tasks_user_id_job_id_key`(`user_id`, `job_id`),
    INDEX `browser_tasks_user_id_status_enqueued_at_idx`(`user_id`, `status`, `enqueued_at`),
    INDEX `browser_tasks_source_status_idx`(`source`, `status`),
    INDEX `browser_tasks_status_lease_expires_at_idx`(`status`, `lease_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
