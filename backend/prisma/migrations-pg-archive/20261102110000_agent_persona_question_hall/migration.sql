-- 数字分身：一个登录账号多个，长期记忆仍按 user_id 共用
CREATE TABLE "content_agent_personas" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "style" VARCHAR(32) NOT NULL DEFAULT '',
    "persona" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_agent_personas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_agent_personas_user_id_name_key" ON "content_agent_personas"("user_id", "name");
CREATE INDEX "content_agent_personas_user_id_id_idx" ON "content_agent_personas"("user_id", "id");

-- 旧的账号级风格/人设迁成第一个分身，随后下线旧表（避免两套真相源）
INSERT INTO "content_agent_personas" ("user_id", "name", "style", "persona", "created_at", "updated_at")
SELECT "user_id", '我的分身', "style", "persona", "created_at", "updated_at"
FROM "content_agent_preferences"
WHERE "style" <> '' OR "persona" <> '';

DROP TABLE "content_agent_preferences";

-- 会话与定时任务记住分身（0＝自动）
ALTER TABLE "content_agent_conversations"
    ADD COLUMN "persona_id" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "persona_name" VARCHAR(30) NOT NULL DEFAULT '';

ALTER TABLE "content_agent_schedules"
    ADD COLUMN "persona_id" INTEGER NOT NULL DEFAULT 0;

-- 问题大厅
CREATE TABLE "question_hall_questions" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "scope" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "org_kind" VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    "org_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "author_user_id" VARCHAR(64) NOT NULL,
    "author_name" VARCHAR(60) NOT NULL,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "last_reply_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "latest_summary_id" INTEGER NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_hall_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "question_hall_questions_scope_status_last_reply_at_idx" ON "question_hall_questions"("scope", "status", "last_reply_at");
CREATE INDEX "question_hall_questions_org_kind_org_user_id_status_idx" ON "question_hall_questions"("org_kind", "org_user_id", "status");
CREATE INDEX "question_hall_questions_author_user_id_status_idx" ON "question_hall_questions"("author_user_id", "status");

CREATE TABLE "question_hall_messages" (
    "id" SERIAL NOT NULL,
    "question_id" INTEGER NOT NULL,
    "parent_id" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL,
    "author_kind" VARCHAR(8) NOT NULL DEFAULT 'PERSON',
    "persona_id" INTEGER NOT NULL DEFAULT 0,
    "author_label" VARCHAR(80) NOT NULL,
    "author_user_id" VARCHAR(64) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_hall_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "question_hall_messages_question_id_parent_id_created_at_idx" ON "question_hall_messages"("question_id", "parent_id", "created_at");
CREATE INDEX "question_hall_messages_author_user_id_created_at_idx" ON "question_hall_messages"("author_user_id", "created_at");

CREATE TABLE "question_hall_summaries" (
    "id" SERIAL NOT NULL,
    "question_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "created_by" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_hall_summaries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "question_hall_summaries_question_id_seq_idx" ON "question_hall_summaries"("question_id", "seq");
