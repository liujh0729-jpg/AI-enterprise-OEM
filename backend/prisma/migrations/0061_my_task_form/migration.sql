-- 表单节点结构化（B4）：定义与填写结果落在任务行上，提交即关闭并由源模块唤醒流程。
ALTER TABLE `my_tasks`
    ADD COLUMN `form_schema` JSON NULL,
    ADD COLUMN `form_data` JSON NULL;
