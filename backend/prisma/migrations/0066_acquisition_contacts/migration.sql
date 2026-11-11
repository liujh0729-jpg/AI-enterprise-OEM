-- 达人公开联系方式补抓（B6b / D7=B）：插件只在达人主页「已公开可见」的区域抽取
-- 邮箱/微信/电话/官网，逐条带可见性标注，落在证据行上；线索表只保存聚合条数。
--   acq_lead_evidence.contacts  证据内补抓到的联系方式 [{field,value,visibility}]；
--   acq_leads.contact_count     去重后的联系方式条数（列表页展示与「有联系方式」筛选用）。
-- 存量行按「尚未补抓」处理：contacts 默认空数组，contact_count 默认 0。

ALTER TABLE `acq_lead_evidence`
    ADD COLUMN `contacts` JSON NOT NULL DEFAULT (JSON_ARRAY()) AFTER `metrics`;

ALTER TABLE `acq_leads`
    ADD COLUMN `contact_count` INTEGER NOT NULL DEFAULT 0 AFTER `evidence_count`;
