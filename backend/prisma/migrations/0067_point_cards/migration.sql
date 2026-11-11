-- 日卡 / 30 天卡：兑换码、积分兑换与消耗进度（docs/日卡与30天卡兑换码设计方案.md）
--   1) point_card_templates——卡规格目录：一张卡绑一个模型 + 一个额度 + 一个有效期，
--      量纲由 model_catalog.billing_unit 快照而来（token/image/second），视频规格倍率走 spec_multipliers。
--   2) point_user_cards——用户卡实例（码兑换/积分直兑/现金购买/后台发放同一张表），
--      expires_at = activated_at + valid_days×24h，额度扣减用条件更新防并发超扣。
--   3) point_card_orders——兑换订单（CARD_CASH 日卡购买 / CARD_CODE 日卡兑换 / CARD_POINTS 积分兑换），
--      进度不冗余落列，经 user_card_id 实时读 point_user_cards。
--   4) point_promo_codes.asset_type/card_code——一张码在创建时定死兑积分还是兑卡，核销时查表分流。
--   5) model_usage_logs.user_card_id/card_deduct——用量事实表带上「本次从哪张卡扣了多少」，
--      points_cost + card_deduct 折算即用户真实消耗；points_cost 口径不变。
-- 不回填历史：老码天然是 POINTS，老用量行天然是「没用到卡」。

-- CreateTable: point_card_templates
CREATE TABLE `point_card_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `catalog_id` INTEGER NOT NULL,
    `provider` VARCHAR(24) NOT NULL,
    `model_key` VARCHAR(128) NOT NULL,
    `billing_unit` VARCHAR(16) NOT NULL,
    `quota_total` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `valid_days` INTEGER NOT NULL DEFAULT 1,
    `spec_multipliers` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `points_price` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `cash_cents` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `remark` VARCHAR(200) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `point_card_templates_code_key`(`code`),
    INDEX `point_card_templates_status_sort_order_idx`(`status`, `sort_order`),
    INDEX `point_card_templates_catalog_id_idx`(`catalog_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: point_user_cards
CREATE TABLE `point_user_cards` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `template_id` INTEGER NOT NULL,
    `template_code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `provider` VARCHAR(24) NOT NULL,
    `model_key` VARCHAR(128) NOT NULL,
    `billing_unit` VARCHAR(16) NOT NULL,
    `quota_total` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `quota_used` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `activated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `source_ref` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `point_user_cards_user_id_provider_model_key_status_idx`(`user_id`, `provider`, `model_key`, `status`),
    INDEX `point_user_cards_user_id_status_expires_at_idx`(`user_id`, `status`, `expires_at`),
    INDEX `point_user_cards_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: point_card_orders
CREATE TABLE `point_card_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `template_id` INTEGER NOT NULL,
    `template_code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `billing_unit` VARCHAR(16) NOT NULL,
    `quota_total` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `amount_cents` INTEGER NOT NULL DEFAULT 0,
    `points_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'CREATED',
    `transaction_id` VARCHAR(64) NULL,
    `prepay_id` VARCHAR(128) NOT NULL DEFAULT '',
    `code_url` VARCHAR(512) NOT NULL DEFAULT '',
    `user_card_id` INTEGER NULL,
    `promo_code` VARCHAR(32) NOT NULL DEFAULT '',
    `paid_at` DATETIME(3) NULL,
    `issued_at` DATETIME(3) NULL,
    `fail_reason` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `point_card_orders_order_no_key`(`order_no`),
    UNIQUE INDEX `point_card_orders_transaction_id_key`(`transaction_id`),
    INDEX `point_card_orders_user_id_kind_created_at_idx`(`user_id`, `kind`, `created_at`),
    INDEX `point_card_orders_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: point_promo_codes 承载卡码（老码天然 POINTS）
ALTER TABLE `point_promo_codes`
    ADD COLUMN `asset_type` VARCHAR(16) NOT NULL DEFAULT 'POINTS' AFTER `updated_at`,
    ADD COLUMN `card_code` VARCHAR(32) NOT NULL DEFAULT '' AFTER `asset_type`;

-- AlterTable: model_usage_logs 记录本次卡扣量（老行天然「没用到卡」）
ALTER TABLE `model_usage_logs`
    ADD COLUMN `user_card_id` INTEGER NULL AFTER `message`,
    ADD COLUMN `card_deduct` DECIMAL(18, 4) NOT NULL DEFAULT 0 AFTER `user_card_id`;

CREATE INDEX `model_usage_logs_user_card_id_idx` ON `model_usage_logs`(`user_card_id`);
