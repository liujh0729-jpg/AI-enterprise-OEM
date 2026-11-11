-- 工作流「真触发」地基（决策 D1=A / D2=C）：
--   1) workflows.business_key——稳定别名，业务代码按它 invoke，不依赖自增 id；可空且唯一。
--   2) workflow_runs.source_type / source_id——业务单据关联，供单据页反查「由工作流 #N 驱动」。
--   3) workflow_runs.dedupe_key——触发幂等锚（定时时间点 / 事件日志 id / 任务+事件类型），唯一。
-- 外部 Webhook 触发不开放，故不建任何 hook token 表。

-- AlterTable: workflows
ALTER TABLE `workflows` ADD COLUMN `business_key` VARCHAR(80) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `workflows_business_key_key` ON `workflows`(`business_key`);

-- AlterTable: workflow_runs
ALTER TABLE `workflow_runs`
    ADD COLUMN `source_type` VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN `source_id` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `dedupe_key` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `workflow_runs_dedupe_key_key` ON `workflow_runs`(`dedupe_key`);
CREATE INDEX `workflow_runs_source_type_source_id_idx` ON `workflow_runs`(`source_type`, `source_id`);