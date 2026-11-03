-- 话术改为账号级：可提前预设，并按邮箱多选绑定（空数组＝全部邮箱）
ALTER TABLE "mail_scripts" ADD COLUMN "mailbox_ids" JSONB NOT NULL DEFAULT '[]';

-- 回填：旧话术归属哪个邮箱，就绑定哪个邮箱
UPDATE "mail_scripts"
SET "mailbox_ids" = to_jsonb(ARRAY["mailbox_id"])
WHERE "mailbox_id" > 0 AND "mailbox_ids" = '[]'::jsonb;

ALTER TABLE "mail_scripts" ALTER COLUMN "mailbox_id" SET DEFAULT 0;
