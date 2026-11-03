-- AlterTable
ALTER TABLE "data_tables" ADD COLUMN     "project_id" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "lowcode_projects" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "org_type" VARCHAR(16) NOT NULL DEFAULT '',
    "org_user_id" VARCHAR(64) NOT NULL DEFAULT '',
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "icon" VARCHAR(64) NOT NULL DEFAULT 'appstore',
    "type" VARCHAR(16) NOT NULL DEFAULT 'BLANK',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lowcode_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_project_members" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "member_user_id" VARCHAR(64) NOT NULL,
    "role_id" INTEGER NOT NULL DEFAULT 0,
    "department" VARCHAR(100) NOT NULL DEFAULT '',
    "title" VARCHAR(100) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lowcode_project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_roles" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lowcode_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_role_permissions" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "resource_type" VARCHAR(16) NOT NULL,
    "resource_id" VARCHAR(64) NOT NULL DEFAULT '',
    "actions" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "lowcode_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_data_rules" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "entity_id" INTEGER NOT NULL DEFAULT 0,
    "role_id" INTEGER NOT NULL DEFAULT 0,
    "field" VARCHAR(64) NOT NULL,
    "op" VARCHAR(16) NOT NULL,
    "value" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lowcode_data_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_entities" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "data_table_id" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "icon" VARCHAR(64) NOT NULL DEFAULT 'table',
    "form_layout" JSONB NOT NULL DEFAULT '{}',
    "list_layout" JSONB NOT NULL DEFAULT '{}',
    "kanban_field" VARCHAR(64) NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lowcode_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_pages" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "parent_id" INTEGER NOT NULL DEFAULT 0,
    "type" VARCHAR(16) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "entity_id" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lowcode_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_approval_flows" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lowcode_approval_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_approval_flow_versions" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "created_by" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lowcode_approval_flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_approval_instances" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "row_id" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    "applicant_user_id" VARCHAR(64) NOT NULL,
    "node_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "lowcode_approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_approval_tasks" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "node_index" INTEGER NOT NULL,
    "node_name" VARCHAR(50) NOT NULL DEFAULT '',
    "assignee_user_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "comment" VARCHAR(500) NOT NULL DEFAULT '',
    "acted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lowcode_approval_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lowcode_approval_records" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "task_id" INTEGER NOT NULL DEFAULT 0,
    "action" VARCHAR(16) NOT NULL,
    "actor_user_id" VARCHAR(64) NOT NULL,
    "comment" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lowcode_approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lowcode_projects_owner_user_id_idx" ON "lowcode_projects"("owner_user_id");

-- CreateIndex
CREATE INDEX "lowcode_projects_org_type_org_user_id_idx" ON "lowcode_projects"("org_type", "org_user_id");

-- CreateIndex
CREATE INDEX "lowcode_project_members_member_user_id_idx" ON "lowcode_project_members"("member_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lowcode_project_members_project_id_member_user_id_key" ON "lowcode_project_members"("project_id", "member_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lowcode_roles_project_id_key_key" ON "lowcode_roles"("project_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "lowcode_role_permissions_role_id_resource_type_resource_id_key" ON "lowcode_role_permissions"("role_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "lowcode_data_rules_project_id_entity_id_idx" ON "lowcode_data_rules"("project_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "lowcode_entities_project_id_data_table_id_key" ON "lowcode_entities"("project_id", "data_table_id");

-- CreateIndex
CREATE INDEX "lowcode_pages_project_id_sort_idx" ON "lowcode_pages"("project_id", "sort");

-- CreateIndex
CREATE INDEX "lowcode_approval_flows_project_id_entity_id_idx" ON "lowcode_approval_flows"("project_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "lowcode_approval_flow_versions_flow_id_version_key" ON "lowcode_approval_flow_versions"("flow_id", "version");

-- CreateIndex
CREATE INDEX "lowcode_approval_instances_project_id_status_idx" ON "lowcode_approval_instances"("project_id", "status");

-- CreateIndex
CREATE INDEX "lowcode_approval_instances_entity_id_row_id_idx" ON "lowcode_approval_instances"("entity_id", "row_id");

-- CreateIndex
CREATE INDEX "lowcode_approval_tasks_assignee_user_id_status_idx" ON "lowcode_approval_tasks"("assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "lowcode_approval_tasks_instance_id_idx" ON "lowcode_approval_tasks"("instance_id");

-- CreateIndex
CREATE INDEX "lowcode_approval_records_instance_id_idx" ON "lowcode_approval_records"("instance_id");

-- CreateIndex
CREATE INDEX "data_tables_project_id_idx" ON "data_tables"("project_id");
