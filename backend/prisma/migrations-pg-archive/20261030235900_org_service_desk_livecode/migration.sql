-- CreateTable
CREATE TABLE "org_staff" (
    "id" SERIAL NOT NULL,
    "org_type" VARCHAR(16) NOT NULL,
    "org_user_id" VARCHAR(64) NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "member_kind" VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    "roles" JSONB NOT NULL DEFAULT '[]',
    "department" VARCHAR(64) NOT NULL DEFAULT '',
    "title" VARCHAR(64) NOT NULL DEFAULT '',
    "scope" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "invited_by" VARCHAR(64) NOT NULL DEFAULT '',
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_applications" (
    "id" SERIAL NOT NULL,
    "org_type" VARCHAR(16) NOT NULL,
    "org_user_id" VARCHAR(64) NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "member_kind" VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    "direction" VARCHAR(16) NOT NULL,
    "roles" JSONB NOT NULL DEFAULT '[]',
    "department" VARCHAR(64) NOT NULL DEFAULT '',
    "title" VARCHAR(64) NOT NULL DEFAULT '',
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "created_by" VARCHAR(64) NOT NULL DEFAULT '',
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "level" VARCHAR(16) NOT NULL DEFAULT 'info',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" VARCHAR(500) NOT NULL DEFAULT '',
    "entity_type" VARCHAR(32) NOT NULL DEFAULT '',
    "entity_id" VARCHAR(64) NOT NULL DEFAULT '',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_sites" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "site_key" VARCHAR(48) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "allowedOrigins" JSONB NOT NULL DEFAULT '[]',
    "appearance" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_desk_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_settings" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "business_hours" JSONB NOT NULL DEFAULT '{}',
    "welcome_text" TEXT NOT NULL DEFAULT '',
    "queue_text" TEXT NOT NULL DEFAULT '',
    "offline_text" TEXT NOT NULL DEFAULT '',
    "auto_assign" BOOLEAN NOT NULL DEFAULT true,
    "max_concurrent" INTEGER NOT NULL DEFAULT 5,
    "rating_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_mode" VARCHAR(16) NOT NULL DEFAULT 'CANNED',
    "ai_channel_id" INTEGER NOT NULL DEFAULT 0,
    "ai_model" VARCHAR(128) NOT NULL DEFAULT '',
    "ai_handoff_keywords" JSONB NOT NULL DEFAULT '[]',
    "library_ids" JSONB NOT NULL DEFAULT '[]',
    "require_contact" BOOLEAN NOT NULL DEFAULT false,
    "retention_days" INTEGER NOT NULL DEFAULT 180,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_desk_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_groups" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_desk_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_agents" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'agent',
    "group_id" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OFFLINE',
    "max_concurrent" INTEGER NOT NULL DEFAULT 5,
    "last_assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_desk_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_visitors" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "site_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "nickname" VARCHAR(60) NOT NULL DEFAULT '',
    "contact" VARCHAR(120) NOT NULL DEFAULT '',
    "user_agent" VARCHAR(255) NOT NULL DEFAULT '',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_desk_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_conversations" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "site_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL DEFAULT 0,
    "assignee_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "visitor_id" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'waiting',
    "source_url" VARCHAR(500) NOT NULL DEFAULT '',
    "subject" VARCHAR(120) NOT NULL DEFAULT '',
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unread_for_agent" INTEGER NOT NULL DEFAULT 0,
    "unread_for_requester" INTEGER NOT NULL DEFAULT 0,
    "ai_mode" VARCHAR(16) NOT NULL DEFAULT 'CANNED',
    "transfer_count" INTEGER NOT NULL DEFAULT 0,
    "first_response_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "rating" INTEGER NOT NULL DEFAULT 0,
    "rating_comment" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_desk_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_messages" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "sender_type" VARCHAR(16) NOT NULL,
    "sender_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "content_type" VARCHAR(16) NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL DEFAULT '',
    "attachment_url" VARCHAR(500) NOT NULL DEFAULT '',
    "attachment_name" VARCHAR(200) NOT NULL DEFAULT '',
    "attachment_size" INTEGER NOT NULL DEFAULT 0,
    "client_msg_id" VARCHAR(64) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_desk_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_canned_replies" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(16) NOT NULL DEFAULT 'shared',
    "user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "title" VARCHAR(80) NOT NULL,
    "content" TEXT NOT NULL,
    "category" VARCHAR(40) NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_desk_canned_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_faqs" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "keywords" VARCHAR(300) NOT NULL DEFAULT '',
    "answer" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_desk_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_qr_domains" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "domain_key" VARCHAR(16) NOT NULL,
    "mode" VARCHAR(16) NOT NULL DEFAULT 'CDN',
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "acked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "last_check_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_qr_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_qr_codes" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "entry_mode" VARCHAR(16) NOT NULL DEFAULT 'CDN',
    "domain_mode" VARCHAR(16) NOT NULL DEFAULT 'ROTATE',
    "domain_id" INTEGER NOT NULL DEFAULT 0,
    "current_domain_id" INTEGER NOT NULL DEFAULT 0,
    "auto_failover" BOOLEAN NOT NULL DEFAULT true,
    "entry_changed_at" TIMESTAMP(3),
    "script_url" VARCHAR(500) NOT NULL DEFAULT '',
    "title" VARCHAR(60) NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "select_mode" VARCHAR(16) NOT NULL DEFAULT 'RANDOM',
    "sticky" BOOLEAN NOT NULL DEFAULT true,
    "limit_scope" VARCHAR(16) NOT NULL DEFAULT 'NONE',
    "daily_limit" INTEGER NOT NULL DEFAULT 0,
    "total_limit" INTEGER NOT NULL DEFAULT 0,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "fallback_child_id" INTEGER NOT NULL DEFAULT 0,
    "today_date" VARCHAR(10) NOT NULL DEFAULT '',
    "today_count" INTEGER NOT NULL DEFAULT 0,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "disabled_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_qr_children" (
    "id" SERIAL NOT NULL,
    "code_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "image_key" VARCHAR(255) NOT NULL DEFAULT '',
    "link_url" VARCHAR(1000) NOT NULL DEFAULT '',
    "text_content" TEXT NOT NULL DEFAULT '',
    "channel" VARCHAR(32) NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "limit_scope" VARCHAR(16) NOT NULL DEFAULT 'INHERIT',
    "daily_limit" INTEGER NOT NULL DEFAULT 0,
    "total_limit" INTEGER NOT NULL DEFAULT 0,
    "today_date" VARCHAR(10) NOT NULL DEFAULT '',
    "today_count" INTEGER NOT NULL DEFAULT 0,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_qr_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_qr_scans" (
    "id" SERIAL NOT NULL,
    "code_id" INTEGER NOT NULL,
    "child_id" INTEGER NOT NULL DEFAULT 0,
    "domain_id" INTEGER NOT NULL DEFAULT 0,
    "channel" VARCHAR(32) NOT NULL DEFAULT '',
    "visitor_hash" VARCHAR(64) NOT NULL DEFAULT '',
    "ip_hash" VARCHAR(64) NOT NULL DEFAULT '',
    "ua" VARCHAR(255) NOT NULL DEFAULT '',
    "region" VARCHAR(32) NOT NULL DEFAULT '',
    "device" VARCHAR(16) NOT NULL DEFAULT '',
    "result" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_qr_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_staff_org_type_org_user_id_status_idx" ON "org_staff"("org_type", "org_user_id", "status");

-- CreateIndex
CREATE INDEX "org_staff_member_user_id_status_idx" ON "org_staff"("member_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "org_staff_org_type_org_user_id_member_user_id_key" ON "org_staff"("org_type", "org_user_id", "member_user_id");

-- CreateIndex
CREATE INDEX "org_applications_org_type_org_user_id_status_idx" ON "org_applications"("org_type", "org_user_id", "status");

-- CreateIndex
CREATE INDEX "org_applications_member_user_id_status_idx" ON "org_applications"("member_user_id", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_id_idx" ON "notifications"("user_id", "read_at", "id");

-- CreateIndex
CREATE INDEX "notifications_user_id_category_idx" ON "notifications"("user_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "service_desk_sites_site_key_key" ON "service_desk_sites"("site_key");

-- CreateIndex
CREATE INDEX "service_desk_sites_owner_user_id_idx" ON "service_desk_sites"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_desk_settings_owner_user_id_key" ON "service_desk_settings"("owner_user_id");

-- CreateIndex
CREATE INDEX "service_desk_groups_owner_user_id_idx" ON "service_desk_groups"("owner_user_id");

-- CreateIndex
CREATE INDEX "service_desk_agents_owner_user_id_status_idx" ON "service_desk_agents"("owner_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_desk_agents_owner_user_id_member_user_id_key" ON "service_desk_agents"("owner_user_id", "member_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_desk_visitors_token_hash_key" ON "service_desk_visitors"("token_hash");

-- CreateIndex
CREATE INDEX "service_desk_visitors_owner_user_id_site_id_idx" ON "service_desk_visitors"("owner_user_id", "site_id");

-- CreateIndex
CREATE INDEX "service_desk_conversations_owner_user_id_status_last_messag_idx" ON "service_desk_conversations"("owner_user_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "service_desk_conversations_assignee_user_id_status_idx" ON "service_desk_conversations"("assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "service_desk_conversations_site_id_created_at_idx" ON "service_desk_conversations"("site_id", "created_at");

-- CreateIndex
CREATE INDEX "service_desk_messages_conversation_id_id_idx" ON "service_desk_messages"("conversation_id", "id");

-- CreateIndex
CREATE INDEX "service_desk_messages_conversation_id_client_msg_id_idx" ON "service_desk_messages"("conversation_id", "client_msg_id");

-- CreateIndex
CREATE INDEX "service_desk_canned_replies_owner_user_id_scope_idx" ON "service_desk_canned_replies"("owner_user_id", "scope");

-- CreateIndex
CREATE INDEX "service_desk_faqs_owner_user_id_enabled_idx" ON "service_desk_faqs"("owner_user_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_qr_domains_domain_key" ON "marketing_qr_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_qr_domains_domain_key_key" ON "marketing_qr_domains"("domain_key");

-- CreateIndex
CREATE INDEX "marketing_qr_domains_user_id_idx" ON "marketing_qr_domains"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_qr_codes_code_key" ON "marketing_qr_codes"("code");

-- CreateIndex
CREATE INDEX "marketing_qr_codes_user_id_created_at_idx" ON "marketing_qr_codes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_qr_codes_current_domain_id_idx" ON "marketing_qr_codes"("current_domain_id");

-- CreateIndex
CREATE INDEX "marketing_qr_children_code_id_status_idx" ON "marketing_qr_children"("code_id", "status");

-- CreateIndex
CREATE INDEX "marketing_qr_scans_code_id_created_at_idx" ON "marketing_qr_scans"("code_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_qr_scans_child_id_created_at_idx" ON "marketing_qr_scans"("child_id", "created_at");

-- 回填：服务商旧表 → 统一组织成员（幂等，可重复执行）
INSERT INTO "org_staff" ("org_type", "org_user_id", "member_user_id", "member_kind", "roles", "status", "created_at", "updated_at", "confirmed_at")
SELECT 'PROVIDER', ps."provider_user_id", ps."staff_user_id", 'STAFF', ps."roles", ps."status", ps."created_at", NOW(), ps."created_at"
FROM "provider_staff" ps
ON CONFLICT ("org_type", "org_user_id", "member_user_id") DO NOTHING;

-- 回填：服务商的申请/邀请 → 统一申请表（按发起时间做幂等键）
INSERT INTO "org_applications" ("org_type", "org_user_id", "member_user_id", "member_kind", "direction", "roles", "note", "status", "created_by", "created_at", "decided_at")
SELECT 'PROVIDER', sa."provider_user_id", sa."staff_user_id", 'STAFF',
       CASE WHEN sa."direction" = 'PROVIDER_INVITE' THEN 'INVITE' ELSE 'JOIN' END,
       COALESCE(to_jsonb(string_to_array(NULLIF(sa."roles", ''), ',')), '[]'::jsonb),
       sa."note", sa."status",
       CASE WHEN sa."direction" = 'PROVIDER_INVITE' THEN sa."provider_user_id" ELSE sa."staff_user_id" END,
       sa."created_at", sa."audited_at"
FROM "staff_applications" sa
WHERE NOT EXISTS (
  SELECT 1 FROM "org_applications" oa
  WHERE oa."org_type" = 'PROVIDER'
    AND oa."org_user_id" = sa."provider_user_id"
    AND oa."member_user_id" = sa."staff_user_id"
    AND oa."created_at" = sa."created_at"
);