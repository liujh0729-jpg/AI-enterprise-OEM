-- 平台管理员「生成 Skill」的产物持久化：开放集成 → API-MCP-Skill → Skill 页签列表与下载。
-- 按技能名（slug）唯一，重新生成同名技能时覆盖 zip 与元数据；zip 存 LONGBLOB。

CREATE TABLE `generated_skills` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `display_name` VARCHAR(60) NOT NULL,
    `description` TEXT NOT NULL,
    `domain` VARCHAR(64) NOT NULL,
    `domain_label` VARCHAR(120) NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `operation_count` INTEGER NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `filename` VARCHAR(120) NOT NULL,
    `zip` LONGBLOB NOT NULL,
    `created_by` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `generated_skills_name_key`(`name`),
    INDEX `generated_skills_updated_at_idx`(`updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 菜单合并：「API 文档」「MCP Server」收敛为「API-MCP-Skill」。
-- ensureSeed 只补缺失项、不覆盖存量；已有库需显式改名并清掉旧入口，开关状态跟随后端 MCP 的那条记录。
UPDATE `feature_catalog`
SET `code` = 'api-mcp-skill',
    `title` = 'API-MCP-Skill',
    `path` = '/developer/api-mcp-skill',
    `sort_order` = 30
WHERE `code` = 'developer-mcp';

UPDATE `feature_toggles` SET `code` = 'api-mcp-skill' WHERE `code` = 'developer-mcp';

DELETE FROM `feature_toggles` WHERE `code` = 'developer-docs';
DELETE FROM `feature_catalog` WHERE `code` = 'developer-docs';
