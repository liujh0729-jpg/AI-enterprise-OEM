-- 0007_points_oss：积分体系七表 + 数字资产自有 OSS 底座列
-- 设计：docs/积分体系与OSS存储底座设计方案.md（积分 Decimal(18,4)；微信金额整数分；快照字节 BigInt）
-- 规范：新表直接建成目标结构；存量表仅加带默认值的新列，无需回填。

CREATE TABLE `point_accounts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(64) NOT NULL,
  `balance_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `total_recharge_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `total_earn_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `total_spend_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  `arrears_since` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `point_accounts_user_id_key` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `point_transactions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(64) NOT NULL,
  `type` VARCHAR(24) NOT NULL,
  `scene` VARCHAR(32) NOT NULL DEFAULT '',
  `amount` DECIMAL(18, 4) NOT NULL,
  `balance_amount` DECIMAL(18, 4) NOT NULL,
  `counterparty` VARCHAR(64) NOT NULL DEFAULT '',
  `ref_type` VARCHAR(32) NOT NULL DEFAULT '',
  `ref_id` VARCHAR(64) NOT NULL DEFAULT '',
  `operator` VARCHAR(64) NOT NULL DEFAULT '',
  `remark` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `point_transactions_user_id_created_at_idx` (`user_id`, `created_at`),
  KEY `point_transactions_type_scene_idx` (`type`, `scene`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `recharge_orders` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(32) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `amount_cents` INT NOT NULL,
  `rate_amount` DECIMAL(18, 4) NOT NULL,
  `points_amount` DECIMAL(18, 4) NOT NULL,
  `bonus_points_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `channel` VARCHAR(16) NOT NULL DEFAULT 'WECHAT',
  `status` VARCHAR(16) NOT NULL DEFAULT 'CREATED',
  `transaction_id` VARCHAR(64) NULL,
  `prepay_id` VARCHAR(128) NOT NULL DEFAULT '',
  `code_url` VARCHAR(512) NOT NULL DEFAULT '',
  `paid_at` DATETIME NULL,
  `notify_payload` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `recharge_orders_order_no_key` (`order_no`),
  UNIQUE KEY `recharge_orders_transaction_id_key` (`transaction_id`),
  KEY `recharge_orders_user_id_created_at_idx` (`user_id`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `point_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(64) NOT NULL,
  `value` TEXT NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `point_settings_key_key` (`key`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `module_pricing` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `mode` VARCHAR(16) NOT NULL DEFAULT 'FREE',
  `unit` VARCHAR(32) NOT NULL DEFAULT '',
  `unit_price_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `free_quota_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `min_charge_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0.01,
  `enabled` TINYINT NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `module_pricing_code_key` (`code`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `usage_events` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(64) NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `quantity_amount` DECIMAL(18, 4) NOT NULL,
  `occurred_at` DATETIME NOT NULL,
  `billed` TINYINT NOT NULL DEFAULT 0,
  `bill_tx_id` INT NOT NULL DEFAULT 0,
  `remark` VARCHAR(200) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `usage_events_code_billed_occurred_at_idx` (`code`, `billed`, `occurred_at`),
  KEY `usage_events_user_id_occurred_at_idx` (`user_id`, `occurred_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `storage_daily_snapshots` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(64) NOT NULL,
  `bytes_amount` BIGINT NOT NULL DEFAULT 0,
  `asset_count` INT NOT NULL DEFAULT 0,
  `snapshot_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `storage_daily_snapshots_user_id_snapshot_at_key` (`user_id`, `snapshot_at`),
  KEY `storage_daily_snapshots_snapshot_at_idx` (`snapshot_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `digital_asset_entries`
  ADD COLUMN `oss_key` VARCHAR(500) NOT NULL DEFAULT '' AFTER `file_size`,
  ADD COLUMN `migrated_from` VARCHAR(16) NOT NULL DEFAULT '' AFTER `oss_key`;

-- 默认价目种子：数字资产存储按 GB·天计量（0.1 积分/GB/天，月免 1GB）；
-- 其余模块默认 FREE 占位（单价按行业建议预填，管理员在后台改 mode/单价即启用计费）。
INSERT INTO `module_pricing` (`code`, `mode`, `unit`, `unit_price_amount`, `free_quota_amount`) VALUES
  ('asset_storage', 'METERED', 'gb_day', 0.1000, 1.0000),
  ('ai_customer', 'FREE', 'session', 2.0000, 100.0000),
  ('crm', 'FREE', 'seat_month', 100.0000, 3.0000),
  ('bi', 'FREE', 'query', 0.5000, 200.0000),
  ('oa', 'FREE', 'instance', 0.2000, 100.0000),
  ('ai_service', 'FREE', 'call', 0.0000, 0.0000);
