-- 0072 本地 Chrome 插件设备与动作指令队列（方案 §5.1 / §5.2）：
-- 插件用本站账号登录后成为该用户名下的一台设备（令牌只存 sha256 哈希，明文只在登录响应出现一次）；
-- 云端把闭集动作写进指令队列，插件心跳顺带领取、按 commandCode 幂等回执。
CREATE TABLE `rpa_chrome_devices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `client_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL DEFAULT '',
    `domain` VARCHAR(200) NOT NULL DEFAULT '',
    `token_hash` VARCHAR(64) NOT NULL,
    `extension_version` VARCHAR(24) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    `pages` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `last_seen_at` DATETIME(3) NULL,
    `last_ip` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rpa_chrome_devices_created_by_client_id_key`(`created_by`, `client_id`),
    INDEX `rpa_chrome_devices_created_by_status_idx`(`created_by`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rpa_chrome_commands` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `client_id` VARCHAR(64) NOT NULL,
    `session_id` INTEGER NOT NULL DEFAULT 0,
    `step_index` INTEGER NOT NULL DEFAULT 0,
    `command_code` VARCHAR(40) NOT NULL,
    `action` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `confirm_state` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `result` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `dispatched_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rpa_chrome_commands_command_code_key`(`command_code`),
    INDEX `rpa_chrome_commands_client_id_status_id_idx`(`client_id`, `status`, `id`),
    INDEX `rpa_chrome_commands_session_id_step_index_idx`(`session_id`, `step_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
