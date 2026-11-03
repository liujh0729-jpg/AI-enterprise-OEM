-- OA AI 预审与发起附件
-- oa_tasks.pre_review：节点启用 AI 预审后，审批人本人模型生成的建议，按任务缓存。
-- oa_applications.attachments：发起时上传的附件快照，文件本体存 AIPDD 数字资产。
ALTER TABLE "oa_tasks" ADD COLUMN "pre_review" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "oa_applications" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';