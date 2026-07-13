-- 委托单表：演示阶段先 seed mock，后续替换为接口同步进来的真实数据
-- payload 结构（与 example.json 对齐）：
--   { samples: [{ id, name, test_infos: [{ name, standard, linked_template_id?, linked_record_id? }] }] }
CREATE TABLE work_orders (
  order_no       TEXT PRIMARY KEY,
  customer_name  TEXT,
  received_at    DATE,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- record_data 增加委托单上下文，便于报告生成时一次查齐
ALTER TABLE record_data
  ADD COLUMN order_no            TEXT,
  ADD COLUMN sample_external_id  TEXT,
  ADD COLUMN test_item_name      TEXT;

CREATE INDEX idx_record_data_order_no ON record_data(order_no);
CREATE INDEX idx_record_data_order_sample_test
  ON record_data(order_no, sample_external_id, test_item_name);
