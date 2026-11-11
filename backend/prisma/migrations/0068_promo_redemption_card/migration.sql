-- 0068 兑换码发卡：核销记录快照「兑的是哪张卡」，并留下与卡实例的直接关联。
-- 老行（积分码核销）天然 card_code='' / user_card_id=0，无需回填。

ALTER TABLE `point_promo_redemptions`
    ADD COLUMN `card_code` VARCHAR(32) NOT NULL DEFAULT '' AFTER `ref_amount`,
    ADD COLUMN `user_card_id` INTEGER NOT NULL DEFAULT 0 AFTER `card_code`;
