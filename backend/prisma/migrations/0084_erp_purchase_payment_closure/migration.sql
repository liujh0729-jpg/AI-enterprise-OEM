-- 0084 采购闭环补口（docs/企业系统整体升级与工作流底座设计方案.md §5.3）：
-- 1) 应付付款审批：采购入库自动生成应付款后，金额达到大额阈值（50000）的应付单
--    需财务审批通过才可登记付款，审批结论与审批人落库；小额应付直接付款。
-- 2) 来源单关联：采购单记录来源类型与来源单号（如 OA 采购申请单号），
--    使「采购申请→审批→采购→入库→应付→付款」链条可追溯。
ALTER TABLE `erp_payables`
    ADD COLUMN `approval_status` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    ADD COLUMN `approver_id` VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN `decided_at` DATETIME(3) NULL,
    ADD COLUMN `approval_note` VARCHAR(500) NOT NULL DEFAULT '';

CREATE INDEX `erp_payables_org_type_org_user_id_approval_status_idx`
    ON `erp_payables`(`org_type`, `org_user_id`, `approval_status`);

ALTER TABLE `erp_purchase_orders`
    ADD COLUMN `source_type` VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `source_no` VARCHAR(40) NOT NULL DEFAULT '';
