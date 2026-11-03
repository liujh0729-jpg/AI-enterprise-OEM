-- 组织成员的岗位与能力：由本组织赋予，一人一条记录
ALTER TABLE "org_staff" ADD COLUMN "positions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "org_staff" ADD COLUMN "capabilities" TEXT NOT NULL DEFAULT '';
UPDATE "org_staff"
SET "positions" = jsonb_build_array(jsonb_build_object('name', "title", 'description', ''))
WHERE "title" <> '';
ALTER TABLE "org_staff" DROP COLUMN "title";

ALTER TABLE "org_applications" ADD COLUMN "positions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "org_applications" ADD COLUMN "capabilities" TEXT NOT NULL DEFAULT '';
UPDATE "org_applications"
SET "positions" = jsonb_build_array(jsonb_build_object('name', "title", 'description', ''))
WHERE "title" <> '';
ALTER TABLE "org_applications" DROP COLUMN "title";

-- CreateTable
CREATE TABLE "okr_cycles" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "year" INTEGER NOT NULL,
    "period" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(120) NOT NULL DEFAULT '',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okr_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "okr_objectives" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "parent_id" INTEGER NOT NULL DEFAULT 0,
    "level" VARCHAR(16) NOT NULL DEFAULT 'PERSONAL',
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "owner_member_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "assigner_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "weight" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "progress" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "visibility" VARCHAR(16) NOT NULL DEFAULT 'ORG',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "source" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okr_objectives_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "okr_key_results" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "objective_id" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "metric_type" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "target_value" DECIMAL(16,4) NOT NULL DEFAULT 100,
    "current_value" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "start_value" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "unit" VARCHAR(32) NOT NULL DEFAULT '',
    "direction" VARCHAR(8) NOT NULL DEFAULT 'UP',
    "weight" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "owner_member_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "metric_source" JSONB NOT NULL DEFAULT '{}',
    "last_refreshed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okr_key_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "okr_progress_logs" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "kr_id" INTEGER NOT NULL DEFAULT 0,
    "objective_id" INTEGER NOT NULL DEFAULT 0,
    "before" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "after" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "progress" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "source" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "author_id" VARCHAR(64) NOT NULL DEFAULT '',
    "ref_type" VARCHAR(32) NOT NULL DEFAULT '',
    "ref_id" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "okr_progress_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "okr_metric_snapshots" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "kr_id" INTEGER NOT NULL,
    "value" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "okr_metric_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "okr_plans" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "objective_id" INTEGER NOT NULL DEFAULT 0,
    "kr_id" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(200) NOT NULL,
    "detail" VARCHAR(2000) NOT NULL DEFAULT '',
    "kind" VARCHAR(8) NOT NULL DEFAULT 'ADHOC',
    "period_key" VARCHAR(16) NOT NULL DEFAULT '',
    "start_date" DATE,
    "due_date" DATE,
    "priority" VARCHAR(8) NOT NULL DEFAULT 'MEDIUM',
    "status" VARCHAR(16) NOT NULL DEFAULT 'TODO',
    "progress" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "schedule_id" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okr_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "okr_reports" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "period_key" VARCHAR(16) NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "auto_draft" JSONB NOT NULL DEFAULT '{}',
    "source" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "schedule_id" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "manager_comment" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okr_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "okr_scores" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "reviewer_user_id" VARCHAR(64) NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '[]',
    "total" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "comment" VARCHAR(500) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okr_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "okr_settings" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "managers" JSONB NOT NULL DEFAULT '[]',
    "default_visibility" VARCHAR(16) NOT NULL DEFAULT 'ORG',
    "week_start" INTEGER NOT NULL DEFAULT 1,
    "auto_draft_enabled" BOOLEAN NOT NULL DEFAULT true,
    "report_templates" JSONB NOT NULL DEFAULT '{}',
    "report_schedules" JSONB NOT NULL DEFAULT '{}',
    "score_dimensions" JSONB NOT NULL DEFAULT '[]',
    "metric_refresh_hour" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "okr_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "okr_cycles_owner_user_id_kind_year_period_key" ON "okr_cycles"("owner_user_id", "kind", "year", "period");
CREATE INDEX "okr_cycles_owner_user_id_status_idx" ON "okr_cycles"("owner_user_id", "status");
CREATE INDEX "okr_objectives_owner_user_id_cycle_id_idx" ON "okr_objectives"("owner_user_id", "cycle_id");
CREATE INDEX "okr_objectives_owner_user_id_owner_member_user_id_idx" ON "okr_objectives"("owner_user_id", "owner_member_user_id");
CREATE INDEX "okr_key_results_owner_user_id_objective_id_idx" ON "okr_key_results"("owner_user_id", "objective_id");
CREATE INDEX "okr_progress_logs_owner_user_id_kr_id_idx" ON "okr_progress_logs"("owner_user_id", "kr_id");
CREATE INDEX "okr_progress_logs_owner_user_id_created_at_idx" ON "okr_progress_logs"("owner_user_id", "created_at");
CREATE INDEX "okr_metric_snapshots_kr_id_captured_at_idx" ON "okr_metric_snapshots"("kr_id", "captured_at");
CREATE INDEX "okr_plans_owner_user_id_member_user_id_kind_period_key_idx" ON "okr_plans"("owner_user_id", "member_user_id", "kind", "period_key");
CREATE INDEX "okr_plans_owner_user_id_status_idx" ON "okr_plans"("owner_user_id", "status");
CREATE UNIQUE INDEX "okr_reports_owner_user_id_member_user_id_kind_period_key_key" ON "okr_reports"("owner_user_id", "member_user_id", "kind", "period_key");
CREATE INDEX "okr_reports_owner_user_id_kind_period_key_idx" ON "okr_reports"("owner_user_id", "kind", "period_key");
CREATE UNIQUE INDEX "okr_scores_owner_user_id_cycle_id_member_user_id_reviewer__key" ON "okr_scores"("owner_user_id", "cycle_id", "member_user_id", "reviewer_user_id");
CREATE INDEX "okr_scores_owner_user_id_cycle_id_member_user_id_idx" ON "okr_scores"("owner_user_id", "cycle_id", "member_user_id");
CREATE UNIQUE INDEX "okr_settings_owner_user_id_key" ON "okr_settings"("owner_user_id");
