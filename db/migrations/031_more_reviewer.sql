-- 031_more_reviewer.sql — 再加一个审核员演示账号
-- 便于"主检与审核人不能为同一人"时切换到另一审核员审核（已有 wang_sup/王主管、zhao_sup/赵主管，这里再加一个）。
-- mock 登录模式下 loginName 即 job_no、任意密码即可登录。

INSERT INTO users (job_no, user_name, depart_name, roles)
SELECT 'sun_sup', '孙审核', '化学检测中心', ARRAY['reviewer']
WHERE COALESCE(current_setting('cdr.integrations_profile', true), 'demo') <> 'server'
ON CONFLICT (job_no) DO NOTHING;
