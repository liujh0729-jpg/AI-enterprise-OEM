-- 「服务商展示」数据源从上游（不存在的 /providers/marketplace）改为本系统已审核通过的
-- 服务商备案台账（provider_applications.status='APPROVED'）。自然键由「上游服务商 id」
-- 改为「本系统服务商账号 id（user_id）」，并去掉只服务上游同步的 snapshot / synced_at 两列。
-- 该表历史上从未同步成功过（上游无此接口、多数时段未绑定 Key），无存量数据。

ALTER TABLE `provider_display` CHANGE COLUMN `aiworkin_provider_id` `provider_user_id` VARCHAR(64) NOT NULL;
ALTER TABLE `provider_display` DROP COLUMN `snapshot`;
ALTER TABLE `provider_display` DROP COLUMN `synced_at`;
ALTER TABLE `provider_display` RENAME INDEX `provider_display_aiworkin_provider_id_key` TO `provider_display_provider_user_id_key`;
