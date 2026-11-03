-- Agent 定时任务：任务定义（排期口径与 Workbuddy/RPA 一致）与执行记录

CREATE TABLE "content_agent_schedules" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "preset" VARCHAR(32) NOT NULL DEFAULT '',
    "title" VARCHAR(80) NOT NULL,
    "instruction" TEXT NOT NULL DEFAULT '',
    "conversation_id" INTEGER NOT NULL DEFAULT 0,
    "expert_id" INTEGER NOT NULL DEFAULT 0,
    "channel_id" INTEGER NOT NULL DEFAULT 0,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "schedule_type" VARCHAR(16) NOT NULL DEFAULT 'recurring',
    "schedule_config" JSONB NOT NULL DEFAULT '{}',
    "scheduled_at" TIMESTAMP(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'enabled',
    "last_run_at" TIMESTAMP(3),
    "last_status" VARCHAR(16) NOT NULL DEFAULT '',
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_agent_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_agent_schedules_user_id_status_idx"
    ON "content_agent_schedules"("user_id", "status");
CREATE INDEX "content_agent_schedules_status_schedule_type_scheduled_at_idx"
    ON "content_agent_schedules"("status", "schedule_type", "scheduled_at");

CREATE TABLE "content_agent_schedule_runs" (
    "id" SERIAL NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "trigger" VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    "status" VARCHAR(16) NOT NULL DEFAULT 'running',
    "conversation_id" INTEGER NOT NULL DEFAULT 0,
    "message_id" INTEGER NOT NULL DEFAULT 0,
    "summary" VARCHAR(500) NOT NULL DEFAULT '',
    "error" VARCHAR(500) NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "content_agent_schedule_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_agent_schedule_runs_schedule_id_started_at_idx"
    ON "content_agent_schedule_runs"("schedule_id", "started_at");
CREATE INDEX "content_agent_schedule_runs_user_id_started_at_idx"
    ON "content_agent_schedule_runs"("user_id", "started_at");
