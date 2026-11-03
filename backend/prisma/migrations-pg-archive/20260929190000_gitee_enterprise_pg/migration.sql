-- PostgreSQL-only additive migration from enterprise-ai-workin 55474e0.
-- Existing ae_test public data and the sns schema remain intact.
BEGIN;

-- AlterTable
ALTER TABLE "consultations" ALTER COLUMN "answer" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "enterprise_profiles" ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "id_card" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "qxy_org_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "subject_type" VARCHAR(16) NOT NULL DEFAULT 'COMPANY';

-- AlterTable
ALTER TABLE "flex_onboardings" ADD COLUMN     "audited_at" TIMESTAMP(3),
ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "onboarding_no" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "flex_payrolls" ADD COLUMN     "audited_at" TIMESTAMP(3),
ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "note" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "flex_providers" ADD COLUMN     "agents" JSONB,
ADD COLUMN     "cases" JSONB,
ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "fields" JSONB,
ADD COLUMN     "kind" VARCHAR(16) NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "license_no" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ALTER COLUMN "intro" DROP DEFAULT;

-- AlterTable
ALTER TABLE "flex_work_orders" ADD COLUMN     "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "contact_email" VARCHAR(120) NOT NULL DEFAULT '',
ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "contact_wechat" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "deadline" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "email_sync" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expect_start" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "expected_result" VARCHAR(300) NOT NULL DEFAULT '',
ADD COLUMN     "flex_id" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "messages" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "must_conditions" VARCHAR(300) NOT NULL DEFAULT '',
ADD COLUMN     "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "radius_km" DOUBLE PRECISION,
ADD COLUMN     "region_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
ADD COLUMN     "region_scope" VARCHAR(200) NOT NULL DEFAULT '',
ADD COLUMN     "sub_category_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "tags" VARCHAR(200) NOT NULL DEFAULT '',
ALTER COLUMN "budget" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "ip_agencies" ADD COLUMN     "agents" JSONB,
ADD COLUMN     "cases" JSONB,
ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "intro" TEXT,
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ip_requests" ADD COLUMN     "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "radius_km" DOUBLE PRECISION,
ADD COLUMN     "region_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
ADD COLUMN     "sub_category_id" VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "lawyer_resources" ADD COLUMN     "cases" JSONB,
ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "intro" TEXT,
ADD COLUMN     "license_no" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "legal_requests" ADD COLUMN     "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "radius_km" DOUBLE PRECISION,
ADD COLUMN     "region_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
ADD COLUMN     "sub_category_id" VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "logistics_orders" ADD COLUMN     "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "radius_km" DOUBLE PRECISION,
ADD COLUMN     "region_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
ADD COLUMN     "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "sub_category_id" VARCHAR(64) NOT NULL DEFAULT '',
ALTER COLUMN "remark" DROP DEFAULT,
ALTER COLUMN "aiworkin_published" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "marketing_orders" ADD COLUMN     "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "radius_km" DOUBLE PRECISION,
ADD COLUMN     "region_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
ADD COLUMN     "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "sub_category_id" VARCHAR(64) NOT NULL DEFAULT '',
ALTER COLUMN "description" DROP DEFAULT,
ALTER COLUMN "aiworkin_published" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "overseas_claims" ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ALTER COLUMN "remark" DROP DEFAULT;

-- AlterTable
ALTER TABLE "provider_applications" ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "item_audits" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ALTER COLUMN "intro" DROP DEFAULT;

-- AlterTable
ALTER TABLE "staff_applications" ADD COLUMN     "direction" VARCHAR(24) NOT NULL DEFAULT 'STAFF_APPLY',
ADD COLUMN     "roles" VARCHAR(200) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "staff_profiles" ADD COLUMN     "city" VARCHAR(48) NOT NULL DEFAULT '',
ADD COLUMN     "province" VARCHAR(48) NOT NULL DEFAULT '',
ALTER COLUMN "intro" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tax_declarations" ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "tax_material_packs" ADD COLUMN     "analyzed_at" TIMESTAMP(3),
ADD COLUMN     "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "period" VARCHAR(16) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "updated_at" TIMESTAMP(3),
ALTER COLUMN "files" DROP DEFAULT;

