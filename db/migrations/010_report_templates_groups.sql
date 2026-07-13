-- 010: 报告模板 v3 — 复用 RecordTemplate 的 groups 结构
ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS field_definitions JSONB DEFAULT '[]'::jsonb;
