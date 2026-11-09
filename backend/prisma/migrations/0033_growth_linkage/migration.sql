-- AlterTable: 订单审批通过后自动立项，回写项目 id
ALTER TABLE `crm_orders` ADD COLUMN `project_id` INTEGER NOT NULL DEFAULT 0;

-- AlterTable: SCRM 客户与 CRM 客户双向关联
ALTER TABLE `scrm_contacts` ADD COLUMN `crm_customer_id` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `scrm_contacts_org_crm_customer_idx` ON `scrm_contacts`(`org_type`, `org_user_id`, `crm_customer_id`);

-- AlterTable: 客服会话转 CRM 线索后回写
ALTER TABLE `service_desk_conversations` ADD COLUMN `crm_lead_id` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `service_desk_conversations_org_crm_lead_idx` ON `service_desk_conversations`(`org_type`, `org_user_id`, `crm_lead_id`);
