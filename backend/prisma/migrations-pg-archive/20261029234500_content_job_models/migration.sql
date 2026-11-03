-- 内容创作任务记录本轮用户选的模型：{ mediaType: { channelId, model } }
-- AlterTable
ALTER TABLE "content_generation_jobs"
ADD COLUMN IF NOT EXISTS "models" JSONB NOT NULL DEFAULT '{}';
