-- 008: 报告模板拆分（首页 + 项目）
ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS template_kind TEXT DEFAULT 'cover';
ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS test_project_codes TEXT[];
ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS linked_record_template_id INTEGER REFERENCES record_templates(id);
ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS layout_options JSONB DEFAULT '{}'::jsonb;
ALTER TABLE report_templates ALTER COLUMN typst_source DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_templates_kind ON report_templates(template_kind);
