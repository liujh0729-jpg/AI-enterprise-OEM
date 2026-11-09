-- 短视频模版社区（内容创作板块）：
--   1) video_templates——发布者提供样片、参考图、提示词与所用模型；view_cost>0 时首位非发布者查看扣分给作者。
--   2) video_template_favorites——[user_id, template_id] 唯一，重复收藏幂等。
--   3) video_template_ratings——1–5 分，一人一票可改分；聚合值冗余在 video_templates.rating_sum/rating_count。
--   4) video_template_views——付费查看记录，唯一键保证同一账号同一模版只扣一次积分。
-- JSON 列不写字面默认值（MySQL 错误 1101），默认值由 Prisma 层 @default 兜住。

-- CreateTable: video_templates
CREATE TABLE `video_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `video_type` VARCHAR(24) NOT NULL DEFAULT 'all-reference',
    `sample_url` TEXT NOT NULL,
    `cover_url` TEXT NOT NULL,
    `reference_images` JSON NOT NULL,
    `prompt` TEXT NOT NULL,
    `model_channel_name` VARCHAR(120) NOT NULL DEFAULT '',
    `model_name` VARCHAR(200) NOT NULL,
    `view_cost` INTEGER NOT NULL DEFAULT 0,
    `view_count` INTEGER NOT NULL DEFAULT 0,
    `use_count` INTEGER NOT NULL DEFAULT 0,
    `favorite_count` INTEGER NOT NULL DEFAULT 0,
    `rating_sum` INTEGER NOT NULL DEFAULT 0,
    `rating_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `video_templates_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `video_templates_video_type_created_at_idx`(`video_type`, `created_at`),
    INDEX `video_templates_use_count_idx`(`use_count`),
    INDEX `video_templates_favorite_count_idx`(`favorite_count`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: video_template_favorites
CREATE TABLE `video_template_favorites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `template_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `video_template_favorites_user_id_template_id_key`(`user_id`, `template_id`),
    INDEX `video_template_favorites_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: video_template_ratings
CREATE TABLE `video_template_ratings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `template_id` INTEGER NOT NULL,
    `score` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `video_template_ratings_user_id_template_id_key`(`user_id`, `template_id`),
    INDEX `video_template_ratings_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: video_template_views
CREATE TABLE `video_template_views` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NOT NULL,
    `template_id` INTEGER NOT NULL,
    `points` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `video_template_views_user_id_template_id_key`(`user_id`, `template_id`),
    INDEX `video_template_views_template_id_idx`(`template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
