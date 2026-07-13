CREATE TABLE report_template_mappings (
  id SERIAL PRIMARY KEY,
  report_template_id INTEGER NOT NULL REFERENCES report_templates(id),
  placeholder VARCHAR(100) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_field_code VARCHAR(100),
  source_test_project_id INTEGER,
  literal_value TEXT,
  formula JSONB,
  transform VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mappings_template ON report_template_mappings(report_template_id);
CREATE UNIQUE INDEX idx_mappings_unique ON report_template_mappings(report_template_id, placeholder);
