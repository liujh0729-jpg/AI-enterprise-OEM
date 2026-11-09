-- 平台直连板块（财税 / 供销 / 出海 / 供需市场）的本地发布台账。
-- 平台把写出收口到 MCP（REST 写 401），也没有按属主读回挂单的接口
-- （`/market/listings/mine` 对 API Key 一律 401），所以「我发布的」以本表为准：
-- 提交时经 MCP 发布拿到平台挂单号后落一行，列表按 listingId 逐个读回平台挂单。

-- CreateTable
CREATE TABLE `market_listing_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `domain` VARCHAR(16) NOT NULL,
    `direction` VARCHAR(16) NOT NULL,
    `listing_id` VARCHAR(64) NOT NULL,
    `match_run_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    `title` VARCHAR(200) NOT NULL DEFAULT '',
    `sub_category_id` VARCHAR(64) NOT NULL DEFAULT '',
    `snapshot` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `market_listing_records_user_id_listing_id_key`(`user_id`, `listing_id`),
    INDEX `market_listing_records_user_id_domain_direction_idx`(`user_id`, `domain`, `direction`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
