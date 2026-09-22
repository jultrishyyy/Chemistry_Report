-- 测试项目可见范围：副主任可查看全部项目。
INSERT INTO role_definitions (code, label, description, permissions, builtin) VALUES
  ('deputy_director', '副主任', '查看全部测试项目和委托单项目',
   ARRAY['record.entry','test_project.view_all'], TRUE)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions,
  builtin = TRUE,
  updated_at = NOW();
