-- 0073 本地 Chrome 会话与逐步留痕（方案 §5.3 / §8）：
-- 一次会话＝一个 goal，由云端 LLM 逐步决策（或回放确定性动作序列），插件执行并回页面观测。
-- 每一步的观测（页面地图 / 截图 key）留痕，供界面回放、人工接管与事后审计。
CREATE TABLE `rpa_chrome_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `client_id` VARCHAR(64) NOT NULL,
    `task_id` INTEGER NOT NULL DEFAULT 0,
    `goal` TEXT NOT NULL,
    `start_url` VARCHAR(2000) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    `step_count` INTEGER NOT NULL DEFAULT 0,
    `max_steps` INTEGER NOT NULL DEFAULT 25,
    `model` VARCHAR(128) NOT NULL DEFAULT '',
    `stop_reason` VARCHAR(32) NOT NULL DEFAULT '',
    `error_message` VARCHAR(500) NOT NULL DEFAULT '',
    `script` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rpa_chrome_sessions_created_by_status_created_at_idx`(`created_by`, `status`, `created_at`),
    INDEX `rpa_chrome_sessions_client_id_status_idx`(`client_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rpa_chrome_steps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `session_id` INTEGER NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `step_index` INTEGER NOT NULL,
    `command_code` VARCHAR(40) NOT NULL DEFAULT '',
    `action` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `thought` VARCHAR(1000) NOT NULL DEFAULT '',
    `observation` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `screenshot_key` VARCHAR(200) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    `elapsed_ms` INTEGER NOT NULL DEFAULT 0,
    `error_message` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rpa_chrome_steps_session_id_step_index_key`(`session_id`, `step_index`),
    INDEX `rpa_chrome_steps_session_id_created_at_idx`(`session_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
