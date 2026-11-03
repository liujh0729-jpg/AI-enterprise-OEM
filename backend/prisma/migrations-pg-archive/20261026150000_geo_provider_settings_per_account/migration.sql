-- GEO 采集平台 Key 改为按账号归属：原来只有一份平台级配置（updated_by 记录配置人），
-- 现按账号隔离。存量行归给它的 updated_by（即当初配置该 Key 的账号），不再给其它账号使用。
ALTER TABLE "geo_provider_settings" ADD COLUMN "user_id" VARCHAR(64);
UPDATE "geo_provider_settings"
SET "user_id" = COALESCE(NULLIF("updated_by", ''), 'u-admin')
WHERE "user_id" IS NULL;
ALTER TABLE "geo_provider_settings" ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "geo_provider_settings" DROP CONSTRAINT "geo_provider_settings_pkey";
ALTER TABLE "geo_provider_settings"
  ADD CONSTRAINT "geo_provider_settings_pkey" PRIMARY KEY ("user_id", "code");

CREATE INDEX "geo_provider_settings_user_id_idx"
  ON "geo_provider_settings"("user_id");
