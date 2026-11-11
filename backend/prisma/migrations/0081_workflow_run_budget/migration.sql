-- 0081 工作流执行预算（docs/企业系统整体升级与工作流底座设计方案.md §7.3-9 / §11.4）：
-- 每次运行快照一份预算（AI 费用按 token、工具调用、浏览器动作、循环次数上限），
-- 运行过程中累加耗用量；触顶项记在 budget_stop，运行详情据此说明「为什么停在这里」。
ALTER TABLE `workflow_runs`
    ADD COLUMN `budgets` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    ADD COLUMN `usage` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    ADD COLUMN `budget_stop` VARCHAR(16) NOT NULL DEFAULT 'NONE';
