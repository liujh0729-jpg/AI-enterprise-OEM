-- 商务社交·小组对标豆瓣补齐（M5）：
--   小组加头像/组规/分类；主题帖加发帖分类/置顶/加精/推荐数；回复加推荐数；
--   新增主题与回复的「推荐」去重表（一人一贴/一楼只算一次，取消即删行）。
-- 数值列（like_count）按项目规范先可空再回填，最后收敛 NOT NULL。

-- AlterTable: sns_groups
ALTER TABLE `sns_groups`
    ADD COLUMN `avatar` VARCHAR(500) NULL DEFAULT '' AFTER `name`,
    ADD COLUMN `rules` TEXT NULL AFTER `description`,
    ADD COLUMN `category` VARCHAR(30) NULL DEFAULT '' AFTER `rules`;
UPDATE `sns_groups` SET `avatar` = '', `rules` = '', `category` = '';
ALTER TABLE `sns_groups`
    MODIFY COLUMN `avatar` VARCHAR(500) NOT NULL DEFAULT '',
    MODIFY COLUMN `rules` TEXT NOT NULL,
    MODIFY COLUMN `category` VARCHAR(30) NOT NULL DEFAULT '';
CREATE INDEX `sns_groups_category_created_at_idx` ON `sns_groups`(`category`, `created_at`);

-- AlterTable: sns_group_topics
ALTER TABLE `sns_group_topics`
    ADD COLUMN `tag` VARCHAR(30) NULL DEFAULT '' AFTER `body`,
    ADD COLUMN `pinned` BOOLEAN NULL DEFAULT false AFTER `anonymous`,
    ADD COLUMN `featured` BOOLEAN NULL DEFAULT false AFTER `pinned`,
    ADD COLUMN `like_count` INTEGER NULL AFTER `featured`;
UPDATE `sns_group_topics` SET `tag` = '', `pinned` = false, `featured` = false, `like_count` = 0;
ALTER TABLE `sns_group_topics`
    MODIFY COLUMN `tag` VARCHAR(30) NOT NULL DEFAULT '',
    MODIFY COLUMN `pinned` BOOLEAN NOT NULL DEFAULT false,
    MODIFY COLUMN `featured` BOOLEAN NOT NULL DEFAULT false,
    MODIFY COLUMN `like_count` INTEGER NOT NULL DEFAULT 0;
CREATE INDEX `sns_group_topics_group_id_pinned_featured_idx` ON `sns_group_topics`(`group_id`, `pinned`, `featured`);

-- AlterTable: sns_group_replies
ALTER TABLE `sns_group_replies`
    ADD COLUMN `like_count` INTEGER NULL AFTER `anonymous`;
UPDATE `sns_group_replies` SET `like_count` = 0;
ALTER TABLE `sns_group_replies`
    MODIFY COLUMN `like_count` INTEGER NOT NULL DEFAULT 0;

-- CreateTable: sns_topic_likes（主题推荐去重）
CREATE TABLE `sns_topic_likes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_topic_likes_user_id_idx`(`user_id`),
    UNIQUE INDEX `sns_topic_likes_topic_id_user_id_key`(`topic_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: sns_reply_likes（回复推荐去重）
CREATE TABLE `sns_reply_likes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reply_id` INTEGER NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sns_reply_likes_user_id_idx`(`user_id`),
    UNIQUE INDEX `sns_reply_likes_reply_id_user_id_key`(`reply_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
