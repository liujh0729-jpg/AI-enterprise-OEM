-- 渠道预设：OpenAI / Claude / DeepSeek / 通义 / Kimi / 智谱 / OpenRouter / 自定义
-- AlterTable
ALTER TABLE "content_model_channels"
ADD COLUMN IF NOT EXISTS "preset" VARCHAR(16) NOT NULL DEFAULT '';