-- Backfill values required by the Gitee schema before enforcing NOT NULL.
-- Preserve the original position/headcount/cycle/skills columns and their data.
UPDATE "flex_work_orders"
SET "description" = concat_ws(E'\n', NULLIF("title", ''),
    CASE WHEN "position" <> '' THEN '岗位：' || "position" END,
    '人数：' || "headcount"::text,
    CASE WHEN "cycle" <> '' THEN '周期：' || "cycle" END,
    CASE WHEN "skills" <> '' THEN '技能：' || "skills" END)
WHERE "description" IS NULL;
ALTER TABLE "flex_work_orders" ALTER COLUMN "description" SET NOT NULL;

UPDATE "tax_material_packs"
SET "payload" = '{}'::jsonb,
    "updated_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
    "period" = 'LEGACY-' || "id"::text
WHERE "payload" IS NULL OR "updated_at" IS NULL OR "period" = '';
ALTER TABLE "tax_material_packs" ALTER COLUMN "payload" SET NOT NULL;
ALTER TABLE "tax_material_packs" ALTER COLUMN "updated_at" SET NOT NULL;

UPDATE "flex_onboardings"
SET "onboarding_no" = 'FO-LEGACY-' || "id"::text
WHERE "onboarding_no" = '';

-- CreateTable
CREATE TABLE "smart_service_orders" (
    "id" SERIAL NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL DEFAULT 0,
    "enterprise_id" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "provider_name" VARCHAR(200) NOT NULL DEFAULT '',
    "service_item" VARCHAR(32) NOT NULL DEFAULT '',
    "sub_category_id" VARCHAR(64) NOT NULL DEFAULT '',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "tags" VARCHAR(200) NOT NULL DEFAULT '',
    "budget" VARCHAR(120) NOT NULL DEFAULT '',
    "expected_result" VARCHAR(300) NOT NULL DEFAULT '',
    "must_conditions" VARCHAR(300) NOT NULL DEFAULT '',
    "expect_start" VARCHAR(32) NOT NULL DEFAULT '',
    "deadline" VARCHAR(32) NOT NULL DEFAULT '',
    "region_scope" VARCHAR(200) NOT NULL DEFAULT '',
    "region_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
    "province" VARCHAR(48) NOT NULL DEFAULT '',
    "city" VARCHAR(48) NOT NULL DEFAULT '',
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "radius_km" DOUBLE PRECISION,
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "contact_wechat" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_email" VARCHAR(120) NOT NULL DEFAULT '',
    "email_sync" INTEGER NOT NULL DEFAULT 0,
    "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "aiworkin_published" INTEGER NOT NULL DEFAULT 0,
    "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
    "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
    "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
    "events" JSONB NOT NULL DEFAULT '[]',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_requests" (
    "id" SERIAL NOT NULL,
    "request_no" VARCHAR(32) NOT NULL,
    "contract_id" INTEGER NOT NULL DEFAULT 0,
    "enterprise_id" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "broker_name" VARCHAR(200) NOT NULL DEFAULT '',
    "sub_category_id" VARCHAR(64) NOT NULL DEFAULT '',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "tags" VARCHAR(200) NOT NULL DEFAULT '',
    "budget" VARCHAR(120) NOT NULL DEFAULT '',
    "expected_result" VARCHAR(300) NOT NULL DEFAULT '',
    "must_conditions" VARCHAR(300) NOT NULL DEFAULT '',
    "expect_start" VARCHAR(32) NOT NULL DEFAULT '',
    "deadline" VARCHAR(32) NOT NULL DEFAULT '',
    "region_scope" VARCHAR(200) NOT NULL DEFAULT '',
    "region_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
    "province" VARCHAR(48) NOT NULL DEFAULT '',
    "city" VARCHAR(48) NOT NULL DEFAULT '',
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "radius_km" DOUBLE PRECISION,
    "email_sync" INTEGER NOT NULL DEFAULT 0,
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "contact_wechat" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_email" VARCHAR(120) NOT NULL DEFAULT '',
    "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "aiworkin_published" INTEGER NOT NULL DEFAULT 0,
    "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
    "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
    "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
    "events" JSONB NOT NULL DEFAULT '[]',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_service_listings" (
    "id" SERIAL NOT NULL,
    "service_no" VARCHAR(32) NOT NULL,
    "domain" VARCHAR(16) NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "sub_category_id" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "tags" VARCHAR(300) NOT NULL DEFAULT '',
    "money_mode" VARCHAR(16) NOT NULL DEFAULT 'NEGOTIABLE',
    "currency" VARCHAR(16) NOT NULL DEFAULT 'AWCOIN',
    "amount_min" INTEGER NOT NULL DEFAULT 0,
    "amount_max" INTEGER NOT NULL DEFAULT 0,
    "unit_label" VARCHAR(32) NOT NULL DEFAULT '',
    "price_description" VARCHAR(300) NOT NULL DEFAULT '',
    "service_area_mode" VARCHAR(16) NOT NULL DEFAULT 'NATIONWIDE',
    "province" VARCHAR(48) NOT NULL DEFAULT '',
    "city" VARCHAR(48) NOT NULL DEFAULT '',
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "radius_km" DOUBLE PRECISION,
    "delivery_mode" VARCHAR(16) NOT NULL DEFAULT '',
    "response_time" VARCHAR(64) NOT NULL DEFAULT '',
    "qualifications" VARCHAR(300) NOT NULL DEFAULT '',
    "highlights" TEXT NOT NULL,
    "cases" TEXT NOT NULL,
    "reference_links" TEXT NOT NULL,
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "contact_wechat" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_email" VARCHAR(120) NOT NULL DEFAULT '',
    "credential_types" VARCHAR(300) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "aiworkin_published" INTEGER NOT NULL DEFAULT 0,
    "platform_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
    "platform_match_run_id" VARCHAR(64) NOT NULL DEFAULT '',
    "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "aiworkin_sync_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_service_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_capabilities" (
    "id" SERIAL NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',
    "note" VARCHAR(300) NOT NULL DEFAULT '',
    "requested_by" VARCHAR(64) NOT NULL DEFAULT '',
    "opened_by" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_directory" (
    "user_id" VARCHAR(64) NOT NULL,
    "username" VARCHAR(120) NOT NULL DEFAULT '',
    "display_name" VARCHAR(120) NOT NULL DEFAULT '',
    "email" VARCHAR(160) NOT NULL DEFAULT '',
    "avatar_url" VARCHAR(300) NOT NULL DEFAULT '',
    "role" VARCHAR(32) NOT NULL DEFAULT '',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_directory_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "external_channels" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "biz_type" VARCHAR(16) NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_credentials" (
    "id" SERIAL NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "channel_code" VARCHAR(32) NOT NULL,
    "cred_type" VARCHAR(24) NOT NULL,
    "label" VARCHAR(120) NOT NULL DEFAULT '',
    "secret_cipher" TEXT NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_submissions" (
    "id" SERIAL NOT NULL,
    "biz_type" VARCHAR(16) NOT NULL,
    "ref_type" VARCHAR(32) NOT NULL,
    "ref_id" INTEGER NOT NULL,
    "ref_no" VARCHAR(32) NOT NULL DEFAULT '',
    "enterprise_id" INTEGER NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "channel_code" VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    "period" VARCHAR(16) NOT NULL DEFAULT '',
    "tax_type" VARCHAR(32) NOT NULL DEFAULT '',
    "target_system" VARCHAR(120) NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "payload_hash" VARCHAR(64) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    "accept_no" VARCHAR(64) NOT NULL DEFAULT '',
    "receipt_no" VARCHAR(64) NOT NULL DEFAULT '',
    "error_code" VARCHAR(32) NOT NULL DEFAULT '',
    "error_msg" VARCHAR(500) NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "guide" JSONB NOT NULL DEFAULT '{}',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "submitted_by" VARCHAR(64) NOT NULL DEFAULT '',
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_callbacks" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "source" VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    "rawBody" TEXT NOT NULL,
    "signature_valid" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_requests" (
    "id" SERIAL NOT NULL,
    "req_no" VARCHAR(32) NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "enterprise_name" VARCHAR(200) NOT NULL DEFAULT '',
    "requested_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "invoice_type" VARCHAR(8) NOT NULL DEFAULT '04',
    "buyer_type" VARCHAR(8) NOT NULL DEFAULT '1',
    "buyer_name" VARCHAR(200) NOT NULL DEFAULT '',
    "buyer_tax_no" VARCHAR(64) NOT NULL DEFAULT '',
    "order_no" VARCHAR(64) NOT NULL DEFAULT '',
    "remark" VARCHAR(500) NOT NULL DEFAULT '',
    "items" JSONB NOT NULL DEFAULT '[]',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'REQUESTED',
    "reviewed_by" VARCHAR(64) NOT NULL DEFAULT '',
    "reviewed_at" TIMESTAMP(3),
    "reject_reason" VARCHAR(500) NOT NULL DEFAULT '',
    "issue_code" VARCHAR(64) NOT NULL DEFAULT '',
    "issue_message" VARCHAR(500) NOT NULL DEFAULT '',
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_stations" (
    "id" SERIAL NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "region" VARCHAR(64) NOT NULL DEFAULT '',
    "address" VARCHAR(300) NOT NULL DEFAULT '',
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "remark" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_products" (
    "id" SERIAL NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(64) NOT NULL DEFAULT '',
    "base_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unit" VARCHAR(16) NOT NULL DEFAULT '件',
    "attrs" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    "marketing_title" VARCHAR(200) NOT NULL DEFAULT '',
    "marketing_summary" VARCHAR(500) NOT NULL DEFAULT '',
    "marketing_content" TEXT NOT NULL,
    "cover_url" VARCHAR(500) NOT NULL DEFAULT '',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "aiworkin_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
    "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'SKIPPED',
    "aiworkin_sync_note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_product_stations" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "station_id" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_product_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_skus" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "spec_name" VARCHAR(120) NOT NULL,
    "supply_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unit" VARCHAR(16) NOT NULL DEFAULT '件',
    "scene" VARCHAR(200) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_services" (
    "id" SERIAL NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "station_id" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "price_unit" VARCHAR(16) NOT NULL DEFAULT '次',
    "base_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "intro" TEXT NOT NULL,
    "scene" VARCHAR(200) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
    "marketing_title" VARCHAR(200) NOT NULL DEFAULT '',
    "marketing_summary" VARCHAR(500) NOT NULL DEFAULT '',
    "marketing_content" TEXT NOT NULL,
    "cover_url" VARCHAR(500) NOT NULL DEFAULT '',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "aiworkin_listing_id" VARCHAR(64) NOT NULL DEFAULT '',
    "aiworkin_sync_status" VARCHAR(16) NOT NULL DEFAULT 'SKIPPED',
    "aiworkin_sync_note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_orders" (
    "id" SERIAL NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "enterprise_name" VARCHAR(200) NOT NULL DEFAULT '',
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "station_id" INTEGER NOT NULL,
    "station_name" VARCHAR(120) NOT NULL DEFAULT '',
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "expected_date" VARCHAR(16) NOT NULL,
    "remark" VARCHAR(500) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "quoted_at" TIMESTAMP(3),
    "promised_ship_date" VARCHAR(16) NOT NULL DEFAULT '',
    "quote_note" VARCHAR(500) NOT NULL DEFAULT '',
    "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "product_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_fees" JSONB NOT NULL DEFAULT '[]',
    "fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "confirm_note" VARCHAR(500) NOT NULL DEFAULT '',
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "sku_id" INTEGER NOT NULL DEFAULT 0,
    "product_name" VARCHAR(200) NOT NULL,
    "spec_name" VARCHAR(120) NOT NULL DEFAULT '',
    "unit" VARCHAR(16) NOT NULL DEFAULT '件',
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(14,2) NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stock_state" VARCHAR(16) NOT NULL DEFAULT 'SUFFICIENT',
    "shortage_note" VARCHAR(300) NOT NULL DEFAULT '',
    "restock_cycle" VARCHAR(100) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_bookings" (
    "id" SERIAL NOT NULL,
    "booking_no" VARCHAR(32) NOT NULL,
    "enterprise_id" INTEGER NOT NULL,
    "enterprise_name" VARCHAR(200) NOT NULL DEFAULT '',
    "created_by" VARCHAR(64) NOT NULL,
    "provider_user_id" VARCHAR(64) NOT NULL,
    "staff_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "station_id" INTEGER NOT NULL,
    "station_name" VARCHAR(120) NOT NULL DEFAULT '',
    "service_id" INTEGER NOT NULL,
    "service_name" VARCHAR(200) NOT NULL DEFAULT '',
    "price_unit" VARCHAR(16) NOT NULL DEFAULT '',
    "contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "plan_date" VARCHAR(16) NOT NULL,
    "site_address" VARCHAR(300) NOT NULL,
    "scale" VARCHAR(120) NOT NULL DEFAULT '',
    "remark" VARCHAR(500) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "quoted_at" TIMESTAMP(3),
    "base_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_fees" JSONB NOT NULL DEFAULT '[]',
    "fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quote_note" VARCHAR(500) NOT NULL DEFAULT '',
    "provider_contact_name" VARCHAR(64) NOT NULL DEFAULT '',
    "provider_contact_phone" VARCHAR(32) NOT NULL DEFAULT '',
    "confirm_note" VARCHAR(500) NOT NULL DEFAULT '',
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_order_logs" (
    "id" SERIAL NOT NULL,
    "biz_type" VARCHAR(16) NOT NULL,
    "biz_id" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "operator_user_id" VARCHAR(64) NOT NULL,
    "operator_name" VARCHAR(64) NOT NULL DEFAULT '',
    "detail" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_order_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_projects" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "enterprise_id" INTEGER NOT NULL DEFAULT 0,
    "enterprise_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "brand" VARCHAR(120) NOT NULL,
    "brand_aliases" VARCHAR(300) NOT NULL DEFAULT '',
    "industry" VARCHAR(120) NOT NULL DEFAULT '',
    "competitors" JSONB NOT NULL DEFAULT '[]',
    "platforms" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "auto_collect" INTEGER NOT NULL DEFAULT 0,
    "auto_collect_by" VARCHAR(64) NOT NULL DEFAULT '',
    "auto_collect_at" TIMESTAMP(3),
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_questions" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "seq" VARCHAR(16) NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT '品类词',
    "scenario" VARCHAR(300) NOT NULL DEFAULT '',
    "expected_answer_form" VARCHAR(200) NOT NULL DEFAULT '',
    "priority" VARCHAR(8) NOT NULL DEFAULT 'P1',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_batches" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "period_label" VARCHAR(64) NOT NULL,
    "channel" VARCHAR(8) NOT NULL DEFAULT 'A',
    "data_nature" VARCHAR(16) NOT NULL DEFAULT 'simulated',
    "platforms" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL,
    "created_by" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_observations" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "brand_mentioned" INTEGER NOT NULL DEFAULT 0,
    "rank_position" INTEGER,
    "sentiment" VARCHAR(16) NOT NULL DEFAULT '未提及',
    "citation_genre" VARCHAR(16) NOT NULL DEFAULT '无',
    "citation_domains" VARCHAR(500) NOT NULL DEFAULT '',
    "model_version" VARCHAR(64) NOT NULL DEFAULT '',
    "answer_excerpt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_topics" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "gap_type" VARCHAR(32) NOT NULL DEFAULT '引用真空点',
    "question_id" INTEGER NOT NULL DEFAULT 0,
    "platform_count" INTEGER NOT NULL DEFAULT 0,
    "gap_score" INTEGER NOT NULL DEFAULT 0,
    "citable_score" INTEGER NOT NULL DEFAULT 0,
    "business_score" INTEGER NOT NULL DEFAULT 0,
    "supply_score" INTEGER NOT NULL DEFAULT 0,
    "style_bonus" INTEGER NOT NULL DEFAULT 0,
    "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blacklisted" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'CANDIDATE',
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_provider_settings" (
    "code" VARCHAR(32) NOT NULL,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "base_url" VARCHAR(255) NOT NULL DEFAULT '',
    "key_cipher" TEXT,
    "updated_by" VARCHAR(64) NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_provider_settings_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "geo_collect_runs" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "period_label" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "planned" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "batch_id" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "claimed_by" VARCHAR(64) NOT NULL DEFAULT '',
    "heartbeat_at" TIMESTAMP(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_collect_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_collect_items" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500) NOT NULL DEFAULT '',
    "observation_id" INTEGER NOT NULL DEFAULT 0,
    "model_version" VARCHAR(64) NOT NULL DEFAULT '',
    "raw_answer" TEXT,
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_collect_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "smart_service_orders_order_no_key" ON "smart_service_orders"("order_no");

-- CreateIndex
CREATE INDEX "smart_service_orders_created_by_idx" ON "smart_service_orders"("created_by");

-- CreateIndex
CREATE INDEX "smart_service_orders_provider_user_id_status_idx" ON "smart_service_orders"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "smart_service_orders_province_city_idx" ON "smart_service_orders"("province", "city");

-- CreateIndex
CREATE UNIQUE INDEX "asset_requests_request_no_key" ON "asset_requests"("request_no");

-- CreateIndex
CREATE INDEX "asset_requests_created_by_idx" ON "asset_requests"("created_by");

-- CreateIndex
CREATE INDEX "asset_requests_provider_user_id_status_idx" ON "asset_requests"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "asset_requests_province_city_idx" ON "asset_requests"("province", "city");

-- CreateIndex
CREATE UNIQUE INDEX "provider_service_listings_service_no_key" ON "provider_service_listings"("service_no");

-- CreateIndex
CREATE INDEX "provider_service_listings_provider_user_id_domain_idx" ON "provider_service_listings"("provider_user_id", "domain");

-- CreateIndex
CREATE INDEX "provider_service_listings_domain_status_idx" ON "provider_service_listings"("domain", "status");

-- CreateIndex
CREATE INDEX "provider_service_listings_province_city_idx" ON "provider_service_listings"("province", "city");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_capabilities_enterprise_id_code_key" ON "enterprise_capabilities"("enterprise_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "external_channels_code_key" ON "external_channels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "external_credentials_enterprise_id_channel_code_cred_type_l_key" ON "external_credentials"("enterprise_id", "channel_code", "cred_type", "label");

-- CreateIndex
CREATE INDEX "external_submissions_enterprise_id_status_idx" ON "external_submissions"("enterprise_id", "status");

-- CreateIndex
CREATE INDEX "external_submissions_staff_user_id_status_idx" ON "external_submissions"("staff_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_submissions_ref_type_ref_id_period_key" ON "external_submissions"("ref_type", "ref_id", "period");

-- CreateIndex
CREATE INDEX "external_callbacks_submission_id_idx" ON "external_callbacks"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_requests_req_no_key" ON "invoice_requests"("req_no");

-- CreateIndex
CREATE INDEX "invoice_requests_enterprise_id_status_idx" ON "invoice_requests"("enterprise_id", "status");

-- CreateIndex
CREATE INDEX "invoice_requests_staff_user_id_status_idx" ON "invoice_requests"("staff_user_id", "status");

-- CreateIndex
CREATE INDEX "supply_stations_provider_user_id_status_idx" ON "supply_stations"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "supply_products_provider_user_id_status_idx" ON "supply_products"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "supply_product_stations_station_id_status_idx" ON "supply_product_stations"("station_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supply_product_stations_product_id_station_id_key" ON "supply_product_stations"("product_id", "station_id");

-- CreateIndex
CREATE INDEX "supply_skus_product_id_idx" ON "supply_skus"("product_id");

-- CreateIndex
CREATE INDEX "supply_services_provider_user_id_status_idx" ON "supply_services"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "supply_services_station_id_status_idx" ON "supply_services"("station_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supply_orders_order_no_key" ON "supply_orders"("order_no");

-- CreateIndex
CREATE INDEX "supply_orders_enterprise_id_status_idx" ON "supply_orders"("enterprise_id", "status");

-- CreateIndex
CREATE INDEX "supply_orders_provider_user_id_status_idx" ON "supply_orders"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "supply_orders_staff_user_id_status_idx" ON "supply_orders"("staff_user_id", "status");

-- CreateIndex
CREATE INDEX "supply_orders_station_id_status_idx" ON "supply_orders"("station_id", "status");

-- CreateIndex
CREATE INDEX "supply_order_items_order_id_idx" ON "supply_order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "supply_bookings_booking_no_key" ON "supply_bookings"("booking_no");

-- CreateIndex
CREATE INDEX "supply_bookings_enterprise_id_status_idx" ON "supply_bookings"("enterprise_id", "status");

-- CreateIndex
CREATE INDEX "supply_bookings_provider_user_id_status_idx" ON "supply_bookings"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "supply_bookings_staff_user_id_status_idx" ON "supply_bookings"("staff_user_id", "status");

-- CreateIndex
CREATE INDEX "supply_bookings_station_id_status_idx" ON "supply_bookings"("station_id", "status");

-- CreateIndex
CREATE INDEX "supply_order_logs_biz_type_biz_id_idx" ON "supply_order_logs"("biz_type", "biz_id");

-- CreateIndex
CREATE INDEX "geo_projects_owner_user_id_idx" ON "geo_projects"("owner_user_id");

-- CreateIndex
CREATE INDEX "geo_projects_enterprise_id_idx" ON "geo_projects"("enterprise_id");

-- CreateIndex
CREATE INDEX "geo_questions_project_id_idx" ON "geo_questions"("project_id");

-- CreateIndex
CREATE INDEX "geo_batches_project_id_idx" ON "geo_batches"("project_id");

-- CreateIndex
CREATE INDEX "geo_observations_batch_id_idx" ON "geo_observations"("batch_id");

-- CreateIndex
CREATE INDEX "geo_observations_question_id_idx" ON "geo_observations"("question_id");

-- CreateIndex
CREATE INDEX "geo_topics_project_id_idx" ON "geo_topics"("project_id");

-- CreateIndex
CREATE INDEX "geo_collect_runs_status_idx" ON "geo_collect_runs"("status");

-- CreateIndex
CREATE INDEX "geo_collect_runs_week_start_idx" ON "geo_collect_runs"("week_start");

-- CreateIndex
CREATE UNIQUE INDEX "geo_collect_runs_project_id_week_start_key" ON "geo_collect_runs"("project_id", "week_start");

-- CreateIndex
CREATE INDEX "geo_collect_items_run_id_status_idx" ON "geo_collect_items"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "geo_collect_items_run_id_question_id_platform_key" ON "geo_collect_items"("run_id", "question_id", "platform");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_action_idx" ON "audit_logs"("user_id", "action");

-- CreateIndex
CREATE INDEX "flex_onboardings_enterprise_id_idx" ON "flex_onboardings"("enterprise_id");

-- CreateIndex
CREATE INDEX "flex_onboardings_staff_user_id_idx" ON "flex_onboardings"("staff_user_id");

-- CreateIndex
CREATE INDEX "flex_onboardings_provider_user_id_status_idx" ON "flex_onboardings"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "flex_onboardings_onboarding_no_idx" ON "flex_onboardings"("onboarding_no");

-- CreateIndex
CREATE INDEX "flex_payrolls_enterprise_id_idx" ON "flex_payrolls"("enterprise_id");

-- CreateIndex
CREATE INDEX "flex_payrolls_provider_user_id_status_idx" ON "flex_payrolls"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "flex_work_orders_created_by_idx" ON "flex_work_orders"("created_by");

-- CreateIndex
CREATE INDEX "flex_work_orders_enterprise_id_idx" ON "flex_work_orders"("enterprise_id");

-- CreateIndex
CREATE INDEX "flex_work_orders_staff_user_id_idx" ON "flex_work_orders"("staff_user_id");

-- CreateIndex
CREATE INDEX "flex_work_orders_provider_user_id_status_idx" ON "flex_work_orders"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "flex_work_orders_province_city_idx" ON "flex_work_orders"("province", "city");

-- CreateIndex
CREATE INDEX "ip_requests_created_by_idx" ON "ip_requests"("created_by");

-- CreateIndex
CREATE INDEX "ip_requests_enterprise_id_idx" ON "ip_requests"("enterprise_id");

-- CreateIndex
CREATE INDEX "ip_requests_staff_user_id_idx" ON "ip_requests"("staff_user_id");

-- CreateIndex
CREATE INDEX "ip_requests_provider_user_id_status_idx" ON "ip_requests"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "ip_requests_province_city_idx" ON "ip_requests"("province", "city");

-- CreateIndex
CREATE INDEX "legal_requests_created_by_idx" ON "legal_requests"("created_by");

-- CreateIndex
CREATE INDEX "legal_requests_enterprise_id_idx" ON "legal_requests"("enterprise_id");

-- CreateIndex
CREATE INDEX "legal_requests_staff_user_id_idx" ON "legal_requests"("staff_user_id");

-- CreateIndex
CREATE INDEX "legal_requests_provider_user_id_status_idx" ON "legal_requests"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "legal_requests_province_city_idx" ON "legal_requests"("province", "city");

-- CreateIndex
CREATE INDEX "logistics_orders_province_city_idx" ON "logistics_orders"("province", "city");

-- CreateIndex
CREATE INDEX "marketing_orders_provider_user_id_status_idx" ON "marketing_orders"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "marketing_orders_province_city_idx" ON "marketing_orders"("province", "city");

-- CreateIndex
CREATE INDEX "staff_applications_staff_user_id_status_idx" ON "staff_applications"("staff_user_id", "status");

-- CreateIndex
CREATE INDEX "tax_declarations_enterprise_id_idx" ON "tax_declarations"("enterprise_id");

-- CreateIndex
CREATE INDEX "tax_declarations_staff_user_id_idx" ON "tax_declarations"("staff_user_id");

-- CreateIndex
CREATE INDEX "tax_declarations_provider_user_id_status_idx" ON "tax_declarations"("provider_user_id", "status");

-- CreateIndex
CREATE INDEX "tax_declarations_material_id_idx" ON "tax_declarations"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_material_packs_enterprise_id_period_key" ON "tax_material_packs"("enterprise_id", "period");


COMMIT;
