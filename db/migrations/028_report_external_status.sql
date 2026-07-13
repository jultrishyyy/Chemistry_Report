-- 报告外部回执状态（P-Flow-2 场景3：报告发外部 → 外部反馈是否需修改 → 触发退回闭环）。
-- 状态机：generated → submitted_external（已回传，接口1.4）→ external_approved | external_revision
--   external_revision 时建 scope=report/origin=external 返工工单，文员处理（改/升级到录入/驳回）。
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS external_status      TEXT NOT NULL DEFAULT 'none',  -- none|submitted_external|external_approved|external_revision
  ADD COLUMN IF NOT EXISTS external_ref         TEXT,        -- 外部回执 id（防重/追溯）
  ADD COLUMN IF NOT EXISTS external_suggestion  TEXT,        -- 外部修改建议（needs_revision 时）
  ADD COLUMN IF NOT EXISTS external_feedback_at TIMESTAMPTZ;
