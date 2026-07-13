-- 034: 报告历史版本（superseded 自指链）+ 1.3 退回修改元数据
--
-- 背景：接口 1.3 RefreshReportInfo 支持把审核后的报告退回修改（data_entry / report_edit）。
-- 退回后文员会「重新生成」报告——旧报告行不再删除，而是用自指链标记被新版本取代，
-- 从而完整保留历史版本（旧 final_typst 仍可重编 PDF 供查看/下载）。
--
-- 同时 1.3 新文档新增 RecordState（外部审核状态）/ Remark（修改备注）两项需要留痕；
-- SecondAuditDate（签发时间）复用既有 report_requisitions.issue_date，不新增列。

-- 报告历史版本：重新生成时旧报告行保留，superseded_by 指向取代它的新报告
ALTER TABLE reports ADD COLUMN IF NOT EXISTS superseded_by INTEGER REFERENCES reports(id);
CREATE INDEX IF NOT EXISTS idx_reports_superseded_by ON reports(superseded_by);

-- 1.3 外部修改元数据（取号单上留痕 + 列表展示）
ALTER TABLE report_requisitions ADD COLUMN IF NOT EXISTS record_state       TEXT;  -- 草稿/审核中/审核通过/审核不通过（外部视角）
ALTER TABLE report_requisitions ADD COLUMN IF NOT EXISTS last_modify_remark TEXT;  -- 最近一次 1.3 退回备注（Remark）
