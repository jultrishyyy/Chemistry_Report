-- 017: 取消 base 表 dual-write + 模板软删
--
-- 设计：
--   * base 表只存元数据；字段定义 / Typst 源码 / 布局选项一律走 *_template_versions
--   * 软删：archived_at 非 NULL 表示该模板已归档（列表过滤、不可编辑），但版本历史与 record_data 完整保留
--
-- record_data 永远不物理删除 — 检测数据是法律证据，合规要求保留。

-- 1) 删除 base 表的 dual-write 列
-- 注意：执行前必须确保所有读路径已改为 JOIN *_template_versions（已在 routes/services 完成）
ALTER TABLE record_templates  DROP COLUMN IF EXISTS field_definitions;
ALTER TABLE record_templates  DROP COLUMN IF EXISTS typst_source;
ALTER TABLE record_templates  DROP COLUMN IF EXISTS layout_options;

ALTER TABLE report_templates  DROP COLUMN IF EXISTS field_definitions;
ALTER TABLE report_templates  DROP COLUMN IF EXISTS typst_source;
ALTER TABLE report_templates  DROP COLUMN IF EXISTS layout_options;
ALTER TABLE report_templates  DROP COLUMN IF EXISTS placeholders;        -- v1 占位符表，已废弃
ALTER TABLE report_templates  DROP COLUMN IF EXISTS required_test_projects; -- 同上

-- 2) 软删字段
ALTER TABLE record_templates  ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE report_templates  ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX idx_record_templates_archived ON record_templates(archived_at) WHERE archived_at IS NULL;
CREATE INDEX idx_report_templates_archived ON report_templates(archived_at) WHERE archived_at IS NULL;
