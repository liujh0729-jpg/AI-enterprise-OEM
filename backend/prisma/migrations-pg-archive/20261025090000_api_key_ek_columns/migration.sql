-- 双 Key 口径落库对齐（纯增量，不删任何凭据列）
--
-- 新底座把「平台 Key」收归 Java 侧：平台签发的是 sk_，本系统只签发本地 ek_。
-- api_keys 中历史 sk_ 镜像列（key_cipher / name / remote_id）保留存量、代码不再读写；
-- 这里只为全新库补齐这些列，并把默认前缀改为 ek_。

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_cipher" TEXT NOT NULL DEFAULT '';
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "name" VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "remote_id" VARCHAR(64) NOT NULL DEFAULT '';

ALTER TABLE "api_keys" ALTER COLUMN "key_prefix" SET DEFAULT 'ek_';

-- 旧底座的复合索引保留；全新库补一份，保证两边索引集合一致
CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys"("user_id");
CREATE INDEX IF NOT EXISTS "api_keys_user_id_status_idx" ON "api_keys"("user_id", "status");
