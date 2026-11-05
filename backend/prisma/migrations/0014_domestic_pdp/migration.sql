-- 国内电商商品页优化（淘宝/天猫、京东、拼多多、抖音、1688）：
--   「商品简报 → 卖点规划 → 主图/详情页图包」的台账。
--   1) domestic_pdp_packs——一次优化任务的简报（input）与规划结果（plan，含转化驱动 /
--      购买理由卡 / Style Lock / 假设与禁用表述）；platform 与 tone 单独成列供列表展示。
--   2) domestic_pdp_assets——图包里的每张图：场景、中文图面文案、完整提示词、生成结果与资产 id。
--      提示词可逐张修改后再生成，所以 prompt 必须独立成列而不是从 plan 现算。
-- JSON 列不写字面默认值（MySQL 错误 1101），默认值由 Prisma 层 @default 兜住；
-- 删除图包时由服务层事务清理 assets（与既有迁移一致，不建外键）。

-- CreateTable: domestic_pdp_packs
CREATE TABLE `domestic_pdp_packs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `product_name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(64) NOT NULL DEFAULT '',
    `platform` VARCHAR(32) NOT NULL DEFAULT '',
    `tone` VARCHAR(16) NOT NULL DEFAULT 'brand',
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `input` JSON NOT NULL,
    `plan` JSON NOT NULL,
    `error` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `domestic_pdp_packs_user_id_updated_at_idx`(`user_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: domestic_pdp_assets
CREATE TABLE `domestic_pdp_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pack_id` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `position` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL DEFAULT '',
    `purpose` VARCHAR(191) NOT NULL DEFAULT '',
    `scene_key` VARCHAR(64) NOT NULL DEFAULT '',
    `copy` TEXT NOT NULL,
    `prompt` TEXT NOT NULL,
    `size` VARCHAR(16) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `url` TEXT NOT NULL,
    `asset_id` VARCHAR(64) NOT NULL DEFAULT '',
    `error` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `domestic_pdp_assets_pack_id_kind_position_key`(`pack_id`, `kind`, `position`),
    INDEX `domestic_pdp_assets_pack_id_idx`(`pack_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;