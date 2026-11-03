-- Agent 个性化：回复风格（七种预设之一，空＝不限定）+ 用户自定人设，按登录账号唯一

CREATE TABLE "content_agent_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "style" VARCHAR(32) NOT NULL DEFAULT '',
    "persona" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_agent_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_agent_preferences_user_id_key"
    ON "content_agent_preferences"("user_id");
