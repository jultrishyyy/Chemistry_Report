-- 项目族基础模板与受控分区继承。
-- 每个项目族至多一份基础原始记录模板；派生模板仍使用 record_templates 既有
-- parent_template_id / parent_version_id / field_mapping 完成版本化同步。

ALTER TABLE test_template_groups
  ADD COLUMN base_record_template_id INTEGER REFERENCES record_templates(id) ON DELETE SET NULL,
  ADD COLUMN inherited_group_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX idx_test_template_groups_base_template
  ON test_template_groups(base_record_template_id)
  WHERE base_record_template_id IS NOT NULL;

-- 旧的多公共组件数据保留作历史兼容，但不再作为新项目族配置入口。
COMMENT ON COLUMN test_template_groups.base_record_template_id IS
  '项目族唯一基础原始记录模板；其他方法模板应从它派生';
COMMENT ON COLUMN test_template_groups.inherited_group_ids IS
  '基础模板中由项目族统一维护并同步到派生模板的分区 id 列表';
