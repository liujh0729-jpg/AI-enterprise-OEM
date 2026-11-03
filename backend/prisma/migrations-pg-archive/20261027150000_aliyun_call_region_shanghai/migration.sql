-- 阿里云智能外呼只在上海（cn-shanghai）开放：outboundbot.cn-hangzhou.aliyuncs.com 等域名不存在。
-- 原默认值 cn-hangzhou 从未能连通，这里改默认值并把存量行归一到上海。

ALTER TABLE "aliyun_call_settings" ALTER COLUMN "region" SET DEFAULT 'cn-shanghai';
UPDATE "aliyun_call_settings" SET "region" = 'cn-shanghai' WHERE "region" <> 'cn-shanghai';
