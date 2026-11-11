-- 0087 浏览器代理计划任务（docs/浏览器代理插件升级方案.md §七 P5）：
-- 到点让本人某台「在线」的本地 Chrome 设备按同一套会话引擎跑一个目标。
-- 绿灯闸：设备离线（插件没开）当轮跳过、不补跑；账号停用即自动暂停（isStanding 复权）。
CREATE TABLE `rpa_chrome_schedules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `client_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(80) NOT NULL,
    `goal` TEXT NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'act',
    `start_url` VARCHAR(2000) NOT NULL DEFAULT '',
    `script` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `max_steps` INTEGER NOT NULL DEFAULT 25,
    `schedule_type` VARCHAR(16) NOT NULL DEFAULT 'recurring',
    `schedule_config` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `scheduled_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'enabled',
    `last_run_at` DATETIME(3) NULL,
    `last_status` VARCHAR(16) NOT NULL DEFAULT '',
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `last_session_id` INTEGER NOT NULL DEFAULT 0,
    `run_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rpa_chrome_schedules_created_by_status_idx`(`created_by`, `status`),
    INDEX `rpa_chrome_schedules_status_schedule_type_scheduled_at_idx`(`status`, `schedule_type`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
