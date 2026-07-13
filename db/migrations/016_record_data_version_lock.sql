-- 016: record_data 锁定 template_version_id
-- 设计：每条录入数据明确指向"当时所用的模板版本"快照，不再被模板后续修改影响。
-- 渲染 PDF 时按 template_version_id 指向的 field_definitions / typst_source 渲染。

ALTER TABLE record_data
  ADD COLUMN template_version_id INTEGER REFERENCES record_template_versions(id);

-- 历史数据回填：所有现有 record_data 都假定基于该模板的 current_version_id
UPDATE record_data rd
SET template_version_id = rt.current_version_id
FROM record_templates rt
WHERE rd.template_id = rt.id
  AND rd.template_version_id IS NULL;

-- 模板必须有 current_version_id（migration 014 保证），所以回填后这一列不应为空
-- 但保留 NULL 可能性以兼容尚未审核通过的孤儿数据，不加 NOT NULL 约束

CREATE INDEX idx_record_data_template_version ON record_data(template_version_id);
