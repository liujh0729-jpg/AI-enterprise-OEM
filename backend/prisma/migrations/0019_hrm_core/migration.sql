-- L2 HRM锛堟柟妗?5.1/12.9锛夛細鍛樺伐妗ｆ/鍋囧嫟鏀跨瓥浣欓鐢宠/鑺傚亣鏃?鎵撳崱/鐢ㄤ汉鐢宠/鑱屼綅/鍊欓€変汉/鎶曢€?闈㈣瘯璇勫垎/Offer/鐩樼偣/浜哄矖 rubric 妯℃澘搴撱€?

-- CreateTable
CREATE TABLE `hrm_employee_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `member_user_id` VARCHAR(64) NOT NULL,
    `employee_no` VARCHAR(32) NOT NULL DEFAULT '',
    `employment_type` VARCHAR(16) NOT NULL DEFAULT 'FULL_TIME',
    `hourly_rate` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `supervisor_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `skills` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PROBATION',
    `joined_at` VARCHAR(16) NOT NULL DEFAULT '',
    `left_at` VARCHAR(16) NOT NULL DEFAULT '',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_employee_profiles_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    UNIQUE INDEX `hrm_employee_profiles_org_type_org_user_id_member_user_id_key`(`org_type`, `org_user_id`, `member_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_attendance_policies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `year` INTEGER NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `quotas` JSON NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_attendance_policies_org_type_org_user_id_year_idx`(`org_type`, `org_user_id`, `year`),
    UNIQUE INDEX `hrm_attendance_policies_org_type_org_user_id_year_name_key`(`org_type`, `org_user_id`, `year`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_time_off_balances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `year` INTEGER NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `total_days` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `used_days` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hrm_time_off_balances_org_type_org_user_id_staff_user_id_yea_key`(`org_type`, `org_user_id`, `staff_user_id`, `year`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_time_off_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `start_date` VARCHAR(16) NOT NULL,
    `end_date` VARCHAR(16) NOT NULL,
    `days` DECIMAL(6, 2) NOT NULL,
    `reason` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `approver_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `decided_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `oa_application_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hrm_time_off_requests_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `hrm_time_off_requests_staff_user_id_status_idx`(`staff_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_holidays` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `holiday_date` VARCHAR(16) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `days` DECIMAL(2, 1) NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hrm_holidays_org_type_org_user_id_holiday_date_key`(`org_type`, `org_user_id`, `holiday_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_attendance_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `log_date` VARCHAR(16) NOT NULL,
    `check_type` VARCHAR(16) NOT NULL,
    `at` DATETIME(3) NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'WEB',
    `mark` VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hrm_attendance_logs_org_type_org_user_id_staff_user_id_log_d_idx`(`org_type`, `org_user_id`, `staff_user_id`, `log_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_hiring_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `position` VARCHAR(120) NOT NULL,
    `head_count` INTEGER NOT NULL DEFAULT 1,
    `expected_tier` VARCHAR(24) NOT NULL DEFAULT '',
    `budget_monthly` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `reason` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `applicant_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `approver_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `decided_at` DATETIME(3) NULL,
    `job_id` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hrm_hiring_requests_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `department` VARCHAR(64) NOT NULL DEFAULT '',
    `head_count` INTEGER NOT NULL DEFAULT 1,
    `tier` VARCHAR(24) NOT NULL DEFAULT '',
    `jd` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `hiring_request_id` INTEGER NOT NULL DEFAULT 0,
    `hiring_post_id` INTEGER NOT NULL DEFAULT 0,
    `min_score` DECIMAL(2, 1) NOT NULL DEFAULT 4.0,
    `ownerId` VARCHAR(64) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_jobs_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_candidates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `email` VARCHAR(120) NOT NULL DEFAULT '',
    `source` VARCHAR(24) NOT NULL DEFAULT 'UPLOAD',
    `resume_asset_id` INTEGER NOT NULL DEFAULT 0,
    `resume_text` TEXT NOT NULL,
    `items` JSON NOT NULL,
    `skills` JSON NOT NULL,
    `tier` VARCHAR(24) NOT NULL DEFAULT '',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_candidates_org_type_org_user_id_created_at_idx`(`org_type`, `org_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `job_id` INTEGER NOT NULL,
    `candidate_id` INTEGER NOT NULL,
    `channel` VARCHAR(24) NOT NULL DEFAULT 'LOCAL',
    `status` VARCHAR(16) NOT NULL DEFAULT 'NEW',
    `match_score` DECIMAL(2, 1) NOT NULL DEFAULT 0,
    `match_tier` VARCHAR(16) NOT NULL DEFAULT '',
    `eval_result` JSON NOT NULL,
    `rubric_code` VARCHAR(32) NOT NULL DEFAULT '',
    `rubric_version` INTEGER NOT NULL DEFAULT 0,
    `decided_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_applications_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `hrm_applications_candidate_id_idx`(`candidate_id`),
    UNIQUE INDEX `hrm_applications_job_id_candidate_id_key`(`job_id`, `candidate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_interviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `application_id` INTEGER NOT NULL,
    `interviewer_user_id` VARCHAR(64) NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'ONSITE',
    `scheduled_at` DATETIME(3) NOT NULL,
    `duration_min` INTEGER NOT NULL DEFAULT 60,
    `status` VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED',
    `notes` TEXT NOT NULL,
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hrm_interviews_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `hrm_interviews_application_id_idx`(`application_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_interview_ratings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `interview_id` INTEGER NOT NULL,
    `rater_user_id` VARCHAR(64) NOT NULL,
    `dimension` VARCHAR(24) NOT NULL,
    `score` DECIMAL(2, 1) NOT NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hrm_interview_ratings_interview_id_rater_user_id_dimension_key`(`interview_id`, `rater_user_id`, `dimension`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_offers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `application_id` INTEGER NOT NULL,
    `candidate_id` INTEGER NOT NULL,
    `job_id` INTEGER NOT NULL,
    `salary_monthly` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `start_at` VARCHAR(16) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `accepted_at` DATETIME(3) NULL,
    `member_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `org_staff_id` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hrm_offers_org_type_org_user_id_status_idx`(`org_type`, `org_user_id`, `status`),
    INDEX `hrm_offers_application_id_idx`(`application_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL,
    `org_user_id` VARCHAR(64) NOT NULL,
    `staff_user_id` VARCHAR(64) NOT NULL,
    `period` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'YEAR',
    `performance_score` DECIMAL(2, 1) NOT NULL DEFAULT 0,
    `potential_score` DECIMAL(2, 1) NOT NULL DEFAULT 0,
    `grid_cell` INTEGER NOT NULL DEFAULT 0,
    `summary` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `reviewer_user_id` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hrm_reviews_org_type_org_user_id_staff_user_id_period_kind_key`(`org_type`, `org_user_id`, `staff_user_id`, `period`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hrm_rubric_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `version` INTEGER NOT NULL,
    `dimensions` JSON NOT NULL,
    `weights` JSON NOT NULL,
    `thresholds_json` JSON NOT NULL,
    `tier_lexicon_json` JSON NOT NULL,
    `prompt_digest` TEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_rubric_templates_code_active_idx`(`code`, `active`),
    UNIQUE INDEX `hrm_rubric_templates_code_version_key`(`code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
