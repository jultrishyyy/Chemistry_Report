-- 项目组主机厂仅用于项目组归类和候选排序，不再覆盖组内模板自己的主机厂。

DROP TRIGGER IF EXISTS trg_report_family_host_sync ON report_project_template_families;
DROP FUNCTION IF EXISTS sync_report_family_host();

CREATE OR REPLACE FUNCTION ensure_report_project_family_template()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE family_kind TEXT;
BEGIN
  IF NEW.report_project_family_id IS NULL THEN RETURN NEW; END IF;
  SELECT template_kind INTO family_kind
    FROM report_project_template_families
   WHERE id=NEW.report_project_family_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '报告模板项目组不存在或已删除'; END IF;
  IF NEW.template_kind IS DISTINCT FROM family_kind THEN
    RAISE EXCEPTION '报告模板类型与项目组类型不一致';
  END IF;
  RETURN NEW;
END $$;
