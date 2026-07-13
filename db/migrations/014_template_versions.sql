-- 模板版本管理 + 母子模板（lineage）
-- 设计要点：
--   * record_templates / report_templates 改造为「指针表」，只存当前生效版本（current_version_id）
--   * 新增对应 *_versions 表 append-only，每个版本含完整快照
--   * 母子模板：parent_template_id + parent_version_id（fork 时刻锁定的母版本）
--   * 现有数据迁移为 version_no=1, status='approved'

CREATE TABLE record_template_versions (
  id                  SERIAL PRIMARY KEY,
  template_id         INTEGER NOT NULL REFERENCES record_templates(id) ON DELETE CASCADE,
  version_no          INTEGER NOT NULL,
  field_definitions   JSONB NOT NULL,
  layout_options      JSONB DEFAULT '{}'::jsonb,
  typst_source        TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',
  -- draft / pending / approved / rejected / superseded
  author_name         TEXT NOT NULL,
  reviewer_name       TEXT,
  review_note         TEXT,
  change_summary      TEXT,                       -- 编辑者填写的"做了什么"
  diff_from_prev      JSONB,                      -- 与上一 approved 版本的字段级 diff
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  UNIQUE (template_id, version_no)
);

CREATE TABLE report_template_versions (
  id                  SERIAL PRIMARY KEY,
  template_id         INTEGER NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  version_no          INTEGER NOT NULL,
  field_definitions   JSONB NOT NULL,
  layout_options      JSONB DEFAULT '{}'::jsonb,
  typst_source        TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',
  author_name         TEXT NOT NULL,
  reviewer_name       TEXT,
  review_note         TEXT,
  change_summary      TEXT,
  diff_from_prev      JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  UNIQUE (template_id, version_no)
);

ALTER TABLE record_templates
  ADD COLUMN current_version_id   INTEGER REFERENCES record_template_versions(id),
  ADD COLUMN parent_template_id   INTEGER REFERENCES record_templates(id) ON DELETE SET NULL,
  ADD COLUMN parent_version_id    INTEGER REFERENCES record_template_versions(id);

ALTER TABLE report_templates
  ADD COLUMN current_version_id   INTEGER REFERENCES report_template_versions(id),
  ADD COLUMN parent_template_id   INTEGER REFERENCES report_templates(id) ON DELETE SET NULL,
  ADD COLUMN parent_version_id    INTEGER REFERENCES report_template_versions(id);

CREATE INDEX idx_rtv_template_version  ON record_template_versions(template_id, version_no DESC);
CREATE INDEX idx_rtv_status            ON record_template_versions(status) WHERE status IN ('pending', 'draft', 'rejected');
CREATE INDEX idx_rpv_template_version  ON report_template_versions(template_id, version_no DESC);
CREATE INDEX idx_rpv_status            ON report_template_versions(status) WHERE status IN ('pending', 'draft', 'rejected');
CREATE INDEX idx_record_templates_parent ON record_templates(parent_template_id);
CREATE INDEX idx_report_templates_parent ON report_templates(parent_template_id);

-- 数据迁移：把现有所有 record_templates / report_templates 转成 v1 approved
INSERT INTO record_template_versions
  (template_id, version_no, field_definitions, layout_options, typst_source, status, author_name, reviewer_name, reviewed_at, change_summary)
SELECT
  id, 1,
  field_definitions, COALESCE(layout_options, '{}'::jsonb), typst_source,
  'approved',
  '系统迁移',
  '系统迁移',
  NOW(),
  '初始版本（migration 014 自动生成）'
FROM record_templates;

UPDATE record_templates rt
SET current_version_id = v.id
FROM record_template_versions v
WHERE v.template_id = rt.id AND v.version_no = 1;

INSERT INTO report_template_versions
  (template_id, version_no, field_definitions, layout_options, typst_source, status, author_name, reviewer_name, reviewed_at, change_summary)
SELECT
  id, 1,
  COALESCE(field_definitions, '[]'::jsonb), COALESCE(layout_options, '{}'::jsonb), typst_source,
  'approved',
  '系统迁移',
  '系统迁移',
  NOW(),
  '初始版本（migration 014 自动生成）'
FROM report_templates;

UPDATE report_templates rt
SET current_version_id = v.id
FROM report_template_versions v
WHERE v.template_id = rt.id AND v.version_no = 1;
