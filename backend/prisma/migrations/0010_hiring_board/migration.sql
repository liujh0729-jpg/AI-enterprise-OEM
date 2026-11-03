-- 商务人脉·招聘专区（SNS HiringPost 移植补齐）：
--   原表只有 type/title/description，发布出去同步不了 AIworkin，也撑不起招聘广场信息流；
--   本次按 sns_listings（供求广场）同一口径补薪资、地点、报名截止、标签与上游同步状态列。
-- 新增列统一先可空、回填后再收敛 NOT NULL：MySQL 禁给 JSON 列写字面默认值（错误 1101）。

-- AlterTable: sns_hiring_posts
ALTER TABLE `sns_hiring_posts`
    ADD COLUMN `head_count` INTEGER NULL DEFAULT 1 AFTER `description`,
    ADD COLUMN `salary_mode` VARCHAR(16) NULL AFTER `head_count`,
    ADD COLUMN `salary_min` INTEGER NULL AFTER `salary_mode`,
    ADD COLUMN `salary_max` INTEGER NULL AFTER `salary_min`,
    ADD COLUMN `currency` VARCHAR(16) NULL DEFAULT 'AWCOIN' AFTER `salary_max`,
    ADD COLUMN `tags` JSON NULL AFTER `currency`,
    ADD COLUMN `province` VARCHAR(50) NULL DEFAULT '' AFTER `tags`,
    ADD COLUMN `city` VARCHAR(50) NULL DEFAULT '' AFTER `province`,
    ADD COLUMN `contact_note` VARCHAR(500) NULL DEFAULT '' AFTER `city`,
    ADD COLUMN `deadline` VARCHAR(64) NULL DEFAULT '' AFTER `contact_note`,
    ADD COLUMN `status` VARCHAR(24) NULL DEFAULT 'LOCAL_PUBLISHED' AFTER `deadline`,
    ADD COLUMN `subcategory_id` VARCHAR(64) NULL DEFAULT '' AFTER `status`,
    ADD COLUMN `aiworkin_demand_no` VARCHAR(64) NULL DEFAULT '' AFTER `subcategory_id`,
    ADD COLUMN `aiworkin_listing_no` VARCHAR(64) NULL DEFAULT '' AFTER `aiworkin_demand_no`,
    ADD COLUMN `published_upstream` BOOLEAN NULL DEFAULT false AFTER `aiworkin_listing_no`;
UPDATE `sns_hiring_posts`
SET
    `head_count` = 1,
    `currency` = 'AWCOIN',
    `tags` = '[]',
    `province` = '',
    `city` = '',
    `contact_note` = '',
    `deadline` = '',
    `status` = 'LOCAL_PUBLISHED',
    `subcategory_id` = '',
    `aiworkin_demand_no` = '',
    `aiworkin_listing_no` = '',
    `published_upstream` = false
WHERE
    `head_count` IS NULL
    OR `tags` IS NULL
    OR `province` IS NULL
    OR `city` IS NULL
    OR `contact_note` IS NULL
    OR `deadline` IS NULL
    OR `status` IS NULL
    OR `subcategory_id` IS NULL
    OR `aiworkin_demand_no` IS NULL
    OR `aiworkin_listing_no` IS NULL
    OR `published_upstream` IS NULL
    OR `currency` IS NULL;
ALTER TABLE `sns_hiring_posts`
    MODIFY COLUMN `head_count` INTEGER NOT NULL DEFAULT 1,
    MODIFY COLUMN `currency` VARCHAR(16) NOT NULL DEFAULT 'AWCOIN',
    MODIFY COLUMN `tags` JSON NOT NULL,
    MODIFY COLUMN `province` VARCHAR(50) NOT NULL DEFAULT '',
    MODIFY COLUMN `city` VARCHAR(50) NOT NULL DEFAULT '',
    MODIFY COLUMN `contact_note` VARCHAR(500) NOT NULL DEFAULT '',
    MODIFY COLUMN `deadline` VARCHAR(64) NOT NULL DEFAULT '',
    MODIFY COLUMN `status` VARCHAR(24) NOT NULL DEFAULT 'LOCAL_PUBLISHED',
    MODIFY COLUMN `subcategory_id` VARCHAR(64) NOT NULL DEFAULT '',
    MODIFY COLUMN `aiworkin_demand_no` VARCHAR(64) NOT NULL DEFAULT '',
    MODIFY COLUMN `aiworkin_listing_no` VARCHAR(64) NOT NULL DEFAULT '',
    MODIFY COLUMN `published_upstream` BOOLEAN NOT NULL DEFAULT false;
