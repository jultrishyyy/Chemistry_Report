-- 取号报告的项目模板选择。
-- 选择按“报告范围格子 + 原始记录 + 项目模板”留痕，支持同一份原始记录用多个项目模板出报告。
ALTER TABLE report_requisitions
  ADD COLUMN IF NOT EXISTS template_selections JSONB NOT NULL DEFAULT '[]'::jsonb;

