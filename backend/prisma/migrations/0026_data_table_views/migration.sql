-- 多维表格视图：GRID / KANBAN / DASHBOARD，视图只影响呈现、不改数据。
CREATE TABLE `data_table_views` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `table_id` INTEGER NOT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `type` VARCHAR(16) NOT NULL DEFAULT 'GRID',
  `config` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `data_table_views_table_id_created_at_idx`(`table_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
