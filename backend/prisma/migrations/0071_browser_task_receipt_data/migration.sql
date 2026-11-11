-- 0071 浏览器任务回执数据（设计 §10.7 统一回执）：能力自定义的终态口径（获客 runId / 新增线索数 / 触达状态等）
-- 与逐条结果分列存放，业务侧对账不必再解析 results。
ALTER TABLE `browser_tasks` ADD COLUMN `receipt_data` JSON NOT NULL DEFAULT (JSON_OBJECT());
