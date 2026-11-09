-- 任务外发需求：任务 → 对外需求 → 响应 → 合作
CREATE TABLE `pj_task_demands` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
  `org_user_id` VARCHAR(64) NOT NULL,
  `task_id` INTEGER NOT NULL,
  `project_id` INTEGER NOT NULL DEFAULT 0,
  `title` VARCHAR(200) NOT NULL,
  `scope` TEXT NOT NULL,
  `deliverables` TEXT NOT NULL,
  `acceptance` TEXT NOT NULL,
  `budget_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
  `start_date` VARCHAR(16) NOT NULL DEFAULT '',
  `due_date` VARCHAR(16) NOT NULL DEFAULT '',
  `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  `published_at` DATETIME(3) NULL,
  `created_by` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `pj_task_demands_org_task_key`(`org_type`, `org_user_id`, `task_id`),
  INDEX `pj_task_demands_org_status_idx`(`org_type`, `org_user_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pj_demand_responses` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
  `org_user_id` VARCHAR(64) NOT NULL,
  `demand_id` INTEGER NOT NULL,
  `party_id` INTEGER NOT NULL DEFAULT 0,
  `party_name` VARCHAR(160) NOT NULL DEFAULT '',
  `contact` VARCHAR(160) NOT NULL DEFAULT '',
  `quote_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
  `duration_days` INTEGER NOT NULL DEFAULT 0,
  `note` TEXT NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'NEW',
  `engagement_id` INTEGER NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `pj_demand_responses_org_demand_idx`(`org_type`, `org_user_id`, `demand_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
