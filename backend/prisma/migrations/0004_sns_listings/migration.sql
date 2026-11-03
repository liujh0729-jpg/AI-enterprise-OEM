-- 供求广场帖表（设计 §4.2 / M6）：社交板通用发布需求/服务，本地免 Key 发布，勾选则同步 AIworkin。
-- CreateTable
CREATE TABLE `sns_listings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `author_user_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `tags` JSON NOT NULL,
    `money_mode` VARCHAR(16) NULL,
    `amount_min` INTEGER NULL,
    `amount_max` INTEGER NULL,
    `currency` VARCHAR(16) NOT NULL DEFAULT 'AWCOIN',
    `province` VARCHAR(50) NOT NULL DEFAULT '',
    `city` VARCHAR(50) NOT NULL DEFAULT '',
    `contact_note` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(24) NOT NULL DEFAULT 'LOCAL_PUBLISHED',
    `aiworkin_demand_no` VARCHAR(64) NOT NULL DEFAULT '',
    `aiworkin_listing_no` VARCHAR(64) NOT NULL DEFAULT '',
    `published_upstream` BOOLEAN NOT NULL DEFAULT false,
    `subcategory_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sns_listings_author_user_id_created_at_idx`(`author_user_id`, `created_at`),
    INDEX `sns_listings_type_status_created_at_idx`(`type`, `status`, `created_at`),
    INDEX `sns_listings_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
