-- 回填历史退款：`refunded_points_amount` 在 0055 才引入，此前整单退款只改了订单状态，
-- 已退金额仍为 0，会导致后台/我的套餐把「已全额退款」显示成已退 0、可退全额。
UPDATE `service_package_orders`
SET `refunded_points_amount` = `points_amount`
WHERE `status` = 'REFUNDED' AND `refunded_points_amount` = 0;
