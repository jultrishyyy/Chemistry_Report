-- 原始记录项目组删除审批。
-- 项目组采用软删除：批准后从日常列表隐藏并解除当前模板归属，历史录入及外键引用保留。

ALTER TABLE test_template_groups
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_requested_by TEXT,
  ADD COLUMN IF NOT EXISTS archive_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_request_note TEXT;

CREATE TABLE IF NOT EXISTS test_template_group_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  group_id    INTEGER NOT NULL REFERENCES test_template_groups(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('archive_request', 'archive_request_cancel', 'archive_reject', 'archive')),
  actor_name  TEXT NOT NULL,
  actor_role  TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_template_group_audit_log_group
  ON test_template_group_audit_log(group_id, created_at DESC);

