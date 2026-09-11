-- 报告项目组同时支持首页模板和项目模板，并确保两类模板不会混入同一组。

ALTER TABLE report_project_template_families
  ADD COLUMN IF NOT EXISTS template_kind TEXT;

UPDATE report_project_template_families
   SET template_kind = 'project'
 WHERE template_kind IS NULL;

ALTER TABLE report_project_template_families
  ALTER COLUMN template_kind SET DEFAULT 'project',
  ALTER COLUMN template_kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_report_template_group_kind'
  ) THEN
    ALTER TABLE report_project_template_families
      ADD CONSTRAINT chk_report_template_group_kind
      CHECK (template_kind IN ('cover', 'project'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_report_template_groups_kind
  ON report_project_template_families(template_kind, archived_at, updated_at DESC);

CREATE OR REPLACE FUNCTION ensure_report_project_family_template()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE family_host INTEGER; family_kind TEXT;
BEGIN
  IF NEW.report_project_family_id IS NULL THEN RETURN NEW; END IF;
  SELECT host_manufacturer_id, template_kind INTO family_host, family_kind
    FROM report_project_template_families
   WHERE id=NEW.report_project_family_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '报告模板项目组不存在或已删除'; END IF;
  IF NEW.template_kind IS DISTINCT FROM family_kind THEN
    RAISE EXCEPTION '报告模板类型与项目组类型不一致';
  END IF;
  NEW.host_manufacturer_id := family_host;
  RETURN NEW;
END $$;
