-- 0080 抽取结果（docs/浏览器代理插件升级方案.md §七 / §八）：
-- 一次 Extract（把当前页抽成结构化数据）的产物落库，供导出 / 投递与跨设备回看；
-- 按本账号归属，agent_id 关联插件侧会话台账（0 表示不入会话的独立抽取）。
CREATE TABLE `rpa_chrome_extracts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_by` VARCHAR(64) NOT NULL,
    `agent_id` INTEGER NOT NULL DEFAULT 0,
    `url` VARCHAR(2000) NOT NULL DEFAULT '',
    `schema_note` VARCHAR(2000) NOT NULL DEFAULT '',
    `data` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `rows` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `screenshot_key` VARCHAR(200) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rpa_chrome_extracts_created_by_agent_id_created_at_idx`(`created_by`, `agent_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
