-- 审核字段 + 审核日志表
-- 设计目标：
--   1. record_data 直接持有最新主检/审核状态，方便报告字段绑定
--   2. record_audit_log 记录全部事件（提交 / 更新 / 审核），可溯源

ALTER TABLE record_data
  ADD COLUMN tester_name    TEXT,
  ADD COLUMN tested_at      TIMESTAMPTZ,
  ADD COLUMN reviewer_name  TEXT,
  ADD COLUMN reviewed_at    TIMESTAMPTZ,
  ADD COLUMN audit_status   TEXT NOT NULL DEFAULT 'pending';
  -- audit_status 取值：'pending'（已录入待审核） / 'reviewed'（已审核）

CREATE TABLE record_audit_log (
  id           SERIAL PRIMARY KEY,
  record_id    INTEGER NOT NULL REFERENCES record_data(id) ON DELETE CASCADE,
  order_no     TEXT,
  action       TEXT NOT NULL,        -- submit / update / review
  actor_name   TEXT NOT NULL,
  actor_role   TEXT,                  -- tester / reviewer
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_record  ON record_audit_log(record_id);
CREATE INDEX idx_audit_log_order   ON record_audit_log(order_no);
