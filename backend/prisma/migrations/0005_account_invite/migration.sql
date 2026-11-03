-- AlterTable: 用户邀请体系（每人一把邀请码 + 记录邀请人）
ALTER TABLE `users` ADD COLUMN `invite_code` VARCHAR(16) NULL,
    ADD COLUMN `invited_by` INT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_invite_code_key` ON `users`(`invite_code`);
