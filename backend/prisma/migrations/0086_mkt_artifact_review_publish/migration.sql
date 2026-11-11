-- docs §8.4 三条缺失任务触发（营销侧）：
-- 营销内容生成完成 → 内容审核任务；内容审核通过 → 渠道发布任务。
-- 审核/发布结论与回执落在内容资产上，任务中心只做派发与状态回写。
ALTER TABLE `mkt_artifacts`
    ADD COLUMN `review_status` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    ADD COLUMN `review_round` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reviewer_id` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `review_note` VARCHAR(500) NOT NULL DEFAULT '',
    ADD COLUMN `publish_status` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    ADD COLUMN `publish_channel` VARCHAR(60) NOT NULL DEFAULT '',
    ADD COLUMN `publish_note` VARCHAR(500) NOT NULL DEFAULT '',
    ADD COLUMN `published_at` DATETIME(3) NULL;

CREATE INDEX `mkt_artifacts_org_type_org_user_id_review_status_idx`
    ON `mkt_artifacts`(`org_type`, `org_user_id`, `review_status`);
