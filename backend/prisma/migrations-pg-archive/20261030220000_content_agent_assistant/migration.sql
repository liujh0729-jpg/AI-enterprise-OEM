-- Agent 助理：第三方消息通道绑定、外部聊天与 Agent 会话的映射、往来消息日志

CREATE TABLE "content_agent_assistant_channels" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "webhook_token" VARCHAR(32) NOT NULL,
    "config_cipher" TEXT NOT NULL DEFAULT '',
    "channel_id" INTEGER NOT NULL DEFAULT 0,
    "model" VARCHAR(128) NOT NULL DEFAULT '',
    "allowed_users" VARCHAR(500) NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_event_at" TIMESTAMP(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_agent_assistant_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_agent_assistant_channels_webhook_token_key"
    ON "content_agent_assistant_channels"("webhook_token");
CREATE INDEX "content_agent_assistant_channels_user_id_created_at_idx"
    ON "content_agent_assistant_channels"("user_id", "created_at");

CREATE TABLE "content_agent_assistant_chats" (
    "id" SERIAL NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "external_chat_id" VARCHAR(191) NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL DEFAULT '',
    "cursor" VARCHAR(191) NOT NULL DEFAULT '',
    "last_user_id" VARCHAR(191) NOT NULL DEFAULT '',
    "last_message_at" TIMESTAMP(3),
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_agent_assistant_chats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_agent_assistant_chats_channel_id_external_chat_id_key"
    ON "content_agent_assistant_chats"("channel_id", "external_chat_id");
CREATE INDEX "content_agent_assistant_chats_user_id_last_message_at_idx"
    ON "content_agent_assistant_chats"("user_id", "last_message_at");

CREATE TABLE "content_agent_assistant_messages" (
    "id" SERIAL NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "external_chat_id" VARCHAR(191) NOT NULL,
    "external_msg_id" VARCHAR(191),
    "direction" VARCHAR(8) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'received',
    "error" VARCHAR(500) NOT NULL DEFAULT '',
    "conversation_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_agent_assistant_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_agent_assistant_messages_channel_id_external_msg_id_key"
    ON "content_agent_assistant_messages"("channel_id", "external_msg_id");
CREATE INDEX "content_agent_assistant_messages_channel_id_created_at_idx"
    ON "content_agent_assistant_messages"("channel_id", "created_at");
CREATE INDEX "content_agent_assistant_messages_user_id_created_at_idx"
    ON "content_agent_assistant_messages"("user_id", "created_at");
