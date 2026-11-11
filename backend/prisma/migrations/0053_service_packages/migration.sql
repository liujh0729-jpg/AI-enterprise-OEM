-- 官方服务套餐与平台整合交付：
--   1) service_packages——平台按板块上架的套餐目录；积分价按官方汇率实时换算、购买时快照。
--   2) service_package_orders——积分直购订单（PAID）；汇率/积分价快照，交付状态机 PENDING_MATCH→SIGNING→DELIVERED/CLOSED。
--   3) service_package_order_items——交付明细（一项一服务商）；状态实时读关联 contracts.status，避免双写。
--   4) contracts.package_order_id——平台主持的套餐交付签约挂回订单（0=普通签约）。
-- JSON 列不写字面默认值（MySQL 错误 1101），默认值由 Prisma 层 @default 兜住。

-- CreateTable: service_packages
CREATE TABLE `service_packages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `service_type` VARCHAR(32) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `price_cents` INTEGER NOT NULL,
    `unit` VARCHAR(16) NOT NULL DEFAULT '年',
    `features` JSON NOT NULL,
    `delivery_items` JSON NOT NULL,
    `delivery_desc` VARCHAR(500) NOT NULL DEFAULT '',
    `auto_initiate` BOOLEAN NOT NULL DEFAULT false,
    `taxpayer_type` VARCHAR(16) NULL,
    `per_user_limit` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `service_packages_service_type_status_sort_order_idx`(`service_type`, `status`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: service_package_orders
CREATE TABLE `service_package_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `enterprise_id` INTEGER NOT NULL,
    `package_id` INTEGER NOT NULL,
    `package_name` VARCHAR(120) NOT NULL,
    `service_type` VARCHAR(32) NOT NULL,
    `price_cents` INTEGER NOT NULL,
    `rate_amount` DECIMAL(18, 4) NOT NULL,
    `points_amount` DECIMAL(18, 4) NOT NULL,
    `tx_id` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PAID',
    `fulfillment_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING_MATCH',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_package_orders_order_no_key`(`order_no`),
    INDEX `service_package_orders_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `service_package_orders_fulfillment_status_idx`(`fulfillment_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: service_package_order_items
CREATE TABLE `service_package_order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `label` VARCHAR(120) NOT NULL DEFAULT '',
    `provider_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `provider_org` VARCHAR(200) NOT NULL DEFAULT '',
    `contract_id` INTEGER NOT NULL DEFAULT 0,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_package_order_items_order_id_idx`(`order_id`),
    INDEX `service_package_order_items_contract_id_idx`(`contract_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: contracts 增补套餐订单回挂列（INT 可直接带默认值）
ALTER TABLE `contracts` ADD COLUMN `package_order_id` INTEGER NOT NULL DEFAULT 0;
CREATE INDEX `contracts_package_order_id_idx` ON `contracts`(`package_order_id`);

-- 升级种子：把原「财税服务包 · 参考价格」两条写死套餐迁进目录，保证升级后财税板块不空。
-- 幂等：仅当该板块尚无同纳税人档套餐时插入（migrate deploy 只跑一次，此处再防重跑/存量）。
INSERT INTO `service_packages`
    (`service_type`, `name`, `description`, `price_cents`, `unit`, `features`, `delivery_items`, `delivery_desc`, `auto_initiate`, `taxpayer_type`, `per_user_limit`, `status`, `sort_order`, `updated_at`)
SELECT 'TAX_FINANCE', '小规模纳税人', '面向小规模纳税人的全年财税代理服务，含记账报税与财务咨询。', 36000, '年',
    '["增值税及附加税","企业所得税","印花税","财务报表","个人所得税","残保金申报","税务年度汇算清缴","工商年检","电子凭证及财务报表的下载","旧账导入","账套管理（记账）","代扣代缴税款","财务老师线上咨询"]',
    '[{"code":"TAX_FINANCE","label":"企业财税服务"}]',
    '本套餐由平台整合优质服务商完成交付：采购后平台主持企业与财税服务商签约兑现。', false, 'SMALL', 0, 'ACTIVE', 1, CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `service_packages` WHERE `service_type` = 'TAX_FINANCE' AND `taxpayer_type` = 'SMALL');

INSERT INTO `service_packages`
    (`service_type`, `name`, `description`, `price_cents`, `unit`, `features`, `delivery_items`, `delivery_desc`, `auto_initiate`, `taxpayer_type`, `per_user_limit`, `status`, `sort_order`, `updated_at`)
SELECT 'TAX_FINANCE', '一般纳税人', '面向一般纳税人的全年财税代理服务，含记账报税与财务咨询。', 99000, '年',
    '["增值税及附加税","企业所得税","印花税","财务报表","个人所得税","残保金申报","税务年度汇算清缴","工商年检","电子凭证及财务报表的下载","旧账导入","账套管理（记账）","代扣代缴税款","财务老师线上咨询"]',
    '[{"code":"TAX_FINANCE","label":"企业财税服务"}]',
    '本套餐由平台整合优质服务商完成交付：采购后平台主持企业与财税服务商签约兑现。', false, 'GENERAL', 0, 'ACTIVE', 2, CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `service_packages` WHERE `service_type` = 'TAX_FINANCE' AND `taxpayer_type` = 'GENERAL');