-- 邮箱服务：IMAP 发件箱（发出的回复在服务器留一份副本）
ALTER TABLE "mail_accounts"
    ADD COLUMN "sent_folder" VARCHAR(80) NOT NULL DEFAULT 'Sent';