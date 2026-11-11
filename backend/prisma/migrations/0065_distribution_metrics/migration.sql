-- 分发效果回流（B6b / D8=A）：给 distribution_publish_logs 加效果数据列。
-- 插件从平台创作中心读「阅读/播放量、点赞、评论」后回写，落在这张逐平台结果表上；
-- 内容资产统计由这些列按内容聚合得到。
--   published_item_id   平台侧作品标识（微博 mid / B站 bvid 等），效果回流时对齐「哪一条内容」；
--   views/likes/comments  计数（INT，插件 countOf 已把「1.2万/亿」折成整数）；
--   metrics_source      效果数据来源：EXTENSION（插件） | MANUAL（人工补录） | ''（尚未回写）；
--   metrics_captured_at 效果数据抓取时间；
--   updated_at          row 级更新时间，reportLogs/reportMetrics 覆盖写时刷新。
-- 存量行按「尚未回写效果」处理：计数默认 0，source 默认空串，captured_at 为 NULL。

ALTER TABLE `distribution_publish_logs`
    ADD COLUMN `published_item_id` VARCHAR(120) NOT NULL DEFAULT '' AFTER `published_url`,
    ADD COLUMN `views` INTEGER NOT NULL DEFAULT 0 AFTER `source`,
    ADD COLUMN `likes` INTEGER NOT NULL DEFAULT 0 AFTER `views`,
    ADD COLUMN `comments` INTEGER NOT NULL DEFAULT 0 AFTER `likes`,
    ADD COLUMN `metrics_source` VARCHAR(16) NOT NULL DEFAULT '' AFTER `comments`,
    ADD COLUMN `metrics_captured_at` DATETIME(3) NULL AFTER `metrics_source`,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER `created_at`;
