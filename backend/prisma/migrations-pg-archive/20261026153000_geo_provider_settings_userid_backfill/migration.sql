-- 上一迁移把 user_id 直接取成 updated_by，而 updated_by 存的是用户名；
-- 这里用本系统账号目录（user_directory，JIT 登记）把用户名换成真正的 userId。
-- 目录里查不到的历史行保持原值：没有任何账号能取到它（按 userId 精确匹配），不会被别人借用。
UPDATE "geo_provider_settings" g
SET "user_id" = d."user_id"
FROM (
  SELECT DISTINCT ON ("username") "username", "user_id"
  FROM "user_directory"
  WHERE "username" <> ''
  ORDER BY "username", "synced_at" DESC NULLS LAST, "created_at" DESC
) d
WHERE d."username" = g."user_id"
  AND g."user_id" <> d."user_id";
