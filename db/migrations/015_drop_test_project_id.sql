-- 去掉 record_templates.test_project_id
-- 业务上"关联测试项目"的概念已经被「委托单 → 样品 → 测试项目」体系替代，
-- 模板与测试项目的关联通过 work_orders.payload.samples[].test_infos[].linked_template_id 表达。
ALTER TABLE record_templates DROP COLUMN IF EXISTS test_project_id;
