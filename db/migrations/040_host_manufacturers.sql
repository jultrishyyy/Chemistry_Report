-- 主机厂主数据：模板只保存外键，避免同一名称以不同文字重复出现。
CREATE TABLE IF NOT EXISTS host_manufacturers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  short_name VARCHAR(100),
  code VARCHAR(100),
  remark TEXT,
  archived_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_host_manufacturers_active_name
  ON host_manufacturers (lower(btrim(name))) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_host_manufacturers_active_category
  ON host_manufacturers (category) WHERE archived_at IS NULL;

ALTER TABLE report_templates
  ADD COLUMN IF NOT EXISTS host_manufacturer_id INTEGER
  REFERENCES host_manufacturers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_report_templates_host_manufacturer
  ON report_templates (host_manufacturer_id);
