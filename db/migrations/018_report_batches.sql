-- 018: 报告批次 + 报告实例化扩展
--
-- 把"一张委托单 = 一份报告"升级为"一张委托单 = 一个报告批次（含多份报告）"。
-- 三种拆分粒度（按样品 / 按项目 / 自由）都落在同一结构：一个 batch 下挂多行 reports，
-- 每行报告带自己的 scope（含哪些 样品×项目 格子）。
--
-- content_doc / edited 为 P2（报告结构化可编辑）预留：生成时把模板+binding 固化为
-- 自包含的可编辑实例文档，编辑只改 content_doc，永不回写 record_data。

-- 报告批次：一次"生成"动作的产物
CREATE TABLE IF NOT EXISTS report_batches (
  id SERIAL PRIMARY KEY,
  order_no TEXT NOT NULL,
  cover_template_id INTEGER REFERENCES report_templates(id),
  split_mode TEXT NOT NULL,            -- 'single' | 'by_sample' | 'by_project' | 'custom'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_batches_order ON report_batches(order_no);

-- reports 沿用为"一份报告实例"，扩展批次 / 范围 / 实例文档列
ALTER TABLE reports ADD COLUMN IF NOT EXISTS batch_id    INTEGER REFERENCES report_batches(id);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_no   TEXT;         -- 每份报告自己的编号，如 C202512086592-s1
ALTER TABLE reports ADD COLUMN IF NOT EXISTS scope       JSONB;        -- { sample_label, record_data_ids[], project_template_ids[] }
ALTER TABLE reports ADD COLUMN IF NOT EXISTS content_doc JSONB;        -- P2：可编辑实例文档（cover + projects 的 groups+values）
ALTER TABLE reports ADD COLUMN IF NOT EXISTS edited      BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_reports_batch ON reports(batch_id);
