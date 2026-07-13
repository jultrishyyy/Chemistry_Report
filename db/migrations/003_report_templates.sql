CREATE TABLE report_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  customer_id INTEGER,
  industry_code VARCHAR(50),
  source_file VARCHAR(500),
  typst_source TEXT NOT NULL,
  placeholders JSONB DEFAULT '[]',
  required_test_projects JSONB DEFAULT '[]',
  version INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_report_templates_name ON report_templates(name);
