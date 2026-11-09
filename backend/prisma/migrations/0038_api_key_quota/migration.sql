-- API Key 增「积分额度」：对外调用（模型广场 /v1）累计消耗上限，NULL 表示不限额度。
-- 另：api_keys.key_cipher 由历史 sk_ 镜像列复用为「明文密文」列（AES-256-GCM），供本人在
-- 「API Key 管理」里复制自己的 Key；存量行恒为空串，回读时提示重置。

ALTER TABLE `api_keys` ADD COLUMN `points_quota` DECIMAL(18, 4) NULL;
