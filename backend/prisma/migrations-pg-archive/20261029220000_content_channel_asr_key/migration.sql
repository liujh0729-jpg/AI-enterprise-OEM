-- 火山引擎渠道：豆包语音识别（openspeech）Key 与方舟 API Key 不通用，单独一列
-- AlterTable
ALTER TABLE "content_model_channels"
ADD COLUMN IF NOT EXISTS "asr_key_cipher" TEXT NOT NULL DEFAULT '';
