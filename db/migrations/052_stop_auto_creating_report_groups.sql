-- 原始记录项目组与报告模板项目组分别由用户管理，不再互相自动创建。

DROP TRIGGER IF EXISTS trg_create_default_report_family ON test_template_groups;
DROP FUNCTION IF EXISTS create_default_report_family();
