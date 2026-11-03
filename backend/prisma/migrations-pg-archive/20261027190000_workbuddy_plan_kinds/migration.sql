-- Workbuddy 计划三分类（AI 沟通 / 明确生成任务 / 定时任务）+ 排期字段。
-- 排期三列与 rpa_tasks 的 schedule_type / schedule_config / scheduled_at 同一套口径。
-- 只加列与索引，不动既有数据；写法幂等，便于已用 db push 建过的库补齐。

ALTER TABLE "workbuddy_plans" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(16) NOT NULL DEFAULT 'ai';
ALTER TABLE "workbuddy_plans" ADD COLUMN IF NOT EXISTS "schedule_type" VARCHAR(16) NOT NULL DEFAULT 'once';
ALTER TABLE "workbuddy_plans" ADD COLUMN IF NOT EXISTS "schedule_config" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "workbuddy_plans" ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "workbuddy_plans_created_by_kind_idx"
    ON "workbuddy_plans"("created_by", "kind");
CREATE INDEX IF NOT EXISTS "workbuddy_plans_kind_schedule_type_scheduled_at_idx"
    ON "workbuddy_plans"("kind", "schedule_type", "scheduled_at");

ALTER TABLE "workbuddy_tasks" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(16) NOT NULL DEFAULT 'ai';
