-- 0090 任务上游受理留痕（docs/AI画布代码评审待决策问题.md 第 1 项，已确认口径：只记录不退款）：
-- 取消 = 停止本站等待，上游已产生的算力费用不退回。为了让客服能回答「我取消了为什么还被扣」，
-- 任务行补「上游受理时间 / 子任务号」两列，入队跑起来后由 media 层回填。
ALTER TABLE `content_generation_jobs`
    ADD COLUMN `upstream_task_id` VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN `upstream_accepted_at` DATETIME(3) NULL;
