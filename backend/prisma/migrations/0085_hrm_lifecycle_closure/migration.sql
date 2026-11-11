-- 0085 人员闭环补口（docs/企业系统整体升级与工作流底座设计方案.md §5.3「招聘→录用→入职→岗位权限→目标→离职」）：
-- 1) 入职流程记录应开通的岗位（Offer 岗位标题快照或手工指定），全部事项完成后按职能目录授权；
-- 2) 入职模板支持 OFFBOARD（离职交接清单），左侧 kind 字段无需改表结构，仅扩展取值。
ALTER TABLE `onboarding_runs`
    ADD COLUMN `position_name` VARCHAR(64) NOT NULL DEFAULT '';
