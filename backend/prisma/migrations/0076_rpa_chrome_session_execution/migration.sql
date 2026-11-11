-- 0076 会话关联执行记录（方案 §5.3）：由 RpaTask 发起的会话记录它claim 出的 RpaTaskExecution，
-- 会话结束按它回写执行终态与任务状态，页面直接开会话时为 0。
ALTER TABLE `rpa_chrome_sessions`
    ADD COLUMN `execution_id` INTEGER NOT NULL DEFAULT 0;
