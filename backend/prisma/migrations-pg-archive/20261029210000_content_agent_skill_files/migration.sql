-- 技能包：zip 上传后除 SKILL.md 正文，还保留包内附加文本文件
-- AlterTable
ALTER TABLE "content_agent_skills"
ADD COLUMN IF NOT EXISTS "files" JSONB NOT NULL DEFAULT '[]';
