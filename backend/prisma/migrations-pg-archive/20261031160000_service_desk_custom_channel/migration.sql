-- AlterTable
ALTER TABLE "service_desk_conversations" ADD COLUMN "external_meta" JSONB NOT NULL DEFAULT '{}';
