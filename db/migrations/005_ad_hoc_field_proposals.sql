CREATE TABLE ad_hoc_field_proposals (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES record_templates(id),
  field_definition JSONB NOT NULL,
  proposed_by INTEGER,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_proposals_template ON ad_hoc_field_proposals(template_id);
CREATE INDEX idx_proposals_status ON ad_hoc_field_proposals(status);
