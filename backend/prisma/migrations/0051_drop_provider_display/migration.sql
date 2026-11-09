-- 取消后台独立「服务商展示」页：服务商展示权不再由本表承载，
-- 各业务服务的服务商列表统一直接读本系统已审核通过的服务商备案台账
-- （provider_applications.status='APPROVED'）。该表仅存展示控制项且无存量数据。
DROP TABLE IF EXISTS `provider_display`;
