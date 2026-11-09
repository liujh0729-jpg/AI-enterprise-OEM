-- 通用协作底座（方案 §5.2）：评论/@提及/标签/标签挂载/收藏/资源链接。
-- 多态挂载口径 target_type VARCHAR(16) + target_id VARCHAR(64)；组织键沿用 (org_type, org_user_id)。
-- 对外分享不另建表，复用 mech_public_shares（Share_*）；表间引用用普通 INT 列，级联在服务层做。

-- CreateTable
CREATE TABLE `collab_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `parent_id` INTEGER NOT NULL DEFAULT 0,
    `content` TEXT NOT NULL,
    `content_html` TEXT NOT NULL,
    `author_id` VARCHAR(64) NOT NULL,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `deleted_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `collab_comments_org_target_created_idx`(`org_type`, `org_user_id`, `target_type`, `target_id`, `created_at`),
    INDEX `collab_comments_parent_id_idx`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collab_mentions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `comment_id` INTEGER NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `mentioned_user_id` VARCHAR(64) NOT NULL,
    `author_id` VARCHAR(64) NOT NULL,
    `read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collab_mentions_comment_id_mentioned_user_id_key`(`comment_id`, `mentioned_user_id`),
    INDEX `collab_mentions_org_mentioned_read_idx`(`org_type`, `org_user_id`, `mentioned_user_id`, `read`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collab_tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `color` VARCHAR(16) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `collab_tags_org_type_org_user_id_name_key`(`org_type`, `org_user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collab_taggables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `tag_id` INTEGER NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collab_taggables_tag_id_target_type_target_id_key`(`tag_id`, `target_type`, `target_id`),
    INDEX `collab_taggables_org_target_idx`(`org_type`, `org_user_id`, `target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collab_favorites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collab_favorites_org_user_target_key`(`org_type`, `org_user_id`, `user_id`, `target_type`, `target_id`),
    INDEX `collab_favorites_org_user_created_idx`(`org_type`, `org_user_id`, `user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collab_resource_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_type` VARCHAR(16) NOT NULL DEFAULT 'ENTERPRISE',
    `org_user_id` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT '',
    `kind` VARCHAR(16) NOT NULL DEFAULT 'LINK',
    `created_by` VARCHAR(64) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `collab_links_org_target_created_idx`(`org_type`, `org_user_id`, `target_type`, `target_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
