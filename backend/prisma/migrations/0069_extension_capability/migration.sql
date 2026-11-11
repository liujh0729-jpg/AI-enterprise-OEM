-- 0069 平台统一插件能力目录覆盖（设计 §10.7）：能力定义在契约（EXTENSION_CAPABILITIES），
-- 本表只存平台级覆盖——启用 / 灰度 / 强制升级 / 下线；无行即回落契约默认值。
CREATE TABLE `extension_capabilities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT '',
    `min_version` VARCHAR(20) NOT NULL DEFAULT '',
    `gray_org_ids` JSON NOT NULL,
    `force_upgrade_at` DATETIME(3) NULL,
    `note` VARCHAR(300) NOT NULL DEFAULT '',
    `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `extension_capabilities_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
