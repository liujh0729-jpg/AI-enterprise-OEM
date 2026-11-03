-- Agent 参考素材：用户这一轮带上的图片/音频/视频（label 用于 @ 调取与工具引用）
-- AlterTable
ALTER TABLE "content_agent_messages"
ADD COLUMN IF NOT EXISTS "references" JSONB NOT NULL DEFAULT '[]';
