-- 项目族公共区域：从任意原始记录模板提取，可见地嵌入其他方法模板并显式同步。

CREATE TABLE record_common_components (
  id                 SERIAL PRIMARY KEY,
  group_id           INTEGER NOT NULL REFERENCES test_template_groups(id) ON DELETE CASCADE,
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  source_template_id INTEGER REFERENCES record_templates(id) ON DELETE SET NULL,
  current_version_id INTEGER,
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, code)
);

CREATE TABLE record_common_component_versions (
  id            SERIAL PRIMARY KEY,
  component_id  INTEGER NOT NULL REFERENCES record_common_components(id) ON DELETE CASCADE,
  version_no    INTEGER NOT NULL,
  field_groups  JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_note   TEXT,
  author_name   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (component_id, version_no)
);

ALTER TABLE record_common_components
  ADD CONSTRAINT fk_record_common_current_version
  FOREIGN KEY (current_version_id) REFERENCES record_common_component_versions(id) ON DELETE SET NULL;

CREATE TABLE record_template_common_components (
  template_id                 INTEGER NOT NULL REFERENCES record_templates(id) ON DELETE CASCADE,
  component_id                INTEGER NOT NULL REFERENCES record_common_components(id) ON DELETE CASCADE,
  synced_component_version_id INTEGER REFERENCES record_common_component_versions(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (template_id, component_id)
);

CREATE INDEX idx_record_common_components_group ON record_common_components(group_id, enabled, id);
CREATE INDEX idx_record_template_common_template ON record_template_common_components(template_id);

-- 关联方向统一为：报告项目模板主动选择 linked_record_template_id。
-- 测试方法侧旧字段仅保留数据库兼容，不再作为配置来源。
UPDATE test_method_schemes SET report_project_template_id = NULL WHERE report_project_template_id IS NOT NULL;
