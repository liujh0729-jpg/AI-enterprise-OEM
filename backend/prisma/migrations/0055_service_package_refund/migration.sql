-- 服务套餐口径调整：
--   1) 限购由「按账号」改为「按企业」：per_user_limit → per_enterprise_limit，并补企业+套餐计数索引。
--   2) 退款支持部分退与整单退：订单累计已退积分 + 逐次退款记录（与积分流水一一对应）。
ALTER TABLE `service_packages`
    CHANGE COLUMN `per_user_limit` `per_enterprise_limit` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `service_package_orders`
    ADD COLUMN `refunded_points_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0;

CREATE INDEX `service_package_orders_enterprise_id_package_id_idx`
    ON `service_package_orders`(`enterprise_id`, `package_id`);

CREATE TABLE `service_package_refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `amount` DECIMAL(18, 4) NOT NULL,
    `full_refund` BOOLEAN NOT NULL DEFAULT false,
    `tx_id` INTEGER NOT NULL DEFAULT 0,
    `operator_user_id` VARCHAR(64) NOT NULL,
    `remark` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_package_refunds_order_id_created_at_idx`(`order_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
