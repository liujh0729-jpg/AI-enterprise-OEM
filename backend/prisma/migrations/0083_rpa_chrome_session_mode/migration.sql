-- 0083 会话能力档（docs/浏览器代理插件升级方案.md §七）：
-- 云端会话此前只有 goal，无法区分「操作 / 顺链接抓取 / 抽取结构化」；
-- 外部 MCP 客户端的 browser_agent_start / browser_extract 需要把能力档带进决策提示词。
ALTER TABLE `rpa_chrome_sessions`
    ADD COLUMN `mode` VARCHAR(16) NOT NULL DEFAULT 'act';
