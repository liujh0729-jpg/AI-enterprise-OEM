-- P1-C 数字资产 AI 化：
-- 1) caption：视觉/文本模型给出的理解摘要（供找相似与内容创作复用）；
-- 2) embedding / embed_model：相似检索向量（本地袋装或远端真实向量，按模型隔离）；
-- 3) moderation / moderation_note / moderation_task_id：图/视频内容安全结论与异步任务 id。

ALTER TABLE `digital_asset_entries`
    ADD COLUMN `caption` TEXT NULL AFTER `text`,
    ADD COLUMN `embedding` JSON NULL AFTER `caption`,
    ADD COLUMN `embed_model` VARCHAR(128) NOT NULL DEFAULT '' AFTER `embedding`,
    ADD COLUMN `moderation` VARCHAR(16) NOT NULL DEFAULT '' AFTER `embed_model`,
    ADD COLUMN `moderation_note` VARCHAR(300) NOT NULL DEFAULT '' AFTER `moderation`,
    ADD COLUMN `moderation_task_id` VARCHAR(128) NOT NULL DEFAULT '' AFTER `moderation_note`;
