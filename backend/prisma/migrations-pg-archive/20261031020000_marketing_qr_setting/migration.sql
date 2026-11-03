-- 活码 AI 设置（每账号一份）
CREATE TABLE "marketing_qr_settings" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "channel_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_qr_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_qr_settings_user_id_key" ON "marketing_qr_settings"("user_id");
