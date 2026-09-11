-- 报告项目组改为独立的项目模板归类容器，并加入删除审批。
-- 不再强制依赖原始记录项目组；内部编码由系统生成，不对用户展示。

ALTER TABLE report_project_template_families
  ALTER COLUMN record_template_group_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_requested_by TEXT,
  ADD COLUMN IF NOT EXISTS archive_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_request_note TEXT;

CREATE TABLE IF NOT EXISTS report_project_group_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  group_id    INTEGER NOT NULL REFERENCES report_project_template_families(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('archive_request', 'archive_request_cancel', 'archive_reject', 'archive')),
  actor_name  TEXT NOT NULL,
  actor_role  TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_project_group_audit_log_group
  ON report_project_group_audit_log(group_id, created_at DESC);

