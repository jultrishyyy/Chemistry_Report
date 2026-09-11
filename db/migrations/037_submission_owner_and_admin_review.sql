-- 审核职责边界：记录每次提交的提交人，普通角色不可审核自己提交的内容；管理员例外。
-- 同时保证老库也具备可分配的管理员角色。

ALTER TABLE record_template_versions
  ADD COLUMN IF NOT EXISTS submitted_by_name TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by_job_no TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE report_template_versions
  ADD COLUMN IF NOT EXISTS submitted_by_name TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by_job_no TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE record_data
  ADD COLUMN IF NOT EXISTS submitted_by_name TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by_job_no TEXT;

-- 兼容迁移前已经处于待审核状态的数据；新提交会覆盖为实际提交人。
UPDATE record_template_versions
SET submitted_by_name = COALESCE(submitted_by_name, author_name)
WHERE status = 'pending' AND submitted_by_name IS NULL;

UPDATE report_template_versions
SET submitted_by_name = COALESCE(submitted_by_name, author_name)
WHERE status = 'pending' AND submitted_by_name IS NULL;

UPDATE record_data
SET submitted_by_name = COALESCE(submitted_by_name, tester_name)
WHERE audit_status = 'pending' AND submitted_by_name IS NULL;

INSERT INTO role_definitions (code, label, description, permissions, builtin)
VALUES (
  'admin', '管理员', '系统管理员：拥有全部业务、审核及用户角色管理权限（可审核自己提交的内容）',
  ARRAY['record.entry','record.review','record_template.edit','report.generate','report.review','report_template.edit','user.manage'],
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions,
  builtin = TRUE,
  updated_at = NOW();
