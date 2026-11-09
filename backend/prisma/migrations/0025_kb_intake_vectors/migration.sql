-- AI 底座 P1-A 知识库升级：
-- 1) kb_sources 增加摄取入口类型/原始地址/OSS 对象键（上传/URL/飞书/OCR 留痕）；
-- 2) digital_asset_entries 增加抽取正文，修 assetId 投料断链（资产存正文后 kb_sources 可直接编译）；
-- 3) kb_chunks 增加块元数据（权限/溯源标签），检索侧可据标签过滤。

ALTER TABLE `kb_sources`
    ADD COLUMN `type` VARCHAR(16) NOT NULL DEFAULT 'TEXT' AFTER `kind`,
    ADD COLUMN `origin_url` VARCHAR(2000) NOT NULL DEFAULT '' AFTER `type`,
    ADD COLUMN `oss_key` VARCHAR(512) NOT NULL DEFAULT '' AFTER `origin_url`;

ALTER TABLE `digital_asset_entries`
    ADD COLUMN `text` LONGTEXT NULL AFTER `labels`;

ALTER TABLE `kb_chunks`
    ADD COLUMN `meta` JSON NULL AFTER `model`;
