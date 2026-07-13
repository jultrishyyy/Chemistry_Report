-- 009: reports 表（已生成的报告快照）
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  order_no TEXT NOT NULL,
  cover_template_id INTEGER REFERENCES report_templates(id),
  project_template_ids INTEGER[],
  record_data_ids INTEGER[],
  final_typst TEXT,                -- 最终编译用的源码
  blocks_snapshot JSONB,           -- 块结构快照（便于 block 模式编辑）
  data_snapshot JSONB,             -- 数据快照
  warnings JSONB,                  -- 设备缺日期等警告
  generated_at TIMESTAMP DEFAULT NOW(),
  generated_by TEXT,
  version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_reports_order_no ON reports(order_no);
CREATE INDEX IF NOT EXISTS idx_reports_generated_at ON reports(generated_at DESC);
