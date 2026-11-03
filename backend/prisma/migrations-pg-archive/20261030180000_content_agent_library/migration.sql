-- Agent 资料库：条目（数字资产引用/回流产出）、检索节点、待确认改写草稿

CREATE TABLE "content_agent_library_items" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "aipdd_asset_id" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(16) NOT NULL DEFAULT 'asset',
    "name" VARCHAR(200) NOT NULL DEFAULT '',
    "type" VARCHAR(16) NOT NULL DEFAULT 'md',
    "url" TEXT NOT NULL DEFAULT '',
    "file_size" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL DEFAULT '',
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "node_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ready',
    "note" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_agent_library_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_agent_library_items_user_id_updated_at_idx"
    ON "content_agent_library_items"("user_id", "updated_at");
CREATE INDEX "content_agent_library_items_user_id_aipdd_asset_id_idx"
    ON "content_agent_library_items"("user_id", "aipdd_asset_id");

CREATE TABLE "content_agent_library_nodes" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'section',
    "path" VARCHAR(300) NOT NULL DEFAULT '',
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "chars" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_agent_library_nodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_agent_library_nodes_item_id_ordinal_idx"
    ON "content_agent_library_nodes"("item_id", "ordinal");
CREATE INDEX "content_agent_library_nodes_user_id_idx"
    ON "content_agent_library_nodes"("user_id");

CREATE TABLE "content_agent_library_drafts" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "item_id" INTEGER NOT NULL,
    "node_id" INTEGER NOT NULL DEFAULT 0,
    "node_path" VARCHAR(300) NOT NULL DEFAULT '',
    "reason" VARCHAR(300) NOT NULL DEFAULT '',
    "before" TEXT NOT NULL DEFAULT '',
    "after" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "content_agent_library_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_agent_library_drafts_user_id_status_created_at_idx"
    ON "content_agent_library_drafts"("user_id", "status", "created_at");
CREATE INDEX "content_agent_library_drafts_item_id_idx"
    ON "content_agent_library_drafts"("item_id");
