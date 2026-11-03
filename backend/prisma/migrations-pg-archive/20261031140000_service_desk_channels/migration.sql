-- CreateTable
CREATE TABLE "service_desk_channels" (
    "id" SERIAL NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "config" TEXT NOT NULL,
    "callback_token" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cursor" TEXT NOT NULL DEFAULT '',
    "last_event_at" TIMESTAMP(3),
    "last_error" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_desk_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_desk_channels_callback_token_key" ON "service_desk_channels"("callback_token");

-- CreateIndex
CREATE INDEX "service_desk_channels_owner_user_id_idx" ON "service_desk_channels"("owner_user_id");

-- AlterTable
ALTER TABLE "service_desk_conversations" ADD COLUMN     "channel_id" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "external_chat_id" VARCHAR(191) NOT NULL DEFAULT '',
ADD COLUMN     "external_message_id" VARCHAR(191) NOT NULL DEFAULT '',
ADD COLUMN     "external_user_id" VARCHAR(191) NOT NULL DEFAULT '',
ADD COLUMN     "external_user_name" VARCHAR(120) NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "service_desk_conversations_channel_id_external_chat_id_stat_idx" ON "service_desk_conversations"("channel_id", "external_chat_id", "status");

-- AlterTable
ALTER TABLE "service_desk_messages" ADD COLUMN     "external_msg_id" VARCHAR(191) NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "service_desk_messages_conversation_id_external_msg_id_idx" ON "service_desk_messages"("conversation_id", "external_msg_id");
