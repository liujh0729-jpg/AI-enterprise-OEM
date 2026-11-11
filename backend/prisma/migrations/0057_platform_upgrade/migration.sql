-- 平台升级：升级包、任务、步骤与备份台账。
-- 执行器是独立 runner 进程，任务状态以 update/jobs/<id>/state.json 为准，API 读取后回写这里。
CREATE TABLE `platform_upgrade_packages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `source` VARCHAR(24) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'VERIFIED',
    `version` VARCHAR(64) NOT NULL DEFAULT '',
    `tag` VARCHAR(64) NOT NULL DEFAULT '',
    `file_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `candidate_dir` VARCHAR(500) NOT NULL DEFAULT '',
    `bytes` INTEGER NOT NULL DEFAULT 0,
    `sha256` VARCHAR(64) NOT NULL DEFAULT '',
    `release_notes` TEXT NOT NULL,
    `published_at` VARCHAR(64) NOT NULL DEFAULT '',
    `extracted` BOOLEAN NOT NULL DEFAULT false,
    `invalid_reason` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_upgrade_packages_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_upgrade_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `package_id` INTEGER NOT NULL DEFAULT 0,
    `backup_id` INTEGER NOT NULL DEFAULT 0,
    `from_version` VARCHAR(64) NOT NULL DEFAULT '',
    `to_version` VARCHAR(64) NOT NULL DEFAULT '',
    `current_step` VARCHAR(40) NOT NULL DEFAULT '',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(1000) NOT NULL DEFAULT '',
    `options_json` TEXT NULL,
    `advice_json` TEXT NULL,
    `operator_id` VARCHAR(64) NOT NULL DEFAULT '',
    `job_dir` VARCHAR(500) NOT NULL DEFAULT '',
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_upgrade_jobs_type_status_created_at_idx`(`type`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_upgrade_steps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job_id` INTEGER NOT NULL,
    `step_key` VARCHAR(40) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `message` VARCHAR(1000) NOT NULL DEFAULT '',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `platform_upgrade_steps_job_id_sort_order_idx`(`job_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_backups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job_id` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `version` VARCHAR(64) NOT NULL DEFAULT '',
    `dialect` VARCHAR(16) NOT NULL DEFAULT 'mysql',
    `file_name` VARCHAR(255) NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `manifest_path` VARCHAR(500) NOT NULL,
    `bytes` INTEGER NOT NULL DEFAULT 0,
    `sha256` VARCHAR(64) NOT NULL DEFAULT '',
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_backups_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
