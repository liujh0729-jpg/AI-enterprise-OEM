-- 平台微信服务号：绑定关系、一次性场景、推送记录与回调幂等。
-- 敏感配置（AppSecret / EncodingAESKey）存 system_settings 的 AES-GCM 密文，不落表。

CREATE TABLE `wechat_mp_bindings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `open_id` VARCHAR(64) NOT NULL,
    `union_id` VARCHAR(64) NULL,
    `nickname` VARCHAR(120) NOT NULL DEFAULT '',
    `avatar_url` VARCHAR(500) NOT NULL DEFAULT '',
    `subscribed` BOOLEAN NOT NULL DEFAULT true,
    `subscribed_at` DATETIME(3) NULL,
    `unsubscribed_at` DATETIME(3) NULL,
    `push_muted` BOOLEAN NOT NULL DEFAULT false,
    `last_interaction_at` DATETIME(3) NULL,
    `source` VARCHAR(24) NOT NULL DEFAULT 'qrcode',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wechat_mp_bindings_user_id_key`(`user_id`),
    UNIQUE INDEX `wechat_mp_bindings_open_id_key`(`open_id`),
    INDEX `wechat_mp_bindings_union_id_idx`(`union_id`),
    INDEX `wechat_mp_bindings_subscribed_updated_at_idx`(`subscribed`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_mp_bind_scenes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scene` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wechat_mp_bind_scenes_scene_key`(`scene`),
    INDEX `wechat_mp_bind_scenes_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `wechat_mp_bind_scenes_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_mp_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `open_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `event_key` VARCHAR(48) NOT NULL DEFAULT '',
    `template_id` VARCHAR(64) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL DEFAULT '',
    `content` TEXT NOT NULL,
    `link` VARCHAR(500) NOT NULL DEFAULT '',
    `payload` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `errcode` INTEGER NULL,
    `errmsg` VARCHAR(300) NOT NULL DEFAULT '',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `msg_id` VARCHAR(64) NOT NULL DEFAULT '',
    `entity_type` VARCHAR(32) NOT NULL DEFAULT '',
    `entity_id` VARCHAR(64) NOT NULL DEFAULT '',
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wechat_mp_messages_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `wechat_mp_messages_status_created_at_idx`(`status`, `created_at`),
    INDEX `wechat_mp_messages_event_key_created_at_idx`(`event_key`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_mp_inbound_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `msg_id` VARCHAR(96) NOT NULL,
    `open_id` VARCHAR(64) NOT NULL,
    `msg_type` VARCHAR(24) NOT NULL DEFAULT '',
    `event` VARCHAR(32) NOT NULL DEFAULT '',
    `event_key` VARCHAR(64) NOT NULL DEFAULT '',
    `payload` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wechat_mp_inbound_events_msg_id_key`(`msg_id`),
    INDEX `wechat_mp_inbound_events_open_id_created_at_idx`(`open_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
