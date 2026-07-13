CREATE TABLE record_data (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES record_templates(id),
  template_version INTEGER NOT NULL DEFAULT 1,
  raw_data JSONB NOT NULL DEFAULT '{}',
  derived_data JSONB NOT NULL DEFAULT '{}',
  ad_hoc_fields JSONB DEFAULT '[]',
  submitted_by INTEGER,
  submitted_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_record_data_template ON record_data(template_id);
