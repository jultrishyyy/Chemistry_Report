-- 修复历史状态不一致：旧版 1.3 回执曾在“未送审”时直接把报告置 external_approved / external_revision。
-- 真实状态机必须是 none → submitted_external(本系统送审成功) → 外部结论。

-- 送审成功、但存量 reports 仍是 none 的报告补齐为“已送审待回执”。
UPDATE reports r
SET external_status = 'submitted_external'
FROM report_requisitions rq
WHERE rq.report_id = r.id
  AND rq.delivery_status = 'sent'
  AND r.external_status = 'none';

-- “未送审却外部审核通过”一定是旧逻辑误标：恢复为可编辑/待送审。
-- 若外部反馈时间早于本系统的送审时间，同样不是对本次送审的有效回执，恢复为待回执。
UPDATE reports r
SET external_status = CASE WHEN rq.delivery_status = 'sent' THEN 'submitted_external' ELSE 'none' END,
    external_ref = NULL,
    external_feedback_at = NULL,
    external_suggestion = NULL,
    stale = false
FROM report_requisitions rq
WHERE rq.report_id = r.id
  AND r.external_status = 'external_approved'
  AND (
    rq.delivery_status <> 'sent'
    OR (r.external_feedback_at IS NOT NULL AND rq.delivered_at IS NOT NULL AND r.external_feedback_at < rq.delivered_at)
  );
