-- 模型广场计费口径与上游完全对齐：
-- token（含缓存读写）/ image（按张，分档）/ second（按秒，分档）/ call（按次）；
-- 并引入平台折扣：官方价 × discount_rate = 实际收费，积分一律按系统汇率换算。

ALTER TABLE `model_catalog`
    ADD COLUMN `billing_unit` VARCHAR(16) NOT NULL DEFAULT 'token' AFTER `quota_type`,
    ADD COLUMN `cache_read_rmb_price` DECIMAL(18, 6) NOT NULL DEFAULT 0 AFTER `call_rmb_price`,
    ADD COLUMN `cache_write_rmb_price` DECIMAL(18, 6) NOT NULL DEFAULT 0 AFTER `cache_read_rmb_price`,
    ADD COLUMN `minimum_rmb` DECIMAL(18, 6) NOT NULL DEFAULT 0 AFTER `cache_write_rmb_price`,
    ADD COLUMN `tiers` JSON NULL AFTER `minimum_rmb`,
    ADD COLUMN `components` JSON NULL AFTER `tiers`,
    ADD COLUMN `discount_rate` DECIMAL(6, 4) NOT NULL DEFAULT 1.0000 AFTER `components`;

ALTER TABLE `model_usage_logs`
    ADD COLUMN `cache_read_tokens` INTEGER NOT NULL DEFAULT 0 AFTER `completion_tokens`,
    ADD COLUMN `cache_write_tokens` INTEGER NOT NULL DEFAULT 0 AFTER `cache_read_tokens`,
    ADD COLUMN `billing_quantity` DECIMAL(18, 6) NOT NULL DEFAULT 0 AFTER `total_tokens`,
    ADD COLUMN `billing_unit` VARCHAR(16) NOT NULL DEFAULT '' AFTER `billing_quantity`;

-- 历史 CALL 类目录按端点回填到上游真实单位（图像=image、视频/识别=second、合成=call）
UPDATE `model_catalog`
SET `billing_unit` = 'image'
WHERE `billing_unit` = 'token'
  AND (`quota_type` = 'CALL' OR JSON_CONTAINS(`endpoints`, JSON_QUOTE('/images/generations')) OR JSON_CONTAINS(`endpoints`, JSON_QUOTE('/images/edits')))
  AND (JSON_CONTAINS(`endpoints`, JSON_QUOTE('/images/generations')) OR JSON_CONTAINS(`endpoints`, JSON_QUOTE('/images/edits')));

UPDATE `model_catalog`
SET `billing_unit` = 'second'
WHERE `quota_type` = 'CALL'
  AND (JSON_CONTAINS(`endpoints`, JSON_QUOTE('/videos')) OR JSON_CONTAINS(`endpoints`, JSON_QUOTE('/audio/transcriptions')));

UPDATE `model_catalog`
SET `billing_unit` = 'call'
WHERE `quota_type` = 'CALL'
  AND `billing_unit` = 'token';

-- AIPDD 内置模型的官方缓存价（元 / 百万 tokens），与上游 aipdd.pricing 一致
UPDATE `model_catalog` SET `cache_read_rmb_price` = 0.1, `cache_write_rmb_price` = 3
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-deepseek-v4-flash';
UPDATE `model_catalog` SET `cache_read_rmb_price` = 0.3, `cache_write_rmb_price` = 9
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-deepseek-v4-pro';
UPDATE `model_catalog` SET `cache_read_rmb_price` = 2, `cache_write_rmb_price` = 8
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-glm-5.3';
UPDATE `model_catalog` SET `cache_read_rmb_price` = 0.115, `cache_write_rmb_price` = 0.4
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-glm-5.3-flash';
UPDATE `model_catalog` SET `cache_read_rmb_price` = 12, `cache_write_rmb_price` = 15
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-qwen3.8-max';

-- 图像分档价（quality / size）
UPDATE `model_catalog` SET `tiers` = '[{"match":{"quality":"4K"},"unitRmb":0.6},{"match":{"size":"4096x4096"},"unitRmb":0.6},{"match":{"quality":"2K"},"unitRmb":0.4},{"match":{"size":"2048x2048"},"unitRmb":0.4},{"match":{"quality":"1K"},"unitRmb":0.3},{"match":{"quality":"auto"},"unitRmb":0.2},{"match":{"size":"1024x1024"},"unitRmb":0.3},{"match":{"size":"1024x1536"},"unitRmb":0.3},{"match":{"size":"1536x1024"},"unitRmb":0.3},{"match":{"size":"auto"},"unitRmb":0.2}]'
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-image-2.0';

UPDATE `model_catalog` SET `tiers` = '[{"match":{"quality":"4K"},"unitRmb":0.6},{"match":{"quality":"2K"},"unitRmb":0.4},{"match":{"quality":"1K"},"unitRmb":0.3},{"match":{"quality":"auto"},"unitRmb":0.2}]'
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-image-flare-2.5';

UPDATE `model_catalog` SET `tiers` = '[{"match":{"quality":"4K"},"unitRmb":0.7},{"match":{"quality":"2K"},"unitRmb":0.5},{"match":{"quality":"1K"},"unitRmb":0.4},{"match":{"quality":"auto"},"unitRmb":0.3}]'
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-image-sunburst-2.5';

UPDATE `model_catalog` SET `tiers` = '[{"match":{"size":"1K"},"unitRmb":0.4},{"match":{"size":"2K"},"unitRmb":0.5},{"match":{"size":"4K"},"unitRmb":0.6},{"match":{"size":"1024x1024"},"unitRmb":0.4},{"match":{"size":"2048x2048"},"unitRmb":0.5},{"match":{"size":"4096x4096"},"unitRmb":0.6}]'
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-nano-2.1';

UPDATE `model_catalog`
SET `tiers` = '[{"match":{"quality":"1K"},"unitRmb":0.1},{"match":{"quality":"2K"},"unitRmb":0.36}]',
    `components` = '[{"code":"reference_image_excess","freeUnits":0,"unit":"image","unitRmb":0.05,"tiers":[{"match":{"quality":"1K"},"unitRmb":0.05},{"match":{"quality":"2K"},"unitRmb":0.1}]}]'
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-qwen-image-2.1';

-- 视频按秒，分档按分辨率
UPDATE `model_catalog`
SET `billing_unit` = 'second',
    `tiers` = '[{"match":{"video_resolution":"480p"},"unitRmb":0.09},{"match":{"video_resolution":"768p"},"unitRmb":0.12},{"match":{"video_resolution":"1080p"},"unitRmb":0.15},{"match":{"video_resolution":"2k"},"unitRmb":0.24},{"match":{"video_resolution":"4k"},"unitRmb":0.3}]'
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-minimax-h3';

-- 语音识别按秒，最低 0.01 元
UPDATE `model_catalog`
SET `billing_unit` = 'second', `minimum_rmb` = 0.01
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-funasr';

-- 语音合成按次
UPDATE `model_catalog`
SET `billing_unit` = 'call'
WHERE `provider` = 'AIPDD' AND `model_key` = 'ap-indextts-2';
