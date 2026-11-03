-- IM 连接（飞书 / 企业微信）：连接器、成员/部门映射、同步对象与记录、通知规则
CREATE TABLE "im_connectors" (
  "id" SERIAL NOT NULL,
  "org_type" VARCHAR(16) NOT NULL,
  "org_user_id" VARCHAR(64) NOT NULL,
  "provider" VARCHAR(16) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "corp_id" VARCHAR(120) NOT NULL DEFAULT '',
  "app_id" VARCHAR(120) NOT NULL DEFAULT '',
  "app_secret_enc" TEXT NOT NULL DEFAULT '',
  "agent_id" VARCHAR(64) NOT NULL DEFAULT '',
  "contact_secret_enc" TEXT NOT NULL DEFAULT '',
  "verification_token" VARCHAR(120) NOT NULL DEFAULT '',
  "encrypt_key_enc" TEXT NOT NULL DEFAULT '',
  "webhook_token" VARCHAR(32) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "last_verified_at" TIMESTAMP(3),
  "created_by" VARCHAR(64) NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "im_connectors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "im_connectors_org_type_org_user_id_provider_corp_id_key" ON "im_connectors"("org_type","org_user_id","provider","corp_id");
CREATE UNIQUE INDEX "im_connectors_webhook_token_key" ON "im_connectors"("webhook_token");
CREATE INDEX "im_connectors_org_type_org_user_id_idx" ON "im_connectors"("org_type","org_user_id");

CREATE TABLE "im_member_links" (
  "id" SERIAL NOT NULL,
  "connector_id" INTEGER NOT NULL,
  "member_user_id" VARCHAR(64) NOT NULL DEFAULT '',
  "external_user_id" VARCHAR(120) NOT NULL,
  "union_id" VARCHAR(120) NOT NULL DEFAULT '',
  "name_snapshot" VARCHAR(120) NOT NULL DEFAULT '',
  "mobile_snapshot" VARCHAR(40) NOT NULL DEFAULT '',
  "department_external_id" VARCHAR(120) NOT NULL DEFAULT '',
  "source" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "im_member_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "im_member_links_connector_id_external_user_id_key" ON "im_member_links"("connector_id","external_user_id");
CREATE INDEX "im_member_links_connector_id_member_user_id_idx" ON "im_member_links"("connector_id","member_user_id");

CREATE TABLE "im_dept_links" (
  "id" SERIAL NOT NULL,
  "connector_id" INTEGER NOT NULL,
  "department" VARCHAR(64) NOT NULL,
  "external_dept_id" VARCHAR(120) NOT NULL,
  "name" VARCHAR(120) NOT NULL DEFAULT '',
  "parent_external_id" VARCHAR(120) NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "im_dept_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "im_dept_links_connector_id_department_key" ON "im_dept_links"("connector_id","department");

CREATE TABLE "im_object_bindings" (
  "id" SERIAL NOT NULL,
  "connector_id" INTEGER NOT NULL,
  "module" VARCHAR(16) NOT NULL,
  "object_key" VARCHAR(120) NOT NULL,
  "direction" VARCHAR(8) NOT NULL DEFAULT 'PUSH',
  "config" JSONB NOT NULL DEFAULT '{}',
  "field_map" JSONB NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_sync_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "im_object_bindings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "im_object_bindings_connector_id_module_object_key_key" ON "im_object_bindings"("connector_id","module","object_key");

CREATE TABLE "im_object_links" (
  "id" SERIAL NOT NULL,
  "binding_id" INTEGER NOT NULL,
  "module" VARCHAR(16) NOT NULL,
  "local_id" VARCHAR(120) NOT NULL,
  "external_id" VARCHAR(120) NOT NULL,
  "local_hash" VARCHAR(64) NOT NULL DEFAULT '',
  "external_hash" VARCHAR(64) NOT NULL DEFAULT '',
  "last_direction" VARCHAR(8) NOT NULL DEFAULT '',
  "status" VARCHAR(16) NOT NULL DEFAULT 'LINKED',
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "im_object_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "im_object_links_binding_id_local_id_key" ON "im_object_links"("binding_id","local_id");
CREATE INDEX "im_object_links_binding_id_external_id_idx" ON "im_object_links"("binding_id","external_id");

CREATE TABLE "im_events" (
  "id" SERIAL NOT NULL,
  "connector_id" INTEGER NOT NULL,
  "direction" VARCHAR(8) NOT NULL,
  "kind" VARCHAR(8) NOT NULL,
  "event_id" VARCHAR(160) NOT NULL,
  "object_type" VARCHAR(40) NOT NULL DEFAULT '',
  "object_id" VARCHAR(120) NOT NULL DEFAULT '',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" VARCHAR(500) NOT NULL DEFAULT '',
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "im_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "im_events_connector_id_event_id_key" ON "im_events"("connector_id","event_id");
CREATE INDEX "im_events_connector_id_status_idx" ON "im_events"("connector_id","status");

CREATE TABLE "im_notify_rules" (
  "id" SERIAL NOT NULL,
  "connector_id" INTEGER NOT NULL,
  "rules" JSONB NOT NULL DEFAULT '[]',
  "quiet_hours" JSONB NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "im_notify_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "im_notify_rules_connector_id_key" ON "im_notify_rules"("connector_id");