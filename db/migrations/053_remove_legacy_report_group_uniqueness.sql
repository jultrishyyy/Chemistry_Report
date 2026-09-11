-- 报告项目组现已独立管理，不再以原始记录项目组 + 主机厂作为唯一身份。
-- 旧索引会导致同一历史原始记录组下的报告项目组无法修改或清空主机厂。

DROP INDEX IF EXISTS uq_report_family_generic;
DROP INDEX IF EXISTS uq_report_family_manufacturer;
