-- 统一组织邀请：代理人指派范围（业务板块编码数组）
ALTER TABLE "org_applications" ADD COLUMN "scope" JSONB NOT NULL DEFAULT '[]';