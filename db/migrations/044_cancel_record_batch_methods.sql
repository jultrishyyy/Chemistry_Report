-- 多方法录入批次：逻辑取消某种测试方法，保留原始数据和审计痕迹。

ALTER TABLE record_batch_items
  ADD COLUMN item_status TEXT NOT NULL DEFAULT 'active'
    CHECK (item_status IN ('active','cancelled')),
  ADD COLUMN cancelled_by_name TEXT,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancel_reason TEXT;

ALTER TABLE record_data
  ADD COLUMN cancelled_by_name TEXT,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancel_reason TEXT;

CREATE INDEX idx_record_batch_items_active ON record_batch_items(batch_id, item_status, sort_order, id);
CREATE INDEX idx_record_data_cancelled ON record_data(cancelled_at) WHERE cancelled_at IS NOT NULL;

