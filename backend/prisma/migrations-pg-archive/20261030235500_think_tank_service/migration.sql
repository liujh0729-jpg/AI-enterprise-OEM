-- 智库服务：机构资源库 + 咨询需求（专家资源由职员挂靠派生，不落表）
CREATE TABLE IF NOT EXISTS "think_tank_experts" (
  "id" SERIAL PRIMARY KEY,
  "kind" VARCHAR(16) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "organization" VARCHAR(200) NOT NULL DEFAULT '',
  "province" VARCHAR(48) NOT NULL DEFAULT '',
  "city" VARCHAR(48) NOT NULL DEFAULT '',
  "areas" JSONB NOT NULL DEFAULT '[]',
  "qualification" VARCHAR(200) NOT NULL DEFAULT '',
  "license_no" VARCHAR(64) NOT NULL DEFAULT '',
  "intro" TEXT,
  "cases" JSONB,
  "owner_user_id" VARCHAR(64) NOT NULL DEFAULT '',
  "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
  "status" VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "think_tank_experts_kind_status_idx"
  ON "think_tank_experts"("kind", "status");
CREATE INDEX IF NOT EXISTS "think_tank_experts_provider_user_id_idx"
  ON "think_tank_experts"("provider_user_id");
CREATE INDEX IF NOT EXISTS "think_tank_experts_province_city_idx"
  ON "think_tank_experts"("province", "city");

CREATE TABLE IF NOT EXISTS "think_tank_requests" (
  "id" SERIAL PRIMARY KEY,
  "request_no" VARCHAR(32) NOT NULL,
  "contract_id" INTEGER NOT NULL DEFAULT 0,
  "enterprise_id" INTEGER NOT NULL DEFAULT 0,
  "created_by" VARCHAR(64) NOT NULL,
  "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
  "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
  "category" VARCHAR(32) NOT NULL DEFAULT 'CONSULT',
  "sub_category_id" VARCHAR(64) NOT NULL DEFAULT '',
  "title" VARCHAR(200) NOT NULL,
  "fields" JSONB NOT NULL DEFAULT '{}',
  "region_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
  "province" VARCHAR(48) NOT NULL DEFAULT '',
  "city" VARCHAR(48) NOT NULL DEFAULT '',
  "longitude" DOUBLE PRECISION,
  "latitude" DOUBLE PRECISION,
  "radius_km" DOUBLE PRECISION,
  "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
  "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
  "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
  "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "aiworkin_published" INTEGER NOT NULL DEFAULT 0,
  "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
  "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
  "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
  "messages" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "think_tank_requests_request_no_key"
  ON "think_tank_requests"("request_no");
CREATE INDEX IF NOT EXISTS "think_tank_requests_created_by_idx"
  ON "think_tank_requests"("created_by");
CREATE INDEX IF NOT EXISTS "think_tank_requests_enterprise_id_idx"
  ON "think_tank_requests"("enterprise_id");
CREATE INDEX IF NOT EXISTS "think_tank_requests_staff_user_id_idx"
  ON "think_tank_requests"("staff_user_id");
CREATE INDEX IF NOT EXISTS "think_tank_requests_provider_user_id_status_idx"
  ON "think_tank_requests"("provider_user_id", "status");
CREATE INDEX IF NOT EXISTS "think_tank_requests_province_city_idx"
  ON "think_tank_requests"("province", "city");
