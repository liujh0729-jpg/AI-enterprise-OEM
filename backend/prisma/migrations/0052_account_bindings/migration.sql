-- 第三方登录绑定（微信扫码登录/注册）：一个账号可绑多个来源，同一来源内 openid 唯一；
-- userId 存 users.id 的字符串形式（与全系统 userId 口径一致），不建外键。
CREATE TABLE `account_bindings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(24) NOT NULL,
    `open_id` VARCHAR(64) NOT NULL,
    `union_id` VARCHAR(64) NULL,
    `nickname` VARCHAR(64) NULL,
    `avatar_url` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `account_bindings_provider_open_id_key`(`provider`, `open_id`),
    INDEX `account_bindings_user_id_idx`(`user_id`),
    INDEX `account_bindings_provider_union_id_idx`(`provider`, `union_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
