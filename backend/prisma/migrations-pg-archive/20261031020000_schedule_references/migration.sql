-- 定时任务：固定参考文件（图片 / 视频 / 音频），执行时随这一轮一起下发
ALTER TABLE "content_agent_schedules"
    ADD COLUMN "references" JSONB NOT NULL DEFAULT '[]';