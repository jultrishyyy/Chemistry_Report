-- 报告项目模板族：仅 template_kind='project' 可加入。
-- 一个原始记录项目族可以拥有一个通用报告族和多个主机厂专用报告族。

CREATE TABLE report_project_template_families (
  id                       SERIAL PRIMARY KEY,
  record_template_group_id INTEGER NOT NULL REFERENCES test_template_groups(id) ON DELETE CASCADE,
  host_manufacturer_id     INTEGER REFERENCES host_manufacturers(id) ON DELETE RESTRICT,
  code                     TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  description              TEXT,
  base_report_template_id  INTEGER REFERENCES report_templates(id) ON DELETE SET NULL,
  inherited_group_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_report_family_generic
  ON report_project_template_families(record_template_group_id)
  WHERE host_manufacturer_id IS NULL;
CREATE UNIQUE INDEX uq_report_family_manufacturer
  ON report_project_template_families(record_template_group_id,host_manufacturer_id)
  WHERE host_manufacturer_id IS NOT NULL;

ALTER TABLE report_templates
  ADD COLUMN report_project_family_id INTEGER
  REFERENCES report_project_template_families(id) ON DELETE SET NULL;
CREATE INDEX idx_report_templates_project_family
  ON report_templates(report_project_family_id);

-- 存量原始记录项目族补一条通用报告族；存量项目模板因归属可能有歧义，保持独立。
INSERT INTO report_project_template_families
  (record_template_group_id,code,name,description)
SELECT g.id,g.code || '_report_general',g.name || '（通用报告）','由系统为原始记录项目族创建的通用报告项目模板族'
FROM test_template_groups g
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_report_project_family_template()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE family_host INTEGER;
BEGIN
  IF NEW.report_project_family_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.template_kind <> 'project' THEN
    RAISE EXCEPTION '只有报告项目模板可以加入报告项目模板族';
  END IF;
  SELECT host_manufacturer_id INTO family_host
    FROM report_project_template_families WHERE id=NEW.report_project_family_id;
  IF NOT FOUND THEN RAISE EXCEPTION '报告项目模板族不存在'; END IF;
  NEW.host_manufacturer_id := family_host;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_report_template_family_guard
BEFORE INSERT OR UPDATE OF report_project_family_id,template_kind,host_manufacturer_id
ON report_templates FOR EACH ROW
EXECUTE FUNCTION ensure_report_project_family_template();

CREATE OR REPLACE FUNCTION validate_report_family_base()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE template_family INTEGER; template_kind_value TEXT;
BEGIN
  IF NEW.base_report_template_id IS NULL THEN RETURN NEW; END IF;
  SELECT report_project_family_id,template_kind INTO template_family,template_kind_value
    FROM report_templates WHERE id=NEW.base_report_template_id;
  IF NOT FOUND OR template_kind_value <> 'project' OR template_family IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION '族基础报告模板必须是本族的项目模板';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_report_family_base_guard
BEFORE INSERT OR UPDATE OF base_report_template_id
ON report_project_template_families FOR EACH ROW
EXECUTE FUNCTION validate_report_family_base();

CREATE OR REPLACE FUNCTION sync_report_family_host()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.host_manufacturer_id IS DISTINCT FROM OLD.host_manufacturer_id THEN
    UPDATE report_templates SET host_manufacturer_id=NEW.host_manufacturer_id,updated_at=NOW()
      WHERE report_project_family_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_report_family_host_sync
AFTER UPDATE OF host_manufacturer_id
ON report_project_template_families FOR EACH ROW
EXECUTE FUNCTION sync_report_family_host();

CREATE OR REPLACE FUNCTION create_default_report_family()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO report_project_template_families
    (record_template_group_id,code,name,description)
  VALUES (NEW.id,NEW.code || '_report_general',NEW.name || '（通用报告）','由系统为原始记录项目族创建的通用报告项目模板族')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_create_default_report_family
AFTER INSERT ON test_template_groups FOR EACH ROW
EXECUTE FUNCTION create_default_report_family();
