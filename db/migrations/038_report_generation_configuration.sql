-- 报告生成必须先由文员确认本次报告范围（样品/项目/项目模板），禁止隐式自动生成。
ALTER TABLE report_requisitions
  ADD COLUMN IF NOT EXISTS generation_configured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generation_configured_by TEXT;

-- 旧的自动生成报告不需要补配；尚未生成的历史取号单一律要求重新确认。
UPDATE report_requisitions
SET generation_configured_at = NULL,
    generation_configured_by = NULL
WHERE report_id IS NULL;
