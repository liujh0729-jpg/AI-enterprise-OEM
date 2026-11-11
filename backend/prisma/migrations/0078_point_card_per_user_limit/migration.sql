-- 0078 时长卡的每人持有上限：防止低价日卡兑换码被同一账号多码囤积反复兑换。
-- 口径：按卡规格（template）归并，兑换码 / 积分直兑 / 现金购买三入口合计计数；
-- 默认 0＝不限，存量规格不受影响；只拦新兑换，已发出的卡照常使用到过期。
ALTER TABLE `point_card_templates`
    ADD COLUMN `per_user_limit` INTEGER NOT NULL DEFAULT 0;
