-- CreateTable
CREATE TABLE `seo_projects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `domain` VARCHAR(200) NOT NULL,
    `brand_name` VARCHAR(80) NOT NULL DEFAULT '',
    `location_code` INTEGER NOT NULL DEFAULT 2840,
    `language_code` VARCHAR(12) NOT NULL DEFAULT 'en',
    `competitors` JSON NOT NULL,
    `key_pages` JSON NOT NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `seo_projects_org_type_org_user_id_idx`(`org_type`, `org_user_id`),
    UNIQUE INDEX `seo_projects_org_type_org_user_id_domain_key`(`org_type`, `org_user_id`, `domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_provider_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `account_name` VARCHAR(80) NOT NULL DEFAULT '',
    `credential_cipher` VARCHAR(2000) NOT NULL DEFAULT '',
    `connected` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seo_provider_settings_user_id_code_key`(`user_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_research_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `params_hash` VARCHAR(64) NOT NULL,
    `result_ref` VARCHAR(200) NOT NULL DEFAULT '',
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_research_logs_org_type_org_user_id_project_id_action_par_idx`(`org_type`, `org_user_id`, `project_id`, `action`, `params_hash`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_keywords` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `keyword` VARCHAR(200) NOT NULL,
    `tags` JSON NOT NULL,
    `cluster_id` INTEGER NULL,
    `volume` INTEGER NULL,
    `cpc` DOUBLE NULL,
    `difficulty` DOUBLE NULL,
    `intent` VARCHAR(40) NOT NULL DEFAULT '',
    `source` VARCHAR(16) NOT NULL DEFAULT 'AI',
    `metrics_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_keywords_org_type_org_user_id_project_id_idx`(`org_type`, `org_user_id`, `project_id`),
    UNIQUE INDEX `seo_keywords_org_type_org_user_id_project_id_keyword_key`(`org_type`, `org_user_id`, `project_id`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_keyword_clusters` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `intent` VARCHAR(40) NOT NULL DEFAULT '',
    `mapped_page_url` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_keyword_clusters_org_type_org_user_id_project_id_idx`(`org_type`, `org_user_id`, `project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_gsc_imports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `file_name` VARCHAR(200) NOT NULL DEFAULT '',
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `date_range` VARCHAR(60) NOT NULL DEFAULT '',
    `source` VARCHAR(12) NOT NULL DEFAULT 'CSV',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_gsc_imports_org_type_org_user_id_project_id_idx`(`org_type`, `org_user_id`, `project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_gsc_rows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `import_id` INTEGER NOT NULL,
    `query` VARCHAR(500) NOT NULL,
    `page` VARCHAR(500) NOT NULL,
    `clicks` INTEGER NOT NULL DEFAULT 0,
    `impressions` INTEGER NOT NULL DEFAULT 0,
    `ctr` DOUBLE NOT NULL DEFAULT 0,
    `position` DOUBLE NOT NULL DEFAULT 0,

    INDEX `seo_gsc_rows_import_id_idx`(`import_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_audits` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `start_url` VARCHAR(500) NOT NULL,
    `max_pages` INTEGER NOT NULL DEFAULT 50,
    `include_subdomains` BOOLEAN NOT NULL DEFAULT false,
    `run_lighthouse` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `phase` VARCHAR(40) NOT NULL DEFAULT '',
    `health_score` INTEGER NULL,
    `page_count` INTEGER NOT NULL DEFAULT 0,
    `issue_count` INTEGER NOT NULL DEFAULT 0,
    `critical_count` INTEGER NOT NULL DEFAULT 0,
    `warning_count` INTEGER NOT NULL DEFAULT 0,
    `error_code` VARCHAR(200) NOT NULL DEFAULT '',
    `active_lock` INTEGER NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    UNIQUE INDEX `seo_audits_active_lock_key`(`active_lock`),
    INDEX `seo_audits_org_type_org_user_id_project_id_created_at_idx`(`org_type`, `org_user_id`, `project_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_audit_pages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `audit_id` INTEGER NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `fetch_status` VARCHAR(16) NOT NULL DEFAULT 'OK',
    `title` VARCHAR(500) NOT NULL DEFAULT '',
    `meta_description` TEXT NOT NULL,
    `canonical` VARCHAR(500) NOT NULL DEFAULT '',
    `h1` JSON NOT NULL,
    `word_count` INTEGER NOT NULL DEFAULT 0,
    `image_count` INTEGER NOT NULL DEFAULT 0,
    `images_missing_alt` INTEGER NOT NULL DEFAULT 0,
    `internal_links` INTEGER NOT NULL DEFAULT 0,
    `external_links` INTEGER NOT NULL DEFAULT 0,
    `has_json_ld` BOOLEAN NOT NULL DEFAULT false,
    `bytes` INTEGER NOT NULL DEFAULT 0,
    `blocking_scripts` INTEGER NOT NULL DEFAULT 0,
    `in_sitemap` BOOLEAN NOT NULL DEFAULT false,
    `content_hash` VARCHAR(64) NOT NULL DEFAULT '',

    INDEX `seo_audit_pages_audit_id_idx`(`audit_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_audit_issues` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `audit_id` INTEGER NOT NULL,
    `page_id` INTEGER NULL,
    `url` VARCHAR(500) NOT NULL DEFAULT '',
    `type` VARCHAR(60) NOT NULL,
    `severity` VARCHAR(16) NOT NULL DEFAULT 'INFO',
    `detail` TEXT NOT NULL,
    `fix_hint` TEXT NOT NULL,

    INDEX `seo_audit_issues_audit_id_severity_idx`(`audit_id`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_rank_trackers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `domain` VARCHAR(200) NOT NULL,
    `location_code` INTEGER NOT NULL DEFAULT 2840,
    `language_code` VARCHAR(12) NOT NULL DEFAULT 'en',
    `device` VARCHAR(12) NOT NULL DEFAULT 'MOBILE',
    `depth` INTEGER NOT NULL DEFAULT 20,
    `frequency` VARCHAR(12) NOT NULL DEFAULT 'WEEKLY',
    `reads` INTEGER NOT NULL DEFAULT 1,
    `next_run_at` DATETIME(3) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `seo_rank_trackers_org_type_org_user_id_project_id_idx`(`org_type`, `org_user_id`, `project_id`),
    INDEX `seo_rank_trackers_enabled_next_run_at_idx`(`enabled`, `next_run_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_rank_keywords` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tracker_id` INTEGER NOT NULL,
    `keyword` VARCHAR(200) NOT NULL,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `seo_rank_keywords_tracker_id_keyword_key`(`tracker_id`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_rank_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tracker_id` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `trigger` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `cost_estimate` DOUBLE NOT NULL DEFAULT 0,
    `error_code` VARCHAR(200) NOT NULL DEFAULT '',
    `active_lock` INTEGER NULL,
    `heartbeat_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    UNIQUE INDEX `seo_rank_runs_active_lock_key`(`active_lock`),
    INDEX `seo_rank_runs_tracker_id_started_at_idx`(`tracker_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_rank_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `tracker_id` INTEGER NOT NULL,
    `keyword` VARCHAR(200) NOT NULL,
    `device` VARCHAR(12) NOT NULL,
    `position` INTEGER NULL,
    `url` VARCHAR(500) NOT NULL DEFAULT '',
    `serp_features` JSON NOT NULL,
    `checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_rank_snapshots_tracker_id_keyword_checked_at_idx`(`tracker_id`, `keyword`, `checked_at`),
    INDEX `seo_rank_snapshots_run_id_idx`(`run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_backlink_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `domain` VARCHAR(200) NOT NULL,
    `total_backlinks` INTEGER NOT NULL DEFAULT 0,
    `referring_domains` INTEGER NOT NULL DEFAULT 0,
    `payload` JSON NOT NULL,
    `queried_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_backlink_snapshots_org_type_org_user_id_project_id_queri_idx`(`org_type`, `org_user_id`, `project_id`, `queried_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_indexnow_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `key_value` VARCHAR(128) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `seo_indexnow_keys_project_id_key`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_indexnow_submissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `urls` JSON NOT NULL,
    `response_code` INTEGER NOT NULL DEFAULT 0,
    `submitted_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_indexnow_submissions_org_type_org_user_id_project_id_cre_idx`(`org_type`, `org_user_id`, `project_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_local_trackers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `business_name` VARCHAR(120) NOT NULL,
    `keyword` VARCHAR(200) NOT NULL,
    `center_lat` DOUBLE NOT NULL,
    `center_lng` DOUBLE NOT NULL,
    `grid_size` INTEGER NOT NULL DEFAULT 3,
    `radius_km` DOUBLE NOT NULL DEFAULT 5,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_local_trackers_org_type_org_user_id_project_id_idx`(`org_type`, `org_user_id`, `project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_local_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tracker_id` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `cost_estimate` DOUBLE NOT NULL DEFAULT 0,
    `error_code` VARCHAR(200) NOT NULL DEFAULT '',
    `active_lock` INTEGER NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    UNIQUE INDEX `seo_local_runs_active_lock_key`(`active_lock`),
    INDEX `seo_local_runs_tracker_id_started_at_idx`(`tracker_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_local_points` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `tracker_id` INTEGER NOT NULL,
    `row` INTEGER NOT NULL,
    `col` INTEGER NOT NULL,
    `lat` DOUBLE NOT NULL,
    `lng` DOUBLE NOT NULL,
    `rank` INTEGER NULL,
    `competitors` JSON NOT NULL,
    `address` VARCHAR(300) NOT NULL DEFAULT '',

    INDEX `seo_local_points_run_id_idx`(`run_id`),
    INDEX `seo_local_points_tracker_id_idx`(`tracker_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_google_clients` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `client_id_cipher` VARCHAR(1000) NOT NULL DEFAULT '',
    `client_secret_cipher` VARCHAR(1000) NOT NULL DEFAULT '',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seo_google_clients_org_type_org_user_id_key`(`org_type`, `org_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_google_connections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `service` VARCHAR(8) NOT NULL,
    `refresh_token_cipher` VARCHAR(2000) NOT NULL DEFAULT '',
    `property_id` VARCHAR(200) NOT NULL DEFAULT '',
    `property_name` VARCHAR(200) NOT NULL DEFAULT '',
    `last_sync_at` DATETIME(3) NULL,
    `sync_error` VARCHAR(300) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `seo_google_connections_org_type_org_user_id_service_key`(`org_type`, `org_user_id`, `service`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_ga4_rows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `page` VARCHAR(500) NOT NULL,
    `sessions` INTEGER NOT NULL DEFAULT 0,
    `users` INTEGER NOT NULL DEFAULT 0,
    `engagement` DOUBLE NOT NULL DEFAULT 0,
    `conversions` DOUBLE NOT NULL DEFAULT 0,

    INDEX `seo_ga4_rows_org_type_org_user_id_project_id_date_idx`(`org_type`, `org_user_id`, `project_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_link_prospects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `domain` VARCHAR(200) NOT NULL,
    `url` VARCHAR(500) NOT NULL DEFAULT '',
    `source_query` VARCHAR(200) NOT NULL DEFAULT '',
    `contact_email` VARCHAR(200) NOT NULL DEFAULT '',
    `contact_url` VARCHAR(500) NOT NULL DEFAULT '',
    `outreach_angle` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'NEW',
    `draft_artifact_id` INTEGER NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `seo_link_prospects_org_type_org_user_id_project_id_status_idx`(`org_type`, `org_user_id`, `project_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_programmatic_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `table_id` INTEGER NOT NULL,
    `table_name` VARCHAR(120) NOT NULL DEFAULT '',
    `keyword_pattern` VARCHAR(200) NOT NULL DEFAULT '',
    `template` TEXT NOT NULL,
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_programmatic_runs_org_type_org_user_id_project_id_idx`(`org_type`, `org_user_id`, `project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_programmatic_pages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `slug` VARCHAR(200) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `meta_description` VARCHAR(500) NOT NULL DEFAULT '',
    `body` TEXT NOT NULL,
    `json_ld` TEXT NOT NULL,

    INDEX `seo_programmatic_pages_run_id_idx`(`run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_baidu_credentials` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `site` VARCHAR(200) NOT NULL,
    `token_cipher` VARCHAR(1000) NOT NULL DEFAULT '',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seo_baidu_credentials_project_id_key`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_baidu_submissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `urls` JSON NOT NULL,
    `response` JSON NOT NULL,
    `submitted_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_baidu_submissions_org_type_org_user_id_project_id_create_idx`(`org_type`, `org_user_id`, `project_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

