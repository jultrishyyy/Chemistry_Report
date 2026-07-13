-- 首页草稿（order 级）：取号前文员编辑的"首页实例"，标记为 cover_draft。
-- 复用 reports 行 + 现有 InstanceEditor/PUT 编辑；从"已生成报告"列表排除；
-- 取号生成时以其 content_doc.cover 为首页结构/样式/手改值 carry 到每份报告（binding 按各报告 scope 重解析）。
ALTER TABLE reports ADD COLUMN IF NOT EXISTS is_cover_draft BOOLEAN NOT NULL DEFAULT false;

-- 每个订单至多一份首页草稿（幂等 upsert 的依据）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_cover_draft ON reports(order_no) WHERE is_cover_draft;
