-- 短视频模版补 AIworkin 来源：
--   source＝LOCAL（本站用户发布）/ AIWORKIN（平台管理员开启后从上游补充）；
--   upstream_id 作上游唯一键，定时同步按它 upsert，不重复插入。
-- 本地发布行 upstream_id 为 NULL；MySQL/PG 的唯一索引都允许多个 NULL。

ALTER TABLE `video_templates`
    ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'LOCAL',
    ADD COLUMN `upstream_id` VARCHAR(128) NULL;

CREATE UNIQUE INDEX `video_templates_upstream_id_key` ON `video_templates`(`upstream_id`);
