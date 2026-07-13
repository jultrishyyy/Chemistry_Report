-- 030_users_roles.sql — 本地用户与角色（RBAC）
-- 登录走外部认证系统(接口 5.1，只给身份)，角色/权限在本系统本地管理。
-- 角色→权限矩阵在代码里（shared/rbac.ts），本表只存"用户被分配了哪些角色"。

CREATE TABLE IF NOT EXISTS users (
  job_no        TEXT PRIMARY KEY,                 -- 工号/账号（5.1 的 jobNo / loginName）
  user_name     TEXT NOT NULL,                    -- 姓名（5.1 userName）
  depart_name   TEXT,                             -- 部门（5.1 departName）
  roles         TEXT[] NOT NULL DEFAULT '{}',     -- 本地分配的角色（见 shared/rbac.ts Role）
  active         BOOLEAN NOT NULL DEFAULT TRUE,   -- 停用=保留账号但拒绝登录/失权
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 预置演示账号（与旧 mock 身份对齐，便于直接登录测试；真实环境由首次登录自动建档）。
-- mock 登录模式下，loginName 即 job_no，任意密码即可登录。
INSERT INTO users (job_no, user_name, depart_name, roles) VALUES
  ('admin',     '管理员',     '化学检测中心', ARRAY['admin']),
  ('zhang_eng', '张工',       '化学检测中心', ARRAY['tester']),
  ('li_eng',    '李工',       '化学检测中心', ARRAY['tester']),
  ('wang_sup',  '王主管',     '化学检测中心', ARRAY['reviewer']),
  ('zhao_sup',  '赵主管',     '化学检测中心', ARRAY['reviewer']),
  ('tpl_rev',   '模板审核员', '化学检测中心', ARRAY['template_reviewer']),
  ('clerk',     '文员小李',   '化学检测中心', ARRAY['clerk'])
ON CONFLICT (job_no) DO NOTHING;
