-- 019: 报告编辑留痕 + 偏离原始数据对比
--
-- 文员对报告的结构化编辑（改值/增删字段/结果表行）"可改值但全程留痕 + 告警"：
--   * report_audit_log：每次生成/编辑写一条，含字段级 diff（谁/何时/把什么从 X 改成 Y）
--   * reports.content_doc_original：生成时的原始实例快照（不可变），用于在编辑器里
--     对比"当前值 vs 原始值"，对偏离原始记录的字段告警。
--
-- record_data 永不回写——报告侧改动只落在 content_doc，偏离由这里留痕/告警。

CREATE TABLE IF NOT EXISTS report_audit_log (
  id SERIAL PRIMARY KEY,
  report_id INTEGER REFERENCES reports(id),
  action TEXT NOT NULL,        -- 'generate' | 'edit'
  actor_name TEXT,
  diff JSONB,                  -- [{ path, label, kind:'added'|'removed'|'changed', from, to }]
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_audit_report ON report_audit_log(report_id, created_at DESC);

-- 生成时的原始实例快照（不可变基线，用于偏离对比）
ALTER TABLE reports ADD COLUMN IF NOT EXISTS content_doc_original JSONB;
