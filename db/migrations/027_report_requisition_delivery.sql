-- 报告回传状态（接口 1.4 AcceptReportFromDiGui：本系统把生成的报告 PDF 以 Base64 回传递归智能）。
-- 出站交付的留痕：是否已回传、何时、失败原因。见 待实现内容.md 第 3 节 / 第 6 节。
ALTER TABLE report_requisitions
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'sent' | 'failed'
  ADD COLUMN IF NOT EXISTS delivered_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_error  TEXT;
