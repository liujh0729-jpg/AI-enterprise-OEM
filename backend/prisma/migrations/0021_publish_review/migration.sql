-- 发布审核台账：只记拦截 / 待复核 / 调用失败，配置存 system_settings。
CREATE TABLE `publish_review_logs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `scene` VARCHAR(32) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `decision` VARCHAR(16) NOT NULL,
  `suggestion` VARCHAR(16) NOT NULL DEFAULT 'pass',
  `labels` VARCHAR(200) NOT NULL DEFAULT '',
  `snippet` VARCHAR(200) NOT NULL DEFAULT '',
  `reason` VARCHAR(500) NOT NULL DEFAULT '',
  `request_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `publish_review_logs_created_at_idx`(`created_at`),
  INDEX `publish_review_logs_scene_created_at_idx`(`scene`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
