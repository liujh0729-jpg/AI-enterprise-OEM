-- L0 平台底座（§5.9/§5.10/§5.12）：技能审查字段、功能目录/开关、Agent 访问策略、审查台账、按用量计费规则。

-- ① 技能/插件审查四字段（§5.9）：新行默认 pending；存量行按「首扫无红线命中即追溯通过」回填（迁移尾部 UPDATE）。
ALTER TABLE `content_agent_skills`
  ADD COLUMN `review_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN `review_verdict` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  ADD COLUMN `reviewed_at` DATETIME(3) NULL,
  ADD COLUMN `reviewed_by` VARCHAR(32) NOT NULL DEFAULT '';

ALTER TABLE `content_agent_plugins`
  ADD COLUMN `review_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN `review_verdict` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  ADD COLUMN `reviewed_at` DATETIME(3) NULL,
  ADD COLUMN `reviewed_by` VARCHAR(32) NOT NULL DEFAULT '';

-- ② 菜单/功能目录与开关（§5.10）
CREATE TABLE `feature_catalog` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(8) NOT NULL DEFAULT 'MENU',
  `parent_code` VARCHAR(64) NOT NULL DEFAULT '',
  `title` VARCHAR(64) NOT NULL,
  `path` VARCHAR(120) NOT NULL DEFAULT '',
  `scope` VARCHAR(16) NOT NULL DEFAULT 'PLATFORM',
  `protected` TINYINT NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `feature_catalog_code_key` (`code`),
  KEY `feature_catalog_parent_code_idx` (`parent_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `feature_toggles` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL,
  `scope` VARCHAR(16) NOT NULL DEFAULT 'PLATFORM',
  `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
  `state` VARCHAR(8) NOT NULL DEFAULT 'open',
  `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `feature_toggles_code_scope_org_user_id_key` (`code`, `scope`, `org_user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ③ Agent 访问策略（§5.9 黑名单 + 沙箱硬上限，平台级单行）
CREATE TABLE `agent_access_policies` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `blacklist` JSON NOT NULL,
  `limits` JSON NOT NULL,
  `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ④ 技能包/插件审查台账（§5.9）
CREATE TABLE `skill_review_runs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(8) NOT NULL,
  `item_id` INT NOT NULL DEFAULT 0,
  `user_id` VARCHAR(64) NOT NULL,
  `input_digest` VARCHAR(64) NOT NULL DEFAULT '',
  `static_hits` JSON NOT NULL,
  `llm_verdict` JSON NOT NULL,
  `decision` VARCHAR(16) NOT NULL DEFAULT 'unreviewed',
  `risk_level` VARCHAR(8) NOT NULL DEFAULT '',
  `model` VARCHAR(64) NOT NULL DEFAULT '',
  `tokens` INT NOT NULL DEFAULT 0,
  `cost_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `skill_review_runs_user_id_created_at_idx` (`user_id`, `created_at`),
  KEY `skill_review_runs_kind_item_id_idx` (`kind`, `item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ⑤ Agent 按用量计费规则（§5.12，billing_rule；module_pricing 价目作 PLATFORM 默认种子）
CREATE TABLE `billing_rules` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `scope` VARCHAR(16) NOT NULL DEFAULT 'PLATFORM',
  `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
  `metric` VARCHAR(16) NOT NULL DEFAULT 'call',
  `unit_price_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `base_fee_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `multiplier` DECIMAL(8, 4) NOT NULL DEFAULT 1,
  `min_charge_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0.01,
  `max_charge_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `budget_cap_monthly` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `free_quota_monthly` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `enabled` TINYINT NOT NULL DEFAULT 1,
  `version` INT NOT NULL DEFAULT 1,
  `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `billing_rules_code_scope_org_user_id_metric_key` (`code`, `scope`, `org_user_id`, `metric`),
  KEY `billing_rules_code_enabled_idx` (`code`, `enabled`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ⑥ 存量技能/插件追溯口径：上线首扫由应用层执行（静态红线命中即 rejected），
-- 迁移先把既有行标为 grandfathered 通过，保证升级瞬间不砸已有会话；后续重新导入走完整审查。
UPDATE `content_agent_skills` SET `review_status` = 'passed', `reviewed_by` = 'grandfathered', `reviewed_at` = CURRENT_TIMESTAMP(3);
UPDATE `content_agent_plugins` SET `review_status` = 'passed', `reviewed_by` = 'grandfathered', `reviewed_at` = CURRENT_TIMESTAMP(3);
