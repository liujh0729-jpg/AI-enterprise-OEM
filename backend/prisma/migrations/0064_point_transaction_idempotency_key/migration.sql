-- 资金结算幂等锚：给 point_transactions 加可空唯一幂等键（§12.6 充值可恢复结算）。
-- 充值本金/赠送入账各带一枚稳定键（recharge:<orderId>:principal / :bonus）：
--   1) 回调中断后重入时，已入账的那步被数据库唯一约束拒绝，只补齐缺失的步骤，不重复入账；
--   2) 键本身可作为对账锚：按订单核对「支付确认 / 本金 / 赠送」是否都已落账。
-- 可空 + MySQL 唯一索引允许多个 NULL：存量流水与所有无键入账不受影响。

-- AlterTable
ALTER TABLE `point_transactions` ADD COLUMN `idempotency_key` VARCHAR(96) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `point_transactions_idempotency_key_key` ON `point_transactions`(`idempotency_key`);
