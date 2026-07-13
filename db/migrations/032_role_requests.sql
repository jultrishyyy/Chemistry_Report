-- 032_role_requests.sql — 用户自助申请角色 → 管理员(user.manage)审核分配
-- 身份来自外部 SSO、角色本地管理(users.roles)；本表记录"用户主动申请某些角色"的工单，
-- 管理员审核通过后把申请的角色并入 users.roles。一个用户同一时刻只允许一条 pending(部分唯一索引)。
CREATE TABLE IF NOT EXISTS role_requests (
  id              SERIAL PRIMARY KEY,
  job_no          TEXT NOT NULL,                       -- 申请人(= users.job_no)
  user_name       TEXT,
  requested_roles TEXT[] NOT NULL DEFAULT '{}',        -- 申请的角色(rbac.Role[])
  reason          TEXT,                                 -- 申请理由
  status          TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected | withdrawn
  reviewer_job_no TEXT,
  reviewer_name   TEXT,
  review_note     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_role_requests_status ON role_requests(status);
CREATE INDEX IF NOT EXISTS idx_role_requests_job ON role_requests(job_no);
-- 每个用户最多一条待审申请
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_requests_one_pending ON role_requests(job_no) WHERE status = 'pending';
