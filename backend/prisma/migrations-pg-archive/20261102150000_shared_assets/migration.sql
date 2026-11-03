-- 数字资产「共享资料」：按账号一对一共享（企业内多选＝多行）
CREATE TABLE "content_shared_assets" (
  "id" SERIAL NOT NULL,
  "owner_user_id" VARCHAR(64) NOT NULL,
  "asset_id" VARCHAR(128) NOT NULL,
  "asset_name" VARCHAR(200) NOT NULL DEFAULT '',
  "asset_type" VARCHAR(16) NOT NULL DEFAULT 'file',
  "asset_size" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "asset_url" TEXT NOT NULL DEFAULT '',
  "target_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_shared_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "content_shared_assets_owner_user_id_asset_id_target_user_id_key" ON "content_shared_assets"("owner_user_id","asset_id","target_user_id");
CREATE INDEX "content_shared_assets_target_user_id_created_at_idx" ON "content_shared_assets"("target_user_id","created_at");
CREATE INDEX "content_shared_assets_owner_user_id_created_at_idx" ON "content_shared_assets"("owner_user_id","created_at");