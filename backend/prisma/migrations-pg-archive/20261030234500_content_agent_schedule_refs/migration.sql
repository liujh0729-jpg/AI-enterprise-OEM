-- Agent 定时任务：随任务固定「技能 / 资料」引用，到点那一轮按这些引用组装提示词
-- （专家引用已有 expert_id 列，无需新增）

ALTER TABLE "content_agent_schedules"
    ADD COLUMN "skill_ids" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "library_ids" JSONB NOT NULL DEFAULT '[]';
