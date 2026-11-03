-- 企业智能体（阶段 1 记忆地基）：六张 agent_* 表，全部按登录账号（user_id）归属。
-- L0 意图事件流 / 待确认候选 / L1 偏好 / L2 剧本 / L3 授权闸 / L3 执行记录。
-- 纯新增表，不动 audit_logs 现有语义；索引一次建好；写法幂等，便于已用 db push 建过的库补齐。

CREATE TABLE IF NOT EXISTS "agent_memory_events" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "domain" VARCHAR(32) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL DEFAULT '',
    "target_id" VARCHAR(64) NOT NULL DEFAULT '',
    "target_label" VARCHAR(200) NOT NULL DEFAULT '',
    "params" JSONB NOT NULL DEFAULT '{}',
    "outcome" VARCHAR(16) NOT NULL DEFAULT 'ok',
    "error_code" VARCHAR(64) NOT NULL DEFAULT '',
    "error_message" VARCHAR(500) NOT NULL DEFAULT '',
    "channel" VARCHAR(16) NOT NULL DEFAULT 'web',
    "audit_log_id" INTEGER NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_memory_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_memory_candidates" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "source_event_ids" JSONB NOT NULL DEFAULT '[]',
    "evidence" VARCHAR(500) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'candidate',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_memory_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "source_event_ids" JSONB NOT NULL DEFAULT '[]',
    "hits" INTEGER NOT NULL DEFAULT 0,
    "adopted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_playbooks" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "trigger" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "executor" VARCHAR(16) NOT NULL DEFAULT 'self',
    "status" VARCHAR(16) NOT NULL DEFAULT 'candidate',
    "runs" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "source_event_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_playbooks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_grants" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "playbook_id" INTEGER NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '[]',
    "dry_run_result" JSONB NOT NULL DEFAULT '{}',
    "one_time" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_playbook_runs" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "playbook_id" INTEGER NOT NULL,
    "grant_id" INTEGER NOT NULL DEFAULT 0,
    "executor" VARCHAR(16) NOT NULL DEFAULT 'self',
    "outcome" VARCHAR(16) NOT NULL DEFAULT 'ok',
    "steps_result" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "agent_playbook_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_memory_events_user_id_occurred_at_idx"
    ON "agent_memory_events"("user_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "agent_memory_events_user_id_action_occurred_at_idx"
    ON "agent_memory_events"("user_id", "action", "occurred_at");
CREATE INDEX IF NOT EXISTS "agent_memory_events_audit_log_id_idx"
    ON "agent_memory_events"("audit_log_id");
CREATE INDEX IF NOT EXISTS "agent_memory_candidates_user_id_status_created_at_idx"
    ON "agent_memory_candidates"("user_id", "status", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_preferences_user_id_key_key"
    ON "agent_preferences"("user_id", "key");
CREATE INDEX IF NOT EXISTS "agent_playbooks_user_id_status_idx"
    ON "agent_playbooks"("user_id", "status");
CREATE INDEX IF NOT EXISTS "agent_grants_user_id_status_idx"
    ON "agent_grants"("user_id", "status");
CREATE INDEX IF NOT EXISTS "agent_grants_playbook_id_status_idx"
    ON "agent_grants"("playbook_id", "status");
CREATE INDEX IF NOT EXISTS "agent_playbook_runs_user_id_started_at_idx"
    ON "agent_playbook_runs"("user_id", "started_at");
CREATE INDEX IF NOT EXISTS "agent_playbook_runs_playbook_id_started_at_idx"
    ON "agent_playbook_runs"("playbook_id", "started_at");
