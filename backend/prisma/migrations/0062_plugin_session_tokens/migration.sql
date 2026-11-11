-- 插件会话令牌落库（B6 / P1-5）：只存哈希，重启进程或多实例部署下仍按同一份状态校验。
-- 过期靠 expires_at 判定，无需定时清理；org_type / org_user_id 保留原组织作用域。
CREATE TABLE `plugin_session_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token_hash` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `scope` VARCHAR(32) NOT NULL DEFAULT '',
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `plugin_session_tokens_token_hash_key`(`token_hash`),
    INDEX `plugin_session_tokens_user_id_idx`(`user_id`),
    INDEX `plugin_session_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
