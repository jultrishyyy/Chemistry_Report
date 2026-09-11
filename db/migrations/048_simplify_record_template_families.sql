-- 原始记录项目族简化为“模板归类 + 可选字段同步”。
-- 不再为新建原始记录项目族自动创建报告项目族；报告项目族由用户在报告模板侧自行建立。

DROP TRIGGER IF EXISTS trg_create_default_report_family ON test_template_groups;
DROP FUNCTION IF EXISTS create_default_report_family();

COMMENT ON COLUMN test_template_groups.base_record_template_id IS
  '历史兼容字段；简化后的项目族不再区分基础模板';
COMMENT ON COLUMN test_template_groups.inherited_group_ids IS
  '历史兼容字段；简化后的项目族不再配置固定继承分区';
