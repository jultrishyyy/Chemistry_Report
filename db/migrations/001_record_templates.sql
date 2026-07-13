CREATE TABLE record_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  test_project_id INTEGER,
  version INTEGER DEFAULT 1,
  source_file VARCHAR(500),
  field_definitions JSONB NOT NULL DEFAULT '[]',
  typst_source TEXT,
  layout_options JSONB DEFAULT '{}',
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_record_templates_name ON record_templates(name);
