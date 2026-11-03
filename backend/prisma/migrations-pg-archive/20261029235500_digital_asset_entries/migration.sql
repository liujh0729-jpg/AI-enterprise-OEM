-- 数字资产归属台账：按账号圈定「自己上传/生成」的平台资产
CREATE TABLE IF NOT EXISTS "digital_asset_entries" (
  "id" SERIAL PRIMARY KEY,
  "user_id" VARCHAR(64) NOT NULL,
  "aipdd_asset_id" INTEGER NOT NULL,
  "type" VARCHAR(16) NOT NULL DEFAULT 'file',
  "name" VARCHAR(200) NOT NULL DEFAULT '',
  "url" TEXT NOT NULL DEFAULT '',
  "preview_url" TEXT NOT NULL DEFAULT '',
  "file_size" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "labels" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "digital_asset_entries_user_id_aipdd_asset_id_key"
  ON "digital_asset_entries"("user_id", "aipdd_asset_id");
CREATE INDEX IF NOT EXISTS "digital_asset_entries_user_id_updated_at_idx"
  ON "digital_asset_entries"("user_id", "updated_at");

-- 存量回填：内容创作/Agent 已登记成功、且平台 id 是数字的资产归到生成它的账号
INSERT INTO "digital_asset_entries" ("user_id", "aipdd_asset_id", "type", "name", "url", "preview_url", "labels", "created_at", "updated_at")
SELECT
  a."user_id",
  a."aipdd_asset_id"::INTEGER,
  CASE WHEN a."kind" IN ('image','video','audio') THEN a."kind" ELSE 'file' END,
  a."name",
  a."url",
  a."url",
  '["aiworkin-enterprise"]'::JSONB,
  a."created_at",
  a."created_at"
FROM "content_assets" a
WHERE a."status" = 'ok' AND a."aipdd_asset_id" ~ '^[0-9]+$'
ON CONFLICT ("user_id", "aipdd_asset_id") DO NOTHING;
