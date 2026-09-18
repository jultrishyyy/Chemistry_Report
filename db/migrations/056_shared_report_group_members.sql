-- UI/API share report groups; remove the historical database type-isolation guard.
-- No existing groups, template membership, or manufacturer values are rewritten.
CREATE OR REPLACE FUNCTION ensure_report_project_family_template()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.report_project_family_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.template_kind NOT IN ('cover', 'project') THEN
    RAISE EXCEPTION '项目组仅支持首页模板和项目模板';
  END IF;
  PERFORM 1 FROM report_project_template_families
    WHERE id=NEW.report_project_family_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '报告模板项目组不存在或已删除'; END IF;
  RETURN NEW;
END $$;
