-- 可维护角色定义：内置角色是初始数据，之后管理员可调整权限；自定义角色同表存储。
CREATE TABLE IF NOT EXISTS role_definitions (
  code         TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  description  TEXT,
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  builtin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO role_definitions (code, label, description, permissions, builtin) VALUES
  ('admin', '管理员', '系统管理：用户、角色与权限配置',
    ARRAY['record.entry','record.review','record_template.edit','report.generate','report.review','report_template.edit','user.manage'], TRUE),
  ('test_engineer', '测试工程师', '录入原始记录数据',
    ARRAY['record.entry'], TRUE),
  ('test_supervisor', '测试主管', '包含测试工程师权限，并可编辑模板、审核原始记录',
    ARRAY['record.entry','record_template.edit','record.review'], TRUE),
  ('report_clerk', '报告文员', '编辑和送审报告',
    ARRAY['report.generate'], TRUE),
  ('report_reviewer', '报告审核', '包含报告文员权限，并可编辑、审核报告模板',
    ARRAY['report.generate','report_template.edit','report.review'], TRUE)
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_role_definitions_builtin ON role_definitions(builtin, created_at);
