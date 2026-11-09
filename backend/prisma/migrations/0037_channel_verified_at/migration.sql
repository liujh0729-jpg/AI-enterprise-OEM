-- 模型渠道校验标记：只有配置了 Key 且通过连通校验的渠道才能被选为默认模型。
-- 存量已配置 Key 的渠道按「曾经可用」回填，避免升级后全员被锁。

ALTER TABLE `content_model_channels` ADD COLUMN `verified_at` DATETIME(3) NULL;

UPDATE `content_model_channels`
SET `verified_at` = `updated_at`
WHERE `key_cipher` <> '';
