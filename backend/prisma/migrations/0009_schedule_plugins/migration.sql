-- Agent 定时任务固定引用插件：与 skill_ids 同一口径（空数组＝全部启用中的插件）
ALTER TABLE `content_agent_schedules` ADD COLUMN `plugin_ids` JSON NOT NULL;
