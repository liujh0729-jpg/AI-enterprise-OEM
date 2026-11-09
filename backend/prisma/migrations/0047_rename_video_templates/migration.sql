-- 「短视频模版」更名为「视频模版」：ensureSeed 只补缺失项、不覆盖存量标题，已有库需显式回填。
UPDATE feature_catalog SET title = '视频模版' WHERE code = 'video-templates' AND title = '短视频模版';
