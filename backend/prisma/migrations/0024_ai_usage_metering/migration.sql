-- 统一 AI 用量事实（AI 底座方案 §4.4）：usage_events 从「只记次数」升级为「板块 + 动作 + 模型 + token + 积分」
ALTER TABLE `usage_events`
    ADD COLUMN `module` VARCHAR(32) NOT NULL DEFAULT '' AFTER `remark`,
    ADD COLUMN `operation` VARCHAR(64) NOT NULL DEFAULT '' AFTER `module`,
    ADD COLUMN `model` VARCHAR(128) NOT NULL DEFAULT '' AFTER `operation`,
    ADD COLUMN `token_in_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0 AFTER `model`,
    ADD COLUMN `token_out_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0 AFTER `token_in_amount`,
    ADD COLUMN `points_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0 AFTER `token_out_amount`;

CREATE INDEX `usage_events_module_occurred_at_idx` ON `usage_events`(`module`, `occurred_at`);
