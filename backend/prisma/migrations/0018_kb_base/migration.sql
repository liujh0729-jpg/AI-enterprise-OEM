-- L1 公共知识库与知识图谱底座（§10）：空间/绑定/规范/源/页/页源/实体/关系/索引/台账/切块/消费者/摄取作业/巡检。

CREATE TABLE `kb_spaces` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `org_type` VARCHAR(16) NOT NULL DEFAULT '',
  `org_user_id` VARCHAR(64) NOT NULL DEFAULT '',
  `owner_user_id` VARCHAR(64) NOT NULL,
  `scope_type` VARCHAR(24) NOT NULL DEFAULT 'PERSONAL',
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NOT NULL DEFAULT '',
  `visibility` VARCHAR(12) NOT NULL DEFAULT 'PRIVATE',
  `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `kb_spaces_org_type_org_user_id_idx` (`org_type`, `org_user_id`),
  KEY `kb_spaces_owner_user_id_idx` (`owner_user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_space_bindings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(64) NOT NULL,
  `space_id` INT NOT NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_space_bindings_user_id_key` (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_schemas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `page_types` JSON NOT NULL,
  `workflow_prompt` TEXT NOT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_schemas_space_id_key` (`space_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_sources` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `asset_id` INT NOT NULL DEFAULT 0,
  `kind` VARCHAR(16) NOT NULL DEFAULT 'article',
  `title` VARCHAR(200) NOT NULL,
  `text` LONGTEXT NOT NULL,
  `hash` VARCHAR(64) NOT NULL DEFAULT '',
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `error` VARCHAR(500) NOT NULL DEFAULT '',
  `ingested_at` DATETIME(3) NULL,
  `created_by` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `kb_sources_space_id_status_idx` (`space_id`, `status`),
  KEY `kb_sources_space_id_hash_idx` (`space_id`, `hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_pages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `type` VARCHAR(16) NOT NULL DEFAULT 'CONCEPT',
  `title` VARCHAR(200) NOT NULL,
  `body` LONGTEXT NOT NULL,
  `frontmatter` JSON NOT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED',
  `review_note` VARCHAR(500) NOT NULL DEFAULT '',
  `updated_by` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_pages_space_id_slug_key` (`space_id`, `slug`),
  KEY `kb_pages_space_id_type_idx` (`space_id`, `type`),
  KEY `kb_pages_space_id_status_idx` (`space_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_page_sources` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `page_id` INT NOT NULL,
  `source_id` INT NOT NULL,
  `note` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_page_sources_page_id_source_id_key` (`page_id`, `source_id`),
  KEY `kb_page_sources_source_id_idx` (`source_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_entities` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `type` VARCHAR(24) NOT NULL DEFAULT 'CONCEPT',
  `summary` VARCHAR(500) NOT NULL DEFAULT '',
  `page_id` INT NOT NULL DEFAULT 0,
  `aliases` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_entities_space_id_name_key` (`space_id`, `name`),
  KEY `kb_entities_space_id_type_idx` (`space_id`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_relations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `from_id` INT NOT NULL,
  `to_id` INT NOT NULL,
  `relation` VARCHAR(64) NOT NULL,
  `weight` DOUBLE NOT NULL DEFAULT 1,
  `confidence` DOUBLE NOT NULL DEFAULT 1,
  `source_page_id` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_relations_from_id_to_id_relation_key` (`from_id`, `to_id`, `relation`),
  KEY `kb_relations_space_id_to_id_idx` (`space_id`, `to_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_indexes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `model` VARCHAR(64) NOT NULL DEFAULT '',
  `version` INT NOT NULL DEFAULT 1,
  `page_count` INT NOT NULL DEFAULT 0,
  `chunk_count` INT NOT NULL DEFAULT 0,
  `embedding_dim` INT NOT NULL DEFAULT 0,
  `stats` JSON NOT NULL,
  `stats_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_indexes_space_id_key` (`space_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `summary` VARCHAR(500) NOT NULL,
  `detail` JSON NOT NULL,
  `actor_user_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `kb_logs_space_id_created_at_idx` (`space_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_chunks` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `page_id` INT NOT NULL,
  `ordinal` INT NOT NULL DEFAULT 0,
  `text` LONGTEXT NOT NULL,
  `tokens` INT NOT NULL DEFAULT 0,
  `embedding` JSON NOT NULL,
  `model` VARCHAR(64) NOT NULL DEFAULT '',
  `version` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_chunks_page_id_ordinal_key` (`page_id`, `ordinal`),
  KEY `kb_chunks_space_id_idx` (`space_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_consumers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `consumer_type` VARCHAR(16) NOT NULL,
  `consumer_id` VARCHAR(64) NOT NULL,
  `role` VARCHAR(8) NOT NULL DEFAULT 'READ',
  `priority` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kb_consumers_space_id_consumer_type_consumer_id_key` (`space_id`, `consumer_type`, `consumer_id`),
  KEY `kb_consumers_consumer_type_consumer_id_idx` (`consumer_type`, `consumer_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_ingest_jobs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `source_id` INT NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `pages_affected` JSON NOT NULL,
  `error` VARCHAR(500) NOT NULL DEFAULT '',
  `model` VARCHAR(64) NOT NULL DEFAULT '',
  `tokens` INT NOT NULL DEFAULT 0,
  `cost_amount` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) NOT NULL DEFAULT '',
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `kb_ingest_jobs_space_id_status_idx` (`space_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `kb_lint_runs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `space_id` INT NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
  `findings` JSON NOT NULL,
  `summary` VARCHAR(500) NOT NULL DEFAULT '',
  `created_by` VARCHAR(64) NOT NULL DEFAULT '',
  `finished_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `kb_lint_runs_space_id_created_at_idx` (`space_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
