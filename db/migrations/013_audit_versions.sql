-- 版本快照 + 退回支持
-- 设计：审核日志即版本流水。每次 submit/update/approve/reject 都写一行，含完整 data 快照。

ALTER TABLE record_audit_log
  ADD COLUMN version_no       INTEGER,         -- 该条事件对应的版本号（从 1 起）
  ADD COLUMN data_snapshot    JSONB,           -- 事件发生时 record_data 的 raw_data + derived_data 合并快照
  ADD COLUMN status_after     TEXT,            -- 事件之后的 audit_status：pending / reviewed / rejected
  ADD COLUMN diff_summary     JSONB;           -- 与上一版本的字段级 diff（可选，前端展示用）

ALTER TABLE record_data
  ADD COLUMN current_version  INTEGER NOT NULL DEFAULT 1,  -- 当前最新版本号
  ADD COLUMN reject_note      TEXT;                         -- 最近一次退回的备注，主检看；通过审核或重新提交后清空

-- 扩展 audit_status 取值：'pending' / 'reviewed' / 'rejected'
-- （字符串列，不需要枚举类型迁移）

CREATE INDEX idx_audit_log_version ON record_audit_log(record_id, version_no);
