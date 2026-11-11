-- 0074 本地 Chrome 任务绑定设备（方案 §5.3）：deviceType=chrome 的任务要指向具体一台设备（clientId），
-- 其他设备类型固定空串，不影响既有行。
ALTER TABLE `rpa_tasks` ADD COLUMN `chrome_client_id` VARCHAR(64) NOT NULL DEFAULT '';
