-- 033_role_restructure.sql — 角色重构为业务四角色 + admin
--   旧 → 新：
--     tester            → test_engineer   (测试工程师)
--     reviewer          → test_supervisor (测试主管：审核原始记录数据 + 编辑原始记录模板)
--     template_reviewer → report_reviewer (报告审核：审核报告 + 编辑报告模板)
--     clerk             → report_clerk    (报告文员)
--     admin             → admin           (不变)
-- 幂等：array_replace 找不到旧值即 no-op，可重复运行。
UPDATE users SET roles = array_replace(roles, 'tester', 'test_engineer')           WHERE 'tester' = ANY(roles);
UPDATE users SET roles = array_replace(roles, 'reviewer', 'test_supervisor')       WHERE 'reviewer' = ANY(roles);
UPDATE users SET roles = array_replace(roles, 'template_reviewer', 'report_reviewer') WHERE 'template_reviewer' = ANY(roles);
UPDATE users SET roles = array_replace(roles, 'clerk', 'report_clerk')             WHERE 'clerk' = ANY(roles);

-- 历史角色申请里的旧角色名一并迁移（一般为空）
UPDATE role_requests SET requested_roles = array_replace(requested_roles, 'tester', 'test_engineer') WHERE 'tester' = ANY(requested_roles);
UPDATE role_requests SET requested_roles = array_replace(requested_roles, 'reviewer', 'test_supervisor') WHERE 'reviewer' = ANY(requested_roles);
UPDATE role_requests SET requested_roles = array_replace(requested_roles, 'template_reviewer', 'report_reviewer') WHERE 'template_reviewer' = ANY(requested_roles);
UPDATE role_requests SET requested_roles = array_replace(requested_roles, 'clerk', 'report_clerk') WHERE 'clerk' = ANY(requested_roles);
