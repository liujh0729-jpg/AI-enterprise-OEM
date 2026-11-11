-- 0075 本地 Chrome 插件 RPA 设置（方案 §5.3 / §8 / D8）：按用户存在既有的 rpa_settings 行上，
-- 与比特浏览器设置同表不同列；JSON 存 maxSteps / 超时 / 黑名单 / 敏感确认 / 截图保留天数。
ALTER TABLE `rpa_settings` ADD COLUMN `chrome_settings` JSON NOT NULL DEFAULT (JSON_OBJECT());
