-- 服务商 → 业务执行人派单（B2，决策 D3=A / D4=A / D5=A）：
--   1) my_tasks 增派单维度：USER|ORG 承办类型、派单人/时间、实际策略、接手时间。
--   2) task_assignment_rules：服务商负责人自助配置的派单规则（板块 × 类目 × 地域）。
--   3) task_assignment_logs：改派留痕，只追加。

-- AlterTable: my_tasks
ALTER TABLE `my_tasks`
    ADD COLUMN `assignee_type` VARCHAR(8) NOT NULL DEFAULT 'USER',
    ADD COLUMN `assigned_by` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `assigned_at` DATETIME(3) NULL,
    ADD COLUMN `assign_policy` VARCHAR(16) NOT NULL DEFAULT 'DIRECT',
    ADD COLUMN `accepted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `my_tasks_assignee_type_org_type_org_user_id_status_idx` ON `my_tasks`(`assignee_type`, `org_type`, `org_user_id`, `status`);

-- CreateTable: task_assignment_rules
CREATE TABLE `task_assignment_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `category` VARCHAR(16) NOT NULL,
    `region` VARCHAR(32) NOT NULL DEFAULT '',
    `strategy` VARCHAR(16) NOT NULL,
    `targets` JSON NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_assignment_rules_org_type_org_user_id_enabled_priority_idx`(`org_type`, `org_user_id`, `enabled`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: task_assignment_logs
CREATE TABLE `task_assignment_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `from_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `to_user_id` VARCHAR(64) NOT NULL,
    `strategy` VARCHAR(16) NOT NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `actor_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_assignment_logs_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
