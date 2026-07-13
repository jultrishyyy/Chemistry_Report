-- 023: 模板删除（归档）审批流
--
-- 删除不再即点即删：任何人发起「删除申请」（写到 base 行三列），由审核员批准后才真正归档
-- （申请人 ≠ 批准人，与模板版本审核同一合规约束）。驳回/撤销则清空三列。
-- 全过程写 template_audit_log（archive_request / archive_request_cancel / archive_reject / archive）。

ALTER TABLE record_templates
  ADD COLUMN archive_requested_by   TEXT,
  ADD COLUMN archive_requested_at   TIMESTAMPTZ,
  ADD COLUMN archive_request_note   TEXT;

ALTER TABLE report_templates
  ADD COLUMN archive_requested_by   TEXT,
  ADD COLUMN archive_requested_at   TIMESTAMPTZ,
  ADD COLUMN archive_request_note   TEXT;
