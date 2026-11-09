-- 模型广场：目录增加能力分类，供平台管理端与用户侧按 文本/图片/视频/音频/向量 筛选。
ALTER TABLE `model_catalog`
  ADD COLUMN `category` VARCHAR(16) NOT NULL DEFAULT 'text';

-- 按已有端点回填分类（新库此时为空，回填不影响）。
UPDATE `model_catalog`
SET `category` = CASE
  WHEN CAST(`endpoints` AS CHAR) LIKE '%/images/%' THEN 'image'
  WHEN CAST(`endpoints` AS CHAR) LIKE '%/videos%' THEN 'video'
  WHEN CAST(`endpoints` AS CHAR) LIKE '%/audio/%' THEN 'audio'
  WHEN CAST(`endpoints` AS CHAR) LIKE '%/embeddings%' THEN 'embedding'
  ELSE 'text'
END;
