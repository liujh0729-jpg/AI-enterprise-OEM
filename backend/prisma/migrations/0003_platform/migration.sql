-- M4：服务商展示表（数据源在 AIworkin，展示权在本系统）
CREATE TABLE `provider_display` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `aiworkin_provider_id` VARCHAR(64) NOT NULL,
    `snapshot` JSON NULL,
    `visible` BOOLEAN NOT NULL DEFAULT false,
    `sort_weight` INTEGER NOT NULL DEFAULT 0,
    `admin_note` VARCHAR(500) NOT NULL DEFAULT '',
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `provider_display_aiworkin_provider_id_key`(`aiworkin_provider_id`),
    INDEX `provider_display_visible_sort_weight_idx`(`visible`, `sort_weight`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
