-- CRM 导出任务补记创建人（P1-3）：下载/列表要按调用者数据范围复核，不能只看租户键。
-- 历史行 createdBy 为空串，按「仅组织级范围可见」处理；新任务写入创建人账号。
ALTER TABLE `crm_export_tasks`
    ADD COLUMN `created_by` VARCHAR(64) NOT NULL DEFAULT '' AFTER `owner_user_id`;

CREATE INDEX `crm_export_tasks_owner_user_id_created_by_idx` ON `crm_export_tasks`(`owner_user_id`, `created_by`);
