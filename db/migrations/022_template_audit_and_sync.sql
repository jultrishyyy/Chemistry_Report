-- 022: 模板操作审计日志 + 草稿乐观锁 + 母子字段映射
--
-- 设计：
--   * template_audit_log：模板级全操作事件流（创建/改草稿/提交/撤回/审核/fork/同步/归档/恢复/改名/受控登记）。
--     版本表记录"内容是什么"，这张表记录"谁在什么时候做了什么"。
--     template_id 不加 FK——模板软删/极端清理后日志仍须可查（审计数据独立于业务行生命周期）。
--   * *_template_versions.updated_at：草稿保存乐观锁（PUT 带 draft_updated_at，不一致 409，防并发互盖）。
--   * *_templates.field_mapping：fork 子模板的母子字段映射
--     { groups: {childGroupId: parentGroupId}, fields: {childFieldId: parentFieldId} }
--     fork 时刻为恒等映射；之后母/子各自新增的字段不在映射内（同步永不触碰子模板自建字段）。

CREATE TABLE template_audit_log (
  id            SERIAL PRIMARY KEY,
  template_kind TEXT NOT NULL,            -- 'record' | 'report'
  template_id   INTEGER NOT NULL,
  version_id    INTEGER,                  -- 关联的版本行（如适用）
  action        TEXT NOT NULL,            -- create / update_draft / submit / withdraw / approve / reject /
                                          -- fork_out / fork_in / sync_out / sync_in /
                                          -- archive / restore / rename / controlled
  actor_name    TEXT NOT NULL,
  actor_role    TEXT,
  detail        JSONB,                    -- {version_no, change_summary, force, child_ids, source_version_no, ...}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tpl_audit ON template_audit_log(template_kind, template_id, created_at DESC);

ALTER TABLE record_template_versions ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE report_template_versions ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE record_templates ADD COLUMN field_mapping JSONB;
ALTER TABLE report_templates ADD COLUMN field_mapping JSONB;
