-- 统一任务中心 / 界面偏好 / 工作流地基：
--   1) my_tasks——任意板块 @ 到某账号的一件待办（账号级，跨角色）；dedup_key 幂等锚。
--   2) user_preferences——账号级通用界面偏好（本轮只承载 dashboard.shortcuts）。
--   3) workflows / workflow_versions / workflow_runs / workflow_run_steps——可视化编排的四张表。
-- JSON/TEXT 列不写字面默认值（MySQL 错误 1101），默认值由 Prisma 层 @default 兜住。

-- CreateTable: my_tasks
CREATE TABLE `my_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assignee_user_id` VARCHAR(64) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `source_id` VARCHAR(64) NOT NULL DEFAULT '',
    `dedup_key` VARCHAR(191) NOT NULL,
    `category` VARCHAR(16) NOT NULL DEFAULT 'matter',
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `link` VARCHAR(500) NOT NULL DEFAULT '',
    `priority` VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `source_status` VARCHAR(32) NOT NULL DEFAULT '',
    `source_status_label` VARCHAR(40) NOT NULL DEFAULT '',
    `org_type` VARCHAR(16) NOT NULL DEFAULT '',
    `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `due_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `closed_by` VARCHAR(64) NOT NULL DEFAULT '',
    `close_note` VARCHAR(500) NOT NULL DEFAULT '',
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `my_tasks_dedup_key_key`(`dedup_key`),
    INDEX `my_tasks_assignee_user_id_status_created_at_idx`(`assignee_user_id`, `status`, `created_at`),
    INDEX `my_tasks_assignee_user_id_category_status_idx`(`assignee_user_id`, `category`, `status`),
    INDEX `my_tasks_assignee_user_id_source_status_idx`(`assignee_user_id`, `source`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: user_preferences
CREATE TABLE `user_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_preferences_user_id_key_key`(`user_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: workflows
CREATE TABLE `workflows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_user_id` VARCHAR(64) NOT NULL,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `scope` VARCHAR(16) NOT NULL DEFAULT 'PRIVATE',
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `graph` JSON NOT NULL,
    `input_schema` JSON NOT NULL,
    `output_schema` JSON NOT NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflows_owner_user_id_status_idx`(`owner_user_id`, `status`),
    INDEX `workflows_org_type_org_user_id_scope_status_idx`(`org_type`, `org_user_id`, `scope`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: workflow_versions
CREATE TABLE `workflow_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workflow_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `graph` JSON NOT NULL,
    `input_schema` JSON NOT NULL,
    `published_by` VARCHAR(64) NOT NULL DEFAULT '',
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `workflow_versions_workflow_id_version_key`(`workflow_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: workflow_runs
CREATE TABLE `workflow_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workflow_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `trigger` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `input` JSON NOT NULL,
    `output` JSON NOT NULL,
    `actor_id` VARCHAR(64) NOT NULL DEFAULT '',
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_runs_workflow_id_status_created_at_idx`(`workflow_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: workflow_run_steps
CREATE TABLE `workflow_run_steps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `node_id` VARCHAR(64) NOT NULL,
    `node_type` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `input` JSON NOT NULL,
    `output` JSON NOT NULL,
    `error` VARCHAR(500) NOT NULL DEFAULT '',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `duration_ms` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `workflow_run_steps_run_id_status_idx`(`run_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
