-- 020: 退回 / 返工工单 + 报告失效标记（P-Flow-1）
--
-- 把"在某阶段发现问题 → 退回某阶段 → 带原因 → 被处理 → 留痕"统一成一张工单表，
-- 而不是给每类退回各做一套机制。本期落地场景 1（报告生成时文员发现原始记录有错 →
-- 退回录入主检）；场景 2（数据审核退回，已实现）与场景 3（外部反馈）后续并入（P-Flow-2/3）。
--
-- 工单只表达"退到哪、为什么"；"具体改了什么"复用 record_audit_log / report_audit_log
-- （字段级 diff + actor），两者按 order_no 关联，拼成完整溯源时间线。

CREATE TABLE IF NOT EXISTS rework_tickets (
  id SERIAL PRIMARY KEY,
  order_no         TEXT NOT NULL,
  scope            TEXT NOT NULL,        -- 'record' | 'report'
  record_data_id   INTEGER REFERENCES record_data(id),   -- scope=record 时
  report_id        INTEGER REFERENCES reports(id),        -- scope=report 时
  origin_stage     TEXT NOT NULL,        -- 'report_gen' | 'data_review' | 'external'
  target_stage     TEXT NOT NULL,        -- 'data_entry' | 'report_gen'
  raised_by_name   TEXT,
  raised_by_role   TEXT,
  reason           TEXT,                 -- 退回原因
  suggestion       TEXT,                 -- 修改建议（外部回执也放这）
  external_ref     TEXT,                 -- 场景 3：外部系统回执 id
  parent_ticket_id INTEGER REFERENCES rework_tickets(id),  -- 链式升级：外部→文员，文员→录入(挂父)
  status           TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'in_progress' | 'resolved'
  resolved_by_name TEXT,
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rework_order  ON rework_tickets(order_no);
CREATE INDEX IF NOT EXISTS idx_rework_target ON rework_tickets(target_stage, status);
CREATE INDEX IF NOT EXISTS idx_rework_record ON rework_tickets(record_data_id);

-- 报告失效标记：退回修数据、数据重审通过(新版本)后，引用旧锁定版本的报告过期，
-- 报告列表提示"源数据已更新，建议重新生成"，保证退回闭环一致。
ALTER TABLE reports ADD COLUMN IF NOT EXISTS stale BOOLEAN DEFAULT false;
