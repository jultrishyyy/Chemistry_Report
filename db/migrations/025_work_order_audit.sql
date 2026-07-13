-- 委托单结构变更留痕（改/增删 样品·测试项目）。
-- 结构编辑不走数据审核流（属文书订正），但必须可溯源：谁、何时、改了什么。
CREATE TABLE IF NOT EXISTS work_order_audit_log (
  id          SERIAL PRIMARY KEY,
  order_no    TEXT NOT NULL,
  actor_name  TEXT NOT NULL,
  actor_role  TEXT,
  summary     TEXT NOT NULL,         -- 一句话摘要，如「新增样品 1 · 重命名项目 2 · 删除项目 1」
  detail      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 结构化操作明细（ops 列表）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_audit_order ON work_order_audit_log(order_no, created_at DESC);
