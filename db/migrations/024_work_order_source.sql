-- 委托单来源：区分「外部接口同步」与「界面手动新建」
--   external = fetchExternalOrders() 同步进来的单（真实接口对接前为空）
--   manual   = 工程师/文员在界面上手动新建的单
-- 手动单永不被启动 seed 同步覆盖（seed 仅 upsert external 单）。
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'external';

CREATE INDEX IF NOT EXISTS idx_work_orders_source ON work_orders(source);
