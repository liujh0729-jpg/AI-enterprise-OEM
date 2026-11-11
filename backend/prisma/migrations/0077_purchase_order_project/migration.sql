-- 0077 采购单归属项目（设计 §5.3 第二/四个闭环）：采购按项目归集成本，入库即产生项目成本与应付对账口径。
-- 默认 0＝不归集到项目，存量采购单不受影响；索引支撑「按项目查采购」与对账列表。
ALTER TABLE `erp_purchase_orders`
    ADD COLUMN `project_id` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `erp_purchase_orders_org_project_idx` ON `erp_purchase_orders`(`org_type`, `org_user_id`, `project_id`);
