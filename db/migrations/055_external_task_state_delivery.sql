-- 接口 1.6 UpdateMaterialTaskState 出站通知留痕 / 重试队列。
-- 本地审核事务不依赖外部系统可用性；失败通知由服务进程后台重试。
CREATE TABLE IF NOT EXISTS external_task_state_deliveries (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  test_state INTEGER NOT NULL CHECK (test_state IN (0, 1)),
  order_no TEXT NOT NULL,
  sample_external_id TEXT NOT NULL,
  test_item_name TEXT NOT NULL,
  record_data_ids INTEGER[] NOT NULL DEFAULT '{}',
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  receipt TEXT,
  delivery_error TEXT,
  next_retry_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, test_state)
);

CREATE INDEX IF NOT EXISTS idx_external_task_state_delivery_retry
  ON external_task_state_deliveries (delivery_status, next_retry_at)
  WHERE delivery_status <> 'sent';
