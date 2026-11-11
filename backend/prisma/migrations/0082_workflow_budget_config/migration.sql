-- 0082 工作流预算配置（docs/企业系统整体升级与工作流底座设计方案.md §7.3-9 / §11.4）：
-- 预算配置挂在流程上（{maxAiCalls,maxTokens,maxToolCalls,maxBrowserActions,maxNodes}，0＝不限），
-- 每次运行创建时快照到 workflow_runs.budgets，改预算不影响在途运行。
ALTER TABLE `workflows`
    ADD COLUMN `budgets` JSON NOT NULL DEFAULT (JSON_OBJECT());
